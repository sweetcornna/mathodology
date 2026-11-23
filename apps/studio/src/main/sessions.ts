import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import type {
  CreateSessionInput,
  SendMessageInput,
  Session,
  SessionEvent,
  SessionEventBody,
  SessionPatch,
  Settings,
  Project
} from '@shared/types'
import type { Turn } from './agents/base'
import type { ArtifactStore, Attribution, Captured } from './artifacts'
import { agentEnv, agentSettings, envFor, resolveBinary } from './agents/detect'
import { ADAPTERS } from './agents/registry'
import { stageAttachments } from './attachments'
import { bounded } from './agents/supervisor'
import type { Store } from './store'

export { ADAPTERS }

const STUDIO_PREAMBLE = `You are working inside Mathodology Studio, a desktop workbench for mathematical-modeling contests.
The user reads your replies in a Markdown renderer with LaTeX ($...$ inline, $$...$$ display) and sees your tool calls as cards.
The working directory is the contest project; its AGENTS.md describes the folder layout and the Mathodology skills to use.
Write files inside the project, keep computations reproducible, and mention the paths of figures, tables and papers you create.`

/** Agent errors meaning the stored conversation id no longer exists on its side. */
const RESUME_FAILED = /no (previous )?sessions? found|no conversation found|session .*not found|error resuming session/i
const RESUME_RESET = 'The agent could not find the previous conversation; the next message starts a new one.'

export interface SessionHooks {
  event(event: SessionEvent): void
  changed(session: Session): void
  filesChanged(projectId: string): void
  artifactsChanged(projectId: string): void
}

const QUEUE_LIMIT = 20

/** Project-relative paths a file-writing tool call names, from its recorded changes or input. */
function namedPaths(project: Project, call: Extract<SessionEventBody, { kind: 'tool.call' }>): string[] {
  const input = (call.input ?? {}) as Record<string, unknown>
  const raw = [
    ...(call.changes ?? []).map((c) => c.path),
    ...['file_path', 'path', 'notebook_path', 'absolute_path', 'filename'].map((k) => input[k]).filter((v): v is string => typeof v === 'string')
  ]
  return raw.flatMap((p) => {
    const rel = isAbsolute(p) ? relative(project.path, p) : p
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? [rel.split(sep).join('/')] : []
  })
}

export class SessionManager {
  private turns = new Map<string, Turn>()
  private attribution = new Map<string, { projectId: string; overlap: boolean }>()
  private admittingQueue = new Map<string, string>()
  private closing = false

  constructor(
    private readonly store: Store,
    private readonly artifacts: ArtifactStore,
    private readonly settings: () => Settings,
    private readonly hooks: SessionHooks
  ) {}

  /** Record new artifact versions and announce them in the session's transcript. */
  private capture(sessionId: string, project: Project, rels: string[] | 'scan', by: Attribution): void | Promise<void> {
    if (!this.store.project(project.id)) return
    const attribution = this.attribution.get(sessionId)
    const publish = (found: Captured[]): void => {
      if (!this.store.project(project.id)) return
      for (const { artifact, version } of found) {
        if (!version.sessionId || !this.store.session(sessionId)) continue
        this.emit(sessionId, {
          kind: 'artifact.version', artifactId: artifact.id, rel: artifact.rel, v: version.v,
          origin: version.origin, artifactKind: artifact.kind, callId: version.callId
        })
      }
      if (found.length) this.hooks.artifactsChanged(project.id)
    }
    try {
      const captured = this.artifacts.captureAvailable(project, rels, () =>
        attribution?.overlap ? { origin: 'external' } : by
      )
      if (Array.isArray(captured)) publish(captured)
      else return captured.then(publish).catch((err) => console.warn('artifact capture failed', err))
    } catch (err) {
      console.warn('artifact capture failed', err)
    }
  }

  /** Remove a message that is still waiting in the queue. */
  dequeue(sessionId: string, id: string): Session | undefined {
    if (this.admittingQueue.get(sessionId) === id) throw new Error('Queued message is starting')
    const session = this.store.session(sessionId)
    if (!session?.queue?.length) return session
    return this.save(sessionId, { queue: session.queue.filter((q) => q.id !== id) })
  }

  isRunning(sessionId: string): boolean {
    return this.turns.has(sessionId)
  }

  /** Whether an agent turn is running in the project; its changes belong to that turn. */
  projectBusy(projectId: string): boolean {
    return [...this.turns.keys()].some((id) => this.store.session(id)?.projectId === projectId)
  }

  create(input: CreateSessionInput): Session {
    if (!this.store.project(input.projectId)) throw new Error('Unknown project')
    const now = Date.now()
    const session: Session = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title?.trim() || '',
      agent: input.agent,
      model: input.model || undefined,
      effort: input.effort || undefined,
      permissionMode: input.permissionMode,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archived: false,
      status: 'idle',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
    }
    this.store.upsertSession(session)
    return session
  }

  update(sessionId: string, patch: SessionPatch): Session {
    const session = this.store.session(sessionId)
    if (!session) throw new Error('Unknown session')
    const next: Partial<Session> = {}
    if (patch.title !== undefined) next.title = patch.title
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    if (patch.archived !== undefined) next.archived = patch.archived
    if (Object.hasOwn(patch, 'model')) next.model = patch.model
    if (Object.hasOwn(patch, 'effort')) next.effort = patch.effort
    if (patch.permissionMode !== undefined) next.permissionMode = patch.permissionMode
    if (patch.agent !== undefined && patch.agent !== session.agent) {
      next.agent = patch.agent
      next.nativeSessionId = undefined
    }
    return this.save(sessionId, next)
  }

  private save(sessionId: string, patch: Partial<Session>): Session {
    const session = this.store.session(sessionId)
    if (!session) throw new Error('Unknown session')
    const next = { ...session, ...patch, updatedAt: Date.now() }
    this.store.upsertSession(next)
    this.hooks.changed(next)
    return next
  }

  private emit(sessionId: string, body: SessionEventBody): SessionEvent {
    const event = this.store.record(sessionId, body)
    this.hooks.event(event)
    return event
  }

  send(input: SendMessageInput): Promise<void> {
    return this.admit(input)
  }

  async sendQueued(sessionId: string, itemId: string): Promise<void> {
    const session = this.store.session(sessionId)
    if (!session) throw new Error('Unknown session')
    const item = session.queue?.find((q) => q.id === itemId)
    if (!item) throw new Error('Unknown queued message for this session')
    return this.admit({ sessionId, text: item.text, attachments: item.attachments }, itemId)
  }

  private async admit(input: SendMessageInput, queuedId?: string): Promise<void> {
    if (this.closing) throw new Error('Studio is shutting down')
    const session = this.store.session(input.sessionId)
    if (!session) throw new Error('Unknown session')
    if (this.turns.has(session.id)) {
      if (queuedId) throw new Error('Wait for the current turn to finish before sending a queued message.')
      // Queued on the session so it survives a reload; the next turn starts when this one ends.
      const queue = session.queue ?? []
      if (queue.length >= QUEUE_LIMIT) throw new Error('Too many queued messages')
      this.save(session.id, {
        queue: [...queue, { id: randomUUID(), text: input.text, attachments: input.attachments, createdAt: Date.now() }]
      })
      return
    }
    const project = this.store.project(session.projectId)
    if (!project) throw new Error('Unknown project')

    const settings = this.settings()
    const adapter = ADAPTERS[session.agent]
    const own = agentSettings(settings, session.agent)
    const binarySettings = { ...settings, agents: { [session.agent]: own } }
    const launch = {
      cwd: project.path,
      model: session.model || own.defaultModel || undefined,
      effort: session.effort || undefined,
      permissionMode: session.permissionMode,
      resumeId: session.nativeSessionId,
      settings: own,
      mcpServers: structuredClone(settings.connectors.filter((c) => c.enabled))
    }
    const attribution = { projectId: project.id, overlap: false }
    for (const other of this.attribution.values()) {
      if (other.projectId === project.id) {
        other.overlap = true
        attribution.overlap = true
      }
    }
    this.attribution.set(session.id, attribution)

    // Reserve the session before any asynchronous preparation. A second send must queue even
    // while the login environment is loading, and stopping during preparation must prevent spawn.
    let actual: Turn | undefined
    let cancelled = false
    let started = false
    let handedOff = false
    let settled = false
    let settle!: () => void
    const reservation: Turn = {
      done: new Promise<void>((resolve) => { settle = resolve }),
      interrupt: () => {
        cancelled = true
        if (actual) actual.interrupt()
        else {
          if (owns() && this.store.session(session.id)) {
            if (started) this.emit(session.id, { kind: 'turn.completed', ok: false, summary: 'interrupted' })
            this.save(session.id, { status: 'idle' })
          }
          release()
        }
      },
      respondPermission: (...args) => actual?.respondPermission(...args)
    }
    const owns = (): boolean => this.turns.get(session.id) === reservation
    const release = (): void => {
      if (settled) return
      settled = true
      if (owns()) {
        this.turns.delete(session.id)
        this.attribution.delete(session.id)
      }
      settle()
    }
    this.turns.set(session.id, reservation)

    let staged: ReturnType<typeof stageAttachments> | undefined
    let turnSeq = 0
    const recordMessage = (): void => {
      staged ??= stageAttachments(project.path, input.attachments)
      turnSeq = this.emit(session.id, { kind: 'user.message', text: input.text, attachments: staged.paths }).seq
      if (staged.paths.length) this.hooks.filesChanged(project.id)
      started = true
    }

    try {
      // An overlapping turn may be writing these files, so it owns the next capture.
      const baseline = !attribution.overlap && this.capture(session.id, project, 'scan', { origin: 'external' })
      if (!queuedId) recordMessage()
      const calls = new Map<string, Extract<SessionEventBody, { kind: 'tool.call' }>>()
      let continueQueue = false
      const captures = new Set<Promise<void>>()
      let completed: Promise<void> | undefined
      this.save(session.id, { status: 'running' })
      const env = { ...envFor(await agentEnv(), own) }
      if (baseline) await baseline
      // Deleted (with its project, perhaps) while the environment was resolved.
      const stored = this.store.session(session.id)
      if (cancelled || !owns() || !stored) return
      if (queuedId && !stored.queue?.some((q) => q.id === queuedId)) throw new Error('Queued message was removed')
      const binary = adapter && resolveBinary(adapter, binarySettings, env)
      if (queuedId && binary) staged = stageAttachments(project.path, input.attachments)
      const attached = staged?.paths ?? []
      const prompt = attached.length
        ? `${input.text}\n\nAttached files (copied into the project): ${attached.join(', ')}`
        : input.text

      let current: Session = session
      // Start from the stored session each time: the queue, title or model may change mid-turn.
      // Once the session is deleted, the turn winding down must not bring it back.
      const save = (patch: Partial<Session>): void => {
        const stored = this.store.session(session.id)
        if (!stored || !owns()) return
        current = { ...stored, ...patch, updatedAt: Date.now() }
        this.store.upsertSession(current)
        this.hooks.changed(current)
      }
      save({ title: stored.title || input.text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Untitled', status: 'running' })

      if (!binary) {
        const agent = adapter?.name ?? session.agent
        if (queuedId) throw new Error(`${agent} was not found. Install it or set its path in Settings → Agents.`)
        this.emit(session.id, {
          kind: 'notice',
          level: 'error',
          text: `${agent} was not found. Install it or set its path in Settings → Agents.`,
          code: 'agentMissing',
          vars: { agent }
        })
        if (started) this.emit(session.id, { kind: 'turn.completed', ok: false })
        save({ status: 'error' })
        return
      }

      const { resumeId } = launch
      // Some CLIs accept a session id up front, which makes the next turn's resume reliable. It is
      // stored only once the agent confirms the session, so an aborted first turn starts fresh.
      const newSessionId = !resumeId && adapter.takesSessionId ? randomUUID() : undefined
      let resumeFailed = false
      let turn: Turn
      const trackCapture = (capture: void | Promise<void>): void => {
        if (capture) {
          captures.add(capture)
          void capture.then(() => captures.delete(capture))
        }
      }
      const finish = (body: Extract<SessionEventBody, { kind: 'turn.completed' }>): void => {
        if (!owns() || !this.store.session(session.id)) return
        continueQueue = body.ok
        if (body.usage) {
          const u = current.usage
          save({
            usage: {
              inputTokens: u.inputTokens + (body.usage.inputTokens ?? 0),
              outputTokens: u.outputTokens + (body.usage.outputTokens ?? 0),
              cacheReadTokens: u.cacheReadTokens + (body.usage.cacheReadTokens ?? 0),
              costUsd: u.costUsd + (body.usage.costUsd ?? 0)
            }
          })
        }
        this.emit(session.id, body)
        save({ status: body.ok || body.summary === 'interrupted' ? 'idle' : 'error' })
        if (resumeFailed && this.store.session(session.id)?.agent === session.agent) {
          save({ nativeSessionId: undefined })
          this.emit(session.id, { kind: 'notice', level: 'info', text: RESUME_RESET, code: 'resumeReset' })
        }
      }
      let admitted = !queuedId
      const buffered: (() => void)[] = []
      const dispatch = (handle: () => void): void => {
        if (!owns()) return
        if (admitted) handle()
        else buffered.push(handle)
      }
      if (queuedId) this.admittingQueue.set(session.id, queuedId)
      try {
        turn = adapter.start(
          {
            binary,
            ...launch,
            prompt,
            newSessionId,
            // Some CLIs take this as a system prompt each run; the others only need it once per thread.
            systemAppend: adapter.systemPromptEachTurn || !resumeId ? STUDIO_PREAMBLE : undefined,
            env
          },
          {
            emit: (body) => dispatch(() => {
              if (!owns() || !this.store.session(session.id)) return
              if (body.kind === 'permission.request') save({ status: 'waiting' })
              if (body.kind === 'permission.resolved' && current.status === 'waiting') save({ status: 'running' })
              if (body.kind === 'tool.result') this.hooks.filesChanged(project.id)
              if (body.kind === 'tool.call') calls.set(body.callId, body)
              if (body.kind === 'notice' && resumeId && RESUME_FAILED.test(body.text)) resumeFailed = true
              if (body.kind === 'turn.completed') {
                trackCapture(this.capture(session.id, project, 'scan', { origin: 'turn', sessionId: session.id, turnSeq }))
                if (captures.size) completed = Promise.all(captures).then(() => finish(body))
                else finish(body)
                return
              }
              this.emit(session.id, body)
              if (body.kind === 'tool.result' && !body.isError) {
                const call = calls.get(body.callId)
                if (call && (call.toolKind === 'edit' || call.toolKind === 'write')) {
                  trackCapture(this.capture(session.id, project, namedPaths(project, call), {
                    origin: 'tool',
                    sessionId: session.id,
                    turnSeq,
                    callId: call.callId,
                    tool: call.name
                  }))
                }
              }

            }),
            nativeSession: (id) => dispatch(() => {
              // A turn still winding down after you switched agents must not hand its id to the new one.
              if (!owns() || this.store.session(session.id)?.agent !== session.agent) return
              if (id && id !== current.nativeSessionId) save({ nativeSessionId: id })
            })
          }
        )
      } catch (err) {
        // spawn throws for some failures, such as a command line longer than the system allows.
        if (queuedId) throw err
        this.emit(session.id, { kind: 'notice', level: 'error', text: `${adapter.name} could not be started: ${(err as Error).message}` })
        this.emit(session.id, { kind: 'turn.completed', ok: false })
        save({ status: 'error' })
        return
      }
      actual = turn
      if (queuedId) {
        void turn.done.catch(() => undefined)
        if (turn.admitted) await turn.admitted
        if (cancelled || !owns() || !this.store.session(session.id)) return
        recordMessage()
        this.admittingQueue.delete(session.id)
        this.dequeue(session.id, queuedId)
        admitted = true
        for (const handle of buffered.splice(0)) handle()
      }
      handedOff = true
      if (cancelled) turn.interrupt()
      const finished = (): void => {
        if (!owns()) { release(); return }
        if (current.status === 'running' || current.status === 'waiting') save({ status: 'idle' })
        release()
        this.hooks.filesChanged(project.id)
        // After an interrupt or failure the queue waits for you; otherwise the next message starts.
        const next = this.store.session(session.id)?.queue?.[0]
        if (next && continueQueue && !cancelled && !this.closing) {
          void this.sendQueued(session.id, next.id).catch((err) => console.warn('queued turn could not start', err))
        }
      }
      // Register both outcomes without creating an unhandled rejected finally() promise.
      const settleTurn = (): void | Promise<void> => completed ? completed.then(finished, finished) : finished()
      void turn.done.then(settleTurn, settleTurn).catch((err) => console.warn('turn finalization failed', err))
    } catch (err) {
      // A cancelled/deleted preparation may reject later; it no longer owns the session's UI.
      if (cancelled || !owns() || !this.store.session(session.id)) return
      this.emit(session.id, { kind: 'notice', level: 'error', text: `The turn could not be prepared: ${(err as Error).message}` })
      if (started) this.emit(session.id, { kind: 'turn.completed', ok: false })
      this.save(session.id, { status: 'error' })
      throw err
    } finally {
      if (!handedOff) {
        if (queuedId) {
          this.admittingQueue.delete(session.id)
          if (actual && !cancelled) actual.interrupt()
          if (cancelled && owns() && this.store.session(session.id)) this.save(session.id, { status: 'idle' })
        }
        if (!started) staged?.discard()
        release()
      }
    }
  }

  interrupt(sessionId: string): void {
    this.turns.get(sessionId)?.interrupt()
  }

  respondPermission(sessionId: string, requestId: string, allow: boolean, always?: boolean, answers?: Record<string, string[]>): void {
    this.turns.get(sessionId)?.respondPermission(requestId, allow, always, answers)
  }

  async shutdown(): Promise<void> {
    this.closing = true
    const pending = [...this.turns.values()]
    for (const t of pending) t.interrupt()
    await bounded(Promise.allSettled(pending.map((t) => t.done)), 3000).catch(() => undefined)
  }
}
