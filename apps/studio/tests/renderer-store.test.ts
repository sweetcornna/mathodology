import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudioCalls, StudioPushes } from '@shared/ipc'
import type { AppInfo, Project, Review, Session, SessionEvent, Settings } from '@shared/types'

const info: AppInfo = {
  version: 'test', platform: 'darwin', userData: '/test/studio',
  kit: { source: '/test/kit', skills: [], roles: [], workflows: [] }
}
const settings: Settings = {
  onboarded: true, locale: 'zh-CN', theme: 'system', fontScale: 1,
  workspaceRoot: '/test', defaultAgent: 'codex', defaultPermissionMode: 'ask',
  sendWithEnter: true, installHumanizer: false, connectors: [], agents: {}
}
const project: Project = {
  id: 'p1', name: 'Test', path: '/test/project', contest: 'MCM', createdAt: 0, kitInstalled: false
}
const session: Session = {
  id: 's1', projectId: project.id, title: 'Test', agent: 'codex', permissionMode: 'ask',
  createdAt: 0, updatedAt: 0, pinned: false, archived: false, status: 'idle',
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}
const review: Review = {
  id: 'r1', sessionId: session.id, agent: 'codex', status: 'running', createdAt: 0,
  throughSeq: 0, steps: 0, findings: []
}
const channels = ['session:event', 'session:changed', 'files:changed', 'review:changed', 'artifacts:changed'] as const

function mockApi() {
  const listeners = new Map<keyof StudioPushes, Set<(payload: unknown) => void>>()
  const results: Partial<{ [K in keyof StudioCalls]: ReturnType<StudioCalls[K]> }> = {
    'app:info': info, 'settings:get': settings, 'projects:list': [project], 'sessions:list': [session],
    'agents:detect': [], 'artifacts:list': [], 'sessions:events': [], 'reviews:list': []
  }
  const call = vi.fn(async (channel: keyof StudioCalls, ..._args: unknown[]) => {
    if (!(channel in results)) throw new Error(`Unexpected IPC call: ${channel}`)
    return results[channel]
  })
  const on = vi.fn(<K extends keyof StudioPushes>(channel: K, listener: (payload: StudioPushes[K]) => void) => {
    const registered = listeners.get(channel) ?? new Set<(payload: unknown) => void>()
    listeners.set(channel, registered)
    const callback = listener as (payload: unknown) => void
    registered.add(callback)
    return vi.fn(() => { registered.delete(callback) })
  })
  vi.doMock('../src/renderer/src/lib/api', () => ({ api: { call, on, platform: 'darwin' } }))
  return {
    call, on,
    emit<K extends keyof StudioPushes>(channel: K, payload: StudioPushes[K]) {
      for (const listener of listeners.get(channel) ?? []) listener(payload)
    },
    count(channel: keyof StudioPushes) { return listeners.get(channel)?.size ?? 0 },
    calls(channel: keyof StudioCalls) { return call.mock.calls.filter(([name]) => name === channel).length }
  }
}

beforeEach(() => {
  vi.resetModules()
})

describe('renderer store lifecycle', () => {
  it('shares concurrent initialization and does not repeat successful initialization', async () => {
    const api = mockApi()
    const { useStudio } = await import('../src/renderer/src/store')
    const first = useStudio.getState().init()
    const second = useStudio.getState().init()
    await Promise.all([first, second])
    await useStudio.getState().init()

    for (const channel of ['app:info', 'settings:get', 'projects:list', 'sessions:list', 'agents:detect', 'artifacts:list'] as const) {
      expect(api.calls(channel), channel).toBe(1)
    }
    expect(useStudio.getState()).toMatchObject({ ready: true, info, settings, activeProjectId: project.id })
  })

  it('allows initialization to retry after a failed IPC request', async () => {
    const api = mockApi()
    api.call.mockRejectedValueOnce(new Error('IPC temporarily unavailable'))
    const { useStudio } = await import('../src/renderer/src/store')

    await expect(useStudio.getState().init()).rejects.toThrow('IPC temporarily unavailable')
    expect(useStudio.getState().ready).toBe(false)
    await useStudio.getState().init()
    expect(useStudio.getState().ready).toBe(true)
    expect(api.calls('app:info')).toBe(2)
    await useStudio.getState().init()
    expect(api.calls('app:info')).toBe(2)
  })

  it('handles each push once after a StrictMode remount and removes all subscriptions on unmount', async () => {
    const api = mockApi()
    const { useStudio } = await import('../src/renderer/src/store')
    const firstCleanup = useStudio.getState().subscribe()
    const firstInit = useStudio.getState().init()
    firstCleanup()
    for (const channel of channels) expect(api.count(channel), channel).toBe(0)
    const cleanup = useStudio.getState().subscribe()
    const secondInit = useStudio.getState().init()
    await Promise.all([firstInit, secondInit])
    await useStudio.getState().selectSession(session.id)
    for (const channel of channels) expect(api.count(channel), channel).toBe(1)

    const events: SessionEvent[] = [
      { kind: 'user.message', sessionId: session.id, seq: 1, ts: 1, text: 'Read the attachment', attachments: ['problem.pdf'] },
      { kind: 'assistant.text', sessionId: session.id, seq: 2, ts: 2, blockId: 'answer', text: 'I will read it.' },
      { kind: 'thinking', sessionId: session.id, seq: 3, ts: 3, blockId: 'thought', text: 'Consider the problem.' }
    ]
    for (const event of events) api.emit('session:event', event)
    expect(useStudio.getState().events[session.id]).toEqual(events)
    api.emit('session:event', {
      kind: 'assistant.delta', sessionId: session.id, seq: 4, ts: 4, blockId: 'stream', text: 'One chunk'
    })
    expect(useStudio.getState().streaming[session.id].stream.text).toBe('One chunk')

    api.emit('session:changed', { ...session, title: 'Updated' })
    expect(useStudio.getState().sessions).toEqual([{ ...session, title: 'Updated' }])
    api.emit('files:changed', { projectId: project.id })
    expect(useStudio.getState().filesVersion).toBe(1)
    api.emit('review:changed', review)
    expect(useStudio.getState().reviews[session.id]).toEqual([review])
    const artifactCalls = api.calls('artifacts:list')
    api.emit('artifacts:changed', { projectId: project.id })
    expect(api.calls('artifacts:list')).toBe(artifactCalls + 1)
    await Promise.resolve()

    cleanup()
    for (const channel of channels) expect(api.count(channel), channel).toBe(0)
    const before = useStudio.getState()
    api.emit('session:event', events[0])
    api.emit('session:changed', { ...session, title: 'Unmounted' })
    api.emit('files:changed', { projectId: project.id })
    api.emit('review:changed', { ...review, steps: 1 })
    api.emit('artifacts:changed', { projectId: project.id })
    expect(useStudio.getState()).toBe(before)
    expect(api.calls('artifacts:list')).toBe(artifactCalls + 1)

    const finalCleanup = useStudio.getState().subscribe()
    for (const channel of channels) expect(api.count(channel), channel).toBe(1)
    const resumedEvent: SessionEvent = { ...events[0], seq: 5, ts: 5 }
    api.emit('session:event', resumedEvent)
    expect(useStudio.getState().events[session.id]).toEqual([...events, resumedEvent])
    api.emit('session:changed', { ...session, title: 'Resumed' })
    expect(useStudio.getState().sessions).toEqual([{ ...session, title: 'Resumed' }])
    api.emit('files:changed', { projectId: project.id })
    expect(useStudio.getState().filesVersion).toBe(2)
    api.emit('review:changed', { ...review, steps: 2 })
    expect(useStudio.getState().reviews[session.id]).toEqual([{ ...review, steps: 2 }])
    api.emit('artifacts:changed', { projectId: project.id })
    expect(api.calls('artifacts:list')).toBe(artifactCalls + 2)
    await Promise.resolve()
    finalCleanup()
    for (const channel of channels) expect(api.count(channel), channel).toBe(0)
  })

  it('merges buffered pushed events during history hydration in seq order without dropping or duplicating', async () => {
    const api = mockApi()
    let resolveHistory!: (events: SessionEvent[]) => void
    const historyPromise = new Promise<SessionEvent[]>((resolve) => {
      resolveHistory = resolve
    })
    api.call.mockImplementation(async (channel) => {
      if (channel === 'sessions:events') return historyPromise
      if (channel === 'app:info') return info
      if (channel === 'settings:get') return settings
      if (channel === 'projects:list') return [project]
      if (channel === 'sessions:list') return [session]
      if (channel === 'agents:detect') return []
      if (channel === 'artifacts:list') return []
      if (channel === 'reviews:list') return []
      throw new Error(`Unexpected IPC call: ${channel}`)
    })

    const { useStudio } = await import('../src/renderer/src/store')
    const cleanup = useStudio.getState().subscribe()
    await useStudio.getState().init()

    const selectA = useStudio.getState().selectSession(session.id)
    const selectB = useStudio.getState().loadEvents(session.id)
    expect(api.calls('sessions:events')).toBe(1)

    // Pushes arrive while history snapshot is in flight.
    api.emit('session:event', { kind: 'assistant.delta', sessionId: session.id, seq: 0, ts: 10, blockId: 'b1', text: 'partial' })
    expect(useStudio.getState().streaming[session.id].b1.text).toBe('partial')

    const pushedOverlap: SessionEvent = { kind: 'assistant.text', sessionId: session.id, seq: 2, ts: 2, blockId: 'b0', text: 'snapshotted' }
    const pushedFinal: SessionEvent = { kind: 'assistant.text', sessionId: session.id, seq: 3, ts: 3, blockId: 'b1', text: 'complete' }
    const pushedDone: SessionEvent = { kind: 'turn.completed', sessionId: session.id, seq: 4, ts: 4, ok: true }
    api.emit('session:event', pushedOverlap)
    api.emit('session:event', pushedFinal)
    api.emit('session:event', pushedDone)
    expect(useStudio.getState().streaming[session.id]).toBeUndefined()

    const history: SessionEvent[] = [
      { kind: 'user.message', sessionId: session.id, seq: 1, ts: 1, text: 'hi', attachments: [] },
      pushedOverlap
    ]
    resolveHistory(history)
    await Promise.all([selectA, selectB])

    expect(useStudio.getState().events[session.id]).toEqual([
      history[0],
      pushedOverlap,
      pushedFinal,
      pushedDone
    ])
    cleanup()
  })

  it('preserves newer review:changed pushes when a delayed reviews:list resolves', async () => {
    const api = mockApi()
    let resolveReviews!: (list: Review[]) => void
    const reviewsPromise = new Promise<Review[]>((resolve) => {
      resolveReviews = resolve
    })
    api.call.mockImplementation(async (channel) => {
      if (channel === 'reviews:list') return reviewsPromise
      if (channel === 'app:info') return info
      if (channel === 'settings:get') return settings
      if (channel === 'projects:list') return [project]
      if (channel === 'sessions:list') return [session]
      if (channel === 'agents:detect') return []
      if (channel === 'artifacts:list') return []
      if (channel === 'sessions:events') return []
      throw new Error(`Unexpected IPC call: ${channel}`)
    })

    const { useStudio } = await import('../src/renderer/src/store')
    const cleanup = useStudio.getState().subscribe()
    await useStudio.getState().init()

    await useStudio.getState().selectSession(session.id)
    const doneReview: Review = { ...review, status: 'done', steps: 4, summary: 'Verified', finishedAt: 100 }
    const secondReview: Review = { ...review, id: 'r2', createdAt: 10, status: 'running', steps: 1 }
    api.emit('review:changed', doneReview)
    api.emit('review:changed', secondReview)

    resolveReviews([{ ...review, status: 'running', steps: 0 }])
    await Promise.resolve()
    await Promise.resolve()

    expect(useStudio.getState().reviews[session.id]).toEqual([doneReview, secondReview])
    cleanup()
  })

  it('resets draft on selectProject, ignores stale sessions:create, and preserves drafts when IPC fails', async () => {
    const project2: Project = { ...project, id: 'p2', name: 'Other', path: '/test/project2' }
    const session2: Session = { ...session, id: 's2', projectId: 'p2', agent: 'claude', permissionMode: 'bypass', model: 'opus', effort: 'high' }
    const api = mockApi()
    let resolveCreate!: (s: Session) => void
    api.call.mockImplementation(async (channel, arg1) => {
      if (channel === 'app:info') return info
      if (channel === 'settings:get') return settings
      if (channel === 'projects:list') return [project, project2]
      if (channel === 'sessions:list') return [session, session2]
      if (channel === 'agents:detect') return []
      if (channel === 'artifacts:list') return []
      if (channel === 'sessions:events') return []
      if (channel === 'reviews:list') return []
      if (channel === 'sessions:create') {
        return new Promise<Session>((resolve) => {
          resolveCreate = resolve
        })
      }
      if (channel === 'sessions:send') {
        if ((arg1 as { sessionId: string }).sessionId === session.id) throw new Error("Error invoking remote method 'sessions:send': Queue full")
        return undefined
      }
      throw new Error(`Unexpected IPC call: ${channel}`)
    })

    const { useStudio } = await import('../src/renderer/src/store')
    await useStudio.getState().init()
    await useStudio.getState().selectSession(session2.id)
    expect(useStudio.getState().draft).toEqual({ agent: 'claude', model: 'opus', effort: 'high', permissionMode: 'bypass' })

    useStudio.getState().selectProject(project.id)
    expect(useStudio.getState().activeProjectId).toBe(project.id)
    expect(useStudio.getState().activeSessionId).toBeNull()
    expect(useStudio.getState().draft).toEqual({ agent: settings.defaultAgent, model: '', effort: '', permissionMode: settings.defaultPermissionMode })

    // Start creating a session in p1, then navigate to p2 before sessions:create resolves.
    const sendPromise = useStudio.getState().send('from p1', [])
    useStudio.getState().selectProject(project2.id)
    resolveCreate({ ...session, id: 'stale-s', projectId: project.id })
    expect(await sendPromise).toBe(false)
    expect(useStudio.getState().activeProjectId).toBe(project2.id)
    expect(useStudio.getState().activeSessionId).toBeNull()
    expect(api.calls('sessions:send')).toBe(0)

    // Scoping drafts per session and keeping drafts when sessions:send rejects.
    useStudio.getState().setComposerDraft('s:s1', { text: 'unsent draft', attachments: [{ name: 'a.txt', path: '/a.txt' }] })
    useStudio.getState().setComposerDraft('s:s2', { text: 'other draft', attachments: [] })
    await useStudio.getState().selectSession(session.id)
    expect(await useStudio.getState().send('unsent draft', [{ name: 'a.txt', path: '/a.txt' }])).toBe(false)
    expect(useStudio.getState().toast?.text).toBe('Queue full')
    expect(useStudio.getState().composerDrafts['s:s1']).toEqual({ text: 'unsent draft', attachments: [{ name: 'a.txt', path: '/a.txt' }] })
    expect(useStudio.getState().composerDrafts['s:s2']).toEqual({ text: 'other draft', attachments: [] })
  })

  it('sends queued items via sessions:sendQueued and keeps editQueued session-scoped across navigation', async () => {
    const project2: Project = { ...project, id: 'p2', name: 'Other', path: '/test/project2' }
    const session2: Session = { ...session, id: 's2', projectId: 'p2' }
    const queued = { id: 'q1', text: 'from s1', attachments: [{ name: 'f.csv', path: '/f.csv' }], createdAt: 1 }
    const api = mockApi()
    let resolveDequeue!: (s: Session) => void
    api.call.mockImplementation(async (channel) => {
      if (channel === 'app:info') return info
      if (channel === 'settings:get') return settings
      if (channel === 'projects:list') return [project, project2]
      if (channel === 'sessions:list') return [{ ...session, queue: [queued] }, session2]
      if (channel === 'agents:detect') return []
      if (channel === 'artifacts:list') return []
      if (channel === 'sessions:events') return []
      if (channel === 'reviews:list') return []
      if (channel === 'sessions:sendQueued') throw new Error("Error invoking remote method 'sessions:sendQueued': Admission failed")
      if (channel === 'sessions:dequeue') {
        return new Promise<Session>((resolve) => {
          resolveDequeue = resolve
        })
      }
      throw new Error(`Unexpected IPC call: ${channel}`)
    })

    const { useStudio } = await import('../src/renderer/src/store')
    await useStudio.getState().init()
    await useStudio.getState().selectSession(session.id)

    await useStudio.getState().sendQueued(session.id, queued.id)
    expect(api.calls('sessions:sendQueued')).toBe(1)
    expect(api.calls('sessions:dequeue')).toBe(0)
    expect(useStudio.getState().toast?.text).toBe('Admission failed')

    // Start editing queued item in s1, switch to s2 before dequeue resolves.
    const editPromise = useStudio.getState().editQueued(session.id, queued)
    await useStudio.getState().selectSession(session2.id)
    resolveDequeue({ ...session, queue: [] })
    expect(await editPromise).toBe(true)

    expect(useStudio.getState().composerDrafts['s:s1']).toEqual({ text: 'from s1', attachments: [{ name: 'f.csv', path: '/f.csv' }] })
    expect(useStudio.getState().composerDrafts['s:s2']).toBeUndefined()
  })

  it('evicts caches on deletion, ignores tool.output as a no-op, keys toasts by id, and settles superseded dialogs', async () => {
    vi.useFakeTimers()
    try {
      const project2: Project = { ...project, id: 'p2', name: 'Other', path: '/test/project2' }
      const session2: Session = { ...session, id: 's2', projectId: 'p2' }
      const api = mockApi()
      api.call.mockImplementation(async (channel, arg1) => {
        if (channel === 'app:info') return info
        if (channel === 'settings:get') return settings
        if (channel === 'projects:list') return [project, project2]
        if (channel === 'sessions:list') return [session, session2]
        if (channel === 'agents:detect') return []
        if (channel === 'artifacts:list') return []
        if (channel === 'sessions:events') return []
        if (channel === 'reviews:list') return []
        if (channel === 'sessions:delete' || channel === 'projects:remove') return undefined
        if (channel === 'settings:set') return { ...settings, ...(arg1 as Partial<Settings>) }
        throw new Error(`Unexpected IPC call: ${channel}`)
      })

      const { useStudio } = await import('../src/renderer/src/store')
      const cleanup = useStudio.getState().subscribe()
      await useStudio.getState().init()
      await useStudio.getState().selectSession(session.id)
      await useStudio.getState().selectSession(session2.id)

      api.emit('session:event', { kind: 'assistant.delta', sessionId: session.id, seq: 1, ts: 1, blockId: 'b1', text: 'abc' })
      api.emit('session:event', { kind: 'user.message', sessionId: session.id, seq: 2, ts: 2, text: 'u', attachments: [] })
      api.emit('review:changed', review)
      useStudio.getState().setComposerDraft('s:s1', { text: 'draft 1' })
      useStudio.getState().setComposerDraft('p:p2', { text: 'home draft 2' })
      useStudio.getState().setComposerDraft('s:s2', { text: 'draft 2' })

      // tool.output must be an exact no-op and never notify Zustand subscribers.
      const subscriber = vi.fn()
      const unsub = useStudio.subscribe(subscriber)
      const prevState = useStudio.getState()
      api.emit('session:event', { kind: 'tool.output', sessionId: session.id, seq: 3, ts: 3, callId: 'c1', chunk: 'line\n' })
      expect(subscriber).not.toHaveBeenCalled()
      expect(useStudio.getState()).toBe(prevState)
      unsub()

      // Evict on session deletion.
      await useStudio.getState().deleteSession(session.id)
      expect(useStudio.getState().events[session.id]).toBeUndefined()
      expect(useStudio.getState().reviews[session.id]).toBeUndefined()
      expect(useStudio.getState().streaming[session.id]).toBeUndefined()
      expect(useStudio.getState().live[session.id]).toBeUndefined()
      expect(useStudio.getState().composerDrafts['s:s1']).toBeUndefined()
      expect(useStudio.getState().composerDrafts['s:s2']).toEqual({ text: 'draft 2', attachments: [] })

      // Evict on project removal.
      await useStudio.getState().removeProject(project2.id)
      expect(useStudio.getState().events[session2.id]).toBeUndefined()
      expect(useStudio.getState().composerDrafts['s:s2']).toBeUndefined()
      expect(useStudio.getState().composerDrafts['p:p2']).toBeUndefined()

      // Toast timers keyed by unique id, not text equality.
      useStudio.getState().showToast('Saved')
      vi.advanceTimersByTime(3000)
      useStudio.getState().showToast('Saved')
      vi.advanceTimersByTime(1500)
      expect(useStudio.getState().toast?.text).toBe('Saved')
      vi.advanceTimersByTime(3000)
      expect(useStudio.getState().toast).toBeNull()

      // Superseded confirm & prompt promises settle cleanly.
      const c1 = useStudio.getState().confirm({ title: 'First', body: '1' })
      const c2 = useStudio.getState().confirm({ title: 'Second', body: '2' })
      expect(await c1).toBe(false)
      useStudio.getState().confirmState?.resolve(true)
      expect(await c2).toBe(true)
      expect(useStudio.getState().confirmState).toBeNull()

      const pr1 = useStudio.getState().prompt({ title: 'P1', value: 'a' })
      const pr2 = useStudio.getState().prompt({ title: 'P2', value: 'b' })
      expect(await pr1).toBeNull()
      useStudio.getState().promptState?.resolve('renamed')
      expect(await pr2).toBe('renamed')
      expect(useStudio.getState().promptState).toBeNull()

      // Connector queue reads latest state and agent settings sends only the edited agent.
      const connA = { id: 'search', name: 'Search', enabled: true, builtin: true }
      const connB = { id: 'zotero', name: 'Zotero', enabled: true, command: 'zotero-mcp' }
      await useStudio.getState().saveSettings({ connectors: [connA] })
      await Promise.all([
        useStudio.getState().updateConnectors((list) => list.map((c) => (c.id === 'search' ? { ...c, enabled: false } : c))),
        useStudio.getState().updateConnectors((list) => [...list, connB])
      ])
      expect(useStudio.getState().settings?.connectors).toEqual([{ ...connA, enabled: false }, connB])

      await useStudio.getState().updateAgentSettings('codex', { binaryPath: '/usr/local/bin/codex', defaultModel: 'gpt-5', extraArgs: '', env: '' })
      const lastSetCall = api.call.mock.calls.filter(([ch]) => ch === 'settings:set').at(-1)
      expect(lastSetCall?.[1]).toEqual({ agents: { codex: { binaryPath: '/usr/local/bin/codex', defaultModel: 'gpt-5', extraArgs: '', env: '' } } })

      cleanup()
    } finally {
      vi.useRealTimers()
    }
  })
})
