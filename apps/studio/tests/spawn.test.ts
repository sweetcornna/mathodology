import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { killAllAgents, spawnLines } from '../src/main/agents/base'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (check()) return true
  return check()
}

describe('agent processes', () => {
  it('survives a CLI that exits before reading a large prompt', async () => {
    const spawned = spawnLines('/bin/sh', ['-c', 'exit 3'], tmpdir(), process.env, () => undefined)
    // As the Claude adapter does right after spawning. The CLI never reads it, so the write fails
    // with EPIPE, which without a stdin error handler is an uncaught exception.
    spawned.child.stdin.write('x'.repeat(4_000_000))
    expect((await spawned.exited).code).toBe(3)
    await new Promise((r) => setTimeout(r, 100))
  })

  it.skipIf(process.platform === 'win32')('kills what is left of every running CLI, children included, on quit', async () => {
    const lines: string[] = []
    // A CLI that started a background job and ignores the polite signals.
    const spawned = spawnLines('/bin/sh', ['-c', "trap '' TERM INT; sleep 30 & echo $!; wait"], tmpdir(), process.env, (l) => lines.push(l))
    expect(await until(() => lines.length > 0)).toBe(true)
    const grandchild = Number(lines[0])
    expect(alive(grandchild)).toBe(true)
    spawned.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 200))
    expect(alive(spawned.child.pid!)).toBe(true)

    killAllAgents()
    expect((await spawned.exited).signal).toBe('SIGKILL')
    expect(await until(() => !alive(grandchild))).toBe(true)
  }, 30_000)
})
