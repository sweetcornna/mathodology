import { create } from 'zustand'
import type {
  AgentId,
  AgentInfo,
  AgentSettings,
  AppInfo,
  Artifact,
  Attachment,
  Connector,
  FindingStatus,
  PermissionMode,
  Project,
  QueuedMessage,
  Review,
  ReviewFinding,
  Session,
  SessionEvent,
  Settings
} from '@shared/types'
import type { StudioCalls } from '@shared/ipc'
import { api } from './lib/api'
import { evictTranscript } from './lib/transcript'

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

interface ComposerDraft {
  text: string
  attachments: Attachment[]
}

interface ToastState {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface PromptOptions {
  title: string
  value: string
  placeholder?: string
}

interface ConfirmOptions {
  title: string
  body: string
  danger?: boolean
  confirmLabel?: string
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
  /** Unsent composer drafts keyed by session or project. */
  composerDrafts: Record<string, ComposerDraft>
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
  /** Bumps when another panel inserts text into the active composer so it focuses and moves caret. */
  composerInsert: { text: string; n: number } | null
  dialog: null | 'settings' | 'new-project' | 'onboarding' | 'palette'
  settingsSection: string
  filesVersion: number
  toast: ToastState | null
  confirmState: (ConfirmOptions & { resolve(ok: boolean): void }) | null
  promptState: (PromptOptions & { resolve(value: string | null): void }) | null

  init(): Promise<void>
  subscribe(): () => void
  refreshAgents(refresh?: boolean): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  updateConnectors(updater: (current: Connector[]) => Connector[]): Promise<void>
  updateAgentSettings(id: AgentId, agentSettings: AgentSettings): Promise<void>
  setDialog(d: StudioState['dialog'], section?: string): void
  selectProject(id: string | null): void
  selectSession(id: string | null): Promise<void>
  loadEvents(sessionId: string): Promise<SessionEvent[]>
  newSession(): void
  createProject(p: Project): void
  updateProject(p: Project): void
  removeProject(id: string): Promise<void>
  updateSession(id: string, patch: Parameters<StudioCalls['sessions:update']>[1]): Promise<void>
  deleteSession(id: string): Promise<void>
  send(text: string, attachments: Attachment[]): Promise<boolean>
  sendQueued(sessionId: string, itemId: string): Promise<void>
  dequeue(sessionId: string, itemId: string): Promise<boolean>
  editQueued(sessionId: string, item: QueuedMessage): Promise<boolean>
  interrupt(): void
  respond(requestId: string, allow: boolean, always?: boolean, answers?: Record<string, string[]>): void
  setDraft(patch: Partial<Draft>): void
  setComposerDraft(key: string, patch: Partial<ComposerDraft>): void
  clearComposerDraft(key: string, ifMatches?: ComposerDraft): void
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

// ---------------------------------------------------------------------------
// Storage, draft keys & error formatting helpers
// ---------------------------------------------------------------------------

const LAST = 'studio.last'

/** Strip Electron's IPC wrapper prefix from main-process error messages. */
export function formatIpcError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

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

function sessionDraftKey(sessionId: string): string {
  return `s:${sessionId}`
}

function projectDraftKey(projectId: string): string {
  return `p:${projectId}`
}

export function activeDraftKey(projectId: string | null, sessionId: string | null): string | null {
  if (sessionId) return sessionDraftKey(sessionId)
  if (projectId) return projectDraftKey(projectId)
  return null
}

function sameAttachments(a: Attachment[], b: Attachment[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x.path === b[i].path && x.name === b[i].name))
}

function sameDraft(a: ComposerDraft | undefined, b: ComposerDraft): boolean {
  const text = a?.text ?? ''
  const files = a?.attachments ?? []
  return text === b.text && sameAttachments(files, b.attachments)
}

function defaultDraft(settings: Settings | null): Draft {
  return {
    agent: settings?.defaultAgent ?? 'claude',
    model: '',
    effort: '',
    permissionMode: settings?.defaultPermissionMode ?? 'ask'
  }
}

// ---------------------------------------------------------------------------
// Event hydration, push merging & review ordering helpers
// ---------------------------------------------------------------------------

/** Merge history and buffered events in ascending `seq` order, deduplicating by `seq`. */
function mergeEvents(base: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  if (incoming.length === 0) {
    let ordered = true
    for (let i = 1; i < base.length; i++) {
      if (base[i].seq <= base[i - 1].seq) {
        ordered = false
        break
      }
    }
    if (ordered) return base
  }
  const bySeq = new Map<number, SessionEvent>()
  for (const e of base) bySeq.set(e.seq, e)
  for (const e of incoming) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

function appendSessionEvent(list: SessionEvent[], event: SessionEvent): SessionEvent[] {
  const last = list[list.length - 1]
  if (!last || event.seq > last.seq) return [...list, event]
  if (list.some((x) => x.seq === event.seq)) return list
  return [...list, event].sort((a, b) => a.seq - b.seq)
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function omitKeys<T>(record: Record<string, T>, keys: Iterable<string>): Record<string, T> {
  let next: Record<string, T> | null = null
  for (const k of keys) {
    if (k in (next ?? record)) {
      next ??= { ...record }
      delete next[k]
    }
  }
  return next ?? record
}

/**
 * Apply a pushed session event onto store state.
 * Returns the exact `st` reference for ignored or redundant events so Zustand subscribers stay idle.
 */
function reduceSessionEvent(st: StudioState, e: SessionEvent, onBuffer?: (event: SessionEvent) => void): StudioState {
  if (e.kind === 'tool.output') return st
  if (e.kind === 'assistant.delta') {
    const curBlocks = st.streaming[e.sessionId] ?? {}
    const prev = curBlocks[e.blockId]
    const nextText = (prev?.text ?? '') + e.text
    const thinking = Boolean(e.thinking)
    if (prev && prev.text === nextText && prev.thinking === thinking) return st
    const blocks = { ...curBlocks, [e.blockId]: { text: nextText, thinking } }
    return { ...st, streaming: { ...st.streaming, [e.sessionId]: blocks } }
  }
  if (e.kind === 'turn.progress') {
    const prev = st.live[e.sessionId]
    const startedAt = prev?.startedAt ?? e.ts
    if (prev && prev.startedAt === startedAt && prev.tokens === e.tokens) return st
    return { ...st, live: { ...st.live, [e.sessionId]: { startedAt, tokens: e.tokens } } }
  }

  const list = st.events[e.sessionId]
  let events = st.events
  if (list) {
    const nextList = appendSessionEvent(list, e)
    if (nextList !== list) events = { ...st.events, [e.sessionId]: nextList }
  } else {
    onBuffer?.(e)
  }

  let live = st.live
  if (e.kind === 'user.message') {
    live = { ...live, [e.sessionId]: { startedAt: e.ts, tokens: 0 } }
  } else if (e.kind === 'turn.completed') {
    live = omitKey(live, e.sessionId)
  }

  let streaming = st.streaming
  if (e.kind === 'assistant.text' || e.kind === 'thinking') {
    const curBlocks = st.streaming[e.sessionId]
    if (curBlocks && e.blockId in curBlocks) {
      const blocks = omitKey(curBlocks, e.blockId)
      streaming = Object.keys(blocks).length ? { ...st.streaming, [e.sessionId]: blocks } : omitKey(st.streaming, e.sessionId)
    }
  } else if (e.kind === 'turn.completed') {
    if (e.sessionId in st.streaming) streaming = omitKey(st.streaming, e.sessionId)
  }

  if (events === st.events && streaming === st.streaming && live === st.live) return st
  return { ...st, events, streaming, live }
}

function pickNewerReview(existing: Review, incoming: Review, pushedDuringLoad: boolean): Review {
  if (pushedDuringLoad) return existing
  if (existing.status !== 'running' && incoming.status === 'running') return existing
  if (incoming.status !== 'running' && existing.status === 'running') return incoming
  if (existing.status === 'running' && incoming.status === 'running') {
    if (existing.steps !== incoming.steps) return existing.steps > incoming.steps ? existing : incoming
    if (existing.findings.length !== incoming.findings.length) {
      return existing.findings.length > incoming.findings.length ? existing : incoming
    }
    if (Boolean(existing.trace) !== Boolean(incoming.trace)) return existing.trace ? existing : incoming
  }
  return incoming
}

function mergeReviews(existing: Review[], listed: Review[], pushedDuringLoad?: ReadonlyMap<string, Review>): Review[] {
  const byId = new Map<string, Review>()
  for (const r of listed) byId.set(r.id, r)
  for (const r of existing) {
    const fromList = byId.get(r.id)
    byId.set(r.id, fromList ? pickNewerReview(r, fromList, Boolean(pushedDuringLoad?.has(r.id))) : r)
  }
  if (pushedDuringLoad) {
    for (const r of pushedDuringLoad.values()) {
      const cur = byId.get(r.id)
      byId.set(r.id, cur ? pickNewerReview(r, cur, true) : r)
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
}

function applyReviewPush(list: Review[], review: Review): Review[] {
  return list.some((x) => x.id === review.id) ? list.map((x) => (x.id === review.id ? review : x)) : [...list, review]
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStudio = create<StudioState>((set, get) => {
  let initialization: Promise<void> | null = null
  let navigationGen = 0
  let artifactsSeq = 0
  let toastSeq = 0
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let connectorQueue: Promise<void> = Promise.resolve()

  const loadedEvents = new Set<string>()
  const loadingEvents = new Map<string, Promise<SessionEvent[]>>()
  const bufferedEvents = new Map<string, SessionEvent[]>()

  const loadedReviews = new Set<string>()
  const loadingReviews = new Map<string, Promise<void>>()
  const pushedDuringReviewLoad = new Map<string, Map<string, Review>>()

  const evictSessions = (sessionIds: string[], extraDraftKeys: string[] = []): void => {
    for (const id of sessionIds) {
      loadedEvents.delete(id)
      loadingEvents.delete(id)
      bufferedEvents.delete(id)
      loadedReviews.delete(id)
      loadingReviews.delete(id)
      pushedDuringReviewLoad.delete(id)
      evictTranscript(id)
    }
    const draftKeys = [...sessionIds.map(sessionDraftKey), ...extraDraftKeys]
    set((st) => ({
      events: omitKeys(st.events, sessionIds),
      reviews: omitKeys(st.reviews, sessionIds),
      streaming: omitKeys(st.streaming, sessionIds),
      live: omitKeys(st.live, sessionIds),
      composerDrafts: omitKeys(st.composerDrafts, draftKeys)
    }))
  }

  const loadReviews = (sessionId: string): Promise<void> => {
    if (loadedReviews.has(sessionId)) return Promise.resolve()
    const inflight = loadingReviews.get(sessionId)
    if (inflight) return inflight
    pushedDuringReviewLoad.set(sessionId, new Map())
    const p = api
      .call('reviews:list', sessionId)
      .then((listed) => {
        const pushed = pushedDuringReviewLoad.get(sessionId)
        pushedDuringReviewLoad.delete(sessionId)
        loadingReviews.delete(sessionId)
        if (!get().sessions.some((s) => s.id === sessionId)) return
        loadedReviews.add(sessionId)
        set((st) => ({
          reviews: {
            ...st.reviews,
            [sessionId]: mergeReviews(st.reviews[sessionId] ?? [], listed, pushed)
          }
        }))
      })
      .catch((err) => {
        pushedDuringReviewLoad.delete(sessionId)
        loadingReviews.delete(sessionId)
        throw err
      })
    loadingReviews.set(sessionId, p)
    return p
  }

  return {
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
    composerDrafts: {},
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

    init() {
      // StrictMode and Fast Refresh can rerun the App effect while these reads are still pending.
      // Hydration belongs to the store; IPC subscriptions belong to the mounted App effect.
      initialization ??= (async () => {
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
          draft: defaultDraft(settings),
          dialog: settings.onboarded ? null : 'onboarding',
          ready: true
        })
        const session = sessions.find((s) => s.id === last.sessionId && s.projectId === project?.id)
        if (session) await get().selectSession(session.id)
        void get().loadArtifacts()
        void get().refreshAgents()
      })().catch((error: unknown) => {
        initialization = null
        throw error
      })
      return initialization
    },

    subscribe() {
      const offEvents = api.on('session:event', (e) => {
        if (e.kind === 'tool.output') return
        set((st) =>
          reduceSessionEvent(st, e, (buffered) => {
            if (!loadingEvents.has(buffered.sessionId)) return
            const list = bufferedEvents.get(buffered.sessionId)
            if (list) list.push(buffered)
            else bufferedEvents.set(buffered.sessionId, [buffered])
          })
        )
      })
      const offSessions = api.on('session:changed', (s) => {
        set((st) => ({
          sessions: st.sessions.some((x) => x.id === s.id)
            ? st.sessions.map((x) => (x.id === s.id ? s : x))
            : [...st.sessions, s]
        }))
      })
      const offFiles = api.on('files:changed', ({ projectId }) => {
        if (projectId === get().activeProjectId) set((st) => ({ filesVersion: st.filesVersion + 1 }))
      })
      const offReviews = api.on('review:changed', (r) => {
        pushedDuringReviewLoad.get(r.sessionId)?.set(r.id, r)
        set((st) => ({
          reviews: { ...st.reviews, [r.sessionId]: applyReviewPush(st.reviews[r.sessionId] ?? [], r) }
        }))
      })
      const offArtifacts = api.on('artifacts:changed', ({ projectId }) => {
        if (projectId === get().activeProjectId) void get().loadArtifacts()
      })
      return () => {
        offEvents()
        offSessions()
        offFiles()
        offReviews()
        offArtifacts()
      }
    },

    async refreshAgents(refresh) {
      const agents = await api.call('agents:detect', refresh)
      set({ agents })
    },

    async saveSettings(patch) {
      const settings = await api.call('settings:set', patch)
      set({ settings })
    },

    updateConnectors(updater) {
      const run = connectorQueue.then(async () => {
        const current = get().settings?.connectors ?? []
        const next = updater(current)
        await get().saveSettings({ connectors: next })
      })
      connectorQueue = run.catch(() => undefined)
      return run
    },

    async updateAgentSettings(id, agentSettings) {
      await get().saveSettings({ agents: { [id]: agentSettings } })
    },

    setDialog(dialog, section) {
      set({ dialog, ...(section ? { settingsSection: section } : {}) })
    },

    selectProject(id) {
      navigationGen++
      const changed = id !== get().activeProjectId
      set({
        activeProjectId: id,
        activeSessionId: null,
        previewRel: null,
        draft: defaultDraft(get().settings),
        ...(changed ? { artifacts: [], artifactView: null } : {})
      })
      remember(id, null)
      if (changed) void get().loadArtifacts()
    },

    async loadEvents(sessionId) {
      if (loadedEvents.has(sessionId) && get().events[sessionId]) return get().events[sessionId]
      const inflight = loadingEvents.get(sessionId)
      if (inflight) return inflight
      if (!bufferedEvents.has(sessionId)) bufferedEvents.set(sessionId, [])
      const p = api
        .call('sessions:events', sessionId)
        .then((history) => {
          const buffered = bufferedEvents.get(sessionId) ?? []
          bufferedEvents.delete(sessionId)
          loadingEvents.delete(sessionId)
          if (!get().sessions.some((s) => s.id === sessionId)) return []
          loadedEvents.add(sessionId)
          const merged = mergeEvents(mergeEvents(get().events[sessionId] ?? [], history), buffered)
          set((st) => ({ events: { ...st.events, [sessionId]: merged } }))
          return merged
        })
        .catch((err) => {
          bufferedEvents.delete(sessionId)
          loadingEvents.delete(sessionId)
          throw err
        })
      loadingEvents.set(sessionId, p)
      return p
    },

    async selectSession(id) {
      navigationGen++
      if (!id) {
        set({ activeSessionId: null, draft: defaultDraft(get().settings) })
        return
      }
      const session = get().sessions.find((s) => s.id === id)
      if (!session) return
      const projectChanged = session.projectId !== get().activeProjectId
      set({
        activeSessionId: id,
        activeProjectId: session.projectId,
        draft: {
          agent: session.agent,
          model: session.model ?? '',
          effort: session.effort ?? '',
          permissionMode: session.permissionMode
        },
        ...(projectChanged ? { artifacts: [], artifactView: null, previewRel: null } : {})
      })
      remember(session.projectId, id)
      if (projectChanged) void get().loadArtifacts()
      void loadReviews(id)
      if (!loadedEvents.has(id) || !get().events[id]) {
        await get().loadEvents(id)
      }
    },

    newSession() {
      navigationGen++
      set({
        activeSessionId: null,
        draft: defaultDraft(get().settings)
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
      navigationGen++
      const removedSessions = get().sessions.filter((s) => s.projectId === id).map((s) => s.id)
      set((st) => ({
        projects: st.projects.filter((p) => p.id !== id),
        sessions: st.sessions.filter((s) => s.projectId !== id)
      }))
      evictSessions(removedSessions, [projectDraftKey(id)])
      if (get().activeProjectId === id) get().selectProject(get().projects[0]?.id ?? null)
    },

    async updateSession(id, patch) {
      const s = await api.call('sessions:update', id, patch)
      set((st) => ({ sessions: st.sessions.map((x) => (x.id === s.id ? s : x)) }))
    },

    async deleteSession(id) {
      await api.call('sessions:delete', id)
      const wasActive = get().activeSessionId === id
      if (wasActive) navigationGen++
      set((st) => ({
        sessions: st.sessions.filter((s) => s.id !== id),
        ...(wasActive ? { activeSessionId: null, draft: defaultDraft(st.settings) } : {})
      }))
      if (wasActive) remember(get().activeProjectId, null)
      evictSessions([id])
    },

    async send(text, attachments) {
      const st = get()
      const projectId = st.activeProjectId
      if (!projectId) return false
      let sessionId = st.activeSessionId
      let createdNew = false
      if (!sessionId) {
        const navGen = navigationGen
        let session: Awaited<ReturnType<typeof api.call<'sessions:create'>>>
        try {
          session = await api.call('sessions:create', {
            projectId,
            agent: st.draft.agent,
            model: st.draft.model || undefined,
            effort: st.draft.effort || undefined,
            permissionMode: st.draft.permissionMode
          })
        } catch (err) {
          get().showToast(formatIpcError(err), 'error')
          return false
        }
        if (navigationGen !== navGen || get().activeProjectId !== projectId || get().activeSessionId !== null) {
          return false
        }
        createdNew = true
        loadedEvents.add(session.id)
        loadedReviews.add(session.id)
        set((x) => ({
          sessions: x.sessions.some((s) => s.id === session.id) ? x.sessions : [...x.sessions, session],
          events: { ...x.events, [session.id]: x.events[session.id] ?? [] },
          reviews: { ...x.reviews, [session.id]: x.reviews[session.id] ?? [] }
        }))
        await get().selectSession(session.id)
        sessionId = session.id
      }
      try {
        await api.call('sessions:send', { sessionId, text, attachments })
        return true
      } catch (err) {
        if (createdNew) {
          const fromKey = projectDraftKey(projectId)
          const toKey = sessionDraftKey(sessionId)
          set((x) => {
            const from = x.composerDrafts[fromKey]
            const existingTo = x.composerDrafts[toKey]
            if (!from || (existingTo && (existingTo.text || existingTo.attachments.length > 0))) return x
            const nextDrafts = { ...x.composerDrafts, [toKey]: from }
            delete nextDrafts[fromKey]
            return { composerDrafts: nextDrafts }
          })
        }
        get().showToast(formatIpcError(err), 'error')
        return false
      }
    },

    async sendQueued(sessionId, itemId) {
      try {
        await api.call('sessions:sendQueued', sessionId, itemId)
      } catch (err) {
        get().showToast(formatIpcError(err), 'error')
      }
    },

    async dequeue(sessionId, itemId) {
      try {
        const updated = await api.call('sessions:dequeue', sessionId, itemId)
        if (updated) {
          set((st) => ({ sessions: st.sessions.map((s) => (s.id === updated.id ? updated : s)) }))
        }
        return true
      } catch (err) {
        get().showToast(formatIpcError(err), 'error')
        return false
      }
    },

    async editQueued(sessionId, item) {
      if (!(await get().dequeue(sessionId, item.id))) return false
      get().setComposerDraft(sessionDraftKey(sessionId), { text: item.text, attachments: item.attachments })
      return true
    },

    interrupt() {
      const id = get().activeSessionId
      if (id) void api.call('sessions:interrupt', id)
    },

    respond(requestId, allow, always, answers) {
      const id = get().activeSessionId
      if (id) void api.call('sessions:respondPermission', id, requestId, allow, always, answers)
    },

    setDraft(patch) {
      set((st) => ({ draft: { ...st.draft, ...patch } }))
      const id = get().activeSessionId
      if (id) {
        const d = get().draft
        void get().updateSession(id, {
          agent: d.agent,
          model: d.model || undefined,
          effort: d.effort || undefined,
          permissionMode: d.permissionMode
        })
      }
    },

    setComposerDraft(key, patch) {
      set((st) => {
        const prev = st.composerDrafts[key] ?? { text: '', attachments: [] }
        const next: ComposerDraft = { ...prev, ...patch }
        if (!next.text && next.attachments.length === 0) {
          if (!(key in st.composerDrafts)) return st
          const nextDrafts = { ...st.composerDrafts }
          delete nextDrafts[key]
          return { composerDrafts: nextDrafts }
        }
        return { composerDrafts: { ...st.composerDrafts, [key]: next } }
      })
    },

    clearComposerDraft(key, ifMatches) {
      set((st) => {
        const cur = st.composerDrafts[key]
        if (!cur) return st
        if (ifMatches && !sameDraft(cur, ifMatches)) return st
        const nextDrafts = { ...st.composerDrafts }
        delete nextDrafts[key]
        return { composerDrafts: nextDrafts }
      })
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
      const req = ++artifactsSeq
      const projectId = get().activeProjectId
      if (!projectId) {
        set({ artifacts: [] })
        return
      }
      const artifacts = await api.call('artifacts:list', projectId)
      if (req === artifactsSeq && get().activeProjectId === projectId) set({ artifacts })
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
        get().showToast(formatIpcError(err), 'error')
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
      set((st) => {
        const key = activeDraftKey(st.activeProjectId, st.activeSessionId)
        const n = (st.composerInsert?.n ?? 0) + 1
        if (!key) return { composerInsert: { text, n } }
        const prev = st.composerDrafts[key] ?? { text: '', attachments: [] }
        const nextText = prev.text && !/\s$/.test(prev.text) ? `${prev.text}\n${text}` : prev.text + text
        return {
          composerDrafts: { ...st.composerDrafts, [key]: { ...prev, text: nextText } },
          composerInsert: { text, n }
        }
      })
    },

    async jumpTo(sessionId, turnSeq) {
      if (get().activeSessionId !== sessionId) await get().selectSession(sessionId)
      if (get().activeSessionId !== sessionId) return
      set({ focusKey: turnSeq === undefined ? null : `u${turnSeq}` })
    },

    confirm(opts) {
      get().confirmState?.resolve(false)
      return new Promise<boolean>((resolve) => {
        let settled = false
        const entry: NonNullable<StudioState['confirmState']> = {
          ...opts,
          resolve: (ok) => {
            if (settled) return
            settled = true
            if (get().confirmState === entry) set({ confirmState: null })
            resolve(ok)
          }
        }
        set({ confirmState: entry })
      })
    },

    prompt(opts) {
      get().promptState?.resolve(null)
      return new Promise<string | null>((resolve) => {
        let settled = false
        const entry: NonNullable<StudioState['promptState']> = {
          ...opts,
          resolve: (value) => {
            if (settled) return
            settled = true
            if (get().promptState === entry) set({ promptState: null })
            resolve(value)
          }
        }
        set({ promptState: entry })
      })
    },

    async renameSession(id) {
      const session = get().sessions.find((s) => s.id === id)
      if (!session) return
      const title = await get().prompt({
        title: get().settings?.locale === 'en' ? 'Rename session' : '重命名会话',
        value: session.title
      })
      if (title?.trim()) await get().updateSession(id, { title: title.trim() })
    },

    showToast(text, tone = 'info') {
      const id = ++toastSeq
      if (toastTimer !== null) {
        clearTimeout(toastTimer)
        toastTimer = null
      }
      set({ toast: { id, text, tone } })
      toastTimer = setTimeout(() => {
        toastTimer = null
        if (get().toast?.id === id) set({ toast: null })
      }, 4200)
    }
  }
})
