import { useId, useMemo } from 'react'
import type { AgentId, ModelInfo } from '@shared/types'
import { agentSpec } from '@shared/agents'
import { modelBrand, type Brand } from '@shared/brands'
// Provider marks from @lobehub/icons-static-svg (MIT). The logos are trademarks of their owners,
// shown only to identify which service a model or CLI belongs to.
import claudeSvg from '@lobehub/icons-static-svg/icons/claude-color.svg?raw'
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw'
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw'
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw'
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen-color.svg?raw'
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi.svg?raw'
import zhipuSvg from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw'
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral-color.svg?raw'
import metaSvg from '@lobehub/icons-static-svg/icons/meta-color.svg?raw'
import grokSvg from '@lobehub/icons-static-svg/icons/grok.svg?raw'
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax-color.svg?raw'
import doubaoSvg from '@lobehub/icons-static-svg/icons/doubao-color.svg?raw'
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg?raw'
import claudeCodeSvg from '@lobehub/icons-static-svg/icons/claudecode-color.svg?raw'
import codexSvg from '@lobehub/icons-static-svg/icons/codex-color.svg?raw'
import geminiCliSvg from '@lobehub/icons-static-svg/icons/geminicli-color.svg?raw'
import antigravitySvg from '@lobehub/icons-static-svg/icons/antigravity-color.svg?raw'
import qoderSvg from '@lobehub/icons-static-svg/icons/qoder-color.svg?raw'
import piSvg from '@lobehub/icons-static-svg/icons/pi.svg?raw'
import opencodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg?raw'
import cursorSvg from '@lobehub/icons-static-svg/icons/cursor.svg?raw'
import copilotSvg from '@lobehub/icons-static-svg/icons/githubcopilot.svg?raw'
import codebuddySvg from '@lobehub/icons-static-svg/icons/codebuddy-color.svg?raw'
import gooseSvg from '@lobehub/icons-static-svg/icons/goose.svg?raw'
import clineSvg from '@lobehub/icons-static-svg/icons/cline.svg?raw'
import devinSvg from '@lobehub/icons-static-svg/icons/devin.svg?raw'
import xaiSvg from '@lobehub/icons-static-svg/icons/xai.svg?raw'
import commandCodeSvg from '@lobehub/icons-static-svg/icons/commandcode.svg?raw'
import hermesSvg from '@lobehub/icons-static-svg/icons/hermesagent.svg?raw'

// Single-colour marks use currentColor and follow the text colour in both themes.
const BRAND_SVG: Record<Brand, string> = {
  claude: claudeSvg,
  openai: openaiSvg,
  gemini: geminiSvg,
  deepseek: deepseekSvg,
  qwen: qwenSvg,
  kimi: kimiSvg,
  zhipu: zhipuSvg,
  mistral: mistralSvg,
  meta: metaSvg,
  grok: grokSvg,
  minimax: minimaxSvg,
  doubao: doubaoSvg,
  ollama: ollamaSvg
}

// Agent CLI marks by their name in the catalog (`AgentSpec.icon`); provider marks double for some.
const AGENT_SVG: Record<string, string> = {
  'claudecode-color': claudeCodeSvg,
  'codex-color': codexSvg,
  'geminicli-color': geminiCliSvg,
  'antigravity-color': antigravitySvg,
  'qoder-color': qoderSvg,
  pi: piSvg,
  opencode: opencodeSvg,
  cursor: cursorSvg,
  githubcopilot: copilotSvg,
  kimi: kimiSvg,
  'qwen-color': qwenSvg,
  'codebuddy-color': codebuddySvg,
  goose: gooseSvg,
  cline: clineSvg,
  devin: devinSvg,
  xai: xaiSvg,
  commandcode: commandCodeSvg,
  hermesagent: hermesSvg,
  'deepseek-color': deepseekSvg,
  'minimax-color': minimaxSvg,
  'mistral-color': mistralSvg
}

/** Inline an SVG at the given size, giving its gradient ids a per-instance suffix so copies don't clash. */
function Svg({ raw, size, className, title }: { raw: string; size: number; className?: string; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const html = useMemo(
    () =>
      raw
        .replace(/<title>[^<]*<\/title>/, '')
        .replace(/\sid="([^"]+)"/g, (_m, id: string) => ` id="${id}-${uid}"`)
        .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${id}-${uid})`)
        .replace(/href="#([^"]+)"/g, (_m, id: string) => `href="#${id}-${uid}"`)
        .replace(/\sheight="1em"/, ' height="100%"')
        .replace(/\swidth="1em"/, ' width="100%"'),
    [raw, uid]
  )
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`inline-grid shrink-0 place-items-center ${className ?? ''}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** The provider mark for a model: Claude for claude-*, OpenAI for gpt-*, Gemini for gemini-*, and so on. Falls back to the agent's mark. */
export function ModelIcon({
  model,
  agent,
  size = 14,
  className
}: {
  model?: Pick<ModelInfo, 'id' | 'model' | 'label'>
  agent: AgentId
  size?: number
  className?: string
}) {
  const brand = modelBrand(model, agent)
  if (!brand) return <AgentGlyph agent={agent} size={size} />
  return <Svg raw={BRAND_SVG[brand]} size={size} className={className} />
}

/** The agent CLI's own mark, or a neutral monogram for one without. `muted` greys it for dense lists. */
export function AgentGlyph({ agent, size = 14, muted }: { agent: AgentId; size?: number; muted?: boolean }) {
  const spec = agentSpec(agent)
  const raw = spec?.icon ? AGENT_SVG[spec.icon] : undefined
  if (raw) return <Svg raw={raw} size={size} className={muted ? 'opacity-55 grayscale' : undefined} />
  const name = spec?.name ?? agent
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-[28%] bg-surface-3 font-semibold text-fg-2 ${muted ? 'opacity-55' : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.5)) }}
    >
      {name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, size >= 22 ? 2 : 1).replace(/^./, (c) => c.toUpperCase())}
    </span>
  )
}
