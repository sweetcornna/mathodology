import { agentSpec } from './agents'
import type { AgentId, ModelInfo } from './types'

export type Brand =
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'zhipu'
  | 'mistral'
  | 'meta'
  | 'grok'
  | 'minimax'
  | 'doubao'
  | 'ollama'

// Checked in order; the first family whose pattern matches the model name wins.
const FAMILIES: [Brand, RegExp][] = [
  ['claude', /claude|anthropic|\b(opus|sonnet|haiku)\b/],
  ['gemini', /gemini|gemma/],
  ['deepseek', /deepseek/],
  ['qwen', /qwen|qwq/],
  ['kimi', /kimi|moonshot/],
  ['zhipu', /glm|zhipu/],
  ['mistral', /mistral|mixtral|codestral|devstral|magistral/],
  ['meta', /llama|\bmeta\b/],
  ['grok', /grok|\bxai\b/],
  ['minimax', /minimax|abab/],
  ['doubao', /doubao/],
  ['openai', /gpt|openai|chatgpt|codex|\bo[1-9](-|\b)/],
  ['ollama', /ollama/]
]

/** The provider behind a model name such as "claude-opus-5-5", "gpt-6.1-sol" or "auto/gemini-3-flash". */
export function brandOf(name: string | undefined): Brand | null {
  const s = (name ?? '').toLowerCase()
  if (!s) return null
  return FAMILIES.find(([, re]) => re.test(s))?.[0] ?? null
}

/**
 * A model's provider, falling back to the agent's own when the name says nothing (e.g. "Default").
 * `null` for an agent that serves many providers' models and a name that names none.
 */
export function modelBrand(model: Pick<ModelInfo, 'id' | 'model' | 'label'> | undefined, agent: AgentId): Brand | null {
  return brandOf(model?.model) ?? brandOf(model?.id) ?? brandOf(model?.label) ?? agentSpec(agent)?.brand ?? null
}
