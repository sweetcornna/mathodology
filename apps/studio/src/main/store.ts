import { randomUUID } from 'node:crypto'
import { REDACTED_ANSWER } from '@shared/types'
import { appendFileSync, closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, Session, SessionEvent, SessionEventBody, Settings } from '@shared/types'

interface StateFile {
  version: 1
  projects: Project[]
  sessions: Session[]
  recovery?: Record<string, RecoveryWatermark>
}

interface RecoveryState {
  seq: number
  openTurn: boolean
  pending: Set<string>
}
interface RecoveryWatermark {
  seq: number
  openTurn: boolean
  pending: string[]
  dev: number
  ino: number
  size: number
  mtime: number
}

function updateRecovery(state: RecoveryState, event: SessionEvent): void {
  state.seq = Math.max(state.seq, event.seq)
  if (event.kind === 'user.message' || event.kind === 'session.started') state.openTurn = true
  if (event.kind === 'turn.completed') state.openTurn = false
  if (event.kind === 'permission.request') state.pending.add(event.requestId)
  if (event.kind === 'permission.resolved') state.pending.delete(event.requestId)
}

function eventLines(text: string): SessionEvent[] {
  const events: SessionEvent[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const event = JSON.parse(line) as SessionEvent | null
      if (event && typeof event.kind === 'string' && Number.isSafeInteger(event.seq)) events.push(event)
    } catch {
      // A torn final line from a crash is skipped.
    }
  }
  return events
}

/** Ids name files in the data folder (events/<id>.jsonl, reviews/<id>.json), so only plain tokens are accepted. */
export function isPlainId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

export function writeAtomic(path: string, data: string | Buffer): void {
  const tmp = `${path}.${randomUUID()}.tmp`
  // On disk before the rename, so a crash leaves the old file or the new one, never an empty one.
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    try {
      writeFileSync(fd, data, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

export function readJson<T>(path: string, fallback: T): T {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return fallback
  }
  try {
    return JSON.parse(text) as T
  } catch {
    // Kept aside for recovery instead of being replaced by the defaults on the next save.
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // Gone or read-only; the defaults still apply.
    }
    return fallback
  }
}

type Secrets = Map<string, Set<string>>

function trackSecrets<T extends SessionEventBody>(secrets: Secrets, body: T): T {
  if (body.kind === 'permission.request') {
    secrets.set(body.requestId, new Set(body.questions?.filter((q) => q.secret).map((q) => q.id)))
  }
  if (body.kind !== 'permission.resolved' || !body.answers) return body
  const ids = secrets.get(body.requestId)
  if (!ids?.size) return body
  return {
    ...body,
    answers: Object.fromEntries(Object.entries(body.answers).map(([id, values]) => [id, ids.has(id) ? [REDACTED_ANSWER] : values]))
  }
}

/** Projects, sessions and settings as JSON; each session's events as an append-only JSONL file. */
export class Store {
  private state: StateFile
  private secrets = new Map<string, Secrets>()
  private seqs = new Map<string, number>()
  private recovery = new Map<string, RecoveryState>()
  private recoveryDirty = new Set<string>()
  private appendReady = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly dir: string) {
    mkdirSync(join(dir, 'events'), { recursive: true })
    this.state = readJson<StateFile>(join(dir, 'state.json'), { version: 1, projects: [], sessions: [] })
    // State is debounced, but the transcript is written immediately. Recover from the event
    // history too, including a crash before the running status reached state.json.
    let checkpointChanged = false
    for (const session of this.state.sessions) {
      const { recovery, reused } = this.recover(session.id)
      this.recovery.set(session.id, recovery)
      this.seqs.set(session.id, recovery.seq)
      checkpointChanged ||= !reused
      if (!reused) this.recoveryDirty.add(session.id)

      // Old approval cards have no live agent to receive an answer after a restart.
      const { openTurn, pending } = recovery
      const permissions = [...pending]
      for (const requestId of permissions) this.record(session.id, { kind: 'permission.resolved', requestId, allow: false })
      if (openTurn) this.record(session.id, { kind: 'turn.completed', ok: false, summary: 'interrupted' })
      if (openTurn || permissions.length || session.status === 'running' || session.status === 'waiting') {
        session.status = 'idle'
        checkpointChanged = true
      }
    }
    if (checkpointChanged) this.flush()
  }

  private recover(sessionId: string): { recovery: RecoveryState; reused: boolean } {
    const path = this.eventsPath(sessionId)
    const watermark = this.state.recovery?.[sessionId]
    const st = statSync(path, { throwIfNoEntry: false })
    const recovery: RecoveryState = { seq: 0, openTurn: false, pending: new Set() }
    if (!st) return { recovery, reused: true }

    let offset = 0
    if (watermark && st.dev === watermark.dev && st.ino === watermark.ino &&
        (st.size > watermark.size || st.size === watermark.size && st.mtimeMs === watermark.mtime)) {
      recovery.seq = watermark.seq
      recovery.openTurn = watermark.openTurn
      recovery.pending = new Set(watermark.pending)
      offset = watermark.size
      if (st.size === offset) return { recovery, reused: true }
    }
    if (!offset) {
      for (const event of eventLines(readFileSync(path, 'utf8'))) updateRecovery(recovery, event)
    } else {
      const fd = openSync(path, 'r')
      try {
        const tail = Buffer.alloc(st.size - offset)
        let bytes = 0
        while (bytes < tail.length) {
          const size = readSync(fd, tail, bytes, tail.length - bytes, offset + bytes)
          if (!size) break
          bytes += size
        }
        for (const event of eventLines(tail.toString('utf8', 0, bytes))) updateRecovery(recovery, event)
      } finally {
        closeSync(fd)
      }
    }
    return { recovery, reused: false }
  }

  get projects(): Project[] {
    return this.state.projects
  }

  get sessions(): Session[] {
    return this.state.sessions
  }

  project(id: string): Project | undefined {
    return this.state.projects.find((p) => p.id === id)
  }

  session(id: string): Session | undefined {
    return this.state.sessions.find((s) => s.id === id)
  }

  upsertProject(project: Project): void {
    const i = this.state.projects.findIndex((p) => p.id === project.id)
    if (i >= 0) this.state.projects[i] = project
    else this.state.projects.push(project)
    this.scheduleFlush()
  }

  removeProject(id: string): void {
    for (const s of this.state.sessions.filter((s) => s.projectId === id)) this.removeSession(s.id)
    this.state.projects = this.state.projects.filter((p) => p.id !== id)
    this.scheduleFlush()
  }

  upsertSession(session: Session): void {
    const i = this.state.sessions.findIndex((s) => s.id === session.id)
    if (i >= 0) this.state.sessions[i] = session
    else this.state.sessions.push(session)
    this.scheduleFlush()
  }

  removeSession(id: string): void {
    if (!this.session(id)) return
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id)
    rmSync(this.eventsPath(id), { force: true })
    this.seqs.delete(id)
    this.recovery.delete(id)
    this.recoveryDirty.add(id)
    this.secrets.delete(id)
    this.appendReady.delete(id)
    this.scheduleFlush()
  }

  private eventsPath(sessionId: string): string {
    if (!isPlainId(sessionId)) throw new Error('Invalid session id')
    return join(this.dir, 'events', `${sessionId}.jsonl`)
  }

  events(sessionId: string): SessionEvent[] {
    const path = this.eventsPath(sessionId)
    if (!existsSync(path)) return []
    const secrets: Secrets = new Map()
    return eventLines(readFileSync(path, 'utf8')).map((event) => trackSecrets(secrets, event))
  }

  private nextSeq(sessionId: string): number {
    let seq = this.seqs.get(sessionId)
    seq ??= 0
    seq += 1
    this.seqs.set(sessionId, seq)
    return seq
  }

  private prepareAppend(sessionId: string): void {
    if (this.appendReady.has(sessionId)) return
    const path = this.eventsPath(sessionId)
    if (existsSync(path)) {
      const fd = openSync(path, 'r')
      let needsNewline = false
      try {
        const size = fstatSync(fd).size
        if (size) {
          const last = Buffer.alloc(1)
          readSync(fd, last, 0, 1, size - 1)
          needsNewline = last[0] !== 10
        }
      } finally {
        closeSync(fd)
      }
      // Preserve every byte, whether the final record is valid or torn. Isolating that tail
      // keeps the next complete event from being swallowed by the invalid JSON fragment.
      if (needsNewline) appendFileSync(path, '\n', 'utf8')
    }
    this.appendReady.add(sessionId)
  }

  /**
   * Stamp an event; persist it unless it is a streaming delta, or the session was deleted while its
   * turn wound down (its events file must not come back).
   */
  record(sessionId: string, body: SessionEventBody): SessionEvent {
    const live = Boolean(this.session(sessionId))
    const seq = live ? this.nextSeq(sessionId) : 0
    const secrets = this.secrets.get(sessionId) ?? new Map()
    if (live) this.secrets.set(sessionId, secrets)
    const event = { ...trackSecrets(secrets, body), sessionId, seq, ts: Date.now() } as SessionEvent
    if (live && body.kind !== 'assistant.delta' && body.kind !== 'tool.output' && body.kind !== 'turn.progress') {
      this.prepareAppend(sessionId)
      appendFileSync(this.eventsPath(sessionId), JSON.stringify(event) + '\n', 'utf8')
      let recovery = this.recovery.get(sessionId)
      if (!recovery) this.recovery.set(sessionId, (recovery = { seq: 0, openTurn: false, pending: new Set() }))
      updateRecovery(recovery, event)
      this.recoveryDirty.add(sessionId)
    }
    return event
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), 150)
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    const recovery: Record<string, RecoveryWatermark> = Object.assign(Object.create(null), this.state.recovery)
    for (const id of this.recoveryDirty) {
      delete recovery[id]
      const state = this.recovery.get(id)
      if (!state?.seq) continue
      const path = this.eventsPath(id)
      if (!existsSync(path)) continue
      const fd = openSync(path, 'r')
      try {
        const { dev, ino, size, mtimeMs: mtime } = fstatSync(fd)
        const last = Buffer.alloc(1)
        // Only checkpoint complete record boundaries. A torn tail is replayed and repaired.
        if (size && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] === 10) {
          recovery[id] = { seq: state.seq, openTurn: state.openTurn, pending: [...state.pending], dev, ino, size, mtime }
        }
      } finally {
        closeSync(fd)
      }
    }
    this.state.recovery = recovery
    writeAtomic(join(this.dir, 'state.json'), JSON.stringify(this.state, null, 2))
    this.recoveryDirty.clear()
  }

  loadSettings(defaults: Settings): Settings {
    const saved = readJson<Partial<Settings>>(join(this.dir, 'settings.json'), {})
    return {
      ...defaults,
      ...saved,
      agents: { ...defaults.agents, ...saved.agents }
    }
  }

  saveSettings(settings: Settings): void {
    writeAtomic(join(this.dir, 'settings.json'), JSON.stringify(settings, null, 2))
  }
}
