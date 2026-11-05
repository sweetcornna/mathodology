import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEventBody } from '@shared/types'
import type { SpawnedTurn, TurnRequest } from '../src/main/agents/base'
import { acpAdapter } from '../src/main/agents/acp'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('../src/main/agents/base', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/agents/base')>(), spawnLines: spawnMock
}))

type Frame = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }
type Exit = Awaited<SpawnedTurn['exited']>
const request: TurnRequest = {
  binary: 'mock-acp', cwd: '/test/project', prompt: 'Review the project', permissionMode: 'plan',
  settings: { binaryPath: '', defaultModel: '', extraArgs: '', env: '' }, env: {}
}
const modes = { currentModeId: 'yolo', availableModes: [{ id: 'yolo' }, { id: 'default' }, { id: 'plan' }] }

function server(overrides: Partial<TurnRequest> = {}) {
  let receive!: (line: string) => void
  let resolveExit!: (exit: Exit) => void
  const sent: Frame[] = []
  const stdin = {
    destroyed: false, writable: true,
    write: vi.fn((line: string) => { sent.push(JSON.parse(line) as Frame); return true }),
    end: vi.fn()
  }
  const child = { stdin, exitCode: null as number | null, signalCode: null }
  const kill = vi.fn()
  const beginStop = vi.fn()
  const exited = new Promise<Exit>((resolve) => { resolveExit = resolve })
  spawnMock.mockImplementation((_binary, _args, _cwd, _env, onLine: (line: string) => void): SpawnedTurn => {
    receive = onLine
    return { child: child as unknown as ChildProcessWithoutNullStreams, exited, kill, beginStop }
  })
  const events: SessionEventBody[] = []
  const turn = acpAdapter({ id: 'test-acp', name: 'Test ACP', bins: ['test-acp'], acpArgs: [] })
    .start({ ...request, ...overrides }, { emit: (event) => events.push(event), nativeSession: vi.fn() })
  const respond = async (method: string, result: unknown, error?: unknown): Promise<void> => {
    const call = sent.findLast((frame) => frame.method === method)
    expect(call, `Missing client request ${method}`).toBeDefined()
    receive(JSON.stringify({ id: call!.id, ...(error ? { error } : { result }) }))
    await Promise.resolve()
    await Promise.resolve()
  }
  return {
    sent, turn, events, child, kill, beginStop, stdin, respond,
    async initialize() { await respond('initialize', { agentCapabilities: { loadSession: true } }) },
    async newSession(session: Record<string, unknown> = { modes }) {
      await respond(overrides.resumeId ? 'session/load' : 'session/new', { sessionId: 'test-session', ...session })
    },
    async exit() {
      child.exitCode = 0
      resolveExit({ code: 0, signal: null, stderr: '' })
      await turn.done
    }
  }
}

beforeEach(() => { spawnMock.mockReset(); vi.useFakeTimers() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('ACP permission and cancellation lifecycle', () => {
  it.each(['plan', 'ask'] as const)('does not send a prompt when switching to %s fails', async (permissionMode) => {
    const app = server({ permissionMode, resumeId: 'previous-session' })
    await app.initialize()
    await app.newSession()
    await app.respond('session/set_mode', undefined, { code: -32602, message: 'Mode switch rejected' })
    expect(app.sent.some((frame) => frame.method === 'session/prompt')).toBe(false)
    expect(app.events).toContainEqual(expect.objectContaining({ kind: 'notice', level: 'error', text: expect.stringContaining('Mode switch rejected') }))
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false })
    await app.exit()
  })

  it.each([
    { permissionMode: 'plan', session: { modes: { currentModeId: 'yolo', availableModes: [{ id: 'yolo' }] } } },
    { permissionMode: 'ask', session: { modes: { currentModeId: 'yolo', availableModes: [{ id: 'yolo' }] } } },
    { permissionMode: 'plan', session: {} },
    { permissionMode: 'plan', resumeId: 'old', session: {} },
    { permissionMode: 'ask', resumeId: 'old', session: { modes: { currentModeId: 'yolo' } } }
  ] as const)('refuses an unverified restrictive mode: %j', async ({ permissionMode, session, ...rest }) => {
    const app = server({ permissionMode, ...rest })
    await app.initialize()
    await app.newSession(session)
    expect(app.sent.some((frame) => frame.method === 'session/prompt')).toBe(false)
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false })
    await app.exit()
  })

  it.each(['plan', 'ask', 'acceptEdits'] as const)('sends the prompt only after establishing %s mode', async (permissionMode) => {
    const app = server({ permissionMode })
    await app.initialize()
    await app.newSession()
    expect(app.sent.at(-1)).toMatchObject({ method: 'session/set_mode', params: { modeId: permissionMode === 'plan' ? 'plan' : 'default' } })
    expect(app.sent.some((frame) => frame.method === 'session/prompt')).toBe(false)
    await app.respond('session/set_mode', {})
    expect(app.sent.at(-1)).toMatchObject({ method: 'session/prompt' })
    await app.respond('session/prompt', { stopReason: 'end_turn' })
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: true })
    await app.exit()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(app.kill).not.toHaveBeenCalled()
  })

  it.each(['ask', 'acceptEdits'] as const)('keeps fresh no-mode ACP agents usable with %s permission callbacks', async (permissionMode) => {
    const app = server({ permissionMode })
    await app.initialize()
    await app.newSession({})
    expect(app.sent.at(-1)).toMatchObject({ method: 'session/prompt' })
    await app.respond('session/prompt', { stopReason: 'end_turn' })
    await app.exit()
  })

  it.each(['ask', 'acceptEdits'] as const)('resumes no-mode ACP agents with %s permission callbacks', async (permissionMode) => {
    const app = server({ permissionMode, resumeId: 'existing-session' })
    await app.initialize()
    await app.newSession({})
    expect(app.sent.at(-1)).toMatchObject({ method: 'session/prompt', params: { sessionId: 'existing-session' } })
    expect(app.sent.some((frame) => frame.method === 'session/set_mode')).toBe(false)
    await app.respond('session/prompt', { stopReason: 'end_turn' })
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: true })
    await app.exit()
  })

  it.each(['initialize', 'session/new', 'session/set_mode'])('never sends a prompt after cancellation during %s', async (stage) => {
    const app = server()
    if (stage !== 'initialize') await app.initialize()
    if (stage === 'session/set_mode') await app.newSession()
    app.turn.interrupt()
    expect(app.beginStop).toHaveBeenCalledOnce()
    expect(app.kill).toHaveBeenCalledWith('SIGTERM')
    await app.respond(stage, { sessionId: 'test-session', modes })
    expect(app.sent.some((frame) => frame.method === 'session/prompt')).toBe(false)
    await app.exit()
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false, summary: 'interrupted' })
  })

  it('cancels an active prompt and escalates even if its leader exits first', async () => {
    const app = server()
    await app.initialize()
    await app.newSession()
    await app.respond('session/set_mode', {})
    app.turn.interrupt()
    expect(app.sent.at(-1)).toMatchObject({ method: 'session/cancel' })
    expect(app.beginStop.mock.invocationCallOrder[0]).toBeLessThan(app.stdin.write.mock.invocationCallOrder.at(-1)!)
    app.child.exitCode = 0
    await vi.advanceTimersByTimeAsync(9_000)
    expect(app.kill).toHaveBeenCalledWith('SIGKILL')
    await app.respond('session/prompt', { stopReason: 'end_turn' })
    expect(app.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: false, summary: 'interrupted' })
    await app.exit()
  })

  it('allows cancelling lingering processes after a successful prompt result', async () => {
    const app = server({ permissionMode: 'ask' })
    await app.initialize()
    await app.newSession({})
    await app.respond('session/prompt', { stopReason: 'end_turn' })
    app.turn.interrupt()
    expect(app.beginStop).toHaveBeenCalledOnce()
    expect(app.kill).toHaveBeenCalledWith('SIGTERM')
    expect(app.sent.some((frame) => frame.method === 'session/cancel')).toBe(false)
    await app.exit()
    expect(app.events.filter((event) => event.kind === 'turn.completed')).toHaveLength(1)
  })
})
