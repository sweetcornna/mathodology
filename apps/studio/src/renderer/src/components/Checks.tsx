import { useEffect, useState } from 'react'
import { Circle, CircleCheck, CircleX, FileCode, Hammer, Info, ListChecks, RotateCcw, TriangleAlert, Wand2 } from 'lucide-react'
import type { CheckIssue, CheckReport } from '@shared/types'
import { api } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { Spinner } from './ui'

type Severity = CheckIssue['severity']
type StageState = CheckReport['stages'][number]['state']

const STATE: Record<StageState, { icon: typeof CircleX; tone: string }> = {
  ok: { icon: CircleCheck, tone: 'text-success' },
  warning: { icon: TriangleAlert, tone: 'text-warning-text' },
  error: { icon: CircleX, tone: 'text-danger' },
  missing: { icon: Circle, tone: 'text-fg-4' }
}
const SEVERITY: Record<Severity, { icon: typeof CircleX; tone: string; text: string }> = {
  error: { icon: CircleX, tone: 'text-danger', text: 'text-danger-text' },
  warning: { icon: TriangleAlert, tone: 'text-warning-text', text: 'text-fg' },
  info: { icon: Info, tone: 'text-fg-3', text: 'text-fg-2' }
}
const SEVERITIES: Severity[] = ['error', 'warning', 'info']

// Reports survive pane-tab switches for the life of the window, one per project.
const reports = new Map<string, CheckReport>()

function clean(err: unknown): string {
  return String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function where(issue: CheckIssue): string {
  return issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}` : ''
}

/** What to ask the agent: the errors and warnings with their locations, results kept as the truth. */
function fixRequest(t: ReturnType<typeof useT>, report: CheckReport): string {
  const lines = report.issues
    .filter((i) => i.severity !== 'info')
    .slice(0, 40)
    .map((i) => `- [${i.severity}] ${where(i) ? where(i) + ': ' : ''}${i.message}${i.hint ? ` (${i.hint})` : ''}`)
  return `${t('checks.fixIntro')}\n${lines.join('\n')}`
}

function IssueRow({ issue }: { issue: CheckIssue }) {
  const openPreview = useStudio((s) => s.openPreview)
  const { icon: Icon, tone, text } = SEVERITY[issue.severity]
  return (
    <li className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
      <Icon size={13} className={`mt-[3px] shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className={`text-[0.857rem] leading-snug break-words ${text}`}>{issue.message}</div>
        {issue.file && (
          <button
            className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate font-mono text-[0.75rem] text-fg-3 hover:text-accent-text"
            onClick={() => openPreview(issue.file!)}
            title={where(issue)}
          >
            <FileCode size={11} className="shrink-0" /> {where(issue)}
          </button>
        )}
        {issue.hint && <div className="mt-0.5 text-[0.75rem] leading-snug text-fg-4">{issue.hint}</div>}
      </div>
    </li>
  )
}

/**
 * The workbench checks for the active project: one row per stage (brief, experiments, results,
 * figures, paper) and the findings, each linked to its file. Runs `mtd.py status` in the project.
 */
export function ChecksTab() {
  const t = useT()
  const project = useStudio((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const insert = useStudio((s) => s.insertIntoComposer)
  const projectId = project?.id
  const [report, setReportRaw] = useState<CheckReport | null>(() => (projectId ? (reports.get(projectId) ?? null) : null))
  const [busy, setBusy] = useState<'check' | 'compile' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Severity | null>(null)

  const run = async (compile = false): Promise<void> => {
    if (!projectId || busy) return
    setBusy(compile ? 'compile' : 'check')
    setError(null)
    try {
      const next = await api.call('checks:run', projectId, { compile })
      reports.set(projectId, next)
      setReportRaw(next)
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    const cached = projectId ? (reports.get(projectId) ?? null) : null
    setReportRaw(cached)
    setFilter(null)
    setError(null)
    if (projectId && !cached) void run()
  }, [projectId])

  if (!project) return null
  const visible = report ? (filter ? report.issues.filter((i) => i.severity === filter) : report.issues) : []
  const actionable = report ? report.counts.error + report.counts.warning : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-[0.86rem] font-medium">{t('checks.title')}</span>
        {report && <span className="text-[0.75rem] text-fg-4 tabular-nums">{report.generated_at.slice(11, 16)}</span>}
        <span className="flex-1" />
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-[0.786rem] text-fg-3">
            <Spinner size={12} /> {t(busy === 'compile' ? 'checks.compiling' : 'checks.running')}
          </span>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm h-7" onClick={() => void run(true)} title={t('checks.compileHint')}>
              <Hammer size={12} /> {t('checks.compile')}
            </button>
            <button className="btn btn-secondary btn-sm h-7" onClick={() => void run()}>
              {report ? <RotateCcw size={12} /> : <ListChecks size={13} />} {t(report ? 'checks.rerun' : 'checks.run')}
            </button>
          </>
        )}
      </div>
      <div className="scroll min-h-0 flex-1">
        {error ? (
          <div className="m-3 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[0.857rem] whitespace-pre-wrap text-danger-text">
            {error === 'python-missing' ? t('checks.pythonMissing') : error}
            {!project.kitInstalled && (
              <div className="mt-2">
                <button className="btn btn-secondary btn-sm h-7" onClick={() => void api.call('projects:installKit', project.id).then(() => run())}>
                  {t('checks.installKit')}
                </button>
              </div>
            )}
          </div>
        ) : !report ? (
          busy ? (
            <div className="grid place-items-center py-10 text-fg-3">
              <Spinner />
            </div>
          ) : (
            <div className="px-6 py-10 text-center text-[0.893rem] leading-relaxed text-fg-3">{t('checks.empty')}</div>
          )
        ) : (
          <>
            <ol className="m-0 list-none px-3 py-3">
              {report.stages.map((stage, i) => {
                const { icon: Icon, tone } = STATE[stage.state]
                return (
                  <li key={stage.id} className="relative flex gap-2.5 pb-3 last:pb-0">
                    {i < report.stages.length - 1 && <span className="absolute top-[18px] bottom-0 left-[7px] w-px bg-line" aria-hidden />}
                    <Icon size={15} className={`relative mt-[1px] shrink-0 bg-surface ${tone}`} aria-label={t(`checks.state.${stage.state}` as MessageKey)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.857rem] font-medium">{t(`checks.stage.${stage.id}` as MessageKey)}</div>
                      <div className="text-[0.786rem] leading-snug break-words text-fg-3">{stage.summary}</div>
                    </div>
                  </li>
                )
              })}
            </ol>
            <div className="flex flex-wrap items-center gap-1 border-y border-line px-3 py-2">
              {SEVERITIES.map((s) => {
                const n = report.counts[s]
                if (!n) return null
                const { icon: Icon, tone } = SEVERITY[s]
                return (
                  <button
                    key={s}
                    onClick={() => setFilter(filter === s ? null : s)}
                    aria-pressed={filter === s}
                    className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.786rem] transition-colors ${filter === s ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'}`}
                  >
                    <Icon size={12} className={filter === s ? '' : tone} /> {t(`checks.sev.${s}` as MessageKey)} {n}
                  </button>
                )
              })}
              {report.issues.length === 0 && <span className="text-[0.786rem] text-success">{t('checks.clean')}</span>}
              <span className="flex-1" />
              {actionable > 0 && (
                <button className="btn btn-secondary btn-sm h-6" onClick={() => insert(fixRequest(t, report))}>
                  <Wand2 size={12} /> {t('checks.askAgent')}
                </button>
              )}
            </div>
            <ul className="m-0 list-none p-0">
              {visible.map((issue, i) => (
                <IssueRow key={`${issue.code}-${issue.file}-${issue.line}-${i}`} issue={issue} />
              ))}
            </ul>
            <p className="m-0 px-3 py-3 text-[0.75rem] leading-snug text-fg-4">{t('checks.note')}</p>
          </>
        )}
      </div>
    </div>
  )
}
