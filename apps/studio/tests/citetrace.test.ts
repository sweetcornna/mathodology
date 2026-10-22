import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project, ReviewFinding, SessionEvent, SessionEventBody } from '../src/shared/types'
import { extractCitations, traceCitations, traceSummary } from '../src/main/citetrace'
import { clearDoiCache, type Fetcher } from '../src/main/refcheck'
import { mergeFindings } from '../src/main/reviews'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
beforeEach(() => clearDoiCache())

function events(bodies: SessionEventBody[]): SessionEvent[] {
  return bodies.map((b, i) => ({ ...b, sessionId: 's', seq: i + 1, ts: i }) as SessionEvent)
}

describe('extractCitations', () => {
  it('finds identifiers, cite keys and author-year references', () => {
    const text = `As shown by Kermack and McKendrick (1927) and Smith et al. (2020), see doi:10.1098/rspa.1927.0118.
In 2020, Table 3 (Fig. 2) shows arXiv:2010.07000v2 and PMID: 9500320, trial NCT01234567.
\\citep[p.~3]{kermack1927, smith2020} and \\cite{known}. (Anderson, 1991; May 2001) 王桂民等（2017）指出`
    const found = extractCitations(text).map((c) => [c.kind, c.id])
    expect(found).toEqual([
      ['author_year', 'kermack 1927'],
      ['author_year', 'smith 2020'],
      ['doi', '10.1098/rspa.1927.0118'],
      ['arxiv', '2010.07000'],
      ['pmid', '9500320'],
      ['nct', 'NCT01234567'],
      ['cite', 'kermack1927'],
      ['cite', 'smith2020'],
      ['cite', 'known'],
      ['author_year', 'anderson 1991'],
      ['author_year', '王桂民 2017']
    ])
  })

  it('names the author, not the words around it, and skips dates and places', () => {
    const text = `Following Smith et al. (2020) and In Jones and Brown (2019), De Jong et al. (2018) and Müller et al. (2019) agree.
Data were collected (September, 2021), (Sep, 2021), (Winter, 2020) and (Beijing, 2020).
如李明等（2019）所述，根据王芳等(2020)的研究，王桂民等（2017）指出。`
    expect(extractCitations(text).map((c) => [c.id, c.text])).toEqual([
      ['smith 2020', 'Smith et al. (2020)'],
      ['jones 2019', 'Jones and Brown (2019)'],
      ['de jong 2018', 'De Jong et al. (2018)'],
      ['muller 2019', 'Müller et al. (2019)'],
      ['李明 2019', '李明等（2019）'],
      ['王芳 2020', '王芳等(2020)'],
      ['王桂民 2017', '王桂民等（2017）']
    ])
  })

  it('reads DOIs in LaTeX and Markdown without their markup', () => {
    const text = '\\href{https://doi.org/10.1038/nature14539}{Nature}, `10.1000/code`, **10.1000/bold**, \\doi{10.1007/978-3-319-24574-4\\_28}'
    expect(extractCitations(text).map((c) => [c.id, c.at])).toEqual([
      ['10.1038/nature14539', text.indexOf('10.1038')],
      ['10.1000/code', text.indexOf('10.1000/code')],
      ['10.1000/bold', text.indexOf('10.1000/bold')],
      ['10.1007/978-3-319-24574-4_28', text.indexOf('10.1007')]
    ])
  })
})

describe('traceCitations', () => {
  const crossref = (title: string, family: string, extra: Record<string, unknown> = {}) => ({
    message: { title: [title], author: [{ family, given: 'A' }], issued: { 'date-parts': [[2020]] }, type: 'journal-article', ...extra }
  })
  const net: Fetcher = async (url) => {
    const answer = (status: number, body: unknown) => ({ status, ok: status === 200, text: async () => JSON.stringify(body) })
    if (url.includes('10.1000/fake')) return url.includes('/ra/') ? answer(200, [{ status: 'DOI does not exist' }]) : answer(404, {})
    if (url.includes('api.crossref.org/works/10.1000/near')) return answer(200, crossref('Near paper', 'Nearby'))
    if (url.includes('api.crossref.org/works/10.1000/far')) return answer(200, crossref('Far paper', 'Faraway'))
    if (url.includes('api.crossref.org/works/10.1000/pulled')) return answer(200, crossref('Pulled paper', 'Pulled', { 'updated-by': [{ DOI: '10.1000/notice', type: 'retraction' }] }))
    if (url.includes('api.crossref.org/works/10.1000/seen')) return answer(200, crossref('Seen paper', 'Seen'))
    if (url.includes('openalex')) return answer(200, { is_retracted: false })
    return answer(404, {})
  }

  it('reports fabricated, retracted, unsourced and missing citations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-trace-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'paper'))
    writeFileSync(join(dir, 'paper', 'references.bib'), '@article{kermack1927, author={Kermack, W. O.}, title={A contribution}, year={1927}}\n')
    writeFileSync(
      join(dir, 'paper', 'paper.md'),
      [
        'Our model follows Kermack et al. (1927) \\cite{kermack1927} and \\cite{ghost2021}.',
        'Seen: 10.1000/seen. Fake: https://doi.org/10.1000/fake.',
        'Nearby (2020) reported it, doi:10.1000/near.',
        'Another source is 10.1000/far.',
        'Smith et al. (2020) estimated R0.'
      ].join('\n')
    )
    const project: Project = { id: 'p', name: 'Demo', path: dir, contest: 'MCM', createdAt: 0, kitInstalled: true }
    const result = await traceCitations({
      project,
      fetch: net,
      language: 'en',
      events: events([
        { kind: 'user.message', text: 'Write the paper', attachments: [] },
        { kind: 'tool.call', callId: 'w', name: 'WebFetch', toolKind: 'web', title: '', input: { url: 'https://doi.org/10.1000/seen' } },
        { kind: 'tool.result', callId: 'w', output: 'Seen paper — doi 10.1000/seen; also 10.1000/pulled', isError: false },
        { kind: 'tool.call', callId: 'r', name: 'Read', toolKind: 'read', title: '', input: { file_path: `${dir}/paper/paper.md` } },
        { kind: 'tool.result', callId: 'r', output: 'Smith et al. (2020) 10.1000/far 10.1000/fake', isError: false },
        { kind: 'artifact.version', artifactId: 'a', rel: 'paper/paper.md', v: 1, origin: 'tool', artifactKind: 'document', callId: 'x' },
        { kind: 'assistant.text', blockId: 'b', text: 'Done. Key source: 10.1000/pulled.' },
        { kind: 'turn.completed', ok: true }
      ])
    })
    const brief = result.findings.map((f) => [f.severity, f.title])
    expect(brief).toEqual([
      ['fail', 'paper/paper.md cites keys missing from the bibliography'],
      ['warn', 'Citations in paper/paper.md have no source'],
      ['fail', 'DOI does not exist: 10.1000/fake'],
      ['warn', 'DOI with no recorded source: 10.1000/far'],
      ['fail', 'Cites a retracted paper: 10.1000/pulled']
    ])
    expect(result.findings[0].detail).toContain('ghost2021')
    expect(result.findings[1].detail).toContain('Smith et al. (2020)')
    expect(result.findings[1].detail).not.toContain('Kermack')
    expect(result.findings[2]).toMatchObject({ kind: 'citation', evidence: ['paper/paper.md'] })
    expect(result.findings[2].detail).toContain('paper/paper.md:2')
    expect(result.trace).toEqual({ found: 7, traced: 2, bibOnly: 1, untraced: 4, resolved: 5, notFound: 1, unverifiable: 0, skipped: undefined })
    const summary = traceSummary(result.trace, result.findings)
    expect(summary).toContain('7 cited identifier(s)')
    expect(summary).toContain('- fail: DOI does not exist: 10.1000/fake')
  })

  const project = (path: string): Project => ({ id: 'p', name: 'Demo', path, contest: 'MCM', createdAt: 0, kitInstalled: true })
  const written = (rel: string): SessionEventBody => ({ kind: 'artifact.version', artifactId: rel, rel, v: 1, origin: 'tool', artifactKind: 'document', callId: 'x' })

  it('knows \\bibitem keys and traces accented names to folded sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-trace-'))
    dirs.push(dir)
    writeFileSync(
      join(dir, 'paper.tex'),
      ['As Müller et al. (2019) and \\cite{mueller2019,ghost} show.', '\\begin{thebibliography}{9}', '\\bibitem[M\\"uller et al.(2019)]{mueller2019} M\\"uller, A. (2019).', '\\end{thebibliography}'].join('\n')
    )
    const result = await traceCitations({
      project: project(dir),
      fetch: net,
      language: 'en',
      events: events([
        { kind: 'user.message', text: 'Write it', attachments: [] },
        { kind: 'tool.call', callId: 's', name: 'WebSearch', toolKind: 'web', title: '', input: { query: 'seasonal forcing' } },
        { kind: 'tool.result', callId: 's', output: 'Müller, A., Lee, B. (2019) Seasonal forcing of epidemics', isError: false },
        written('paper.tex')
      ])
    })
    expect(result.findings.map((f) => [f.title, f.detail])).toEqual([['paper.tex cites keys missing from the bibliography', expect.stringMatching(/: ghost\./)]])
    expect(result.trace).toMatchObject({ found: 1, traced: 1, untraced: 0 })
  })

  it('keeps the answers it has when the lookups are stopped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-trace-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'paper.md'), 'Fake: 10.1000/fake. Slow: 10.1000/slow.\n')
    const stop = new AbortController()
    const slow: Fetcher = async (url, init) => {
      if (url.includes('/ra/10.1000/slow')) {
        // The registry never answers; the review's time limit runs out meanwhile.
        stop.abort()
        return new Promise(() => undefined)
      }
      return net(url, init)
    }
    const result = await traceCitations({ project: project(dir), fetch: slow, language: 'en', events: events([written('paper.md')]), signal: stop.signal })
    expect(result.findings.map((f) => [f.severity, f.title])).toEqual([
      ['fail', 'DOI does not exist: 10.1000/fake'],
      ['inconclusive', 'DOI lookups timed out']
    ])
    expect(result.findings[1].detail).toContain('10.1000/slow')
    expect(result.trace).toMatchObject({ resolved: 1, notFound: 1, unverifiable: 1 })
  })

  it('says nothing when nothing is cited', async () => {
    const project: Project = { id: 'p', name: 'Demo', path: '/nonexistent', contest: 'MCM', createdAt: 0, kitInstalled: true }
    const r = await traceCitations({ project, fetch: net, language: 'zh-CN', events: events([{ kind: 'assistant.text', blockId: 'b', text: 'R² = 0.98' }]) })
    expect(r.findings).toEqual([])
    expect(traceSummary(r.trace, r.findings)).toBe('')
  })
})

describe('mergeFindings', () => {
  it('orders by severity with Studio findings first on ties', () => {
    const f = (id: string, severity: ReviewFinding['severity']): ReviewFinding => ({ id, severity, title: id, detail: '', evidence: [], status: 'open' })
    expect(mergeFindings([f('c-warn', 'warn')], [f('r-pass', 'pass'), f('r-warn', 'warn'), f('r-fail', 'fail')]).map((x) => x.id)).toEqual(['r-fail', 'c-warn', 'r-warn', 'r-pass'])
  })
})
