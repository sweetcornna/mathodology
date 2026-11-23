import { spawnSync, type ChildProcess } from 'node:child_process'

const running = new Set<ChildProcess>()

export function killAllAgents(): void {
  for (const child of running) killTree(child, 'SIGKILL')
}

export function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

export function supervise(child: ChildProcess) {
  let closed = false
  let stopping = false
  let escalated = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  running.add(child)

  const after = (ms: number, action: () => void): (() => void) => {
    if (closed) return () => undefined
    const timer = setTimeout(() => {
      timers.delete(timer)
      action()
    }, ms)
    timers.add(timer)
    return () => {
      clearTimeout(timer)
      timers.delete(timer)
    }
  }
  const dispose = (): void => {
    closed = true
    running.delete(child)
    timers.forEach(clearTimeout)
    timers.clear()
  }
  child.once('close', dispose)
  child.once('exit', () => {
    if (stopping) killTree(child, 'SIGKILL')
    // A descendant can keep the stdio handles open after the root process exits.
    after(2500, () => {
      killTree(child, 'SIGKILL')
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
    })
  })
  const beginStop = (): void => {
    if (closed) return
    stopping = true
    // Windows taskkill must see the root PID before a protocol interrupt can make it exit.
    if (process.platform === 'win32' || child.exitCode !== null || child.signalCode !== null) killTree(child, 'SIGKILL')
  }
  const kill = (signal: NodeJS.Signals): void => {
    if (closed) return
    stopping = true
    killTree(child, signal)
  }
  const end = (): void => {
    if (child.stdin?.writable) child.stdin.end()
  }
  const stop = (grace = 1500, force = 3500, signal: NodeJS.Signals = 'SIGTERM'): void => {
    if (closed || escalated) return
    escalated = true
    after(grace, () => { end(); kill(signal) })
    after(force, () => {
      kill('SIGKILL')
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
    })
  }
  return { after, beginStop, kill, stop, finish: () => { end(); stop() } }
}

/**
 * Stop a CLI and whatever it started. On POSIX the CLI leads its own process group; Windows has no
 * groups, so taskkill walks the process tree (a shim or wrapper alone would leave the agent running).
 * It runs synchronously: on quit, Studio exits right after, and grandchildren outlive their job.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
    if (r.error) child.kill(signal)
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    // ESRCH: the group is already gone, or the CLI never got one.
    child.kill(signal)
  }
}
