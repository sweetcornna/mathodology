import { useEffect, useRef } from 'react'
import {
  Archive,
  BookOpen,
  ChartScatter,
  ChevronDown,
  FileSearch,
  FolderOpen,
  FolderPlus,
  Layers,
  ListChecks,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Rocket,
  ScrollText,
  ShieldCheck,
  Sigma,
  Trash2,
  Wrench
} from 'lucide-react'
import { api, isMac, mod, tildify } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio, type PaneTab } from '../store'
import { Composer, ModePicker, type ComposerHandle } from './Composer'
import { ModelPicker } from './ModelPicker'
import { Logo } from './Logo'
import { Transcript } from './Transcript'
import { Menu, MenuItem, MenuSep, Tip } from './ui'

const STARTERS: { key: string; icon: typeof Sigma }[] = [
  { key: 'analyze', icon: FileSearch },
  { key: 'model', icon: Sigma },
  { key: 'figures', icon: ChartScatter },
  { key: 'review', icon: ScrollText },
  { key: 'full', icon: Rocket }
]

const PANE_TOGGLES: { tab: PaneTab; icon: typeof Sigma; label: MessageKey }[] = [
  { tab: 'files', icon: FolderOpen, label: 'pane.files' },
  { tab: 'artifacts', icon: Layers, label: 'pane.artifacts' },
  { tab: 'literature', icon: BookOpen, label: 'pane.literature' },
  { tab: 'tasks', icon: ListChecks, label: 'pane.tasks' }
]

function TitleMenu() {
  const t = useT()
  const session = useStudio((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const update = useStudio((s) => s.updateSession)
  const remove = useStudio((s) => s.deleteSession)
  const confirm = useStudio((s) => s.confirm)
  const rename = useStudio((s) => s.renameSession)
  const startReview = useStudio((s) => s.startReview)
  if (!session) {
    return <span className="truncate px-1.5 text-[0.929rem] font-medium text-fg-2">{project?.name ?? ''}</span>
  }
  return (
    <Menu
      width={220}
      trigger={
        <button className="flex h-7 min-w-0 items-center gap-1 rounded-[6px] px-1.5 text-[0.929rem] font-medium hover:bg-surface-2">
          <span className="truncate">{session.title || t('session.untitled')}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-3" />
        </button>
      }
    >
      <MenuItem icon={<Pencil size={14} />} onSelect={() => rename(session.id)}>
        {t('session.rename')}
      </MenuItem>
      <MenuItem icon={session.pinned ? <PinOff size={14} /> : <Pin size={14} />} onSelect={() => void update(session.id, { pinned: !session.pinned })}>
        {t(session.pinned ? 'session.unpin' : 'session.pin')}
      </MenuItem>
      <MenuItem icon={<Archive size={14} />} onSelect={() => void update(session.id, { archived: !session.archived })}>
        {t(session.archived ? 'session.unarchive' : 'session.archive')}
      </MenuItem>
      <MenuItem icon={<ShieldCheck size={14} />} disabled={session.status === 'running' || session.status === 'waiting'} onSelect={() => void startReview(session.id)}>
        {t('review.start')}
      </MenuItem>
      {project && (
        <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void api.call('shell:openPath', project.path)}>
          {t('project.reveal')}
        </MenuItem>
      )}
      <MenuSep />
      <MenuItem
        danger
        icon={<Trash2 size={14} />}
        onSelect={async () => {
          if (await confirm({ title: t('session.delete'), body: t('session.deleteConfirm'), danger: true })) void remove(session.id)
        }}
      >
        {t('session.delete')}
      </MenuItem>
    </Menu>
  )
}

function Header() {
  const t = useT()
  const sidebarOpen = useStudio((s) => s.sidebarOpen)
  const paneOpen = useStudio((s) => s.paneOpen)
  const paneTab = useStudio((s) => s.paneTab)
  const togglePane = useStudio((s) => s.togglePane)
  const newSession = useStudio((s) => s.newSession)
  const hasProject = useStudio((s) => Boolean(s.activeProjectId))

  return (
    <header className="drag flex h-[var(--titlebar-h)] shrink-0 items-center gap-1 pr-2" style={{ paddingLeft: !sidebarOpen ? (isMac ? 80 : 8) : 12 }}>
      {!sidebarOpen && (
        <div className="mr-1 flex h-7 items-center rounded-[8px] bg-surface shadow-[var(--shadow-card)]">
          <Tip label={`${t('nav.expand')}  ${mod}B`}>
            <button className="icon-btn" onClick={() => useStudio.setState({ sidebarOpen: true })} aria-label={t('nav.expand')}>
              <PanelLeftOpen size={16} />
            </button>
          </Tip>
          <Tip label={`${t('nav.newSession')}  ${mod}N`}>
            <button className="icon-btn" onClick={newSession} aria-label={t('nav.newSession')}>
              <Plus size={16} />
            </button>
          </Tip>
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center">
        <TitleMenu />
      </div>
      {hasProject &&
        PANE_TOGGLES.map(({ tab, icon: Icon, label }) => (
          <Tip key={tab} label={t(label)}>
            <button className="icon-btn" data-active={paneOpen && paneTab === tab} onClick={() => togglePane(tab)} aria-label={t(label)}>
              <Icon size={16} />
            </button>
          </Tip>
        ))}
    </header>
  )
}

function KitBanner() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const updateProject = useStudio((s) => s.updateProject)
  if (!project || project.kitInstalled) return null
  return (
    <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[0.929rem]">
      <Wrench size={14} className="shrink-0 text-fg-3" />
      <span className="flex-1 text-fg-2">{t('project.kitMissing')}</span>
      <button className="btn btn-secondary btn-sm" onClick={async () => updateProject(await api.call('projects:installKit', project.id))}>
        {t('project.installNow')}
      </button>
    </div>
  )
}

function ProjectPill() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const projects = useStudio((s) => s.projects)
  const select = useStudio((s) => s.selectProject)
  const setDialog = useStudio((s) => s.setDialog)
  return (
    <Menu
      side="bottom"
      width={260}
      trigger={
        <button className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[0.857rem] text-fg-2 hover:bg-surface-3 hover:text-fg">
          <FolderOpen size={13} className="shrink-0" />
          <span className="truncate">{project?.name}</span>
          <ChevronDown size={12} className="shrink-0 text-fg-3" />
        </button>
      }
    >
      {projects.map((p) => (
        <MenuItem key={p.id} onSelect={() => select(p.id)}>
          <div className="truncate">{p.name}</div>
          <div className="truncate text-[0.786rem] text-fg-3">{tildify(p.path)}</div>
        </MenuItem>
      ))}
      <MenuSep />
      <MenuItem icon={<FolderPlus size={14} />} onSelect={() => setDialog('new-project')}>
        {t('nav.newProject')}
      </MenuItem>
    </Menu>
  )
}

function Home({ composer }: { composer: React.RefObject<ComposerHandle | null> }) {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const setDialog = useStudio((s) => s.setDialog)

  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center rise-in">
        <Logo size={52} />
        <h1 className="mt-6 text-[1.571rem] leading-tight font-semibold tracking-tight">{t('home.noProject')}</h1>
        <p className="mt-3 max-w-[480px] text-[1rem] leading-relaxed text-fg-2">{t('home.noProjectDesc')}</p>
        <button className="btn btn-primary mt-7 h-9 px-4" onClick={() => setDialog('new-project')}>
          <FolderPlus size={15} />
          {t('home.createProject')}
        </button>
      </div>
    )
  }

  return (
    <div className="scroll flex flex-1 flex-col items-center px-8">
      <div className="my-auto w-full max-w-[var(--column)] py-10 rise-in">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Logo size={30} />
          <h1 className="text-[1.571rem] leading-tight font-semibold tracking-tight">{t('home.greeting')}</h1>
        </div>
        <KitBanner />
        <Composer ref={composer} home />
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <ProjectPill />
          <ModelPicker pill />
          <ModePicker pill />
        </div>
        <div className="mt-8">
          <div className="mb-1.5 px-1 text-[0.857rem] text-fg-3">{t('home.suggested')}</div>
          <div className="flex flex-col">
            {STARTERS.map(({ key, icon: Icon }) => (
              <button
                key={key}
                className="group flex items-center gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-surface-2"
                onClick={() => composer.current?.setText(t(`starter.${key}.prompt` as MessageKey))}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-surface-2 text-fg-2 group-hover:bg-surface text-[0]">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.929rem] text-fg">{t(`starter.${key}` as MessageKey)}</span>
                  <span className="block truncate text-[0.857rem] text-fg-3">{t(`starter.${key}.prompt` as MessageKey)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MainView() {
  const sessionId = useStudio((s) => s.activeSessionId)
  const projectId = useStudio((s) => s.activeProjectId)
  const composer = useRef<ComposerHandle>(null)

  useEffect(() => {
    composer.current?.focus()
  }, [sessionId, projectId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useStudio.getState().dialog) useStudio.getState().interrupt()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <Header />
      {sessionId ? (
        <>
          <Transcript sessionId={sessionId} />
          <div className="shrink-0 px-8 pb-3">
            <div className="mx-auto w-full max-w-[var(--column)]">
              <Composer ref={composer} />
            </div>
          </div>
        </>
      ) : (
        <Home composer={composer} />
      )}
    </main>
  )
}
