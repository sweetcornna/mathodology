import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Connector, ConnectorCheck } from '@shared/types'

export const SEARCH_CONNECTOR: Connector = {
  id: 'search',
  name: 'Mathodology Search',
  enabled: true,
  command: 'uvx',
  args: ['free-search-mcp'],
  env: { SEARCH_MCP_DOWNLOAD_DIR: '~/.cache/search-mcp/downloads' },
  builtin: true
}

/** Settings from before connectors existed only had an on/off switch for the search server. */
export function migrateConnectors(saved: { connectors?: Connector[]; enableSearchMcp?: boolean }): Connector[] {
  const list = saved.connectors ?? [{ ...SEARCH_CONNECTOR, enabled: saved.enableSearchMcp ?? true }]
  return list.some((c) => c.builtin) ? list : [SEARCH_CONNECTOR, ...list]
}

/** A configuration key the three CLIs accept as a server name. */
export function connectorId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server'
  let id = base
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`
  return id
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {}
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    // A file we cannot parse is the user's to fix; never overwrite it.
    return null
  }
}

function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
  return true
}

/** Merge the managed servers into a JSON config's `mcpServers` map, leaving other entries alone. */
function syncJson(path: string, connectors: Connector[], removed: string[], entry: (c: Connector) => Record<string, unknown>): boolean {
  const data = readJsonFile(path)
  if (!data) return false
  const servers = { ...((data.mcpServers as Record<string, unknown> | undefined) ?? {}) }
  for (const id of removed) delete servers[id]
  for (const c of connectors) {
    if (c.enabled) servers[c.id] = entry(c)
    else delete servers[c.id]
  }
  if (!existsSync(path) && !Object.keys(servers).length) return false
  return writeIfChanged(path, JSON.stringify({ ...data, mcpServers: servers }, null, 2) + '\n')
}

function tomlString(s: string): string {
  return JSON.stringify(s)
}

function tomlBlock(c: Connector): string {
  const lines = [`[mcp_servers.${c.id}]`]
  if (c.url) lines.push(`url = ${tomlString(c.url)}`)
  else {
    lines.push(`command = ${tomlString(c.command ?? '')}`)
    lines.push(`args = [${(c.args ?? []).map(tomlString).join(', ')}]`)
    if (c.env && Object.keys(c.env).length) {
      lines.push('', `[mcp_servers.${c.id}.env]`)
      for (const [k, v] of Object.entries(c.env)) lines.push(`${/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k)} = ${tomlString(v)}`)
    }
  }
  return lines.join('\n')
}

/**
 * Replace the `[mcp_servers.<id>]` tables (and their sub-tables) for the managed ids in a Codex
 * config, keeping every other line as it was.
 */
export function syncCodexToml(text: string, connectors: Connector[], removed: string[]): string {
  const managed = new Set([...connectors.map((c) => c.id), ...removed])
  const header = /^\s*\[\s*mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:\.[^\]]*)?\s*\]\s*(#.*)?$/
  const kept: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) {
      const m = header.exec(line)
      skipping = Boolean(m && managed.has(m[1] ?? m[2]))
    }
    if (!skipping) kept.push(line)
  }
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  const blocks = connectors.filter((c) => c.enabled).map(tomlBlock)
  const out = [body, ...blocks].filter(Boolean).join('\n\n')
  return out ? out + '\n' : ''
}

/**
 * Write the enabled connectors into a project's agent configuration: `.mcp.json` (Claude Code),
 * `.codex/config.toml` (Codex) and `.gemini/settings.json` (Gemini CLI). `removed` lists ids of
 * connectors that were deleted, so their entries go too. Returns the files that changed.
 */
export function syncConnectors(projectDir: string, connectors: Connector[], removed: string[] = []): string[] {
  const changed: string[] = []
  const claude = (c: Connector): Record<string, unknown> =>
    c.url ? { type: 'http', url: c.url } : { command: c.command, args: c.args ?? [], ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}) }
  const gemini = (c: Connector): Record<string, unknown> =>
    c.url ? { httpUrl: c.url } : { command: c.command, args: c.args ?? [], ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}) }
  if (syncJson(join(projectDir, '.mcp.json'), connectors, removed, claude)) changed.push('.mcp.json')
  if (syncJson(join(projectDir, '.gemini/settings.json'), connectors, removed, gemini)) changed.push('.gemini/settings.json')

  const toml = join(projectDir, '.codex/config.toml')
  const before = existsSync(toml) ? readFileSync(toml, 'utf8') : ''
  const after = syncCodexToml(before, connectors, removed)
  if (after !== before && (after || existsSync(toml)) && writeIfChanged(toml, after)) changed.push('.codex/config.toml')
  return changed
}

function expandHome(v: string): string {
  return v.startsWith('~/') ? join(homedir(), v.slice(2)) : v
}

/**
 * Studio's own MCP connections, used for the literature panel and connection checks. Servers
 * start on first use and stay up until the app quits.
 */
export class McpPool {
  private clients = new Map<string, { key: string; client: Promise<Client> }>()

  constructor(private readonly env: () => Promise<NodeJS.ProcessEnv>) {}

  private async open(c: Connector): Promise<Client> {
    const client = new Client({ name: 'mathodology-studio', version: '1' })
    if (c.url) {
      await client.connect(new StreamableHTTPClientTransport(new URL(c.url)))
      return client
    }
    const base = await this.env()
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...base, ...c.env })) if (typeof v === 'string') env[k] = expandHome(v)
    await client.connect(new StdioClientTransport({ command: c.command ?? '', args: c.args ?? [], env, stderr: 'ignore' }))
    return client
  }

  private get(c: Connector): Promise<Client> {
    const key = JSON.stringify([c.command, c.args, c.env, c.url])
    const cached = this.clients.get(c.id)
    if (cached?.key === key) return cached.client
    if (cached) void cached.client.then((x) => x.close()).catch(() => undefined)
    const client = this.open(c)
    this.clients.set(c.id, { key, client })
    // A failed start is not cached, so the next call tries again.
    client.catch(() => this.clients.get(c.id)?.client === client && this.clients.delete(c.id))
    return client
  }

  async check(c: Connector): Promise<ConnectorCheck> {
    try {
      const client = await withTimeout(this.get(c), 60_000)
      const { tools } = await withTimeout(client.listTools(), 20_000)
      return { ok: true, tools: tools.map((t) => t.name) }
    } catch (err) {
      return { ok: false, tools: [], error: (err as Error).message }
    }
  }

  /** Call a tool and return its text content, joined. */
  async callText(c: Connector, tool: string, args: Record<string, unknown>, timeoutMs = 90_000): Promise<string> {
    const client = await withTimeout(this.get(c), 60_000)
    const result = await withTimeout(client.callTool({ name: tool, arguments: args }), timeoutMs)
    const content = (result.content ?? []) as { type: string; text?: string }[]
    const text = content.filter((x) => x.type === 'text').map((x) => x.text ?? '').join('\n')
    if (result.isError) throw new Error(text || `${tool} failed`)
    return text
  }

  async close(): Promise<void> {
    const all = [...this.clients.values()]
    this.clients.clear()
    await Promise.allSettled(all.map((x) => x.client.then((c) => c.close())))
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
