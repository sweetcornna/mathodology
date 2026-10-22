import { useEffect, useState } from 'react'
import { CircleCheck, CircleHelp, CircleX, ExternalLink, FileText, ListChecks, PenLine, RotateCcw, TriangleAlert, Wand2 } from 'lucide-react'
import type { RefEntryCheck, RefProblem, RefReport, RefVerdict } from '@shared/types'
import { api } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { Spinner, Tip } from './ui'

const VERDICT: Record<RefVerdict, { icon: typeof CircleX; tone: string }> = {
  fail: { icon: CircleX, tone: 'text-danger' },
  warn: { icon: TriangleAlert, tone: 'text-warning-text' },
  inconclusive: { icon: CircleHelp, tone: 'text-fg-3' },
  ok: { icon: CircleCheck, tone: 'text-success' }
}
const ORDER: RefVerdict[] = ['fail', 'warn', 'inconclusive', 'ok']
const RANK: Record<RefProblem['severity'], number> = { fail: 0, warn: 1, inconclusive: 2, info: 3 }

// Reports survive pane-tab switches for the life of the window, one per project.
const reports = new Map<string, RefReport>()

function clean(err: unknown): string {
  return String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function problemText(t: ReturnType<typeof useT>, p: RefProblem): string {
  return t(`refs.p.${p.code}` as MessageKey, { detail: p.detail ?? '' })
}

function EntryRow({ entry, file, onDoi }: { entry: RefEntryCheck; file: string; onDoi: (doi: string) => Promise<void> }) {
  const t = useT()
  const openPreview = useStudio((s) => s.openPreview)
  const [busy, setBusy] = useState(false)
  const { icon: Icon, tone } = VERDICT[entry.verdict]
  const shown = entry.problems.filter((p) => p.code !== 'no_doi' || !entry.candidate).sort((a, b) => RANK[a.severity] - RANK[b.severity])
  const record = entry.check?.record ?? entry.candidate?.record
  const doi = entry.check?.state === 'resolves' ? entry.check.doi : undefined
  return (
    <article className="border-b border-line px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <Tip label={t(`refs.v.${entry.verdict}` as MessageKey)}>
          <Icon size={14} className={`mt-[3px] shrink-0 ${tone}`} />
        </Tip>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <button className="font-mono text-[0.786rem] text-fg-2 hover:text-accent-text" onClick={() => openPreview(file)}>
              {entry.key}
            </button>
            <span className="truncate text-[0.75rem] text-fg-4">{[entry.author.split(/\s+and\s+/)[0], entry.year].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[0.857rem] leading-snug">{entry.title || <span className="text-fg-3">—</span>}</div>
          {shown.length > 0 && (
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {shown.map((p, i) => (
                <li key={i} className={`text-[0.786rem] leading-snug ${p.severity === 'fail' ? 'text-danger-text' : p.severity === 'warn' ? 'text-warning-text' : 'text-fg-3'}`}>
                  {problemText(t, p)}
                </li>
              ))}
            </ul>
          )}
          {entry.candidate && !entry.doi && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.786rem] text-fg-2">
              <span className="text-fg-3">{t(entry.candidate.via === 'arxiv' ? 'refs.arxivDoi' : 'refs.candidate')}</span>
              <button className="chip text-accent-text hover:bg-accent-soft" onClick={() => void api.call('shell:openExternal', `https://doi.org/${entry.candidate!.doi}`)}>
                {entry.candidate.doi}
              </button>
              {entry.candidate.via === 'crossref' && <span className="text-fg-4">{t('refs.similarity', { n: Math.round(entry.candidate.similarity * 100) })}</span>}
              <button
                className="btn btn-secondary btn-sm h-6"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await onDoi(entry.candidate!.doi).finally(() => setBusy(false))
                }}
              >
                {busy ? <Spinner size={11} /> : <PenLine size={12} />} {t('refs.writeDoi')}
              </button>
            </div>
          )}
          {record && (entry.verdict === 'fail' || entry.verdict === 'warn') && (
            <div className="mt-1 text-[0.75rem] leading-snug text-fg-4">
              {t('refs.registry', { registry: entry.check?.registry ?? entry.candidate?.via ?? '' })} {record.title}
              {record.authors[0] && ` · ${record.authors[0].family}`}
              {record.year && ` · ${record.year}`}
            </div>
          )}
        </div>
        {doi && (
          <Tip label={t('pane.openExternal')}>
            <button className="icon-btn-sm shrink-0" aria-label={t('pane.openExternal')} onClick={() => void api.call('shell:openExternal', `https://doi.org/${doi}`)}>
              <ExternalLink size={13} />
            </button>
          </Tip>
        )}
      </div>
    </article>
  )
}

/** What to ask the agent: each doubtful entry with what the registry says, and no guessing. */
function fixRequest(t: ReturnType<typeof useT>, report: RefReport): string {
  const lines = report.entries
    .filter((e) => e.verdict === 'fail' || e.verdict === 'warn')
    .map((e) => {
      const notes = e.problems.filter((p) => p.severity !== 'info').map((p) => problemText(t, p))
      const reg = e.check?.record ? ` [${t('refs.registry', { registry: e.check.registry ?? '' })} ${e.check.record.title}${e.check.record.year ? `, ${e.check.record.year}` : ''}]` : ''
      return `- ${e.key}: ${notes.join('; ')}${reg}`
    })
  return `${t('refs.fixIntro', { file: report.file })}\n${lines.join('\n')}`
}

/**
 * Bibliography check: each entry's DOI is looked up in the DOI system and the registry's title,
 * first author and year compared with what the entry says; entries without a DOI get a candidate.
 */
export function ReferencesView() {
  const t = useT()
  const projectId = useStudio((s) => s.activeProjectId)
  const insert = useStudio((s) => s.insertIntoComposer)
  const toast = useStudio((s) => s.showToast)
  const [report, setReportRaw] = useState<RefReport | null>(() => (projectId ? (reports.get(projectId) ?? null) : null))
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<RefVerdict | null>(null)

  const setReport = (r: RefReport): void => {
    if (projectId) reports.set(projectId, r)
    setReportRaw(r)
  }

  useEffect(() => {
    setReportRaw(projectId ? (reports.get(projectId) ?? null) : null)
    setFilter(null)
    return api.on('refs:progress', (p) => {
      if (p.projectId === projectId) setProgress({ done: p.done, total: p.total })
    })
  }, [projectId])

  const run = async (file?: string): Promise<void> => {
    if (!projectId || progress) return
    setError(null)
    setProgress({ done: 0, total: 0 })
    try {
      setReport(await api.call('refs:check', projectId, file ?? report?.file))
    } catch (err) {
      setError(clean(err))
    } finally {
      setProgress(null)
    }
  }

  const writeDoi = async (key: string, doi: string): Promise<void> => {
    if (!projectId || !report) return
    try {
      const entry = await api.call('refs:setDoi', projectId, report.file, key, doi)
      setReport({ ...report, entries: report.entries.map((e) => (e.key === key ? entry : e)) })
      toast(t('refs.doiWritten', { key }), 'info')
    } catch (err) {
      toast(clean(err), 'error')
    }
  }

  const sorted = report ? [...report.entries].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.line - b.line) : []
  const visible = filter ? sorted.filter((e) => e.verdict === filter) : sorted
  const doubtful = sorted.filter((e) => e.verdict === 'fail' || e.verdict === 'warn').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        {report && report.files.length > 1 ? (
          <select className="h-7 max-w-[55%] rounded-[7px] bg-surface-2 px-2 text-[0.82rem]" value={report.file} onChange={(e) => void run(e.target.value)} aria-label={t('refs.file')}>
            {report.files.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        ) : (
          report?.file && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[0.786rem] text-fg-2">
              <FileText size={12} className="shrink-0" /> {report.file}
            </span>
          )
        )}
        <span className="flex-1" />
        {progress ? (
          <span className="inline-flex items-center gap-1.5 text-[0.786rem] text-fg-3">
            <Spinner size={12} /> {progress.total ? `${progress.done}/${progress.total}` : t('refs.checking')}
          </span>
        ) : (
          <button className="btn btn-secondary btn-sm h-7" onClick={() => void run()} disabled={!projectId}>
            {report ? <RotateCcw size={12} /> : <ListChecks size={13} />} {t(report ? 'refs.recheck' : 'refs.check')}
          </button>
        )}
      </div>
      <div className="scroll min-h-0 flex-1">
        {error ? (
          <div className="m-3 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[0.857rem] whitespace-pre-wrap text-danger-text">{error}</div>
        ) : !report ? (
          <div className="px-6 py-10 text-center text-[0.893rem] leading-relaxed text-fg-3">{t('refs.empty')}</div>
        ) : !report.file ? (
          <div className="px-6 py-10 text-center text-[0.893rem] leading-relaxed text-fg-3">{t('refs.noFile')}</div>
        ) : !report.entries.length ? (
          <div className="px-6 py-10 text-center text-[0.893rem] text-fg-3">{t('refs.noEntries')}</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
              {ORDER.map((v) => {
                const n = sorted.filter((e) => e.verdict === v).length
                if (!n) return null
                const { icon: Icon, tone } = VERDICT[v]
                return (
                  <button
                    key={v}
                    onClick={() => setFilter(filter === v ? null : v)}
                    aria-pressed={filter === v}
                    className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.786rem] transition-colors ${filter === v ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'}`}
                  >
                    <Icon size={12} className={filter === v ? '' : tone} /> {t(`refs.v.${v}` as MessageKey)} {n}
                  </button>
                )
              })}
              <span className="flex-1" />
              {doubtful > 0 && (
                <button className="btn btn-secondary btn-sm h-6" onClick={() => insert(fixRequest(t, report))}>
                  <Wand2 size={12} /> {t('refs.askAgent')}
                </button>
              )}
            </div>
            {visible.map((e) => (
              <EntryRow key={e.key + e.line} entry={e} file={report.file} onDoi={(doi) => writeDoi(e.key, doi)} />
            ))}
            <p className="m-0 px-3 py-3 text-[0.75rem] leading-snug text-fg-4">{t('refs.note')}</p>
          </>
        )}
      </div>
    </div>
  )
}
