import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LitCitation, LitResult } from '@shared/types'

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>

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
export async function fetchBibtex(paper: LitResult, fetch: Fetch): Promise<string | null> {
  const tries: [string, Record<string, string>][] = []
  if (paper.doi) tries.push([`https://doi.org/${paper.doi}`, { Accept: 'application/x-bibtex; charset=utf-8' }])
  if (paper.arxiv) tries.push([`https://arxiv.org/bibtex/${paper.arxiv}`, {}])
  for (const [url, headers] of tries) {
    try {
      const res = await fetch(url, { headers })
      const text = res.ok ? (await res.text()).trim() : ''
      if (text.startsWith('@')) return text
    } catch {
      // try the next source, then fall back to the search result
    }
  }
  return null
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

export async function cite(projectDir: string, paper: LitResult, fetch: Fetch, retracted?: Promise<boolean | undefined>): Promise<LitCitation> {
  const fetched = await fetchBibtex(paper, fetch)
  const { key, bibtex } = rekey(fetched ?? fallbackBibtex(paper), paper)
  const file = bibliographyPath(projectDir)
  const result = addToBibliography(projectDir, file, key, bibtex, paper)
  return { key: result.key, bibtex, file, added: result.added, retracted: await retracted?.catch(() => undefined) }
}
