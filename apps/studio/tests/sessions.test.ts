import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project, Settings } from '@shared/types'
import type { AgentAdapter, TurnRequest, TurnSink } from '../src/main/agents/base'
import { ArtifactStore } from '../src/main/artifacts'
import { ADAPTERS, SessionManager } from '../src/main/sessions'
import { Store } from '../src/main/store'

// No login shell and no installed CLI: the agent is the fake below.
vi.mock('../src/main/agents/detect', () => ({ agentEnv: async () => ({}), resolveBinary: () => '/usr/bin/true' }))

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
  const manager = new SessionManager(store, new ArtifactStore(join(data, 'artifacts')), () => ({ agents: { claude: { binaryPath: '', defaultModel: '', extraArgs: '' } } }) as Settings, {
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
  })
})
