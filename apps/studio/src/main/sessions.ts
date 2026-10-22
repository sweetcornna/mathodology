import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import type {
  AgentId,
  CreateSessionInput,
  SendMessageInput,
  Session,
  SessionEvent,
  SessionEventBody,
  Settings,
  Project
} from '@shared/types'
import type { AgentAdapter, Turn } from './agents/base'
import type { ArtifactStore, Attribution } from './artifacts'
import { claudeAdapter } from './agents/claude'
import { codexAdapter } from './agents/codex'
import { agentEnv, resolveBinary } from './agents/detect'
import { geminiAdapter } from './agents/gemini'
import type { Store } from './store'

export const ADAPTERS: Record<AgentId, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter
}

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

function uniqueTarget(dir: string, requested: string): string {
  // Only the file name counts: "../x" or "/abs/x" still lands in the attachments folder.
  const base = basename(requested)
  const name = base && base !== '.' && base !== '..' ? base : 'attachment'
  let target = join(dir, name)
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let i = 2; existsSync(target); i++) target = join(dir, `${stem}-${i}${ext}`)
  return target
}

export class SessionManager {
  private turns = new Map<string, Turn>()

  constructor(
    private readonly store: Store,
    private readonly artifacts: ArtifactStore,
    private readonly settings: () => Settings,
    private readonly hooks: SessionHooks
  ) {}

  /** Record new artifact versions and announce them in the session's transcript. */
  private capture(sessionId: string, project: Project, rels: string[] | 'scan', by: Attribution): void {
    // A project removed mid-turn gets no history back.
    if (!this.store.project(project.id)) return
    const found = this.artifacts.capture(project, rels, by)
    for (const { artifact, version } of found) {
      this.emit(sessionId, {
        kind: 'artifact.version',
        artifactId: artifact.id,
        rel: artifact.rel,
        v: version.v,
        origin: version.origin,
        artifactKind: artifact.kind,
        callId: version.callId
      })
    }
    if (found.length) this.hooks.artifactsChanged(project.id)
  }

  /** Remove a message that is still waiting in the queue. */
  dequeue(sessionId: string, id: string): Session | undefined {
    const session = this.store.session(sessionId)
    if (!session?.queue?.length) return session
    return this.update(sessionId, { queue: session.queue.filter((q) => q.id !== id) })
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

  update(sessionId: string, patch: Partial<Session>): Session {
    const session = this.store.session(sessionId)
    if (!session) throw new Error('Unknown session')
    // Switching agents starts a fresh native conversation; the transcript stays.
    const agentChanged = patch.agent && patch.agent !== session.agent
    const next: Session = {
      ...session,
      ...patch,
      nativeSessionId: agentChanged ? undefined : session.nativeSessionId,
      updatedAt: Date.now()
    }
    this.store.upsertSession(next)
    this.hooks.changed(next)
    return next
  }

  private emit(sessionId: string, body: SessionEventBody): SessionEvent {
    const event = this.store.record(sessionId, body)
    this.hooks.event(event)
    return event
  }

  async send(input: SendMessageInput): Promise<void> {
    const session = this.store.session(input.sessionId)
    if (!session) throw new Error('Unknown session')
    if (this.turns.has(session.id)) {
      // Queued on the session so it survives a reload; the next turn starts when this one ends.
      const queue = session.queue ?? []
      if (queue.length >= QUEUE_LIMIT) throw new Error('Too many queued messages')
      this.update(session.id, {
        queue: [...queue, { id: randomUUID(), text: input.text, attachments: input.attachments, createdAt: Date.now() }]
      })
      return
    }
    const project = this.store.project(session.projectId)
    if (!project) throw new Error('Unknown project')

    // Edits made between turns (by you or other programs) are recorded before the agent starts.
    const outside = this.artifacts.capture(project, 'scan', { origin: 'external' })
    if (outside.length) this.hooks.artifactsChanged(project.id)

    const attached: string[] = []
    if (input.attachments.length) {
      const dir = join(project.path, 'attachments')
      mkdirSync(dir, { recursive: true })
      for (const a of input.attachments) {
        const target = uniqueTarget(dir, a.name)
        copyFileSync(a.path, target)
        attached.push(`attachments/${basename(target)}`)
      }
      this.hooks.filesChanged(project.id)
    }
    const turnSeq = this.emit(session.id, { kind: 'user.message', text: input.text, attachments: attached }).seq
    const calls = new Map<string, Extract<SessionEventBody, { kind: 'tool.call' }>>()
    let continueQueue = false

    const prompt = attached.length
      ? `${input.text}\n\nAttached files (copied into the project): ${attached.join(', ')}`
      : input.text

    const settings = this.settings()
    const adapter = ADAPTERS[session.agent]
    const env = await agentEnv()
    // Deleted (with its project, perhaps) while the environment was resolved.
    if (!this.store.session(session.id)) return
    const binary = resolveBinary(adapter, settings, env)

    let current: Session = session
    // Start from the stored session each time: the queue, title or model may change mid-turn.
    // Once the session is deleted, the turn winding down must not bring it back.
    const save = (patch: Partial<Session>): void => {
      const stored = this.store.session(session.id)
      if (!stored) return
      current = { ...stored, ...patch, updatedAt: Date.now() }
      this.store.upsertSession(current)
      this.hooks.changed(current)
    }
    save({ title: session.title || input.text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Untitled', status: 'running' })

    if (!binary) {
      this.emit(session.id, {
        kind: 'notice',
        level: 'error',
        text: `${adapter.name} was not found. Install it or set its path in Settings → Agents.`,
        code: 'agentMissing',
        vars: { agent: adapter.name }
      })
      this.emit(session.id, { kind: 'turn.completed', ok: false })
      save({ status: 'error' })
      return
    }

    const resumeId = current.nativeSessionId
    // Claude and Gemini accept a session id up front, which makes the next turn's resume reliable.
    // It is stored only once the agent confirms the session, so an aborted first turn starts fresh.
    const newSessionId = !resumeId && session.agent !== 'codex' ? randomUUID() : undefined
    let resumeFailed = false
    const turn = adapter.start(
      {
        binary,
        cwd: project.path,
        prompt,
        model: current.model || settings.agents[session.agent].defaultModel || undefined,
        effort: current.effort || undefined,
        permissionMode: current.permissionMode,
        resumeId,
        newSessionId,
        // Claude takes this as a system prompt each run; the others only need it once per thread.
        systemAppend: session.agent === 'claude' || !resumeId ? STUDIO_PREAMBLE : undefined,
        settings: settings.agents[session.agent],
        env
      },
      {
        emit: (body) => {
          if (body.kind === 'permission.request') save({ status: 'waiting' })
          if (body.kind === 'permission.resolved' && current.status === 'waiting') save({ status: 'running' })
          if (body.kind === 'tool.result') this.hooks.filesChanged(project.id)
          if (body.kind === 'tool.call') calls.set(body.callId, body)
          if (body.kind === 'notice' && resumeId && RESUME_FAILED.test(body.text)) resumeFailed = true
          if (body.kind === 'turn.completed') {
            continueQueue = body.ok
            // Files written by scripts or commands appear here, attributed to the turn as a whole.
            this.capture(session.id, project, 'scan', { origin: 'turn', sessionId: session.id, turnSeq })
          }
          if (body.kind === 'turn.completed' && body.usage) {
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
          if (body.kind === 'tool.result' && !body.isError) {
            const call = calls.get(body.callId)
            if (call && (call.toolKind === 'edit' || call.toolKind === 'write')) {
              this.capture(session.id, project, namedPaths(project, call), {
                origin: 'tool',
                sessionId: session.id,
                turnSeq,
                callId: call.callId,
                tool: call.name
              })
            }
          }
          if (body.kind === 'turn.completed') {
            save({ status: body.ok || body.summary === 'interrupted' ? 'idle' : 'error' })
            if (resumeFailed) {
              save({ nativeSessionId: undefined })
              this.emit(session.id, { kind: 'notice', level: 'info', text: RESUME_RESET, code: 'resumeReset' })
            }
          }
        },
        nativeSession: (id) => {
          if (id && id !== current.nativeSessionId) save({ nativeSessionId: id })
        }
      }
    )
    this.turns.set(session.id, turn)
    turn.done.finally(() => {
      this.turns.delete(session.id)
      if (current.status === 'running' || current.status === 'waiting') save({ status: 'idle' })
      this.hooks.filesChanged(project.id)
      // After an interrupt or failure the queue waits for you; otherwise the next message starts.
      const next = this.store.session(session.id)?.queue?.[0]
      if (next && continueQueue) {
        this.dequeue(session.id, next.id)
        void this.send({ sessionId: session.id, text: next.text, attachments: next.attachments }).catch(() => undefined)
      }
    })
  }

  interrupt(sessionId: string): void {
    this.turns.get(sessionId)?.interrupt()
  }

  respondPermission(sessionId: string, requestId: string, allow: boolean, always?: boolean): void {
    this.turns.get(sessionId)?.respondPermission(requestId, allow, always)
  }

  async shutdown(): Promise<void> {
    const pending = [...this.turns.values()]
    for (const t of pending) t.interrupt()
    await Promise.race([Promise.allSettled(pending.map((t) => t.done)), new Promise((r) => setTimeout(r, 3000))])
  }
}
