import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { safeJoin } from './files'
import { writeAtomic } from './store'

function confinedBibliography(root: string, rel: string): string {
  if (extname(rel).toLowerCase() !== '.bib') throw new Error('Not a bibliography file')
  const base = realpathSync(root)
  const abs = safeJoin(root, rel)
  let path = base
  for (const part of relative(safeJoin(root), abs).split(sep)) {
    path = join(path, part)
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Bibliography path is a symbolic link')
  }
  return path
}

/** Read and atomically replace a project bibliography in one synchronous edit. */
export function editBibliography<T>(root: string, rel: string, edit: (source: string) => { text?: string; result: T }): T {
  const path = confinedBibliography(root, rel)
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) throw new Error('Bibliography must be a regular file')
  const source = stat ? readFileSync(path, 'utf8') : ''
  const { text, result } = edit(source)
  if (text !== undefined && text !== source) {
    mkdirSync(dirname(path), { recursive: true })
    if (confinedBibliography(root, rel) !== path) throw new Error('Bibliography path changed')
    writeAtomic(path, text)
  }
  return result
}
