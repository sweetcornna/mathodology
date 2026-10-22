import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { ArtifactStore } from '../src/main/artifacts'
import { listFiles, previewFile, safeJoin, within } from '../src/main/files'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function temp(): string {
  // Under tmpdir(), which on macOS is itself behind a link (/var → /private/var).
  const d = mkdtempSync(join(tmpdir(), 'studio-files-'))
  dirs.push(d)
  return d
}

/** A project with a secret file next to it and links that lead out of it. */
function setup(): { root: string; outside: string } {
  const root = temp()
  const outside = temp()
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  mkdirSync(join(root, 'figures'))
  writeFileSync(join(root, 'figures/a.csv'), 'x,y\n1,2\n')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'figures/leak.txt'))
  symlinkSync(outside, join(root, 'data'))
  symlinkSync(join(outside, 'missing.txt'), join(root, 'dangling.txt'))
  symlinkSync('a.csv', join(root, 'figures/latest.csv'))
  return { root, outside }
}

describe('safeJoin', () => {
  it('refuses paths that leave the project, by name or through a link', () => {
    const { root, outside } = setup()
    expect(() => safeJoin(root, '../x')).toThrow('Path outside project')
    expect(() => safeJoin(root, 'figures/leak.txt')).toThrow('Path outside project')
    expect(() => safeJoin(root, 'data/secret.txt')).toThrow('Path outside project')
    // Not created yet, but its parent is a link out of the project.
    expect(() => safeJoin(root, 'data/new/out.png')).toThrow('Path outside project')
    // A dangling link would be written through to wherever it points.
    expect(() => safeJoin(root, 'dangling.txt')).toThrow('Path outside project')
    expect(within(root, join(outside, 'secret.txt'))).toBe(false)
  })

  it('accepts project paths, links inside the project and files not created yet', () => {
    const { root } = setup()
    expect(safeJoin(root, 'figures/a.csv')).toBe(join(root, 'figures/a.csv'))
    expect(safeJoin(root, 'figures/latest.csv')).toBe(join(root, 'figures/latest.csv'))
    expect(safeJoin(root, 'paper/new/draft.md')).toBe(join(root, 'paper/new/draft.md'))
    expect(safeJoin(root)).toBe(root)
    expect(within(root, join(root, 'figures/a.csv'))).toBe(true)
  })

  it('does not preview or list through a link out of the project', () => {
    const { root } = setup()
    expect(() => previewFile(root, 'figures/leak.txt')).toThrow('Path outside project')
    expect(() => listFiles(root, 'data')).toThrow('Path outside project')
    expect(previewFile(root, 'figures/latest.csv')).toMatchObject({ kind: 'csv', content: 'x,y\n1,2\n' })
  })
})

describe('artifacts and links', () => {
  it('does not capture files reached through a link out of the project', () => {
    const { root } = setup()
    const project: Project = { id: 'p1', name: 'P', path: root, contest: 'MCM', createdAt: 0, kitInstalled: true }
    const store = new ArtifactStore(temp())
    const rels = store.capture(project, 'scan', { origin: 'external' }).map((c) => c.artifact.rel)
    expect(rels).toContain('figures/a.csv')
    expect(rels.some((r) => r.includes('secret') || r.includes('leak'))).toBe(false)
  })

  it('refuses to restore through a link', () => {
    const { root, outside } = setup()
    const project: Project = { id: 'p1', name: 'P', path: root, contest: 'MCM', createdAt: 0, kitInstalled: true }
    const store = new ArtifactStore(temp())
    writeFileSync(join(root, 'figures/b.csv'), 'old')
    const [{ artifact }] = store.capture(project, ['figures/b.csv'], { origin: 'external' })
    writeFileSync(join(root, 'figures/b.csv'), 'new')
    utimesSync(join(root, 'figures/b.csv'), 1_700_000_100, 1_700_000_100)
    store.capture(project, ['figures/b.csv'], { origin: 'external' })
    // Replaced by a link to another project file: the bytes would land there, so it is refused.
    rmSync(join(root, 'figures/b.csv'))
    symlinkSync(join(root, 'figures/a.csv'), join(root, 'figures/b.csv'))
    expect(() => store.restore(project, artifact.id, 1)).toThrow('symbolic link')
    expect(readFileSync(join(root, 'figures/a.csv'), 'utf8')).toBe('x,y\n1,2\n')
    rmSync(join(root, 'figures/b.csv'))
    symlinkSync(join(outside, 'secret.txt'), join(root, 'figures/b.csv'))
    expect(() => store.restore(project, artifact.id, 1)).toThrow()
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
  })
})
