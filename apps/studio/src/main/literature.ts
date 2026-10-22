import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeDoi, sourceKind, titleSimilarity } from '@shared/biblio'
import type { DoiCheck, LitCitation, LitGraph, LitResult, RegistryRecord } from '@shared/types'
import { findCandidate, resolveDoi, type Fetcher } from './refcheck'

const UA = 'Mathodology (https://github.com/ymylive/mathodology)'

const DOI = /doi\.org\/(10\.\d{4,9}\/[^\s?#]+)/i
const ARXIV = /arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?/i

/** Turn the search connector's JSON results into papers with whatever identifiers they carry. */
export function parseResults(json: string): LitResult[] {
  let data: { results?: Record<string, unknown>[] }
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  return (data.results ?? []).flatMap((r): LitResult[] => {
    if (typeof r.title !== 'string' || typeof r.url !== 'string') return []
    const raw = typeof r.snippet === 'string' ? r.snippet : ''
    // Sources put "Authors — abstract" or "Venue · cited by N — abstract" in the snippet.
    const cut = raw.indexOf(' — ')
    const byline = cut > 0 && cut < 200 ? raw.slice(0, cut).trim() : undefined
    const snippet = (byline ? raw.slice(cut + 3) : raw).replace(/\s*…$/, '…').trim()
    const cited = byline?.match(/cited by ([\d,]+)/i)
    const date = typeof r.published_age === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(r.published_age) ? r.published_age : undefined
    return [
      {
        title: r.title.trim(),
        url: r.url,
        snippet,
        byline,
        date,
        doi: r.url.match(DOI)?.[1]?.replace(/[.,;]$/, ''),
        arxiv: r.url.match(ARXIV)?.[1],
        citedBy: cited ? Number(cited[1].replace(/,/g, '')) : undefined
      }
    ]
  })
}

const RANK = { published: 0, preprint: 1, dataset: 2, web: 3 } as const

/**
 * Label each result's source type and fold copies of one work (same DOI, or near-identical title)
 * into the best-ranked copy: the journal version first, the preprint kept as an alternative link.
 */
export function mergeResults(results: LitResult[], category?: string): LitResult[] {
  const out: LitResult[] = []
  for (const r of results) {
    const kind = sourceKind(r.url, r.doi, category === 'dataset' ? 'dataset' : undefined)
    const item: LitResult = { ...r, kind }
    const same = out.find(
      (o) => (o.doi && item.doi && o.doi.toLowerCase() === item.doi.toLowerCase()) || (o.arxiv && o.arxiv === item.arxiv) || titleSimilarity(o.title, item.title) >= 0.9
    )
    if (!same) {
      out.push(item)
      continue
    }
    const [keep, fold] = RANK[item.kind!] < RANK[same.kind!] ? [item, same] : [same, item]
    const merged: LitResult = {
      ...fold,
      ...keep,
      byline: keep.byline ?? fold.byline,
      snippet: keep.snippet || fold.snippet,
      date: keep.date ?? fold.date,
      arxiv: keep.arxiv ?? fold.arxiv,
      citedBy: Math.max(keep.citedBy ?? 0, fold.citedBy ?? 0) || undefined,
      alts: [...(keep.alts ?? []), ...(fold.url !== keep.url ? [{ url: fold.url, kind: fold.kind!, doi: fold.doi, arxiv: fold.arxiv }] : []), ...(fold.alts ?? [])]
    }
    if (!merged.alts?.length) delete merged.alts
    out[out.indexOf(same)] = merged
  }
  return out
}

/** The search connector's `paper_graph` JSON as results the panel can cite. */
export function parseGraph(json: string): LitGraph {
  let data: { references?: Record<string, unknown>[]; citations?: Record<string, unknown>[]; notes?: unknown[] }
  try {
    data = JSON.parse(json)
  } catch {
    return { references: [], citations: [], notes: [] }
  }
  const items = (list: Record<string, unknown>[] | undefined): LitResult[] =>
    (list ?? []).flatMap((r): LitResult[] => {
      if (typeof r.title !== 'string') return []
      const doi = typeof r.doi === 'string' ? (normalizeDoi(r.doi) ?? undefined) : undefined
      const url = typeof r.url === 'string' ? r.url : doi ? `https://doi.org/${doi}` : ''
      if (!url) return []
      return [
        {
          title: r.title.trim(),
          url,
          snippet: '',
          date: typeof r.year === 'number' ? String(r.year) : undefined,
          doi,
          citedBy: typeof r.cited_by_count === 'number' ? r.cited_by_count : undefined,
          kind: sourceKind(url, doi),
          retracted: r.retracted === true || undefined
        }
      ]
    })
  return { references: items(data.references), citations: items(data.citations), notes: (data.notes ?? []).filter((n): n is string => typeof n === 'string') }
}

function ascii(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '')
}

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'with', 'from', 'towards', 'toward', 'using', 'via'])

/** `surname2020word`: first author's surname, year and first meaningful title word. */
export function citeKey(author: string, year: string, title: string): string {
  const first = author.split(/\s+and\s+/i)[0]?.trim() ?? ''
  const surname = first.includes(',') ? first.split(',')[0] : first.split(/\s+/).pop() ?? ''
  const word = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((w) => w.length > 2 && !STOP.has(w))
  return (ascii(surname).toLowerCase() || 'anon') + (year.match(/\d{4}/)?.[0] ?? '') + (word ?? '')
}

function field(bib: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|(\\d+))`, 'i').exec(bib)
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/[{}]/g, '').trim()
}

function bibEscape(s: string): string {
  return s.replace(/[{}\\]/g, '').replace(/([&%$#_])/g, '\\$1')
}

/** A BibTeX entry from the search result alone, when no registry has one. */
export function fallbackBibtex(paper: LitResult): string {
  const year = paper.date?.slice(0, 4) ?? ''
  // A byline without a venue marker is usually the author list.
  const authors = paper.byline && !/·|cited by|open access/i.test(paper.byline) ? paper.byline.replace(/\s+et al\.?$/, ' and others').replace(/,\s*/g, ' and ') : ''
  const lines = [`@misc{KEY,`, `  title = {${bibEscape(paper.title)}},`]
  if (authors) lines.push(`  author = {${bibEscape(authors)}},`)
  if (year) lines.push(`  year = {${year}},`)
  if (paper.doi) lines.push(`  doi = {${paper.doi}},`)
  lines.push(`  howpublished = {\\url{${paper.url}}},`, '}')
  return lines.join('\n')
}

/** One field per line, two-space indent, whatever layout the registry used. */
export function formatBibtex(bib: string): string {
  const head = /^@(\w+)\s*\{\s*([^,\s]*)\s*,/.exec(bib.trim())
  if (!head) return bib.trim()
  const body = bib.trim().slice(head[0].length)
  const fields: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const ch of body) {
    if (ch === '"' && depth === 0) quoted = !quoted
    if (!quoted && ch === '{') depth++
    if (!quoted && ch === '}') {
      if (depth === 0) break
      depth--
    }
    if (ch === ',' && depth === 0 && !quoted) {
      fields.push(current)
      current = ''
    } else current += ch
  }
  fields.push(current)
  const lines = fields
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((f) => `  ${f.replace(/^([\w-]+)\s*=\s*/, (_, k: string) => `${k.toLowerCase()} = `)}`)
  return `@${head[1].toLowerCase()}{${head[2]},\n${lines.join(',\n')}\n}`
}

/** Give a fetched or built entry Studio's own key, so keys are predictable across sources. */
export function rekey(bib: string, paper: LitResult): { key: string; bibtex: string } {
  const key = citeKey(field(bib, 'author'), field(bib, 'year') || paper.date?.slice(0, 4) || '', field(bib, 'title') || paper.title)
  const bibtex = formatBibtex(bib.trim().replace(/^@(\w+)\s*\{\s*[^,]*,/, (_, type: string) => `@${type}{${key},`))
  return { key, bibtex }
}

/** The registry's BibTeX for a DOI or arXiv id, or null when neither answers. */
export async function fetchBibtex(paper: LitResult, fetch: Fetcher): Promise<string | null> {
  const tries: [string, Record<string, string>][] = []
  if (paper.doi) tries.push([`https://doi.org/${paper.doi}`, { Accept: 'application/x-bibtex; charset=utf-8', 'User-Agent': UA }])
  if (paper.arxiv) tries.push([`https://arxiv.org/bibtex/${paper.arxiv}`, { 'User-Agent': UA }])
  for (const [url, headers] of tries) {
    try {
      const res = await fetch(url, { headers })
      const text = res.ok ? (await res.text()).trim() : ''
      if (text.startsWith('@')) return text
    } catch {
      // try the next source, then fall back to the registry record or the search result
    }
  }
  return null
}

const BIB_TYPES: Record<string, string> = {
  'journal-article': 'article',
  'article-journal': 'article',
  'proceedings-article': 'inproceedings',
  'paper-conference': 'inproceedings',
  'book-chapter': 'incollection',
  chapter: 'incollection',
  book: 'book',
  monograph: 'book',
  dissertation: 'phdthesis',
  thesis: 'phdthesis',
  report: 'techreport'
}

/** A BibTeX entry built from the registry's record, when the registry serves no BibTeX itself. */
export function recordBibtex(record: RegistryRecord, doi: string): string {
  const type = BIB_TYPES[record.type ?? ''] ?? 'misc'
  const lines = [`@${type}{KEY,`, `  title = {${bibEscape(record.title)}},`]
  // A name with no given part is an organisation or a name written whole; braces keep it one unit.
  if (record.authors.length) lines.push(`  author = {${record.authors.map((a) => (a.given ? bibEscape(`${a.family}, ${a.given}`) : `{${bibEscape(a.family)}}`)).join(' and ')}},`)
  const venue = { article: 'journal', misc: 'howpublished', techreport: 'institution', phdthesis: 'school' }[type] ?? 'booktitle'
  if (record.venue) lines.push(`  ${venue} = {${bibEscape(record.venue)}},`)
  if (record.publisher) lines.push(`  publisher = {${bibEscape(record.publisher)}},`)
  if (record.year) lines.push(`  year = {${record.year}},`)
  lines.push(`  doi = {${doi}},`, '}')
  return lines.join('\n')
}

/** The project's bibliography: `paper/references.bib`, another .bib in `paper/`, or a new one. */
export function bibliographyPath(projectDir: string): string {
  const preferred = join(projectDir, 'paper', 'references.bib')
  if (existsSync(preferred)) return 'paper/references.bib'
  try {
    const other = readdirSync(join(projectDir, 'paper')).find((n) => n.endsWith('.bib'))
    if (other) return `paper/${other}`
  } catch {
    // no paper folder yet
  }
  return 'paper/references.bib'
}

/** Append the entry unless the bibliography already has this paper (same DOI, URL or key). */
export function addToBibliography(projectDir: string, rel: string, key: string, bibtex: string, paper: LitResult): { key: string; added: boolean } {
  const abs = join(projectDir, rel)
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const entries = text.split(/(?=^@)/m)
  const same = entries.find(
    (e) =>
      (paper.doi && field(e, 'doi').toLowerCase() === paper.doi.toLowerCase()) ||
      (paper.arxiv && e.includes(paper.arxiv)) ||
      e.includes(paper.url)
  )
  const existingKey = same?.match(/^@\w+\s*\{\s*([^,\s]+)\s*,/)?.[1]
  if (existingKey) return { key: existingKey, added: false }
  // Distinct papers can share a key; suffix a letter as BibTeX styles do.
  let final = key
  for (let i = 0; new RegExp(`^@\\w+\\s*\\{\\s*${final}\\s*,`, 'm').test(text); i++) final = key + String.fromCharCode(97 + i)
  const entry = bibtex.replace(`{${key},`, `{${final},`)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, (text.trimEnd() ? text.trimEnd() + '\n\n' : '') + entry + '\n', 'utf8')
  return { key: final, added: true }
}

/**
 * Add a paper to the project's bibliography after asking the DOI system about it. A DOI that does
 * not exist, or that names a different paper than the search result, is not written; a DOI no
 * registry could answer for is written and reported as unchecked.
 */
export async function cite(projectDir: string, paper: LitResult, fetch: Fetcher): Promise<LitCitation> {
  const file = bibliographyPath(projectDir)
  let check: DoiCheck | undefined
  let target = paper
  if (paper.doi) {
    check = await resolveDoi(paper.doi, fetch)
    if (check.state === 'invalid' || (check.state === 'not_found' && paper.arxiv)) target = { ...paper, doi: undefined }
    else if (check.state === 'not_found') return { key: '', bibtex: '', file, added: false, refused: true, check, source: 'search' }
    const registryTitle = check.record?.title
    if (registryTitle && titleSimilarity(paper.title, registryTitle) < 0.5) {
      return { key: '', bibtex: '', file, added: false, refused: true, check, mismatch: registryTitle, source: 'search' }
    }
  } else if (paper.arxiv) check = await resolveDoi(`10.48550/arXiv.${paper.arxiv}`, fetch)
  const fetched = await fetchBibtex(target, fetch)
  const record = check?.state === 'resolves' ? check.record : undefined
  const built = fetched ?? (record && target.doi ? recordBibtex(record, target.doi) : null)
  const { key, bibtex } = rekey(built ?? fallbackBibtex(target), target)
  const result = addToBibliography(projectDir, file, key, bibtex, target)
  return {
    key: result.key,
    bibtex,
    file,
    added: result.added,
    check,
    source: fetched ? 'registry' : built ? 'record' : 'search',
    retracted: check?.notices.some((n) => n.kind === 'retraction' || n.kind === 'withdrawal') || undefined
  }
}

/** The peer-reviewed version of a preprint: the registry's version link, else a close title match. */
export async function publishedVersion(paper: LitResult, fetch: Fetcher): Promise<LitResult | null> {
  const doi = paper.doi ?? (paper.arxiv ? `10.48550/arXiv.${paper.arxiv}` : undefined)
  const linked = doi ? (await resolveDoi(doi, fetch)).record?.publishedAs?.[0] : undefined
  let found: { doi: string; record: RegistryRecord } | undefined
  if (linked) {
    const check = await resolveDoi(linked, fetch)
    if (check.state === 'resolves' && check.record) found = { doi: check.doi, record: check.record }
  }
  if (!found) {
    const surname = paper.byline && !/·|cited by/i.test(paper.byline) ? (paper.byline.split(/,|\band\b/)[0].trim().split(/\s+/).pop() ?? '') : ''
    const candidate = await findCandidate(paper.title, surname, Number(paper.date?.slice(0, 4)) || undefined, fetch, ['journal-article', 'proceedings-article', 'book-chapter'])
    if (candidate) found = candidate
  }
  if (!found) return null
  const r = found.record
  return {
    title: r.title,
    url: `https://doi.org/${found.doi}`,
    snippet: '',
    byline: [r.authors.slice(0, 3).map((a) => a.family).join(', ') + (r.authors.length > 3 ? ' et al.' : ''), r.venue].filter(Boolean).join(' · ') || undefined,
    date: r.year ? String(r.year) : undefined,
    doi: found.doi,
    kind: 'published',
    alts: [{ url: paper.url, kind: paper.kind ?? 'preprint', doi: paper.doi, arxiv: paper.arxiv }]
  }
}
