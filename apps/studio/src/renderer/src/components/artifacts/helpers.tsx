import { useEffect, useState } from 'react'
import { BadgeCheck, Database, FileCode, FileImage, FileSpreadsheet, FileText, History, PenLine, Workflow } from 'lucide-react'
import type { Artifact, ArtifactKind, ArtifactVersion, FilePreview, VersionOrigin } from '@shared/types'
import { api, artifactUrl, fileUrl } from '../../lib/api'
import { useT, type MessageKey } from '../../lib/i18n'
import { useStudio } from '../../store'
import { Tip } from '../ui'

export const KINDS: ArtifactKind[] = ['figure', 'table', 'document', 'code', 'data']

export const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  figure: FileImage,
  table: FileSpreadsheet,
  document: FileText,
  code: FileCode,
  data: Database
}

export const ORIGIN_ICON: Record<VersionOrigin, typeof FileText> = {
  tool: BadgeCheck,
  turn: Workflow,
  user: History,
  external: PenLine
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

export function basename(rel: string): string {
  return rel.split('/').pop() ?? rel
}

export function dirname(rel: string): string {
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
}

export function latest(a: Artifact): ArtifactVersion {
  return a.versions[a.versions.length - 1]
}

export function stem(rel: string): string {
  return rel.replace(/\.[^./]+$/, '')
}

export function extension(rel: string): string {
  return rel.slice(rel.lastIndexOf('.') + 1).toUpperCase()
}

/** Image URL for a version: its stored bytes, or the file on disk when only a checksum was kept. */
export function thumbUrl(projectId: string, a: Artifact, v: ArtifactVersion): string | null {
  if (!IMAGE.test(a.rel)) return null
  return v.stored ? artifactUrl(projectId, a.id, v.v) : fileUrl(projectId, a.rel, v.createdAt)
}

export function useTimeAgo(): (ts: number) => string {
  const locale = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh-CN'))
  return (ts) => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const s = Math.round((ts - Date.now()) / 1000)
    if (Math.abs(s) < 60) return rtf.format(s, 'second')
    const m = Math.round(s / 60)
    if (Math.abs(m) < 60) return rtf.format(m, 'minute')
    const h = Math.round(m / 60)
    if (Math.abs(h) < 24) return rtf.format(h, 'hour')
    return rtf.format(Math.round(h / 24), 'day')
  }
}

export function OriginBadge({ origin, compact }: { origin: VersionOrigin; compact?: boolean }) {
  const t = useT()
  const Icon = ORIGIN_ICON[origin]
  const tone = origin === 'tool' ? 'text-success' : origin === 'turn' ? 'text-result' : 'text-fg-3'
  const label = t(`origin.${origin}` as MessageKey)
  return (
    <Tip label={t(`origin.${origin}.desc` as MessageKey)}>
      <span className="inline-flex shrink-0 items-center gap-1 text-[0.786rem] text-fg-3">
        <Icon size={12} className={tone} />
        {!compact && label}
      </span>
    </Tip>
  )
}

export function VersionTag({ v }: { v: number }) {
  return <span className="kbd shrink-0">v{v}</span>
}

interface IndexedArtifact {
  artifact: Artifact
  byV: Map<number, ArtifactVersion>
}

const artifactIndexCache = new WeakMap<Artifact[], Map<string, IndexedArtifact>>()

/** Build a shared O(1) lookup index per artifacts array so historical GeneratedRows avoid O(n^2) scans. */
export function getArtifactIndex(artifacts: Artifact[]): Map<string, IndexedArtifact> {
  const hit = artifactIndexCache.get(artifacts)
  if (hit) return hit
  const map = new Map<string, IndexedArtifact>()
  for (const artifact of artifacts) {
    const byV = new Map<number, ArtifactVersion>()
    for (const v of artifact.versions) byV.set(v.v, v)
    map.set(artifact.id, { artifact, byV })
  }
  artifactIndexCache.set(artifacts, map)
  return map
}

const MAX_VERSION_CACHE = 40
const versionCache = new Map<string, FilePreview>()
const inflightReads = new Map<string, Promise<FilePreview>>()

function versionKey(projectId: string, artifactId: string, v: number): string {
  return `${projectId}\0${artifactId}\0${v}`
}

function readArtifactVersion(projectId: string, artifactId: string, v: number): Promise<FilePreview> {
  const key = versionKey(projectId, artifactId, v)
  const cached = versionCache.get(key)
  if (cached) {
    versionCache.delete(key)
    versionCache.set(key, cached)
    return Promise.resolve(cached)
  }
  const existing = inflightReads.get(key)
  if (existing) return existing
  const p = api
    .call('artifacts:read', projectId, artifactId, v)
    .then((preview) => {
      inflightReads.delete(key)
      versionCache.set(key, preview)
      if (versionCache.size > MAX_VERSION_CACHE) {
        const oldest = versionCache.keys().next().value
        if (oldest !== undefined) versionCache.delete(oldest)
      }
      return preview
    })
    .catch((err) => {
      inflightReads.delete(key)
      throw err
    })
  inflightReads.set(key, p)
  return p
}

/** Shared version preview hook across Viewer and Compare, keyed by (projectId, artifactId, v). */
export function useArtifactVersion(
  projectId: string,
  artifactId: string,
  v: number | undefined,
  enabled = true
): FilePreview | null | 'error' {
  const cached = enabled && v !== undefined ? (versionCache.get(versionKey(projectId, artifactId, v)) ?? null) : null
  const [preview, setPreview] = useState<FilePreview | null | 'error'>(cached)

  useEffect(() => {
    if (!enabled || v === undefined) {
      setPreview(null)
      return
    }
    const key = versionKey(projectId, artifactId, v)
    const hit = versionCache.get(key)
    if (hit) {
      setPreview(hit)
      return
    }
    let alive = true
    setPreview(null)
    readArtifactVersion(projectId, artifactId, v)
      .then((p) => {
        if (alive) setPreview(p)
      })
      .catch(() => {
        if (alive) setPreview('error')
      })
    return () => {
      alive = false
    }
  }, [projectId, artifactId, v, enabled])

  return preview
}
