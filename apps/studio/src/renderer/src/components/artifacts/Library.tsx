import { useMemo, useState } from 'react'
import { FileText, Search } from 'lucide-react'
import type { Artifact, ArtifactKind } from '@shared/types'
import { useT, type MessageKey } from '../../lib/i18n'
import { useStudio } from '../../store'
import { basename, dirname, KIND_ICON, KINDS, latest, OriginBadge, thumbUrl, useTimeAgo, VersionTag } from './helpers'

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

export function Library() {
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
