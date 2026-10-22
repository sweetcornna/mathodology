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
  it('writes each CLI its own format and keeps servers it does not manage', () => {
    const dir = temp()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'x' } } }))
    mkdirSync(join(dir, '.codex'))
    writeFileSync(join(dir, '.codex/config.toml'), 'model = "gpt"\n\n[mcp_servers.mine]\ncommand = "x"\n')
    const changed = syncConnectors(dir, [SEARCH_CONNECTOR, remote])
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
    expect(syncConnectors(dir, [SEARCH_CONNECTOR, remote])).toEqual([])
  })

  it('removes disabled and deleted servers', () => {
    const dir = temp()
    syncConnectors(dir, [SEARCH_CONNECTOR, remote])
    syncConnectors(dir, [{ ...SEARCH_CONNECTOR, enabled: false }], ['zotero'])
    expect(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers).toEqual({})
    expect(readFileSync(join(dir, '.codex/config.toml'), 'utf8')).toBe('')
  })

  it('leaves a config it cannot parse untouched', () => {
    const dir = temp()
    writeFileSync(join(dir, '.mcp.json'), '{ not json')
    syncConnectors(dir, [SEARCH_CONNECTOR])
    expect(readFileSync(join(dir, '.mcp.json'), 'utf8')).toBe('{ not json')
  })

  it('creates nothing when no server is enabled', () => {
    const dir = temp()
    expect(syncConnectors(dir, [{ ...SEARCH_CONNECTOR, enabled: false }])).toEqual([])
  })
})

describe('syncCodexToml', () => {
  it('replaces a managed table and its sub-tables only', () => {
    const before = '[mcp_servers.search]\ncommand = "old"\n\n[mcp_servers.search.env]\nA = "1"\n\n[profiles.fast]\nmodel = "x"\n'
    const after = syncCodexToml(before, [SEARCH_CONNECTOR], [])
    expect(after).not.toContain('"old"')
    expect(after).not.toContain('A = "1"')
    expect(after).toContain('[profiles.fast]\nmodel = "x"')
    expect(after.match(/\[mcp_servers\.search\]/g)).toHaveLength(1)
  })
})
