import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Connector } from '@shared/types'
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
  writeAtomic(path, text)
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

// npm's npx, npm, pnpm and yarn are .cmd files on Windows, which start only through cmd.exe;
// Claude Code and Codex do not add it themselves.
const WINDOWS_SHIMS = /^(npx|npm|pnpm|pnpx|yarn|yarnpkg)(\.cmd)?$/i

/** The command line written for a stdio connector. */
export function stdioCommand(c: Connector, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  const command = c.command ?? ''
  const args = c.args ?? []
  return platform === 'win32' && WINDOWS_SHIMS.test(command) ? { command: 'cmd', args: ['/c', command, ...args] } : { command, args }
}

function tomlBlock(c: Connector, platform: NodeJS.Platform): string {
  const lines = [`[mcp_servers.${c.id}]`]
  if (c.url) lines.push(`url = ${tomlString(c.url)}`)
  else {
    const { command, args } = stdioCommand(c, platform)
    lines.push(`command = ${tomlString(command)}`)
    lines.push(`args = [${args.map(tomlString).join(', ')}]`)
    if (c.env && Object.keys(c.env).length) {
      lines.push(`[mcp_servers.${c.id}.env]`)
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

/** Locate owned table spans using TOML lexical state across physical lines. */
function codexTables(text: string, managed: Set<string>): Map<string, { start: number; end: number }[]> {
  const tables = new Map<string, { start: number; end: number }[]>()
  const header = /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\s*\.[^\]]*)?\s*\]\s*(?:#.*)?$/
  let span: { start: number; end: number } | undefined
  let quote = ''
  let depth = 0
  let offset = text.startsWith('\uFEFF') ? 1 : 0

  while (offset < text.length) {
    const lf = text.indexOf('\n', offset)
    const end = lf === -1 ? text.length : lf + 1
    const line = text.slice(offset, end)
    if (!quote && !depth && /^\s*\[/.test(line)) {
      span = undefined
      const match = header.exec(line.trimEnd())
      const id = match && (match[1] ?? match[2] ?? match[3])
      if (id && managed.has(id)) {
        span = { start: offset, end }
        const spans = tables.get(id) ?? []
        spans.push(span)
        tables.set(id, spans)
      }
    } else if (span && (quote || depth || !/^\s*(?:#|$)/.test(line))) {
      // Trailing whitespace and stand-alone comments belong to the surrounding document.
      span.end = end
    }
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quote) {
        if (quote[0] === '"' && c === '\\') i++
        else if (line.startsWith(quote, i)) {
          if (quote.length === 3) {
            i += 2
            // A multiline closing delimiter may be preceded by one or two literal quotes.
            for (let extra = 0; extra < 2 && line[i + 1] === quote[0]; extra++) i++
          }
          quote = ''
        }
      } else if (c === '#') break
      else if (c === '"' || c === "'") {
        quote = line.startsWith(c.repeat(3), i) ? c.repeat(3) : c
        i += quote.length - 1
      } else if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') depth--
    }
    offset = end
  }
  return tables
}

/**
 * Replace the `[mcp_servers.<id>]` tables (and their sub-tables) Studio wrote for the managed ids
 * in a Codex config, keeping every other line as it was. `written` is updated in place.
 */
export function syncCodexToml(
  text: string,
  connectors: Connector[],
  removed: string[],
  written: Written = {},
  platform: NodeJS.Platform = process.platform
): string {
  const managed = new Set([...connectors.map((c) => c.id), ...removed])
  const tables = codexTables(text, managed)
  const edits: { start: number; end: number; value: string }[] = []
  const additions: string[] = []
  const newline = text.includes('\r\n') ? '\r\n' : '\n'

  const sync = (id: string, next?: string): void => {
    const spans = tables.get(id) ?? []
    const current = tomlKey(spans.flatMap(({ start, end }) => text.slice(start, end).split('\n')))
    const key = next && tomlKey(next.split('\n'))
    if (current && !ours(current, written[id], key)) {
      delete written[id]
      return
    }
    if (key && next) written[id] = key
    else delete written[id]
    if (current === key) return

    const value = next?.replaceAll('\n', newline)
    if (!spans.length && value) additions.push(value)
    for (const [i, span] of spans.entries()) {
      const trailingEol = /\r?\n$/.exec(text.slice(span.start, span.end))?.[0] ?? ''
      edits.push({ ...span, value: i === 0 && value ? value + trailingEol : '' })
    }
  }
  const active = new Set(connectors.map((c) => c.id))
  for (const r of removed) if (!active.has(r)) sync(r)
  for (const c of connectors) sync(c.id, c.enabled ? tomlBlock(c, platform) : undefined)
  let cursor = 0
  let out = ''
  for (const { start, end, value } of edits.sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, start) + value
    cursor = end
  }
  out += text.slice(cursor)
  if (additions.length) {
    if (out && out !== '\uFEFF' && !out.endsWith('\n')) out += newline
    out += additions.join(newline) + newline
  }
  return out
}

/**
 * Write the enabled connectors into a project's agent configuration: `.mcp.json` (Claude Code),
 * `.codex/config.toml` (Codex) and `.gemini/settings.json` (Gemini CLI). `ledger` is a file in
 * Studio's data folder that records the entries Studio wrote, so entries of the user's are left
 * alone. `removed` lists ids of connectors that were deleted, so their entries go too. Returns the
 * files that changed.
 */
export function syncConnectors(
  projectDir: string,
  connectors: Connector[],
  ledger: string,
  removed: string[] = [],
  platform: NodeJS.Platform = process.platform
): string[] {
  const state = readJson<Record<string, Written>>(ledger, {})
  const before = JSON.stringify(state)
  const written = (file: string): Written => (state[file] ??= {})
  const changed: string[] = []
  const stdio = (c: Connector): Record<string, unknown> => ({ ...stdioCommand(c, platform), ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}) })
  const claude = (c: Connector): Record<string, unknown> => (c.url ? { type: 'http', url: c.url } : stdio(c))
  const gemini = (c: Connector): Record<string, unknown> => (c.url ? { httpUrl: c.url } : stdio(c))
  if (syncJson(join(projectDir, '.mcp.json'), connectors, removed, claude, written('.mcp.json'))) changed.push('.mcp.json')
  if (syncJson(join(projectDir, '.gemini/settings.json'), connectors, removed, gemini, written('.gemini/settings.json'))) {
    changed.push('.gemini/settings.json')
  }

  const toml = join(projectDir, '.codex/config.toml')
  const prev = existsSync(toml) ? readFileSync(toml, 'utf8') : ''
  const next = syncCodexToml(prev, connectors, removed, written('.codex/config.toml'), platform)
  if (next !== prev && (next || existsSync(toml)) && writeIfChanged(toml, next)) changed.push('.codex/config.toml')

  for (const file of Object.keys(state)) if (!Object.keys(state[file]).length) delete state[file]
  if (JSON.stringify(state) !== before) {
    mkdirSync(dirname(ledger), { recursive: true })
    writeAtomic(ledger, JSON.stringify(state, null, 2))
  }
  return changed
}

export { McpPool } from './mcp'
