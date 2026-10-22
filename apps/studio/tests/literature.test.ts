import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LitResult } from '../src/shared/types'
import { addToBibliography, cite, citeKey, fallbackBibtex, formatBibtex, mergeResults, parseGraph, parseResults, recordBibtex, rekey } from '../src/main/literature'
import { clearDoiCache, type Fetcher } from '../src/main/refcheck'

/** A registry stand-in: the first route whose pattern matches answers; anything else is a 404. */
function routes(table: [RegExp, number, unknown][], seen: string[] = []): Fetcher {
  return async (url) => {
    seen.push(url)
    const hit = table.find(([re]) => re.test(url))
    const status = hit?.[1] ?? 404
    const body = hit ? (typeof hit[2] === 'string' ? hit[2] : JSON.stringify(hit[2])) : ''
    return { status, ok: status >= 200 && status < 300, text: async () => body }
  }
}

beforeEach(() => clearDoiCache())

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const SEARCH = JSON.stringify({
  results: [
    {
      title: 'Analytical parameter estimation of the SIR epidemic model',
      url: 'https://arxiv.org/abs/2010.07000v1',
      snippet: 'Dimiter Prodanov — The dramatic outbreak of the coronavirus …',
      published_age: '2020-10-09'
    },
    {
      title: 'Analytical Parameter Estimation of the SIR Epidemic Model',
      url: 'https://doi.org/10.3390/e23010059',
      snippet: 'Entropy · cited by 1,041 — The SIR model is a simple mathematical model …',
      published_age: '2020-12-31'
    },
    { title: 'No url' }
  ]
})

describe('parseResults', () => {
  it('splits bylines from abstracts and picks out identifiers', () => {
    const [a, b, ...rest] = parseResults(SEARCH)
    expect(rest).toEqual([])
    expect(a).toMatchObject({ byline: 'Dimiter Prodanov', arxiv: '2010.07000', date: '2020-10-09' })
    expect(a.snippet.startsWith('The dramatic')).toBe(true)
    expect(b).toMatchObject({ doi: '10.3390/e23010059', citedBy: 1041, byline: 'Entropy · cited by 1,041' })
    expect(parseResults('not json')).toEqual([])
  })
})

describe('BibTeX', () => {
  const paper: LitResult = { title: 'Limits of epidemic prediction using SIR models', url: 'https://example.org/p', snippet: '', byline: 'Omar Melikechi, Alexander L. Young et al.', date: '2021-12-13' }

  it('builds keys from surname, year and title', () => {
    expect(citeKey('Kermack, W. O. and McKendrick, A. G.', '1927', 'A contribution to the mathematical theory of epidemics')).toBe('kermack1927contribution')
    expect(citeKey('Dimiter Prodanov', '2020', 'The SIR model')).toBe('prodanov2020sir')
    expect(citeKey('', '', 'On things')).toBe('anonthings')
  })

  it('rekeys fetched entries and builds one when no registry answers', () => {
    const fetched = '@Article{Prodanov_2020, title={Analytical Parameter Estimation}, author={Prodanov, Dimiter}, year={2020}, doi={10.3390/e23010059}}'
    expect(rekey(fetched, paper).bibtex.startsWith('@article{prodanov2020analytical,')).toBe(true)
    const built = rekey(fallbackBibtex(paper), paper)
    expect(built.key).toBe('melikechi2021limits')
    expect(built.bibtex).toContain('author = {Omar Melikechi and Alexander L. Young and others}')
    expect(built.bibtex).toContain('howpublished = {\\url{https://example.org/p}}')
  })

  it('lays out one field per line', () => {
    const one = '@article{k, title={A, b {C}}, ISSN={1}, author="X and Y", year=2021, month=Apr, pages={97–117} }'
    expect(formatBibtex(one)).toBe('@article{k,\n  title = {A, b {C}},\n  issn = {1},\n  author = "X and Y",\n  year = 2021,\n  month = Apr,\n  pages = {97–117}\n}')
    const arxiv = '@misc{k,\n      title={T}, \n      url={https://arxiv.org/abs/1}, \n}'
    expect(formatBibtex(arxiv)).toBe('@misc{k,\n  title = {T},\n  url = {https://arxiv.org/abs/1}\n}')
  })

  it('appends once per paper and suffixes clashing keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-lit-'))
    dirs.push(dir)
    const noNet: Fetcher = async () => ({ status: 503, ok: false, text: async () => '' })
    const first = await cite(dir, paper, noNet)
    expect(first).toMatchObject({ key: 'melikechi2021limits', file: 'paper/references.bib', added: true, source: 'search' })
    expect((await cite(dir, paper, noNet)).added).toBe(false)
    const other = addToBibliography(dir, 'paper/references.bib', 'melikechi2021limits', '@misc{melikechi2021limits,\n  title = {Other},\n}', { ...paper, url: 'https://example.org/q' })
    expect(other).toEqual({ key: 'melikechi2021limitsa', added: true })
    expect(readFileSync(join(dir, 'paper/references.bib'), 'utf8').match(/^@/gm)).toHaveLength(2)
  })

  const CROSSREF = {
    message: {
      DOI: '10.3390/e23010059',
      title: ['Analytical Parameter Estimation of the SIR Epidemic Model. Applications to the COVID-19 Pandemic'],
      author: [{ family: 'Prodanov', given: 'Dimiter' }],
      issued: { 'date-parts': [[2020, 12, 31]] },
      type: 'journal-article',
      'container-title': ['Entropy'],
      'updated-by': [{ DOI: '10.3390/e99999999', type: 'retraction', source: 'retraction-watch' }]
    }
  }

  it('asks the DOI system first and uses the registry BibTeX', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-lit-'))
    dirs.push(dir)
    const seen: string[] = []
    const net = routes(
      [
        [/api\.crossref\.org\/works\//, 200, CROSSREF],
        [/^https:\/\/doi\.org\/10\.3390/, 200, ' @article{X, author={Prodanov, Dimiter}, title={Analytical}, year={2020}, doi={10.3390/e23010059}}']
      ],
      seen
    )
    const r = await cite(dir, { ...paper, title: 'Analytical parameter estimation of the SIR epidemic model', doi: '10.3390/e23010059' }, net)
    expect(seen).toEqual(['https://api.crossref.org/works/10.3390/e23010059', 'https://doi.org/10.3390/e23010059'])
    expect(r).toMatchObject({ key: 'prodanov2020analytical', retracted: true, source: 'registry', check: { state: 'resolves', registry: 'crossref' } })
  })

  it('builds the entry from the registry record when no BibTeX is served', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-lit-'))
    dirs.push(dir)
    const net = routes([[/api\.crossref\.org\/works\//, 200, CROSSREF]])
    const r = await cite(dir, { ...paper, title: 'Analytical parameter estimation of the SIR epidemic model', doi: '10.3390/e23010059' }, net)
    expect(r.source).toBe('record')
    expect(r.bibtex).toContain('author = {Prodanov, Dimiter}')
    expect(r.bibtex).toContain('journal = {Entropy}')
  })

  it('refuses a DOI that does not exist or names another paper', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-lit-'))
    dirs.push(dir)
    const missing = routes([[/doi\.org\/ra\//, 200, [{ DOI: '10.9999/x', status: 'DOI does not exist' }]]])
    expect(await cite(dir, { ...paper, doi: '10.9999/x' }, missing)).toMatchObject({ refused: true, added: false, check: { state: 'not_found' } })
    const other = await cite(dir, { ...paper, doi: '10.3390/e23010059' }, routes([[/api\.crossref\.org/, 200, CROSSREF]]))
    expect(other.refused).toBe(true)
    expect(other.mismatch).toMatch(/^Analytical Parameter/)
    expect(() => readFileSync(join(dir, 'paper/references.bib'))).toThrow()
  })

  it('accepts a registry title written with MathML or HTML markup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-lit-'))
    dirs.push(dir)
    const title = 'Precision measurement of the &lt;mml:math&gt;&lt;mml:msub&gt;&lt;mml:mi&gt;B&lt;/mml:mi&gt;&lt;mml:mi&gt;s&lt;/mml:mi&gt;&lt;/mml:msub&gt;&lt;/mml:math&gt; lifetime'
    const net = routes([[/api\.crossref\.org\/works\//, 200, { message: { ...CROSSREF.message, title: [title], 'updated-by': [] } }]])
    const r = await cite(dir, { ...paper, title: 'Precision measurement of the Bs lifetime', doi: '10.3390/e23010059' }, net)
    expect(r.refused).toBeUndefined()
    expect(r).toMatchObject({ added: true, source: 'record' })
  })

  it('formats registry records as BibTeX', () => {
    const bib = recordBibtex({ title: 'A & B', authors: [{ family: 'World Health Organization' }], year: 2020, type: 'report', venue: 'WHO' }, '10.1/x')
    expect(bib).toBe('@techreport{KEY,\n  title = {A \\& B},\n  author = {{World Health Organization}},\n  institution = {WHO},\n  year = {2020},\n  doi = {10.1/x},\n}')
  })
})

describe('mergeResults', () => {
  it('folds a preprint into its journal version and labels sources', () => {
    const merged = mergeResults(parseResults(SEARCH))
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ url: 'https://doi.org/10.3390/e23010059', kind: 'published', arxiv: '2010.07000', citedBy: 1041 })
    expect(merged[0].alts).toEqual([{ url: 'https://arxiv.org/abs/2010.07000v1', kind: 'preprint', doi: undefined, arxiv: '2010.07000' }])
    expect(mergeResults([{ title: 'Counts', url: 'https://zenodo.org/records/1', snippet: '' }])[0].kind).toBe('dataset')
    expect(mergeResults([{ title: 'Blog', url: 'https://example.org/post', snippet: '' }])[0].kind).toBe('web')
  })
})

describe('parseGraph', () => {
  it('turns citation-graph neighbours into citable results', () => {
    const g = parseGraph(
      JSON.stringify({
        references: [{ title: 'Learning to rank', url: 'https://doi.org/10.1145/1273496.1273513', doi: '10.1145/1273496.1273513', year: 2007, cited_by_count: 1958, retracted: false }],
        citations: [{ title: 'Pulled', doi: '10.1000/r', year: 2020, retracted: true }, { year: 2021 }],
        notes: ['Showing 1 of 6 references, most-cited first.']
      })
    )
    expect(g.references[0]).toMatchObject({ title: 'Learning to rank', date: '2007', citedBy: 1958, kind: 'published' })
    expect(g.references[0].retracted).toBeUndefined()
    expect(g.citations).toEqual([{ title: 'Pulled', url: 'https://doi.org/10.1000/r', snippet: '', date: '2020', doi: '10.1000/r', citedBy: undefined, kind: 'published', retracted: true }])
    expect(g.notes).toHaveLength(1)
    expect(parseGraph('not json')).toEqual({ references: [], citations: [], notes: [] })
  })
})
