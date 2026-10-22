import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LitResult } from '../src/shared/types'
import { addToBibliography, cite, citeKey, fallbackBibtex, formatBibtex, parseResults, rekey } from '../src/main/literature'

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
    const noNet = async (): Promise<{ ok: boolean; text(): Promise<string> }> => ({ ok: false, text: async () => '' })
    const first = await cite(dir, paper, noNet)
    expect(first).toMatchObject({ key: 'melikechi2021limits', file: 'paper/references.bib', added: true })
    expect((await cite(dir, paper, noNet)).added).toBe(false)
    const other = addToBibliography(dir, 'paper/references.bib', 'melikechi2021limits', '@misc{melikechi2021limits,\n  title = {Other},\n}', { ...paper, url: 'https://example.org/q' })
    expect(other).toEqual({ key: 'melikechi2021limitsa', added: true })
    expect(readFileSync(join(dir, 'paper/references.bib'), 'utf8').match(/^@/gm)).toHaveLength(2)
  })

  it('uses the DOI registry when it answers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-lit-'))
    dirs.push(dir)
    const seen: string[] = []
    const net = async (url: string): Promise<{ ok: boolean; text(): Promise<string> }> => {
      seen.push(url)
      return { ok: true, text: async () => ' @article{X, author={Prodanov, Dimiter}, title={Analytical}, year={2020}, doi={10.3390/e23010059}}' }
    }
    const r = await cite(dir, { ...paper, doi: '10.3390/e23010059' }, net, Promise.resolve(true))
    expect(seen).toEqual(['https://doi.org/10.3390/e23010059'])
    expect(r).toMatchObject({ key: 'prodanov2020analytical', retracted: true })
  })
})
