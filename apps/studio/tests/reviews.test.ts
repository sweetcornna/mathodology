import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Review, Session, SessionEvent, SessionEventBody, Settings } from '../src/shared/types'
import type { Turn, TurnSink } from '../src/main/agents/base'
import { clearDoiCache, type Fetcher } from '../src/main/refcheck'
import { buildDigest, parseReview, ReviewManager } from '../src/main/reviews'
import type { Store } from '../src/main/store'

// The reviewing agent and its environment are stand-ins; each test sets what they do.
const fake = vi.hoisted(() => ({
  env: (): Promise<NodeJS.ProcessEnv> => Promise.resolve({}),
  start: (_req: unknown, _sink: TurnSink): Turn => {
    throw new Error('no agent in this test')
  }
}))
vi.mock('../src/main/agents/detect', () => ({ agentEnv: () => fake.env(), resolveBinary: () => '/usr/bin/agent' }))
vi.mock('../src/main/sessions', () => ({ ADAPTERS: { claude: { name: 'Claude Code', start: (req: unknown, sink: TurnSink) => fake.start(req, sink) } } }))

const project: Project = { id: 'p', name: 'Demo', path: '/tmp/demo', contest: 'MCM', createdAt: 0, kitInstalled: true }
const session = { id: 's', projectId: 'p', agent: 'claude', model: 'opus' } as Session

function events(bodies: SessionEventBody[]): SessionEvent[] {
  return bodies.map((b, i) => ({ ...b, sessionId: 's', seq: i + 1, ts: i }) as SessionEvent)
}

describe('buildDigest', () => {
  it('records prompts, calls with outcomes, replies and produced files per turn', () => {
    const digest = buildDigest(
      session,
      project,
      events([
        { kind: 'user.message', text: 'Fit the model', attachments: [] },
        { kind: 'tool.call', callId: 'c1', name: 'Bash', toolKind: 'shell', title: 'run', input: { command: 'python fit.py' } },
        { kind: 'tool.result', callId: 'c1', output: 'Traceback: boom', isError: true },
        { kind: 'tool.call', callId: 't', name: 'TodoWrite', toolKind: 'todo', title: '', input: {} },
        { kind: 'assistant.text', blockId: 'b', text: 'The fit converged with R² = 0.98.' },
        { kind: 'artifact.version', artifactId: 'a', rel: 'figures/fit.png', v: 2, origin: 'turn', artifactKind: 'figure' },
        { kind: 'turn.completed', ok: true }
      ])
    )
    expect(digest).toContain('## Turn 1')
    expect(digest).toContain('User: Fit the model')
    expect(digest).toContain('[call:c1] Bash `python fit.py` → FAILED')
    expect(digest).toContain('output: Traceback: boom')
    expect(digest).not.toContain('TodoWrite')
    expect(digest).toContain('Agent: The fit converged')
    expect(digest).toContain('produced figures/fit.png v2 (turn)')
  })

  it('drops the oldest turns first when the record is too long', () => {
    const bodies: SessionEventBody[] = []
    for (let i = 1; i <= 20; i++)
      bodies.push(
        { kind: 'user.message', text: `prompt ${i}`, attachments: [] },
        { kind: 'assistant.text', blockId: `b${i}`, text: 'x'.repeat(10_000) },
        { kind: 'turn.completed', ok: true }
      )
    const digest = buildDigest(session, project, events(bodies))
    expect(digest.length).toBeLessThan(65_000)
    expect(digest).toContain('User: prompt 20')
    expect(digest).not.toContain('User: prompt 1\n')
    expect(digest).toMatch(/\d+ earlier turn\(s\) omitted/)
  })
})

describe('parseReview', () => {
  it('reads the fenced JSON block, sorts by severity and normalises fields', () => {
    const reply = [
      'I checked the run.',
      '```json',
      JSON.stringify({
        summary: 'Mostly fine.',
        findings: [
          { severity: 'pass', title: 'Figure exists', detail: 'ok', evidence: ['figures/fit.png'] },
          { severity: 'fail', title: 'Fit did not run', detail: 'Traceback', evidence: ['call:c1', 3], suggestion: 'Fix the import' },
          { severity: 'bogus', title: 'Units', detail: '' },
          { detail: 'no title' }
        ]
      }),
      '```'
    ].join('\n')
    const parsed = parseReview(reply)!
    expect(parsed.summary).toBe('Mostly fine.')
    expect(parsed.findings.map((f) => f.severity)).toEqual(['fail', 'inconclusive', 'pass'])
    expect(parsed.findings[0].evidence).toEqual(['call:c1'])
    expect(parsed.findings[0].suggestion).toBe('Fix the import')
    expect(parsed.findings.every((f) => f.status === 'open' && f.id)).toBe(true)
  })

  it('falls back to a bare object and rejects replies without findings', () => {
    expect(parseReview('Result: {"summary":"s","findings":[]} done')?.findings).toEqual([])
    expect(parseReview('No JSON here')).toBeNull()
    expect(parseReview('```json\n{"summary":"x"}\n```')).toBeNull()
  })
})

describe('ReviewManager', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  let sessionEvents: SessionEvent[] = []
  let deleted = false
  beforeEach(() => {
    clearDoiCache()
    sessionEvents = []
    deleted = false
    fake.env = () => Promise.resolve({})
  })
  const settings = { locale: 'en', agents: { claude: { defaultModel: '' } } } as unknown as Settings
  const store = { session: () => (deleted ? undefined : session), project: () => project, events: () => sessionEvents } as unknown as Store
  const offline: Fetcher = async () => ({ status: 404, ok: false, text: async () => '' })

  function manager(fetch = offline): { reviews: ReviewManager; seen: Review[]; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'studio-reviews-'))
    dirs.push(dir)
    const seen: Review[] = []
    return { reviews: new ReviewManager(dir, store, () => settings, { changed: (r) => seen.push(r) }, fetch), seen, dir }
  }
  const ended = (seen: Review[]): Promise<Review> =>
    vi.waitFor(() => {
      const last = seen.at(-1)
      if (!last || last.status === 'running') throw new Error('still running')
      return last
    })
  /** A turn that ends when interrupted, unless it ignores interrupts. */
  function turnFor(sink: TurnSink, ignoresInterrupt = false): Turn {
    let end!: () => void
    const done = new Promise<void>((r) => (end = r))
    return {
      interrupt: () => {
        if (ignoresInterrupt) return
        sink.emit({ kind: 'turn.completed', ok: false, summary: 'interrupted' })
        end()
      },
      respondPermission: () => undefined,
      done
    }
  }

  it('marks reviews left running by a quit or crash as stopped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-reviews-'))
    dirs.push(dir)
    writeFileSync(join(dir, 's.json'), JSON.stringify([{ id: 'old', sessionId: 's', status: 'running', findings: [] }, { id: 'ok', sessionId: 's', status: 'done', findings: [] }]))
    const reviews = new ReviewManager(dir, store, () => settings, { changed: () => undefined }, offline)
    expect(reviews.list('s').map((r) => [r.id, r.status])).toEqual([
      ['old', 'cancelled'],
      ['ok', 'done']
    ])
    expect(reviews.list('s')[0].error).toMatch(/closed/)
  })

  it('honours a cancel that arrives while the agent environment is read', async () => {
    let release!: (env: NodeJS.ProcessEnv) => void
    fake.env = () => new Promise((r) => (release = r))
    const start = vi.fn()
    fake.start = start
    const { reviews, seen } = manager()
    const review = await reviews.start('s')
    await vi.waitFor(() => expect(release).toBeDefined())
    reviews.cancel(review.id)
    release({})
    expect((await ended(seen)).status).toBe('cancelled')
    expect(start).not.toHaveBeenCalled()
  })

  it('stops a running review and leaves no file when its session is deleted', async () => {
    let started = false
    let interrupted = false
    fake.start = (_req, sink) => {
      started = true
      const turn = turnFor(sink)
      return { ...turn, interrupt: () => ((interrupted = true), turn.interrupt()) }
    }
    const { reviews, dir } = manager()
    await reviews.start('s')
    await vi.waitFor(() => expect(started).toBe(true))
    expect(existsSync(join(dir, 's.json'))).toBe(true)
    deleted = true
    reviews.remove('s')
    await vi.waitFor(() => expect(interrupted).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(join(dir, 's.json'))).toBe(false)
  })

  it('records an error instead of staying running when the run throws', async () => {
    fake.start = () => {
      throw new Error('spawn EACCES')
    }
    const { reviews, seen } = manager()
    await reviews.start('s')
    expect(await ended(seen)).toMatchObject({ status: 'error', error: 'spawn EACCES' })
  })

  it('keeps the citation findings made before the trace was stopped', async () => {
    sessionEvents = events([{ kind: 'assistant.text', blockId: 'b', text: 'Sources: 10.1000/fake and 10.1000/slow.' }])
    let review: Review | undefined
    const { reviews, seen } = manager(async (url) => {
      const answer = (status: number, body: unknown) => ({ status, ok: status === 200, text: async () => JSON.stringify(body) })
      if (url.includes('/ra/10.1000/fake')) return answer(200, [{ status: 'DOI does not exist' }])
      // The other registry never answers; cancelling stops the wait as the time limit would.
      if (url.includes('/ra/10.1000/slow')) {
        reviews.cancel(review!.id)
        return new Promise(() => undefined)
      }
      return answer(404, {})
    })
    review = await reviews.start('s')
    const last = await ended(seen)
    expect(last.status).toBe('cancelled')
    expect(last.findings.map((f) => [f.severity, f.title])).toEqual([
      ['fail', 'DOI does not exist: 10.1000/fake'],
      ['inconclusive', 'DOI lookups timed out']
    ])
  })

  it('saves on shutdown that running reviews stopped', async () => {
    let started = false
    fake.start = (_req, sink) => {
      started = true
      return turnFor(sink)
    }
    const { reviews } = manager()
    const review = await reviews.start('s')
    await vi.waitFor(() => expect(started).toBe(true))
    await reviews.shutdown()
    expect(reviews.list('s').find((r) => r.id === review.id)?.status).toBe('cancelled')
  })

  it('waits only briefly on shutdown for an agent that ignores the interrupt', async () => {
    let started = false
    fake.start = (_req, sink) => {
      started = true
      return turnFor(sink, true)
    }
    const { reviews } = manager()
    const review = await reviews.start('s')
    await vi.waitFor(() => expect(started).toBe(true))
    vi.useFakeTimers()
    try {
      const stopping = reviews.shutdown()
      await vi.advanceTimersByTimeAsync(2_000)
      await stopping
    } finally {
      vi.useRealTimers()
    }
    expect(reviews.list('s').find((r) => r.id === review.id)).toMatchObject({ status: 'cancelled', error: expect.stringMatching(/closed/) })
  })
})
