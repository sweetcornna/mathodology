import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentAccount, ModelInfo, PermissionMode } from '@shared/types'
import {
  classifyTool,
  parseJson,
  spawnLines,
  splitArgs,
  SIGN_IN_PROMPT,
  stderrTail,
  toolTitle,
  type AgentAdapter,
  type AgentInspection,
  type Turn,
  type TurnRequest,
  type TurnSink
} from './base'
import { launch } from './launch'

type Json = Record<string, unknown>

/** Headless Gemini denies anything needing confirmation, so `ask` auto-accepts edits only. */
const APPROVAL: Record<PermissionMode, string> = {
  plan: 'plan',
  ask: 'auto_edit',
  acceptEdits: 'auto_edit',
  bypass: 'yolo'
}

/** Parses `gemini --output-format stream-json` JSONL into normalized events. */
export class GeminiStreamParser {
  sawResult = false
  private blockId = randomUUID()
  private text = ''

  constructor(private readonly sink: TurnSink) {}

  private flushText(): void {
    if (this.text.trim()) this.sink.emit({ kind: 'assistant.text', blockId: this.blockId, text: this.text })
    this.text = ''
    this.blockId = randomUUID()
  }

  line(raw: string): void {
    const msg = parseJson(raw)
    if (!msg) return
    switch (msg.type) {
      case 'init': {
        const id = String(msg.session_id ?? '')
        if (id) this.sink.nativeSession(id)
        this.sink.emit({
          kind: 'session.started',
          agent: 'gemini',
          model: typeof msg.model === 'string' ? msg.model : undefined,
          nativeSessionId: id || undefined,
          cwd: ''
        })
        return
      }
      case 'message': {
        if (msg.role !== 'assistant') return
        const chunk = String(msg.content ?? '')
        if (msg.delta) {
          this.text += chunk
          this.sink.emit({ kind: 'assistant.delta', blockId: this.blockId, text: chunk })
        } else {
          this.text = chunk
          this.flushText()
        }
        return
      }
      case 'tool_use': {
        this.flushText()
        const name = String(msg.tool_name ?? 'tool')
        this.sink.emit({
          kind: 'tool.call',
          callId: String(msg.tool_id ?? randomUUID()),
          name,
          toolKind: classifyTool(name),
          title: toolTitle(name, msg.parameters),
          input: msg.parameters ?? {}
        })
        return
      }
      case 'tool_result': {
        const error = msg.error as Json | undefined
        this.sink.emit({
          kind: 'tool.result',
          callId: String(msg.tool_id ?? ''),
          output: error ? String(error.message ?? 'error') : String(msg.output ?? ''),
          isError: msg.status === 'error' || Boolean(error)
        })
        return
      }
      case 'error':
        this.sink.emit({
          kind: 'notice',
          level: msg.severity === 'warning' ? 'warning' : 'error',
          text: String(msg.message ?? 'Gemini error')
        })
        return
      case 'result': {
        this.flushText()
        this.sawResult = true
        const stats = (msg.stats ?? {}) as Json
        const ok = msg.status !== 'error'
        if (!ok) {
          const err = (msg.error ?? {}) as Json
          this.sink.emit({ kind: 'notice', level: 'error', text: String(err.message ?? 'Gemini turn failed') })
        }
        this.sink.emit({
          kind: 'turn.completed',
          ok,
          durationMs: Number(stats.duration_ms ?? 0) || undefined,
          usage: {
            inputTokens: Number(stats.input_tokens ?? stats.input ?? 0),
            outputTokens: Number(stats.output_tokens ?? 0),
            cacheReadTokens: Number(stats.cached ?? 0)
          }
        })
        return
      }
      default:
        return
    }
  }
}

export function geminiArgs(req: TurnRequest): string[] {
  const args = ['--output-format', 'stream-json', '--approval-mode', APPROVAL[req.permissionMode], '--skip-trust']
  if (req.model) args.push('-m', req.model)
  if (req.resumeId) args.push('--resume', req.resumeId)
  else if (req.newSessionId) args.push('--session-id', req.newSessionId)
  args.push(...splitArgs(req.settings.extraArgs))
  return args
}

/**
 * The prompt goes on stdin, which Gemini CLI reads as the prompt when it is not a terminal. As an
 * argument it would hit command-line limits (32,767 characters on Windows, 128 KiB on Linux).
 */
export function geminiInput(req: TurnRequest): string {
  return req.systemAppend ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt
}

/** "gemini-3.1-pro-preview" → "Gemini 3.1 Pro Preview", "auto-gemini-3" → "Auto (Gemini 3)". */
function geminiLabel(id: string): string {
  const words = (s: string): string =>
    s
      .split('-')
      .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
  return id.startsWith('auto-') ? `Auto (${words(id.slice(5))})` : words(id)
}

/** Order: automatic routing first, then newer versions, then pro before flash before lite. */
function geminiRank(id: string): [number, number, number] {
  const version = Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0)
  const tier = /lite/.test(id) ? 2 : /flash/.test(id) ? 1 : 0
  return [id.startsWith('auto-') ? 0 : 1, -version, tier]
}

/**
 * Gemini CLI has no model-list command, but its bundle declares the models it targets as
 * constants (default, preview, latest). Reading them from the installed copy keeps the list in
 * step with the user's CLI version.
 */
export function geminiModelsFromSource(source: string): ModelInfo[] {
  const ids = new Set<string>()
  for (const m of source.matchAll(/\b(?:var|const|let) ((?:DEFAULT|PREVIEW|LATEST|BASE)_GEMINI_[A-Z0-9_]*MODEL(?:_AUTO)?) = "([^"]+)"/g)) {
    if (/EMBEDDING|CUSTOM_TOOLS/.test(m[1]) || !/^(auto-)?gemini-/.test(m[2])) continue
    ids.add(m[2])
  }
  const sorted = [...ids].sort((a, b) => {
    const [x, y] = [geminiRank(a), geminiRank(b)]
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.localeCompare(b)
  })
  return sorted.map((id) => ({ id, label: geminiLabel(id), model: id }))
}

function geminiPackageDir(binary: string): string | null {
  // Behind an npm shim on Windows, the package is where the script the shim runs lives.
  const l = launch(binary, [])
  const entry = l.file === binary || l.verbatim ? binary : (l.args[0] ?? l.file)
  let dir = dirname(realpathSync(entry))
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'bundle'))) return dir
    dir = dirname(dir)
  }
  return null
}

function geminiAccount(): AgentAccount | undefined {
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.gemini', 'settings.json'), 'utf8'))
    const kind = String(settings?.security?.auth?.selectedType ?? settings?.selectedAuthType ?? '')
    const plan = kind.startsWith('oauth') ? 'Google account' : kind.includes('api-key') ? 'API key' : kind.includes('vertex') ? 'Vertex AI' : undefined
    let email: string | undefined
    try {
      const active = JSON.parse(readFileSync(join(homedir(), '.gemini', 'google_accounts.json'), 'utf8'))?.active
      if (plan === 'Google account' && typeof active === 'string') email = active
    } catch {
      // No cached Google account.
    }
    return plan ? { plan, email } : undefined
  } catch {
    return undefined
  }
}

async function inspectGemini(binary: string): Promise<AgentInspection> {
  const account = geminiAccount()
  try {
    const pkg = geminiPackageDir(binary)
    if (!pkg) return { models: [], account }
    const bundle = join(pkg, 'bundle')
    const source = readdirSync(bundle)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(bundle, f), 'utf8'))
      .join('\n')
    const models = geminiModelsFromSource(source)
    return { models: models.length ? [{ id: '', label: 'Default', model: 'gemini' }, ...models] : [], account }
  } catch {
    return { models: [], account }
  }
}

export const geminiAdapter: AgentAdapter = {
  id: 'gemini',
  name: 'Gemini CLI',
  binaryNames: ['gemini'],
  route: 'stream-json',
  takesSessionId: true,
  supportsApproval: false,
  supportsResume: true,
  versionArgs: ['--version'],
  models: [
    { id: '', label: 'Default', model: 'gemini' },
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (preview)' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
  ],
  inspect: (binary) => inspectGemini(binary),
  start(req: TurnRequest, sink: TurnSink): Turn {
    const parser = new GeminiStreamParser(sink)
    let needsSignIn = false
    const { child, exited, kill } = spawnLines(req.binary, geminiArgs(req), req.cwd, req.env, (l) => parser.line(l))
    // The sign-in question ends without a newline, so watch raw output rather than lines.
    child.stdout.on('data', (chunk: string) => {
      if (needsSignIn || chunk.trimStart().startsWith('{') || !SIGN_IN_PROMPT.test(chunk)) return
      needsSignIn = true
      sink.emit({
        kind: 'notice',
        level: 'error',
        text: 'Gemini CLI is not signed in. Run `gemini` once in a terminal to sign in (or set GEMINI_API_KEY), then try again.',
        code: 'signIn',
        vars: { agent: 'Gemini CLI', command: 'gemini', env: 'GEMINI_API_KEY' }
      })
      kill('SIGTERM')
    })
    child.stdin.end(geminiInput(req))
    let interrupted = false
    const done = exited.then(({ code, signal, stderr }) => {
      if (parser.sawResult) return
      if (!interrupted && !needsSignIn) {
        const tail = stderrTail(stderr)
        sink.emit({
          kind: 'notice',
          level: 'error',
          text: `Gemini CLI exited (${signal ?? code ?? 'unknown'})${tail ? `:\n${tail}` : ''}`,
          code: 'agentExited',
          vars: { agent: 'Gemini CLI', status: String(signal ?? code ?? '?'), tail }
        })
      }
      sink.emit({ kind: 'turn.completed', ok: false, summary: interrupted ? 'interrupted' : undefined })
    })
    return {
      interrupt() {
        interrupted = true
        kill('SIGINT')
        setTimeout(() => child.exitCode === null && kill('SIGKILL'), 5000)
      },
      respondPermission() {},
      done
    }
  }
}
