import { app, dialog, shell, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { Project, Settings } from '@shared/types'
import type { AgentDetection } from '../agents/detect'
import { syncConnectors } from '../connectors'
import { listFiles, previewFile, within } from '../files'
import { installKit, readKit } from '../kit'
import type { ReviewManager } from '../reviews'
import type { SessionManager } from '../sessions'
import type { Store } from '../store'
import type { StudioHandlers, StudioPush } from '../ipc'

function slug(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 64) || 'project'
  )
}

/** Which connector entries Studio wrote into a project's agent configs; the others are the user's. */
export function connectorLedger(projectId: string): string {
  return join(app.getPath('userData'), 'studio', 'connectors', `${projectId}.json`)
}

export function workspaceHandlers(deps: {
  store: Store; sessions: SessionManager; reviews: ReviewManager; detection: AgentDetection;
  kitRoot: string; getSettings(): Settings; setSettings(settings: Settings): void; applyTheme(): void;
  window(): BrowserWindow | null; push: StudioPush; ensureHumanizer(project: Project): void
}) {
  const { store, sessions, reviews, detection, kitRoot, getSettings, setSettings, applyTheme, window, push, ensureHumanizer } = deps
  const openable = (path: string): boolean =>
    isAbsolute(path) && (resolve(path) === resolve(app.getPath('userData')) || store.projects.some((p) => within(p.path, path)))
  return {
    'app:info': () => ({
      version: app.getVersion(),
      platform: process.platform,
      userData: app.getPath('userData'),
      kit: readKit(kitRoot)
    }),
    'settings:get': getSettings,
    'settings:set': (patch) => {
      const settings = getSettings()
      const before = settings.connectors
      const next = {
        ...settings,
        ...patch,
        agents: patch.agents ? { ...settings.agents, ...patch.agents } : settings.agents
      }
      store.saveSettings(next)
      setSettings(next)
      if (patch.connectors) {
        const removed = before.filter((c) => !next.connectors.some((x) => x.id === c.id)).map((c) => c.id)
        for (const p of store.projects.filter((p) => p.kitInstalled && existsSync(p.path))) {
          if (syncConnectors(p.path, next.connectors, connectorLedger(p.id), removed).length) push('files:changed', { projectId: p.id })
        }
      }
      if (patch.theme) applyTheme()
      if (patch.agents) detection.invalidate()
      if (patch.installHumanizer) for (const p of store.projects.filter((p) => p.kitInstalled)) ensureHumanizer(p)
      return next
    },
    'agents:detect': (refresh) => detection.get(refresh),
    'projects:list': () => store.projects,
    'projects:create': (input) => {
      let path: string
      if (input.existingPath) {
        if (!isAbsolute(input.existingPath) || !statSync(input.existingPath).isDirectory()) throw new Error('Choose an existing project folder')
        path = input.existingPath
      } else {
        const parent = input.parentDir || getSettings().workspaceRoot
        if (!isAbsolute(parent)) throw new Error('Choose an absolute workspace folder')
        mkdirSync(parent, { recursive: true })
        path = join(parent, slug(input.name))
        for (let i = 2; existsSync(path); i++) path = join(parent, `${slug(input.name)}-${i}`)
        mkdirSync(path, { recursive: true })
      }
      const project: Project = {
        id: randomUUID(),
        name: input.name.trim() || 'Untitled project',
        path,
        contest: input.contest,
        createdAt: Date.now(),
        kitInstalled: false
      }
      if (input.installKit) {
        installKit(kitRoot, path, input.contest)
        syncConnectors(path, getSettings().connectors, connectorLedger(project.id))
        project.kitInstalled = true
      }
      store.upsertProject(project)
      if (project.kitInstalled) ensureHumanizer(project)
      return project
    },
    'projects:installKit': (projectId) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      installKit(kitRoot, project.path, project.contest)
      syncConnectors(project.path, getSettings().connectors, connectorLedger(projectId))
      const next = { ...project, kitInstalled: true }
      store.upsertProject(next)
      push('files:changed', { projectId })
      ensureHumanizer(next)
      return next
    },
    'projects:remove': (projectId) => {
      if (!store.project(projectId)) return
      // Interrupted turns wind down after this; they no longer save or record anything.
      for (const s of store.sessions.filter((s) => s.projectId === projectId)) {
        sessions.interrupt(s.id)
        reviews.remove(s.id)
      }
      store.removeProject(projectId)
      rmSync(connectorLedger(projectId), { force: true })
    },
    'sessions:list': () => store.sessions,
    'sessions:create': (input) => sessions.create(input),
    'sessions:update': (sessionId, patch) => sessions.update(sessionId, patch),
    'sessions:delete': (sessionId) => {
      // The id names files in the data folder, so only a stored session's is used.
      if (!store.session(sessionId)) return
      sessions.interrupt(sessionId)
      store.removeSession(sessionId)
      reviews.remove(sessionId)
    },
    'sessions:events': (sessionId) => store.session(sessionId) ? store.events(sessionId) : [],
    'sessions:send': (input) => sessions.send(input),
    'sessions:sendQueued': (sessionId, itemId) => sessions.sendQueued(sessionId, itemId),
    'sessions:dequeue': (sessionId, itemId) => sessions.dequeue(sessionId, itemId),
    'sessions:interrupt': (sessionId) => sessions.interrupt(sessionId),
    'sessions:respondPermission': (sessionId, requestId, allow, always, answers) =>
      sessions.respondPermission(sessionId, requestId, allow, always, answers),
    'files:list': (projectId, rel) => {
      const project = store.project(projectId)
      if (!project || !existsSync(project.path)) return []
      return listFiles(project.path, rel)
    },
    'files:preview': (projectId, rel) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      return previewFile(project.path, rel)
    },
    'shell:openPath': async (path) => {
      if (!openable(path)) throw new Error('Studio only opens files inside a project.')
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    'shell:openExternal': async (url) => {
      await shell.openExternal(url)
    },
    'dialog:pickFolder': async (title) => {
      const r = await dialog.showOpenDialog(window()!, {
        title,
        properties: ['openDirectory', 'createDirectory']
      })
      return r.canceled ? null : r.filePaths[0]
    },
    'dialog:pickFiles': async () => {
      const r = await dialog.showOpenDialog(window()!, { properties: ['openFile', 'multiSelections'] })
      return r.canceled ? [] : r.filePaths
    }
  } satisfies Partial<StudioHandlers>
}
