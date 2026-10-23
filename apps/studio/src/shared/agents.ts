import type { Brand } from './brands'

/**
 * How Studio talks to an agent CLI. Each is the agent's own programmatic interface:
 * - `claude-stream`: Claude Code's `-p --input-format stream-json` with its SDK control protocol
 *   (approvals as `can_use_tool` requests); Qoder CLI speaks the same protocol.
 * - `codex-app-server`: `codex app-server` (JSON-RPC).
 * - `gemini-stream`: `gemini --output-format stream-json`.
 * - `agy-stream`: Antigravity CLI's `--output-format stream-json` (`{"event": …}` lines).
 * - `pi-rpc`: pi's `--mode rpc` and oh-my-pi's `--mode rpc-ui` (JSONL commands and events).
 * - `acp`: the Agent Client Protocol, for agents that ship an ACP server of their own.
 */
export type AgentRoute = 'claude-stream' | 'codex-app-server' | 'gemini-stream' | 'agy-stream' | 'pi-rpc' | 'acp'

export interface AgentSpec {
  id: string
  name: string
  /** Executables to look for on PATH, in order. */
  bins: string[]
  route: AgentRoute
  /** Arguments that start the agent's own ACP server over stdio (route `acp`). */
  acpArgs?: string[]
  install: { cmd?: string; url: string }
  /** Mark from @lobehub/icons-static-svg; agents without one get a monogram. */
  icon?: string
  /** Whose models the agent runs by default, for a model name that says nothing. */
  brand?: Brand
  /** The vendor moved its users to another CLI (by id); kept for API-key and enterprise use. */
  supersededBy?: string
}

// Command-line agents from magpie's catalog (github.com/yetone/magpie), in display order.
export const AGENTS: AgentSpec[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bins: ['claude'],
    route: 'claude-stream',
    install: { cmd: 'npm install -g @anthropic-ai/claude-code', url: 'https://docs.claude.com/en/docs/claude-code/overview' },
    icon: 'claudecode-color',
    brand: 'claude'
  },
  {
    id: 'codex',
    name: 'Codex',
    bins: ['codex'],
    route: 'codex-app-server',
    install: { cmd: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
    icon: 'codex-color',
    brand: 'openai'
  },
  {
    id: 'agy',
    name: 'Antigravity CLI',
    bins: ['agy'],
    route: 'agy-stream',
    install: { url: 'https://antigravity.google/docs/cli' },
    icon: 'antigravity-color',
    brand: 'gemini'
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    bins: ['qodercli'],
    route: 'claude-stream',
    install: { cmd: 'npm install -g @qoder-ai/qodercli', url: 'https://docs.qoder.com/cli/quick-start' },
    icon: 'qoder-color'
  },
  {
    id: 'qoder-cn',
    name: 'Qoder CLI (China)',
    bins: ['qoderclicn'],
    route: 'claude-stream',
    install: { url: 'https://qoder.com' },
    icon: 'qoder-color'
  },
  {
    id: 'pi',
    name: 'Pi',
    bins: ['pi'],
    route: 'pi-rpc',
    install: { cmd: 'npm install -g @earendil-works/pi-coding-agent', url: 'https://pi.dev' },
    icon: 'pi'
  },
  {
    id: 'omp',
    name: 'oh-my-pi',
    bins: ['omp'],
    route: 'pi-rpc',
    install: { url: 'https://github.com/can1357/oh-my-pi' }
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bins: ['opencode'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'npm install -g opencode-ai', url: 'https://opencode.ai/docs' },
    icon: 'opencode'
  },
  {
    id: 'cursor',
    name: 'Cursor CLI',
    bins: ['cursor-agent'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'curl https://cursor.com/install -fsS | bash', url: 'https://cursor.com/cli' },
    icon: 'cursor'
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    bins: ['copilot'],
    route: 'acp',
    acpArgs: ['--acp'],
    install: { cmd: 'npm install -g @github/copilot', url: 'https://github.com/github/copilot-cli' },
    icon: 'githubcopilot'
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    bins: ['kimi'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'npm install -g @moonshot-ai/kimi-code', url: 'https://github.com/MoonshotAI/kimi-code' },
    icon: 'kimi',
    brand: 'kimi'
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    bins: ['qwen'],
    route: 'acp',
    acpArgs: ['--acp'],
    install: { cmd: 'npm install -g @qwen-code/qwen-code', url: 'https://github.com/QwenLM/qwen-code' },
    icon: 'qwen-color',
    brand: 'qwen'
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy Code',
    bins: ['codebuddy', 'cbc'],
    route: 'acp',
    acpArgs: ['--acp'],
    install: { cmd: 'npm install -g @tencent-ai/codebuddy-code', url: 'https://www.codebuddy.ai/cli' },
    icon: 'codebuddy-color'
  },
  {
    id: 'goose',
    name: 'goose',
    bins: ['goose'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { url: 'https://block.github.io/goose/docs/getting-started/installation' },
    icon: 'goose'
  },
  {
    id: 'cline',
    name: 'Cline',
    bins: ['cline'],
    route: 'acp',
    acpArgs: ['--acp'],
    install: { cmd: 'npm install -g cline', url: 'https://cline.bot/cli' },
    icon: 'cline'
  },
  {
    id: 'droid',
    name: 'Droid',
    bins: ['droid'],
    route: 'acp',
    acpArgs: ['exec', '--output-format', 'acp-daemon'],
    install: { cmd: 'npm install -g droid', url: 'https://docs.factory.ai/cli/getting-started/quickstart' }
  },
  {
    id: 'devin',
    name: 'Devin',
    bins: ['devin'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { url: 'https://docs.devin.ai' },
    icon: 'devin'
  },
  {
    id: 'grok',
    name: 'Grok Build',
    bins: ['grok'],
    route: 'acp',
    acpArgs: ['agent', 'stdio'],
    install: { cmd: 'npm install -g @xai-official/grok', url: 'https://x.ai' },
    icon: 'xai',
    brand: 'grok'
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    bins: ['mcode'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'npm install -g @minimax-ai/code', url: 'https://www.minimax.io' },
    icon: 'minimax-color',
    brand: 'minimax'
  },
  {
    id: 'vibe',
    name: 'Mistral Vibe',
    bins: ['vibe-acp'],
    route: 'acp',
    acpArgs: [],
    install: { cmd: 'uv tool install mistral-vibe', url: 'https://github.com/mistralai/mistral-vibe' },
    icon: 'mistral-color',
    brand: 'mistral'
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    bins: ['dsh'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'npm install -g @deepseek-ai/dsh', url: 'https://github.com/deepseek-ai/deepseek-harness' },
    icon: 'deepseek-color',
    brand: 'deepseek'
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    // `cmd` is also an alias, but on Windows that name is the system shell.
    bins: ['command-code', 'commandcode', 'cmdc'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'npm install -g command-code', url: 'https://commandcode.ai/docs/acp' },
    icon: 'commandcode'
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    bins: ['hermes'],
    route: 'acp',
    // Needs Hermes' `acp` extra installed.
    acpArgs: ['acp'],
    install: { url: 'https://hermes-agent.nousresearch.com/docs/features/acp' },
    icon: 'hermesagent'
  },
  {
    id: 'mothx',
    name: 'MothX',
    bins: ['mothx'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'curl -fsSL https://mothx.net/install.sh | sh', url: 'https://mothx.net' }
  },
  {
    id: 'reasonix',
    name: 'Reasonix',
    bins: ['reasonix'],
    route: 'acp',
    acpArgs: ['acp'],
    install: { cmd: 'npm install -g reasonix', url: 'https://github.com/esengine/DeepSeek-Reasonix' },
    brand: 'deepseek'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bins: ['gemini'],
    route: 'gemini-stream',
    install: { cmd: 'npm install -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' },
    icon: 'geminicli-color',
    brand: 'gemini',
    supersededBy: 'agy'
  }
]

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]))

export function agentSpec(id: string): AgentSpec | undefined {
  return BY_ID.get(id)
}

export const AGENT_IDS: string[] = AGENTS.map((a) => a.id)
