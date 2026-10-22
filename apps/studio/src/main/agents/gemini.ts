import { randomUUID } from 'node:crypto'
import type { PermissionMode } from '@shared/types'
import {
  classifyTool,
  parseJson,
  spawnLines,
  splitArgs,
  SIGN_IN_PROMPT,
  stderrTail,
  toolTitle,
  type AgentAdapter,
  type Turn,
  type TurnRequest,
  type TurnSink
} from './base'

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
  const prompt = req.systemAppend ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt
  args.push('-p', prompt)
  return args
}

export const geminiAdapter: AgentAdapter = {
  id: 'gemini',
  name: 'Gemini CLI',
  binaryName: 'gemini',
  supportsApproval: false,
  supportsResume: true,
  versionArgs: ['--version'],
  models: [
    { id: '', label: 'Default' },
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (preview)' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
  ],
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
    child.stdin.end()
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
