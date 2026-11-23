import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import type { Artifact, ArtifactKind, ArtifactVersion, Project, VersionOrigin } from '@shared/types'
import { safeJoin } from './files'
import { isPlainId, readJson, writeAtomic } from './store'

/** Files larger than this are tracked by checksum only. */
const STORE_LIMIT = 25_000_000
const STREAM_THRESHOLD = 4_000_000
const MAX_HASH_SIZE = 200_000_000
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

type Fingerprint = { size: number; mtime: number; ctime?: number }
type Candidate = { rel: string; abs: string; stat: Fingerprint }

interface ProjectIndex {
  version: 1
  artifacts: Artifact[]
  /** Last observed size and mtime per path, so unchanged files are not re-hashed. */
  seen: Record<string, Fingerprint>
}

/**
 * Versioned history of a project's outputs. Each changed file becomes a new immutable version
 * with its bytes kept in a content-addressed blob store, plus who produced it and how sure
 * Studio is about that. Lives under the app's data folder, not in the project.
 */
export class ArtifactStore {
  private cache = new Map<string, ProjectIndex & { byPath: Map<string, Artifact> }>()

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private projectDir(projectId: string): string {
    if (!isPlainId(projectId)) throw new Error('Invalid project id')
    return join(this.dir, projectId)
  }

  private index(projectId: string) {
    let idx = this.cache.get(projectId)
    if (!idx) {
      const data = readJson<ProjectIndex>(join(this.projectDir(projectId), 'index.json'), { version: 1, artifacts: [], seen: {} })
      idx = { ...data, byPath: new Map(data.artifacts.map((a) => [a.rel, a])), seen: Object.assign(Object.create(null), data.seen) }
      this.cache.set(projectId, idx)
    }
    return idx
  }

  private save(projectId: string): void {
    const dir = this.projectDir(projectId)
    mkdirSync(dir, { recursive: true })
    const { version, artifacts, seen } = this.index(projectId)
    writeAtomic(join(dir, 'index.json'), JSON.stringify({ version, artifacts, seen }))
  }

  list(projectId: string): Artifact[] {
    return this.index(projectId).artifacts
  }

  get(projectId: string, artifactId: string): Artifact | undefined {
    return this.index(projectId).artifacts.find((a) => a.id === artifactId)
  }

  private blobPath(projectId: string, sha: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Invalid checksum')
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
        if (out.length >= SCAN_LIMIT) break
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        const abs = join(dir, name)
        let st
        try {
          st = lstatSync(abs)
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
    return this.captureFiles(project, rels, by)
  }

  /** The app streams larger files to avoid large synchronous reads on the main thread. */
  captureAvailable(project: Project, rels: string[] | 'scan', by: () => Attribution): Captured[] | Promise<Captured[]> {
    const large: Candidate[] = []
    const found = this.captureFiles(project, rels, by(), large)
    if (!large.length) return found
    return this.captureLarge(project, large, by).then((rest) => [...found, ...rest])
  }

  private same(a: Fingerprint | undefined, b: Fingerprint): boolean {
    return a?.size === b.size && a.mtime === b.mtime && a.ctime === b.ctime
  }

  private fingerprint(abs: string): Fingerprint | undefined {
    const stat = statSync(abs)
    return stat.isFile() ? { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs } : undefined
  }

  private captureFiles(project: Project, rels: string[] | 'scan', by: Attribution, large?: Candidate[]): Captured[] {
    const idx = this.index(project.id)
    const scan = rels === 'scan'
    const paths = scan ? this.walk(project.path) : [...new Set(rels)].filter((r) => artifactKind(r))
    const found: Captured[] = []
    const undo: (() => void)[] = []
    for (const rel of paths) {
      try {
        const abs = safeJoin(project.path, rel)
        const stat = this.fingerprint(abs)
        if (!stat || stat.size > MAX_HASH_SIZE) continue
        if (scan && this.same(idx.seen[rel], stat) && !idx.byPath.get(rel)?.missing) continue
        const candidate = { rel, abs, stat }
        if (large && stat.size > STREAM_THRESHOLD) {
          large.push(candidate)
          continue
        }
        const bytes = readFileSync(abs)
        if (bytes.length !== stat.size || !this.same(this.fingerprint(abs), stat)) continue
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        this.commit(project.id, candidate, sha256, bytes.length <= STORE_LIMIT ? bytes : undefined, by, found, undo)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') console.warn('could not capture artifact', rel, error)
      }
    }
    if (scan) {
      const present = new Set(paths)
      for (const artifact of idx.artifacts) {
        if (present.has(artifact.rel)) continue
        try {
          this.markMissing(artifact, !statSync(safeJoin(project.path, artifact.rel)).isFile(), undo)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') this.markMissing(artifact, true, undo)
        }
      }
    }
    this.persist(project.id, undo)
    return found
  }

  private async captureLarge(project: Project, files: Candidate[], by: () => Attribution): Promise<Captured[]> {
    const found: Captured[] = []
    for (const file of files) {
      const { abs, stat, rel } = file
      try {
        const hash = createHash('sha256')
        const chunks: Buffer[] = []
        let size = 0
        if (safeJoin(project.path, rel) !== abs) continue
        for await (const chunk of createReadStream(abs)) {
          size += chunk.length
          if (size > MAX_HASH_SIZE) break
          hash.update(chunk)
          if (stat.size <= STORE_LIMIT) chunks.push(chunk)
        }
        if (size !== stat.size || !this.same(this.fingerprint(safeJoin(project.path, rel)), stat)) continue
        const undo: (() => void)[] = []
        this.commit(project.id, file, hash.digest('hex'), chunks.length ? Buffer.concat(chunks) : undefined, by(), found, undo)
        this.persist(project.id, undo)
      } catch (error) {
        console.warn('could not capture large artifact', rel, error)
      }
    }
    return found
  }

  private markMissing(artifact: Artifact, missing: boolean, undo: (() => void)[]): void {
    const previous = artifact.missing
    if (previous === missing) return
    artifact.missing = missing
    undo.push(() => { artifact.missing = previous })
  }

  private commit(
    projectId: string, { rel, stat }: Candidate, sha256: string, bytes: Buffer | undefined, by: Attribution,
    found: Captured[], undo: (() => void)[]
  ): void {
    const idx = this.index(projectId)
    const existing = idx.byPath.get(rel)
    const latest = existing?.versions.at(-1)
    const previous = idx.seen[rel]
    if (latest?.sha256 !== sha256 && bytes) {
      const blob = this.blobPath(projectId, sha256)
      if (!existsSync(blob)) {
        mkdirSync(dirname(blob), { recursive: true })
        writeAtomic(blob, bytes)
      }
    }
    if (!this.same(previous, stat)) {
      idx.seen[rel] = stat
      undo.push(() => {
        if (previous) idx.seen[rel] = previous
        else delete idx.seen[rel]
      })
    }

    const now = Date.now()
    const artifact = existing ?? { id: randomUUID(), rel, kind: artifactKind(rel)!, createdAt: now, updatedAt: now, versions: [] }
    this.markMissing(artifact, false, undo)
    if (latest?.sha256 === sha256) return
    if (!existing) {
      idx.artifacts.push(artifact)
      idx.byPath.set(rel, artifact)
      undo.push(() => { idx.artifacts.pop(); idx.byPath.delete(rel) })
    }
    const version: ArtifactVersion = {
      ...by, v: (latest?.v ?? 0) + 1, sha256, size: stat.size, createdAt: now, stored: bytes !== undefined
    }
    const previousUpdate = artifact.updatedAt
    artifact.versions.push(version)
    artifact.updatedAt = now
    found.push({ artifact, version })
    undo.push(() => { artifact.versions.pop(); artifact.updatedAt = previousUpdate; found.pop() })
  }

  private persist(projectId: string, undo: (() => void)[]): void {
    if (!undo.length) return
    try {
      this.save(projectId)
    } catch (error) {
      undo.reverse().forEach((rollback) => rollback())
      console.warn('could not save artifact index', error)
    }
  }

  /** Write an earlier version back to disk as a new version, so history only grows. */
  restore(project: Project, artifactId: string, v: number): Captured | null {
    const artifact = this.get(project.id, artifactId)
    const bytes = this.read(project.id, artifactId, v)
    if (!artifact || !bytes) return null
    const abs = safeJoin(project.path, artifact.rel)
    // The bytes replace the file itself, never whatever a link there points to.
    if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${artifact.rel} is a symbolic link; restore it by hand.`)
    mkdirSync(dirname(abs), { recursive: true })
    writeAtomic(abs, bytes)
    return this.capture(project, [artifact.rel], { origin: 'user', restoredFrom: v })[0] ?? null
  }
}
