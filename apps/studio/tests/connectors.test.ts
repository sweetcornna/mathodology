import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connector } from '../src/shared/types'
import { connectorId, migrateConnectors, SEARCH_CONNECTOR, syncCodexToml, syncConnectors } from '../src/main/connectors'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'studio-conn-'))
  dirs.push(d)
  return d
}

const remote: Connector = { id: 'zotero', name: 'Zotero', enabled: true, url: 'http://127.0.0.1:23119/mcp' }
/** Studio's record of the entries it wrote, kept outside the project like the real one. */
const ledger = (): string => join(temp(), 'connectors', 'p1.json')
const servers = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')).mcpServers

describe('migrateConnectors', () => {
  it('keeps the old search switch and always includes the built-in server', () => {
    expect(migrateConnectors({ enableSearchMcp: false })).toEqual([{ ...SEARCH_CONNECTOR, enabled: false }])
    expect(migrateConnectors({})[0].enabled).toBe(true)
    expect(migrateConnectors({ connectors: [remote] }).map((c) => c.id)).toEqual(['search', 'zotero'])
  })

  it('makes ids that every CLI accepts', () => {
    expect(connectorId('My Zotero!', [])).toBe('my-zotero')
    expect(connectorId('search', ['search'])).toBe('search-2')
  })
})

describe('syncConnectors', () => {
  it('starts npx through cmd.exe on Windows, where it is a .cmd file, and leaves uvx alone', () => {
    const dir = temp()
    const npx: Connector = { id: 'fs', name: 'Files', enabled: true, command: 'npx', args: ['-y', '@scope/server'] }
    syncConnectors(dir, [SEARCH_CONNECTOR, npx], ledger(), [], 'win32')
    for (const file of ['.mcp.json', '.gemini/settings.json']) {
      expect(servers(dir, file).fs).toMatchObject({ command: 'cmd', args: ['/c', 'npx', '-y', '@scope/server'] })
      expect(servers(dir, file)[SEARCH_CONNECTOR.id]).toMatchObject({ command: 'uvx' })
    }
    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toContain('command = "cmd"\nargs = ["/c", "npx", "-y", "@scope/server"]')
    const mac = temp()
    syncConnectors(mac, [npx], ledger(), [], 'darwin')
    expect(servers(mac, '.mcp.json').fs).toMatchObject({ command: 'npx', args: ['-y', '@scope/server'] })
  })

  it('writes each CLI its own format and keeps servers it does not manage', () => {
    const dir = temp()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'x' } } }))
    mkdirSync(join(dir, '.codex'))
    writeFileSync(join(dir, '.codex/config.toml'), 'model = "gpt"\n\n[mcp_servers.mine]\ncommand = "x"\n')
    const book = ledger()
    const changed = syncConnectors(dir, [SEARCH_CONNECTOR, remote], book)
    expect(changed.sort()).toEqual(['.codex/config.toml', '.gemini/settings.json', '.mcp.json'])

    const claude = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers
    expect(claude.mine).toEqual({ command: 'x' })
    expect(claude.search).toEqual({ command: 'uvx', args: ['free-search-mcp'], env: SEARCH_CONNECTOR.env })
    expect(claude.zotero).toEqual({ type: 'http', url: remote.url })
    const gemini = JSON.parse(readFileSync(join(dir, '.gemini/settings.json'), 'utf8')).mcpServers
    expect(gemini.zotero).toEqual({ httpUrl: remote.url })

    const toml = readFileSync(join(dir, '.codex/config.toml'), 'utf8')
    expect(toml).toContain('model = "gpt"')
    expect(toml).toContain('[mcp_servers.mine]')
    expect(toml).toContain('[mcp_servers.search]\ncommand = "uvx"\nargs = ["free-search-mcp"]')
    expect(toml).toContain('[mcp_servers.search.env]\nSEARCH_MCP_DOWNLOAD_DIR = "~/.cache/search-mcp/downloads"')
    expect(toml).toContain('[mcp_servers.zotero]\nurl = "http://127.0.0.1:23119/mcp"')

    // A second run with nothing new changes nothing.
    expect(syncConnectors(dir, [SEARCH_CONNECTOR, remote], book)).toEqual([])
  })

  it('removes disabled and deleted servers', () => {
    const dir = temp()
    const book = ledger()
    syncConnectors(dir, [SEARCH_CONNECTOR, remote], book)
    syncConnectors(dir, [{ ...SEARCH_CONNECTOR, enabled: false }], book, ['zotero'])
    expect(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers).toEqual({})
    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toBe('')
  })

  it('leaves a config it cannot parse untouched', () => {
    const dir = temp()
    writeFileSync(join(dir, '.mcp.json'), '{ not json')
    syncConnectors(dir, [SEARCH_CONNECTOR], ledger())
    expect(readFileSync(join(dir, '.mcp.json'), 'utf8')).toBe('{ not json')
  })

  it('creates nothing when no server is enabled', () => {
    const dir = temp()
    expect(syncConnectors(dir, [{ ...SEARCH_CONNECTOR, enabled: false }], ledger())).toEqual([])
  })

  it('leaves an entry the user wrote under a connector id alone, also when the connector is switched off', () => {
    const dir = temp()
    const book = ledger()
    const mine = { command: 'uvx', args: ['free-search-mcp'], env: { SEARCH_MCP_PROXY: 'http://127.0.0.1:7890' } }
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { search: mine } }))
    mkdirSync(join(dir, '.gemini'))
    writeFileSync(join(dir, '.gemini/settings.json'), JSON.stringify({ mcpServers: { search: mine } }))
    mkdirSync(join(dir, '.codex'))
    const toml = '[mcp_servers.search]\ncommand = "/opt/search-mcp"\nargs = []\n'
    writeFileSync(join(dir, '.codex/config.toml'), toml)

    expect(syncConnectors(dir, [SEARCH_CONNECTOR, remote], book).sort()).toEqual(['.codex/config.toml', '.gemini/settings.json', '.mcp.json'])
    expect(servers(dir, '.mcp.json')).toEqual({ search: mine, zotero: { type: 'http', url: remote.url } })
    expect(servers(dir, '.gemini/settings.json').search).toEqual(mine)
    const codex = readFileSync(join(dir, '.codex/config.toml'), 'utf8')
    expect(codex).toContain('command = "/opt/search-mcp"')
    expect(codex.match(/\[mcp_servers\.search\]/g)).toHaveLength(1)

    syncConnectors(dir, [{ ...SEARCH_CONNECTOR, enabled: false }], book, ['zotero'])
    expect(servers(dir, '.mcp.json')).toEqual({ search: mine })
    expect(servers(dir, '.gemini/settings.json')).toEqual({ search: mine })
    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toBe(toml)
  })

  it('updates the entries it wrote until the user edits one', () => {
    const dir = temp()
    const book = ledger()
    syncConnectors(dir, [remote], book)
    const moved = { ...remote, url: 'http://127.0.0.1:23120/mcp' }
    syncConnectors(dir, [moved], book)
    expect(servers(dir, '.mcp.json').zotero).toEqual({ type: 'http', url: moved.url })

    const edited = { type: 'http', url: moved.url, headers: { Authorization: 'Bearer x' } }
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { zotero: edited } }))
    syncConnectors(dir, [{ ...moved, url: 'http://127.0.0.1:23121/mcp' }], book)
    expect(servers(dir, '.mcp.json').zotero).toEqual(edited)
    expect(servers(dir, '.gemini/settings.json').zotero).toEqual({ httpUrl: 'http://127.0.0.1:23121/mcp' })
    syncConnectors(dir, [], book, ['zotero'])
    expect(servers(dir, '.mcp.json')).toEqual({ zotero: edited })
    expect(servers(dir, '.gemini/settings.json')).toEqual({})
  })

  it('takes over an entry identical to its own from before it kept a record', () => {
    const dir = temp()
    syncConnectors(dir, [SEARCH_CONNECTOR], ledger())
    // A fresh record, as for a project synced by an earlier Studio: the next launch claims the
    // entries that match what it writes, so a later change to the connector reaches them.
    const book = ledger()
    expect(syncConnectors(dir, [SEARCH_CONNECTOR], book)).toEqual([])
    syncConnectors(dir, [{ ...SEARCH_CONNECTOR, args: ['free-search-mcp@latest'] }], book)
    expect(servers(dir, '.mcp.json').search.args).toEqual(['free-search-mcp@latest'])
    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toContain('args = ["free-search-mcp@latest"]')
  })
})

describe('syncCodexToml', () => {
  it('replaces the table it wrote and its sub-tables only', () => {
    const written = {}
    const old = syncCodexToml('', [{ ...SEARCH_CONNECTOR, command: 'old', env: { A: '1' } }], [], written)
    const before = `${old}\n[profiles.fast]\nmodel = "x"\n`
    const after = syncCodexToml(before, [SEARCH_CONNECTOR], [], written)
    expect(after).not.toContain('"old"')
    expect(after).not.toContain('A = "1"')
    expect(after).toContain('[profiles.fast]\nmodel = "x"')
    expect(after.match(/\[mcp_servers\.search\]/g)).toHaveLength(1)
    // Without that record the same table is the user's.
    expect(syncCodexToml(before, [SEARCH_CONNECTOR], [])).toBe(before)
  })
})
