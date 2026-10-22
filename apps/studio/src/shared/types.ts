// Contract shared by the main process (agent runtime, storage) and the renderer.

export type AgentId = 'claude' | 'codex' | 'gemini'

/** How much the agent may do without asking. Each adapter maps this to its own flags. */
export type PermissionMode = 'ask' | 'acceptEdits' | 'plan' | 'bypass'

export type ContestKind = 'MCM' | 'ICM' | 'CUMCM' | 'Huashu' | 'Other'

export interface AgentInfo {
  id: AgentId
  name: string
  /** Absolute path of the resolved binary, when found. */
  path?: string
  version?: string
  available: boolean
  /** Short reason when unavailable or degraded. */
  note?: string
  models: { id: string; label: string }[]
  /** Whether the adapter can pause a tool call for the user's approval. */
  supportsApproval: boolean
  supportsResume: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  contest: ContestKind
  createdAt: number
  /** Whether the Mathodology kit (skills, roles, instructions) was installed into `path`. */
  kitInstalled: boolean
}

export type SessionStatus = 'idle' | 'running' | 'waiting' | 'error'

export interface Session {
  id: string
  projectId: string
  title: string
  agent: AgentId
  model?: string
  permissionMode: PermissionMode
  /** The agent CLI's own session/thread id, used to resume. */
  nativeSessionId?: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  archived: boolean
  status: SessionStatus
  usage: Usage
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

export type NoticeCode = 'agentMissing' | 'agentExited' | 'signIn' | 'resumeReset'

export type ToolKind =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'web'
  | 'task'
  | 'todo'
  | 'mcp'
  | 'skill'
  | 'other'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface FileChange {
  path: string
  kind: 'add' | 'update' | 'delete'
  /** Unified diff when the agent reported one or we could build it. */
  diff?: string
}

/** Normalized, persisted event. Streaming deltas use `assistant.delta` and are not persisted. */
export type SessionEventBody =
  | { kind: 'user.message'; text: string; attachments: string[] }
  | { kind: 'session.started'; agent: AgentId; model?: string; nativeSessionId?: string; cwd: string }
  | { kind: 'assistant.delta'; blockId: string; text: string; thinking?: boolean }
  | { kind: 'assistant.text'; blockId: string; text: string; parentCallId?: string }
  | { kind: 'thinking'; blockId: string; text: string }
  | {
      kind: 'tool.call'
      callId: string
      name: string
      toolKind: ToolKind
      title: string
      input: unknown
      changes?: FileChange[]
      /** Set when the call was made by a sub-agent launched from another tool call. */
      parentCallId?: string
    }
  | { kind: 'tool.output'; callId: string; chunk: string }
  | { kind: 'tool.result'; callId: string; output: string; isError: boolean }
  | { kind: 'todo.update'; items: TodoItem[] }
  | {
      kind: 'permission.request'
      requestId: string
      callId?: string
      toolName: string
      title: string
      input: unknown
    }
  | { kind: 'permission.resolved'; requestId: string; allow: boolean; always?: boolean }
  | {
      kind: 'turn.completed'
      ok: boolean
      durationMs?: number
      usage?: Partial<Usage>
      summary?: string
    }
  | {
      kind: 'notice'
      level: 'info' | 'warning' | 'error'
      /** English text; the agent's own words when `code` is absent. */
      text: string
      /** Studio-authored notices carry a code so the renderer can show them in the UI language. */
      code?: NoticeCode
      vars?: Record<string, string>
    }
  /** Live token count for the running turn; streamed only, never persisted. */
  | { kind: 'turn.progress'; tokens: number }

export type SessionEvent = SessionEventBody & {
  sessionId: string
  seq: number
  ts: number
}

export interface Attachment {
  name: string
  /** Absolute source path chosen by the user; copied into the project's attachments folder. */
  path: string
}

export interface SendMessageInput {
  sessionId: string
  text: string
  attachments: Attachment[]
}

export interface CreateSessionInput {
  projectId: string
  agent: AgentId
  model?: string
  permissionMode: PermissionMode
  title?: string
}

export interface CreateProjectInput {
  name: string
  /** Parent folder; the project folder is created inside it. */
  parentDir?: string
  /** Use an existing folder as-is instead of creating one. */
  existingPath?: string
  contest: ContestKind
  installKit: boolean
}

export interface FileEntry {
  name: string
  path: string
  /** Path relative to the project root, POSIX separators. */
  rel: string
  dir: boolean
  size: number
  mtime: number
}

export interface FilePreview {
  path: string
  kind: 'text' | 'markdown' | 'image' | 'pdf' | 'csv' | 'binary' | 'too-large'
  /** Text content, or a data: URL for images. */
  content?: string
  size: number
}

export type ThemePref = 'system' | 'light' | 'dark'
export type Locale = 'zh-CN' | 'en'

export interface AgentSettings {
  /** Override the binary path; empty means search PATH. */
  binaryPath: string
  defaultModel: string
  extraArgs: string
}

export interface Settings {
  onboarded: boolean
  locale: Locale
  theme: ThemePref
  fontScale: number
  workspaceRoot: string
  defaultAgent: AgentId
  defaultPermissionMode: PermissionMode
  sendWithEnter: boolean
  /** Register the keyless search MCP server in new projects. */
  enableSearchMcp: boolean
  agents: Record<AgentId, AgentSettings>
}

export interface KitInfo {
  source: string
  skills: { name: string; description: string }[]
  roles: { name: string; description: string }[]
  workflows: string[]
}

export interface AppInfo {
  version: string
  platform: string
  userData: string
  kit: KitInfo
}
