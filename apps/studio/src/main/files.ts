import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { FileEntry, FilePreview } from '@shared/types'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv', '.ipynb_checkpoints'])
const TEXT_LIMIT = 1_000_000
const IMAGE_LIMIT = 15_000_000

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}
const TEXT_EXT = new Set([
  '.txt', '.md', '.py', '.m', '.r', '.jl', '.ts', '.js', '.json', '.toml', '.yaml', '.yml', '.tex',
  '.bib', '.csv', '.tsv', '.ipynb', '.sh', '.html', '.css', '.cfg', '.ini', '.log', '.xml', '.sql'
])

/** Resolve `rel` inside `root`, refusing paths that escape it. */
export function safeJoin(root: string, rel = ''): string {
  const abs = resolve(root, rel)
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) throw new Error('Path outside project')
  return abs
}

export function listFiles(root: string, rel = ''): FileEntry[] {
  const dir = safeJoin(root, rel)
  const out: FileEntry[] = []
  for (const name of readdirSync(dir)) {
    if (HIDDEN.has(name)) continue
    const path = join(dir, name)
    try {
      const st = statSync(path)
      out.push({
        name,
        path,
        rel: relative(root, path).split(sep).join('/'),
        dir: st.isDirectory(),
        size: st.size,
        mtime: st.mtimeMs
      })
    } catch {
      // Broken symlinks and races with deletion are skipped.
    }
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export function previewFile(root: string, rel: string): FilePreview {
  const path = safeJoin(root, rel)
  const size = statSync(path).size
  const ext = extname(path).toLowerCase()
  if (IMAGE_TYPES[ext] && size > IMAGE_LIMIT) return { path, kind: 'too-large', size }
  if (ext === '.pdf') return { path, kind: 'pdf', size }
  if (!IMAGE_TYPES[ext] && size > TEXT_LIMIT) return { path, kind: 'too-large', size }
  return previewBytes(path, readFileSync(path))
}

/** Preview of file bytes that may not be on disk any more, such as a stored earlier version. */
export function previewBytes(path: string, buf: Buffer): FilePreview {
  const size = buf.length
  const ext = extname(path).toLowerCase()
  if (IMAGE_TYPES[ext]) {
    if (size > IMAGE_LIMIT) return { path, kind: 'too-large', size }
    return { path, kind: 'image', size, content: `data:${IMAGE_TYPES[ext]};base64,${buf.toString('base64')}` }
  }
  if (ext === '.pdf') return { path, kind: 'pdf', size }
  if (size > TEXT_LIMIT) return { path, kind: 'too-large', size }
  const looksText = TEXT_EXT.has(ext) || !buf.subarray(0, 8000).includes(0)
  if (!looksText) return { path, kind: 'binary', size }
  const content = buf.toString('utf8')
  const kind = ext === '.md' ? 'markdown' : ext === '.csv' || ext === '.tsv' ? 'csv' : 'text'
  return { path, kind, size, content }
}
