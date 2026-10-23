import { AGENTS, type AgentSpec } from '@shared/agents'
import type { AgentId } from '@shared/types'
import { acpAdapter } from './acp'
import { agyAdapter } from './agy'
import type { AgentAdapter } from './base'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { geminiAdapter } from './gemini'
import { ompAdapter, piAgentAdapter } from './pi'
import { qoderAdapter, qoderCnAdapter } from './qoder'

/** Adapters written for one CLI's own interface; every other catalog entry speaks ACP. */
const NATIVE: Record<string, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  agy: agyAdapter,
  qoder: qoderAdapter,
  'qoder-cn': qoderCnAdapter,
  pi: piAgentAdapter,
  omp: ompAdapter,
  gemini: geminiAdapter
}

function adapterFor(spec: AgentSpec): AgentAdapter {
  const native = NATIVE[spec.id]
  if (native) return native
  if (spec.route !== 'acp' || !spec.acpArgs) throw new Error(`No adapter for ${spec.id}`)
  return acpAdapter({ id: spec.id, name: spec.name, bins: spec.bins, acpArgs: spec.acpArgs })
}

/** Every agent in the catalog, by id, in display order. */
export const ADAPTERS: Record<AgentId, AgentAdapter> = Object.fromEntries(AGENTS.map((spec) => [spec.id, adapterFor(spec)]))
