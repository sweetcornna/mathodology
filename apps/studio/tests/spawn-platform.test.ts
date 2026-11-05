import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnLines } from '../src/main/agents/base'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), ...mocks
}))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('platform-specific protocol cancellation', () => {
  it.each(['win32', 'darwin'] as const)('begins cancellation on %s before the protocol can close the root', async (platform) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }))
    const child = Object.assign(new EventEmitter(), {
      pid: 12345, exitCode: null as number | null, signalCode: null,
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()
    })
    const order: string[] = []
    mocks.spawn.mockReturnValue(child)
    mocks.spawnSync.mockImplementation(() => {
      expect(child.exitCode).toBeNull()
      order.push('kill tree')
      return { status: 0 }
    })
    const turn = spawnLines('mock-agent', [], '/project', {}, () => undefined)
    turn.beginStop()
    order.push('protocol interrupt')
    child.exitCode = 0
    // `close` ends the test without delivering a real OS signal for the synthetic PID.
    child.emit('close', 0, null)
    await turn.exited
    if (platform === 'win32') {
      expect(order).toEqual(['kill tree', 'protocol interrupt'])
      expect(mocks.spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/t', '/f'], expect.objectContaining({ timeout: 5000 }))
    } else {
      expect(order).toEqual(['protocol interrupt'])
      expect(mocks.spawnSync).not.toHaveBeenCalled()
    }
    turn.beginStop()
    expect(mocks.spawnSync).toHaveBeenCalledTimes(platform === 'win32' ? 1 : 0)
  })
})
