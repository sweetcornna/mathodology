import { randomUUID } from 'node:crypto'
import type { ModelInfo, PermissionMode } from '@shared/types'
import {
  askCli,
  classifyTool,
  parseJson,
  spawnLines,
  splitArgs,
  stderrTail,
  toolTitle,
  type AgentAdapter,
  type AgentInspection,
  type Turn,
  type TurnRequest,
  type TurnSink
} from './base'

type Json = Record<string, unknown>

const MODE_FLAG: Record<PermissionMode, string> = {
  ask: 'manual',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
  bypass: 'bypassPermissions'
}

export interface PendingPermission {
  requestId: string
  input: unknown
  suggestions: unknown
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const part = c as Json
        if (part.type === 'text') return String(part.text ?? '')
        if (part.type === 'image') return '[image]'
        return ''
      })
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/**
 * Turns Claude Code `--output-format stream-json --verbose --include-partial-messages` lines into
 * normalized events. Kept free of process handling so it can be tested against recorded streams.
 */
export class ClaudeStreamParser {
  /** Streaming block ids by content-block index of the message being streamed. */
  private streamBlocks = new Map<number, string>()
  private streamMessageId = ''
  /** Per message id, how many text/thinking blocks have been finalized, to line up with stream ids. */
  private finalCounts = new Map<string, { text: number; thinking: number }>()
  private streamCounts = new Map<string, { text: number; thinking: number }>()
  readonly pending = new Map<string, PendingPermission>()
  sawResult = false
  /** Tokens processed so far this turn (context read + generated), summed over API calls. */
  private tokens = 0
  private callInput = 0

  constructor(private readonly sink: TurnSink) {}

  line(raw: string): void {
    const msg = parseJson(raw)
    if (!msg) return
    switch (msg.type) {
      case 'system':
        return this.system(msg)
      case 'stream_event':
        return this.streamEvent(msg)
      case 'assistant':
        return this.assistant(msg)
      case 'user':
        return this.user(msg)
      case 'result':
        return this.result(msg)
      case 'control_request':
        return this.controlRequest(msg)
      default:
        return
    }
  }

  private system(msg: Json): void {
    if (msg.subtype === 'init') {
      const id = String(msg.session_id ?? '')
      if (id) this.sink.nativeSession(id)
      this.sink.emit({
        kind: 'session.started',
        agent: 'claude',
        model: typeof msg.model === 'string' ? msg.model : undefined,
        nativeSessionId: id || undefined,
        cwd: String(msg.cwd ?? '')
      })
    }
  }

  private counter(map: Map<string, { text: number; thinking: number }>, id: string): { text: number; thinking: number } {
    let c = map.get(id)
    if (!c) {
      c = { text: 0, thinking: 0 }
      map.set(id, c)
    }
    return c
  }

  private streamEvent(msg: Json): void {
    if (msg.parent_tool_use_id) return // sub-agent chatter is shown through its final messages only
    const ev = (msg.event ?? {}) as Json
    if (ev.type === 'message_start') {
      const message = (ev.message ?? {}) as Json
      this.streamMessageId = String(message.id ?? randomUUID())
      this.streamBlocks.clear()
      const u = (message.usage ?? {}) as Json
      this.callInput =
        Number(u.input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0)
      this.sink.emit({ kind: 'turn.progress', tokens: this.tokens + this.callInput })
      return
    }
    if (ev.type === 'message_delta') {
      const out = Number(((ev.usage ?? {}) as Json).output_tokens ?? 0)
      this.tokens += this.callInput + out
      this.callInput = 0
      this.sink.emit({ kind: 'turn.progress', tokens: this.tokens })
      return
    }
    if (ev.type === 'content_block_start') {
      const block = (ev.content_block ?? {}) as Json
      const index = Number(ev.index ?? 0)
      if (block.type === 'text' || block.type === 'thinking') {
        const c = this.counter(this.streamCounts, this.streamMessageId)
        const n = block.type === 'text' ? c.text++ : c.thinking++
        this.streamBlocks.set(index, `${this.streamMessageId}:${block.type}:${n}`)
      }
      return
    }
    if (ev.type === 'content_block_delta') {
      const delta = (ev.delta ?? {}) as Json
      const blockId = this.streamBlocks.get(Number(ev.index ?? 0))
      if (!blockId) return
      if (delta.type === 'text_delta' && delta.text) {
        this.sink.emit({ kind: 'assistant.delta', blockId, text: String(delta.text) })
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        this.sink.emit({ kind: 'assistant.delta', blockId, text: String(delta.thinking), thinking: true })
      }
    }
  }

  private assistant(msg: Json): void {
    const message = (msg.message ?? {}) as Json
    const id = String(message.id ?? randomUUID())
    const parent = msg.parent_tool_use_id ? String(msg.parent_tool_use_id) : undefined
    const content = Array.isArray(message.content) ? (message.content as Json[]) : []
    for (const block of content) {
      if (block.type === 'text') {
        const text = String(block.text ?? '')
        if (!text.trim()) continue
        const n = this.counter(this.finalCounts, id).text++
        this.sink.emit({ kind: 'assistant.text', blockId: `${id}:text:${n}`, text, parentCallId: parent })
      } else if (block.type === 'thinking') {
        const n = this.counter(this.finalCounts, id).thinking++
        const text = String(block.thinking ?? '')
        if (text.trim() && !parent) this.sink.emit({ kind: 'thinking', blockId: `${id}:thinking:${n}`, text })
      } else if (block.type === 'tool_use') {
        const name = String(block.name ?? 'tool')
        const callId = String(block.id ?? randomUUID())
        this.sink.emit({
          kind: 'tool.call',
          callId,
          name,
          toolKind: classifyTool(name),
          title: toolTitle(name, block.input),
          input: block.input,
          parentCallId: parent
        })
        if (name === 'TodoWrite' && !parent) {
          const todos = ((block.input ?? {}) as Json).todos
          if (Array.isArray(todos)) {
            this.sink.emit({
              kind: 'todo.update',
              items: todos.map((t) => {
                const item = t as Json
                const status = item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending'
                return { content: String(item.content ?? ''), status }
              })
            })
          }
        }
      }
    }
  }

  private user(msg: Json): void {
    const message = (msg.message ?? {}) as Json
    const content = Array.isArray(message.content) ? (message.content as Json[]) : []
    for (const block of content) {
      if (block.type !== 'tool_result') continue
      this.sink.emit({
        kind: 'tool.result',
        callId: String(block.tool_use_id ?? ''),
        output: toolResultText(block.content),
        isError: Boolean(block.is_error)
      })
    }
  }

  private result(msg: Json): void {
    this.sawResult = true
    const usage = (msg.usage ?? {}) as Json
    if (typeof msg.session_id === 'string') this.sink.nativeSession(msg.session_id)
    const ok = !msg.is_error && msg.subtype === 'success'
    if (!ok) {
      const errors = Array.isArray(msg.errors) ? msg.errors.join('\n') : ''
      const text = String(msg.result ?? '') || errors || String(msg.subtype ?? 'error')
      this.sink.emit({ kind: 'notice', level: 'error', text })
    }
    this.sink.emit({
      kind: 'turn.completed',
      ok,
      durationMs: Number(msg.duration_ms ?? 0) || undefined,
      usage: {
        inputTokens: Number(usage.input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? 0),
        cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
        costUsd: Number(msg.total_cost_usd ?? 0)
      }
    })
  }

  private controlRequest(msg: Json): void {
    const request = (msg.request ?? {}) as Json
    const requestId = String(msg.request_id ?? '')
    if (request.subtype !== 'can_use_tool' || !requestId) return
    const toolName = String(request.tool_name ?? 'tool')
    this.pending.set(requestId, { requestId, input: request.input, suggestions: request.permission_suggestions })
    this.sink.emit({
      kind: 'permission.request',
      requestId,
      callId: request.tool_use_id ? String(request.tool_use_id) : undefined,
      toolName,
      title: toolTitle(toolName, request.input),
      input: request.input
    })
  }
}

export function claudeArgs(req: TurnRequest): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--forward-subagent-text',
    '--thinking-display',
    'summarized',
    '--permission-mode',
    MODE_FLAG[req.permissionMode]
  ]
  // Anything that would prompt comes back to Studio over the SDK control protocol.
  if (req.permissionMode !== 'bypass') args.push('--permission-prompt-tool', 'stdio')
  else args.push('--dangerously-skip-permissions')
  if (req.model) args.push('--model', req.model)
  if (req.effort) args.push('--effort', req.effort)
  if (req.resumeId) args.push('--resume', req.resumeId)
  else if (req.newSessionId) args.push('--session-id', req.newSessionId)
  if (req.systemAppend) args.push('--append-system-prompt', req.systemAppend)
  if (req.ephemeral) args.push('--no-session-persistence')
  args.push(...splitArgs(req.settings.extraArgs))
  return args
}

/** Turn the model list from Claude Code's `initialize` control response into Studio's shape. */
export function claudeModels(list: unknown): ModelInfo[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((raw): ModelInfo[] => {
    const m = raw as Json
    const value = String(m.value ?? '')
    if (!value) return []
    const efforts = Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.map(String) : undefined
    return [
      {
        // The "default" entry follows the account's recommended model, so Studio passes no --model.
        id: value === 'default' ? '' : value,
        label: String(m.displayName ?? value),
        description: typeof m.description === 'string' ? m.description : undefined,
        model: typeof m.resolvedModel === 'string' ? m.resolvedModel : undefined,
        efforts: efforts?.length ? efforts : undefined
      }
    ]
  })
}

/** Ask Claude Code for its models and account through the SDK `initialize` request; no prompt is sent. */
function inspectClaude(binary: string, env: NodeJS.ProcessEnv): Promise<AgentInspection> {
  return askCli<AgentInspection>(
    binary,
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
    env,
    (msg) => {
      if (msg.type !== 'control_response') return undefined
      const outer = (msg.response ?? {}) as Json
      const body = (outer.response ?? outer) as Json
      const account = (body.account ?? {}) as Json
      return {
        models: claudeModels(body.models),
        account:
          account.subscriptionType || account.email
            ? {
                plan: typeof account.subscriptionType === 'string' ? account.subscriptionType : undefined,
                email: typeof account.email === 'string' ? account.email : undefined
              }
            : undefined
      }
    },
    { first: [{ type: 'control_request', request_id: 'studio-inspect', request: { subtype: 'initialize' } }] }
  ).then((r) => r ?? { models: [] })
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  name: 'Claude Code',
  binaryName: 'claude',
  supportsApproval: true,
  supportsResume: true,
  versionArgs: ['--version'],
  models: [
    { id: '', label: 'Default', model: 'claude' },
    { id: 'opus', label: 'Opus', model: 'claude-opus' },
    { id: 'sonnet', label: 'Sonnet', model: 'claude-sonnet' },
    { id: 'haiku', label: 'Haiku', model: 'claude-haiku' }
  ],
  inspect: inspectClaude,
  start(req: TurnRequest, sink: TurnSink): Turn {
    const parser = new ClaudeStreamParser(sink)
    const { child, exited, kill } = spawnLines(req.binary, claudeArgs(req), req.cwd, req.env, (l) => parser.line(l))
    const write = (obj: unknown): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(obj) + '\n')
    }
    write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: req.prompt }] } })

    let interrupted = false
    const original = parser.line.bind(parser)
    // Close stdin once the turn's result arrives so the CLI exits.
    parser.line = (raw: string) => {
      original(raw)
      if (parser.sawResult && !child.stdin.destroyed) child.stdin.end()
    }

    const done = exited.then(({ code, signal, stderr }) => {
      for (const p of parser.pending.values()) {
        sink.emit({ kind: 'permission.resolved', requestId: p.requestId, allow: false })
      }
      parser.pending.clear()
      if (!parser.sawResult) {
        if (!interrupted) {
          const tail = stderrTail(stderr)
          sink.emit({
            kind: 'notice',
            level: 'error',
            text: `Claude Code exited (${signal ?? code ?? 'unknown'})${tail ? `:\n${tail}` : ''}`,
          code: 'agentExited',
          vars: { agent: 'Claude Code', status: String(signal ?? code ?? '?'), tail }
          })
        }
        sink.emit({ kind: 'turn.completed', ok: false, summary: interrupted ? 'interrupted' : undefined })
      }
    })

    return {
      interrupt() {
        interrupted = true
        write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } })
        setTimeout(() => {
          if (child.exitCode === null) {
            child.stdin.end()
            kill('SIGINT')
          }
        }, 1500)
        setTimeout(() => child.exitCode === null && kill('SIGKILL'), 6000)
      },
      respondPermission(requestId, allow, always) {
        const p = parser.pending.get(requestId)
        if (!p) return
        parser.pending.delete(requestId)
        const response = allow
          ? {
              behavior: 'allow',
              updatedInput: p.input,
              ...(always && Array.isArray(p.suggestions) ? { updatedPermissions: p.suggestions } : {})
            }
          : { behavior: 'deny', message: 'The user declined this action in Mathodology Studio.' }
        write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
        sink.emit({ kind: 'permission.resolved', requestId, allow, always })
      },
      done
    }
  }
}
