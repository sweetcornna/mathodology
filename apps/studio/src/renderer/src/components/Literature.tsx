import { useState } from 'react'
import { BookMarked, Check, CornerDownLeft, ExternalLink, Plug, Search, TriangleAlert } from 'lucide-react'
import type { LitCitation, LitResult } from '@shared/types'
import { api } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { Spinner, Tip } from './ui'

/** Source groups of the search connector that suit modeling work. */
const SOURCES = ['paper', 'paper.math', 'paper.preprint', 'paper.cs', 'paper.biomed', 'dataset'] as const

interface State {
  query: string
  source: (typeof SOURCES)[number]
  results: LitResult[] | null
  error: string | null
  /** Citations added in this window, by paper URL. */
  cited: Record<string, LitCitation>
}

// Kept for the life of the window, so switching pane tabs does not lose a search.
let saved: State = { query: '', source: 'paper', results: null, error: null, cited: {} }

function clean(err: unknown): string {
  return String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function ResultCard({ paper, cited, onCite }: { paper: LitResult; cited?: LitCitation; onCite: () => Promise<void> }) {
  const t = useT()
  const insert = useStudio((s) => s.insertIntoComposer)
  const [busy, setBusy] = useState(false)
  const meta = [paper.byline, paper.date?.slice(0, 4)].filter(Boolean).join(' · ')
  return (
    <article className="border-b border-line px-3 py-3 last:border-b-0">
      <button className="text-left text-[0.929rem] leading-snug font-medium hover:text-accent-text" onClick={() => void api.call('shell:openExternal', paper.url)}>
        {paper.title}
      </button>
      {meta && <div className="mt-0.5 truncate text-[0.786rem] text-fg-3">{meta}</div>}
      {paper.snippet && <p className="mt-1 mb-0 line-clamp-3 text-[0.857rem] leading-relaxed text-fg-2">{paper.snippet}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {paper.doi && <span className="chip text-fg-3">doi:{paper.doi}</span>}
        {paper.arxiv && <span className="chip text-fg-3">arXiv:{paper.arxiv}</span>}
        {cited?.retracted && (
          <span className="inline-flex items-center gap-1 rounded-[4px] bg-danger-soft px-1.5 text-[0.75rem] text-danger-text">
            <TriangleAlert size={11} /> {t('lit.retracted')}
          </span>
        )}
        <span className="flex-1" />
        {cited ? (
          <Tip label={t(cited.added ? 'lit.added' : 'lit.already', { file: cited.file })}>
            <span className="inline-flex items-center gap-1 text-[0.786rem] text-success">
              <Check size={12} /> <span className="font-mono">{cited.key}</span>
            </span>
          </Tip>
        ) : (
          <button
            className="btn btn-secondary btn-sm h-6"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onCite().finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner size={11} /> : <BookMarked size={12} />} {t('lit.cite')}
          </button>
        )}
        <Tip label={t('lit.insert')}>
          <button
            className="icon-btn-sm"
            aria-label={t('lit.insert')}
            onClick={() => insert(cited ? `${paper.title} (${paper.url}) [BibTeX: ${cited.key}]` : `${paper.title} (${paper.url})`)}
          >
            <CornerDownLeft size={13} />
          </button>
        </Tip>
        <Tip label={t('pane.openExternal')}>
          <button className="icon-btn-sm" aria-label={t('pane.openExternal')} onClick={() => void api.call('shell:openExternal', paper.url)}>
            <ExternalLink size={13} />
          </button>
        </Tip>
      </div>
    </article>
  )
}

/**
 * Side-pane literature search through the search connector: find papers, add verified BibTeX
 * to the project's bibliography, and hand references to the agent in the composer.
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
      toast(c.retracted ? t('lit.retractedToast', { key: c.key }) : t(c.added ? 'lit.added' : 'lit.already', { file: c.file }), c.retracted ? 'error' : 'info')
    } catch (err) {
      toast(clean(err), 'error')
    }
  }

  if (!enabled)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-[0.929rem] text-fg-3">
        {t('lit.disabled')}
        <button className="btn btn-secondary btn-sm" onClick={() => setDialog('settings', 'connectors')}>
          <Plug size={13} /> {t('settings.connectors')}
        </button>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
              <ResultCard key={p.url} paper={p} cited={state.cited[p.url]} onCite={() => cite(p)} />
            ))}
            <p className="m-0 px-3 py-3 text-[0.75rem] leading-snug text-fg-4">{t('lit.note')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
