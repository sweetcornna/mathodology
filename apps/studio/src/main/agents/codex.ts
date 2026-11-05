import type { AgentAccount, AgentQuestion, FileChange, ModelInfo, PermissionMode, SessionEventBody, TodoItem, Usage } from '@shared/types'
import {
  askCli,
  cleanAnswers,
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
import { execCli } from './launch'

type Json = Record<string, unknown>

/**
 * Codex runs through `codex app-server` (JSON-RPC over stdio): unlike `exec --json` it streams
 * message deltas and pauses for approval requests.
 */
const POLICY: Record<PermissionMode, { sandbox: string; approvalPolicy: string }> = {
  ask: { sandbox: 'workspace-write', approvalPolicy: 'untrusted' },
  acceptEdits: { sandbox: 'workspace-write', approvalPolicy: 'on-request' },
  plan: { sandbox: 'read-only', approvalPolicy: 'never' },
  bypass: { sandbox: 'danger-full-access', approvalPolicy: 'never' }
}

export function codexArgs(req: TurnRequest): string[] {
  return [
    'app-server',
    '-c',
    'sandbox_workspace_write.network_access=true',
    '-c',
    'tools.update_plan.enabled=true',
    '-c',
    'model_reasoning_summary="detailed"',
    // Lets the model ask through request_user_input (a question card) outside plan mode too.
    '-c',
    'features.default_mode_request_user_input=true',
    ...splitArgs(req.settings.extraArgs)
  ]
}

function changesOf(item: Json): FileChange[] {
  const list = Array.isArray(item.changes) ? (item.changes as Json[]) : []
  return list.map((c) => {
    const kind = ((c.kind ?? {}) as Json).type ?? c.kind
    return {
      path: String(c.path ?? ''),
      kind: kind === 'add' || kind === 'delete' ? kind : 'update',
      diff: typeof c.diff === 'string' ? c.diff : undefined
    }
  })
}

/** request_user_input questions. Codex keys the answers by question id. */
export function codexQuestions(p: Json): AgentQuestion[] {
  const list = Array.isArray(p.questions) ? (p.questions as Json[]) : []
  return list.flatMap((q): AgentQuestion[] => {
    const question = String(q?.question ?? '')
    if (!question) return []
    const options = (Array.isArray(q.options) ? (q.options as Json[]) : [])
      .map((o) => ({ label: String(o?.label ?? ''), description: typeof o?.description === 'string' && o.description ? o.description : undefined }))
      .filter((o) => o.label)
    return [
      {
        id: String(q.id ?? question),
        question,
        header: typeof q.header === 'string' && q.header ? q.header : undefined,
        options,
        allowOther: q.isOther === true || options.length === 0,
        secret: q.isSecret === true
      }
    ]
  })
}

function planStatus(s: unknown): TodoItem['status'] {
  return s === 'completed' ? 'completed' : s === 'inProgress' || s === 'in_progress' ? 'in_progress' : 'pending'
}

export interface CodexServerRequest {
  id: number | string
  method: string
  params: Json
}

/**
 * Maps app-server notifications and server requests to normalized events. Process and JSON-RPC
 * plumbing live in the adapter, so this can be fed recorded frames in tests.
 */
export class CodexAppServerParser {
  turnId = ''
  threadId = ''
  done = false
  readonly pending = new Map<string, CodexServerRequest>()
  private items = new Map<string, Json>()
  private usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

  constructor(private readonly sink: TurnSink) {}

  private emit(body: SessionEventBody): void {
    this.sink.emit(body)
  }

  /** Keep file details for approvals, including child calls that are not shown in the transcript. */
  rememberFileChange(item: Json): void {
    if (item.type === 'fileChange') this.items.set(String(item.id ?? ''), item)
  }

  notification(method: string, p: Json): void {
    // Approval requests can belong to a child agent, so resolve them even though its ordinary
    // notifications do not belong in the main conversation.
    if (method === 'serverRequest/resolved') {
      const id = String(p.requestId ?? p.id ?? '')
      if (this.pending.delete(id)) this.emit({ kind: 'permission.resolved', requestId: id, allow: false })
      return
    }
    if (this.done) return
    if (method === 'item/started') this.rememberFileChange((p.item ?? {}) as Json)
    // app-server also emits events for spawned agents. A child's completion must never close
    // the parent's connection, replace its plan, or change the turn targeted by interrupt().
    if (this.threadId && p.threadId !== this.threadId) return
    const eventTurnId = p.turnId ?? ((method === 'turn/started' || method === 'turn/completed') ? (p.turn as Json | undefined)?.id : undefined)
    if (this.turnId && eventTurnId !== undefined && eventTurnId !== this.turnId) return
    switch (method) {
      case 'turn/started':
        this.turnId = String(((p.turn ?? {}) as Json).id ?? this.turnId)
        return
      case 'item/agentMessage/delta':
        this.emit({ kind: 'assistant.delta', blockId: String(p.itemId), text: String(p.delta ?? '') })
        return
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.emit({ kind: 'assistant.delta', blockId: `${String(p.itemId)}:r`, text: String(p.delta ?? ''), thinking: true })
        return
      case 'item/reasoning/summaryPartAdded':
        this.emit({ kind: 'assistant.delta', blockId: `${String(p.itemId)}:r`, text: '\n\n', thinking: true })
        return
      case 'item/commandExecution/outputDelta':
        this.emit({ kind: 'tool.output', callId: String(p.itemId), chunk: String(p.delta ?? '') })
        return
      case 'item/started':
        return this.itemStarted((p.item ?? {}) as Json)
      case 'item/completed':
        return this.itemCompleted((p.item ?? {}) as Json)
      case 'turn/plan/updated': {
        const plan = Array.isArray(p.plan) ? (p.plan as Json[]) : []
        this.emit({ kind: 'todo.update', items: plan.map((s) => ({ content: String(s.step ?? ''), status: planStatus(s.status) })) })
        return
      }
      case 'thread/tokenUsage/updated': {
        const last = (((p.tokenUsage ?? {}) as Json).last ?? {}) as Json
        this.usage.inputTokens += Number(last.inputTokens ?? 0) - Number(last.cachedInputTokens ?? 0)
        this.usage.cacheReadTokens += Number(last.cachedInputTokens ?? 0)
        this.usage.outputTokens += Number(last.outputTokens ?? 0)
        this.emit({
          kind: 'turn.progress',
          tokens: this.usage.inputTokens + this.usage.cacheReadTokens + this.usage.outputTokens
        })
        return
      }
      case 'error': {
        const err = (p.error ?? {}) as Json
        this.emit({ kind: 'notice', level: p.willRetry ? 'warning' : 'error', text: String(err.message ?? 'Codex error') })
        return
      }
      case 'turn/completed': {
        const turn = (p.turn ?? {}) as Json
        const status = String(turn.status ?? 'completed')
        const err = turn.error as Json | null
        if (status === 'failed' && err) this.emit({ kind: 'notice', level: 'error', text: String(err.message ?? 'Codex turn failed') })
        this.done = true
        this.emit({
          kind: 'turn.completed',
          ok: status === 'completed',
          durationMs: Number(turn.durationMs ?? 0) || undefined,
          usage: { ...this.usage },
          summary: status === 'interrupted' ? 'interrupted' : undefined
        })
        return
      }
      default:
        return
    }
  }

  private itemStarted(item: Json): void {
    const id = String(item.id ?? '')
    this.items.set(id, item)
    switch (item.type) {
      case 'commandExecution':
        this.emit({ kind: 'tool.call', callId: id, name: 'shell', toolKind: 'shell', title: toolTitle('shell', { command: item.command }), input: { command: item.command, cwd: item.cwd } })
        return
      case 'fileChange': {
        const changes = changesOf(item)
        this.emit({
          kind: 'tool.call',
          callId: id,
          name: 'apply_patch',
          toolKind: 'edit',
          title: changes.map((c) => c.path.split(/[\\/]/).pop()).join(', ') || 'files',
          input: { changes: changes.map(({ path, kind }) => ({ path, kind })) },
          changes
        })
        return
      }
      case 'mcpToolCall': {
        const name = `mcp__${String(item.server ?? 'mcp')}__${String(item.tool ?? 'tool')}`
        this.emit({ kind: 'tool.call', callId: id, name, toolKind: 'mcp', title: toolTitle(name, item.arguments), input: item.arguments ?? {} })
        return
      }
      case 'webSearch':
        this.emit({ kind: 'tool.call', callId: id, name: 'web_search', toolKind: 'web', title: String(item.query ?? ''), input: { query: item.query } })
        return
      case 'collabAgentToolCall':
        this.emit({ kind: 'tool.call', callId: id, name: 'Task', toolKind: 'task', title: String(item.prompt ?? item.tool ?? 'agent').slice(0, 80), input: { tool: item.tool, prompt: item.prompt } })
        return
      default:
        return
    }
  }

  private itemCompleted(item: Json): void {
    const id = String(item.id ?? '')
    switch (item.type) {
      case 'agentMessage':
        if (String(item.text ?? '').trim()) this.emit({ kind: 'assistant.text', blockId: id, text: String(item.text) })
        return
      case 'reasoning': {
        const parts = [...((item.summary as string[]) ?? []), ...((item.content as string[]) ?? [])].filter(Boolean)
        if (parts.length) this.emit({ kind: 'thinking', blockId: `${id}:r`, text: parts.join('\n\n') })
        return
      }
      case 'commandExecution': {
        if (!this.items.has(id)) this.itemStarted(item)
        const exit = item.exitCode
        this.emit({
          kind: 'tool.result',
          callId: id,
          output: String(item.aggregatedOutput ?? ''),
          isError: item.status === 'failed' || item.status === 'declined' || (typeof exit === 'number' && exit !== 0)
        })
        return
      }
      case 'fileChange': {
        if (!this.items.has(id)) this.itemStarted(item)
        const changes = changesOf(item)
        this.emit({
          kind: 'tool.result',
          callId: id,
          output: changes.map((c) => c.diff || `${c.kind} ${c.path}`).join('\n'),
          isError: item.status === 'failed' || item.status === 'declined'
        })
        return
      }
      case 'mcpToolCall': {
        if (!this.items.has(id)) this.itemStarted(item)
        const error = item.error as Json | null
        const result = item.result as Json | null
        const text = Array.isArray(result?.content)
          ? (result!.content as Json[]).map((c) => (c.type === 'text' ? String(c.text ?? '') : JSON.stringify(c))).join('\n')
          : ''
        this.emit({ kind: 'tool.result', callId: id, output: error ? String(error.message ?? 'error') : text, isError: Boolean(error) })
        return
      }
      case 'webSearch':
      case 'collabAgentToolCall':
        if (!this.items.has(id)) this.itemStarted(item)
        this.emit({ kind: 'tool.result', callId: id, output: '', isError: item.status === 'failed' })
        return
      default:
        return
    }
  }

  /** A server→client request. Returns a JSON-RPC result to send at once, or null to wait for the user. */
  request(req: CodexServerRequest): unknown | null {
    const p = req.params
    const requestId = String(req.id)
    switch (req.method) {
      case 'item/commandExecution/requestApproval':
      case 'execCommandApproval': {
        const command = Array.isArray(p.command) ? (p.command as string[]).join(' ') : String(p.command ?? '')
        this.pending.set(requestId, req)
        this.emit({
          kind: 'permission.request',
          requestId,
          callId: p.itemId ? String(p.itemId) : undefined,
          toolName: 'shell',
          title: command || String(p.reason ?? ''),
          input: { command, cwd: p.cwd, reason: p.reason }
        })
        return null
      }
      case 'item/fileChange/requestApproval':
      case 'applyPatchApproval': {
        const item = this.items.get(String(p.itemId ?? '')) ?? {}
        const changes = changesOf(item)
        this.pending.set(requestId, req)
        this.emit({
          kind: 'permission.request',
          requestId,
          callId: p.itemId ? String(p.itemId) : undefined,
          toolName: 'apply_patch',
          title: changes.map((c) => c.path.split(/[\\/]/).pop()).join(', ') || String(p.reason ?? 'files'),
          input: { changes: changes.map((c) => ({ path: c.path, kind: c.kind })), reason: p.reason, grantRoot: p.grantRoot }
        })
        return null
      }
      case 'item/tool/requestUserInput': {
        const questions = codexQuestions(p)
        if (!questions.length) return { answers: {} }
        this.pending.set(requestId, req)
        this.emit({
          kind: 'permission.request',
          requestId,
          callId: p.itemId ? String(p.itemId) : undefined,
          toolName: 'request_user_input',
          title: questions[0].question,
          input: { questions: p.questions },
          questions
        })
        return null
      }
      case 'item/permissions/requestApproval':
        return { decision: 'decline' }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      default:
        return undefined
    }
  }

  /** The JSON-RPC result answering a pending approval or question. */
  decision(requestId: string, allow: boolean, always?: boolean, answers?: Record<string, string[]>): { id: number | string; result: unknown } | null {
    const req = this.pending.get(requestId)
    if (!req) return null
    this.pending.delete(requestId)
    if (req.method === 'item/tool/requestUserInput') {
      const given = allow ? cleanAnswers(answers) : {}
      return { id: req.id, result: { answers: Object.fromEntries(Object.entries(given).map(([id, list]) => [id, { answers: list }])) } }
    }
    const legacy = req.method === 'execCommandApproval' || req.method === 'applyPatchApproval'
    const decision = legacy
      ? allow
        ? always
          ? 'approved_for_session'
          : 'approved'
        : 'denied'
      : allow
        ? always
          ? 'acceptForSession'
          : 'accept'
        : 'decline'
    return { id: req.id, result: { decision } }
  }
}

/** "Claude Opus 5.5 · OpenASI · routing group" → label "Claude Opus 5.5", group "OpenASI · routing group". */
function splitGroup(name: string): { label: string; group?: string } {
  const at = name.indexOf(' · ')
  return at < 0 ? { label: name } : { label: name.slice(0, at), group: name.slice(at + 3) }
}

/** Models from app-server `model/list`, or the same catalogue from `codex debug models`. */
export function codexModels(list: unknown): ModelInfo[] {
  if (!Array.isArray(list)) return []
  const models = list.flatMap((raw): ModelInfo[] => {
    const m = raw as Json
    const id = String(m.model ?? m.id ?? m.slug ?? '')
    if (!id || m.hidden === true || (m.visibility !== undefined && m.visibility !== 'list')) return []
    const efforts = ((m.supportedReasoningEfforts ?? m.supported_reasoning_levels ?? []) as Json[])
      .map((e) => String(e.reasoningEffort ?? e.effort ?? ''))
      .filter(Boolean)
    const defaultEffort = m.defaultReasoningEffort ?? m.default_reasoning_level
    return [
      {
        id,
        ...splitGroup(String(m.displayName ?? m.display_name ?? id)),
        description: typeof m.description === 'string' && m.description ? m.description : undefined,
        efforts: efforts.length ? efforts : undefined,
        defaultEffort: typeof defaultEffort === 'string' ? defaultEffort : undefined
      }
    ]
  })
  const preferred = list.find((m) => (m as Json).isDefault === true) as Json | undefined
  const fallback = models.find((m) => m.id === String(preferred?.model ?? preferred?.id ?? '')) ?? models[0]
  const base: ModelInfo = { id: '', label: 'Default', model: fallback?.id, description: fallback?.label }
  if (fallback?.efforts) Object.assign(base, { efforts: fallback.efforts, defaultEffort: fallback.defaultEffort })
  return [base, ...models]
}

function codexAccount(raw: unknown): AgentAccount | undefined {
  const a = (raw ?? {}) as Json
  if (a.type === 'chatgpt') {
    const plan = typeof a.planType === 'string' ? a.planType.charAt(0).toUpperCase() + a.planType.slice(1) : ''
    return { plan: plan ? `ChatGPT ${plan}` : 'ChatGPT', email: typeof a.email === 'string' ? a.email : undefined }
  }
  if (a.type === 'apiKey') return { plan: 'API key' }
  if (a.type === 'amazonBedrock') return { plan: 'Amazon Bedrock' }
  return undefined
}

function debugModels(binary: string, env: NodeJS.ProcessEnv): Promise<ModelInfo[]> {
  return new Promise((resolve) => {
    execCli(binary, ['debug', 'models'], { env, timeout: 15_000, maxBuffer: 16 << 20 }, (_err, stdout) => {
      try {
        resolve(codexModels(JSON.parse(stdout).models))
      } catch {
        resolve([])
      }
    })
  })
}

/** Ask a short-lived app-server for the model catalogue and account; older CLIs fall back to `debug models`. */
async function inspectCodex(binary: string, env: NodeJS.ProcessEnv): Promise<AgentInspection> {
  let next = 0
  const raw: unknown[] = []
  let account: AgentAccount | undefined
  const done = await askCli<boolean>(
    binary,
    ['app-server'],
    env,
    (msg, send) => {
      // Server-initiated requests and notifications carry a method; only responses matter here.
      if (msg.method) return undefined
      if (msg.id === 1) {
        send({ method: 'initialized', params: {} })
        send({ id: (next = 2), method: 'model/list', params: { limit: 200 } })
      } else if (msg.id === next && next >= 2 && msg.id !== 99) {
        const result = (msg.result ?? {}) as Json
        raw.push(...((result.data ?? []) as unknown[]))
        if (typeof result.nextCursor === 'string' && result.nextCursor && next < 20) {
          send({ id: ++next, method: 'model/list', params: { limit: 200, cursor: result.nextCursor } })
        } else send({ id: 99, method: 'account/read', params: {} })
      } else if (msg.id === 99) {
        account = codexAccount(((msg.result ?? {}) as Json).account)
        return true
      }
      return undefined
    },
    { first: [{ id: 1, method: 'initialize', params: { clientInfo: { name: 'mathodology-studio', version: '0.1.0' }, capabilities: null } }] }
  )
  const models = raw.length ? codexModels(raw) : await debugModels(binary, env)
  return { models: models.length > 1 ? models : [], account: done ? account : undefined }
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  name: 'Codex',
  binaryNames: ['codex'],
  route: 'app-server',
  supportsApproval: true,
  supportsResume: true,
  versionArgs: ['--version'],
  models: [{ id: '', label: 'Default', model: 'gpt' }],
  inspect: inspectCodex,
  start(req: TurnRequest, sink: TurnSink): Turn {
    const parser = new CodexAppServerParser(sink)
    let nextId = 1
    const waiting = new Map<number, { resolve(v: Json): void; reject(e: Error): void }>()
    const notifications: { method: string; params: Json }[] = []
    let turnReady = false

    const notify = (method: string, params: Json): void => {
      const wasDone = parser.done
      parser.notification(method, params)
      if (!wasDone && parser.done && !child.stdin.destroyed) child.stdin.end()
    }

    const onLine = (line: string): void => {
      const msg = parseJson(line)
      if (!msg) return
      if (msg.method && msg.id !== undefined) {
        const reply = parser.request({ id: msg.id as number, method: String(msg.method), params: (msg.params ?? {}) as Json })
        if (reply === undefined) send({ id: msg.id, error: { code: -32601, message: 'Not supported by Mathodology Studio' } })
        else if (reply !== null) send({ id: msg.id, result: reply })
        return
      }
      if (msg.method) {
        const method = String(msg.method)
        const params = (msg.params ?? {}) as Json
        // A file approval may arrive before turn/start resolves; it still needs file details.
        if (!turnReady && method === 'item/started') parser.rememberFileChange((params.item ?? {}) as Json)
        if (turnReady || method === 'serverRequest/resolved') notify(method, params)
        else notifications.push({ method, params })
        return
      }
      const w = waiting.get(Number(msg.id))
      if (!w) return
      waiting.delete(Number(msg.id))
      if (msg.error) w.reject(new Error(String(((msg.error ?? {}) as Json).message ?? 'Codex request failed')))
      else w.resolve((msg.result ?? {}) as Json)
    }

    const { child, exited, kill } = spawnLines(req.binary, codexArgs(req), req.cwd, req.env, onLine)
    const send = (obj: Json): void => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(obj) + '\n')
    }
    const call = (method: string, params: Json): Promise<Json> =>
      new Promise((resolve, reject) => {
        const id = nextId++
        waiting.set(id, { resolve, reject })
        send({ id, method, params })
      })

    const policy = POLICY[req.permissionMode]
    let interrupted = false
    let failure: string | null = null

    const run = async (): Promise<void> => {
      await call('initialize', {
        clientInfo: { name: 'mathodology-studio', title: 'Mathodology Studio', version: '0.1.0' },
        capabilities: null
      })
      send({ method: 'initialized', params: {} })
      const threadParams: Json = {
        cwd: req.cwd,
        sandbox: policy.sandbox,
        approvalPolicy: policy.approvalPolicy,
        model: req.model || null,
        developerInstructions: req.systemAppend ?? null
      }
      const started = req.resumeId
        ? await call('thread/resume', { ...threadParams, threadId: req.resumeId, excludeTurns: true })
        : await call('thread/start', threadParams)
      const thread = (started.thread ?? {}) as Json
      parser.threadId = String(thread.id ?? req.resumeId ?? '')
      if (parser.threadId) sink.nativeSession(parser.threadId)
      sink.emit({ kind: 'session.started', agent: 'codex', model: req.model, nativeSessionId: parser.threadId, cwd: req.cwd })
      const turn = await call('turn/start', {
        threadId: parser.threadId,
        input: [{ type: 'text', text: req.prompt, text_elements: [] }],
        model: req.model || null,
        effort: req.effort || null,
        summary: 'detailed'
      })
      parser.turnId = String(((turn.turn ?? {}) as Json).id ?? parser.turnId)
      // Notifications can precede the turn/start response. Bind the requested turn first so
      // replayed or concurrent turns cannot claim its lifecycle while startup is in flight.
      turnReady = true
      for (const { method, params } of notifications.splice(0)) notify(method, params)
    }
    run().catch((err: Error) => {
      failure = err.message
      if (!child.stdin.destroyed) child.stdin.end()
    })

    const done = exited.then(({ code, signal, stderr }) => {
      for (const id of parser.pending.keys()) sink.emit({ kind: 'permission.resolved', requestId: id, allow: false })
      parser.pending.clear()
      if (parser.done) return
      if (!interrupted) {
        const tail = failure ?? stderrTail(stderr)
        sink.emit({
          kind: 'notice',
          level: 'error',
          text: `Codex stopped (${signal ?? code ?? 'unknown'})${tail ? `:\n${tail}` : ''}`,
          code: 'agentExited',
          vars: { agent: 'Codex', status: String(signal ?? code ?? '?'), tail }
        })
      }
      sink.emit({ kind: 'turn.completed', ok: false, summary: interrupted ? 'interrupted' : undefined })
    })

    return {
      interrupt() {
        interrupted = true
        if (parser.threadId && parser.turnId) void call('turn/interrupt', { threadId: parser.threadId, turnId: parser.turnId }).catch(() => undefined)
        setTimeout(() => {
          if (child.exitCode === null) {
            child.stdin.end()
            kill('SIGTERM')
          }
        }, 4000)
        setTimeout(() => child.exitCode === null && kill('SIGKILL'), 8000)
      },
      respondPermission(requestId, allow, always, raw) {
        const question = parser.pending.get(requestId)?.method === 'item/tool/requestUserInput'
        const answers = question && allow ? cleanAnswers(raw) : undefined
        const reply = parser.decision(requestId, allow, always, answers)
        if (!reply) return
        send(reply)
        if (!question) sink.emit({ kind: 'permission.resolved', requestId, allow, always })
        else {
          const answered = Boolean(answers && Object.keys(answers).length)
          sink.emit({ kind: 'permission.resolved', requestId, allow: answered, ...(answered ? { answers } : {}) })
        }
      },
      done
    }
  }
}
