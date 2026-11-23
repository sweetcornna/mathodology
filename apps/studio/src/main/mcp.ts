import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Connector, ConnectorCheck } from '@shared/types'
import { McpStdio } from './agents/mcp-stdio'
import { bounded } from './agents/supervisor'

function expandHome(v: string): string {
  return v.startsWith('~/') ? join(homedir(), v.slice(2)) : v
}

/**
 * Studio's own MCP connections, used for the literature panel and connection checks. Servers
 * start on first use and stay up until the app quits.
 */
export class McpPool {
  private clients = new Map<string, { key: string; client: Promise<Client>; close(): Promise<void> }>()
  private closing = false

  constructor(private readonly env: () => Promise<NodeJS.ProcessEnv>) {}

  private get(c: Connector): Promise<Client> {
    if (this.closing) return Promise.reject(new Error('Studio is shutting down'))
    const key = JSON.stringify([c.command, c.args, c.env, c.url])
    const cached = this.clients.get(c.id)
    if (cached?.key === key) return cached.client
    if (cached) void cached.close().catch(() => undefined)

    const client = new Client({ name: 'mathodology-studio', version: '1' })
    let closed = false
    let closing: Promise<void> | undefined
    const close = (): Promise<void> => {
      closed = true
      return closing ??= bounded(client.close(), 4000)
    }
    const connect = async (): Promise<Client> => {
      const transport = c.url ? new StreamableHTTPClientTransport(new URL(c.url)) : await this.stdio(c)
      if (closed) throw new Error('MCP connection closed')
      await bounded(client.connect(transport, { timeout: 30_000 }), 30_000)
      return client
    }
    // Install the cache entry before connect can invoke onclose.
    const pending = Promise.resolve().then(connect)
    const evict = (): void => {
      if (this.clients.get(c.id)?.client === pending) this.clients.delete(c.id)
    }
    client.onclose = evict
    this.clients.set(c.id, { key, client: pending, close })
    void pending.catch(() => {
      evict()
      return close().catch(() => undefined)
    })
    return pending
  }

  private async stdio(c: Connector): Promise<McpStdio> {
    const base = await this.env()
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries({ ...base, ...c.env })) {
      if (typeof value === 'string') env[key] = expandHome(value)
    }
    return new McpStdio(c.command ?? '', c.args ?? [], env)
  }

  async check(c: Connector): Promise<ConnectorCheck> {
    try {
      const client = await bounded(this.get(c), 60_000)
      const { tools } = await bounded(client.listTools(undefined, { timeout: 20_000 }), 20_000)
      return { ok: true, tools: tools.map((t) => t.name) }
    } catch (err) {
      return { ok: false, tools: [], error: (err as Error).message }
    }
  }

  /** Call a tool and return its text content, joined. */
  async callText(c: Connector, tool: string, args: Record<string, unknown>, timeoutMs = 90_000): Promise<string> {
    const client = await bounded(this.get(c), 60_000)
    const result = await bounded(client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs }), timeoutMs)
    const content = (result.content ?? []) as { type: string; text?: string }[]
    const text = content.filter((x) => x.type === 'text').map((x) => x.text ?? '').join('\n')
    if (result.isError) throw new Error(text || `${tool} failed`)
    return text
  }

  async close(): Promise<void> {
    this.closing = true
    const all = [...this.clients.values()]
    this.clients.clear()
    await Promise.allSettled(all.map((entry) => entry.close()))
  }
}
