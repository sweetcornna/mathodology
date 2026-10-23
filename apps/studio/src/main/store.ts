import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, Session, SessionEvent, SessionEventBody, Settings } from '@shared/types'

interface StateFile {
  version: 1
  projects: Project[]
  sessions: Session[]
}

/** Ids name files in the data folder (events/<id>.jsonl, reviews/<id>.json), so only plain tokens are accepted. */
export function isPlainId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  // On disk before the rename, so a crash leaves the old file or the new one, never an empty one.
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, data, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
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

/** Projects, sessions and settings as JSON; each session's events as an append-only JSONL file. */
export class Store {
  private state: StateFile
  private seqs = new Map<string, number>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly dir: string) {
    mkdirSync(join(dir, 'events'), { recursive: true })
    this.state = readJson<StateFile>(join(dir, 'state.json'), { version: 1, projects: [], sessions: [] })
    // A session cannot still be running after a restart.
    for (const s of this.state.sessions) if (s.status === 'running' || s.status === 'waiting') s.status = 'idle'
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
    this.scheduleFlush()
  }

  private eventsPath(sessionId: string): string {
    if (!isPlainId(sessionId)) throw new Error('Invalid session id')
    return join(this.dir, 'events', `${sessionId}.jsonl`)
  }

  events(sessionId: string): SessionEvent[] {
    const path = this.eventsPath(sessionId)
    if (!existsSync(path)) return []
    const out: SessionEvent[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue
      try {
        out.push(JSON.parse(line) as SessionEvent)
      } catch {
        // A torn final line from a crash is skipped.
      }
    }
    return out
  }

  private nextSeq(sessionId: string): number {
    let seq = this.seqs.get(sessionId)
    if (seq === undefined) {
      const events = this.events(sessionId)
      seq = events.length ? events[events.length - 1].seq : 0
    }
    seq += 1
    this.seqs.set(sessionId, seq)
    return seq
  }

  /**
   * Stamp an event; persist it unless it is a streaming delta, or the session was deleted while its
   * turn wound down (its events file must not come back).
   */
  record(sessionId: string, body: SessionEventBody): SessionEvent {
    const live = Boolean(this.session(sessionId))
    const event = { ...body, sessionId, seq: live ? this.nextSeq(sessionId) : 0, ts: Date.now() } as SessionEvent
    if (live && body.kind !== 'assistant.delta' && body.kind !== 'tool.output' && body.kind !== 'turn.progress') {
      appendFileSync(this.eventsPath(sessionId), JSON.stringify(event) + '\n', 'utf8')
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
    writeAtomic(join(this.dir, 'state.json'), JSON.stringify(this.state, null, 2))
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
