import { describe, expect, it } from 'vitest'
import type { Project, Session, SessionEvent, SessionEventBody } from '../src/shared/types'
import { buildDigest, parseReview } from '../src/main/reviews'

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
