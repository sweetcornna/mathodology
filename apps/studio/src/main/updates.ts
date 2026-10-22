import type { Connector } from '@shared/types'
import type { Run } from './humanizer'

/**
 * `uvx free-search-mcp` keeps running whichever version it cached first. Asking for `@latest` once
 * per launch refreshes that cache, so the agents and the Literature pane get new releases. Only
 * the built-in server as shipped is refreshed; one the user pointed elsewhere is left alone.
 */
export async function refreshSearchServer(connectors: Connector[], run: Run, cwd: string): Promise<'refreshed' | 'skipped' | 'failed'> {
  const search = connectors.find((c) => c.builtin)
  if (!search?.enabled || search.command !== 'uvx' || search.args?.join(' ') !== 'free-search-mcp') return 'skipped'
  const res = await run('uvx', ['free-search-mcp@latest', '--help'], cwd)
  return res.code === 0 ? 'refreshed' : 'failed'
}
