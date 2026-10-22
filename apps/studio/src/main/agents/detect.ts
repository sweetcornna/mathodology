import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { AgentId, AgentInfo, Settings } from '@shared/types'
import type { AgentAdapter } from './base'

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve(err && !stdout ? '' : `${stdout}${stderr}`.trim())
    })
  })
}

const EXTRA_DIRS = [
  '~/.local/bin',
  '~/.claude/local',
  '~/.npm-global/bin',
  '~/.bun/bin',
  '~/.volta/bin',
  '~/.cargo/bin',
  '/opt/homebrew/bin',
  '/usr/local/bin'
].map((d) => d.replace(/^~/, homedir()))

let cachedEnv: NodeJS.ProcessEnv | null = null

/**
 * GUI apps on macOS start with a minimal PATH. Ask the user's login shell for its environment
 * once, then add common install locations so agent CLIs, node, python and uvx resolve.
 */
export async function agentEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedEnv) return cachedEnv
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL || '/bin/zsh'
    const marker = '__MATHODOLOGY_ENV__'
    const out = await run(shell, ['-ilc', `printf '${marker}'; env; printf '${marker}'`], process.env, 6000)
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
  const parts = (env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const d of EXTRA_DIRS) if (!parts.includes(d) && existsSync(d)) parts.push(d)
  env.PATH = parts.join(delimiter)
  // Electron-specific variables must not leak into node-based CLIs.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  cachedEnv = env
  return env
}

export function whichSync(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, name)
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      // keep looking
    }
  }
  return undefined
}

export function resolveBinary(adapter: AgentAdapter, settings: Settings, env: NodeJS.ProcessEnv): string | undefined {
  const override = settings.agents[adapter.id].binaryPath.trim()
  if (override) return existsSync(override) ? override : undefined
  return whichSync(adapter.binaryName, env)
}

export async function detectAgents(
  adapters: Record<AgentId, AgentAdapter>,
  settings: Settings
): Promise<AgentInfo[]> {
  const env = await agentEnv()
  return Promise.all(
    Object.values(adapters).map(async (a): Promise<AgentInfo> => {
      const path = resolveBinary(a, settings, env)
      const base = {
        id: a.id,
        name: a.name,
        models: a.models,
        supportsApproval: a.supportsApproval,
        supportsResume: a.supportsResume
      }
      if (!path) return { ...base, available: false, note: 'not-found' }
      const [out, found] = await Promise.all([
        run(path, a.versionArgs, env),
        a.inspect ? a.inspect(path, env).catch(() => ({ models: [] })) : Promise.resolve({ models: [] })
      ])
      const version = /\d+\.\d+\.\d+[\w.-]*/.exec(out)?.[0]
      return {
        ...base,
        models: found.models.length > 1 ? found.models : a.models,
        account: 'account' in found ? found.account : undefined,
        path,
        version,
        available: Boolean(version),
        note: version ? undefined : 'no-version'
      }
    })
  )
}
