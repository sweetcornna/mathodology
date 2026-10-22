import { useState } from 'react'
import { BookMarked, Check, CircleHelp, CircleX, CornerDownLeft, ExternalLink, GitFork, Plug, Search, SearchCheck, TriangleAlert } from 'lucide-react'
import type { LitCitation, LitGraph, LitResult } from '@shared/types'
import { api } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { ReferencesView } from './References'
import { Segmented, Spinner, Tip } from './ui'

/** Source groups of the search connector that suit modeling work. */
const SOURCES = ['paper', 'paper.math', 'paper.preprint', 'paper.cs', 'paper.biomed', 'dataset'] as const

type Kind = NonNullable<LitResult['kind']>
const KIND_TONE: Record<Kind, string> = {
  published: 'bg-success-soft text-success-text',
  preprint: 'bg-warning-soft text-warning-text',
  dataset: 'bg-accent-soft text-accent-text',
  web: 'bg-surface-2 text-fg-3'
}

interface State {
  view: 'search' | 'refs'
  query: string
  source: (typeof SOURCES)[number]
  results: LitResult[] | null
  error: string | null
  /** Citations added in this window, by paper URL. */
  cited: Record<string, LitCitation>
  /** Published versions found for preprints, by preprint URL; null when none was found. */
  published: Record<string, LitResult | null>
  graphs: Record<string, LitGraph>
}

// Kept for the life of the window, so switching pane tabs does not lose a search.
let saved: State = { view: 'search', query: '', source: 'paper', results: null, error: null, cited: {}, published: {}, graphs: {} }

function clean(err: unknown): string {
  return String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
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
  if (cited) return <CiteStatus cited={cited} />
  return (
    <Tip label={t('lit.citeTip')}>
      <button
        className={`btn btn-secondary btn-sm ${small ? 'h-5 px-1.5 text-[0.75rem]' : 'h-6'}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await onCite().finally(() => setBusy(false))
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

function ResultCard({ paper, state, cite, patch }: { paper: LitResult; state: State; cite: (p: LitResult) => Promise<void>; patch: (p: Partial<State>) => void }) {
  const t = useT()
  const insert = useStudio((s) => s.insertIntoComposer)
  const toast = useStudio((s) => s.showToast)
  const [finding, setFinding] = useState(false)
  const [graphBusy, setGraphBusy] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const cited = state.cited[paper.url]
  const published = state.published[paper.url]
  const graph = state.graphs[paper.url]
  const meta = [paper.byline, paper.date?.slice(0, 4), paper.citedBy !== undefined && !paper.byline?.match(/cited by/i) ? t('lit.citedBy', { n: paper.citedBy.toLocaleString() }) : '']
    .filter(Boolean)
    .join(' · ')

  const findPublished = async (): Promise<void> => {
    setFinding(true)
    try {
      patch({ published: { ...saved.published, [paper.url]: await api.call('lit:published', paper) } })
    } catch (err) {
      toast(clean(err), 'error')
    } finally {
      setFinding(false)
    }
  }

  const toggleGraph = async (): Promise<void> => {
    if (graph || graphOpen) return setGraphOpen(!graphOpen)
    setGraphBusy(true)
    try {
      patch({ graphs: { ...saved.graphs, [paper.url]: await api.call('lit:graph', paper) } })
      setGraphOpen(true)
    } catch (err) {
      toast(clean(err), 'error')
    } finally {
      setGraphBusy(false)
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
            <GraphRow paper={{ ...published, date: [published.byline, published.date].filter(Boolean).join(' · ') }} cited={state.cited[published.url]} onCite={() => cite(published)} />
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
                    <GraphRow key={p.url} paper={p} cited={state.cited[p.url]} onCite={() => cite(p)} />
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

/**
 * Side-pane literature work: search through the search connector and add references whose DOI the
 * DOI system confirms, or check the project's bibliography against the registries.
 */
export function LiteratureTab() {
  const t = useT()
  const projectId = useStudio((s) => s.activeProjectId)
  const enabled = useStudio((s) => s.settings?.connectors.find((c) => c.builtin)?.enabled ?? false)
  const setDialog = useStudio((s) => s.setDialog)
  const toast = useStudio((s) => s.showToast)
  const [state, setStateRaw] = useState<State>(saved)
  const [loading, setLoading] = useState(false)
  const setState = (patch: Partial<State>): void =>
    setStateRaw((prev) => {
      saved = { ...prev, ...patch }
      return saved
    })

  const run = async (): Promise<void> => {
    const query = state.query.trim()
    if (!query || loading) return
    setLoading(true)
    setState({ error: null })
    try {
      setState({ results: await api.call('lit:search', query, state.source) })
    } catch (err) {
      setState({ results: null, error: clean(err) })
    } finally {
      setLoading(false)
    }
  }

  const cite = async (paper: LitResult): Promise<void> => {
    if (!projectId) return
    try {
      const c = await api.call('lit:cite', projectId, paper)
      setState({ cited: { ...saved.cited, [paper.url]: c } })
      if (c.refused) toast(c.mismatch ? t('lit.refusedMismatch', { title: c.mismatch }) : t('lit.refusedMissing'), 'error')
      else if (c.retracted) toast(t('lit.retractedToast', { key: c.key }), 'error')
      else if (c.check?.state === 'unverifiable') toast(t('lit.addedUnchecked', { file: c.file }), 'info')
      else toast(t(c.added ? 'lit.added' : 'lit.already', { file: c.file }), 'info')
    } catch (err) {
      toast(clean(err), 'error')
    }
  }

  const header = (
    <div className="border-b border-line px-3 pt-2.5">
      <Segmented
        value={state.view}
        onChange={(view) => setState({ view })}
        options={[
          { value: 'search', label: t('lit.view.search') },
          { value: 'refs', label: t('lit.view.refs') }
        ]}
      />
    </div>
  )

  if (state.view === 'refs')
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <ReferencesView />
      </div>
    )

  if (!enabled)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-[0.929rem] text-fg-3">
          {t('lit.disabled')}
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog('settings', 'connectors')}>
            <Plug size={13} /> {t('settings.connectors')}
          </button>
        </div>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <form
        className="flex flex-col gap-2 border-b border-line px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <label className="flex h-8 items-center gap-2 rounded-[8px] bg-surface-2 px-2.5">
          {loading ? <Spinner size={13} /> : <Search size={13} className="shrink-0 text-fg-3" />}
          <input
            value={state.query}
            onChange={(e) => setState({ query: e.target.value })}
            placeholder={t('lit.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-[0.893rem] outline-none placeholder:text-fg-3 focus-visible:shadow-none"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {SOURCES.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => setState({ source: src })}
              className={`h-6 rounded-full px-2.5 text-[0.786rem] transition-colors ${state.source === src ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'}`}
            >
              {t(`lit.src.${src}` as MessageKey)}
            </button>
          ))}
        </div>
      </form>
      <div className="scroll min-h-0 flex-1">
        {state.error ? (
          <div className="m-3 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[0.857rem] whitespace-pre-wrap text-danger-text">{state.error}</div>
        ) : loading && !state.results ? (
          <div className="px-6 py-10 text-center text-[0.893rem] text-fg-3">{t('lit.searching')}</div>
        ) : state.results === null ? (
          <div className="px-6 py-10 text-center text-[0.893rem] leading-relaxed text-fg-3">{t('lit.empty')}</div>
        ) : !state.results.length ? (
          <div className="px-6 py-10 text-center text-[0.893rem] text-fg-3">{t('palette.empty')}</div>
        ) : (
          <div className={loading ? 'opacity-50' : ''}>
            {state.results.map((p) => (
              <ResultCard key={p.url} paper={p} state={state} cite={cite} patch={setState} />
            ))}
            <p className="m-0 px-3 py-3 text-[0.75rem] leading-snug text-fg-4">{t('lit.note')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
