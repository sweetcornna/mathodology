import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, Session, SessionEvent, SessionEventBody, Settings } from '@shared/types'

interface StateFile {
  version: 1
  projects: Project[]
  sessions: Session[]
}

export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, path)
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
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
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id)
    rmSync(this.eventsPath(id), { force: true })
    this.seqs.delete(id)
    this.scheduleFlush()
  }

  private eventsPath(sessionId: string): string {
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

  /** Stamp an event; persist it unless it is a streaming delta. */
  record(sessionId: string, body: SessionEventBody): SessionEvent {
    const event = { ...body, sessionId, seq: this.nextSeq(sessionId), ts: Date.now() } as SessionEvent
    if (body.kind !== 'assistant.delta' && body.kind !== 'tool.output' && body.kind !== 'turn.progress') {
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
      agents: {
        claude: { ...defaults.agents.claude, ...saved.agents?.claude },
        codex: { ...defaults.agents.codex, ...saved.agents?.codex },
        gemini: { ...defaults.agents.gemini, ...saved.agents?.gemini }
      }
    }
  }

  saveSettings(settings: Settings): void {
    writeAtomic(join(this.dir, 'settings.json'), JSON.stringify(settings, null, 2))
  }
}
