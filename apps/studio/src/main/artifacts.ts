import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import type { Artifact, ArtifactKind, ArtifactVersion, Project, VersionOrigin } from '@shared/types'
import { safeJoin } from './files'

/** Files larger than this are tracked by checksum only. */
const STORE_LIMIT = 25_000_000
const SCAN_LIMIT = 4000
const SKIP_DIRS = new Set([
  '.git', '.claude', '.codex', '.agents', '.gemini', '.venv', 'venv', 'node_modules', '__pycache__',
  '.ipynb_checkpoints', 'attachments', '.mathodology'
])
/** Kit files Studio writes itself; they are instructions, not outputs. */
const SKIP_ROOT = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json'])

const KIND_BY_EXT: Record<string, ArtifactKind> = {
  '.png': 'figure', '.jpg': 'figure', '.jpeg': 'figure', '.svg': 'figure', '.gif': 'figure', '.webp': 'figure', '.eps': 'figure',
  '.csv': 'table', '.tsv': 'table', '.xlsx': 'table', '.xls': 'table',
  '.md': 'document', '.tex': 'document', '.bib': 'document', '.txt': 'document', '.docx': 'document', '.html': 'document', '.pdf': 'document',
  '.py': 'code', '.ipynb': 'code', '.m': 'code', '.r': 'code', '.jl': 'code', '.sh': 'code', '.js': 'code', '.ts': 'code', '.cpp': 'code', '.c': 'code', '.sql': 'code',
  '.json': 'data', '.npy': 'data', '.npz': 'data', '.mat': 'data', '.parquet': 'data', '.h5': 'data', '.pkl': 'data', '.xml': 'data'
}

export function artifactKind(rel: string): ArtifactKind | null {
  const ext = extname(rel).toLowerCase()
  const kind = KIND_BY_EXT[ext]
  // A PDF in a figures folder is a figure; elsewhere it is usually the paper.
  if (ext === '.pdf' && /(^|\/)fig/i.test(rel)) return 'figure'
  return kind ?? null
}

export interface Attribution {
  origin: VersionOrigin
  sessionId?: string
  turnSeq?: number
  callId?: string
  tool?: string
  restoredFrom?: number
}

export interface Captured {
  artifact: Artifact
  version: ArtifactVersion
}

interface ProjectIndex {
  version: 1
  artifacts: Artifact[]
  /** Last observed size and mtime per path, so unchanged files are not re-hashed. */
  seen: Record<string, { size: number; mtime: number }>
}

/**
 * Versioned history of a project's outputs. Each changed file becomes a new immutable version
 * with its bytes kept in a content-addressed blob store, plus who produced it and how sure
 * Studio is about that. Lives under the app's data folder, not in the project.
 */
export class ArtifactStore {
  private cache = new Map<string, ProjectIndex>()

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private projectDir(projectId: string): string {
    return join(this.dir, projectId)
  }

  private index(projectId: string): ProjectIndex {
    let idx = this.cache.get(projectId)
    if (!idx) {
      try {
        idx = JSON.parse(readFileSync(join(this.projectDir(projectId), 'index.json'), 'utf8')) as ProjectIndex
      } catch {
        idx = { version: 1, artifacts: [], seen: {} }
      }
      this.cache.set(projectId, idx)
    }
    return idx
  }

  private save(projectId: string): void {
    const dir = this.projectDir(projectId)
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `index.json.${process.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(this.index(projectId)), 'utf8')
    renameSync(tmp, join(dir, 'index.json'))
  }

  list(projectId: string): Artifact[] {
    return this.index(projectId).artifacts
  }

  get(projectId: string, artifactId: string): Artifact | undefined {
    return this.index(projectId).artifacts.find((a) => a.id === artifactId)
  }

  private blobPath(projectId: string, sha: string): string {
    return join(this.projectDir(projectId), 'blobs', sha.slice(0, 2), sha)
  }

  /** The bytes of one version, when Studio stored them. */
  read(projectId: string, artifactId: string, v: number): Buffer | null {
    const version = this.get(projectId, artifactId)?.versions.find((x) => x.v === v)
    if (!version?.stored) return null
    try {
      return readFileSync(this.blobPath(projectId, version.sha256))
    } catch {
      return null
    }
  }

  /** Every trackable output in the project, relative paths with forward slashes. */
  private walk(root: string): string[] {
    const out: string[] = []
    const visit = (dir: string, depth: number): void => {
      if (depth > 6 || out.length >= SCAN_LIMIT) return
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        const abs = join(dir, name)
        let st
        try {
          st = statSync(abs)
        } catch {
          continue
        }
        const rel = relative(root, abs).split(sep).join('/')
        if (st.isDirectory()) visit(abs, depth + 1)
        else if (!(depth === 0 && SKIP_ROOT.has(name)) && artifactKind(rel)) out.push(rel)
      }
    }
    visit(root, 0)
    return out
  }

  /**
   * Record new versions of changed files. With `rels` only those paths are checked (a tool call
   * named them); with 'scan' the whole project is, and files that disappeared are marked missing.
   */
  capture(project: Project, rels: string[] | 'scan', by: Attribution): Captured[] {
    const idx = this.index(project.id)
    const scan = rels === 'scan'
    const paths = scan ? this.walk(project.path) : [...new Set(rels)].filter((r) => artifactKind(r))
    const found: Captured[] = []
    const now = Date.now()
    for (const rel of paths) {
      let abs: string
      let st
      try {
        abs = safeJoin(project.path, rel)
        st = statSync(abs)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      const prev = idx.seen[rel]
      let artifact = idx.artifacts.find((a) => a.rel === rel)
      if (artifact?.missing) artifact.missing = false
      // A tool call that named the file is checked even when size and mtime look unchanged.
      if (scan && prev && prev.size === st.size && prev.mtime === st.mtimeMs && artifact) continue
      idx.seen[rel] = { size: st.size, mtime: st.mtimeMs }
      if (st.size > 200_000_000) continue
      let bytes: Buffer
      try {
        bytes = readFileSync(abs)
      } catch {
        continue
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const latest = artifact?.versions[artifact.versions.length - 1]
      if (latest?.sha256 === sha256) continue
      const stored = bytes.length <= STORE_LIMIT
      if (stored) {
        const blob = this.blobPath(project.id, sha256)
        if (!existsSync(blob)) {
          mkdirSync(dirname(blob), { recursive: true })
          writeFileSync(blob, bytes)
        }
      }
      if (!artifact) {
        artifact = { id: randomUUID(), rel, kind: artifactKind(rel)!, createdAt: now, updatedAt: now, versions: [] }
        idx.artifacts.push(artifact)
      }
      const version: ArtifactVersion = {
        v: (latest?.v ?? 0) + 1,
        sha256,
        size: bytes.length,
        createdAt: now,
        origin: by.origin,
        sessionId: by.sessionId,
        turnSeq: by.turnSeq,
        callId: by.callId,
        tool: by.tool,
        stored,
        restoredFrom: by.restoredFrom
      }
      artifact.versions.push(version)
      artifact.updatedAt = now
      found.push({ artifact, version })
    }
    if (scan) {
      const present = new Set(paths)
      for (const a of idx.artifacts) if (!present.has(a.rel) && !a.missing) a.missing = true
    }
    if (found.length || scan) this.save(project.id)
    return found
  }

  /** Write an earlier version back to disk as a new version, so history only grows. */
  restore(project: Project, artifactId: string, v: number): Captured | null {
    const artifact = this.get(project.id, artifactId)
    const bytes = this.read(project.id, artifactId, v)
    if (!artifact || !bytes) return null
    const abs = safeJoin(project.path, artifact.rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
    return this.capture(project, [artifact.rel], { origin: 'user', restoredFrom: v })[0] ?? null
  }
}
