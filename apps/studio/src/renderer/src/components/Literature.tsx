import { useEffect, useRef, useState } from 'react'
import { Plug, Search } from 'lucide-react'
import type { LitResult } from '@shared/types'
import { api } from '../lib/api'
import { formatIpcError } from '../lib/errors'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { ResultCard } from './literature/ResultCard'
import { getLitState, LIT_SOURCES, updateLitState, useLitState } from './literature/state'
import { ReferencesView } from './References'
import { Segmented, Spinner } from './ui'

const EMPTY_CITED = {}

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
  const state = useLitState()
  const [loading, setLoading] = useState(false)
  const searchGen = useRef(0)
  const activeProjectRef = useRef(projectId)
  activeProjectRef.current = projectId
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = async (): Promise<void> => {
    const cur = getLitState()
    const query = cur.query.trim()
    if (!query || loading) return
    const gen = ++searchGen.current
    setLoading(true)
    updateLitState((prev) => ({ ...prev, error: null }))
    try {
      const results = await api.call('lit:search', query, cur.source)
      if (searchGen.current !== gen) return
      updateLitState((prev) => ({ ...prev, results }))
    } catch (err) {
      if (searchGen.current !== gen) return
      updateLitState((prev) => ({ ...prev, results: null, error: formatIpcError(err) }))
    } finally {
      if (alive.current && searchGen.current === gen) setLoading(false)
    }
  }

  const cite = async (paper: LitResult): Promise<void> => {
    const targetProjectId = activeProjectRef.current
    if (!targetProjectId) return
    try {
      const c = await api.call('lit:cite', targetProjectId, paper)
      updateLitState((prev) => ({
        ...prev,
        citedByProject: {
          ...prev.citedByProject,
          [targetProjectId]: {
            ...(prev.citedByProject[targetProjectId] ?? {}),
            [paper.url]: c
          }
        }
      }))
      if (activeProjectRef.current !== targetProjectId) return
      if (c.refused) toast(c.mismatch ? t('lit.refusedMismatch', { title: c.mismatch }) : t('lit.refusedMissing'), 'error')
      else if (c.retracted) toast(t('lit.retractedToast', { key: c.key }), 'error')
      else if (c.check?.state === 'unverifiable') toast(t('lit.addedUnchecked', { file: c.file }), 'info')
      else toast(t(c.added ? 'lit.added' : 'lit.already', { file: c.file }), 'info')
    } catch (err) {
      toast(formatIpcError(err), 'error')
    }
  }

  const header = (
    <div className="border-b border-line px-3 pt-2.5">
      <Segmented
        value={state.view}
        onChange={(view) => updateLitState((prev) => ({ ...prev, view }))}
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

  const projectCited = projectId ? (state.citedByProject[projectId] ?? EMPTY_CITED) : EMPTY_CITED

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
            onChange={(e) => updateLitState((prev) => ({ ...prev, query: e.target.value }))}
            placeholder={t('lit.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-[0.893rem] outline-none placeholder:text-fg-3 focus-visible:shadow-none"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {LIT_SOURCES.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => updateLitState((prev) => ({ ...prev, source: src }))}
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
              <ResultCard key={p.url} paper={p} state={state} projectCited={projectCited} cite={cite} />
            ))}
            <p className="m-0 px-3 py-3 text-[0.75rem] leading-snug text-fg-4">{t('lit.note')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
