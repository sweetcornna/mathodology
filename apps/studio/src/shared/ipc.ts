import type {
  AgentId,
  AgentInfo,
  AppInfo,
  CreateProjectInput,
  CreateSessionInput,
  FileEntry,
  FilePreview,
  PermissionMode,
  Project,
  SendMessageInput,
  Session,
  SessionEvent,
  Settings
} from './types'

/** Request/response calls the renderer can make. Each key is also the IPC channel name. */
export interface StudioCalls {
  'app:info': () => AppInfo
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => Settings
  'agents:detect': (refresh?: boolean) => AgentInfo[]
  'projects:list': () => Project[]
  'projects:create': (input: CreateProjectInput) => Project
  'projects:installKit': (projectId: string) => Project
  'projects:remove': (projectId: string) => void
  'sessions:list': () => Session[]
  'sessions:create': (input: CreateSessionInput) => Session
  'sessions:update': (
    sessionId: string,
    patch: Partial<Pick<Session, 'title' | 'pinned' | 'archived' | 'model' | 'permissionMode' | 'agent'>>
  ) => Session
  'sessions:delete': (sessionId: string) => void
  'sessions:events': (sessionId: string) => SessionEvent[]
  'sessions:send': (input: SendMessageInput) => void
  'sessions:interrupt': (sessionId: string) => void
  'sessions:respondPermission': (
    sessionId: string,
    requestId: string,
    allow: boolean,
    always?: boolean
  ) => void
  'files:list': (projectId: string, rel?: string) => FileEntry[]
  'files:preview': (projectId: string, rel: string) => FilePreview
  'files:figures': (projectId: string) => FileEntry[]
  'shell:openPath': (path: string) => void
  'shell:reveal': (path: string) => void
  'shell:openExternal': (url: string) => void
  'dialog:pickFolder': (title?: string) => string | null
  'dialog:pickFiles': () => string[]
}

/** Push messages from main to renderer. */
export interface StudioPushes {
  'session:event': SessionEvent
  'session:changed': Session
  'project:changed': Project
  'files:changed': { projectId: string }
  'menu:command': MenuCommand
}

export type MenuCommand =
  | 'new-session'
  | 'new-project'
  | 'open-settings'
  | 'toggle-sidebar'
  | 'toggle-pane'
  | 'command-palette'

type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never

export type StudioApi = {
  call<K extends keyof StudioCalls>(channel: K, ...args: Parameters<StudioCalls[K]>): ReturnType<Async<StudioCalls[K]>>
  on<K extends keyof StudioPushes>(channel: K, listener: (payload: StudioPushes[K]) => void): () => void
  platform: string
  /** Absolute path of a dropped file (Electron removed File.path). */
  pathForFile(file: File): string
}

export const PERMISSION_MODES: PermissionMode[] = ['ask', 'acceptEdits', 'plan', 'bypass']
export const AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini']
