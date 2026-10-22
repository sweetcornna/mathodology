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
import { api, fileUrl } from '../lib/api'
import { highlight } from '../lib/highlight'
import { useT } from '../lib/i18n'
import { buildTranscript, formatTokens } from '../lib/transcript'
import { useStudio, type PaneTab } from '../store'
import { Markdown } from './Markdown'
import { Spinner, Tip } from './ui'

const EMPTY: SessionEvent[] = []

/** File extensions the code preview highlights, mapped to highlighter language names. */
const CODE_LANGS: Record<string, string> = {
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  json: 'json',
  tex: 'latex',
  bib: 'latex',
  m: 'matlab',
  r: 'r',
  jl: 'julia',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql'
}

function CodeView({ rel, text }: { rel: string; text: string }) {
  const lang = CODE_LANGS[rel.split('.').pop()?.toLowerCase() ?? '']
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setHtml(null)
    if (lang) void highlight(text, lang).then((h) => alive && setHtml(h))
    return () => {
      alive = false
    }
  }, [text, lang])
  return html ? (
    <div className="scroll selectable code-block-body min-h-0 flex-1 px-4 py-3" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre className="scroll selectable m-0 min-h-0 flex-1 px-4 py-3 font-mono text-[0.786rem] leading-[1.6] whitespace-pre text-fg-2">{text}</pre>
  )
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'pdf'].includes(ext)) return FileImage
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return FileSpreadsheet
  if (['py', 'm', 'r', 'jl', 'ts', 'js', 'ipynb', 'sh', 'tex', 'json', 'toml'].includes(ext)) return FileCode
  if (['md', 'txt'].includes(ext)) return FileText
  return File
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
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
          <bdi dir="ltr">{project.path.replace(/^\/Users\/[^/]+/, '~')}</bdi>
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

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => {
    const sep = text.includes('\t') && !text.split('\n')[0].includes(',') ? '\t' : ','
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 300)
      .map((l) => l.split(sep))
  }, [text])
  return (
    <div className="scroll min-h-0 flex-1">
      <table className="w-full border-collapse font-mono text-[0.76rem] tabular-nums">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i === 0 ? 'sticky top-0 bg-surface-2 font-semibold' : 'border-t border-line'}>
              {r.map((c, j) => (
                <td key={j} className="px-2.5 py-1 whitespace-nowrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FiguresTab() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const version = useStudio((s) => s.filesVersion)
  const openPreview = useStudio((s) => s.openPreview)
  const [figures, setFigures] = useState<FileEntry[] | null>(null)

  useEffect(() => {
    if (project) void api.call('files:figures', project.id).then(setFigures)
  }, [project, version])

  if (!project) return null
  if (figures === null)
    return (
      <div className="grid flex-1 place-items-center text-fg-3">
        <Spinner />
      </div>
    )
  if (!figures.length) return <div className="grid flex-1 place-items-center px-8 text-center text-[0.929rem] text-fg-3">{t('pane.noFigures')}</div>
  return (
    <div className="scroll grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2.5 p-3">
      {figures.map((f) => (
        <button key={f.path} className="group flex flex-col gap-1.5 text-left" onClick={() => openPreview(f.rel)} title={f.rel}>
          <div className="grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[8px] bg-white shadow-[0_0_0_1px_var(--border)] transition-shadow group-hover:shadow-[0_0_0_1px_var(--border-strong),var(--shadow-md)]">
            {f.name.toLowerCase().endsWith('.pdf') ? (
              <span className="flex flex-col items-center gap-1 text-[0.786rem] text-fg-3">
                <FileText size={22} />
                PDF
              </span>
            ) : (
              <img src={fileUrl(project.id, f.rel, Math.round(f.mtime))} loading="lazy" className="h-full w-full object-contain" alt={f.name} />
            )}
          </div>
          <span className="truncate px-0.5 text-[0.786rem] text-fg-2">{f.rel}</span>
        </button>
      ))}
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
      ) : preview.kind === 'image' ? (
        <div className="scroll grid min-h-0 flex-1 place-items-center bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
          <img src={preview.content} className="max-w-full rounded-[6px] shadow-[var(--shadow-md)]" alt={rel} />
        </div>
      ) : preview.kind === 'pdf' ? (
        <iframe title={rel} src={fileUrl(project.id, rel, version)} className="min-h-0 w-full flex-1 border-0 bg-white" />
      ) : preview.kind === 'markdown' ? (
        <div className="scroll min-h-0 flex-1 px-5 py-4">
          <Markdown className="serif" text={preview.content ?? ''} />
        </div>
      ) : preview.kind === 'csv' ? (
        <CsvTable text={preview.content ?? ''} />
      ) : preview.kind === 'text' ? (
        <CodeView rel={rel} text={preview.content ?? ''} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[0.88rem] text-fg-3">
          {preview.kind === 'too-large' ? t('pane.tooLarge') : t('pane.binary')}
          <button className="btn btn-secondary btn-sm" onClick={() => void api.call('shell:openPath', preview.path)}>
            <ExternalLink size={13} /> {t('pane.openExternal')}
          </button>
        </div>
      )}
    </div>
  )
}

export function SidePane() {
  const t = useT()
  const tab = useStudio((s) => s.paneTab)
  const tabs: { id: PaneTab; label: string }[] = [
    { id: 'files', label: t('pane.files') },
    { id: 'figures', label: t('pane.figures') },
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
      {tab === 'figures' && <FiguresTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'preview' && <PreviewTab />}
    </aside>
  )
}
