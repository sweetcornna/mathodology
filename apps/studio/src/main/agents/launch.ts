import { spawn, type ChildProcess, type ExecFileException } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { supervise } from './supervisor'

export { killTree } from './supervisor'

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

/** Run a bounded CLI probe or background command with captured output. */
export function execCli(
  binary: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  done: (err: (Error & { code?: ExecFileException['code'] }) | null, stdout: string, stderr: string) => void
): ChildProcess {
  const { file, args: argv, verbatim } = launch(binary, args)
  const child = spawn(file, argv, {
    cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', windowsHide: true, windowsVerbatimArguments: verbatim
  })
  const supervisor = supervise(child)
  let error: (Error & { code?: ExecFileException['code'] }) | null = null
  const fail = (message: string): void => {
    if (error) return
    error = new Error(message)
    supervisor.finish()
  }
  supervisor.after(options.timeout, () => fail(`${binary} timed out`))
  const collect = (stream: NodeJS.ReadableStream): (() => string) => {
    const chunks: Buffer[] = []
    let size = 0
    stream.on('data', (chunk: Buffer) => {
      if (size > options.maxBuffer) return
      size += chunk.length
      if (size <= options.maxBuffer) chunks.push(chunk)
      else fail(`${binary} exceeded the output limit`)
    })
    return () => Buffer.concat(chunks).toString('utf8')
  }
  const stdout = collect(child.stdout)
  const stderr = collect(child.stderr)
  child.once('error', (cause) => { error = cause })
  child.once('close', (code, signal) => {
    if (!error && code !== 0) error = Object.assign(new Error(`${binary} exited (${signal ?? code})`), { code: code ?? undefined })
    done(error, stdout(), stderr())
  })
  return child
}
