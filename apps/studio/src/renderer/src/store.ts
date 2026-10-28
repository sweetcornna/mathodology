import { create } from 'zustand'
import type {
  AgentId,
  AgentInfo,
  AppInfo,
  Artifact,
  Attachment,
  FindingStatus,
  PermissionMode,
  Project,
  Review,
  ReviewFinding,
  Session,
  SessionEvent,
  Settings
} from '@shared/types'
import type { StudioCalls } from '@shared/ipc'
import { api } from './lib/api'

export type PaneTab = 'files' | 'artifacts' | 'literature' | 'checks' | 'tasks' | 'preview'

interface StreamBlock {
  text: string
  thinking: boolean
}

interface Draft {
  agent: AgentId
  model: string
  /** Reasoning effort; '' keeps the model's default. */
  effort: string
  permissionMode: PermissionMode
}

interface StudioState {
  ready: boolean
  info: AppInfo | null
  settings: Settings | null
  agents: AgentInfo[]
  projects: Project[]
  sessions: Session[]
  activeProjectId: string | null
  activeSessionId: string | null
  events: Record<string, SessionEvent[]>
  streaming: Record<string, Record<string, StreamBlock>>
  /** Running-turn clock and token counter per session. */
  live: Record<string, { startedAt: number; tokens: number }>
  draft: Draft
  sidebarOpen: boolean
  paneOpen: boolean
  paneTab: PaneTab
  previewRel: string | null
  /** Artifacts of the active project with their version history. */
  artifacts: Artifact[]
  /** The artifact and version open in the side pane's viewer. */
  artifactView: { artifactId: string; v?: number } | null
  /** Transcript item to scroll to and highlight once it renders. */
  focusKey: string | null
  /** Reviews per session, oldest first. */
  reviews: Record<string, Review[]>
  /** Text another panel asked the composer to insert; `n` changes on every request. */
  composerInsert: { text: string; n: number } | null
  dialog: null | 'settings' | 'new-project' | 'onboarding' | 'palette'
  settingsSection: string
  filesVersion: number
  toast: { text: string; tone: 'info' | 'error' } | null
  confirmState: (ConfirmOptions & { resolve(ok: boolean): void }) | null
  promptState: (PromptOptions & { resolve(value: string | null): void }) | null

  init(): Promise<void>
  refreshAgents(refresh?: boolean): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  setDialog(d: StudioState['dialog'], section?: string): void
  selectProject(id: string | null): void
  selectSession(id: string | null): Promise<void>
  newSession(): void
  createProject(p: Project): void
  updateProject(p: Project): void
  removeProject(id: string): Promise<void>
  updateSession(id: string, patch: Parameters<StudioCalls['sessions:update']>[1]): Promise<void>
  deleteSession(id: string): Promise<void>
  send(text: string, attachments: Attachment[]): Promise<void>
  interrupt(): void
  respond(requestId: string, allow: boolean, always?: boolean): void
  setDraft(patch: Partial<Draft>): void
  togglePane(tab?: PaneTab): void
  openPreview(rel: string): void
  loadArtifacts(): Promise<void>
  openArtifact(artifactId: string | null, v?: number): void
  /** Show the turn that started at `turnSeq` in its session. */
  jumpTo(sessionId: string, turnSeq?: number): Promise<void>
  startReview(sessionId?: string): Promise<void>
  cancelReview(reviewId: string): void
  setFindingStatus(review: Review, findingId: string, status: FindingStatus): Promise<void>
  /** Send a review finding back to the session's agent as a request to fix it. */
  askToFix(finding: ReviewFinding): Promise<void>
  insertIntoComposer(text: string): void
  showToast(text: string, tone?: 'info' | 'error'): void
  confirm(opts: ConfirmOptions): Promise<boolean>
  prompt(opts: PromptOptions): Promise<string | null>
  renameSession(id: string): Promise<void>
}

export interface PromptOptions {
  title: string
  value: string
  placeholder?: string
}

export interface ConfirmOptions {
  title: string
  body: string
  danger?: boolean
  confirmLabel?: string
}

const LAST = 'studio.last'

function remember(projectId: string | null, sessionId: string | null): void {
  try {
    localStorage.setItem(LAST, JSON.stringify({ projectId, sessionId }))
  } catch {
    // storage can be unavailable; selection just isn't restored
  }
}

function recall(): { projectId: string | null; sessionId: string | null } {
  try {
    return JSON.parse(localStorage.getItem(LAST) ?? '{}')
  } catch {
    return { projectId: null, sessionId: null }
  }
}

export const useStudio = create<StudioState>((set, get) => ({
  ready: false,
  info: null,
  settings: null,
  agents: [],
  projects: [],
  sessions: [],
  activeProjectId: null,
  activeSessionId: null,
  events: {},
  streaming: {},
  live: {},
  draft: { agent: 'claude', model: '', effort: '', permissionMode: 'ask' },
  sidebarOpen: true,
  paneOpen: false,
  paneTab: 'files',
  previewRel: null,
  artifacts: [],
  artifactView: null,
  focusKey: null,
  reviews: {},
  composerInsert: null,
  dialog: null,
  settingsSection: 'general',
  filesVersion: 0,
  toast: null,
  confirmState: null,
  promptState: null,

  async init() {
    const [info, settings, projects, sessions] = await Promise.all([
      api.call('app:info'),
      api.call('settings:get'),
      api.call('projects:list'),
      api.call('sessions:list')
    ])
    const last = recall()
    const project = projects.find((p) => p.id === last.projectId) ?? projects[0] ?? null
    set({
      info,
      settings,
      projects,
      sessions,
      activeProjectId: project?.id ?? null,
      draft: { agent: settings.defaultAgent, model: '', effort: '', permissionMode: settings.defaultPermissionMode },
      dialog: settings.onboarded ? null : 'onboarding',
      ready: true
    })
    const session = sessions.find((s) => s.id === last.sessionId && s.projectId === project?.id)
    if (session) await get().selectSession(session.id)

    api.on('session:event', (e) => {
      set((st) => {
        if (e.kind === 'assistant.delta') {
          const blocks = { ...(st.streaming[e.sessionId] ?? {}) }
          const prev = blocks[e.blockId]
          blocks[e.blockId] = { text: (prev?.text ?? '') + e.text, thinking: Boolean(e.thinking) }
          return { streaming: { ...st.streaming, [e.sessionId]: blocks } }
        }
        if (e.kind === 'tool.output') return {}
        if (e.kind === 'turn.progress') {
          const prev = st.live[e.sessionId]
          return { live: { ...st.live, [e.sessionId]: { startedAt: prev?.startedAt ?? e.ts, tokens: e.tokens } } }
        }
        const list = st.events[e.sessionId]
        const events = list ? { ...st.events, [e.sessionId]: [...list, e] } : st.events
        let streaming = st.streaming
        let live = st.live
        if (e.kind === 'user.message') live = { ...live, [e.sessionId]: { startedAt: e.ts, tokens: 0 } }
        if (e.kind === 'turn.completed') {
          live = { ...live }
          delete live[e.sessionId]
        }
        if (e.kind === 'assistant.text' || e.kind === 'thinking') {
          const blocks = { ...(st.streaming[e.sessionId] ?? {}) }
          delete blocks[e.blockId]
          streaming = { ...st.streaming, [e.sessionId]: blocks }
        } else if (e.kind === 'turn.completed' || e.kind === 'tool.call') {
          // Text streamed before a tool call is finalized by its own event; drop leftovers at turn end.
          if (e.kind === 'turn.completed') streaming = { ...st.streaming, [e.sessionId]: {} }
        }
        return { events, streaming, live }
      })
    })
    api.on('session:changed', (s) => {
      set((st) => ({
        sessions: st.sessions.some((x) => x.id === s.id)
          ? st.sessions.map((x) => (x.id === s.id ? s : x))
          : [...st.sessions, s]
      }))
    })
    api.on('files:changed', ({ projectId }) => {
      if (projectId === get().activeProjectId) set((st) => ({ filesVersion: st.filesVersion + 1 }))
    })
    api.on('review:changed', (r) => {
      set((st) => {
        const list = st.reviews[r.sessionId] ?? []
        const next = list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]
        return { reviews: { ...st.reviews, [r.sessionId]: next } }
      })
    })
    api.on('artifacts:changed', ({ projectId }) => {
      if (projectId === get().activeProjectId) void get().loadArtifacts()
    })
    void get().loadArtifacts()
    void get().refreshAgents()
  },

  async refreshAgents(refresh) {
    const agents = await api.call('agents:detect', refresh)
    set({ agents })
  },

  async saveSettings(patch) {
    const settings = await api.call('settings:set', patch)
    set({ settings })
  },

  setDialog(dialog, section) {
    set({ dialog, ...(section ? { settingsSection: section } : {}) })
  },

  selectProject(id) {
    const changed = id !== get().activeProjectId
    set({ activeProjectId: id, activeSessionId: null, previewRel: null, ...(changed ? { artifacts: [], artifactView: null } : {}) })
    remember(id, null)
    if (changed) void get().loadArtifacts()
  },

  async selectSession(id) {
    if (!id) {
      set({ activeSessionId: null })
      return
    }
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return
    if (session.projectId !== get().activeProjectId) {
      set({ artifacts: [], artifactView: null, previewRel: null })
      queueMicrotask(() => void get().loadArtifacts())
    }
    set({
      activeSessionId: id,
      activeProjectId: session.projectId,
      draft: { agent: session.agent, model: session.model ?? '', effort: session.effort ?? '', permissionMode: session.permissionMode }
    })
    remember(session.projectId, id)
    if (!get().reviews[id]) void api.call('reviews:list', id).then((list) => set((st) => ({ reviews: { ...st.reviews, [id]: list } })))
    if (!get().events[id]) {
      const events = await api.call('sessions:events', id)
      set((st) => ({ events: { ...st.events, [id]: events } }))
    }
  },

  newSession() {
    const s = get().settings
    set({
      activeSessionId: null,
      draft: {
        agent: s?.defaultAgent ?? 'claude',
        model: '',
        effort: '',
        permissionMode: s?.defaultPermissionMode ?? 'ask'
      }
    })
    remember(get().activeProjectId, null)
  },

  createProject(p) {
    set((st) => ({ projects: [...st.projects, p] }))
    get().selectProject(p.id)
  },

  updateProject(p) {
    set((st) => ({ projects: st.projects.map((x) => (x.id === p.id ? p : x)) }))
  },

  async removeProject(id) {
    await api.call('projects:remove', id)
    set((st) => ({
      projects: st.projects.filter((p) => p.id !== id),
      sessions: st.sessions.filter((s) => s.projectId !== id)
    }))
    if (get().activeProjectId === id) get().selectProject(get().projects[0]?.id ?? null)
  },

  async updateSession(id, patch) {
    const s = await api.call('sessions:update', id, patch)
    set((st) => ({ sessions: st.sessions.map((x) => (x.id === s.id ? s : x)) }))
  },

  async deleteSession(id) {
    await api.call('sessions:delete', id)
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      activeSessionId: st.activeSessionId === id ? null : st.activeSessionId
    }))
  },

  async send(text, attachments) {
    const st = get()
    const projectId = st.activeProjectId
    if (!projectId) return
    let sessionId = st.activeSessionId
    if (!sessionId) {
      const session = await api.call('sessions:create', {
        projectId,
        agent: st.draft.agent,
        model: st.draft.model || undefined,
        effort: st.draft.effort || undefined,
        permissionMode: st.draft.permissionMode
      })
      set((x) => ({ sessions: [...x.sessions, session], events: { ...x.events, [session.id]: [] } }))
      await get().selectSession(session.id)
      sessionId = session.id
    }
    try {
      await api.call('sessions:send', { sessionId, text, attachments })
    } catch (err) {
      get().showToast(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
    }
  },

  interrupt() {
    const id = get().activeSessionId
    if (id) void api.call('sessions:interrupt', id)
  },

  respond(requestId, allow, always) {
    const id = get().activeSessionId
    if (id) void api.call('sessions:respondPermission', id, requestId, allow, always)
  },

  setDraft(patch) {
    set((st) => ({ draft: { ...st.draft, ...patch } }))
    const id = get().activeSessionId
    if (id) {
      const d = get().draft
      void get().updateSession(id, { agent: d.agent, model: d.model || undefined, effort: d.effort || undefined, permissionMode: d.permissionMode })
    }
  },

  togglePane(tab) {
    set((st) => {
      if (tab && (!st.paneOpen || st.paneTab !== tab)) return { paneOpen: true, paneTab: tab }
      return { paneOpen: !st.paneOpen }
    })
  },

  openPreview(rel) {
    set({ previewRel: rel, paneOpen: true, paneTab: 'preview' })
  },

  async loadArtifacts() {
    const projectId = get().activeProjectId
    if (!projectId) return set({ artifacts: [] })
    const artifacts = await api.call('artifacts:list', projectId)
    if (get().activeProjectId === projectId) set({ artifacts })
  },

  openArtifact(artifactId, v) {
    set(artifactId ? { artifactView: { artifactId, v }, paneOpen: true, paneTab: 'artifacts' } : { artifactView: null })
  },

  async startReview(sessionId) {
    const id = sessionId ?? get().activeSessionId
    if (!id) return
    try {
      await api.call('reviews:start', id)
    } catch (err) {
      get().showToast(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
    }
  },

  cancelReview(reviewId) {
    void api.call('reviews:cancel', reviewId)
  },

  async setFindingStatus(review, findingId, status) {
    await api.call('reviews:setStatus', review.sessionId, review.id, findingId, status)
  },

  async askToFix(finding) {
    const en = get().settings?.locale === 'en'
    const parts = [
      en ? `A review of this session flagged a problem: ${finding.title}` : `审阅发现了一个问题：${finding.title}`,
      finding.detail,
      finding.evidence.length ? (en ? 'Evidence: ' : '证据：') + finding.evidence.join(', ') : '',
      finding.suggestion ? (en ? 'Suggested fix: ' : '建议：') + finding.suggestion : '',
      en ? 'Please check it and fix it if it holds.' : '请核实，如果属实就修复。'
    ]
    await get().send(parts.filter(Boolean).join('\n\n'), [])
  },

  insertIntoComposer(text) {
    set((st) => ({ composerInsert: { text, n: (st.composerInsert?.n ?? 0) + 1 } }))
  },

  async jumpTo(sessionId, turnSeq) {
    if (get().activeSessionId !== sessionId) await get().selectSession(sessionId)
    set({ focusKey: turnSeq === undefined ? null : `u${turnSeq}` })
  },

  confirm(opts) {
    return new Promise<boolean>((resolve) => {
      set({
        confirmState: {
          ...opts,
          resolve: (ok) => {
            set({ confirmState: null })
            resolve(ok)
          }
        }
      })
    })
  },

  prompt(opts) {
    return new Promise<string | null>((resolve) => {
      set({
        promptState: {
          ...opts,
          resolve: (value) => {
            set({ promptState: null })
            resolve(value)
          }
        }
      })
    })
  },

  async renameSession(id) {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return
    const title = await get().prompt({ title: get().settings?.locale === 'en' ? 'Rename session' : '重命名会话', value: session.title })
    if (title?.trim()) await get().updateSession(id, { title: title.trim() })
  },

  showToast(text, tone = 'info') {
    set({ toast: { text, tone } })
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null })
    }, 4200)
  }
}))
