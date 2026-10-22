import { execFile, spawn, type ChildProcess, type ExecFileException, type ExecFileOptions } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

/** How to start a CLI: the program, its arguments and whether they are already quoted for cmd.exe. */
export interface Launch {
  file: string
  args: string[]
  verbatim: boolean
}

// The target of an npm, pnpm or yarn .cmd shim: `"%dp0%\node_modules\pkg\cli.js" %*`.
const SHIM_TARGET = /"%~?dp0%?\\([^"%]+)"\s+%\*/i
// cmd.exe metacharacters, escaped with a caret (the set cross-spawn uses).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** The program a .cmd shim really runs, so arguments reach it without cmd.exe in between. */
function unwrapShim(shim: string): Launch | undefined {
  try {
    const target = SHIM_TARGET.exec(readFileSync(shim, 'utf8'))?.[1]
    if (!target) return undefined
    const dir = dirname(shim)
    const script = join(dir, ...target.split('\\'))
    if (!existsSync(script)) return undefined
    const ext = extname(script).toLowerCase()
    if (ext === '.exe') return { file: script, args: [], verbatim: false }
    if (!['.js', '.cjs', '.mjs'].includes(ext)) return undefined
    const local = join(dir, 'node.exe')
    return { file: existsSync(local) ? local : 'node', args: [script], verbatim: false }
  } catch {
    return undefined
  }
}

/** Quote one argument for a .cmd file run by `cmd /c`; the shim expands it once more through %*. */
function cmdArg(arg: string): string {
  // cmd.exe ends a command at a line break, so a multi-line argument becomes one line.
  const flat = arg.replace(/\r?\n/g, ' ')
  const quoted = `"${flat.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
  return quoted.replace(CMD_META, '^^^$1')
}

/**
 * Windows starts .cmd and .bat files only through cmd.exe, whose quoting cannot carry line breaks
 * and differs from every other program's. npm-style shims are unwrapped to `node <script>`; any
 * other batch file goes through cmd.exe with each metacharacter escaped.
 */
export function launch(binary: string, args: string[], platform: NodeJS.Platform = process.platform): Launch {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(binary)) return { file: binary, args, verbatim: false }
  const shim = unwrapShim(binary)
  if (shim) return { ...shim, args: [...shim.args, ...args] }
  const line = [binary.replace(CMD_META, '^$1'), ...args.map(cmdArg)].join(' ')
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/** execFile for an agent CLI, with Windows shims handled and no console window. */
export function execCli(
  binary: string,
  args: string[],
  options: ExecFileOptions,
  done: (err: ExecFileException | null, stdout: string, stderr: string) => void
): ChildProcess {
  const l = launch(binary, args)
  return execFile(l.file, l.args, { ...options, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: l.verbatim }, (err, stdout, stderr) =>
    done(err, String(stdout), String(stderr))
  )
}

/**
 * Stop a CLI and whatever it started. On POSIX the CLI leads its own process group; Windows has no
 * groups, so taskkill walks the process tree (a shim or wrapper alone would leave the agent running).
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => child.kill(signal))
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    // ESRCH: the group is already gone, or the CLI never got one.
    child.kill(signal)
  }
}
