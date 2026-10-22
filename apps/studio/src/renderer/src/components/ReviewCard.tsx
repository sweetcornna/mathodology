import { useState } from 'react'
import { ChevronRight, CircleCheck, CircleHelp, CircleX, RotateCcw, ShieldCheck, Square, TriangleAlert, Wrench } from 'lucide-react'
import type { FindingSeverity, Review, ReviewFinding } from '@shared/types'
import { projectRel } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { Markdown } from './Markdown'
import { Spinner, Tip } from './ui'

const SEVERITY: Record<FindingSeverity, { icon: typeof CircleX; tone: string }> = {
  fail: { icon: CircleX, tone: 'text-danger' },
  warn: { icon: TriangleAlert, tone: 'text-warning-text' },
  inconclusive: { icon: CircleHelp, tone: 'text-fg-3' },
  pass: { icon: CircleCheck, tone: 'text-success' }
}

const ORDER: FindingSeverity[] = ['fail', 'warn', 'inconclusive', 'pass']

/** A path or `call:<id>` the finding cites; paths open in the side pane. */
function Evidence({ item }: { item: string }) {
  const projectPath = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path ?? '')
  const rel = projectRel(projectPath, item) ?? item.replace(/^\.\//, '')
  const artifact = useStudio((s) => s.artifacts.find((a) => a.rel === rel))
  const openArtifact = useStudio((s) => s.openArtifact)
  const openPreview = useStudio((s) => s.openPreview)
  if (item.startsWith('call:')) return <span className="chip text-fg-3">{item}</span>
  return (
    <button className="chip text-accent-text hover:bg-accent-soft" onClick={() => (artifact ? openArtifact(artifact.id) : openPreview(rel))}>
      {rel}
    </button>
  )
}

function Finding({ review, finding }: { review: Review; finding: ReviewFinding }) {
  const t = useT()
  const setStatus = useStudio((s) => s.setFindingStatus)
  const askToFix = useStudio((s) => s.askToFix)
  const [open, setOpen] = useState(finding.severity === 'fail')
  const { icon: Icon, tone } = SEVERITY[finding.severity]
  const handled = finding.status !== 'open'
  const actionable = finding.severity !== 'pass'
  return (
    <div className="border-t border-line">
      <button className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        <Icon size={15} className={`mt-[3px] shrink-0 ${handled ? 'text-fg-4' : tone}`} />
        <span className={`min-w-0 flex-1 text-[0.929rem] leading-snug ${handled ? 'text-fg-3 line-through decoration-fg-4' : ''}`}>{finding.title}</span>
        {finding.kind === 'citation' && (
          <Tip label={t('review.citationTip')}>
            <span className="mt-[2px] shrink-0 rounded-[4px] bg-accent-soft px-1.5 text-[0.75rem] text-accent-text">{t('review.citation')}</span>
          </Tip>
        )}
        {handled && <span className="kbd shrink-0">{t(finding.status === 'resolved' ? 'review.resolved' : 'review.dismissed')}</span>}
        <ChevronRight size={14} className={`mt-[3px] shrink-0 text-fg-3 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pr-3 pb-3 pl-[35px] text-[0.893rem]">
          {finding.detail && <Markdown text={finding.detail} className="text-fg-2" />}
          {finding.evidence.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {finding.evidence.map((e) => (
                <Evidence key={e} item={e} />
              ))}
            </div>
          )}
          {finding.suggestion && (
            <div className="text-fg-2">
              <span className="text-fg-3">{t('review.suggestion')}</span>
              {finding.suggestion}
            </div>
          )}
          {actionable && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {!handled ? (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => void askToFix(finding)}>
                    <Wrench size={13} /> {t('review.fix')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(review, finding.id, 'resolved')}>
                    {t('review.resolve')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(review, finding.id, 'dismissed')}>
                    {t('review.dismiss')}
                  </button>
                </>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(review, finding.id, 'open')}>
                  {t('review.reopen')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The latest review of a session, at the foot of its transcript: counts by severity, the
 * findings that still need attention, and the ones already handled or confirmed below them.
 */
export function ReviewCard({ sessionId, lastSeq }: { sessionId: string; lastSeq: number }) {
  const t = useT()
  const review = useStudio((s) => s.reviews[sessionId]?.at(-1))
  const start = useStudio((s) => s.startReview)
  const cancel = useStudio((s) => s.cancelReview)
  const running = useStudio((s) => {
    const st = s.sessions.find((x) => x.id === sessionId)?.status
    return st === 'running' || st === 'waiting'
  })
  const [showRest, setShowRest] = useState(false)
  if (!review) return null

  const counts = ORDER.map((sev) => [sev, review.findings.filter((f) => f.severity === sev).length] as const).filter(([, n]) => n > 0)
  const open = review.findings.filter((f) => f.status === 'open' && f.severity !== 'pass')
  const rest = review.findings.filter((f) => !open.includes(f))
  // The review's own run adds nothing to the transcript, so any later event means the session moved on.
  const stale = review.status === 'done' && lastSeq > review.throughSeq

  return (
    <div className="card overflow-hidden rise-in">
      <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
        <ShieldCheck size={15} className="shrink-0 text-accent" />
        <span className="text-[0.929rem] font-medium">{t('review.title')}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[0.786rem] tabular-nums">
          {counts.map(([sev, n]) => {
            const { icon: Icon, tone } = SEVERITY[sev]
            return (
              <Tip key={sev} label={t(`review.sev.${sev}` as MessageKey)}>
                <span className="inline-flex items-center gap-1 text-fg-2">
                  <Icon size={12} className={tone} />
                  {n}
                </span>
              </Tip>
            )
          })}
          {stale && <span className="text-fg-3">{t('review.stale')}</span>}
        </span>
        {review.status === 'running' ? (
          <Tip label={t('review.cancel')}>
            <button className="icon-btn-sm" onClick={() => cancel(review.id)} aria-label={t('review.cancel')}>
              <Square size={11} />
            </button>
          </Tip>
        ) : (
          <Tip label={t('review.rerun')}>
            <button className="icon-btn-sm" disabled={running} onClick={() => void start(sessionId)} aria-label={t('review.rerun')}>
              <RotateCcw size={13} />
            </button>
          </Tip>
        )}
      </div>
      {review.status === 'running' && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-[0.893rem] text-fg-3">
          <Spinner size={13} />
          <span className="shimmer-text">{t('review.running')}</span>
          {review.steps > 0 && <span className="tabular-nums">· {t('review.steps', { n: review.steps })}</span>}
        </div>
      )}
      {(review.status === 'error' || review.status === 'cancelled') && (
        <div className="border-t border-line px-3 py-2.5 text-[0.893rem]">
          <div className={review.status === 'error' ? 'text-danger-text' : 'text-fg-3'}>{t(review.status === 'error' ? 'review.failed' : 'review.cancelled')}</div>
          {review.error && <pre className="selectable m-0 mt-1 max-h-32 overflow-auto font-mono text-[0.786rem] whitespace-pre-wrap text-fg-3">{review.error}</pre>}
        </div>
      )}
      {review.status === 'done' && review.summary && <div className="border-t border-line px-3 py-2.5 text-[0.929rem] leading-relaxed text-fg-2">{review.summary}</div>}
      {review.trace && review.trace.found > 0 && (
        <div className="border-t border-line px-3 py-2 text-[0.82rem] leading-snug text-fg-3">
          {t('review.trace', { found: review.trace.found, traced: review.trace.traced, bib: review.trace.bibOnly, untraced: review.trace.untraced })}
          {review.trace.resolved + review.trace.unverifiable > 0 &&
            ` ${t('review.traceDoi', { n: review.trace.resolved + review.trace.unverifiable, missing: review.trace.notFound, unanswered: review.trace.unverifiable })}`}
        </div>
      )}
      {open.map((f) => (
        <Finding key={f.id} review={review} finding={f} />
      ))}
      {review.status === 'done' && !open.length && <div className="border-t border-line px-3 py-2.5 text-[0.893rem] text-fg-3">{t('review.none')}</div>}
      {rest.length > 0 && (
        <>
          <button className="flex h-8 w-full items-center gap-1.5 border-t border-line px-3 text-left text-[0.857rem] text-fg-3 hover:bg-surface-2" onClick={() => setShowRest((v) => !v)}>
            <ChevronRight size={13} className={`transition-transform ${showRest ? 'rotate-90' : ''}`} />
            {t('review.more', { n: rest.length })}
          </button>
          {showRest && rest.map((f) => <Finding key={f.id} review={review} finding={f} />)}
        </>
      )}
    </div>
  )
}
