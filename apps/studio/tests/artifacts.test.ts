import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types'
import { ArtifactStore, artifactKind } from '../src/main/artifacts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, statSync: vi.fn(actual.statSync) }
})

const dirs: string[] = []
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'studio-art-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  vi.mocked(fs.statSync).mockReset()
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

function setup(): { store: ArtifactStore; project: Project; write: (rel: string, text: string) => void } {
  const root = temp()
  const project: Project = { id: 'p1', name: 'P', path: root, contest: 'MCM', createdAt: 0, kitInstalled: true }
  let tick = 1_700_000_000
  const write = (rel: string, text: string): void => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
    // Distinct mtimes so a scan notices each rewrite.
    tick += 10
    utimesSync(join(root, rel), tick, tick)
  }
  return { store: new ArtifactStore(temp()), project, write }
}

describe('artifact store', () => {
  it('classifies outputs and skips kit files', () => {
    expect(artifactKind('figures/a.png')).toBe('figure')
    expect(artifactKind('figures/b.pdf')).toBe('figure')
    expect(artifactKind('paper/paper.pdf')).toBe('document')
    expect(artifactKind('code/results.csv')).toBe('table')
    expect(artifactKind('notes.log')).toBeNull()
    const { store, project, write } = setup()
    write('AGENTS.md', 'kit')
    write('.claude/skills/x.md', 'kit')
    write('paper/draft.md', 'v1')
    expect(store.capture(project, 'scan', { origin: 'external' }).map((c) => c.artifact.rel)).toEqual(['paper/draft.md'])
  })

  it('adds a version only when content changes, with attribution', () => {
    const { store, project, write } = setup()
    write('code/model.py', 'a = 1')
    const [first] = store.capture(project, ['code/model.py'], { origin: 'tool', sessionId: 's', turnSeq: 3, callId: 'c1', tool: 'Write' })
    expect(first.version).toMatchObject({ v: 1, origin: 'tool', callId: 'c1', stored: true })
    expect(store.capture(project, 'scan', { origin: 'turn' })).toEqual([])
    write('code/model.py', 'a = 2')
    const [second] = store.capture(project, 'scan', { origin: 'turn', sessionId: 's', turnSeq: 5 })
    expect(second.version).toMatchObject({ v: 2, origin: 'turn', turnSeq: 5 })
    expect(store.read('p1', second.artifact.id, 1)?.toString()).toBe('a = 1')
  })

  it('restores an old version as a new one and marks deleted files missing', () => {
    const { store, project, write } = setup()
    write('paper/draft.md', 'first')
    store.capture(project, 'scan', { origin: 'external' })
    write('paper/draft.md', 'second')
    const [{ artifact }] = store.capture(project, 'scan', { origin: 'turn' })
    const restored = store.restore(project, artifact.id, 1)
    expect(restored?.version).toMatchObject({ v: 3, origin: 'user', restoredFrom: 1 })
    expect(readFileSync(join(project.path, 'paper/draft.md'), 'utf8')).toBe('first')
    rmSync(join(project.path, 'paper/draft.md'))
    store.capture(project, 'scan', { origin: 'external' })
    expect(store.get('p1', artifact.id)?.missing).toBe(true)
  })

  it('does not mark explicitly captured deep or excluded files missing after a scan', () => {
    const { store, project, write } = setup()
    const paths = ['a/b/c/d/e/f/g/deep.md', 'attachments/existing.md']
    for (const path of paths) write(path, 'still here')
    const captured = store.capture(project, paths, { origin: 'tool' })
    store.capture(project, 'scan', { origin: 'external' })
    for (const { artifact } of captured) expect(artifact.missing).toBe(false)
    rmSync(join(project.path, paths[0]))
    store.capture(project, 'scan', { origin: 'external' })
    expect(captured[0].artifact.missing).toBe(true)
    write(paths[0], 'returned')
    store.capture(project, 'scan', { origin: 'external' })
    expect(captured[0].artifact.missing).toBe(false)
  })

  it('does not mistake the scan file limit for deletion', () => {
    const { store, project, write } = setup()
    for (let i = 0; i < 4001; i++) write(`data/${String(i).padStart(4, '0')}.json`, '{}')
    const [{ artifact }] = store.capture(project, ['data/4000.json'], { origin: 'tool' })
    store.capture(project, 'scan', { origin: 'external' })
    expect(artifact.missing).toBe(false)
  })

  it('preserves the last known state when a tracked file cannot be inspected', () => {
    const { store, project, write } = setup()
    write('paper/draft.md', 'intact')
    const [{ artifact }] = store.capture(project, 'scan', { origin: 'external' })
    const stat = vi.mocked(fs.statSync).getMockImplementation()!
    vi.mocked(fs.statSync).mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
      if (String(path) === join(project.path, 'paper/draft.md')) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return (stat as (...args: unknown[]) => unknown)(path, ...args)
    }) as typeof fs.statSync)
    store.capture(project, 'scan', { origin: 'external' })
    expect(artifact.missing).not.toBe(true)
  })
})
