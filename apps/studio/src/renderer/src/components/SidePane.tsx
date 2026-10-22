import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  ExternalLink,
  File,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  X
} from 'lucide-react'
import type { FileEntry, FilePreview, SessionEvent } from '@shared/types'
import { api, fileUrl, tildify } from '../lib/api'
import { useT } from '../lib/i18n'
import { buildTranscript, formatTokens } from '../lib/transcript'
import { useStudio, type PaneTab } from '../store'
import { ArtifactsTab } from './Artifacts'
import { LiteratureTab } from './Literature'
import { formatSize, PreviewBody } from './Preview'
import { Spinner, Tip } from './ui'

const EMPTY: SessionEvent[] = []

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'pdf'].includes(ext)) return FileImage
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return FileSpreadsheet
  if (['py', 'm', 'r', 'jl', 'ts', 'js', 'ipynb', 'sh', 'tex', 'json', 'toml'].includes(ext)) return FileCode
  if (['md', 'txt'].includes(ext)) return FileText
  return File
}

/** Expanded folders, kept across pane tab switches for the life of the window. */
const expanded = new Set<string>()

function TreeNode({ projectId, entry, depth }: { projectId: string; entry: FileEntry; depth: number }) {
  const key = `${projectId}:${entry.rel}`
  const [open, setOpenState] = useState(() => expanded.has(key))
  const setOpen = (next: (o: boolean) => boolean): void =>
    setOpenState((o) => {
      const v = next(o)
      if (v) expanded.add(key)
      else expanded.delete(key)
      return v
    })
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const version = useStudio((s) => s.filesVersion)
  const openPreview = useStudio((s) => s.openPreview)
  const selected = useStudio((s) => s.previewRel === entry.rel)

  useEffect(() => {
    if (entry.dir && open) void api.call('files:list', projectId, entry.rel).then(setChildren)
  }, [open, entry, projectId, version])

  const Icon = entry.dir ? (open ? FolderOpen : Folder) : fileIcon(entry.name)
  return (
    <>
      <button
        className={`group flex h-[28px] w-full items-center gap-1.5 rounded-[6px] pr-2 text-left text-[0.88rem] transition-colors ${
          selected ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => (entry.dir ? setOpen((o) => !o) : openPreview(entry.rel))}
        onDoubleClick={() => !entry.dir && void api.call('shell:openPath', entry.path)}
        title={entry.rel}
      >
        <ChevronRight size={12} className={`shrink-0 text-fg-3 transition-transform ${entry.dir ? '' : 'invisible'} ${open ? 'rotate-90' : ''}`} />
        <Icon size={14} className={`shrink-0 ${entry.dir ? 'text-accent' : 'text-fg-3'}`} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {!entry.dir && <span className="shrink-0 text-[0.74rem] text-fg-3 opacity-0 group-hover:opacity-100">{formatSize(entry.size)}</span>}
      </button>
      {open && children?.map((c) => <TreeNode key={c.path} projectId={projectId} entry={c} depth={depth + 1} />)}
    </>
  )
}

function FilesTab() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const version = useStudio((s) => s.filesVersion)
  const [entries, setEntries] = useState<FileEntry[] | null>(null)

  useEffect(() => {
    if (project) void api.call('files:list', project.id).then(setEntries)
  }, [project, version])

  if (!project) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 py-2">
        {/* Right-to-left truncation keeps the project folder name visible. */}
        <span dir="rtl" className="min-w-0 flex-1 truncate text-left text-[0.8rem] text-fg-3" title={project.path}>
          <bdi dir="ltr">{tildify(project.path)}</bdi>
        </span>
        <Tip label={t('pane.refresh')}>
          <button className="icon-btn-sm" onClick={() => useStudio.setState((s) => ({ filesVersion: s.filesVersion + 1 }))}>
            <RefreshCw size={13} />
          </button>
        </Tip>
        <Tip label={t('pane.reveal')}>
          <button className="icon-btn-sm" onClick={() => void api.call('shell:openPath', project.path)}>
            <ExternalLink size={13} />
          </button>
        </Tip>
      </div>
      <div className="scroll min-h-0 flex-1 px-2 pb-3">
        {entries === null ? (
          <div className="grid place-items-center py-10 text-fg-3">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-8 text-center text-[0.88rem] text-fg-3">{t('pane.empty')}</div>
        ) : (
          entries.map((e) => <TreeNode key={e.path} projectId={project.id} entry={e} depth={0} />)
        )}
      </div>
    </div>
  )
}

function TasksTab() {
  const t = useT()
  const sessionId = useStudio((s) => s.activeSessionId)
  const events = useStudio((s) => (sessionId ? s.events[sessionId] ?? EMPTY : EMPTY))
  const session = useStudio((s) => s.sessions.find((x) => x.id === sessionId))
  const { todos } = useMemo(() => buildTranscript(events), [events])
  const done = todos.filter((x) => x.status === 'completed').length

  return (
    <div className="scroll min-h-0 flex-1 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.86rem] font-medium">{t('plan.title')}</span>
        {todos.length > 0 && (
          <span className="text-[0.8rem] text-fg-3 tabular-nums">
            {done}/{todos.length}
          </span>
        )}
      </div>
      {todos.length > 0 && (
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(done / todos.length) * 100}%` }} />
        </div>
      )}
      {todos.length === 0 ? (
        <div className="py-6 text-[0.88rem] text-fg-3">{t('plan.empty')}</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {todos.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 py-1 text-[0.9rem]">
              {item.status === 'completed' ? (
                <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" />
              ) : item.status === 'in_progress' ? (
                <CircleDot size={16} className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0 text-fg-3" />
              )}
              <span className={item.status === 'completed' ? 'text-fg-3 line-through decoration-fg-3/40' : item.status === 'in_progress' ? 'font-medium' : 'text-fg-2'}>
                {item.content}
              </span>
            </li>
          ))}
        </ul>
      )}
      {session && (session.usage.inputTokens > 0 || session.usage.costUsd > 0) && (
        <div className="mt-6 border-t border-line pt-4">
          <div className="mb-2 text-[0.86rem] font-medium">{t('pane.usage')}</div>
          <dl className="grid grid-cols-2 gap-y-1.5 text-[0.84rem] tabular-nums">
            <dt className="text-fg-3">Input</dt>
            <dd className="text-right">{formatTokens(session.usage.inputTokens)}</dd>
            <dt className="text-fg-3">Output</dt>
            <dd className="text-right">{formatTokens(session.usage.outputTokens)}</dd>
            <dt className="text-fg-3">Cache read</dt>
            <dd className="text-right">{formatTokens(session.usage.cacheReadTokens)}</dd>
            {session.usage.costUsd > 0 && (
              <>
                <dt className="text-fg-3">Cost</dt>
                <dd className="text-right">${session.usage.costUsd.toFixed(3)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  )
}

function PreviewTab() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const rel = useStudio((s) => s.previewRel)
  const version = useStudio((s) => s.filesVersion)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!project || !rel) return setPreview(null)
    api
      .call('files:preview', project.id, rel)
      .then(setPreview)
      .catch(() => setError(rel))
  }, [project, rel, version])

  if (!rel || !project) return <div className="grid flex-1 place-items-center text-[0.88rem] text-fg-3">{t('pane.noPreview')}</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.8rem] text-fg-2" title={rel}>
          {rel}
        </span>
        {preview && (
          <Tip label={t('pane.openExternal')}>
            <button className="icon-btn-sm" onClick={() => void api.call('shell:openPath', preview.path)}>
              <ExternalLink size={13} />
            </button>
          </Tip>
        )}
        <button className="icon-btn-sm" onClick={() => useStudio.setState({ previewRel: null, paneTab: 'files' })}>
          <X size={13} />
        </button>
      </div>
      {error ? (
        <div className="p-6 text-[0.88rem] text-fg-3">{error}</div>
      ) : !preview ? (
        <div className="grid flex-1 place-items-center text-fg-3">
          <Spinner />
        </div>
      ) : (
        <PreviewBody preview={preview} rel={rel} pdfSrc={fileUrl(project.id, rel, version)} />
      )}
    </div>
  )
}

export function SidePane() {
  const t = useT()
  const tab = useStudio((s) => s.paneTab)
  const tabs: { id: PaneTab; label: string }[] = [
    { id: 'files', label: t('pane.files') },
    { id: 'artifacts', label: t('pane.artifacts') },
    { id: 'literature', label: t('pane.literature') },
    { id: 'tasks', label: t('pane.tasks') },
    { id: 'preview', label: t('pane.preview') }
  ]
  return (
    <aside className="flex h-full w-[var(--pane-w)] shrink-0 flex-col border-l border-line bg-surface">
      <div className="drag flex h-[var(--titlebar-h)] shrink-0 items-center gap-0.5 border-b border-line px-2">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => useStudio.setState({ paneTab: x.id })}
            className={`h-7 rounded-[6px] px-2 text-[0.929rem] transition-colors ${
              tab === x.id ? 'bg-surface-3 text-fg' : 'text-fg-3 hover:bg-surface-2 hover:text-fg'
            }`}
          >
            {x.label}
          </button>
        ))}
        <span className="flex-1" />
        <Tip label={t('pane.close')}>
          <button className="icon-btn" onClick={() => useStudio.setState({ paneOpen: false })} aria-label={t('pane.close')}>
            <X size={15} />
          </button>
        </Tip>
      </div>
      {tab === 'files' && <FilesTab />}
      {tab === 'artifacts' && <ArtifactsTab />}
      {tab === 'literature' && <LiteratureTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'preview' && <PreviewTab />}
    </aside>
  )
}
