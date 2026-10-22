import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { doiMatches, findDois, firstSurname, normalizeDoi, sourceKind, splitNames, texDoi, titleSimilarity } from '../src/shared/biblio'
import {
  arxivId,
  authorMatches,
  bibFiles,
  checkBibliography,
  checkEntry,
  clearDoiCache,
  findCandidate,
  mapLimit,
  parseBibtex,
  plainField,
  resolveDoi,
  withDoi,
  type Fetcher
} from '../src/main/refcheck'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
beforeEach(() => clearDoiCache())

function routes(table: [RegExp, number, unknown][], seen: string[] = []): Fetcher {
  return async (url) => {
    seen.push(url)
    const hit = table.find(([re]) => re.test(url))
    if (hit?.[1] === 0) throw new Error('network down')
    const status = hit?.[1] ?? 404
    const body = hit ? (typeof hit[2] === 'string' ? hit[2] : JSON.stringify(hit[2])) : ''
    return { status, ok: status >= 200 && status < 300, text: async () => body }
  }
}

const WAKEFIELD = {
  message: {
    DOI: '10.1016/s0140-6736(97)11096-0',
    title: ['RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'],
    author: [{ family: 'Wakefield', given: 'AJ' }],
    issued: { 'date-parts': [[1998, 2]] },
    type: 'journal-article',
    'container-title': ['The Lancet'],
    'updated-by': [{ DOI: '10.1016/s0140-6736(10)60175-4', type: 'retraction', source: 'publisher' }]
  }
}

describe('biblio helpers', () => {
  it('normalizes DOIs written as links, prefixes or inside prose', () => {
    expect(normalizeDoi('https://doi.org/10.1016/S0140-6736(97)11096-0.')).toBe('10.1016/S0140-6736(97)11096-0')
    expect(normalizeDoi('doi: 10.1016/S0140-6736%2897%2911096-0')).toBe('10.1016/S0140-6736(97)11096-0')
    expect(normalizeDoi('(10.1000/xyz)')).toBeNull()
    expect(normalizeDoi('10.1/x')).toBeNull()
    expect(normalizeDoi('10.1234/../etc')).toBeNull()
    expect(findDois('See (doi:10.1000/abc123), and https://doi.org/10.5555/ZZ。另见 10.1000/abc123')).toEqual(['10.1000/abc123', '10.5555/ZZ'])
    expect(['https://www.doi.org/10.1000/xyz', 'doi.org/10.1000/xyz', 'DOI 10.1000/xyz', 'https://doi.org/10.1000/xyz?locatt=mode:legacy', 'https://dx.doi.org/10.1000/xyz#s1'].map(normalizeDoi)).toEqual(Array(5).fill('10.1000/xyz'))
    expect(normalizeDoi('10.1002/%28SICI%29x%zz')).toBe('10.1002/(SICI)x%zz')
    expect([texDoi('10.1007/978-3-319-24574-4\\_28'), texDoi('{{10.1000/xyz}}')]).toEqual(['10.1007/978-3-319-24574-4_28', '10.1000/xyz'])
  })

  it('takes DOIs out of Markdown, LaTeX and Chinese prose without what surrounds them', () => {
    expect(findDois('See `10.1038/nature14539`, **10.1000/bold** and | 10.1000/cell | in a table.')).toEqual(['10.1038/nature14539', '10.1000/bold', '10.1000/cell'])
    expect(findDois('（DOI：10.1016/j.ecolmodel.2020.109123）和“10.1038/nature14539”，见10.1000/zh的研究。')).toEqual(['10.1016/j.ecolmodel.2020.109123', '10.1038/nature14539', '10.1000/zh'])
    expect(findDois('\\href{https://doi.org/10.1038/nature14539}{Nature} and \\doi{10.1007/978-3-319-24574-4\\_28}')).toEqual(['10.1038/nature14539', '10.1007/978-3-319-24574-4_28'])
    // Old Wiley SICI DOIs carry angle brackets, sometimes HTML-escaped.
    const sici = '10.1002/(SICI)1097-0258(19980815/30)17:15/16<1661::AID-SIM968>3.0.CO;2-2'
    expect(findDois(`${sici}. Also ${sici.replace('<', '&lt;').replace('>', '&gt;')}`)).toEqual([sici])
    expect(findDois('<https://doi.org/10.5555/auto> 10.1000/a)(10.1000/b) https://doi.org/10.1002/%28SICI%291097?x=1')).toEqual(['10.5555/auto', '10.1000/a', '10.1000/b', '10.1002/(SICI)1097'])
    expect(doiMatches('see 10.1000/a\\_b')).toEqual([{ doi: '10.1000/a_b', at: 4 }])
  })

  it('compares titles across case, LaTeX, accents and subtitles', () => {
    expect(titleSimilarity('The {SIR} model of Erd\\H{o}s', 'The SIR Model of Erdős')).toBeGreaterThan(0.95)
    expect(titleSimilarity('Analytical parameter estimation of the SIR epidemic model', 'Analytical Parameter Estimation of the SIR Epidemic Model. Applications to COVID-19')).toBe(0.95)
    expect(titleSimilarity('Deep residual learning for image recognition', 'Attention is all you need')).toBeLessThan(0.3)
    expect(titleSimilarity('中国耕地流转时空特征及影响因素分解', '中国耕地流转时空特征及影响因素')).toBeGreaterThan(0.9)
  })

  it('reads registry titles through HTML and MathML markup and entities', () => {
    const mathml = 'Precision measurement of the <mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:msub><mml:mi>B</mml:mi><mml:mi>s</mml:mi></mml:msub></mml:math> lifetime'
    expect(titleSimilarity('Precision measurement of the Bs lifetime', mathml)).toBe(1)
    expect(titleSimilarity('Precision measurement of the Bs lifetime', mathml.replace(/</g, '&lt;').replace(/>/g, '&gt;'))).toBe(1)
    expect(titleSimilarity('CO2 uptake by forests', 'CO<sub>2</sub> uptake by forests')).toBe(1)
    expect(titleSimilarity('CO2 uptake by forests', 'CO&lt;sub&gt;2&lt;/sub&gt; uptake by forests')).toBe(1)
    expect(titleSimilarity('Supply & demand – Études', 'Supply &amp; demand &#x2013; &Eacute;tudes')).toBe(1)
  })

  it('reads first-author surnames in both BibTeX name orders', () => {
    expect(firstSurname('Kermack, W. O. and McKendrick, A. G.')).toBe('Kermack')
    expect(firstSurname('Ashish Vaswani and Noam Shazeer')).toBe('Vaswani')
    expect(firstSurname('{World Health Organization}')).toBe('{World Health Organization}')
    expect(firstSurname('{Ministry of Health and Welfare} and Doe, J.')).toBe('{Ministry of Health and Welfare}')
    expect(firstSurname('{Ministry of Health, Labour and Welfare}')).toBe('{Ministry of Health, Labour and Welfare}')
    expect(firstSurname('Johannes Diderik {van der Waals}')).toBe('{van der Waals}')
    expect(splitNames('Kermack, W. O. and {Smith and Sons} AND Doe, J.')).toEqual(['Kermack, W. O.', '{Smith and Sons}', 'Doe, J.'])
    expect(authorMatches('van der Berg', [{ family: 'Berg' }])).toBe(true)
    expect(authorMatches('Erd{\\H o}s', [{ family: 'Erdős' }])).toBe(true)
    expect(authorMatches('王桂民', [{ family: '王', given: '桂民' }])).toBe(true)
    expect(authorMatches('王桂民', [{ family: '王桂民' }])).toBe(true)
    expect(authorMatches('李明', [{ family: '王', given: '桂民' }])).toBe(false)
    expect(authorMatches('Smith', [{ family: 'Smyth' }])).toBe(false)
  })

  it('labels sources by DOI prefix and host', () => {
    expect(sourceKind('https://arxiv.org/abs/1706.03762')).toBe('preprint')
    expect(sourceKind('https://doi.org/10.1101/2020.03.22.002386', '10.1101/2020.03.22.002386')).toBe('preprint')
    expect(sourceKind('https://doi.org/10.5281/zenodo.1', '10.5281/zenodo.1')).toBe('dataset')
    expect(sourceKind('https://pubmed.ncbi.nlm.nih.gov/9500320/')).toBe('published')
    expect(sourceKind('https://example.org')).toBe('web')
  })
})

describe('parseBibtex', () => {
  it('reads braced, quoted, numeric and concatenated values', () => {
    const text = `% comment
@string{lancet = "The Lancet"}
@Article{wakefield1998,
  title = {{RETRACTED}: Ileal-lymphoid-nodular hyperplasia},
  author = "Wakefield, A. J. and Murch, S. H.",
  journal = lancet # " (London)",
  year = 1998,
  doi = {10.1016/S0140-6736(97)11096-0}
}
@comment{ignored, x = 1}
@misc( arxiv2017, title={Attention is all you need}, eprint={1706.03762v5}, archivePrefix={arXiv} )
@book{noFields,}
`
    const entries = parseBibtex(text)
    expect(entries.map((e) => [e.type, e.key, e.line])).toEqual([
      ['article', 'wakefield1998', 3],
      ['misc', 'arxiv2017', 11],
      ['book', 'noFields', 12]
    ])
    expect(entries[0].fields).toEqual({
      title: '{RETRACTED}: Ileal-lymphoid-nodular hyperplasia',
      author: 'Wakefield, A. J. and Murch, S. H.',
      journal: 'The Lancet (London)',
      year: '1998',
      doi: '10.1016/S0140-6736(97)11096-0'
    })
    expect(plainField(entries[0].fields.title)).toBe('RETRACTED: Ileal-lymphoid-nodular hyperplasia')
    expect(arxivId(entries[1].fields)).toBe('1706.03762')
    expect(arxivId({ journal: 'arXiv preprint arXiv:2010.07000' })).toBe('2010.07000')
    expect(arxivId({ url: 'https://example.org' })).toBeUndefined()
  })

  it('expands @string and month macros and skips comment groups', () => {
    const text = '@string{nat = "Nature"}\n@comment{ old: @misc{fake, title = {x}} }\n@article{a, journal = nat # " Physics", month = apr, note = undefinedmacro}\n'
    expect(parseBibtex(text).map((e) => [e.key, e.fields])).toEqual([['a', { journal: 'Nature Physics', month: 'Apr', note: 'undefinedmacro' }]])
  })

  it('inserts a DOI into the named entry only', () => {
    const text = '@article{a,\n    title = {A}\n}\n\n@article{b, title = {B}, doi = {10.1/b}}\n'
    expect(withDoi(text, 'a', '10.1000/a1')).toBe('@article{a,\n    doi = {10.1000/a1},\n    title = {A}\n}\n\n@article{b, title = {B}, doi = {10.1/b}}\n')
    expect(withDoi(text, 'b', '10.1000/b1')).toBeNull()
    expect(withDoi(text, 'missing', '10.1000/c')).toBeNull()
  })
})

describe('resolveDoi', () => {
  it('reads Crossref records and their retraction notices', async () => {
    const seen: string[] = []
    const check = await resolveDoi('https://doi.org/10.1016/S0140-6736(97)11096-0', routes([[/api\.crossref\.org/, 200, WAKEFIELD]], seen))
    expect(check).toMatchObject({ doi: '10.1016/S0140-6736(97)11096-0', state: 'resolves', registry: 'crossref', record: { year: 1998, venue: 'The Lancet', type: 'journal-article' } })
    expect(check.notices).toEqual([{ kind: 'retraction', doi: '10.1016/s0140-6736(10)60175-4', source: 'crossref', year: undefined }])
    expect(seen[0]).toBe('https://api.crossref.org/works/10.1016/S0140-6736(97)11096-0')
    // A definitive answer is cached.
    await resolveDoi('10.1016/S0140-6736(97)11096-0', routes([], seen))
    expect(seen).toHaveLength(1)
  })

  it('asks the DOI system for the agency when Crossref has no record', async () => {
    const datacite = routes([
      [/doi\.org\/ra\//, 200, [{ DOI: '10.48550/arXiv.1602.03837', RA: 'DataCite' }]],
      [
        /api\.datacite\.org/,
        200,
        {
          data: {
            attributes: {
              titles: [{ title: 'Observation of Gravitational Waves from a Binary Black Hole Merger' }],
              creators: [{ name: 'Collaboration, LIGO Scientific' }, { familyName: 'Abbott', givenName: 'B. P.' }],
              publicationYear: 2016,
              publisher: 'arXiv',
              types: { resourceTypeGeneral: 'Preprint' },
              relatedIdentifiers: [{ relationType: 'IsVersionOf', relatedIdentifier: '10.1103/PhysRevLett.116.061102', relatedIdentifierType: 'DOI' }]
            }
          }
        }
      ],
      [/openalex/, 200, { is_retracted: false }]
    ])
    expect(await resolveDoi('10.48550/arXiv.1602.03837', datacite)).toMatchObject({
      state: 'resolves',
      registry: 'datacite',
      notices: [],
      record: { year: 2016, publisher: 'arXiv', type: 'preprint', authors: [{ family: 'Collaboration' }, { family: 'Abbott', given: 'B. P.' }], publishedAs: ['10.1103/physrevlett.116.061102'] }
    })
    const istic = routes([
      [/doi\.org\/ra\//, 200, [{ DOI: '10.11975/x', RA: 'ISTIC' }]],
      [/^https:\/\/doi\.org\/10\.11975/, 200, { title: '中国耕地流转时空特征及影响因素分解', author: [{ given: '王桂民' }], 'container-title': '农业工程学报', issued: { 'date-parts': [[2017]] } }]
    ])
    expect(await resolveDoi('10.11975/x', istic)).toMatchObject({ registry: 'istic', record: { authors: [{ family: '王桂民' }], year: 2017, venue: '农业工程学报' } })
  })

  it('says not_found only when the DOI system says so', async () => {
    const missing = routes([[/doi\.org\/ra\//, 200, [{ DOI: '10.9999/x', status: 'DOI does not exist' }]]])
    expect((await resolveDoi('10.9999/x', missing)).state).toBe('not_found')
    const down = routes([[/./, 0, '']])
    expect(await resolveDoi('10.9999/y', down)).toMatchObject({ state: 'unverifiable', error: 'network down' })
    const slow = routes([[/doi\.org\/ra\//, 503, '']])
    expect((await resolveDoi('10.9999/z', slow)).state).toBe('unverifiable')
    expect((await resolveDoi('not a doi', slow)).state).toBe('invalid')
  })

  it('queues Crossref requests and retries when rate-limited', async () => {
    let calls = 0
    let inFlight = 0
    let peak = 0
    const limited: Fetcher = async (url) => {
      if (!url.includes('api.crossref.org')) return { status: 404, ok: false, text: async () => '' }
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      // The first request is turned away once, as Crossref does when a client is too quick.
      if (calls++ === 0) return { status: 429, ok: false, text: async () => '', headers: { get: () => '0' } }
      return { status: 200, ok: true, text: async () => JSON.stringify(WAKEFIELD) }
    }
    const checks = await Promise.all(['10.1000/q1', '10.1000/q2', '10.1000/q3'].map((d) => resolveDoi(d, limited)))
    expect(checks.map((c) => c.registry)).toEqual(['crossref', 'crossref', 'crossref'])
    expect(peak).toBe(1)
    expect(calls).toBe(4)
  })

  it('reads a retraction recorded on the article itself', async () => {
    const message = { ...WAKEFIELD.message, DOI: '10.1000/inplace', title: ['A paper'], 'updated-by': [], 'update-to': [{ DOI: '10.1000/INPLACE', type: 'retraction' }] }
    const check = await resolveDoi('10.1000/inplace', routes([[/api\.crossref\.org/, 200, { message }]]))
    expect(check.notices).toEqual([{ kind: 'retraction', doi: '10.1000/inplace', source: 'crossref' }])
    expect(check.record?.noticeFor).toBeUndefined()
  })

  it('takes OpenAlex retraction flags as a second source', async () => {
    const message = { ...WAKEFIELD.message, title: ['A paper'], 'updated-by': [] }
    const net = routes([
      [/api\.crossref\.org/, 200, { message }],
      [/openalex/, 200, { id: 'W1', is_retracted: true }]
    ])
    expect((await resolveDoi('10.1000/oa', net)).notices).toEqual([{ kind: 'retraction', source: 'openalex' }])
  })
})

describe('checkEntry', () => {
  const entry = (fields: Record<string, string>, type = 'article') => ({ type, key: 'k', line: 1, fields })

  it('fails a retracted or mismatched record and warns on drift', async () => {
    const net = routes([[/api\.crossref\.org/, 200, WAKEFIELD]])
    const good = await checkEntry(entry({ title: 'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children', author: 'Wakefield, A. J.', year: '1998', doi: '10.1016/S0140-6736(97)11096-0' }), net)
    expect(good.verdict).toBe('fail')
    expect(good.problems.map((p) => p.code)).toEqual(['retracted'])
    clearDoiCache()
    const drift = await checkEntry(entry({ title: 'Ileal lymphoid nodular hyperplasia and colitis in children', author: 'Murch, S.', year: '2001', doi: '10.1016/S0140-6736(97)11096-0' }), net)
    expect(drift.problems.map((p) => [p.code, p.severity])).toEqual([
      ['title_differs', 'warn'],
      ['author_differs', 'warn'],
      ['year_differs', 'warn'],
      ['retracted', 'fail']
    ])
    clearDoiCache()
    const wrong = await checkEntry(entry({ title: 'Deep residual learning for image recognition', doi: '10.1016/S0140-6736(97)11096-0' }), net)
    expect(wrong.problems[0]).toMatchObject({ code: 'title_mismatch', severity: 'fail' })
  })

  it('reports missing and unanswered DOIs differently', async () => {
    const missing = routes([[/doi\.org\/ra\//, 200, [{ DOI: '10.9999/x', status: 'DOI does not exist' }]]])
    expect((await checkEntry(entry({ title: 'Made up', doi: '10.9999/x' }), missing)).verdict).toBe('fail')
    const down = routes([[/./, 0, '']])
    const r = await checkEntry(entry({ title: 'Real but offline', doi: '10.9999/y' }), down)
    expect(r.verdict).toBe('inconclusive')
    expect(r.problems[0].code).toBe('unverifiable')
  })

  it('resolves DOI fields written with TeX escapes or extra braces', async () => {
    const seen: string[] = []
    const net = routes([[/api\.crossref\.org/, 200, { message: { title: ['U-Net'], author: [{ family: 'Ronneberger' }], issued: { 'date-parts': [[2015]] } } }]], seen)
    const escaped = await checkEntry(entry({ title: 'U-Net', author: 'Ronneberger, O.', year: '2015', doi: '10.1007/978-3-319-24574-4\\_28' }), net)
    expect(escaped.verdict).toBe('ok')
    expect(seen[0]).toBe('https://api.crossref.org/works/10.1007/978-3-319-24574-4_28')
    expect((await checkEntry(entry({ title: 'U-Net', doi: '{10.1000/xyz}' }), net)).problems.map((p) => p.code)).not.toContain('invalid_doi')
  })

  it('does not pass an entry whose registry record could not be read', async () => {
    // Crossref unreachable, then doi.org names Crossref as the agency: the DOI exists, the entry is unchecked.
    const net = routes([
      [/api\.crossref\.org/, 0, ''],
      [/doi\.org\/ra\//, 200, [{ DOI: '10.1000/cr', RA: 'Crossref' }]]
    ])
    const r = await checkEntry(entry({ title: 'Some paper', doi: '10.1000/cr' }), net)
    expect(r.check).toMatchObject({ state: 'resolves', registry: 'crossref' })
    expect(r.problems).toEqual([{ code: 'no_record', severity: 'inconclusive', detail: 'Crossref answered nothing' }])
    expect(r.verdict).toBe('inconclusive')
  })

  it('does not call a MathML title a mismatch', async () => {
    const title = 'Precision measurement of the <mml:math><mml:msub><mml:mi>B</mml:mi><mml:mi>s</mml:mi></mml:msub></mml:math> lifetime'
    const r = await checkEntry(entry({ title: 'Precision measurement of the {B}s lifetime', doi: '10.1000/bs' }), routes([[/api\.crossref\.org/, 200, { message: { title: [title] } }]]))
    expect(r.verdict).toBe('ok')
  })

  it('offers a candidate DOI for an entry without one', async () => {
    const seen: string[] = []
    const net = routes(
      [
        [
          /api\.crossref\.org\/works\?/,
          200,
          {
            message: {
              items: [
                { DOI: '10.1007/978-3-030-1_2', title: ['A contribution to the mathematical theory of epidemics'], author: [{ family: 'Brauer' }], type: 'book-chapter', issued: { 'date-parts': [[2019]] } },
                { DOI: '10.1098/RSPA.1927.0118', title: ['A contribution to the mathematical theory of epidemics'], author: [{ family: 'Kermack', given: 'W. O.' }], type: 'journal-article', issued: { 'date-parts': [[1927]] } }
              ]
            }
          }
        ]
      ],
      seen
    )
    const r = await checkEntry(entry({ title: 'A Contribution to the Mathematical Theory of Epidemics', author: 'Kermack, W. O. and McKendrick, A. G.', year: '1927' }), net)
    expect(r.candidate).toMatchObject({ doi: '10.1098/rspa.1927.0118', via: 'crossref' })
    expect(r.verdict).toBe('ok')
    expect(r.problems.map((p) => p.code)).toEqual(['no_doi'])
    expect(decodeURIComponent(seen[0])).toContain('query.bibliographic=A Contribution to the Mathematical Theory of Epidemics Kermack 1927'.replace(/ /g, '+'))
    expect(await findCandidate('Unrelated title words here', '', undefined, net)).toBeUndefined()
  })

  it('checks arXiv entries through their DataCite DOI', async () => {
    const net = routes([
      [/doi\.org\/ra\//, 200, [{ RA: 'DataCite' }]],
      [/api\.datacite\.org\/dois\/10\.48550\/arXiv\.1706\.03762/, 200, { data: { attributes: { titles: [{ title: 'Attention Is All You Need' }], creators: [{ familyName: 'Vaswani', givenName: 'Ashish' }], publicationYear: 2017 } } }]
    ])
    const r = await checkEntry(entry({ title: 'Attention is all you need', author: 'Vaswani, Ashish', year: '2017', eprint: '1706.03762', archiveprefix: 'arXiv' }, 'misc'), net)
    expect(r.candidate).toMatchObject({ doi: '10.48550/arXiv.1706.03762', via: 'arxiv' })
    expect(r.verdict).toBe('ok')
    clearDoiCache()
    const linked = routes([
      [/doi\.org\/ra\//, 200, [{ RA: 'DataCite' }]],
      [/api\.datacite\.org/, 200, { data: { attributes: { titles: [{ title: 'Attention Is All You Need' }], creators: [{ familyName: 'Vaswani' }], publicationYear: 2017, relatedIdentifiers: [{ relationType: 'IsVersionOf', relatedIdentifier: '10.5555/nips.2017', relatedIdentifierType: 'DOI' }] } } }]
    ])
    const published = await checkEntry(entry({ title: 'Attention is all you need', author: 'Vaswani, Ashish', year: '2017', eprint: '1706.03762' }, 'misc'), linked)
    expect(published.problems.find((p) => p.code === 'has_published')).toMatchObject({ severity: 'warn', detail: '10.5555/nips.2017' })
  })
})

describe('bibliography files', () => {
  it('lists .bib files paper-first and checks one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-refs-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'paper'))
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'paper', 'references.bib'), '@misc{a, title={Short}}\n@misc{b, title={Tiny}}\n')
    writeFileSync(join(dir, 'other.bib'), '')
    writeFileSync(join(dir, 'node_modules', 'x', 'skip.bib'), '')
    expect(bibFiles(dir)).toEqual(['paper/references.bib', 'other.bib'])
    const progress: number[] = []
    const report = await checkBibliography(dir, undefined, routes([]), (done) => progress.push(done))
    expect(report.file).toBe('paper/references.bib')
    expect(report.entries.map((e) => [e.key, e.verdict])).toEqual([
      ['a', 'inconclusive'],
      ['b', 'inconclusive']
    ])
    expect(progress).toEqual([0, 1, 2])
  })

  it('runs a bounded number of lookups at once', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit(
      [1, 2, 3, 4, 5, 6],
      2,
      async (n) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return n * 2
      },
      0
    )
    expect(out).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBe(2)
  })
})
