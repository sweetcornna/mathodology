import { useEffect, useState } from 'react'
import type { Artifact, ArtifactVersion, FilePreview } from '@shared/types'
import { computeUnifiedPatch, type PatchResult } from '../../lib/diff'
import { useT } from '../../lib/i18n'
import { DiffView, formatSize } from '../Preview'
import { Spinner } from '../ui'
import { basename, useArtifactVersion } from './helpers'

const TEXT_KINDS = new Set<FilePreview['kind']>(['text', 'markdown', 'csv'])

function pickDefaultBase(versions: ArtifactVersion[], targetV: number): number | undefined {
  const earlier = versions.filter((x) => x.v !== targetV)
  return earlier.filter((x) => x.v < targetV).pop()?.v ?? earlier[0]?.v
}

export function Compare({ projectId, a, v }: { projectId: string; a: Artifact; v: ArtifactVersion }) {
  const t = useT()
  const earlier = a.versions.filter((x) => x.v !== v.v)
  const [base, setBase] = useState<number | undefined>(() => pickDefaultBase(a.versions, v.v))
  const [forceFull, setForceFull] = useState(false)
  const [patchState, setPatchState] = useState<PatchResult | 'computing' | null>(null)

  useEffect(() => {
    setBase(pickDefaultBase(a.versions, v.v))
    setForceFull(false)
  }, [a.id, a.versions, v.v])

  const left = useArtifactVersion(projectId, a.id, base)
  const right = useArtifactVersion(projectId, a.id, v.v)
  const baseVersion = a.versions.find((x) => x.v === base)

  const textReady =
    left !== null &&
    right !== null &&
    left !== 'error' &&
    right !== 'error' &&
    TEXT_KINDS.has(left.kind) &&
    TEXT_KINDS.has(right.kind)

  const leftContent = textReady ? (left.content ?? '') : ''
  const rightContent = textReady ? (right.content ?? '') : ''

  useEffect(() => {
    if (!textReady) {
      setPatchState(null)
      return
    }
    let alive = true
    setPatchState('computing')
    void computeUnifiedPatch(basename(a.rel), leftContent, rightContent, forceFull).then((res) => {
      if (alive) setPatchState(res)
    })
    return () => {
      alive = false
    }
  }, [textReady, a.rel, leftContent, rightContent, forceFull])

  if (!earlier.length) return <div className="p-6 text-center text-[0.88rem] text-fg-3">{t('artifacts.firstVersion')}</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[0.857rem] text-fg-3">
        {t('artifacts.compareWith')}
        <select
          value={base}
          onChange={(e) => {
            setBase(Number(e.target.value))
            setForceFull(false)
          }}
          className="h-7 rounded-[6px] bg-surface-2 px-1.5 text-fg"
        >
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
      ) : textReady ? (
        patchState === 'computing' || patchState === null ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[0.857rem] text-fg-3">
            <Spinner />
            <span>{t('artifacts.diffComputing')}</span>
          </div>
        ) : patchState.tooLarge ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[0.88rem] text-fg-3">
            <p className="m-0">{t('artifacts.diffTooLarge')}</p>
            <button className="btn btn-secondary btn-sm" onClick={() => setForceFull(true)}>
              {t('artifacts.diffShowFull')}
            </button>
          </div>
        ) : (
          <div className="scroll min-h-0 flex-1 bg-[var(--code-bg)]">
            <DiffView text={patchState.patch ?? ''} className="" />
          </div>
        )
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
