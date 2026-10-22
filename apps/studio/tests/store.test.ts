import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { ArtifactStore } from '../src/main/artifacts'
import { isPlainId, readJson, Store, writeAtomic } from '../src/main/store'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'studio-store-'))
  dirs.push(d)
  return d
}

const project: Project = { id: 'p1', name: 'P', path: '/nowhere', contest: 'MCM', createdAt: 0, kitInstalled: false }

describe('state files', () => {
  it('keeps a file it cannot parse aside instead of starting over silently', () => {
    const dir = temp()
    writeFileSync(join(dir, 'state.json'), '{"version":1,"projects":[{"id":')
    const store = new Store(dir)
    expect(store.projects).toEqual([])
    const kept = readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(dir, kept[0]), 'utf8')).toBe('{"version":1,"projects":[{"id":')
    // A missing file is no corruption.
    expect(readJson(join(dir, 'settings.json'), { a: 1 })).toEqual({ a: 1 })
    expect(readdirSync(dir).filter((f) => f.includes('corrupt'))).toHaveLength(1)
  })

  it('keeps a corrupt artifact index aside too', () => {
    const dir = temp()
    mkdirSync(join(dir, 'p1'))
    writeFileSync(join(dir, 'p1/index.json'), '{ torn')
    expect(new ArtifactStore(dir).list('p1')).toEqual([])
    expect(readdirSync(join(dir, 'p1')).some((f) => f.startsWith('index.json.corrupt-'))).toBe(true)
  })

  it('writes atomically', () => {
    const path = join(temp(), 'x.json')
    writeAtomic(path, '{"a":1}')
    writeAtomic(path, '{"a":2}')
    expect(readJson(path, {})).toEqual({ a: 2 })
    expect(readdirSync(join(path, '..'))).toEqual(['x.json'])
  })
})

describe('ids as file names', () => {
  it('accepts only plain ids', () => {
    expect(isPlainId('3f1c2d4e-0b6a-4c1e-9a77-2f1d3c4b5a69')).toBe(true)
    for (const bad of ['', '..', '../state', 'a/b', 'a\\b', 'a.json', 1, null]) expect(isPlainId(bad)).toBe(false)
  })

  it('never deletes or reads files outside the events folder', () => {
    const dir = temp()
    const store = new Store(dir)
    writeFileSync(join(dir, 'victim.jsonl'), '{"kind":"notice"}\n')
    store.removeSession('../victim')
    expect(existsSync(join(dir, 'victim.jsonl'))).toBe(true)
    expect(() => store.events('../victim')).toThrow('Invalid session id')
  })

  it('does not look up artifacts or blobs by path-like ids', () => {
    const dir = temp()
    writeFileSync(join(dir, 'secret'), 'secret')
    mkdirSync(join(dir, 'p1'))
    const version = { v: 1, sha256: '../../secret', size: 6, createdAt: 0, origin: 'external', stored: true }
    const index = { version: 1, artifacts: [{ id: 'a1', rel: 'x.png', kind: 'figure', createdAt: 0, updatedAt: 0, versions: [version] }], seen: {} }
    writeFileSync(join(dir, 'p1/index.json'), JSON.stringify(index))
    const artifacts = new ArtifactStore(dir)
    expect(artifacts.read('p1', 'a1', 1)).toBeNull()
    expect(() => artifacts.get('../p1', 'a1')).toThrow('Invalid project id')
  })
})

describe('events of deleted sessions', () => {
  it('records nothing for a session that is gone', () => {
    const dir = temp()
    const store = new Store(dir)
    store.upsertProject(project)
    const session = { id: 's1', projectId: 'p1', title: '', agent: 'claude', permissionMode: 'ask', createdAt: 0, updatedAt: 0, pinned: false, archived: false, status: 'idle', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 } } as const
    store.upsertSession({ ...session })
    store.record('s1', { kind: 'notice', level: 'info', text: 'a' })
    expect(store.events('s1')).toHaveLength(1)
    store.removeSession('s1')
    store.record('s1', { kind: 'turn.completed', ok: false, summary: 'interrupted' })
    expect(existsSync(join(dir, 'events/s1.jsonl'))).toBe(false)
    store.flush()
  })
})
