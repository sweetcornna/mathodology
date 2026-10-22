import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  Info,
  ListTodo,
  Paperclip,
  Plug,
  Search,
  ShieldCheck,
  ShieldX,
  Sparkles,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import { createTwoFilesPatch } from 'diff'
import type { SessionEvent, ToolKind } from '@shared/types'
import { projectRel } from '../lib/api'
import { buildTranscript, formatTokens, type FileStat, type Item, type ToolNode } from '../lib/transcript'
import { activityLabel, summarize } from '../lib/verbs'
import { useT } from '../lib/i18n'
import { useStudio } from '../store'
import { GeneratedRow } from './Artifacts'
import { Markdown } from './Markdown'
import { DiffStat, DiffView } from './Preview'
import { ReviewCard } from './ReviewCard'
import { GlyphSpinner, Spinner } from './ui'

const EMPTY: SessionEvent[] = []

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

export function useLang(): 'zh' | 'en' {
  return useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
}

function CopyButton({ text }: { text: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <button
      className="icon-btn-sm"
      aria-label={t('transcript.copy')}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function UserMessage({ text, attachments }: { text: string; attachments: string[] }) {
  const openPreview = useStudio((s) => s.openPreview)
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 900 || text.split('\n').length > 16
  return (
    <div className="group flex flex-col items-end gap-1.5 bubble-in">
      {attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {attachments.map((a) => (
            <button
              key={a}
              onClick={() => openPreview(a)}
              className="flex h-7 items-center gap-1.5 rounded-[8px] bg-surface-2 px-2.5 text-[0.857rem] text-fg-2 hover:bg-surface-3"
            >
              <Paperclip size={12} />
              {a.split(/[\\/]/).pop()}
            </button>
          ))}
        </div>
      )}
      <div
        className={`selectable relative max-w-[85%] rounded-[12px] bg-surface-2 px-4 py-2.5 text-[1rem] leading-[1.43] whitespace-pre-wrap ${
          long && !expanded ? 'max-h-[min(40vh,24rem)] overflow-hidden' : ''
        }`}
      >
        {text}
        {long && !expanded && (
          <button
            className="absolute inset-x-0 bottom-0 h-12 rounded-b-[12px] bg-gradient-to-t from-[var(--bg)] to-transparent"
            onClick={() => setExpanded(true)}
            aria-label={t('common.expand')}
          />
        )}
      </div>
      <div className="opacity-0 transition-opacity delay-100 group-hover:opacity-100">
        <CopyButton text={text} />
      </div>
    </div>
  )
}

function Thinking({ text, live }: { text: string; live?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="text-fg-3">
      <button className="flex items-center gap-1 text-[1rem] hover:text-fg-2" onClick={() => setOpen((o) => !o)}>
        <span className={live ? 'shimmer-text' : ''}>{t(live ? 'transcript.thinking' : 'transcript.thoughtFor')}</span>
        <ChevronRight size={14} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="selectable mt-1.5 border-l-2 border-line pl-3 text-[0.929rem] leading-relaxed whitespace-pre-wrap italic">{text}</div>
      )}
    </div>
  )
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

function Section({ label, text, tone, extra }: { label: string; text: string; tone?: 'error'; extra?: React.ReactNode }) {
  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex h-7 items-center justify-between px-2.5 text-[0.786rem] text-fg-3">
        {label}
        <span className="flex items-center gap-1">
          {extra}
          {text && <CopyButton text={text} />}
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

function ToolRow({ node }: { node: ToolNode }) {
  const t = useT()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[node.toolKind]
  const running = !node.result
  const failed = node.result?.isError
  const detail = open ? inputDetail(node) : null
  const output = node.result?.output ?? ''
  const stats = node.toolKind === 'edit' || node.toolKind === 'write' ? summarizeStats(node) : null
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
            label={running ? t('tool.running') : failed ? t('tool.failed') : t('tool.output')}
            text={running ? '' : output}
            tone={failed ? 'error' : undefined}
          />
        </div>
      )}
    </div>
  )
}

function summarizeStats(node: ToolNode): { added: number; removed: number } | null {
  const i = (node.input ?? {}) as Record<string, unknown>
  const count = (s: unknown): number => (s ? String(s).replace(/\n$/, '').split('\n').length : 0)
  if (node.changes?.length) {
    let added = 0
    let removed = 0
    for (const c of node.changes)
      for (const l of (c.diff ?? '').split('\n')) {
        if (l.startsWith('+') && !l.startsWith('+++')) added++
        else if (l.startsWith('-') && !l.startsWith('---')) removed++
      }
    return added || removed ? { added, removed } : null
  }
  if (node.name === 'Write') return { added: count(i.content), removed: 0 }
  if (node.name === 'Edit') return { added: count(i.new_string), removed: count(i.old_string) }
  return null
}

/** Consecutive tool calls read as one muted sentence; opening it lists every call. */
function ToolGroup({ tools }: { tools: ToolNode[] }) {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const phrases = summarize(tools, lang)
  const stats = tools.map(summarizeStats).filter(Boolean) as { added: number; removed: number }[]
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
}

function ChangesCard({ files }: { files: FileStat[] }) {
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
}

function ResolvedPermission({ item }: { item: Extract<Item, { type: 'permission' }> }) {
  const t = useT()
  if (!item.perm.resolved) return null
  const allow = item.perm.resolved.allow
  return (
    <div className="flex items-center gap-1.5 text-[0.929rem] text-fg-3">
      {allow ? <ShieldCheck size={14} className="text-success" /> : <ShieldX size={14} className="text-danger" />}
      <span className="truncate">
        {t(allow ? (item.perm.resolved.always ? 'perm.alwaysAllowed' : 'perm.allowed') : 'perm.denied')} · {item.perm.toolName}
        {item.perm.title ? ` · ${item.perm.title}` : ''}
      </span>
    </div>
  )
}

function Notice({ level, text, code, vars }: Pick<Extract<Item, { type: 'notice' }>, 'level' | 'text' | 'code' | 'vars'>) {
  const t = useT()
  if (code) {
    const v = { ...vars }
    text = t(`notice.${code}`, v)
    if (code === 'agentExited' && v.tail) text += `:\n${v.tail}`
  }
  const tone =
    level === 'error' ? 'bg-danger-soft text-danger-text' : level === 'warning' ? 'bg-warning-soft text-warning-text' : 'bg-surface-2 text-fg-2'
  const Icon = level === 'info' ? Info : CircleAlert
  return (
    <div className={`flex items-start gap-2 rounded-[10px] px-3 py-2.5 ${tone}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="selectable min-w-0 text-[0.929rem] leading-snug whitespace-pre-wrap">{text}</div>
    </div>
  )
}

function TurnFooter({ item }: { item: Extract<Item, { type: 'turn' }> }) {
  const t = useT()
  const parts: string[] = []
  if (item.summary === 'interrupted') parts.push(t('transcript.interrupted'))
  else if (!item.ok) parts.push(t('transcript.turnFailed'))
  if (item.durationMs) parts.push(t('transcript.took', { t: formatDuration(item.durationMs) }))
  const tokens = (item.usage?.inputTokens ?? 0) + (item.usage?.outputTokens ?? 0) + (item.usage?.cacheReadTokens ?? 0)
  if (tokens) parts.push(`${formatTokens(tokens)} tokens`)
  if (item.usage?.costUsd) parts.push(`$${item.usage.costUsd.toFixed(item.usage.costUsd < 0.1 ? 3 : 2)}`)
  if (!parts.length) return null
  return <div className="text-[0.857rem] text-fg-4 tabular-nums">{parts.join(' · ')}</div>
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const ItemView = memo(function ItemView({ item }: { item: Item }) {
  switch (item.type) {
    case 'user':
      return <UserMessage text={item.text} attachments={item.attachments} />
    case 'text':
      return (
        <div className="group relative">
          <Markdown text={item.text} />
          <div className="mt-1 h-[22px] opacity-0 transition-opacity delay-100 group-hover:opacity-100">
            <CopyButton text={item.text} />
          </div>
        </div>
      )
    case 'thinking':
      return <Thinking text={item.text} />
    case 'tools':
      return <ToolGroup tools={item.tools} />
    case 'permission':
      return <ResolvedPermission item={item} />
    case 'notice':
      return <Notice level={item.level} text={item.text} code={item.code} vars={item.vars} />
    case 'changes':
      return <ChangesCard files={item.files} />
    case 'generated':
      return <GeneratedRow files={item.files} />
    case 'turn':
      return <TurnFooter item={item} />
  }
})

/** Spinner · activity · elapsed · tokens, at the foot of the running turn. */
function StatusLine({ sessionId, runningTool, blocked, thinking }: { sessionId: string; runningTool?: ToolNode; blocked: boolean; thinking: boolean }) {
  const t = useT()
  const lang = useLang()
  const live = useStudio((s) => s.live[sessionId])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = live ? now - live.startedAt : 0
  const label = blocked ? t('status.blocked') : thinking ? t('transcript.thinking') : activityLabel(runningTool, lang)
  return (
    <div className="flex items-center gap-2 text-[1rem] text-fg-3" data-state={blocked ? 'blocked' : 'busy'}>
      <GlyphSpinner paused={blocked} />
      <span className={`min-w-0 truncate ${blocked ? 'text-warning-text' : 'shimmer-text'}`}>{label}…</span>
      {elapsed > 1500 && <span className="shrink-0 tabular-nums">{formatDuration(elapsed)}</span>}
      {live && live.tokens > 0 && <span className="shrink-0 tabular-nums">· {formatTokens(live.tokens)} tokens</span>}
    </div>
  )
}

export function Transcript({ sessionId }: { sessionId: string }) {
  const events = useStudio((s) => s.events[sessionId] ?? EMPTY)
  const streaming = useStudio((s) => s.streaming[sessionId])
  const session = useStudio((s) => s.sessions.find((x) => x.id === sessionId))
  const { items, runningTool, pending } = useMemo(() => buildTranscript(events), [events])
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const focusKey = useStudio((s) => s.focusKey)
  const reviewedThrough = useStudio((s) => s.reviews[sessionId]?.at(-1)?.throughSeq)
  // A review sits after the last item it covered, so later turns read below it.
  const reviewAt = useMemo(() => {
    if (reviewedThrough === undefined) return -2
    for (let i = items.length - 1; i >= 0; i--) if (Number(items[i].key.slice(1)) <= reviewedThrough) return i
    return items.length - 1
  }, [items, reviewedThrough])
  const lastSeq = events[events.length - 1]?.seq ?? 0
  const reviewId = useStudio((s) => s.reviews[sessionId]?.at(-1)?.id)
  const live = streaming ? Object.entries(streaming) : []
  const running = session?.status === 'running' || session?.status === 'waiting'
  const thinkingLive = live.some(([, b]) => b.thinking)

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    pinned.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessionId])
  // A review started from the end of the conversation is followed like a new turn.
  useEffect(() => {
    const el = scroller.current
    if (!reviewId || !el || reviewAt !== items.length - 1) return
    pinned.current = true
    el.scrollTop = el.scrollHeight
  }, [reviewId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Provenance links land on the turn that produced a version.
  useEffect(() => {
    if (!focusKey) return
    const target = scroller.current?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)
    if (!target) return
    pinned.current = false
    target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    target.classList.remove('focus-flash')
    void target.offsetWidth
    target.classList.add('focus-flash')
    useStudio.setState({ focusKey: null })
  }, [focusKey, items])

  return (
    <div
      ref={scroller}
      className="scroll min-h-0 flex-1"
      style={{ maskImage: 'linear-gradient(to bottom, black calc(100% - 48px), transparent)' }}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      <div className="mx-auto flex w-full max-w-[var(--column)] flex-col gap-[14px] px-8 pt-4 pb-14">
        {reviewAt === -1 && <ReviewCard sessionId={sessionId} lastSeq={lastSeq} />}
        {items.map((item, i) => (
          <Fragment key={item.key}>
            <div data-key={item.key}>
              <ItemView item={item} />
            </div>
            {i === reviewAt && <ReviewCard sessionId={sessionId} lastSeq={lastSeq} />}
          </Fragment>
        ))}
        {live.map(([id, block]) =>
          block.thinking ? <Thinking key={id} text={block.text} live /> : <Markdown key={id} text={block.text} className="streaming" />
        )}
        {running && <StatusLine sessionId={sessionId} runningTool={runningTool} blocked={pending.length > 0} thinking={thinkingLive} />}
      </div>
    </div>
  )
}
