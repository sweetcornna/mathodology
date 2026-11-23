import { useEffect, useRef, useState } from 'react'
import { BookMarked, Check, CircleHelp, CircleX, CornerDownLeft, ExternalLink, GitFork, SearchCheck, TriangleAlert } from 'lucide-react'
import type { LitCitation, LitResult } from '@shared/types'
import { api } from '../../lib/api'
import { formatIpcError } from '../../lib/errors'
import { useT, type MessageKey } from '../../lib/i18n'
import { useStudio } from '../../store'
import { Spinner, Tip } from '../ui'
import { updateLitState, type LitState } from './state'

type Kind = NonNullable<LitResult['kind']>
const KIND_TONE: Record<Kind, string> = {
  published: 'bg-success-soft text-success-text',
  preprint: 'bg-warning-soft text-warning-text',
  dataset: 'bg-accent-soft text-accent-text',
  web: 'bg-surface-2 text-fg-3'
}

function KindBadge({ kind }: { kind?: Kind }) {
  const t = useT()
  if (!kind) return null
  return <span className={`rounded-[4px] px-1.5 text-[0.75rem] ${KIND_TONE[kind]}`}>{t(`lit.kind.${kind}` as MessageKey)}</span>
}

/** How the citation went: added, refused, unchecked or built from the search result alone. */
function CiteStatus({ cited }: { cited: LitCitation }) {
  const t = useT()
  if (cited.refused)
    return (
      <Tip label={cited.mismatch ? t('lit.refusedMismatch', { title: cited.mismatch }) : t('lit.refusedMissing')}>
        <span className="inline-flex items-center gap-1 text-[0.786rem] text-danger-text">
          <CircleX size={12} /> {t('lit.refused')}
        </span>
      </Tip>
    )
  const unchecked = cited.check?.state === 'unverifiable'
  return (
    <>
      {cited.retracted && (
        <span className="inline-flex items-center gap-1 rounded-[4px] bg-danger-soft px-1.5 text-[0.75rem] text-danger-text">
          <TriangleAlert size={11} /> {t('lit.retracted')}
        </span>
      )}
      {unchecked && (
        <Tip label={t('lit.uncheckedTip')}>
          <span className="inline-flex items-center gap-1 text-[0.75rem] text-warning-text">
            <CircleHelp size={11} /> {t('lit.unchecked')}
          </span>
        </Tip>
      )}
      <Tip label={[t(cited.added ? 'lit.added' : 'lit.already', { file: cited.file }), t(`lit.from.${cited.source}` as MessageKey)].join(' · ')}>
        <span className={`inline-flex items-center gap-1 text-[0.786rem] ${cited.source === 'search' ? 'text-warning-text' : 'text-success'}`}>
          <Check size={12} /> <span className="font-mono">{cited.key}</span>
        </span>
      </Tip>
    </>
  )
}

function CiteButton({ cited, onCite, small }: { cited?: LitCitation; onCite: () => Promise<void>; small?: boolean }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  if (cited) return <CiteStatus cited={cited} />
  return (
    <Tip label={t('lit.citeTip')}>
      <button
        className={`btn btn-secondary btn-sm ${small ? 'h-5 px-1.5 text-[0.75rem]' : 'h-6'}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await onCite().finally(() => {
            if (alive.current) setBusy(false)
          })
        }}
      >
        {busy ? <Spinner size={11} /> : <BookMarked size={small ? 11 : 12} />} {t('lit.cite')}
      </button>
    </Tip>
  )
}

function insertText(paper: LitResult, cited?: LitCitation): string {
  const id = paper.doi ? `https://doi.org/${paper.doi}` : paper.url
  return cited && !cited.refused ? `${paper.title} (${id}) [BibTeX: ${cited.key}]` : `${paper.title} (${id})`
}

/** One neighbour in a citation graph, citable in place. */
function GraphRow({ paper, cited, onCite }: { paper: LitResult; cited?: LitCitation; onCite: () => Promise<void> }) {
  const t = useT()
  const insert = useStudio((s) => s.insertIntoComposer)
  return (
    <li className="flex items-start gap-2 py-1">
      <div className="min-w-0 flex-1">
        <button className="text-left text-[0.82rem] leading-snug hover:text-accent-text" onClick={() => void api.call('shell:openExternal', paper.url)}>
          {paper.title}
        </button>
        <div className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-4">
          {paper.date && <span>{paper.date}</span>}
          {paper.citedBy !== undefined && <span>{t('lit.citedBy', { n: paper.citedBy.toLocaleString() })}</span>}
          {paper.retracted && <span className="text-danger-text">{t('lit.retracted')}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <CiteButton cited={cited} onCite={onCite} small />
        <Tip label={t('lit.insert')}>
          <button className="icon-btn-sm" aria-label={t('lit.insert')} onClick={() => insert(insertText(paper, cited))}>
            <CornerDownLeft size={12} />
          </button>
        </Tip>
      </div>
    </li>
  )
}

export function ResultCard({
  paper,
  state,
  projectCited,
  cite
}: {
  paper: LitResult
  state: LitState
  projectCited: Record<string, LitCitation>
  cite: (p: LitResult) => Promise<void>
}) {
  const t = useT()
  const insert = useStudio((s) => s.insertIntoComposer)
  const toast = useStudio((s) => s.showToast)
  const [finding, setFinding] = useState(false)
  const [graphBusy, setGraphBusy] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const cited = projectCited[paper.url]
  const published = state.published[paper.url]
  const graph = state.graphs[paper.url]
  const meta = [paper.byline, paper.date?.slice(0, 4), paper.citedBy !== undefined && !paper.byline?.match(/cited by/i) ? t('lit.citedBy', { n: paper.citedBy.toLocaleString() }) : '']
    .filter(Boolean)
    .join(' · ')

  const findPublished = async (): Promise<void> => {
    setFinding(true)
    try {
      const res = await api.call('lit:published', paper)
      updateLitState((prev) => ({
        ...prev,
        published: { ...prev.published, [paper.url]: res }
      }))
    } catch (err) {
      toast(formatIpcError(err), 'error')
    } finally {
      if (alive.current) setFinding(false)
    }
  }

  const toggleGraph = async (): Promise<void> => {
    if (graph || graphOpen) {
      setGraphOpen(!graphOpen)
      return
    }
    setGraphBusy(true)
    try {
      const res = await api.call('lit:graph', paper)
      updateLitState((prev) => ({
        ...prev,
        graphs: { ...prev.graphs, [paper.url]: res }
      }))
      if (alive.current) setGraphOpen(true)
    } catch (err) {
      toast(formatIpcError(err), 'error')
    } finally {
      if (alive.current) setGraphBusy(false)
    }
  }

  return (
    <article className="border-b border-line px-3 py-3 last:border-b-0">
      <button className="text-left text-[0.929rem] leading-snug font-medium hover:text-accent-text" onClick={() => void api.call('shell:openExternal', paper.url)}>
        {paper.title}
      </button>
      {meta && <div className="mt-0.5 truncate text-[0.786rem] text-fg-3">{meta}</div>}
      {paper.snippet && <p className="mt-1 mb-0 line-clamp-3 text-[0.857rem] leading-relaxed text-fg-2">{paper.snippet}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <KindBadge kind={paper.kind} />
        {paper.doi && <span className="chip text-fg-3">doi:{paper.doi}</span>}
        {paper.arxiv && <span className="chip text-fg-3">arXiv:{paper.arxiv}</span>}
        {paper.alts?.map((alt) => (
          <Tip key={alt.url} label={alt.url}>
            <button className="chip text-accent-text hover:bg-accent-soft" onClick={() => void api.call('shell:openExternal', alt.url)}>
              + {t(`lit.kind.${alt.kind}` as MessageKey)}
            </button>
          </Tip>
        ))}
        <span className="flex-1" />
        <CiteButton cited={cited} onCite={() => cite(paper)} />
        {paper.kind === 'preprint' && published === undefined && (
          <Tip label={t('lit.findPublished')}>
            <button className="icon-btn-sm" aria-label={t('lit.findPublished')} disabled={finding} onClick={() => void findPublished()}>
              {finding ? <Spinner size={12} /> : <SearchCheck size={13} />}
            </button>
          </Tip>
        )}
        {(paper.doi || paper.kind !== 'web') && (
          <Tip label={t('lit.graph')}>
            <button className={`icon-btn-sm ${graphOpen ? 'bg-surface-3' : ''}`} aria-label={t('lit.graph')} aria-expanded={graphOpen} disabled={graphBusy} onClick={() => void toggleGraph()}>
              {graphBusy ? <Spinner size={12} /> : <GitFork size={13} />}
            </button>
          </Tip>
        )}
        <Tip label={t('lit.insert')}>
          <button className="icon-btn-sm" aria-label={t('lit.insert')} onClick={() => insert(insertText(paper, cited))}>
            <CornerDownLeft size={13} />
          </button>
        </Tip>
        <Tip label={t('pane.openExternal')}>
          <button className="icon-btn-sm" aria-label={t('pane.openExternal')} onClick={() => void api.call('shell:openExternal', paper.url)}>
            <ExternalLink size={13} />
          </button>
        </Tip>
      </div>
      {published === null && <div className="mt-2 text-[0.786rem] text-fg-3">{t('lit.noPublished')}</div>}
      {published && (
        <div className="mt-2 rounded-[8px] bg-surface-2 px-2.5 py-2">
          <div className="mb-1 text-[0.75rem] text-success">{t('lit.publishedAs')}</div>
          <ul className="m-0 list-none p-0">
            <GraphRow paper={{ ...published, date: [published.byline, published.date].filter(Boolean).join(' · ') }} cited={projectCited[published.url]} onCite={() => cite(published)} />
          </ul>
        </div>
      )}
      {graphOpen && graph && (
        <div className="mt-2 flex flex-col gap-2 rounded-[8px] bg-surface-2 px-2.5 py-2">
          {(['references', 'citations'] as const).map((dir) => (
            <section key={dir}>
              <div className="text-[0.75rem] font-medium text-fg-3">
                {t(`lit.graph.${dir}` as MessageKey)} {graph[dir].length}
              </div>
              {graph[dir].length ? (
                <ul className="m-0 list-none p-0">
                  {graph[dir].map((p) => (
                    <GraphRow key={p.url} paper={p} cited={projectCited[p.url]} onCite={() => cite(p)} />
                  ))}
                </ul>
              ) : (
                <div className="py-1 text-[0.786rem] text-fg-4">{t('lit.graph.none')}</div>
              )}
            </section>
          ))}
          {graph.notes.length > 0 && <div className="text-[0.75rem] leading-snug text-fg-4">{graph.notes.join(' ')}</div>}
        </div>
      )}
    </article>
  )
}
