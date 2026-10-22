import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { useStudio } from './store'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmDialog, PromptDialog, Toast } from './components/Dialogs'
import { MainView } from './components/MainView'
import { NewProjectDialog } from './components/NewProjectDialog'
import { Onboarding } from './components/Onboarding'
import { SettingsDialog } from './components/SettingsDialog'
import { SidePane } from './components/SidePane'
import { Sidebar } from './components/Sidebar'
import { TipProvider } from './components/ui'

function useTheme(): void {
  const pref = useStudio((s) => s.settings?.theme ?? 'system')
  const scale = useStudio((s) => s.settings?.fontScale ?? 1)
  const locale = useStudio((s) => s.settings?.locale ?? 'zh-CN')
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const dark = pref === 'dark' || (pref === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.setProperty('--font-scale', String(scale))
    document.documentElement.lang = locale
  }, [dark, scale, locale])
}

function Skeleton() {
  return (
    <div className="flex h-full">
      <div className="w-[var(--sidebar-w)] shrink-0 py-2 pl-2">
        <div className="flex h-full flex-col gap-2 rounded-[10px] bg-sidebar p-3 pt-12 shadow-[var(--shadow-card)]">
          {[70, 55, 80, 62, 74].map((w, i) => (
            <div key={i} className="skeleton h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-end p-8">
        <div className="skeleton h-12 w-full max-w-[var(--column)] rounded-[14px]" />
      </div>
    </div>
  )
}

export function App() {
  const ready = useStudio((s) => s.ready)
  const sidebarOpen = useStudio((s) => s.sidebarOpen)
  const paneOpen = useStudio((s) => s.paneOpen)
  const hasProject = useStudio((s) => Boolean(s.activeProjectId))
  useTheme()

  useEffect(() => {
    void useStudio.getState().init()
    return api.on('menu:command', (command) => {
      const st = useStudio.getState()
      switch (command) {
        case 'new-session':
          if (st.activeProjectId) st.newSession()
          else st.setDialog('new-project')
          break
        case 'new-project':
          st.setDialog('new-project')
          break
        case 'open-settings':
          st.setDialog('settings')
          break
        case 'toggle-sidebar':
          useStudio.setState((s) => ({ sidebarOpen: !s.sidebarOpen }))
          break
        case 'toggle-pane':
          st.togglePane()
          break
        case 'command-palette':
          st.setDialog(st.dialog === 'palette' ? null : 'palette')
          break
      }
    })
  }, [])

  return (
    <TipProvider delayDuration={400} skipDelayDuration={200}>
      {!ready ? (
        <Skeleton />
      ) : (
        <div className="flex h-full">
          {sidebarOpen && <Sidebar />}
          <MainView />
          {paneOpen && hasProject && <SidePane />}
        </div>
      )}
      <SettingsDialog />
      <NewProjectDialog />
      <Onboarding />
      <CommandPalette />
      <ConfirmDialog />
      <PromptDialog />
      <Toast />
    </TipProvider>
  )
}
