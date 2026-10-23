import { randomUUID } from 'node:crypto'
import type { Connector, FileChange, ModelInfo, PermissionMode, SessionEventBody, TodoItem, ToolKind } from '@shared/types'
import {
  classifyTool,
  parseJson,
  SIGN_IN_PROMPT,
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

/** ACP's tool kinds as Studio's. */
const KINDS: Record<string, ToolKind> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  search: 'search',
  execute: 'shell',
  fetch: 'web',
  think: 'other',
  switch_mode: 'other'
}

const CHANGING = new Set(['edit', 'delete', 'move', 'execute'])
const READING = new Set(['read', 'search', 'fetch', 'think'])

function blockText(content: unknown): string {
  const c = (content ?? {}) as Json
  if (c.type === 'text') return String(c.text ?? '')
  if (c.type === 'resource_link') return String(c.uri ?? c.name ?? '')
  if (c.type === 'resource') return String(((c.resource ?? {}) as Json).text ?? '')
  return ''
}

/** Text, diffs and terminal ids of a tool call's `content`, as one output string. */
function toolOutput(content: unknown, raw: unknown): string {
  const parts = (Array.isArray(content) ? (content as Json[]) : []).map((c) => {
    if (c.type === 'content') return blockText(c.content)
    if (c.type === 'diff') return `${String(c.path ?? '')} (edited)`
    return ''
  })
  const text = parts.filter(Boolean).join('\n')
  if (text) return text
  if (typeof raw === 'string') return raw
  return raw == null ? '' : JSON.stringify(raw)
}

function diffs(content: unknown): FileChange[] {
  return (Array.isArray(content) ? (content as Json[]) : [])
    .filter((c) => c.type === 'diff' && c.path)
    .map((c) => ({ path: String(c.path), kind: c.oldText == null ? 'add' : 'update' }))
}

export interface AcpPermissionOption {
  optionId: string
  name?: string
  kind?: string
}

/**
 * Turns ACP `session/update` notifications into normalized events. Kept free of process handling
 * so it can be tested against recorded streams.
 */
export class AcpUpdateParser {
  private block: { id: string; kind: 'text' | 'thinking'; text: string } | null = null
  private calls = new Map<string, { kind: string; done: boolean }>()
  /** While `session/load` replays history, updates describe earlier turns and are skipped. */
  muted = false

  constructor(private readonly sink: TurnSink) {}

  /** Finish the text or thought being streamed, so the next one starts a new block. */
  flush(): void {
    const b = this.block
    this.block = null
    if (!b || !b.text.trim()) return
    if (b.kind === 'text') this.sink.emit({ kind: 'assistant.text', blockId: b.id, text: b.text })
    else this.sink.emit({ kind: 'thinking', blockId: b.id, text: b.text })
  }

  private chunk(kind: 'text' | 'thinking', content: unknown): void {
    const text = blockText(content)
    if (!text) return
    if (this.block?.kind !== kind) {
      this.flush()
      this.block = { id: randomUUID(), kind, text: '' }
    }
    this.block!.text += text
    this.sink.emit({ kind: 'assistant.delta', blockId: this.block!.id, text, thinking: kind === 'thinking' || undefined })
  }

  /** Announce a tool call (once) from a `tool_call`, `tool_call_update` or permission request. */
  call(u: Json): void {
    const callId = String(u.toolCallId ?? '')
    if (!callId || this.calls.has(callId)) return
    this.flush()
    const kind = String(u.kind ?? 'other')
    const title = String(u.title ?? '')
    const locations = Array.isArray(u.locations) ? (u.locations as Json[]) : []
    const raw = (u.rawInput ?? {}) as Json
    // Paths from `locations` let Studio record new versions of the files an edit touched.
    const input = locations[0]?.path && !raw.path && !raw.file_path ? { ...raw, path: String(locations[0].path) } : raw
    const toolKind = KINDS[kind] ?? (title ? classifyTool(title) : 'other')
    this.calls.set(callId, { kind, done: false })
    const changes = diffs(u.content)
    this.sink.emit({
      kind: 'tool.call',
      callId,
      name: kind,
      toolKind,
      title: title || toolTitle(kind, input),
      input,
      changes: changes.length ? changes : undefined
    })
  }

  private callUpdate(u: Json): void {
    this.call(u)
    const callId = String(u.toolCallId ?? '')
    const call = this.calls.get(callId)
    if (!call || call.done || (u.status !== 'completed' && u.status !== 'failed')) return
    call.done = true
    this.sink.emit({ kind: 'tool.result', callId, output: toolOutput(u.content, u.rawOutput), isError: u.status === 'failed' })
  }

  update(u: Json): void {
    if (this.muted) return
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        return this.chunk('text', u.content)
      case 'agent_thought_chunk':
        return this.chunk('thinking', u.content)
      case 'tool_call':
      case 'tool_call_update':
        return this.callUpdate(u)
      case 'plan': {
        const entries = Array.isArray(u.entries) ? (u.entries as Json[]) : []
        this.sink.emit({
          kind: 'todo.update',
          items: entries.map((e): TodoItem => {
            const s = e.status
            return { content: String(e.content ?? ''), status: s === 'completed' || s === 'in_progress' ? s : 'pending' }
          })
        })
        return
      }
      case 'usage_update': {
        const used = Number(u.used ?? 0)
        if (used) this.sink.emit({ kind: 'turn.progress', tokens: used })
        return
      }
      default:
        return
    }
  }

  /** Close tool calls the agent never finished (an interrupted turn). */
  close(): void {
    this.flush()
    for (const [callId, call] of this.calls) {
      if (!call.done) this.sink.emit({ kind: 'tool.result', callId, output: '', isError: true })
      call.done = true
    }
  }

  kindOf(callId: string): string | undefined {
    return this.calls.get(callId)?.kind
  }
}

/** The option that answers a permission request: allow once or always, reject, or none (cancelled). */
export function permissionOption(options: AcpPermissionOption[], allow: boolean, always?: boolean): string | undefined {
  const of = (kind: string): string | undefined => options.find((o) => o.kind === kind)?.optionId
  if (allow) return (always && of('allow_always')) || of('allow_once') || of('allow_always')
  return of('reject_once') || of('reject_always')
}

interface AcpMode {
  id: string
  name?: string
}

const MODE_PATTERNS: Record<PermissionMode, RegExp> = {
  ask: /^(default|ask|manual|normal|build|code|agent)\b/i,
  acceptEdits: /accept.?edits?|auto.?edit/i,
  plan: /plan|read.?only/i,
  bypass: /yolo|bypass|full.?access|dangerous|skip.?permissions|trust/i
}

/** The agent's own session mode for a Studio permission mode, matched by id or name. */
export function pickMode(modes: AcpMode[], perm: PermissionMode): string | undefined {
  const re = MODE_PATTERNS[perm]
  return modes.find((m) => re.test(m.id) || re.test(m.name ?? ''))?.id
}

/**
 * Studio's answer to a permission request without asking, for the permission mode: full autonomy
 * allows everything, accept-edits allows edits, plan allows reading and declines anything that
 * changes files or runs commands. `undefined` asks the user.
 */
export function autoDecision(perm: PermissionMode, kind: string | undefined): boolean | undefined {
  if (perm === 'bypass') return true
  if (perm === 'acceptEdits' && (kind === 'edit' || kind === 'delete' || kind === 'move')) return true
  if (perm === 'plan' && kind && CHANGING.has(kind)) return false
  if (perm === 'plan' && kind && READING.has(kind)) return true
  return undefined
}

/** Studio's MCP connectors in ACP's `McpServer` shape. Remote servers only for agents that take HTTP. */
export function acpMcpServers(connectors: Connector[] | undefined, http: boolean): Json[] {
  return (connectors ?? []).flatMap((c): Json[] => {
    if (c.command) {
      return [{ name: c.id, command: c.command, args: c.args ?? [], env: Object.entries(c.env ?? {}).map(([name, value]) => ({ name, value })) }]
    }
    if (c.url && http) return [{ type: 'http', name: c.id, url: c.url, headers: [] }]
    return []
  })
}

/** Models an ACP agent offered in an earlier session, by agent id; ACP has no model list without a session. */
const learnedModels = new Map<string, ModelInfo[]>()

function modelsFrom(session: Json): ModelInfo[] {
  const models = (session.models ?? {}) as Json
  const list = Array.isArray(models.availableModels) ? (models.availableModels as Json[]) : []
  const out: ModelInfo[] = list.flatMap((m) =>
    m.modelId ? [{ id: String(m.modelId), label: String(m.name ?? m.modelId), description: typeof m.description === 'string' ? m.description : undefined }] : []
  )
  if (!out.length) {
    // Newer agents describe the model as a session config option instead.
    const opt = (Array.isArray(session.configOptions) ? (session.configOptions as Json[]) : []).find((o) => o.category === 'model')
    const values = Array.isArray(opt?.options) ? (opt!.options as Json[]) : []
    for (const v of values) if (v.value) out.push({ id: String(v.value), label: String(v.name ?? v.value) })
  }
  return out.length ? [{ id: '', label: 'Default' }, ...out] : []
}

function configOption(session: Json, category: string): Json | undefined {
  return (Array.isArray(session.configOptions) ? (session.configOptions as Json[]) : []).find((o) => o.category === category)
}

interface RpcError extends Error {
  code?: number
}

export function acpAdapter(spec: { id: string; name: string; bins: string[]; acpArgs: string[] }): AgentAdapter {
  const { id, name } = spec
  return {
    id,
    name,
    binaryNames: spec.bins,
    route: 'ACP',
    supportsApproval: true,
    supportsResume: true,
    // A binary that is only an ACP server (vibe-acp) would start serving instead of printing a version.
    versionArgs: spec.acpArgs.length ? ['--version'] : [],
    models: [{ id: '', label: 'Default' }],
    inspect: async (): Promise<AgentInspection> => ({ models: learnedModels.get(id) ?? [] }),
    start(req: TurnRequest, sink: TurnSink): Turn {
      const parser = new AcpUpdateParser(sink)
      let nextId = 1
      const waiting = new Map<number, { resolve(v: Json): void; reject(e: RpcError): void }>()
      /** Permission requests waiting for the user, by Studio request id. */
      const pending = new Map<string, { rpcId: unknown; options: AcpPermissionOption[] }>()
      let sessionId = ''
      let finished = false
      let interrupted = false
      let failure: string | null = null

      const reply = (rpcId: unknown, result: Json): void => send({ jsonrpc: '2.0', id: rpcId, result })
      const answer = (rpcId: unknown, options: AcpPermissionOption[], allow: boolean, always?: boolean): void => {
        const optionId = permissionOption(options, allow, always)
        reply(rpcId, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
      }

      const onRequest = (msg: Json): void => {
        const method = String(msg.method)
        const params = (msg.params ?? {}) as Json
        if (method === 'session/request_permission') {
          const toolCall = (params.toolCall ?? {}) as Json
          parser.call(toolCall)
          const options = (Array.isArray(params.options) ? params.options : []) as AcpPermissionOption[]
          const callId = String(toolCall.toolCallId ?? '')
          const kind = typeof toolCall.kind === 'string' ? toolCall.kind : parser.kindOf(callId)
          const auto = autoDecision(req.permissionMode, kind)
          if (auto !== undefined || interrupted) {
            answer(msg.id, options, auto === true && !interrupted)
            return
          }
          const requestId = randomUUID()
          pending.set(requestId, { rpcId: msg.id, options })
          const input = toolCall.rawInput ?? {}
          const title = String(toolCall.title ?? '')
          sink.emit({
            kind: 'permission.request',
            requestId,
            callId: callId || undefined,
            toolName: kind ?? 'tool',
            title: title || toolTitle(kind ?? 'tool', input),
            input
          })
          return
        }
        // Studio offers no client file system or terminal; the agent uses its own tools.
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${method} is not supported by Mathodology Studio` } })
      }

      const onLine = (line: string): void => {
        const msg = parseJson(line)
        if (!msg) return
        if (msg.method && msg.id !== undefined) return onRequest(msg)
        if (msg.method === 'session/update') {
          const params = (msg.params ?? {}) as Json
          if (!sessionId || params.sessionId === sessionId || !params.sessionId) parser.update((params.update ?? {}) as Json)
          return
        }
        if (msg.method) return
        const w = waiting.get(Number(msg.id))
        if (!w) return
        waiting.delete(Number(msg.id))
        if (msg.error) {
          const e = (msg.error ?? {}) as Json
          const err: RpcError = new Error(String(e.message ?? 'request failed'))
          err.code = Number(e.code)
          const data = e.data
          if (data && typeof data === 'object' && (data as Json).details) err.message += `: ${String((data as Json).details)}`
          else if (typeof data === 'string') err.message += `: ${data}`
          w.reject(err)
        } else w.resolve((msg.result ?? {}) as Json)
      }

      const { child, exited, kill } = spawnLines(req.binary, [...spec.acpArgs, ...splitArgs(req.settings.extraArgs)], req.cwd, req.env, onLine)
      const send = (obj: Json): void => {
        if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(JSON.stringify(obj) + '\n')
      }
      const call = (method: string, params: Json): Promise<Json> =>
        new Promise((resolve, reject) => {
          const rpcId = nextId++
          waiting.set(rpcId, { resolve, reject })
          send({ jsonrpc: '2.0', id: rpcId, method, params })
        })

      const finish = (body: Extract<SessionEventBody, { kind: 'turn.completed' }>): void => {
        if (finished) return
        finished = true
        parser.close()
        sink.emit(body)
        child.stdin.end()
        setTimeout(() => child.exitCode === null && kill('SIGTERM'), 3000)
        setTimeout(() => child.exitCode === null && kill('SIGKILL'), 7000)
      }

      const run = async (): Promise<void> => {
        const init = await call('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'mathodology-studio', title: 'Mathodology Studio', version: '0.1.0' }
        })
        const caps = (init.agentCapabilities ?? {}) as Json
        const mcp = (caps.mcpCapabilities ?? {}) as Json
        const sessionCaps = (caps.sessionCapabilities ?? {}) as Json
        const mcpServers = acpMcpServers(req.mcpServers, Boolean(mcp.http))
        const base = { cwd: req.cwd, mcpServers }

        let session: Json | null = null
        let resumed = false
        if (req.resumeId) {
          try {
            if (sessionCaps.resume) {
              session = await call('session/resume', { ...base, sessionId: req.resumeId })
            } else if (caps.loadSession) {
              // Loading replays the conversation as updates, which the transcript already has.
              parser.muted = true
              session = await call('session/load', { ...base, sessionId: req.resumeId })
            }
            if (session) {
              sessionId = req.resumeId
              resumed = true
            }
          } catch {
            session = null
          } finally {
            parser.muted = false
          }
          if (!resumed) {
            sink.emit({
              kind: 'notice',
              level: 'info',
              text: 'The agent could not find the previous conversation; this message starts a new one.',
              code: 'resumeReset'
            })
          }
        }
        if (!session) {
          session = await call('session/new', base)
          sessionId = String(session.sessionId ?? '')
        }
        if (sessionId) sink.nativeSession(sessionId)
        const offered = modelsFrom(session)
        if (offered.length) learnedModels.set(id, offered)

        // The agent's own mode for the permission mode, its model and its reasoning level.
        const modes = (session.modes ?? {}) as Json
        const available = (Array.isArray(modes.availableModes) ? modes.availableModes : []) as AcpMode[]
        const modeId = pickMode(available, req.permissionMode)
        if (modeId && modeId !== modes.currentModeId) await call('session/set_mode', { sessionId, modeId }).catch(() => undefined)
        const modelOption = configOption(session, 'model')
        if (req.model) {
          if (modelOption) await call('session/set_config_option', { sessionId, configId: modelOption.id, value: req.model }).catch(() => undefined)
          else await call('session/set_model', { sessionId, modelId: req.model }).catch(() => undefined)
        }
        const effortOption = configOption(session, 'thought_level')
        if (req.effort && effortOption) await call('session/set_config_option', { sessionId, configId: effortOption.id, value: req.effort }).catch(() => undefined)

        const current = (session.models ?? {}) as Json
        sink.emit({
          kind: 'session.started',
          agent: id,
          model: req.model || (typeof current.currentModelId === 'string' ? current.currentModelId : undefined),
          nativeSessionId: sessionId || undefined,
          cwd: req.cwd
        })

        // ACP has no system prompt; Studio's note leads the first message of a conversation.
        const text = req.systemAppend && !resumed ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt
        const started = Date.now()
        const result = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
        const stop = String(result.stopReason ?? 'end_turn')
        if (stop === 'refusal') sink.emit({ kind: 'notice', level: 'warning', text: `${name} declined to continue.` })
        if (stop === 'max_tokens' || stop === 'max_turn_requests') sink.emit({ kind: 'notice', level: 'warning', text: `${name} stopped early (${stop}).` })
        const u = (result.usage ?? {}) as Json
        finish({
          kind: 'turn.completed',
          ok: stop !== 'cancelled' && stop !== 'refusal',
          durationMs: Date.now() - started,
          summary: stop === 'cancelled' ? 'interrupted' : undefined,
          usage: result.usage
            ? {
                inputTokens: Number(u.inputTokens ?? 0),
                outputTokens: Number(u.outputTokens ?? 0) + Number(u.thoughtTokens ?? 0),
                cacheReadTokens: Number(u.cachedReadTokens ?? 0)
              }
            : undefined
        })
      }

      run().catch((err: RpcError) => {
        if (finished) return
        failure = err.message
        // -32000 is ACP's "authentication required".
        if (err.code === -32000 || SIGN_IN_PROMPT.test(err.message)) {
          sink.emit({
            kind: 'notice',
            level: 'warning',
            text: `${name} needs you to sign in. Run \`${spec.bins[0]}\` once in a terminal, then try again.`,
            code: 'signIn',
            vars: { agent: name, command: spec.bins[0], env: 'API key' }
          })
        } else if (!interrupted) {
          sink.emit({ kind: 'notice', level: 'error', text: `${name}: ${err.message}` })
        }
        finish({ kind: 'turn.completed', ok: false, summary: interrupted ? 'interrupted' : undefined })
      })

      const done = exited.then(({ code, signal, stderr }) => {
        for (const requestId of pending.keys()) sink.emit({ kind: 'permission.resolved', requestId, allow: false })
        pending.clear()
        for (const w of waiting.values()) w.reject(new Error('exited'))
        waiting.clear()
        if (finished) return
        if (!interrupted) {
          const tail = failure ?? stderrTail(stderr)
          sink.emit({
            kind: 'notice',
            level: 'error',
            text: `${name} exited (${signal ?? code ?? 'unknown'})${tail ? `:\n${tail}` : ''}`,
            code: 'agentExited',
            vars: { agent: name, status: String(signal ?? code ?? '?'), tail }
          })
        }
        finished = true
        parser.close()
        sink.emit({ kind: 'turn.completed', ok: false, summary: interrupted ? 'interrupted' : undefined })
      })

      return {
        interrupt() {
          interrupted = true
          for (const [requestId, p] of pending) {
            reply(p.rpcId, { outcome: { outcome: 'cancelled' } })
            sink.emit({ kind: 'permission.resolved', requestId, allow: false })
          }
          pending.clear()
          if (sessionId) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
          setTimeout(() => {
            if (child.exitCode === null) {
              child.stdin.end()
              kill('SIGTERM')
            }
          }, 5000)
          setTimeout(() => child.exitCode === null && kill('SIGKILL'), 9000)
        },
        respondPermission(requestId, allow, always) {
          const p = pending.get(requestId)
          if (!p) return
          pending.delete(requestId)
          answer(p.rpcId, p.options, allow, always)
          sink.emit({ kind: 'permission.resolved', requestId, allow, always })
        },
        done
      }
    }
  }
}
