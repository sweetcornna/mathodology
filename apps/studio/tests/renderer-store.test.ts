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
})
