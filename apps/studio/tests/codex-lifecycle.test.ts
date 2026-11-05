import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEventBody } from '@shared/types'
import type { SpawnedTurn, TurnRequest } from '../src/main/agents/base'
import { codexAdapter } from '../src/main/agents/codex'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('../src/main/agents/base', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/agents/base')>(),
  spawnLines: spawnMock
}))

type Frame = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown }
type Exit = Awaited<SpawnedTurn['exited']>

const req: TurnRequest = {
  binary: 'mock-codex', cwd: '/test/project', prompt: 'Complete the task', permissionMode: 'ask',
  settings: { binaryPath: '', defaultModel: '', extraArgs: '', env: '' }, env: {}
}

function server() {
  let onLine!: (line: string) => void
  let resolveExit!: (exit: Exit) => void
  const sent: Frame[] = []
  const stdin = {
    destroyed: false,
    writableEnded: false,
    write: vi.fn((line: string) => { sent.push(JSON.parse(line) as Frame); return true }),
    end: vi.fn(() => { stdin.writableEnded = true })
  }
  const child = { stdin, exitCode: null as number | null, signalCode: null }
  const kill = vi.fn()
  const beginStop = vi.fn()
  const exited = new Promise<Exit>((resolve) => { resolveExit = resolve })
  spawnMock.mockImplementation((_binary, _args, _cwd, _env, receive: (line: string) => void): SpawnedTurn => {
    onLine = receive
    return { child: child as unknown as ChildProcessWithoutNullStreams, exited, kill, beginStop }
  })
  const events: SessionEventBody[] = []
  const nativeSession = vi.fn()
  const turn = codexAdapter.start(req, { emit: (event) => events.push(event), nativeSession })
  const receive = (frame: Frame): void => onLine(JSON.stringify(frame))
  const respond = async (method: string, result: unknown): Promise<void> => {
    const call = sent.findLast((frame) => frame.method === method)
    expect(call, `Missing client request ${method}`).toBeDefined()
    receive({ id: call!.id, result })
    await Promise.resolve()
  }
  return {
    turn, events, sent, stdin, child, kill, beginStop, nativeSession, receive, respond,
    async initialize() {
      await respond('initialize', {})
      await respond('thread/start', { thread: { id: 'parent-thread' } })
    },
    async startTurn() {
      await respond('turn/start', { turn: { id: 'parent-turn' } })
    },
    async exit() {
      child.exitCode = 0
      resolveExit({ code: 0, signal: null, stderr: '' })
      await turn.done
    }
  }
}

beforeEach(() => {
  spawnMock.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Codex app-server turn lifecycle', () => {
  it.each(['initialize', 'thread/start', 'turn/start'])('does not resume startup after cancellation while awaiting %s', async (stage) => {
    const app = server()
    if (stage !== 'initialize') await app.respond('initialize', {})
    if (stage === 'turn/start') await app.respond('thread/start', { thread: { id: 'parent-thread' } })
    const before = app.sent.length
    app.turn.interrupt()
    expect(app.beginStop).toHaveBeenCalledOnce()
    expect(app.kill).toHaveBeenCalledWith('SIGTERM')
    await app.respond(stage, stage === 'thread/start' ? { thread: { id: 'parent-thread' } } : { turn: { id: 'parent-turn' } })
    expect(app.sent).toHaveLength(before)
    await app.exit()
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false, summary: 'interrupted' })
    expect(app.events.some((event) => event.kind === 'turn.completed' && event.ok)).toBe(false)
    const kills = app.kill.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(app.kill).toHaveBeenCalledTimes(kills)
  })

  it('still escalates a cancelled process group after its leader has exited', async () => {
    const app = server()
    await app.initialize()
    await app.startTurn()
    app.turn.interrupt()
    app.child.exitCode = 0
    await vi.advanceTimersByTimeAsync(8_000)
    expect(app.kill).toHaveBeenCalledWith('SIGKILL')
    await app.exit()
  })

  it('allows stopping a completed turn whose process has not closed yet', async () => {
    const app = server()
    await app.initialize()
    await app.startTurn()
    app.receive({ method: 'turn/completed', params: { threadId: 'parent-thread', turn: { id: 'parent-turn', status: 'completed' } } })
    app.turn.interrupt()
    expect(app.beginStop).toHaveBeenCalledOnce()
    expect(app.kill).toHaveBeenCalledWith('SIGTERM')
    expect(app.sent.some((frame) => frame.method === 'turn/interrupt')).toBe(false)
    await app.exit()
    expect(app.events.filter((event) => event.kind === 'turn.completed')).toHaveLength(1)
  })

  it('declines pending and late approvals after interruption without leaving permission cards open', async () => {
    const app = server()
    await app.initialize()
    await app.startTurn()
    app.receive({ id: 81, method: 'item/commandExecution/requestApproval', params: { command: 'touch result' } })
    app.turn.interrupt()
    expect(app.sent).toContainEqual({ id: 81, result: { decision: 'decline' } })
    app.receive({ id: 82, method: 'item/commandExecution/requestApproval', params: { command: 'touch other-result' } })
    expect(app.sent.at(-1)).toEqual({ id: 82, result: { decision: 'decline' } })
    app.turn.respondPermission('82', true)
    expect(app.sent.at(-1)).toEqual({ id: 82, result: { decision: 'decline' } })
    await app.exit()
    expect(app.events.filter((event) => event.kind === 'permission.resolved')).toEqual([
      { kind: 'permission.resolved', requestId: '81', allow: false },
      { kind: 'permission.resolved', requestId: '82', allow: false }
    ])
  })

  it('keeps stdin open when a child finishes and closes it once when the parent finishes', async () => {
    const app = server()
    await app.initialize()
    await app.startTurn()
    app.receive({ method: 'turn/started', params: { threadId: 'child-thread', turn: { id: 'child-turn' } } })
    app.receive({ method: 'turn/completed', params: { threadId: 'child-thread', turn: { id: 'child-turn', status: 'completed', durationMs: 346956 } } })
    expect(app.stdin.end).not.toHaveBeenCalled()
    expect(app.events.filter((event) => event.kind === 'turn.completed')).toEqual([])

    app.receive({ method: 'item/agentMessage/delta', params: { threadId: 'parent-thread', turnId: 'parent-turn', itemId: 'parent-message', delta: 'Continuing the parent task' } })
    expect(app.events.at(-1)).toMatchObject({ kind: 'assistant.delta', text: 'Continuing the parent task' })
    const completed = { method: 'turn/completed', params: { threadId: 'parent-thread', turn: { id: 'parent-turn', status: 'completed', durationMs: 600000 } } }
    app.receive(completed)
    app.receive(completed)
    app.receive({ method: 'thread/tokenUsage/updated', params: { threadId: 'parent-thread', turnId: 'parent-turn', tokenUsage: { last: { inputTokens: 10 } } } })
    expect(app.stdin.end).toHaveBeenCalledTimes(1)
    expect(app.events.filter((event) => event.kind === 'turn.completed')).toEqual([
      expect.objectContaining({ ok: true, durationMs: 600000 })
    ])
    await app.exit()
    expect(app.kill).not.toHaveBeenCalled()
  })

  it('interrupts the parent turn even after receiving a child turn started notification', async () => {
    const app = server()
    await app.initialize()
    await app.startTurn()
    app.receive({ method: 'turn/started', params: { threadId: 'child-thread', turn: { id: 'child-turn' } } })
    app.turn.interrupt()
    expect(app.sent.at(-1)).toMatchObject({ method: 'turn/interrupt', params: { threadId: 'parent-thread', turnId: 'parent-turn' } })
    expect(app.beginStop.mock.invocationCallOrder[0]).toBeLessThan(app.stdin.write.mock.invocationCallOrder.at(-1)!)
    await app.respond('turn/interrupt', {})
    app.receive({ method: 'turn/completed', params: { threadId: 'parent-thread', turn: { id: 'parent-turn', status: 'interrupted' } } })
    await app.exit()
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false, summary: 'interrupted' })
  })

  it('waits for the turn/start response before accepting interleaved startup notifications', async () => {
    const app = server()
    await app.initialize()
    app.receive({ method: 'turn/started', params: { threadId: 'parent-thread', turn: { id: 'older-turn' } } })
    app.receive({ method: 'turn/completed', params: { threadId: 'parent-thread', turn: { id: 'older-turn', status: 'completed' } } })
    app.receive({ method: 'turn/started', params: { threadId: 'child-thread', turn: { id: 'child-turn' } } })
    app.receive({ method: 'turn/completed', params: { threadId: 'child-thread', turn: { id: 'child-turn', status: 'completed' } } })
    app.receive({ method: 'turn/started', params: { threadId: 'parent-thread', turn: { id: 'parent-turn' } } })
    app.receive({ method: 'item/agentMessage/delta', params: { threadId: 'parent-thread', turnId: 'parent-turn', itemId: 'parent-message', delta: 'Ready' } })
    expect(app.stdin.end).not.toHaveBeenCalled()

    await app.startTurn()
    expect(app.stdin.end).not.toHaveBeenCalled()
    expect(app.events.filter((event) => event.kind === 'assistant.delta')).toEqual([
      { kind: 'assistant.delta', blockId: 'parent-message', text: 'Ready' }
    ])
    expect(app.events.filter((event) => event.kind === 'turn.completed')).toEqual([])
    app.receive({ method: 'turn/completed', params: { threadId: 'parent-thread', turn: { id: 'parent-turn', status: 'completed' } } })
    expect(app.stdin.end).toHaveBeenCalledTimes(1)
    await app.exit()
  })

  it('handles child approvals immediately during startup and resolves them after parent completion', async () => {
    const app = server()
    await app.initialize()
    const params = { threadId: 'child-thread', turnId: 'child-turn', itemId: 'child-command', command: 'python verify.py' }
    app.receive({ id: 70, method: 'item/commandExecution/requestApproval', params })
    expect(app.events.at(-1)).toMatchObject({ kind: 'permission.request', requestId: '70' })
    app.turn.respondPermission('70', true)
    expect(app.sent.at(-1)).toEqual({ id: 70, result: { decision: 'accept' } })

    const fileParams = { threadId: 'child-thread', turnId: 'child-turn', itemId: 'child-edit' }
    app.receive({ method: 'item/started', params: {
      ...fileParams, item: { type: 'fileChange', id: 'child-edit', changes: [{ path: '/test/project/results/evidence.json', kind: { type: 'add' }, diff: '+{}' }] }
    } })
    app.receive({ id: 71, method: 'item/fileChange/requestApproval', params: fileParams })
    expect(app.events.at(-1)).toMatchObject({
      kind: 'permission.request', requestId: '71', title: 'evidence.json',
      input: { changes: [{ path: '/test/project/results/evidence.json', kind: 'add' }] }
    })
    app.receive({ method: 'serverRequest/resolved', params: { ...fileParams, requestId: 71 } })
    expect(app.events.at(-1)).toMatchObject({ kind: 'permission.resolved', requestId: '71' })
    const sentBefore = app.sent.length
    app.turn.respondPermission('71', true)
    expect(app.sent).toHaveLength(sentBefore)

    await app.startTurn()
    expect(app.events.filter((event) => event.kind === 'tool.call')).toEqual([])
    app.receive({ id: 72, method: 'item/commandExecution/requestApproval', params })
    app.receive({ method: 'turn/completed', params: { threadId: 'parent-thread', turn: { id: 'parent-turn', status: 'completed' } } })
    app.receive({ method: 'serverRequest/resolved', params: { ...params, requestId: 72 } })
    expect(app.events.at(-1)).toMatchObject({ kind: 'permission.resolved', requestId: '72' })
    expect(app.stdin.end).toHaveBeenCalledTimes(1)
    await app.exit()
    expect(app.events.filter((event) => event.kind === 'permission.resolved' && event.requestId === '72')).toHaveLength(1)
  })
})
