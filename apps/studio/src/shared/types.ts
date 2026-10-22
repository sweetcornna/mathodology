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
  /** Models the CLI reports for the signed-in account; the first entry, id '', is the CLI's default. */
  models: ModelInfo[]
  /** Who the CLI is signed in as, when it says. */
  account?: AgentAccount
  /** Whether the adapter can pause a tool call for the user's approval. */
  supportsApproval: boolean
  supportsResume: boolean
}

export interface ModelInfo {
  /** Value passed to the CLI; '' means the CLI's own default. */
  id: string
  label: string
  description?: string
  /** Underlying model name, when it differs from `id`; used to pick the provider icon. */
  model?: string
  /** Provider or routing group, for CLIs that serve models from several sources. */
  group?: string
  /** Reasoning effort levels the model accepts, in increasing order. */
  efforts?: string[]
  defaultEffort?: string
}

export interface AgentAccount {
  /** Plan or credential kind, e.g. "Claude Max" or "API key". */
  plan?: string
  email?: string
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
  /** Reasoning effort for models that accept one; unset uses the model's default. */
  effort?: string
  permissionMode: PermissionMode
  /** The agent CLI's own session/thread id, used to resume. */
  nativeSessionId?: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  archived: boolean
  status: SessionStatus
  usage: Usage
  /** Messages sent while a turn was running; each starts the next turn in order. */
  queue?: QueuedMessage[]
}

export interface QueuedMessage {
  id: string
  text: string
  attachments: Attachment[]
  createdAt: number
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
  /** A project file gained a new version during this turn. */
  | { kind: 'artifact.version'; artifactId: string; rel: string; v: number; origin: VersionOrigin; artifactKind: ArtifactKind; callId?: string }

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
  effort?: string
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

export type ArtifactKind = 'figure' | 'table' | 'document' | 'code' | 'data'

/**
 * How Studio knows where a version came from, strongest evidence first:
 * - `tool`: a tool call that named this file (Write, Edit, a Codex file change) was observed.
 * - `turn`: the file changed while an agent turn ran, but no call named it (e.g. a script wrote it).
 * - `user`: restored from an earlier version inside Studio.
 * - `external`: changed outside any agent turn, by you or another program.
 */
export type VersionOrigin = 'tool' | 'turn' | 'user' | 'external'

export interface ArtifactVersion {
  v: number
  sha256: string
  size: number
  createdAt: number
  origin: VersionOrigin
  sessionId?: string
  /** `seq` of the user message that started the turn. */
  turnSeq?: number
  /** The tool call that produced it, for `tool` versions. */
  callId?: string
  tool?: string
  /** Whether Studio kept a copy of the bytes (large files are tracked by checksum only). */
  stored: boolean
  restoredFrom?: number
}

/** A project output with its full history; versions are never changed once recorded. */
export interface Artifact {
  id: string
  rel: string
  kind: ArtifactKind
  createdAt: number
  updatedAt: number
  versions: ArtifactVersion[]
  /** The file is no longer on disk; its history is kept. */
  missing?: boolean
}

export type FindingSeverity = 'fail' | 'warn' | 'inconclusive' | 'pass'
export type FindingStatus = 'open' | 'resolved' | 'dismissed'

/** One judgement a reviewer made about a claim in the session. */
export interface ReviewFinding {
  id: string
  severity: FindingSeverity
  title: string
  detail: string
  /** Project paths or `call:<id>` references the finding rests on. */
  evidence: string[]
  suggestion?: string
  status: FindingStatus
  /** Raised by Studio's citation trace rather than by the reviewing agent. */
  kind?: 'citation'
}

/** Counts from tracing a session's citations to its own record. */
export interface CitationTrace {
  /** Distinct identifiers and author-year references cited in replies and produced documents. */
  found: number
  /** Present in a tool result or a user message. */
  traced: number
  /** Present only in the project bibliography. */
  bibOnly: number
  untraced: number
  /** DOI lookups the DOI system answered, and how many of those DOIs do not exist. */
  resolved: number
  notFound: number
  unverifiable: number
  /** DOIs left unchecked because of the lookup cap. */
  skipped?: number
}

/**
 * A read-only check of a session: a second agent run traces the session's claims to the
 * recorded tool calls, outputs and files, without editing anything or redoing the work.
 */
export interface Review {
  id: string
  sessionId: string
  agent: AgentId
  model?: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  createdAt: number
  finishedAt?: number
  /** Last event `seq` the review covered. */
  throughSeq: number
  /** Tool calls the reviewer has made so far. */
  steps: number
  summary?: string
  findings: ReviewFinding[]
  trace?: CitationTrace
  error?: string
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
  /** Install the humanizer (Claude Code plugin, skill copy for Codex and Gemini) in kit projects. */
  installHumanizer: boolean
  /** MCP servers written into every project's Claude Code, Codex and Gemini CLI configuration. */
  connectors: Connector[]
  agents: Record<AgentId, AgentSettings>
}

/**
 * An MCP server the agents can use: a local command (stdio) or a remote URL (streamable HTTP).
 * Studio writes enabled connectors into each project's `.mcp.json`, `.codex/config.toml` and
 * `.gemini/settings.json`, leaving entries it does not manage alone.
 */
export interface Connector {
  /** Also the server's name in the agents' configuration. */
  id: string
  name: string
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  /** Shipped with Studio (the Mathodology search server); can be turned off but not removed. */
  builtin?: boolean
}

export interface ConnectorCheck {
  ok: boolean
  tools: string[]
  error?: string
}

/** A paper found through the search connector. */
export interface LitResult {
  title: string
  url: string
  snippet: string
  /** Authors or venue, when the source puts them before the abstract. */
  byline?: string
  date?: string
  doi?: string
  arxiv?: string
  citedBy?: number
  /** Peer-reviewed publication, preprint, dataset or other web page. */
  kind?: 'published' | 'preprint' | 'dataset' | 'web'
  /** Other copies of the same work folded into this result, e.g. the preprint of a journal article. */
  alts?: { url: string; kind: 'published' | 'preprint' | 'dataset' | 'web'; doi?: string; arxiv?: string }[]
  /** The citation graph flags it as retracted. */
  retracted?: boolean
}

/** One hop of a paper's citation graph. */
export interface LitGraph {
  references: LitResult[]
  citations: LitResult[]
  /** What the lookup left out, e.g. "Showing 10 of 778 citing works". */
  notes: string[]
}

export interface LitCitation {
  key: string
  bibtex: string
  /** Project-relative path of the bibliography it was added to. */
  file: string
  added: boolean
  /** Crossref, Retraction Watch or OpenAlex reports a retraction for this DOI. */
  retracted?: boolean
  /** What the DOI system said about the paper's DOI. */
  check?: DoiCheck
  /** Where the entry's fields came from: the registry's BibTeX or record, or only the search result. */
  source: 'registry' | 'record' | 'search'
  /** The registry's title differs from the search result's: the result may carry the wrong DOI. */
  mismatch?: string
  /** The DOI does not exist, so nothing was written. */
  refused?: boolean
}

/** `invalid` is not DOI syntax; `unverifiable` means no registry answered either way. */
export type DoiState = 'resolves' | 'not_found' | 'unverifiable' | 'invalid'

export interface RegistryNotice {
  kind: 'retraction' | 'withdrawal' | 'concern' | 'correction'
  /** The notice's own DOI, when the registry links one. */
  doi?: string
  source?: string
  year?: number
}

/** Metadata as the registering agency holds it. */
export interface RegistryRecord {
  title: string
  authors: { family: string; given?: string }[]
  year?: number
  venue?: string
  type?: string
  publisher?: string
  /** DOIs of the published version, for a preprint. */
  publishedAs?: string[]
  /** This DOI is itself a notice (e.g. a retraction notice) about another DOI. */
  noticeFor?: { doi: string; kind: RegistryNotice['kind'] }
}

export interface DoiCheck {
  doi: string
  state: DoiState
  /** The registering agency, lowercase (`crossref`, `datacite`, `istic`…). */
  registry?: string
  record?: RegistryRecord
  notices: RegistryNotice[]
  error?: string
}

export type RefVerdict = 'ok' | 'warn' | 'fail' | 'inconclusive'

export type RefProblemCode =
  | 'invalid_doi'
  | 'not_found'
  | 'unverifiable'
  | 'no_record'
  | 'title_mismatch'
  | 'title_differs'
  | 'author_differs'
  | 'year_differs'
  | 'retracted'
  | 'withdrawn'
  | 'concern'
  | 'corrected'
  | 'is_notice'
  | 'arxiv_not_found'
  | 'has_published'
  | 'no_doi'
  | 'no_match'
  | 'no_title'

export interface RefProblem {
  code: RefProblemCode
  severity: 'fail' | 'warn' | 'inconclusive' | 'info'
  /** The registry's value, or the error, for display next to the entry's own. */
  detail?: string
}

/** A registry record that matches an entry written without a DOI. */
export interface RefCandidate {
  doi: string
  record: RegistryRecord
  similarity: number
  score: number
  via: 'crossref' | 'arxiv'
}

export interface RefEntryCheck {
  key: string
  type: string
  /** 1-based line of the entry in its file. */
  line: number
  title: string
  author: string
  year?: string
  /** The DOI as written in the entry. */
  doi?: string
  verdict: RefVerdict
  problems: RefProblem[]
  check?: DoiCheck
  candidate?: RefCandidate
}

/** A check of one bibliography file against the DOI registries. */
export interface RefReport {
  /** Project-relative path of the file checked. */
  file: string
  /** Every .bib file in the project's paper folder, for switching. */
  files: string[]
  checkedAt: number
  entries: RefEntryCheck[]
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
