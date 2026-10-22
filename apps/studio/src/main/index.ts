import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MenuCommand, StudioCalls, StudioPushes } from '@shared/ipc'
import type { AgentInfo, Project, Settings } from '@shared/types'
import { killAllAgents } from './agents/base'
import { agentEnv, detectAgents, resolveBinary } from './agents/detect'
import { ArtifactStore } from './artifacts'
import { McpPool, migrateConnectors, syncConnectors } from './connectors'
import { listFiles, previewBytes, previewFile, safeJoin, within } from './files'
import { runner, syncHumanizer, type HumanizerCache } from './humanizer'
import { installKit, readKit } from './kit'
import { cite, mergeResults, parseGraph, parseResults, publishedVersion } from './literature'
import { checkBibliography, checkEntry, parseBibtex, withDoi, type Fetcher } from './refcheck'
import { ReviewManager } from './reviews'
import { ADAPTERS, SessionManager } from './sessions'
import { Store, writeAtomic } from './store'
import { refreshSearchServer } from './updates'

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)

app.setName('Mathodology Studio')
if (process.env.STUDIO_USER_DATA) app.setPath('userData', resolve(process.env.STUDIO_USER_DATA))

// One window per data directory: two instances would race on the same state files.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// Project files (figures, PDFs) are served to the renderer through a scheme that is confined to
// registered project folders, so the page never needs file:// access.
protocol.registerSchemesAsPrivileged([
  { scheme: 'studio-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const kitRoot = app.isPackaged ? join(process.resourcesPath, 'kit') : resolve(app.getAppPath(), '../..')

function defaultSettings(): Settings {
  const blank = { binaryPath: '', defaultModel: '', extraArgs: '' }
  return {
    onboarded: false,
    locale: [app.getLocale(), ...app.getPreferredSystemLanguages()].some((l) => l.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en',
    theme: 'system',
    fontScale: 1,
    workspaceRoot: join(homedir(), 'Documents', 'Mathodology'),
    defaultAgent: 'claude',
    defaultPermissionMode: 'ask',
    sendWithEnter: true,
    installHumanizer: true,
    // Filled in from the saved settings, or with the search server for new installs.
    connectors: [],
    agents: { claude: { ...blank }, codex: { ...blank }, gemini: { ...blank } }
  }
}

let store: Store
let settings: Settings
let sessions: SessionManager
let artifacts: ArtifactStore
let reviews: ReviewManager
const mcp = new McpPool(agentEnv)
/** Registry lookups go through Chromium's network stack, so system proxies apply; none may hang. */
const registryFetch: Fetcher = (url, init) => net.fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
let win: BrowserWindow | null = null
let agentCache: AgentInfo[] | null = null

function push<K extends keyof StudioPushes>(channel: K, payload: StudioPushes[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function applyTheme(): void {
  nativeTheme.themeSource = settings.theme
}

let humanizerQueue: Promise<void> = Promise.resolve()
/** GitHub and the marketplace are asked about new humanizer versions once per launch. */
const humanizerCache: HumanizerCache = {}

/**
 * Give a kit project the humanizer for its three agents, or update it, in the background and one
 * project at a time (the Claude marketplace step clones a repository). Failures only skip the project.
 */
function ensureHumanizer(project: Project): void {
  if (!settings.installHumanizer || !existsSync(project.path)) return
  humanizerQueue = humanizerQueue.then(async () => {
    const env = await agentEnv()
    const result = await syncHumanizer(project.path, {
      claudeBinary: resolveBinary(ADAPTERS.claude, settings, env),
      run: runner(env),
      fetch: (url) => registryFetch(url),
      cache: humanizerCache
    })
    if (result.error) console.warn(`humanizer for ${project.path}: ${result.error}`)
    if (result.claude !== 'present' || result.skill !== 'present') push('files:changed', { projectId: project.id })
  }).catch((err) => console.warn('humanizer install failed', err))
}

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
function connectorLedger(projectId: string): string {
  return join(app.getPath('userData'), 'studio', 'connectors', `${projectId}.json`)
}

/** Paths the renderer may open: project files and Studio's own data folder, nothing else. */
function openable(path: string): boolean {
  if (!isAbsolute(path)) return false
  return resolve(path) === resolve(app.getPath('userData')) || store.projects.some((p) => within(p.path, path))
}

const handlers: { [K in keyof StudioCalls]: (...args: Parameters<StudioCalls[K]>) => unknown } = {
  'app:info': () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    kit: readKit(kitRoot)
  }),
  'settings:get': () => settings,
  'settings:set': (patch) => {
    const before = settings.connectors
    settings = {
      ...settings,
      ...patch,
      agents: patch.agents ? { ...settings.agents, ...patch.agents } : settings.agents
    }
    store.saveSettings(settings)
    if (patch.connectors) {
      const removed = before.filter((c) => !settings.connectors.some((x) => x.id === c.id)).map((c) => c.id)
      for (const p of store.projects.filter((p) => p.kitInstalled && existsSync(p.path))) {
        if (syncConnectors(p.path, settings.connectors, connectorLedger(p.id), removed).length) push('files:changed', { projectId: p.id })
      }
    }
    if (patch.theme) applyTheme()
    if (patch.agents) agentCache = null
    if (patch.installHumanizer) for (const p of store.projects.filter((p) => p.kitInstalled)) ensureHumanizer(p)
    return settings
  },
  'agents:detect': async (refresh) => {
    if (!agentCache || refresh) agentCache = await detectAgents(ADAPTERS, settings)
    return agentCache
  },
  'projects:list': () => store.projects,
  'projects:create': (input) => {
    let path: string
    if (input.existingPath) {
      path = input.existingPath
    } else {
      const parent = input.parentDir || settings.workspaceRoot
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
      installKit(kitRoot, path)
      syncConnectors(path, settings.connectors, connectorLedger(project.id))
      project.kitInstalled = true
    }
    store.upsertProject(project)
    if (project.kitInstalled) ensureHumanizer(project)
    return project
  },
  'projects:installKit': (projectId) => {
    const project = store.project(projectId)
    if (!project) throw new Error('Unknown project')
    installKit(kitRoot, project.path)
    syncConnectors(project.path, settings.connectors, connectorLedger(projectId))
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
  'sessions:events': (sessionId) => store.events(sessionId),
  'sessions:send': (input) => sessions.send(input),
  'sessions:interrupt': (sessionId) => sessions.interrupt(sessionId),
  'sessions:respondPermission': (sessionId, requestId, allow, always) =>
    sessions.respondPermission(sessionId, requestId, allow, always),
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
  'artifacts:list': (projectId) => {
    const project = store.project(projectId)
    if (!project) return []
    // While a turn runs, new files are left for the turn's own scan to attribute.
    if (existsSync(project.path) && !sessions.projectBusy(projectId)) artifacts.capture(project, 'scan', { origin: 'external' })
    return artifacts.list(projectId)
  },
  'artifacts:read': (projectId, artifactId, v) => {
    const project = store.project(projectId)
    const artifact = project && artifacts.get(projectId, artifactId)
    if (!project || !artifact) throw new Error('Unknown artifact')
    const bytes = artifacts.read(projectId, artifactId, v)
    const path = join(project.path, artifact.rel)
    if (!bytes) return { path, kind: 'too-large', size: artifact.versions.find((x) => x.v === v)?.size ?? 0 }
    return previewBytes(path, bytes)
  },
  'artifacts:restore': (projectId, artifactId, v) => {
    const project = store.project(projectId)
    if (!project) throw new Error('Unknown project')
    const restored = artifacts.restore(project, artifactId, v)
    push('files:changed', { projectId })
    push('artifacts:changed', { projectId })
    return restored?.artifact ?? null
  },
  'sessions:dequeue': (sessionId, queuedId) => sessions.dequeue(sessionId, queuedId),
  'connectors:check': (connector) => mcp.check(connector),
  'lit:search': async (query, category) => {
    const search = settings.connectors.find((c) => c.builtin)
    if (!search) throw new Error('The search connector is missing.')
    const text = await mcp.callText(search, 'search', { query, category: category || 'paper', max_results: 12, format: 'json' })
    return mergeResults(parseResults(text), category)
  },
  'lit:cite': async (projectId, paper) => {
    const project = store.project(projectId)
    if (!project) throw new Error('Unknown project')
    const result = await cite(project.path, paper, registryFetch)
    if (result.added) push('files:changed', { projectId })
    return result
  },
  'lit:graph': async (paper) => {
    const search = settings.connectors.find((c) => c.builtin)
    if (!search) throw new Error('The search connector is missing.')
    const text = await mcp.callText(search, 'paper_graph', { paper: paper.doi ?? paper.title, direction: 'both', limit: 8, format: 'json' }, 60_000)
    return parseGraph(text)
  },
  'lit:published': (paper) => publishedVersion(paper, registryFetch),
  'refs:check': async (projectId, file) => {
    const project = store.project(projectId)
    if (!project) throw new Error('Unknown project')
    return checkBibliography(project.path, file, registryFetch, (done, total) => push('refs:progress', { projectId, done, total }))
  },
  'refs:setDoi': async (projectId, file, key, doi) => {
    const project = store.project(projectId)
    if (!project) throw new Error('Unknown project')
    const abs = safeJoin(project.path, file)
    if (!abs.endsWith('.bib')) throw new Error('Not a bibliography file')
    const next = withDoi(readFileSync(abs, 'utf8'), key, doi)
    if (next === null) throw new Error(`${key} already has a DOI or is not in ${file}`)
    writeAtomic(abs, next)
    push('files:changed', { projectId })
    const entry = parseBibtex(next).find((e) => e.key === key)!
    return checkEntry(entry, registryFetch)
  },
  // Review files are named after the session, so only stored sessions are looked up.
  'reviews:list': (sessionId) => (store.session(sessionId) ? reviews.list(sessionId) : []),
  'reviews:start': (sessionId) => {
    if (sessions.isRunning(sessionId)) throw new Error('Wait for the current turn to finish before reviewing.')
    return reviews.start(sessionId)
  },
  'reviews:cancel': (reviewId) => reviews.cancel(reviewId),
  'reviews:setStatus': (sessionId, reviewId, findingId, status) =>
    store.session(sessionId) ? reviews.setStatus(sessionId, reviewId, findingId, status) : undefined,
  'shell:openPath': async (path) => {
    if (!openable(path)) throw new Error('Studio only opens files inside a project.')
    await shell.openPath(path)
  },
  'shell:reveal': (path) => shell.showItemInFolder(path),
  'shell:openExternal': async (url) => {
    if (/^(https?|mailto):/i.test(url)) await shell.openExternal(url)
  },
  'dialog:pickFolder': async (title) => {
    const r = await dialog.showOpenDialog(win!, {
      title,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  },
  'dialog:pickFiles': async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  }
}

function registerIpc(): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => (handler as (...a: unknown[]) => unknown)(...args))
  }
}

function menuCommand(command: MenuCommand): () => void {
  return () => push('menu:command', command)
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: menuCommand('open-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: menuCommand('new-session') },
        { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N', click: menuCommand('new-project') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: menuCommand('command-palette') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: menuCommand('toggle-sidebar') },
        { label: 'Toggle Side Panel', accelerator: 'CmdOrCtrl+\\', click: menuCommand('toggle-pane') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Mathodology on GitHub',
          click: () => void shell.openExternal('https://github.com/sweetcornna/mathodology')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Mathodology Studio',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1b' : '#faf9f6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    win = null
  })
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf'
}

function registerFileProtocol(): void {
  // studio-file://project/<projectId>/<relative path>
  // studio-file://artifact/<projectId>/<artifactId>/<version>  (a stored version's bytes)
  protocol.handle('studio-file', (request) => {
    try {
      const url = new URL(request.url)
      const [projectId, ...parts] = url.pathname.replace(/^\/+/, '').split('/')
      const project = store.project(decodeURIComponent(projectId))
      if (!project) return new Response('Not found', { status: 404 })
      if (url.host === 'artifact') {
        const artifact = artifacts.get(project.id, decodeURIComponent(parts[0] ?? ''))
        const bytes = artifact && artifacts.read(project.id, artifact.id, Number(parts[1]))
        if (!artifact || !bytes) return new Response('Not found', { status: 404 })
        const type = MIME[extname(artifact.rel).toLowerCase()] ?? 'application/octet-stream'
        return new Response(new Uint8Array(bytes), { headers: { 'content-type': type } })
      }
      if (url.host !== 'project') return new Response('Not found', { status: 404 })
      // safeJoin resolves links, so a link in the project cannot serve a file outside it.
      const abs = safeJoin(project.path, parts.map(decodeURIComponent).join('/'))
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
  })
}

app.whenReady().then(() => {
  // Packaged builds carry the icon in the bundle; unpackaged runs would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  store = new Store(join(app.getPath('userData'), 'studio'))
  registerFileProtocol()
  settings = store.loadSettings(defaultSettings())
  const legacy = settings as Settings & { enableSearchMcp?: boolean }
  settings.connectors = migrateConnectors({ connectors: settings.connectors.length ? settings.connectors : undefined, enableSearchMcp: legacy.enableSearchMcp })
  delete legacy.enableSearchMcp
  // Projects made before connectors existed get the same servers in all three CLIs' configs.
  for (const p of store.projects.filter((p) => p.kitInstalled && existsSync(p.path))) syncConnectors(p.path, settings.connectors, connectorLedger(p.id))
  applyTheme()
  artifacts = new ArtifactStore(join(app.getPath('userData'), 'studio', 'artifacts'))
  sessions = new SessionManager(store, artifacts, () => settings, {
    event: (e) => push('session:event', e),
    changed: (s) => push('session:changed', s),
    filesChanged: (projectId) => push('files:changed', { projectId }),
    artifactsChanged: (projectId) => push('artifacts:changed', { projectId })
  })
  reviews = new ReviewManager(
    join(app.getPath('userData'), 'studio', 'reviews'),
    store,
    () => settings,
    { changed: (r) => push('review:changed', r) },
    registryFetch
  )
  registerIpc()
  buildMenu()
  createWindow()
  // Kit projects get the humanizer, or a newer version of it, unless it is switched off.
  for (const p of store.projects.filter((p) => p.kitInstalled)) ensureHumanizer(p)
  void agentEnv()
    .then((env) => refreshSearchServer(settings.connectors, runner(env), homedir()))
    .then((outcome) => outcome === 'failed' && console.warn('could not refresh free-search-mcp'))
    .catch((err) => console.warn('free-search-mcp refresh failed', err))
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !sessions) return
  event.preventDefault()
  quitting = true
  void mcp.close()
  // Turns and reviews get a few seconds to stop; any agent process still running is then killed.
  void Promise.race([
    Promise.allSettled([sessions.shutdown(), reviews?.shutdown()]),
    new Promise((r) => setTimeout(r, 3500))
  ]).finally(() => {
    killAllAgents()
    store.flush()
    app.quit()
  })
})

// A plain kill or logout should still stop running agents and flush state, as Quit does.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
