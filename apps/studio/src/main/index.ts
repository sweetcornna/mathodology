import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MenuCommand, StudioCalls, StudioPushes } from '@shared/ipc'
import type { AgentInfo, Project, Settings } from '@shared/types'
import { detectAgents } from './agents/detect'
import { listFigures, listFiles, previewFile, safeJoin } from './files'
import { installKit, readKit } from './kit'
import { ADAPTERS, SessionManager } from './sessions'
import { Store } from './store'

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
    enableSearchMcp: true,
    agents: { claude: { ...blank }, codex: { ...blank }, gemini: { ...blank } }
  }
}

let store: Store
let settings: Settings
let sessions: SessionManager
let win: BrowserWindow | null = null
let agentCache: AgentInfo[] | null = null

function push<K extends keyof StudioPushes>(channel: K, payload: StudioPushes[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function applyTheme(): void {
  nativeTheme.themeSource = settings.theme
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

const handlers: { [K in keyof StudioCalls]: (...args: Parameters<StudioCalls[K]>) => unknown } = {
  'app:info': () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    kit: readKit(kitRoot)
  }),
  'settings:get': () => settings,
  'settings:set': (patch) => {
    settings = {
      ...settings,
      ...patch,
      agents: patch.agents ? { ...settings.agents, ...patch.agents } : settings.agents
    }
    store.saveSettings(settings)
    if (patch.theme) applyTheme()
    if (patch.agents) agentCache = null
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
      installKit(kitRoot, path, { searchMcp: settings.enableSearchMcp })
      project.kitInstalled = true
    }
    store.upsertProject(project)
    return project
  },
  'projects:installKit': (projectId) => {
    const project = store.project(projectId)
    if (!project) throw new Error('Unknown project')
    installKit(kitRoot, project.path, { searchMcp: settings.enableSearchMcp })
    const next = { ...project, kitInstalled: true }
    store.upsertProject(next)
    push('files:changed', { projectId })
    return next
  },
  'projects:remove': (projectId) => {
    for (const s of store.sessions.filter((s) => s.projectId === projectId)) sessions.interrupt(s.id)
    store.removeProject(projectId)
  },
  'sessions:list': () => store.sessions,
  'sessions:create': (input) => sessions.create(input),
  'sessions:update': (sessionId, patch) => sessions.update(sessionId, patch),
  'sessions:delete': (sessionId) => {
    sessions.interrupt(sessionId)
    store.removeSession(sessionId)
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
  'files:figures': (projectId) => {
    const project = store.project(projectId)
    if (!project || !existsSync(project.path)) return []
    return listFigures(project.path)
  },
  'shell:openPath': async (path) => {
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

function registerFileProtocol(): void {
  // studio-file://project/<projectId>/<relative path>
  protocol.handle('studio-file', (request) => {
    try {
      const url = new URL(request.url)
      const [projectId, ...parts] = url.pathname.replace(/^\/+/, '').split('/')
      const project = store.project(decodeURIComponent(projectId))
      if (url.host !== 'project' || !project) return new Response('Not found', { status: 404 })
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
  applyTheme()
  sessions = new SessionManager(store, () => settings, {
    event: (e) => push('session:event', e),
    changed: (s) => push('session:changed', s),
    filesChanged: (projectId) => push('files:changed', { projectId })
  })
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !sessions) return
  event.preventDefault()
  quitting = true
  void sessions.shutdown().finally(() => {
    store.flush()
    app.quit()
  })
})

// A plain kill or logout should still stop running agents and flush state, as Quit does.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
