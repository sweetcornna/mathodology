import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { whichSync } from '../src/main/agents/detect'
import { launch } from '../src/main/agents/launch'

// What `npm install -g @anthropic-ai/claude-code` writes to %APPDATA%\npm\claude.cmd.
const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`

// pnpm's global shim refers to the package store one level up.
const PNPM_SHIM = `@SETLOCAL
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\..\\.pnpm\\gemini\\bundle\\gemini.js" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\..\\.pnpm\\gemini\\bundle\\gemini.js" %*
)
`

/** A folder laid out like a Windows install; `\\` in shim targets is a separator only on Windows. */
function shimDir(shim: string, target: string, extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-shim-'))
  writeFileSync(join(dir, 'tool.cmd'), shim)
  const script = join(dir, target.replace(/\\/g, '/'))
  mkdirSync(join(script, '..'), { recursive: true })
  writeFileSync(script, '')
  for (const f of extra) writeFileSync(join(dir, f), '')
  return dir
}

describe('starting CLIs on Windows', () => {
  const prompt = 'line one\nline "two" & more'

  it('leaves other platforms and real executables alone', () => {
    expect(launch('/usr/local/bin/claude.cmd', ['-p'], 'darwin')).toEqual({ file: '/usr/local/bin/claude.cmd', args: ['-p'], verbatim: false })
    expect(launch('C:\\Users\\me\\.local\\bin\\claude.exe', ['-p', prompt], 'win32')).toEqual({
      file: 'C:\\Users\\me\\.local\\bin\\claude.exe',
      args: ['-p', prompt],
      verbatim: false
    })
  })

  it.skipIf(process.platform === 'win32')('runs the script behind an npm shim with node, arguments untouched', () => {
    const dir = shimDir(NPM_SHIM, 'node_modules\\@anthropic-ai\\claude-code\\cli.js')
    const l = launch(join(dir, 'tool.cmd'), ['--append-system-prompt', prompt], 'win32')
    expect(l.file).toBe('node')
    expect(l.args).toEqual([join(dir, 'node_modules/@anthropic-ai/claude-code/cli.js'), '--append-system-prompt', prompt])
    expect(l.verbatim).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('prefers the node.exe a shim ships with, and reads pnpm shims', () => {
    const dir = shimDir(NPM_SHIM, 'node_modules\\@anthropic-ai\\claude-code\\cli.js', ['node.exe'])
    expect(launch(join(dir, 'tool.cmd'), [], 'win32').file).toBe(join(dir, 'node.exe'))
    const pnpm = shimDir(PNPM_SHIM, '..\\.pnpm\\gemini\\bundle\\gemini.js')
    expect(launch(join(pnpm, 'tool.cmd'), ['--prompt=x'], 'win32').args).toEqual([join(pnpm, '../.pnpm/gemini/bundle/gemini.js'), '--prompt=x'])
  })

  it('escapes every argument for cmd.exe when a batch file cannot be unwrapped', () => {
    const l = launch('C:\\tools\\x.bat', ['a&b', 'say "hi"\nnow'], 'win32')
    expect(l.file).toBe(process.env.ComSpec || 'cmd.exe')
    expect(l.verbatim).toBe(true)
    expect(l.args).toEqual(['/d', '/s', '/c', '"C:\\tools\\x.bat ^^^"a^^^&b^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^ now^^^""'])
  })
})

describe('finding CLIs on PATH', () => {
  it('takes PATHEXT matches on Windows and skips the extensionless npm script', () => {
    const npm = mkdtempSync(join(tmpdir(), 'studio-path-'))
    const local = mkdtempSync(join(tmpdir(), 'studio-path-'))
    for (const f of ['claude', 'claude.cmd', 'claude.ps1', 'gemini', 'gemini.cmd']) writeFileSync(join(npm, f), '', { mode: 0o755 })
    writeFileSync(join(local, 'claude.exe'), '', { mode: 0o755 })
    mkdirSync(join(local, 'codex.exe'))
    // Windows spells the variable Path.
    const env = { Path: [local, npm].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS' }
    expect(whichSync('claude', env, 'win32')).toBe(join(local, 'claude.exe'))
    expect(whichSync('gemini', env, 'win32')).toBe(join(npm, 'gemini.cmd'))
    // A folder is not a program.
    expect(whichSync('codex', env, 'win32')).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('finds executables by their plain name elsewhere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-path-'))
    writeFileSync(join(dir, 'codex'), '', { mode: 0o755 })
    writeFileSync(join(dir, 'gemini'), '', { mode: 0o644 })
    expect(whichSync('codex', { PATH: dir }, 'darwin')).toBe(join(dir, 'codex'))
    expect(whichSync('gemini', { PATH: dir }, 'darwin')).toBeUndefined()
  })
})
