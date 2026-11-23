import { memo, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useT } from '../../lib/i18n'
import type { GeneratedFile } from '../../lib/transcript'
import { useStudio } from '../../store'
import { DiffStat } from '../Preview'
import { basename, dirname, extension, getArtifactIndex, KIND_ICON, stem, thumbUrl, VersionTag } from './helpers'

const EMPTY_THUMBS: (string | null)[] = []

/** A figure under a turn: its image, plus the same figure exported in other formats (PDF, EPS…). */
interface FigureGroup {
  image: GeneratedFile
  thumb: string
  formats: GeneratedFile[]
}

/**
 * What a turn produced, newest version of each, click to open. Figures come first as equal-size
 * thumbnails, one card per figure whatever formats it was exported in; every other file is a row
 * in one list, so the block keeps a tidy shape however many files there are.
 */
export const GeneratedRow = memo(function GeneratedRow({ files }: { files: GeneratedFile[] }) {
  const t = useT()
  const projectId = useStudio((s) => s.activeProjectId)
  const open = useStudio((s) => s.openArtifact)
  const thumbs = useStudio(
    useShallow((s) => {
      if (!s.activeProjectId) return EMPTY_THUMBS
      const index = getArtifactIndex(s.artifacts)
      return files.map((f) => {
        const entry = index.get(f.artifactId)
        const version = entry?.byV.get(f.v)
        return entry && version ? thumbUrl(s.activeProjectId!, entry.artifact, version) : null
      })
    })
  )
  const [all, setAll] = useState(false)
  const LIMIT = 6

  const { figures, rest } = useMemo(() => {
    const figures: FigureGroup[] = []
    const byStem = new Map<string, FigureGroup>()
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const thumb = thumbs[i] ?? null
      if (!thumb || byStem.has(stem(f.rel))) continue
      const group = { image: f, thumb, formats: [f] }
      byStem.set(stem(f.rel), group)
      figures.push(group)
    }
    const rest: GeneratedFile[] = []
    for (const f of files) {
      const group = byStem.get(stem(f.rel))
      if (group?.image === f) continue
      if (group && f.kind === 'figure') group.formats.push(f)
      else rest.push(f)
    }
    return { figures, rest }
  }, [files, thumbs])

  if (!projectId) return null
  const hidden = Math.max(0, figures.length - LIMIT) + Math.max(0, rest.length - LIMIT)
  const shownFigures = all ? figures : figures.slice(0, LIMIT)
  const shownRest = all ? rest : rest.slice(0, LIMIT)
  return (
    <div className="flex max-w-[560px] flex-col gap-2 rise-in">
      <div className="text-[0.857rem] text-fg-3">{t('artifacts.generated', { n: files.length })}</div>
      {shownFigures.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-2">
          {shownFigures.map(({ image, thumb, formats }) => (
            <div key={image.artifactId} className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong),var(--shadow-md)]">
              <button title={image.rel} onClick={() => open(image.artifactId, image.v)} className="grid aspect-[4/3] place-items-center overflow-hidden border-b border-line bg-white">
                <img src={thumb} loading="lazy" className="h-full w-full object-contain p-1" alt={basename(image.rel)} />
              </button>
              <div className="flex h-8 items-center gap-1 px-2 text-[0.857rem]">
                <span className="min-w-0 flex-1 truncate" title={image.rel}>
                  {basename(stem(image.rel))}
                </span>
                {formats.map((f) => (
                  <button key={f.artifactId} title={f.rel} onClick={() => open(f.artifactId, f.v)} className="kbd shrink-0 hover:bg-surface-3">
                    {extension(f.rel)}
                    {f.v > 1 && ` v${f.v}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {shownRest.length > 0 && (
        <div className="card divide-y divide-line overflow-hidden">
          {shownRest.map((f) => {
            const Icon = KIND_ICON[f.kind]
            return (
              <button key={f.artifactId} title={f.rel} onClick={() => open(f.artifactId, f.v)} className="flex h-9 w-full items-center gap-2 px-2.5 text-left text-[0.857rem] hover:bg-surface-2">
                <Icon size={15} className="shrink-0 text-fg-3" />
                <span className="min-w-0 truncate">{basename(f.rel)}</span>
                {dirname(f.rel) && <span className="min-w-0 flex-1 truncate text-[0.786rem] text-fg-3">{dirname(f.rel)}</span>}
                {!dirname(f.rel) && <span className="flex-1" />}
                {f.added !== undefined && (f.added > 0 || (f.removed ?? 0) > 0) && <DiffStat added={f.added} removed={f.removed ?? 0} />}
                {f.v > 1 && <VersionTag v={f.v} />}
              </button>
            )
          })}
        </div>
      )}
      {hidden > 0 && (
        <button className="self-start text-[0.857rem] text-fg-2 hover:text-fg" onClick={() => setAll((v) => !v)}>
          {all ? t('changes.less') : t('artifacts.more', { n: hidden })}
        </button>
      )}
    </div>
  )
})
