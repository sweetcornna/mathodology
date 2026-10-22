import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Database,
  ExternalLink,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  History,
  MessageSquareText,
  PenLine,
  RotateCcw,
  Search,
  Workflow
} from 'lucide-react'
import { createTwoFilesPatch } from 'diff'
import type { Artifact, ArtifactKind, ArtifactVersion, FilePreview, SessionEvent, VersionOrigin } from '@shared/types'
import { api, artifactUrl, fileUrl } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import type { GeneratedFile } from '../lib/transcript'
import { useStudio } from '../store'
import { DiffStat, DiffView, formatSize, PreviewBody } from './Preview'
import { Spinner, Tip } from './ui'

const KINDS: ArtifactKind[] = ['figure', 'table', 'document', 'code', 'data']

const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  figure: FileImage,
  table: FileSpreadsheet,
  document: FileText,
  code: FileCode,
  data: Database
}

const ORIGIN_ICON: Record<VersionOrigin, typeof FileText> = {
  tool: BadgeCheck,
  turn: Workflow,
  user: History,
  external: PenLine
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

function basename(rel: string): string {
  return rel.split('/').pop() ?? rel
}

function dirname(rel: string): string {
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
}

function latest(a: Artifact): ArtifactVersion {
  return a.versions[a.versions.length - 1]
}

/** Image URL for a version: its stored bytes, or the file on disk when only a checksum was kept. */
function thumbUrl(projectId: string, a: Artifact, v: ArtifactVersion): string | null {
  if (!IMAGE.test(a.rel)) return null
  return v.stored ? artifactUrl(projectId, a.id, v.v) : fileUrl(projectId, a.rel, v.createdAt)
}

function useTimeAgo(): (ts: number) => string {
  const locale = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh-CN'))
  return (ts) => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const s = Math.round((ts - Date.now()) / 1000)
    if (Math.abs(s) < 60) return rtf.format(s, 'second')
    const m = Math.round(s / 60)
    if (Math.abs(m) < 60) return rtf.format(m, 'minute')
    const h = Math.round(m / 60)
    if (Math.abs(h) < 24) return rtf.format(h, 'hour')
    return rtf.format(Math.round(h / 24), 'day')
  }
}

export function OriginBadge({ origin, compact }: { origin: VersionOrigin; compact?: boolean }) {
  const t = useT()
  const Icon = ORIGIN_ICON[origin]
  const tone = origin === 'tool' ? 'text-success' : origin === 'turn' ? 'text-accent' : 'text-fg-3'
  const label = t(`origin.${origin}` as MessageKey)
  return (
    <Tip label={t(`origin.${origin}.desc` as MessageKey)}>
      <span className="inline-flex shrink-0 items-center gap-1 text-[0.786rem] text-fg-3">
        <Icon size={12} className={tone} />
        {!compact && label}
      </span>
    </Tip>
  )
}

function VersionTag({ v }: { v: number }) {
  return <span className="kbd shrink-0">v{v}</span>
}

/** The card row under a turn: what the turn produced, newest version of each, click to open. */
export function GeneratedRow({ files }: { files: GeneratedFile[] }) {
  const t = useT()
  const projectId = useStudio((s) => s.activeProjectId)
  const artifacts = useStudio((s) => s.artifacts)
  const open = useStudio((s) => s.openArtifact)
  const [all, setAll] = useState(false)
  const LIMIT = 6
  // Figures first: they are what people look for under a turn.
  const sorted = useMemo(() => [...files].sort((a, b) => Number(b.kind === 'figure') - Number(a.kind === 'figure')), [files])
  const shown = all ? sorted : sorted.slice(0, LIMIT)
  if (!projectId) return null
  return (
    <div className="rise-in">
      <div className="mb-1.5 text-[0.857rem] text-fg-3">{t('artifacts.generated', { n: files.length })}</div>
      <div className="flex flex-wrap gap-2">
        {shown.map((f) => {
          const artifact = artifacts.find((a) => a.id === f.artifactId)
          const version = artifact?.versions.find((x) => x.v === f.v)
          const thumb = artifact && version ? thumbUrl(projectId, artifact, version) : null
          const Icon = KIND_ICON[f.kind]
          const name = basename(f.rel)
          return thumb ? (
            <button key={f.artifactId} title={f.rel} onClick={() => open(f.artifactId, f.v)} className="card group flex w-[156px] flex-col overflow-hidden text-left transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong),var(--shadow-md)]">
              <div className="grid aspect-[4/3] place-items-center overflow-hidden border-b border-line bg-white">
                <img src={thumb} loading="lazy" className="h-full w-full object-contain" alt={name} />
              </div>
              <div className="flex h-8 items-center gap-1.5 px-2 text-[0.857rem]">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {f.v > 1 && <VersionTag v={f.v} />}
              </div>
            </button>
          ) : (
            <button key={f.artifactId} title={f.rel} onClick={() => open(f.artifactId, f.v)} className="card flex h-11 max-w-[260px] items-center gap-2 px-2.5 text-left transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong),var(--shadow-md)]">
              <Icon size={16} className="shrink-0 text-fg-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.857rem]">{name}</span>
                {dirname(f.rel) && <span className="block truncate text-[0.75rem] text-fg-3">{dirname(f.rel)}</span>}
              </span>
              {f.added !== undefined && (f.added > 0 || (f.removed ?? 0) > 0) && <DiffStat added={f.added} removed={f.removed ?? 0} />}
              {f.v > 1 && <VersionTag v={f.v} />}
            </button>
          )
        })}
        {files.length > LIMIT && (
          <button className="card flex h-11 items-center px-3 text-[0.857rem] text-fg-2 hover:bg-surface-2" onClick={() => setAll((v) => !v)}>
            {all ? t('changes.less') : t('artifacts.more', { n: files.length - LIMIT })}
          </button>
        )}
      </div>
    </div>
  )
}

/** The session an artifact belongs to in the library: the newest version that came from one. */
function homeSession(a: Artifact): string {
  for (let i = a.versions.length - 1; i >= 0; i--) if (a.versions[i].sessionId) return a.versions[i].sessionId!
  return ''
}

function LibraryRow({ projectId, a }: { projectId: string; a: Artifact }) {
  const t = useT()
  const ago = useTimeAgo()
  const open = useStudio((s) => s.openArtifact)
  const v = latest(a)
  const thumb = thumbUrl(projectId, a, v)
  const Icon = KIND_ICON[a.kind]
  return (
    <button className="group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => open(a.id)} title={a.rel}>
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-surface-2 shadow-[0_0_0_1px_var(--border)]">
        {thumb ? <img src={thumb} loading="lazy" className="h-full w-full bg-white object-contain" alt="" /> : <Icon size={16} className="text-fg-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[0.893rem] ${a.missing ? 'text-fg-3 line-through' : ''}`}>{basename(a.rel)}</span>
        <span className="block truncate text-[0.75rem] text-fg-3">
          {dirname(a.rel) || '/'} · {ago(a.updatedAt)}
        </span>
      </span>
      {a.missing && <span className="kbd shrink-0">{t('artifacts.missing')}</span>}
      <OriginBadge origin={v.origin} compact />
      <VersionTag v={v.v} />
    </button>
  )
}

function FigureTile({ projectId, a }: { projectId: string; a: Artifact }) {
  const open = useStudio((s) => s.openArtifact)
  const v = latest(a)
  const thumb = thumbUrl(projectId, a, v)
  return (
    <button className="group flex flex-col gap-1.5 text-left" onClick={() => open(a.id)} title={a.rel}>
      <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[8px] bg-white shadow-[0_0_0_1px_var(--border)] transition-shadow group-hover:shadow-[0_0_0_1px_var(--border-strong),var(--shadow-md)]">
        {thumb ? (
          <img src={thumb} loading="lazy" className="h-full w-full object-contain" alt={basename(a.rel)} />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[0.786rem] text-fg-3">
            <FileText size={22} />
            PDF
          </span>
        )}
        {v.v > 1 && (
          <span className="absolute top-1.5 right-1.5">
            <VersionTag v={v.v} />
          </span>
        )}
      </div>
      <span className={`truncate px-0.5 text-[0.786rem] ${a.missing ? 'text-fg-3 line-through' : 'text-fg-2'}`}>{a.rel}</span>
    </button>
  )
}

function Library() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const artifacts = useStudio((s) => s.artifacts)
  const sessions = useStudio((s) => s.sessions)
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const c: Partial<Record<ArtifactKind, number>> = {}
    for (const a of artifacts) c[a.kind] = (c[a.kind] ?? 0) + 1
    return c
  }, [artifacts])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = artifacts
      .filter((a) => (kind === 'all' || a.kind === kind) && (!q || a.rel.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const map = new Map<string, Artifact[]>()
    for (const a of list) {
      const key = homeSession(a)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return [...map.entries()]
  }, [artifacts, kind, query])

  if (!project) return null
  const title = (id: string): string => (id ? sessions.find((s) => s.id === id)?.title || t('session.untitled') : t('artifacts.outside'))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <label className="flex h-8 items-center gap-2 rounded-[8px] bg-surface-2 px-2.5">
          <Search size={13} className="shrink-0 text-fg-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('artifacts.search')} className="min-w-0 flex-1 bg-transparent text-[0.893rem] outline-none placeholder:text-fg-3 focus-visible:shadow-none" />
        </label>
        <div className="flex flex-wrap gap-1">
          {(['all', ...KINDS] as const).map((k) => {
            const n = k === 'all' ? artifacts.length : counts[k] ?? 0
            if (k !== 'all' && !n) return null
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`h-6 rounded-full px-2.5 text-[0.786rem] transition-colors ${kind === k ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'}`}
              >
                {t(k === 'all' ? 'artifacts.all' : (`artifacts.kind.${k}` as MessageKey))} <span className="opacity-60 tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="scroll min-h-0 flex-1 px-2 py-2">
        {!artifacts.length ? (
          <div className="px-6 py-10 text-center text-[0.929rem] leading-relaxed text-fg-3">{t('artifacts.empty')}</div>
        ) : !groups.length ? (
          <div className="px-6 py-10 text-center text-[0.929rem] text-fg-3">{t('palette.empty')}</div>
        ) : (
          groups.map(([sessionId, list]) => (
            <section key={sessionId || 'outside'} className="mb-3">
              <div className="truncate px-2 pt-1 pb-1 text-[0.75rem] font-medium text-fg-3">{title(sessionId)}</div>
              {kind === 'figure' ? (
                <div className="grid grid-cols-2 gap-2.5 px-1 pb-1">
                  {list.map((a) => (
                    <FigureTile key={a.id} projectId={project.id} a={a} />
                  ))}
                </div>
              ) : (
                list.map((a) => <LibraryRow key={a.id} projectId={project.id} a={a} />)
              )}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

const TEXT_KINDS = new Set<FilePreview['kind']>(['text', 'markdown', 'csv'])

function usePreview(projectId: string, artifactId: string, v: number | undefined): FilePreview | null | 'error' {
  const [preview, setPreview] = useState<FilePreview | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    setPreview(null)
    if (v === undefined) return
    api
      .call('artifacts:read', projectId, artifactId, v)
      .then((p) => alive && setPreview(p))
      .catch(() => alive && setPreview('error'))
    return () => {
      alive = false
    }
  }, [projectId, artifactId, v])
  return preview
}

function Compare({ projectId, a, v }: { projectId: string; a: Artifact; v: ArtifactVersion }) {
  const t = useT()
  const earlier = a.versions.filter((x) => x.v !== v.v)
  const [base, setBase] = useState<number | undefined>(() => earlier.filter((x) => x.v < v.v).pop()?.v ?? earlier[0]?.v)
  useEffect(() => setBase(earlier.filter((x) => x.v < v.v).pop()?.v ?? earlier[0]?.v), [v.v]) // eslint-disable-line react-hooks/exhaustive-deps
  const left = usePreview(projectId, a.id, base)
  const right = usePreview(projectId, a.id, v.v)
  const baseVersion = a.versions.find((x) => x.v === base)

  const patch = useMemo(() => {
    if (!left || !right || left === 'error' || right === 'error') return null
    if (!TEXT_KINDS.has(left.kind) || !TEXT_KINDS.has(right.kind)) return null
    const name = basename(a.rel)
    const lines = createTwoFilesPatch(name, name, left.content ?? '', right.content ?? '', '', '', { context: 3 }).split('\n')
    // Hunks only; the version selector above already names both sides.
    return lines.slice(Math.max(0, lines.findIndex((l) => l.startsWith('@@')))).join('\n')
  }, [left, right, a.rel, base, v.v])

  if (!earlier.length) return <div className="p-6 text-center text-[0.88rem] text-fg-3">{t('artifacts.firstVersion')}</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[0.857rem] text-fg-3">
        {t('artifacts.compareWith')}
        <select value={base} onChange={(e) => setBase(Number(e.target.value))} className="h-7 rounded-[6px] bg-surface-2 px-1.5 text-fg">
          {earlier.map((x) => (
            <option key={x.v} value={x.v}>
              v{x.v}
            </option>
          ))}
        </select>
        <span>→ v{v.v}</span>
      </div>
      {!left || !right ? (
        <div className="grid flex-1 place-items-center text-fg-3">
          <Spinner />
        </div>
      ) : left === 'error' || right === 'error' || left.kind === 'too-large' || right.kind === 'too-large' ? (
        <div className="p-6 text-center text-[0.88rem] text-fg-3">{t('artifacts.notStored')}</div>
      ) : patch !== null ? (
        <div className="scroll min-h-0 flex-1 bg-[var(--code-bg)]">
          <DiffView text={patch} className="" />
        </div>
      ) : left.kind === 'image' && right.kind === 'image' ? (
        <div className="scroll grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 p-3">
          {[
            [base, left],
            [v.v, right]
          ].map(([n, p]) => (
            <figure key={String(n)} className="m-0 flex flex-col gap-1.5">
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-[8px] bg-white shadow-[0_0_0_1px_var(--border)]">
                <img src={(p as FilePreview).content} className="h-full w-full object-contain" alt={`v${n}`} />
              </div>
              <figcaption className="text-center text-[0.786rem] text-fg-3">v{String(n)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1 p-6 text-center text-[0.88rem] text-fg-3">
          {t('artifacts.binaryDiff')}
          <span className="tabular-nums">
            v{base}: {formatSize(baseVersion?.size ?? 0)} → v{v.v}: {formatSize(v.size)}
          </span>
        </div>
      )}
    </div>
  )
}

const EMPTY: SessionEvent[] = []

/** Events of the session that produced a version, loaded on demand. */
function useSessionEvents(sessionId: string | undefined): SessionEvent[] | null {
  const cached = useStudio((s) => (sessionId ? s.events[sessionId] : EMPTY))
  useEffect(() => {
    if (!sessionId || cached) return
    void api.call('sessions:events', sessionId).then((events) => {
      useStudio.setState((s) => (s.events[sessionId] ? {} : { events: { ...s.events, [sessionId]: events } }))
    })
  }, [sessionId, cached])
  return cached ?? null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-1 text-[0.857rem]">
      <dt className="text-fg-3">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-fg-2">{children}</dd>
    </div>
  )
}

function Provenance({ v }: { v: ArtifactVersion }) {
  const t = useT()
  const session = useStudio((s) => s.sessions.find((x) => x.id === v.sessionId))
  const jumpTo = useStudio((s) => s.jumpTo)
  const events = useSessionEvents(v.sessionId)

  const { prompt, call, result, commands } = useMemo(() => {
    const list = events ?? []
    const prompt = list.find((e) => e.kind === 'user.message' && e.seq === v.turnSeq)
    const call = v.callId ? list.find((e) => e.kind === 'tool.call' && e.callId === v.callId) : undefined
    const result = v.callId ? list.find((e) => e.kind === 'tool.result' && e.callId === v.callId) : undefined
    // For turn-level versions, the commands run in that turn are the likely producers.
    const commands: string[] = []
    if (v.origin === 'turn' && v.turnSeq !== undefined) {
      for (const e of list) {
        if (e.seq <= v.turnSeq) continue
        if (e.kind === 'turn.completed') break
        if (e.kind === 'tool.call' && e.toolKind === 'shell') {
          const cmd = (e.input as Record<string, unknown> | undefined)?.command
          if (typeof cmd === 'string') commands.push(cmd)
        }
      }
    }
    return { prompt, call, result, commands }
  }, [events, v])

  const Icon = ORIGIN_ICON[v.origin]
  return (
    <div className="scroll min-h-0 flex-1 px-4 py-3">
      <div className="mb-3 flex items-start gap-2.5 rounded-[10px] bg-surface-2 px-3 py-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${v.origin === 'tool' ? 'text-success' : v.origin === 'turn' ? 'text-accent' : 'text-fg-3'}`} />
        <div className="min-w-0">
          <div className="text-[0.929rem] font-medium">{t(`origin.${v.origin}` as MessageKey)}</div>
          <div className="text-[0.857rem] leading-snug text-fg-3">{t(`origin.${v.origin}.desc` as MessageKey)}</div>
        </div>
      </div>
      <dl className="m-0">
        {v.sessionId && (
          <Field label={t('prov.session')}>
            {session ? (
              <button className="text-left text-accent-text hover:underline" onClick={() => void jumpTo(session.id, v.turnSeq)}>
                {session.title || t('session.untitled')}
              </button>
            ) : (
              t('prov.unknownSession')
            )}
          </Field>
        )}
        {prompt?.kind === 'user.message' && (
          <Field label={t('prov.turn')}>
            <span className="line-clamp-3 whitespace-pre-wrap">{prompt.text}</span>
          </Field>
        )}
        {call?.kind === 'tool.call' && (
          <Field label={t('prov.call')}>
            <span className="chip">{call.name}</span> {call.title}
          </Field>
        )}
        {result?.kind === 'tool.result' && (
          <Field label={t('prov.status')}>
            <span className={result.isError ? 'text-danger-text' : 'text-success'}>{t(result.isError ? 'prov.failed' : 'prov.ok')}</span>
          </Field>
        )}
        {v.restoredFrom !== undefined && <Field label={t('prov.restoredFrom')}>v{v.restoredFrom}</Field>}
        <Field label={t('prov.created')}>{new Date(v.createdAt).toLocaleString()}</Field>
        <Field label={t('prov.size')}>{formatSize(v.size)}</Field>
        <Field label={t('prov.checksum')}>
          <span className="font-mono text-[0.786rem]">{v.sha256.slice(0, 16)}…</span>
        </Field>
        {!v.stored && <Field label="">{t('artifacts.notStored')}</Field>}
      </dl>
      {commands.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[0.786rem] text-fg-3">{t('prov.commands')}</div>
          <pre className="selectable scroll m-0 max-h-48 rounded-[8px] bg-[var(--code-bg)] px-2.5 py-2 font-mono text-[0.786rem] leading-[1.5] whitespace-pre-wrap text-fg-2">
            {commands.slice(-6).join('\n')}
          </pre>
        </div>
      )}
      {result?.kind === 'tool.result' && result.output.trim() && (
        <div className="mt-3">
          <div className="mb-1 text-[0.786rem] text-fg-3">{t('prov.output')}</div>
          <pre className="selectable scroll m-0 max-h-48 rounded-[8px] bg-[var(--code-bg)] px-2.5 py-2 font-mono text-[0.786rem] leading-[1.5] whitespace-pre-wrap text-fg-2">
            {result.output.slice(0, 4000)}
          </pre>
        </div>
      )}
      {v.sessionId && session && (
        <button className="btn btn-secondary btn-sm mt-4" onClick={() => void jumpTo(session.id, v.turnSeq)}>
          <MessageSquareText size={13} /> {t('prov.jump')}
        </button>
      )}
    </div>
  )
}

type ViewTab = 'preview' | 'compare' | 'provenance'

function Viewer({ projectId, a, initial }: { projectId: string; a: Artifact; initial?: number }) {
  const t = useT()
  const ago = useTimeAgo()
  const open = useStudio((s) => s.openArtifact)
  const confirm = useStudio((s) => s.confirm)
  const toast = useStudio((s) => s.showToast)
  const insert = useStudio((s) => s.insertIntoComposer)
  const projectPath = useStudio((s) => s.projects.find((p) => p.id === projectId)?.path ?? '')
  const [tab, setTab] = useState<ViewTab>('preview')
  const newest = latest(a)
  const v = a.versions.find((x) => x.v === initial) ?? newest
  const index = a.versions.indexOf(v)
  const preview = usePreview(projectId, a.id, v.v)
  const go = (i: number): void => open(a.id, a.versions[i]?.v)

  const restore = async (): Promise<void> => {
    const ok = await confirm({
      title: t('artifacts.restore'),
      body: t('artifacts.restoreConfirm', { v: v.v, rel: a.rel, n: newest.v + 1 })
    })
    if (!ok) return
    const next = await api.call('artifacts:restore', projectId, a.id, v.v)
    if (next) {
      open(a.id, latest(next).v)
      toast(t('artifacts.restored', { n: latest(next).v }))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button className="icon-btn-sm" onClick={() => open(null)} aria-label={t('pane.artifacts')}>
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <div className={`truncate text-[0.893rem] font-medium ${a.missing ? 'line-through' : ''}`} title={a.rel}>
            {basename(a.rel)}
          </div>
          <div className="truncate text-[0.75rem] text-fg-3">{dirname(a.rel) || '/'}</div>
        </div>
        <Tip label={t('artifacts.mention')}>
          <button className="icon-btn-sm" aria-label={t('artifacts.mention')} onClick={() => insert(v === newest ? a.rel : `${a.rel} (v${v.v})`)}>
            <CornerDownLeft size={13} />
          </button>
        </Tip>
        {!a.missing && (
          <Tip label={t('pane.openExternal')}>
            <button className="icon-btn-sm" onClick={() => void api.call('shell:openPath', `${projectPath}/${a.rel}`)}>
              <ExternalLink size={13} />
            </button>
          </Tip>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button className="icon-btn-sm" disabled={index <= 0} onClick={() => go(index - 1)} aria-label="Previous version">
          <ChevronLeft size={14} />
        </button>
        <span className="text-[0.857rem] font-medium tabular-nums">
          v{v.v}
          <span className="font-normal text-fg-3"> / {a.versions.length}</span>
        </span>
        <button className="icon-btn-sm" disabled={index >= a.versions.length - 1} onClick={() => go(index + 1)} aria-label="Next version">
          <ChevronRight size={14} />
        </button>
        <OriginBadge origin={v.origin} />
        <span className="min-w-0 flex-1 truncate text-right text-[0.786rem] text-fg-3">{ago(v.createdAt)}</span>
        {v !== newest && v.stored && (
          <Tip label={t('artifacts.restore')}>
            <button className="icon-btn-sm" onClick={() => void restore()}>
              <RotateCcw size={13} />
            </button>
          </Tip>
        )}
      </div>
      <div className="flex gap-0.5 border-b border-line px-2 py-1">
        {(['preview', 'compare', 'provenance'] as ViewTab[]).map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`h-6 rounded-[6px] px-2 text-[0.857rem] transition-colors ${tab === x ? 'bg-surface-3 text-fg' : 'text-fg-3 hover:bg-surface-2 hover:text-fg'}`}
          >
            {t(`artifacts.${x}` as MessageKey)}
          </button>
        ))}
      </div>
      {tab === 'preview' &&
        (preview === null ? (
          <div className="grid flex-1 place-items-center text-fg-3">
            <Spinner />
          </div>
        ) : preview === 'error' ? (
          <div className="p-6 text-[0.88rem] text-fg-3">{a.rel}</div>
        ) : (
          <PreviewBody preview={preview} rel={a.rel} pdfSrc={v.stored ? artifactUrl(projectId, a.id, v.v) : fileUrl(projectId, a.rel, v.createdAt)} />
        ))}
      {tab === 'compare' && <Compare projectId={projectId} a={a} v={v} />}
      {tab === 'provenance' && <Provenance v={v} />}
    </div>
  )
}

/** Side-pane tab: the project's versioned outputs, or one of them in the viewer. */
export function ArtifactsTab() {
  const projectId = useStudio((s) => s.activeProjectId)
  const view = useStudio((s) => s.artifactView)
  const artifact = useStudio((s) => s.artifacts.find((a) => a.id === s.artifactView?.artifactId))
  if (!projectId) return null
  if (view && artifact) return <Viewer key={artifact.id} projectId={projectId} a={artifact} initial={view.v} />
  return <Library />
}
