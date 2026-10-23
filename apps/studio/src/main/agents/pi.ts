import type { ModelInfo, PermissionMode, TodoItem } from '@shared/types'
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

const PROMPT_ID = 'studio-prompt'
const STATE_ID = 'studio-state'

interface PendingDialog {
  method: string
  options: string[]
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content)
  return content
    .map((c) => {
      const part = c as Json
      if (part.type === 'text') return String(part.text ?? '')
      if (part.type === 'image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Parses pi's RPC stream (`--mode rpc`), which oh-my-pi extends (`--mode rpc-ui`): session events
 * shared with `--mode json`, responses to Studio's commands, and extension dialogs, through which
 * oh-my-pi asks before running a tool.
 */
export class PiRpcParser {
  settled = false
  ok = true
  aborted = false
  sessionId = ''
  private started = false
  readonly pending = new Map<string, PendingDialog>()
  private message = 0
  private turnId = Math.random().toString(36).slice(2, 10)
  /** Tool calls started and not yet finished, by id, for linking approval dialogs to their call. */
  private running = new Map<string, { name: string; args: unknown }>()
  private usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
  private tokens = 0
  /** Replies to dialogs Studio cannot show; the adapter writes them to stdin. */
  autoReply: (obj: Json) => void = () => undefined

  constructor(
    private readonly sink: TurnSink,
    private readonly agent: string
  ) {}

  line(raw: string): void {
    const msg = parseJson(raw)
    if (!msg || this.settled) return
    switch (msg.type) {
      case 'response':
        return this.response(msg)
      case 'agent_start':
        this.started = true
        return
      case 'message_start':
        if (((msg.message ?? {}) as Json).role === 'assistant') this.message++
        return
      case 'message_update':
        return this.update(msg)
      case 'message_end':
        return this.messageEnd((msg.message ?? {}) as Json)
      case 'tool_execution_start':
        return this.toolStart(msg)
      case 'tool_execution_end':
        return this.toolEnd(msg)
      case 'extension_ui_request':
        return this.dialog(msg)
      case 'extension_error':
        this.sink.emit({ kind: 'notice', level: 'warning', text: `Extension error (${String(msg.event ?? '')}): ${String(msg.error ?? '')}` })
        return
      case 'auto_retry_end':
        if (msg.success === false && msg.finalError) this.sink.emit({ kind: 'notice', level: 'error', text: String(msg.finalError) })
        return
      // pi ends a prompt with agent_settled; oh-my-pi with prompt_result and session_settled.
      case 'agent_settled':
        return this.settle(Boolean(msg.aborted))
      case 'prompt_result':
        if (msg.id === PROMPT_ID) this.settle(msg.status === 'aborted' || msg.status === 'cancelled', msg.status === 'failed' || msg.status === 'error')
        return
      case 'session_settled':
        if (this.started) this.settle(false)
        return
      default:
        return
    }
  }

  private block(index: unknown, kind: string): string {
    return `${this.turnId}:${this.message}:${String(index ?? 0)}:${kind}`
  }

  private response(msg: Json): void {
    if (msg.success === false) {
      const text = String(msg.error ?? `${String(msg.command ?? 'command')} failed`)
      if (msg.id === PROMPT_ID) {
        this.sink.emit({ kind: 'notice', level: 'error', text })
        this.ok = false
        this.settle(false)
      }
      return
    }
    if (msg.id === STATE_ID) {
      const data = (msg.data ?? {}) as Json
      const model = (data.model ?? {}) as Json
      this.sessionId = String(data.sessionId ?? '')
      if (this.sessionId) this.sink.nativeSession(this.sessionId)
      this.sink.emit({
        kind: 'session.started',
        agent: this.agent,
        model: model.id ? `${String(model.provider ?? '')}/${String(model.id)}`.replace(/^\//, '') : undefined,
        nativeSessionId: this.sessionId || undefined,
        cwd: ''
      })
    } else if (msg.id === PROMPT_ID && ((msg.data ?? {}) as Json).disposition === 'handled') {
      // An extension command consumed the prompt; no run follows.
      this.settle(false)
    }
  }

  private update(msg: Json): void {
    const ev = (msg.assistantMessageEvent ?? {}) as Json
    if (ev.type === 'text_delta' && ev.delta) {
      this.sink.emit({ kind: 'assistant.delta', blockId: this.block(ev.contentIndex, 'text'), text: String(ev.delta) })
    } else if (ev.type === 'thinking_delta' && ev.delta) {
      this.sink.emit({ kind: 'assistant.delta', blockId: this.block(ev.contentIndex, 'thinking'), text: String(ev.delta), thinking: true })
    }
    const u = (msg.usage ?? {}) as Json
    const total = Number(u.totalTokens ?? 0)
    if (total) this.sink.emit({ kind: 'turn.progress', tokens: this.tokens + total })
  }

  private messageEnd(message: Json): void {
    if (message.role !== 'assistant') return
    const content = Array.isArray(message.content) ? (message.content as Json[]) : []
    content.forEach((block, i) => {
      if (block.type === 'text' && String(block.text ?? '').trim()) {
        this.sink.emit({ kind: 'assistant.text', blockId: this.block(i, 'text'), text: String(block.text) })
      } else if (block.type === 'thinking' && String(block.thinking ?? '').trim()) {
        this.sink.emit({ kind: 'thinking', blockId: this.block(i, 'thinking'), text: String(block.thinking) })
      }
    })
    const u = (message.usage ?? {}) as Json
    this.usage.inputTokens += Number(u.input ?? 0) + Number(u.cacheWrite ?? 0)
    this.usage.outputTokens += Number(u.output ?? 0)
    this.usage.cacheReadTokens += Number(u.cacheRead ?? 0)
    this.usage.costUsd += Number(((u.cost ?? {}) as Json).total ?? 0)
    this.tokens += Number(u.totalTokens ?? 0)
    if (message.stopReason === 'error' && message.errorMessage) {
      this.ok = false
      this.sink.emit({ kind: 'notice', level: 'error', text: String(message.errorMessage) })
    }
  }

  private toolStart(msg: Json): void {
    const callId = String(msg.toolCallId ?? '')
    const name = String(msg.toolName ?? 'tool')
    const args = msg.args ?? {}
    this.running.set(callId, { name, args })
    this.sink.emit({
      kind: 'tool.call',
      callId,
      name,
      toolKind: classifyTool(name),
      title: toolTitle(name, args) || String(msg.intent ?? ''),
      input: args
    })
    const todos = ((args ?? {}) as Json).todos
    if (classifyTool(name) === 'todo' && Array.isArray(todos)) {
      this.sink.emit({
        kind: 'todo.update',
        items: todos.map((t): TodoItem => {
          const item = t as Json
          const s = String(item.status ?? '')
          const status = s === 'completed' || s === 'done' ? 'completed' : s === 'in_progress' || s === 'active' ? 'in_progress' : 'pending'
          return { content: String(item.content ?? item.text ?? item.title ?? ''), status }
        })
      })
    }
  }

  private toolEnd(msg: Json): void {
    const callId = String(msg.toolCallId ?? '')
    this.running.delete(callId)
    const result = (msg.result ?? {}) as Json
    this.sink.emit({ kind: 'tool.result', callId, output: contentText(result.content ?? result), isError: Boolean(msg.isError) })
  }

  private dialog(msg: Json): void {
    const id = String(msg.id ?? '')
    const method = String(msg.method ?? '')
    if (method === 'notify') {
      const level = msg.notifyType === 'error' ? 'error' : msg.notifyType === 'warning' ? 'warning' : 'info'
      this.sink.emit({ kind: 'notice', level, text: String(msg.message ?? '') })
      return
    }
    if (method === 'input' || method === 'editor') {
      // Free text has no place in an approval card; the agent goes on as if dismissed.
      this.autoReply({ type: 'extension_ui_response', id, cancelled: true })
      return
    }
    if (method !== 'select' && method !== 'confirm') return
    const title = String(msg.title ?? '')
    const options = Array.isArray(msg.options) ? msg.options.map(String) : []
    // oh-my-pi asks "Allow tool: bash\nCommand: …" right after the call starts.
    const tool = /^Allow tool:\s*(\S+)/i.exec(title)?.[1]
    const call = [...this.running.entries()].reverse().find(([, c]) => !tool || c.name === tool)
    this.pending.set(id, { method, options })
    this.sink.emit({
      kind: 'permission.request',
      requestId: id,
      callId: tool ? call?.[0] : undefined,
      toolName: tool ?? call?.[1].name ?? 'dialog',
      title: tool && call ? toolTitle(call[1].name, call[1].args) || title : [title, msg.message].filter(Boolean).join('\n'),
      input: tool && call ? call[1].args : { question: title, message: msg.message, options }
    })
  }

  /** The `extension_ui_response` answering a pending dialog. */
  reply(requestId: string, allow: boolean, always?: boolean): Json | null {
    const d = this.pending.get(requestId)
    if (!d) return null
    this.pending.delete(requestId)
    if (d.method === 'confirm') return { type: 'extension_ui_response', id: requestId, confirmed: allow }
    const find = (re: RegExp): string | undefined => d.options.find((o) => re.test(o))
    const value = allow
      ? (always && find(/session|always/i)) || find(/^(approve|allow|yes|accept)/i) || d.options[0]
      : find(/^(deny|block|reject|decline|no)\b/i)
    return value === undefined ? { type: 'extension_ui_response', id: requestId, cancelled: true } : { type: 'extension_ui_response', id: requestId, value }
  }

  private settle(aborted: boolean, failed = false): void {
    if (this.settled) return
    this.settled = true
    this.aborted = aborted
    if (failed) this.ok = false
    this.sink.emit({
      kind: 'turn.completed',
      ok: this.ok && !aborted,
      usage: this.usage,
      summary: aborted ? 'interrupted' : undefined
    })
  }
}

const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Thinking levels a model accepts: oh-my-pi lists them; pi gives a map of changes to its default set. */
function modelEfforts(m: Json): string[] | undefined {
  const listed = ((m.thinking ?? {}) as Json).efforts
  if (Array.isArray(listed)) return listed.map(String)
  if (!m.reasoning) return undefined
  const levels = new Set(['off', 'minimal', 'low', 'medium', 'high'])
  for (const [k, v] of Object.entries((m.thinkingLevelMap ?? {}) as Json)) {
    if (v === null) levels.delete(k)
    else levels.add(k)
  }
  return EFFORTS.filter((e) => levels.has(e))
}

/** The `get_available_models` response as Studio's model list, grouped by provider. */
export function piModels(list: unknown, defaultEffort?: string): ModelInfo[] {
  if (!Array.isArray(list) || !list.length) return []
  const models = list.flatMap((raw): ModelInfo[] => {
    const m = raw as Json
    const id = String(m.id ?? '')
    const provider = String(m.provider ?? '')
    if (!id) return []
    const efforts = modelEfforts(m)
    return [
      {
        id: provider ? `${provider}/${id}` : id,
        label: String(m.name ?? id),
        model: id,
        group: provider || undefined,
        efforts: efforts?.length ? efforts : undefined,
        defaultEffort: efforts?.includes(defaultEffort ?? '') ? defaultEffort : undefined
      }
    ]
  })
  return [{ id: '', label: 'Default' }, ...models]
}

/** What differs between pi and oh-my-pi. */
interface PiFlavour {
  id: string
  name: string
  binary: string
  mode: 'rpc' | 'rpc-ui'
  /** Flags for the permission mode and project trust. */
  permission(mode: PermissionMode): string[]
  session(req: TurnRequest): string[]
  extra: string[]
  supportsApproval: boolean
  takesSessionId: boolean
  inspectArgs: string[]
}

export function piArgs(flavour: PiFlavour, req: TurnRequest): string[] {
  const args = ['--mode', flavour.mode, ...flavour.extra, ...flavour.permission(req.permissionMode), ...flavour.session(req)]
  if (req.model) args.push('--model', req.model)
  if (req.effort) args.push('--thinking', req.effort)
  if (req.systemAppend) args.push('--append-system-prompt', req.systemAppend)
  args.push(...splitArgs(req.settings.extraArgs))
  return args
}

function inspectPi(flavour: PiFlavour): (binary: string, env: NodeJS.ProcessEnv) => Promise<AgentInspection> {
  return (binary, env) => {
    let effort: string | undefined
    return askCli<AgentInspection>(
      binary,
      flavour.inspectArgs,
      env,
      (msg) => {
        if (msg.type !== 'response') return undefined
        const data = (msg.data ?? {}) as Json
        if (msg.id === 'state') effort = typeof data.thinkingLevel === 'string' ? data.thinkingLevel : undefined
        if (msg.id !== 'models') return undefined
        return { models: msg.success ? piModels(data.models, effort) : [] }
      },
      { first: [{ id: 'state', type: 'get_state' }, { id: 'models', type: 'get_available_models' }], timeoutMs: 20_000 }
    ).then((r) => r ?? { models: [] })
  }
}

function piAdapter(flavour: PiFlavour): AgentAdapter {
  const { id, name } = flavour
  return {
    id,
    name,
    binaryNames: [flavour.binary],
    route: 'RPC',
    supportsApproval: flavour.supportsApproval,
    supportsResume: true,
    takesSessionId: flavour.takesSessionId,
    systemPromptEachTurn: true,
    versionArgs: ['--version'],
    models: [{ id: '', label: 'Default' }],
    inspect: inspectPi(flavour),
    start(req: TurnRequest, sink: TurnSink): Turn {
      const parser = new PiRpcParser(sink, id)
      const { child, exited, kill } = spawnLines(req.binary, piArgs(flavour, req), req.cwd, req.env, (l) => {
        const was = parser.settled
        parser.line(l)
        // Settled: closing stdin asks for an orderly shutdown; a CLI that lingers is stopped.
        if (!was && parser.settled) {
          child.stdin.end()
          setTimeout(() => child.exitCode === null && kill('SIGTERM'), 4000)
          setTimeout(() => child.exitCode === null && kill('SIGKILL'), 8000)
        }
      })
      const send = (obj: Json): void => {
        if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(JSON.stringify(obj) + '\n')
      }
      parser.autoReply = send
      send({ id: STATE_ID, type: 'get_state' })
      send({ id: PROMPT_ID, type: 'prompt', message: req.prompt })

      let interrupted = false
      const done = exited.then(({ code, signal, stderr }) => {
        for (const requestId of parser.pending.keys()) sink.emit({ kind: 'permission.resolved', requestId, allow: false })
        parser.pending.clear()
        if (parser.settled) return
        if (!interrupted) {
          const tail = stderrTail(stderr)
          sink.emit({
            kind: 'notice',
            level: 'error',
            text: `${name} exited (${signal ?? code ?? 'unknown'})${tail ? `:\n${tail}` : ''}`,
            code: 'agentExited',
            vars: { agent: name, status: String(signal ?? code ?? '?'), tail }
          })
        }
        sink.emit({ kind: 'turn.completed', ok: false, summary: interrupted ? 'interrupted' : undefined })
      })

      return {
        interrupt() {
          interrupted = true
          for (const requestId of [...parser.pending.keys()]) {
            const reply = parser.reply(requestId, false)
            if (reply) send(reply)
            sink.emit({ kind: 'permission.resolved', requestId, allow: false })
          }
          send({ type: 'abort' })
          setTimeout(() => {
            if (child.exitCode === null) {
              child.stdin.end()
              kill('SIGTERM')
            }
          }, 5000)
          setTimeout(() => child.exitCode === null && kill('SIGKILL'), 9000)
        },
        respondPermission(requestId, allow, always) {
          const reply = parser.reply(requestId, allow, always)
          if (!reply) return
          send(reply)
          sink.emit({ kind: 'permission.resolved', requestId, allow, always })
        },
        done
      }
    }
  }
}

/**
 * pi has no approval step (tools run with the user's permissions); plan mode keeps it to the
 * read-only tools. `--approve` trusts the project's own resources, which is how pi loads the
 * skills Studio installs in `.agents/skills`.
 */
export const piAgentAdapter: AgentAdapter = piAdapter({
  id: 'pi',
  name: 'Pi',
  binary: 'pi',
  mode: 'rpc',
  permission: (mode) => (mode === 'plan' ? ['--tools', 'read,grep,find,ls'] : []),
  session: (req) =>
    req.ephemeral ? ['--no-session'] : req.resumeId ? ['--session-id', req.resumeId] : req.newSessionId ? ['--session-id', req.newSessionId] : [],
  extra: ['--approve'],
  supportsApproval: false,
  takesSessionId: true,
  inspectArgs: ['--mode', 'rpc', '--no-session', '--offline']
})

const OMP_APPROVAL: Record<PermissionMode, string> = {
  ask: 'always-ask',
  acceptEdits: 'write',
  plan: 'always-ask',
  bypass: 'yolo'
}

/**
 * oh-my-pi asks before tool calls through rpc-ui dialogs, per its approval mode. Its plan mode is
 * for the terminal only, so plan keeps it to the read-only tools.
 */
export const ompAdapter: AgentAdapter = piAdapter({
  id: 'omp',
  name: 'oh-my-pi',
  binary: 'omp',
  mode: 'rpc-ui',
  permission: (mode) => ['--approval-mode', OMP_APPROVAL[mode], ...(mode === 'plan' ? ['--tools', 'read,glob,grep,web_search,todo'] : [])],
  session: (req) => (req.ephemeral ? ['--no-session'] : req.resumeId ? ['--resume', req.resumeId] : []),
  // Not --no-ui: that also turns off the tool approval dialogs.
  extra: ['--no-title'],
  supportsApproval: true,
  takesSessionId: false,
  inspectArgs: ['--mode', 'rpc', '--no-session', '--no-title']
})
