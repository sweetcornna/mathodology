import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Settings } from '@shared/types'
import type { AgentAdapter, TurnRequest, TurnSink } from '../src/main/agents/base'
import { ArtifactStore } from '../src/main/artifacts'
import { ADAPTERS, SessionManager } from '../src/main/sessions'
import { Store } from '../src/main/store'

// No login shell and no installed CLI: the agent is the fake below.
const detection = vi.hoisted(() => ({ agentEnv: vi.fn<() => Promise<NodeJS.ProcessEnv>>() }))
vi.mock('../src/main/agents/detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/agents/detect')>()),
  agentEnv: detection.agentEnv,
  resolveBinary: () => '/usr/bin/true'
}))
beforeEach(() => detection.agentEnv.mockReset().mockResolvedValue({}))

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'studio-sess-'))
  dirs.push(d)
  return d
}

/** A turn that runs until the test finishes it, as an interrupted CLI winding down would. */
function fakeAgent(): { requests: TurnRequest[]; finish(): Promise<void> } {
  const turns: { sink: TurnSink; end(): void }[] = []
  const requests: TurnRequest[] = []
  const adapter: AgentAdapter = {
    ...ADAPTERS.claude,
    start(req, sink) {
      requests.push(req)
      let end = (): void => undefined
      const done = new Promise<void>((r) => (end = r))
      turns.push({ sink, end })
      return { interrupt() {}, respondPermission() {}, done }
    }
  }
  ADAPTERS.claude = adapter
  return {
    requests,
    async finish() {
      for (const t of turns.splice(0)) {
        t.sink.emit({ kind: 'assistant.text', blockId: 'b', text: 'late reply' })
        t.sink.emit({ kind: 'turn.completed', ok: false, summary: 'interrupted', usage: { inputTokens: 5 } })
        t.end()
      }
      await new Promise((r) => setTimeout(r, 20))
    }
  }
}

function setup() {
  const data = temp()
  // One level down, so a name that escapes the project still lands in a folder the test removes.
  const path = join(temp(), 'project')
  mkdirSync(path)
  const project: Project = { id: 'p1', name: 'P', path, contest: 'MCM', createdAt: 0, kitInstalled: true }
  const store = new Store(data)
  store.upsertProject(project)
  const changed: string[] = []
  const manager = new SessionManager(store, new ArtifactStore(join(data, 'artifacts')), () => ({ agents: { claude: { binaryPath: '', defaultModel: '', extraArgs: '', env: '' } }, connectors: [] }) as unknown as Settings, {
    event: () => undefined,
    changed: (s) => changed.push(s.id),
    filesChanged: () => undefined,
    artifactsChanged: () => undefined
  })
  const session = manager.create({ projectId: 'p1', agent: 'claude', permissionMode: 'ask' })
  return { data, project, store, manager, session, changed }
}

describe('deleting while a turn winds down', () => {
  it('does not bring a deleted session back', async () => {
    const agent = fakeAgent()
    const { data, store, manager, session, changed } = setup()
    await manager.send({ sessionId: session.id, text: 'hi', attachments: [] })
    manager.interrupt(session.id)
    store.removeSession(session.id)
    changed.length = 0
    await agent.finish()
    expect(store.session(session.id)).toBeUndefined()
    expect(changed).toEqual([])
    expect(existsSync(join(data, 'events', `${session.id}.jsonl`))).toBe(false)
    store.flush()
    expect(readFileSync(join(data, 'state.json'), 'utf8')).not.toContain(session.id)
  })

  it('leaves no orphan sessions when the project is removed', async () => {
    const agent = fakeAgent()
    const { data, store, manager, session } = setup()
    await manager.send({ sessionId: session.id, text: 'hi', attachments: [] })
    store.removeProject('p1')
    await agent.finish()
    expect(store.sessions).toEqual([])
    expect(existsSync(join(data, 'events', `${session.id}.jsonl`))).toBe(false)
    expect(() => manager.create({ projectId: 'p1', agent: 'claude', permissionMode: 'ask' })).toThrow('Unknown project')
    store.flush()
  })

  it('does not start a turn for a session deleted before the agent starts', async () => {
    const agent = fakeAgent()
    const { store, manager, session } = setup()
    const sending = manager.send({ sessionId: session.id, text: 'hi', attachments: [] })
    store.removeSession(session.id)
    await sending
    expect(agent.requests).toEqual([])
    expect(manager.isRunning(session.id)).toBe(false)
    store.flush()
  })
})

describe('reserving a turn before asynchronous preparation', () => {
  function delayedEnvironment(): () => void {
    let resolve!: (env: NodeJS.ProcessEnv) => void
    detection.agentEnv.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    return () => resolve({})
  }

  function controlledAgent() {
    const requests: TurnRequest[] = []
    const turns: { sink: TurnSink; end(): void }[] = []
    ADAPTERS.claude = {
      ...ADAPTERS.claude,
      start(req, sink) {
        requests.push(req)
        let end!: () => void
        const done = new Promise<void>((resolve) => { end = resolve })
        turns.push({ sink, end })
        return { done, interrupt() {}, respondPermission() {} }
      }
    }
    return { requests, turns }
  }

  it('queues simultaneous sends and keeps the next turn owned when old callbacks arrive', async () => {
    const release = delayedEnvironment()
    const agent = controlledAgent()
    const { store, manager, session } = setup()
    const first = manager.send({ sessionId: session.id, text: 'first', attachments: [] })
    await manager.send({ sessionId: session.id, text: 'second', attachments: [] })
    expect(manager.isRunning(session.id)).toBe(true)
    expect(store.session(session.id)?.status).toBe('running')
    expect(store.session(session.id)?.queue?.map((q) => q.text)).toEqual(['second'])
    expect(agent.requests).toHaveLength(0)
    release()
    await first
    expect(agent.requests.map((r) => r.prompt)).toEqual(['first'])
    agent.turns[0].sink.emit({ kind: 'turn.completed', ok: true })
    agent.turns[0].end()
    await new Promise((r) => setTimeout(r, 0))
    expect(agent.requests.map((r) => r.prompt)).toEqual(['first', 'second'])
    agent.turns[0].sink.emit({ kind: 'turn.completed', ok: false })
    expect(manager.isRunning(session.id)).toBe(true)
    expect(store.session(session.id)?.status).toBe('running')
    expect(store.events(session.id).filter((e) => e.kind === 'turn.completed')).toHaveLength(1)
    agent.turns[1].sink.emit({ kind: 'turn.completed', ok: true })
    agent.turns[1].end()
    await Promise.resolve()
    expect(manager.isRunning(session.id)).toBe(false)
    store.flush()
  })

  it('stops pending preparation immediately and cannot remove a newer turn when it resumes', async () => {
    const release = delayedEnvironment()
    const agent = controlledAgent()
    const { store, manager, session } = setup()
    const first = manager.send({ sessionId: session.id, text: 'cancelled', attachments: [] })
    manager.interrupt(session.id)
    expect(manager.isRunning(session.id)).toBe(false)
    expect(store.events(session.id).at(-1)).toMatchObject({ kind: 'turn.completed', ok: false, summary: 'interrupted' })
    await manager.send({ sessionId: session.id, text: 'replacement', attachments: [] })
    release()
    await first
    expect(agent.requests.map((r) => r.prompt)).toEqual(['replacement'])
    expect(manager.isRunning(session.id)).toBe(true)
    expect(store.session(session.id)?.status).toBe('running')
    agent.turns[0].sink.emit({ kind: 'turn.completed', ok: true })
    agent.turns[0].end()
    await Promise.resolve()
    store.flush()
  })

  it('shuts down a pending start without launching later or accepting more messages', async () => {
    const release = delayedEnvironment()
    const agent = fakeAgent()
    const { store, manager, session } = setup()
    const sending = manager.send({ sessionId: session.id, text: 'hi', attachments: [] })
    await manager.shutdown()
    release()
    await sending
    expect(agent.requests).toEqual([])
    expect(manager.isRunning(session.id)).toBe(false)
    expect(store.session(session.id)?.status).toBe('idle')
    await expect(manager.send({ sessionId: session.id, text: 'late', attachments: [] })).rejects.toThrow('shutting down')
    store.flush()
  })

  it('releases a reservation when environment preparation fails', async () => {
    detection.agentEnv.mockRejectedValueOnce(new Error('environment unavailable'))
    const agent = fakeAgent()
    const { store, manager, session } = setup()
    await expect(manager.send({ sessionId: session.id, text: 'first', attachments: [] })).rejects.toThrow('environment unavailable')
    expect(manager.isRunning(session.id)).toBe(false)
    expect(store.session(session.id)?.status).toBe('error')
    expect(store.events(session.id).at(-1)).toMatchObject({ kind: 'turn.completed', ok: false })
    await manager.send({ sessionId: session.id, text: 'retry', attachments: [] })
    expect(agent.requests.map((r) => r.prompt)).toEqual(['retry'])
    await agent.finish()
    store.flush()
  })

  it.each(['stop', 'delete'] as const)('ignores a preparation error arriving after %s', async (action) => {
    let reject!: (err: Error) => void
    detection.agentEnv.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const agent = fakeAgent()
    const { store, manager, session, data } = setup()
    const sending = manager.send({ sessionId: session.id, text: 'first', attachments: [] })
    manager.interrupt(session.id)
    if (action === 'delete') store.removeSession(session.id)
    reject(new Error('late environment failure'))
    await expect(sending).resolves.toBeUndefined()
    expect(agent.requests).toEqual([])
    expect(manager.isRunning(session.id)).toBe(false)
    if (action === 'delete') {
      expect(store.session(session.id)).toBeUndefined()
      expect(existsSync(join(data, 'events', `${session.id}.jsonl`))).toBe(false)
    } else {
      expect(store.session(session.id)?.status).toBe('idle')
      expect(store.events(session.id).filter((e) => e.kind === 'notice')).toEqual([])
    }
    store.flush()
  })
})

describe('attachments', () => {
  it('copies into the attachments folder whatever the name says', async () => {
    const agent = fakeAgent()
    const { project, store, manager, session } = setup()
    const source = join(temp(), 'data.csv')
    writeFileSync(source, 'a,b\n')
    await manager.send({ sessionId: session.id, text: 'look', attachments: [{ name: '../../escaped.csv', path: source }, { name: '..', path: source }] })
    expect(existsSync(join(project.path, '..', 'escaped.csv'))).toBe(false)
    expect(readFileSync(join(project.path, 'attachments/escaped.csv'), 'utf8')).toBe('a,b\n')
    expect(existsSync(join(project.path, 'attachments/attachment'))).toBe(true)
    expect(agent.requests[0].prompt).toContain('attachments/escaped.csv, attachments/attachment')
    await agent.finish()
    store.flush()
  })
})

describe('a CLI that cannot be started', () => {
  it('ends the turn with an error instead of leaving the session running', async () => {
    ADAPTERS.claude = {
      ...ADAPTERS.claude,
      start() {
        // What spawn throws on Windows for a command line over 32,767 characters.
        throw new Error('spawn ENAMETOOLONG')
      }
    }
    const { store, manager, session } = setup()
    await manager.send({ sessionId: session.id, text: 'hi', attachments: [] })
    expect(store.session(session.id)?.status).toBe('error')
    const events = store.events(session.id)
    expect(events.find((e) => e.kind === 'notice')).toMatchObject({ level: 'error', text: expect.stringContaining('spawn ENAMETOOLONG') })
    expect(events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false })
    expect(manager.isRunning(session.id)).toBe(false)
    store.flush()
  })
})

describe('switching agents mid-turn', () => {
  it('does not give the new agent the old turn’s conversation id', async () => {
    const sinks: TurnSink[] = []
    let end = (): void => undefined
    ADAPTERS.claude = {
      ...ADAPTERS.claude,
      start(_req, sink) {
        sinks.push(sink)
        return { interrupt() {}, respondPermission() {}, done: new Promise<void>((r) => (end = r)) }
      }
    }
    const { store, manager, session } = setup()
    await manager.send({ sessionId: session.id, text: 'hi', attachments: [] })
    manager.update(session.id, { agent: 'codex' })
    sinks[0].nativeSession('claude-conversation')
    sinks[0].emit({ kind: 'turn.completed', ok: true })
    end()
    await new Promise((r) => setTimeout(r, 20))
    expect(store.session(session.id)).toMatchObject({ agent: 'codex', nativeSessionId: undefined })
    store.flush()
  })

  it('offers a fresh session id only to CLIs that take one', () => {
    expect(ADAPTERS.qoder.takesSessionId).toBe(true)
    expect(ADAPTERS.pi.takesSessionId).toBe(true)
    expect(ADAPTERS.codex.takesSessionId).toBeFalsy()
    expect(ADAPTERS.omp.takesSessionId).toBe(false)
    expect(ADAPTERS.opencode.takesSessionId).toBeFalsy()
  })
})
