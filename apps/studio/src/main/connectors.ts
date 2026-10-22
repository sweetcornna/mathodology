import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Connector, ConnectorCheck } from '@shared/types'
import { readJson, writeAtomic } from './store'

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

/**
 * The entries Studio wrote into one config file, by server id, as it wrote them. An existing entry
 * that matches neither that nor what Studio would write now is the user's (written by hand, or
 * edited since), even when it shares an id such as `search`: it is never updated or removed.
 */
type Written = Record<string, string>

function ours(current: string, written: string | undefined, next: string | undefined): boolean {
  return current === written || current === next
}

/** Merge the managed servers into a JSON config's `mcpServers` map, leaving other entries alone. */
function syncJson(
  path: string,
  connectors: Connector[],
  removed: string[],
  entry: (c: Connector) => Record<string, unknown>,
  written: Written
): boolean {
  const data = readJsonFile(path)
  if (!data) return false
  const servers = { ...((data.mcpServers as Record<string, unknown> | undefined) ?? {}) }
  const sync = (id: string, next?: Record<string, unknown>): void => {
    const text = next && JSON.stringify(next)
    if (Object.hasOwn(servers, id) && !ours(JSON.stringify(servers[id]), written[id], text)) {
      delete written[id]
      return
    }
    if (next && text) {
      servers[id] = next
      written[id] = text
    } else {
      delete servers[id]
      delete written[id]
    }
  }
  for (const id of removed) sync(id)
  for (const c of connectors) sync(c.id, c.enabled ? entry(c) : undefined)
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

/** A Codex table as compared for ownership: its lines, trimmed, without blank ones. */
function tomlKey(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Replace the `[mcp_servers.<id>]` tables (and their sub-tables) Studio wrote for the managed ids
 * in a Codex config, keeping every other line as it was. `written` is updated in place.
 */
export function syncCodexToml(text: string, connectors: Connector[], removed: string[], written: Written = {}): string {
  const managed = new Set([...connectors.map((c) => c.id), ...removed])
  const header = /^\s*\[\s*mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:\.[^\]]*)?\s*\]\s*(#.*)?$/
  // Each line with the managed server whose table or sub-table it is in.
  const tagged: { line: string; id?: string }[] = []
  let id: string | undefined
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) {
      const m = header.exec(line)
      id = m && managed.has(m[1] ?? m[2]) ? (m[1] ?? m[2]) : undefined
    }
    tagged.push({ line, id })
  }
  const replaced = new Set<string>()
  const blocks: string[] = []
  const sync = (sid: string, next?: string): void => {
    const current = tagged.filter((t) => t.id === sid).map((t) => t.line)
    const key = next && tomlKey(next.split('\n'))
    if (current.length && !ours(tomlKey(current), written[sid], key)) {
      delete written[sid]
      return
    }
    replaced.add(sid)
    if (next && key) {
      blocks.push(next)
      written[sid] = key
    } else delete written[sid]
  }
  for (const r of removed) sync(r)
  for (const c of connectors) sync(c.id, c.enabled ? tomlBlock(c) : undefined)
  const body = tagged
    .filter((t) => !t.id || !replaced.has(t.id))
    .map((t) => t.line)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  const out = [body, ...blocks].filter(Boolean).join('\n\n')
  return out ? out + '\n' : ''
}

/**
 * Write the enabled connectors into a project's agent configuration: `.mcp.json` (Claude Code),
 * `.codex/config.toml` (Codex) and `.gemini/settings.json` (Gemini CLI). `ledger` is a file in
 * Studio's data folder that records the entries Studio wrote, so entries of the user's are left
 * alone. `removed` lists ids of connectors that were deleted, so their entries go too. Returns the
 * files that changed.
 */
export function syncConnectors(projectDir: string, connectors: Connector[], ledger: string, removed: string[] = []): string[] {
  const state = readJson<Record<string, Written>>(ledger, {})
  const before = JSON.stringify(state)
  const written = (file: string): Written => (state[file] ??= {})
  const changed: string[] = []
  const claude = (c: Connector): Record<string, unknown> =>
    c.url ? { type: 'http', url: c.url } : { command: c.command, args: c.args ?? [], ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}) }
  const gemini = (c: Connector): Record<string, unknown> =>
    c.url ? { httpUrl: c.url } : { command: c.command, args: c.args ?? [], ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}) }
  if (syncJson(join(projectDir, '.mcp.json'), connectors, removed, claude, written('.mcp.json'))) changed.push('.mcp.json')
  if (syncJson(join(projectDir, '.gemini/settings.json'), connectors, removed, gemini, written('.gemini/settings.json'))) {
    changed.push('.gemini/settings.json')
  }

  const toml = join(projectDir, '.codex/config.toml')
  const prev = existsSync(toml) ? readFileSync(toml, 'utf8') : ''
  const next = syncCodexToml(prev, connectors, removed, written('.codex/config.toml'))
  if (next !== prev && (next || existsSync(toml)) && writeIfChanged(toml, next)) changed.push('.codex/config.toml')

  for (const file of Object.keys(state)) if (!Object.keys(state[file]).length) delete state[file]
  if (JSON.stringify(state) !== before) {
    mkdirSync(dirname(ledger), { recursive: true })
    writeAtomic(ledger, JSON.stringify(state, null, 2))
  }
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
