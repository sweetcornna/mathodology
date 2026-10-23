import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parseEnv } from '@shared/args'
import { agentSpec } from '@shared/agents'
import type { AgentId, AgentInfo, AgentSettings, Settings } from '@shared/types'
import type { AgentAdapter } from './base'
import { execCli } from './launch'

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execCli(cmd, args, { env, timeout, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve(err && !stdout ? '' : `${stdout}${stderr}`.trim())
    })
  })
}

const EXTRA_DIRS = [
  ...['.local/bin', '.claude/local', '.npm-global/bin', '.bun/bin', '.volta/bin', '.cargo/bin'].map((d) => join(homedir(), d)),
  ...(process.platform === 'win32'
    ? [process.env.APPDATA && join(process.env.APPDATA, 'npm'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'pnpm')]
    : ['/opt/homebrew/bin', '/usr/local/bin'])
].filter((d): d is string => !!d)

/** Windows spells it `Path`, and a copy of the environment no longer ignores case. */
export function envKey(env: NodeJS.ProcessEnv, name: string): string {
  return Object.keys(env).find((k) => k.toUpperCase() === name) ?? name
}

let cachedEnv: NodeJS.ProcessEnv | null = null

/** The AppImage launcher points these at its own folder; agents and their tools must not load from it. */
export function withoutAppImage(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const appDir = env.APPDIR
  if (!env.APPIMAGE || !appDir) return env
  const out = { ...env }
  for (const key of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']) {
    const kept = (out[key] ?? '').split(':').filter((p) => p && !p.startsWith(appDir))
    if (kept.length) out[key] = kept.join(':')
    else delete out[key]
  }
  return out
}

/**
 * GUI apps on macOS and some Linux desktops start with a minimal PATH. Ask the user's login shell
 * for its environment once, then add common install locations so agent CLIs, node, python and uvx
 * resolve. Windows apps inherit the full user PATH.
 */
export async function agentEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedEnv) return cachedEnv
  const base = withoutAppImage(process.env)
  const env: NodeJS.ProcessEnv = { ...base }
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
    const marker = '__MATHODOLOGY_ENV__'
    const out = await run(shell, ['-ilc', `printf '${marker}'; env; printf '${marker}'`], base, 6000)
    const body = out.split(marker)[1]
    if (body) {
      for (const line of body.split('\n')) {
        const i = line.indexOf('=')
        if (i > 0) {
          const key = line.slice(0, i)
          if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) env[key] = line.slice(i + 1)
        }
      }
    }
  }
  const key = envKey(env, 'PATH')
  const parts = (env[key] ?? '').split(delimiter).filter(Boolean)
  for (const d of EXTRA_DIRS) if (!parts.includes(d) && existsSync(d)) parts.push(d)
  env[key] = parts.join(delimiter)
  // Electron-specific variables must not leak into node-based CLIs.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  cachedEnv = env
  return env
}

/**
 * The first `name` on PATH. On Windows that is `name.exe`, `.cmd` and so on in PATHEXT order; npm
 * also puts an extensionless shell script there, which Windows cannot run.
 */
export function whichSync(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | undefined {
  const exts =
    platform === 'win32'
      ? (env[envKey(env, 'PATHEXT')] || '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => /^\.(com|exe|bat|cmd)$/i.test(e))
      : ['']
  for (const dir of (env[envKey(env, 'PATH')] ?? '').split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = join(dir, name + ext.toLowerCase())
      try {
        accessSync(p, constants.X_OK)
        if (statSync(p).isFile()) return p
      } catch {
        // keep looking
      }
    }
  }
  return undefined
}

const BLANK: AgentSettings = { binaryPath: '', defaultModel: '', extraArgs: '', env: '' }

/** An agent's settings, with defaults for one the user never changed. */
export function agentSettings(settings: Settings, id: AgentId): AgentSettings {
  return { ...BLANK, ...settings.agents[id] }
}

/**
 * The environment a CLI runs with: the login shell's, plus what the user set for this agent.
 * `KEY=` with nothing after it removes KEY, e.g. a gateway token meant for another agent.
 */
export function envFor(env: NodeJS.ProcessEnv, settings: AgentSettings): NodeJS.ProcessEnv {
  const extra = Object.entries(parseEnv(settings.env))
  if (!extra.length) return env
  const out = { ...env }
  for (const [key, value] of extra) {
    if (value) out[key] = value
    else delete out[key]
  }
  return out
}

export function resolveBinary(adapter: AgentAdapter, settings: Settings, env: NodeJS.ProcessEnv): string | undefined {
  const override = agentSettings(settings, adapter.id).binaryPath.trim()
  if (override) return existsSync(override) ? override : undefined
  for (const name of adapter.binaryNames) {
    const found = whichSync(name, env)
    if (found) return found
  }
  return undefined
}

export async function detectAgents(
  adapters: Record<AgentId, AgentAdapter>,
  settings: Settings
): Promise<AgentInfo[]> {
  const shellEnv = await agentEnv()
  return Promise.all(
    Object.values(adapters).map(async (a): Promise<AgentInfo> => {
      const env = envFor(shellEnv, agentSettings(settings, a.id))
      const path = resolveBinary(a, settings, env)
      const base = {
        id: a.id,
        name: a.name,
        models: a.models,
        supportsApproval: a.supportsApproval,
        supportsResume: a.supportsResume,
        route: a.route,
        supersededBy: agentSpec(a.id)?.supersededBy
      }
      if (!path) return { ...base, available: false, note: 'not-found' }
      const [out, found] = await Promise.all([
        a.versionArgs.length ? run(path, a.versionArgs, env) : Promise.resolve(''),
        a.inspect ? a.inspect(path, env).catch(() => ({ models: [] })) : Promise.resolve({ models: [] })
      ])
      const version = /\d+\.\d+\.\d+[\w.-]*/.exec(out)?.[0]
      return {
        ...base,
        models: found.models.length > 1 ? found.models : a.models,
        account: 'account' in found ? found.account : undefined,
        path,
        version,
        available: Boolean(version) || !a.versionArgs.length,
        note: version || !a.versionArgs.length ? undefined : 'no-version'
      }
    })
  )
}
