import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { tmpdir } from 'node:os'
import { splitArgs } from '@shared/args'
import type {
  AgentAccount,
  AgentId,
  AgentSettings,
  Connector,
  ModelInfo,
  PermissionMode,
  SessionEventBody,
  ToolKind
} from '@shared/types'
import { killTree, launch } from './launch'

export interface TurnRequest {
  binary: string
  cwd: string
  prompt: string
  model?: string
  effort?: string
  permissionMode: PermissionMode
  /** The CLI's own session/thread id from an earlier turn. */
  resumeId?: string
  /** A fresh id to give a new CLI session, for CLIs that accept one up front. */
  newSessionId?: string
  /** Appended to the agent's system prompt when the CLI supports it. */
  systemAppend?: string
  /** A side run (such as a review) that should not be saved in the CLI's session history. */
  ephemeral?: boolean
  settings: AgentSettings
  env: NodeJS.ProcessEnv
  /** Enabled MCP connectors, for CLIs that take their servers per session (ACP) rather than from project files. */
  mcpServers?: Connector[]
}

export interface TurnSink {
  emit(body: SessionEventBody): void
  /** The CLI reported (or changed) its native session id. */
  nativeSession(id: string): void
}

export interface Turn {
  interrupt(): void
  respondPermission(requestId: string, allow: boolean, always?: boolean): void
  /** Resolves when the process has exited and the turn is closed. */
  done: Promise<void>
}

export interface AgentInspection {
  models: ModelInfo[]
  account?: AgentAccount
}

export interface AgentAdapter {
  id: AgentId
  name: string
  /** Executables to look for on PATH, in order. */
  binaryNames: string[]
  /** The interface Studio drives it through, shown in Settings. */
  route: string
  supportsApproval: boolean
  supportsResume: boolean
  /** The CLI accepts a session id chosen by Studio for a new conversation, which makes resuming reliable. */
  takesSessionId?: boolean
  /** The CLI forgets an appended system prompt between runs, so Studio sends it every turn. */
  systemPromptEachTurn?: boolean
  /** Used when the installed CLI cannot report its own models. */
  models: ModelInfo[]
  /** Arguments that print the version; empty for a CLI that has none, which then counts as found. */
  versionArgs: string[]
  /** Ask the installed CLI for its models and account, without starting a conversation. */
  inspect?(binary: string, env: NodeJS.ProcessEnv): Promise<AgentInspection>
  start(req: TurnRequest, sink: TurnSink): Turn
}

/** Splits a byte stream into complete lines, keeping the unfinished tail. */
export class LineSplitter {
  private buf = ''
  push(chunk: string): string[] {
    this.buf += chunk
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    return lines.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
  }
  flush(): string[] {
    const rest = this.buf.trim()
    this.buf = ''
    return rest ? [rest] : []
  }
}

export { splitArgs }

export function classifyTool(name: string): ToolKind {
  const n = name.toLowerCase()
  if (n.startsWith('mcp__')) return 'mcp'
  if (/^(bash|shell|run_shell_command|run_command|command|exec|execute|bashoutput|killshell)/.test(n)) return 'shell'
  if (/^(webfetch|websearch|web_fetch|google_web_search|web_search|search_web|read_url|fetch)/.test(n)) return 'web'
  if (/^(read|read_file|read_many_files|notebookread|view)/.test(n)) return 'read'
  if (/^(edit|multiedit|replace|multi_replace|sed_file|notebookedit|notebook_edit|apply_patch|file_change)/.test(n)) return 'edit'
  if (/^(write|write_file|write_to_file)/.test(n)) return 'write'
  if (/^(grep|glob|ls|list_dir|list_directory|search_file_content|find|search)/.test(n)) return 'search'
  if (/^(task|agent|invoke_subagent)$/.test(n)) return 'task'
  if (/^(todowrite|todo_list|todo|update_plan|write_todos)/.test(n)) return 'todo'
  if (n === 'skill') return 'skill'
  return 'other'
}

/** The first of `names` present in `input`, matching keys without regard to case or underscores. */
export function pick(input: unknown, ...names: string[]): unknown {
  const i = (input ?? {}) as Record<string, unknown>
  const norm = (k: string): string => k.toLowerCase().replace(/[_-]/g, '')
  for (const name of names) {
    const key = Object.keys(i).find((k) => norm(k) === norm(name))
    if (key !== undefined && i[key] != null && i[key] !== '') return i[key]
  }
  return undefined
}

function short(s: unknown, max = 80): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function baseName(p: unknown): string {
  const s = String(p ?? '')
  return s.split(/[\\/]/).pop() || s
}

/** A one-line human title for a tool call, built from its most telling argument. */
export function toolTitle(name: string, input: unknown): string {
  const path = (): unknown => pick(input, 'file_path', 'path', 'absolute_path', 'notebook_path', 'target_file', 'filename')
  switch (classifyTool(name)) {
    case 'shell':
      return short(pick(input, 'description', 'command', 'command_line', 'cmd') ?? name)
    case 'read':
      return baseName(path())
    case 'edit':
    case 'write':
      return baseName(path())
    case 'search':
      return short(pick(input, 'pattern', 'query', 'path', 'search_path', 'directory_path') ?? '')
    case 'web':
      return short(pick(input, 'url', 'query', 'prompt'))
    case 'task':
      return short(pick(input, 'description', 'prompt', 'task'))
    case 'skill':
      return short(pick(input, 'skill', 'command', 'name'))
    case 'mcp':
      return name.replace(/^mcp__/, '').replace(/__/g, ' · ')
    default:
      return short(pick(input, 'description', 'command', 'intent') ?? '')
  }
}

export interface SpawnedTurn {
  child: ChildProcessWithoutNullStreams
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>
  /** Signal the CLI's whole process group: node-based CLIs re-spawn themselves as a child. */
  kill(signal: NodeJS.Signals): void
}

/** CLIs whose output is still open, so quitting can make sure none outlives Studio. */
const running = new Set<ChildProcessWithoutNullStreams>()

/**
 * SIGKILL the process group of every CLI still running (agents start scripts and servers in the
 * same group). The last step of quitting, once turns and reviews had their grace period.
 */
export function killAllAgents(): void {
  for (const child of running) killTree(child, 'SIGKILL')
}

/** Spawn a CLI and feed each stdout line to `onLine`. stderr is kept for error reporting. */
export function spawnLines(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onLine: (line: string) => void
): SpawnedTurn {
  const l = launch(binary, args)
  const child = spawn(l.file, l.args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
    windowsVerbatimArguments: l.verbatim
  })
  running.add(child)
  // A CLI that exits before reading its prompt fails the write with EPIPE; the turn just ends.
  child.stdin.on('error', () => undefined)
  const out = new LineSplitter()
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d: string) => out.push(d).forEach(onLine))
  child.stderr.on('data', (d: string) => {
    stderr = (stderr + d).slice(-20_000)
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve) => {
    child.on('error', (err) => {
      stderr += `\n${err.message}`
      if (!child.pid) running.delete(child)
    })
    child.on('close', (code, signal) => {
      running.delete(child)
      out.flush().forEach(onLine)
      resolve({ code, signal, stderr })
    })
  })
  const kill = (signal: NodeJS.Signals): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    killTree(child, signal)
  }
  return { child, exited, kill }
}

/**
 * Run a CLI briefly and talk to it in JSON lines, for questions such as "which models are
 * available". `answer` sees each message and returns a result to finish; `null` means the CLI
 * did not answer in time or exited first.
 */
export function askCli<T>(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  answer: (msg: Record<string, unknown>, send: (obj: unknown) => void) => T | undefined,
  opts: { first?: unknown[]; timeoutMs?: number } = {}
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const spawned = spawnLines(binary, args, tmpdir(), env, (line) => {
      const msg = parseJson(line)
      if (!msg || settled) return
      const result = answer(msg, send)
      if (result !== undefined) finish(result)
    })
    const send = (obj: unknown): void => {
      if (!spawned.child.stdin.destroyed) spawned.child.stdin.write(`${JSON.stringify(obj)}\n`)
    }
    const finish = (result: T | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      spawned.kill('SIGTERM')
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 15_000)
    void spawned.exited.then(() => finish(null))
    for (const obj of opts.first ?? []) send(obj)
  })
}

/** Lines that CLIs print when they need an interactive sign-in, which a headless run cannot answer. */
export const SIGN_IN_PROMPT = /authenticat|sign[ -]?in|log[ -]?in|\/login|api key/i

export function parseJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Last meaningful stderr lines, for a failed-turn notice. */
export function stderrTail(stderr: string, lines = 6): string {
  return stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-lines)
    .join('\n')
}
