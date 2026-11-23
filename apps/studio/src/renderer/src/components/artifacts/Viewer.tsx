import { useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, CornerDownLeft, ExternalLink, RotateCcw } from 'lucide-react'
import type { Artifact } from '@shared/types'
import { api, artifactUrl, fileUrl } from '../../lib/api'
import { formatIpcError } from '../../lib/errors'
import { useT, type MessageKey } from '../../lib/i18n'
import { openPath } from '../../lib/open'
import { useStudio } from '../../store'
import { PreviewBody } from '../Preview'
import { Spinner, Tip } from '../ui'
import { Compare } from './Compare'
import { basename, dirname, latest, OriginBadge, useArtifactVersion, useTimeAgo } from './helpers'
import { Provenance } from './Provenance'

type ViewTab = 'preview' | 'compare' | 'provenance'

export function Viewer({ projectId, a, initial }: { projectId: string; a: Artifact; initial?: number }) {
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
  const preview = useArtifactVersion(projectId, a.id, v.v, tab === 'preview')
  const go = (i: number): void => open(a.id, a.versions[i]?.v)

  const restore = async (): Promise<void> => {
    const ok = await confirm({
      title: t('artifacts.restore'),
      body: t('artifacts.restoreConfirm', { v: v.v, rel: a.rel, n: newest.v + 1 })
    })
    if (!ok) return
    try {
      const next = await api.call('artifacts:restore', projectId, a.id, v.v)
      if (next) {
        open(a.id, latest(next).v)
        toast(t('artifacts.restored', { n: latest(next).v }))
      }
    } catch (err) {
      toast(formatIpcError(err), 'error')
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
            <button className="icon-btn-sm" onClick={() => openPath(`${projectPath}/${a.rel}`)}>
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
