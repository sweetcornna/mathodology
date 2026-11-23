import { memo, useMemo, useState, type ReactNode } from 'react'
import {
  Bot,
  ChevronRight,
  CircleAlert,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  ListTodo,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import { createTwoFilesPatch } from 'diff'
import type { ToolKind } from '@shared/types'
import { projectRel } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { fileStats, type FileStat, type ToolNode } from '../../lib/transcript'
import { summarize } from '../../lib/verbs'
import { useStudio } from '../../store'
import { CopyButton } from '../CopyButton'
import { Markdown } from '../Markdown'
import { DiffStat, DiffView } from '../Preview'
import { Spinner } from '../ui'

const KIND_ICON: Record<ToolKind, typeof Wrench> = {
  shell: SquareTerminal,
  read: FileText,
  edit: FilePen,
  write: FilePlus,
  search: Search,
  web: Globe,
  task: Bot,
  todo: ListTodo,
  mcp: Plug,
  skill: Sparkles,
  other: Wrench
}

function summarizeNodeStats(node: ToolNode): { added: number; removed: number } | null {
  const stats = fileStats(node)
  if (!stats.length) return null
  const added = stats.reduce((n, f) => n + f.added, 0)
  const removed = stats.reduce((n, f) => n + f.removed, 0)
  return added || removed ? { added, removed } : null
}

function inputDetail(node: ToolNode): { lang: string; text: string } | null {
  const i = (node.input ?? {}) as Record<string, unknown>
  if (node.toolKind === 'shell' && typeof i.command === 'string') return { lang: 'bash', text: i.command }
  if ((node.name === 'Edit' || node.name === 'MultiEdit') && typeof i.file_path === 'string') {
    const edits = node.name === 'MultiEdit' && Array.isArray(i.edits) ? (i.edits as Record<string, string>[]) : [i as Record<string, string>]
    const name = String(i.file_path).split(/[\\/]/).pop() ?? ''
    const patch = edits
      .map((e) => createTwoFilesPatch(name, name, String(e.old_string ?? ''), String(e.new_string ?? ''), '', '', { context: 2 }))
      .map((p) => p.split('\n').slice(4).join('\n'))
      .join('\n')
    return { lang: 'diff', text: patch.trim() }
  }
  if (node.changes?.some((c) => c.diff)) return { lang: 'diff', text: node.changes.map((c) => c.diff ?? '').join('\n') }
  if (node.name === 'Write' && typeof i.content === 'string') return { lang: '', text: i.content }
  if (node.changes?.length) return { lang: '', text: node.changes.map((c) => `${c.kind}  ${c.path}`).join('\n') }
  if (node.input && Object.keys(i).length) return { lang: 'json', text: JSON.stringify(node.input, null, 2) }
  return null
}

function Section({ label, text, tone, extra }: { label: string; text: string; tone?: 'error'; extra?: ReactNode }) {
  const t = useT()
  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex h-7 items-center justify-between px-2.5 text-[0.786rem] text-fg-3">
        {label}
        <span className="flex items-center gap-1">
          {extra}
          {text && <CopyButton text={text} label={t('transcript.copy')} />}
        </span>
      </div>
      <pre
        className={`selectable m-0 max-h-72 overflow-auto px-2.5 pb-2.5 font-mono text-[0.786rem] leading-[1.5] whitespace-pre-wrap ${
          tone === 'error' ? 'text-danger-text' : 'text-fg-2'
        }`}
      >
        {text.trim() || '—'}
      </pre>
    </div>
  )
}

const ToolRow = memo(function ToolRow({ node }: { node: ToolNode }) {
  const t = useT()
  const lang = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[node.toolKind]
  const running = !node.result && !node.stopped
  const stopped = !node.result && node.stopped
  const failed = node.result?.isError
  const detail = useMemo(() => (open ? inputDetail(node) : null), [open, node])
  const output = node.result?.output ?? ''
  const stats = node.toolKind === 'edit' || node.toolKind === 'write' ? summarizeNodeStats(node) : null
  const label = summarize([node], lang)[0]?.text ?? node.name

  return (
    <div className="border-t border-line first:border-t-0">
      <button className="group/row flex min-h-[32px] w-full items-center gap-2 px-2.5 text-left text-[0.929rem] hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        <span className={`grid h-4 w-4 shrink-0 place-items-center ${failed ? 'text-danger' : 'text-fg-3'}`}>
          {running ? <Spinner size={12} /> : failed ? <CircleAlert size={14} /> : <Icon size={14} />}
        </span>
        <span className={`min-w-0 flex-1 truncate ${failed ? 'text-danger-text' : 'text-fg-2'}`}>
          {node.toolKind === 'shell' ? (
            <span className="font-mono text-[0.857rem]">{String(((node.input ?? {}) as Record<string, unknown>).command ?? node.title)}</span>
          ) : (
            <>
              {label.replace(/^./, (c) => c.toUpperCase())}
              {node.toolKind !== 'read' && node.toolKind !== 'edit' && node.toolKind !== 'write' && node.title && (
                <span className="ml-1.5 text-fg-3">{node.title}</span>
              )}
            </>
          )}
        </span>
        {stopped && <span className="shrink-0 text-[0.786rem] text-fg-3">{t('tool.noResult')}</span>}
        {node.children.length > 0 && <span className="shrink-0 text-[0.786rem] text-fg-3">{t('tool.calls', { n: node.children.length })}</span>}
        {stats && <DiffStat added={stats.added} removed={stats.removed} />}
        <ChevronRight size={14} className={`shrink-0 text-fg-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mx-2.5 mb-2.5 overflow-hidden rounded-[8px] bg-[var(--code-bg)] shadow-[0_0_0_1px_var(--border)]">
          {node.children.length > 0 && (
            <div className="border-b border-line bg-surface">
              {node.children.map((c) => (
                <ToolRow key={c.callId} node={c} />
              ))}
            </div>
          )}
          {node.notes.length > 0 && (
            <div className="border-b border-line px-2.5 py-2">
              <Markdown text={node.notes[node.notes.length - 1]} />
            </div>
          )}
          {detail &&
            (detail.lang === 'diff' ? (
              <div>
                <div className="flex h-7 items-center px-2.5 text-[0.786rem] text-fg-3">{t('tool.input')}</div>
                <DiffView text={detail.text} />
              </div>
            ) : (
              <Section label={node.toolKind === 'shell' ? t('tool.command') : t('tool.input')} text={detail.text} />
            ))}
          <Section
            label={running ? t('tool.running') : stopped ? t('tool.noResult') : failed ? t('tool.failed') : t('tool.output')}
            text={stopped ? t('tool.noResultDetail') : running ? '' : output}
            tone={failed ? 'error' : undefined}
          />
        </div>
      )}
    </div>
  )
})

/** Consecutive tool calls read as one muted sentence; opening it lists every call. */
export const ToolGroup = memo(function ToolGroup({ tools }: { tools: ToolNode[] }) {
  const lang = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
  const [open, setOpen] = useState(false)
  const phrases = summarize(tools, lang)
  const stats = tools.map(summarizeNodeStats).filter(Boolean) as { added: number; removed: number }[]
  const added = stats.reduce((n, s) => n + s.added, 0)
  const removed = stats.reduce((n, s) => n + s.removed, 0)
  const needsAttention = tools.some((n) => n.result?.isError)

  return (
    <div>
      <button className="group flex max-w-full items-center gap-1.5 text-left text-[1rem] text-fg-3 hover:text-fg-2" onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0 truncate">
          {phrases.map((p, i) => (
            <span key={i} className={p.tone === 'failed' ? 'text-danger-text' : p.tone === 'running' ? 'text-fg-2' : ''}>
              {i > 0 && (lang === 'zh' ? '，' : ', ')}
              {p.text}
              {p.chip && (
                <>
                  {' '}
                  <span className="chip">{p.chip}</span>
                </>
              )}
            </span>
          ))}
        </span>
        {(added > 0 || removed > 0) && <DiffStat added={added} removed={removed} />}
        <ChevronRight size={14} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''} ${needsAttention ? 'text-danger' : ''}`} />
      </button>
      {open && <div className="mt-2 overflow-hidden rounded-[8px] bg-surface shadow-[0_0_0_1px_var(--border)] rise-in">{tools.map((n) => <ToolRow key={n.callId} node={n} />)}</div>}
    </div>
  )
})

export const ChangesCard = memo(function ChangesCard({ files }: { files: FileStat[] }) {
  const t = useT()
  const openPreview = useStudio((s) => s.openPreview)
  const projectPath = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path ?? '')
  const [all, setAll] = useState(false)
  const shown = all ? files : files.slice(0, 3)
  const rel = (p: string): string => projectRel(projectPath, p) ?? p
  const total = files.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 })
  return (
    <div className="card overflow-hidden">
      <div className="flex h-9 items-center px-3 text-[0.929rem] font-medium">{t('changes.title', { n: files.length })}</div>
      {shown.map((f) => (
        <button key={f.path} className="flex h-8 w-full items-center gap-2 border-t border-line px-3 text-left text-[0.929rem] hover:bg-surface-2" onClick={() => openPreview(rel(f.path))}>
          {f.created ? <FilePlus size={14} className="shrink-0 text-fg-3" /> : <FilePen size={14} className="shrink-0 text-fg-3" />}
          <span className="min-w-0 flex-1 truncate">{rel(f.path)}</span>
          <DiffStat added={f.added} removed={f.removed} />
        </button>
      ))}
      {files.length > 3 && (
        <button className="flex h-8 w-full items-center gap-2 border-t border-line px-3 text-left text-[0.929rem] text-fg-2 hover:bg-surface-2" onClick={() => setAll((v) => !v)}>
          <span className="flex-1">{all ? t('changes.less') : t('changes.more', { n: files.length - 3 })}</span>
          <DiffStat added={total.added} removed={total.removed} />
        </button>
      )}
    </div>
  )
})
