import { useMemo, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2
} from 'lucide-react'
import type { Session } from '@shared/types'
import { api, isMac, mod } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { AgentGlyph } from './BrandIcon'
import { Menu, MenuItem, MenuLabel, MenuSep, Spinner, Tip } from './ui'

function groupKey(ts: number): MessageKey {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = 86_400_000
  if (ts >= today.getTime()) return 'nav.today'
  if (ts >= today.getTime() - day) return 'nav.yesterday'
  if (ts >= today.getTime() - 7 * day) return 'nav.week'
  return 'nav.older'
}

function relativeTime(ts: number, lang: 'zh' | 'en'): string {
  const m = Math.floor((Date.now() - ts) / 60_000)
  if (m < 1) return lang === 'zh' ? '刚刚' : 'now'
  if (m < 60) return lang === 'zh' ? `${m} 分钟` : `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return lang === 'zh' ? `${h} 小时` : `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return lang === 'zh' ? `${d} 天` : `${d}d`
  return new Date(ts).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}

function StatusSlot({ session }: { session: Session }) {
  if (session.status === 'running') return <Spinner size={12} />
  if (session.status === 'waiting') return <span className="h-[7px] w-[7px] rounded-full bg-warning" style={{ animation: 'halo 2.5s infinite' }} />
  if (session.status === 'error') return <span className="h-[7px] w-[7px] rounded-full bg-danger" />
  return <AgentGlyph agent={session.agent} size={13} muted />
}

function SessionRow({ session }: { session: Session }) {
  const t = useT()
  const lang = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
  const active = useStudio((s) => s.activeSessionId === session.id)
  const select = useStudio((s) => s.selectSession)
  const update = useStudio((s) => s.updateSession)
  const remove = useStudio((s) => s.deleteSession)
  const confirm = useStudio((s) => s.confirm)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.title)

  const commit = (): void => {
    setEditing(false)
    if (title.trim() && title !== session.title) void update(session.id, { title: title.trim() })
  }

  return (
    <div
      className={`group relative flex min-h-[28px] items-center gap-1 rounded-[6px] pr-1 pl-0.5 transition-colors duration-100 ${
        active ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
      }`}
      onClick={() => !editing && void select(session.id)}
      onDoubleClick={() => {
        setTitle(session.title)
        setEditing(true)
      }}
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center">
        <StatusSlot session={session} />
      </span>
      {editing ? (
        <input
          autoFocus
          className="h-6 min-w-0 flex-1 rounded-[5px] bg-surface px-1.5 text-[0.929rem] shadow-[inset_0_0_0_1px_var(--accent)] outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setTitle(session.title)
              setEditing(false)
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 py-1">
          <span className="block truncate text-[0.929rem] leading-[1.35]">{session.title || t('session.untitled')}</span>
          {session.status === 'waiting' && <span className="block truncate text-[0.786rem] text-warning-text">{t('session.status.waiting')}</span>}
        </span>
      )}
      {!editing && (
        <span className={`shrink-0 pr-1 text-[0.786rem] text-fg-4 tabular-nums group-hover:hidden ${active ? 'hidden' : ''}`}>
          {relativeTime(session.updatedAt, lang)}
        </span>
      )}
      <Menu
        align="end"
        trigger={
          <button
            className={`icon-btn-sm shrink-0 ${active ? '' : 'hidden'} group-hover:inline-grid data-[state=open]:inline-grid`}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('sidebar.sessionMenu')}
          >
            <MoreHorizontal size={15} />
          </button>
        }
      >
        <MenuItem
          icon={<Pencil size={14} />}
          onSelect={() => {
            setTitle(session.title)
            setEditing(true)
          }}
        >
          {t('session.rename')}
        </MenuItem>
        <MenuItem icon={session.pinned ? <PinOff size={14} /> : <Pin size={14} />} onSelect={() => void update(session.id, { pinned: !session.pinned })}>
          {t(session.pinned ? 'session.unpin' : 'session.pin')}
        </MenuItem>
        <MenuItem icon={<Archive size={14} />} onSelect={() => void update(session.id, { archived: !session.archived })}>
          {t(session.archived ? 'session.unarchive' : 'session.archive')}
        </MenuItem>
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
    </div>
  )
}

function ProjectSwitcher() {
  const t = useT()
  const projects = useStudio((s) => s.projects)
  const activeId = useStudio((s) => s.activeProjectId)
  const select = useStudio((s) => s.selectProject)
  const setDialog = useStudio((s) => s.setDialog)
  const removeProject = useStudio((s) => s.removeProject)
  const confirm = useStudio((s) => s.confirm)
  const active = projects.find((p) => p.id === activeId)

  return (
    <Menu
      width={264}
      trigger={
        <button className="flex h-7 w-full items-center gap-1 rounded-[6px] pr-1.5 pl-0.5 text-left transition-colors hover:bg-surface-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center text-fg-3">
            <FolderOpen size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.929rem]">{active?.name ?? t('nav.projects')}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-3" />
        </button>
      }
    >
      <MenuLabel>{t('nav.projects')}</MenuLabel>
      {projects.map((p) => (
        <MenuItem key={p.id} onSelect={() => select(p.id)} right={p.id === activeId ? <Check size={14} className="text-accent" /> : null}>
          <div className="truncate">{p.name}</div>
          <div className="truncate text-[0.786rem] text-fg-3">{p.path.replace(/^\/Users\/[^/]+/, '~')}</div>
        </MenuItem>
      ))}
      <MenuSep />
      <MenuItem icon={<FolderPlus size={14} />} onSelect={() => setDialog('new-project')} right={<span className="kbd">{mod}⇧N</span>}>
        {t('nav.newProject')}
      </MenuItem>
      {active && (
        <>
          <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void api.call('shell:openPath', active.path)}>
            {t('project.reveal')}
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 size={14} />}
            onSelect={async () => {
              if (await confirm({ title: t('project.remove'), body: t('project.removeConfirm'), danger: true })) void removeProject(active.id)
            }}
          >
            {t('project.remove')}
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

export function Sidebar() {
  const t = useT()
  const sessions = useStudio((s) => s.sessions)
  const activeProjectId = useStudio((s) => s.activeProjectId)
  const newSession = useStudio((s) => s.newSession)
  const setDialog = useStudio((s) => s.setDialog)
  const agents = useStudio((s) => s.agents)
  const toggle = (): void => useStudio.setState((s) => ({ sidebarOpen: !s.sidebarOpen }))
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = sessions
      .filter((s) => s.projectId === activeProjectId)
      .filter((s) => (q ? (s.title || '').toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const out: { key: MessageKey; items: Session[] }[] = []
    const push = (key: MessageKey, s: Session): void => {
      let g = out.find((x) => x.key === key)
      if (!g) out.push((g = { key, items: [] }))
      g.items.push(s)
    }
    for (const s of list.filter((s) => s.pinned && !s.archived)) push('nav.pinned', s)
    for (const s of list.filter((s) => !s.pinned && !s.archived)) push(groupKey(s.updatedAt), s)
    return { out, archived: list.filter((s) => s.archived) }
  }, [sessions, activeProjectId, query])

  const available = agents.filter((a) => a.available)

  return (
    <aside className="flex h-full w-[var(--sidebar-w)] shrink-0 flex-col py-2 pl-2">
      <div className="flex min-h-0 flex-1 flex-col rounded-[10px] bg-sidebar shadow-[var(--shadow-card)]">
        <div className="drag flex h-10 shrink-0 items-center justify-end gap-1 pr-1.5" style={{ paddingLeft: isMac ? 80 : 12 }}>
          <Tip label={`${t('nav.collapse')}  ${mod}B`}>
            <button className="icon-btn" onClick={toggle} aria-label={t('nav.collapse')}>
              <PanelLeftClose size={16} />
            </button>
          </Tip>
        </div>

        <div className="flex flex-col gap-px px-2 pb-1">
          <button
            className="group flex h-7 items-center gap-1 rounded-[6px] pr-1.5 pl-0.5 text-[0.929rem] text-fg transition-colors hover:bg-surface-2"
            onClick={() => (activeProjectId ? newSession() : setDialog('new-project'))}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center">
              <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-ink text-ink-fg">
                <Plus size={12} strokeWidth={2.6} />
              </span>
            </span>
            <span className="flex-1 text-left">{t('nav.newSession')}</span>
            <span className="kbd opacity-0 transition-opacity group-hover:opacity-100">{mod}N</span>
          </button>
          <ProjectSwitcher />
          <label className="flex h-7 items-center gap-1 rounded-[6px] pr-1.5 pl-0.5 text-fg-3 transition-colors focus-within:bg-surface-2 hover:bg-surface-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center">
              <Search size={14} />
            </span>
            <input
              className="min-w-0 flex-1 bg-transparent text-[0.929rem] text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none"
              placeholder={t('nav.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <div className="scroll min-h-0 flex-1 px-2 pb-3">
          {groups.out.length === 0 && <div className="px-2 py-6 text-[0.857rem] text-fg-3">{activeProjectId ? t('nav.noSessions') : ''}</div>}
          {groups.out.map((g) => (
            <div key={g.key} className="flex flex-col gap-px pt-3">
              <div className="px-2 pb-1 text-[0.857rem] text-fg-3">{t(g.key)}</div>
              {g.items.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          ))}
          {groups.archived.length > 0 && (
            <div className="flex flex-col gap-px pt-3">
              <button className="flex items-center gap-1 px-2 pb-1 text-[0.857rem] text-fg-3 hover:text-fg-2" onClick={() => setShowArchived((v) => !v)}>
                {t('nav.archived')} · {groups.archived.length}
                <ChevronDown size={12} className={`transition-transform ${showArchived ? '' : '-rotate-90'}`} />
              </button>
              {showArchived && groups.archived.map((s) => <SessionRow key={s.id} session={s} />)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
          <button className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-1.5 text-left transition-colors hover:bg-surface-2" onClick={() => setDialog('settings', 'agents')}>
            <span className="flex -space-x-1">
              {(available.length ? available : agents.slice(0, 1)).map((a) => (
                <span key={a.id} className="rounded-[5px] ring-2 ring-[var(--bg-sidebar)]">
                  <AgentGlyph agent={a.id} size={16} />
                </span>
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.857rem] text-fg-2">
              {available.length ? available.map((a) => a.name).join(' · ') : t('settings.notFound')}
            </span>
          </button>
          <Tip label={`${t('nav.settings')}  ${mod},`} side="top">
            <button className="icon-btn" onClick={() => setDialog('settings')} aria-label={t('nav.settings')}>
              <Settings size={16} />
            </button>
          </Tip>
        </div>
      </div>
    </aside>
  )
}
