import { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MenuCommand, StudioPushes } from '@shared/ipc'
import type { Project, Settings } from '@shared/types'
import { killAllAgents } from './agents/base'
import { AgentDetection, agentEnv, resolveBinary } from './agents/detect'
import { ArtifactStore } from './artifacts'
import { McpPool, migrateConnectors, syncConnectors } from './connectors'
import { safeJoin } from './files'
import { runner, syncHumanizer, type HumanizerCache } from './humanizer'
import type { Fetcher } from './registry'
import { connectorLedger, workspaceHandlers } from './handlers/workspace'
import { researchHandlers } from './handlers/research'
import { isStudioPage, registerStudioIpc, type StudioHandlers } from './ipc'
import { sessionEventPush } from './session-push'
import { bounded } from './agents/supervisor'
import { ReviewManager } from './reviews'
import { ADAPTERS, SessionManager } from './sessions'
import { Store } from './store'
import { refreshSearchServer } from './updates'

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const rendererFile = join(__dirname, '../renderer/index.html')
const rendererEntry = isDev ? process.env.ELECTRON_RENDERER_URL! : pathToFileURL(rendererFile).href

app.setName('Mathodology Studio')
if (process.env.STUDIO_USER_DATA) app.setPath('userData', resolve(process.env.STUDIO_USER_DATA))

// One window per data directory: two instances would race on the same state files.
if (!app.requestSingleInstanceLock()) app.exit(0)
// Taskbar grouping and pinned shortcuts on Windows follow the installer's id.
if (process.platform === 'win32') app.setAppUserModelId('io.github.sweetcornna.mathodology-studio')
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
  return {
    onboarded: false,
    locale: [app.getLocale(), ...app.getPreferredSystemLanguages()].some((l) => l.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en',
    theme: 'system',
    fontScale: 1,
    // Follows a moved, localized or OneDrive-redirected Documents folder.
    workspaceRoot: join(app.getPath('documents'), 'Mathodology'),
    defaultAgent: 'claude',
    defaultPermissionMode: 'ask',
    sendWithEnter: true,
    installHumanizer: true,
    // Filled in from the saved settings, or with the search server for new installs.
    connectors: [],
    // Filled in per agent as you change its settings; see agentSettings().
    agents: {}
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
const detection = new AgentDetection(ADAPTERS, () => settings)

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
    if (quitting) return
    const env = await agentEnv()
    if (quitting) return
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

function menuCommand(command: MenuCommand): () => void {
  return () => push('menu:command', command)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const settingsItem: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: menuCommand('open-settings') }
  const template: MenuItemConstructorOptions[] = [
    // macOS keeps About, Settings and Quit in the application menu; elsewhere they go to File and Help.
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: menuCommand('new-session') },
        { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N', click: menuCommand('new-project') },
        { type: 'separator' },
        ...(isMac ? ([{ role: 'close' }] as MenuItemConstructorOptions[]) : [settingsItem, { type: 'separator' as const }, { role: 'quit' as const }])
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
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'about' as const }])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Linux window managers take the window icon from the window itself; Windows reads the .exe. */
function windowIcon(): string | undefined {
  if (process.platform !== 'linux') return undefined
  const icon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build/icon.png')
  return existsSync(icon) ? icon : undefined
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Mathodology Studio',
    // macOS draws the traffic lights over the page; Windows and Linux keep their own title bar,
    // with the menu bar shown on Alt.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }
      : { autoHideMenuBar: true, icon: windowIcon() }),
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
  // Windows logoff and shutdown skip before-quit: stop the agents and save state here instead.
  win.on('session-end', () => {
    killAllAgents()
    store.flush()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isStudioPage(url, rendererEntry)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  if (isDev) void win.loadURL(rendererEntry)
  else void win.loadFile(rendererFile)
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
  applyTheme()
  artifacts = new ArtifactStore(join(app.getPath('userData'), 'studio', 'artifacts'))
  sessions = new SessionManager(store, artifacts, () => settings, {
    event: sessionEventPush((e) => push('session:event', e)),
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
  const deps = { store, sessions, reviews, kitRoot, getSettings: () => settings, push }
  const handlers: StudioHandlers = {
    ...workspaceHandlers({
      ...deps, detection, applyTheme, window: () => win, ensureHumanizer,
      setSettings: (next) => { settings = next }
    }),
    ...researchHandlers({ ...deps, artifacts, mcp, registryFetch })
  }
  registerStudioIpc(handlers, () => win, rendererEntry)
  buildMenu()
  createWindow()
  // Reconcile older kit projects after the first window is ready, one project per loop tick.
  const reconcile = store.projects.filter((p) => p.kitInstalled)[Symbol.iterator]()
  const reconcileNext = (): void => {
    const { value: project, done } = reconcile.next()
    if (quitting || done) return
    try {
      if (store.project(project.id) && existsSync(project.path) &&
          syncConnectors(project.path, settings.connectors, connectorLedger(project.id)).length) {
        push('files:changed', { projectId: project.id })
      }
    } catch (err) {
      console.warn('project connector reconciliation failed', err)
    }
    setImmediate(reconcileNext)
  }
  win?.once('ready-to-show', () => setImmediate(reconcileNext))
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
  if (!sessions) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void bounded(Promise.allSettled([sessions.shutdown(), reviews?.shutdown(), mcp.close()]), 4500)
    .catch((err) => console.warn('Studio shutdown deadline', err))
    .finally(() => {
      killAllAgents()
      try {
        store.flush()
      } finally {
        app.exit(0)
      }
    })
})

// A plain kill or logout should still stop running agents and flush state, as Quit does.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
