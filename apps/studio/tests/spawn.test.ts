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
  function backgroundJob(redirect: boolean) {
    const lines: string[] = []
    const script = `
      const { spawn } = require('node:child_process');
      const worker = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], {
        stdio: ['ignore', ${redirect ? "'ignore', 'ignore'" : "'inherit', 'inherit'"}, 'ipc']
      });
      worker.on('message', () => { worker.disconnect(); console.log(worker.pid); });
      process.stdin.once('data', () => process.exit(0));
    `
    const spawned = spawnLines(process.execPath, ['-e', script], tmpdir(), process.env, (line) => lines.push(line))
    return { spawned, lines }
  }

  it.skipIf(process.platform === 'win32').each([false, true])('cleans cancelled descendants when the leader exits (redirected output: %s)', async (redirect) => {
    const { spawned, lines } = backgroundJob(redirect)
    try {
      expect(await until(() => lines.length > 0)).toBe(true)
      const grandchild = Number(lines[0])
      expect(alive(grandchild)).toBe(true)
      // A protocol cancellation makes the wrapper exit without delivering any OS signal.
      spawned.beginStop()
      spawned.child.stdin.write('cancel\n')
      expect(await until(() => !alive(grandchild))).toBe(true)
      expect((await spawned.exited).code).toBe(0)
    } finally {
      try { process.kill(-spawned.child.pid!, 'SIGKILL') } catch { /* already gone */ }
    }
  }, 15_000)

  it.skipIf(process.platform === 'win32')('does not stop intentionally detached output jobs after a normal completion', async () => {
    const { spawned, lines } = backgroundJob(true)
    try {
      expect(await until(() => lines.length > 0)).toBe(true)
      spawned.child.stdin.write('complete\n')
      expect((await spawned.exited).code).toBe(0)
      expect(alive(Number(lines[0]))).toBe(true)
    } finally {
      try { process.kill(-spawned.child.pid!, 'SIGKILL') } catch { /* already gone */ }
    }
  })

  it.skipIf(process.platform === 'win32')('can escalate after the leader exited with a descendant still holding its pipes', async () => {
    const { spawned, lines } = backgroundJob(false)
    try {
      expect(await until(() => lines.length > 0)).toBe(true)
      spawned.child.stdin.write('exit\n')
      expect(await until(() => spawned.child.exitCode !== null)).toBe(true)
      expect(alive(Number(lines[0]))).toBe(true)
      spawned.kill('SIGKILL')
      expect(await until(() => !alive(Number(lines[0])))).toBe(true)
      await spawned.exited
    } finally {
      try { process.kill(-spawned.child.pid!, 'SIGKILL') } catch { /* already gone */ }
    }
  }, 15_000)

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
