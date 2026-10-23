import { randomUUID } from 'node:crypto'
import type { ModelInfo, PermissionMode } from '@shared/types'
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
import { execCli } from './launch'

type Json = Record<string, unknown>

/**
 * Antigravity CLI's print mode denies whatever needs a review, so `ask` runs with edits accepted
 * (like Gemini CLI's headless mode); what it denied is reported after the turn.
 */
const MODE: Record<PermissionMode, string[]> = {
  ask: ['--mode', 'accept-edits'],
  acceptEdits: ['--mode', 'accept-edits'],
  plan: ['--mode', 'plan'],
  bypass: ['--dangerously-skip-permissions']
}

export function agyArgs(req: TurnRequest): string[] {
  // `-p=` with stream-json input: the prompt comes on stdin, one `{"event":"user"}` line per turn.
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', ...MODE[req.permissionMode]]
  if (req.model) args.push('--model', req.model)
  if (req.effort) args.push('--effort', req.effort)
  if (req.resumeId) args.push('--conversation', req.resumeId)
  args.push(...splitArgs(req.settings.extraArgs), '-p=')
  return args
}

/** The stdin line for one turn; agy has no system-prompt flag, so Studio's note leads the first prompt. */
export function agyInput(req: Pick<TurnRequest, 'prompt' | 'systemAppend'>): string {
  const text = req.systemAppend ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt
  return JSON.stringify({ event: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
}

/** Parses `agy --output-format stream-json`: `{"event": X, X: {...}}` lines for init, step updates and the result. */
export class AgyStreamParser {
  sawResult = false
  /** Text streamed for each agent_response step, by step index. */
  private text = new Map<number, string>()
  private thinking = new Map<number, string>()
  private turnId = randomUUID()
  private tools = new Set<number>()

  constructor(private readonly sink: TurnSink) {}

  line(raw: string): void {
    const msg = parseJson(raw)
    if (!msg) return
    const event = String(msg.event ?? '')
    const body = (msg[event] ?? {}) as Json
    if (event === 'init') {
      const id = String(msg.conversation_id ?? body.conversation_id ?? '')
      if (id) this.sink.nativeSession(id)
      this.sink.emit({
        kind: 'session.started',
        agent: 'agy',
        model: typeof body.model === 'string' ? body.model : undefined,
        nativeSessionId: id || undefined,
        cwd: String(body.cwd ?? '')
      })
    } else if (event === 'step_update') {
      this.step(body)
    } else if (event === 'result') {
      this.result(body)
    }
  }

  private blockId(step: number, kind: string): string {
    return `${this.turnId}:${step}:${kind}`
  }

  private step(s: Json): void {
    const index = Number(s.step_index ?? 0)
    const state = String(s.state ?? '')
    switch (s.step_type) {
      case 'agent_response': {
        const thought = typeof s.thinking_delta === 'string' ? s.thinking_delta : ''
        if (thought) {
          this.thinking.set(index, (this.thinking.get(index) ?? '') + thought)
          this.sink.emit({ kind: 'assistant.delta', blockId: this.blockId(index, 'thinking'), text: thought, thinking: true })
        }
        const delta = typeof s.text_delta === 'string' ? s.text_delta : ''
        if (delta) {
          this.text.set(index, (this.text.get(index) ?? '') + delta)
          this.sink.emit({ kind: 'assistant.delta', blockId: this.blockId(index, 'text'), text: delta })
        }
        if (state !== 'ACTIVE') {
          const thinking = this.thinking.get(index)
          if (thinking?.trim()) this.sink.emit({ kind: 'thinking', blockId: this.blockId(index, 'thinking'), text: thinking })
          const text = this.text.get(index)
          if (text?.trim()) this.sink.emit({ kind: 'assistant.text', blockId: this.blockId(index, 'text'), text })
          const u = (s.usage ?? {}) as Json
          const tokens = Number(u.total_tokens ?? 0)
          if (tokens) this.sink.emit({ kind: 'turn.progress', tokens })
        }
        return
      }
      case 'tool': {
        const info = (s.tool_info ?? {}) as Json
        const name = String(s.tool_name ?? info.name ?? 'tool')
        const callId = this.blockId(index, 'tool')
        if (!this.tools.has(index)) {
          this.tools.add(index)
          this.sink.emit({
            kind: 'tool.call',
            callId,
            name,
            toolKind: classifyTool(name),
            title: toolTitle(name, info.parameters),
            input: info.parameters
          })
        }
        if (state === 'DONE' || state === 'ERROR') {
          const error = (info.error ?? {}) as Json
          const output = info.output ?? info.result ?? info.response
          this.sink.emit({
            kind: 'tool.result',
            callId,
            output: state === 'ERROR' ? String(error.message ?? error.type ?? 'failed') : typeof output === 'string' ? output : output ? JSON.stringify(output) : '',
            isError: state === 'ERROR'
          })
        }
        return
      }
      default:
        return
    }
  }

  private result(r: Json): void {
    this.sawResult = true
    const id = String(r.conversation_id ?? '')
    if (id) this.sink.nativeSession(id)
    const ok = r.status === 'SUCCESS'
    // A reply that never streamed (some models answer in one piece) still reaches the transcript.
    const response = typeof r.response === 'string' ? r.response : ''
    if (response.trim() && ![...this.text.values()].some((t) => t.trim())) {
      this.sink.emit({ kind: 'assistant.text', blockId: this.blockId(-1, 'text'), text: response })
    }
    if (!ok) this.sink.emit({ kind: 'notice', level: 'error', text: String(r.error || 'Antigravity CLI reported an error') })
    const denied = Array.isArray(r.denied_actions) ? (r.denied_actions as Json[]) : []
    if (denied.length) {
      const names = [...new Set(denied.map((d) => String(d.display_name ?? d.action ?? '?')))].join(', ')
      this.sink.emit({
        kind: 'notice',
        level: 'warning',
        text: `Antigravity CLI cannot ask for approval when run by Studio and declined: ${names}. Choose "Full autonomy" in the permission menu to let it run them.`,
        code: 'deniedActions',
        vars: { agent: 'Antigravity CLI', actions: names }
      })
    }
    const u = (r.usage ?? {}) as Json
    this.sink.emit({
      kind: 'turn.completed',
      ok,
      durationMs: Number(r.duration_seconds ?? 0) * 1000 || undefined,
      usage: {
        inputTokens: Number(u.input_tokens ?? 0),
        outputTokens: Number(u.output_tokens ?? 0) + Number(u.thinking_tokens ?? 0),
        cacheReadTokens: Number(u.cache_read_tokens ?? 0)
      }
    })
  }
}

/** `agy models`: a header line, then `id<TAB>label` per model. */
export function agyModels(out: string): ModelInfo[] {
  const models = out
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 2 && p[0].trim() && !/\s/.test(p[0].trim()))
    .map(([id, label]) => ({ id: id.trim(), label: label.trim() || id.trim() }))
  return models.length ? [{ id: '', label: 'Default' }, ...models] : []
}

function inspectAgy(binary: string, env: NodeJS.ProcessEnv): Promise<AgentInspection> {
  return new Promise((resolve) => {
    execCli(binary, ['models'], { env, timeout: 15_000, maxBuffer: 1 << 20 }, (_err, stdout) => resolve({ models: agyModels(stdout) }))
  })
}

export const agyAdapter: AgentAdapter = {
  id: 'agy',
  name: 'Antigravity CLI',
  binaryNames: ['agy'],
  route: 'stream-json',
  supportsApproval: false,
  supportsResume: true,
  versionArgs: ['--version'],
  models: [{ id: '', label: 'Default', model: 'gemini' }],
  inspect: inspectAgy,
  start(req: TurnRequest, sink: TurnSink): Turn {
    const parser = new AgyStreamParser(sink)
    let signInNoticed = false
    const { child, exited, kill } = spawnLines(req.binary, agyArgs(req), req.cwd, req.env, (l) => parser.line(l))
    child.stderr.on('data', (d: string) => {
      if (!signInNoticed && SIGN_IN_PROMPT.test(d) && !parser.sawResult) {
        signInNoticed = true
        sink.emit({
          kind: 'notice',
          level: 'warning',
          text: 'Antigravity CLI needs you to sign in. Run `agy` once in a terminal, or set its API key under Settings → Agents.',
          code: 'signIn',
          vars: { agent: 'Antigravity CLI', command: 'agy', env: 'GEMINI_API_KEY' }
        })
      }
    })
    child.stdin.end(agyInput(req))

    let interrupted = false
    const done = exited.then(({ code, signal, stderr }) => {
      if (parser.sawResult) return
      if (!interrupted) {
        const tail = stderrTail(stderr)
        sink.emit({
          kind: 'notice',
          level: 'error',
          text: `Antigravity CLI exited (${signal ?? code ?? 'unknown'})${tail ? `:\n${tail}` : ''}`,
          code: 'agentExited',
          vars: { agent: 'Antigravity CLI', status: String(signal ?? code ?? '?'), tail }
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
      respondPermission() {
        // Print mode never pauses for approval.
      },
      done
    }
  }
}
