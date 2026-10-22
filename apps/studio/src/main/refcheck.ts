import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { DoiCheck, RefCandidate, RefEntryCheck, RefProblem, RefReport, RefVerdict, RegistryNotice, RegistryRecord } from '@shared/types'
import { detex, firstSurname, foldName, normalizeDoi, sameSurname, texDoi, titleSimilarity } from '@shared/biblio'

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
}
export type Fetcher = (url: string, init?: FetchInit) => Promise<{ status: number; ok: boolean; text(): Promise<string>; headers?: { get(name: string): string | null } }>

const UA = 'Mathodology (https://github.com/ymylive/mathodology)'
const JSON_HEADERS = { Accept: 'application/json', 'User-Agent': UA }

/** The DOI as a URL path, each segment escaped so parentheses, `#` and `?` survive. */
export function doiPath(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/')
}

/**
 * Crossref's public pool takes one request at a time; queue requests per host with a short gap.
 * Other registries are light enough to call in parallel.
 */
const GAPS: Record<string, number> = { 'api.crossref.org': 250 }
const tails = new Map<string, Promise<void>>()

async function gated<T>(url: string, run: () => Promise<T>): Promise<T> {
  const host = new URL(url).hostname
  const gap = GAPS[host]
  if (gap === undefined) return run()
  const prev = tails.get(host) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  tails.set(host, prev.then(() => mine))
  await prev
  try {
    return await run()
  } finally {
    setTimeout(release, gap)
  }
}

const RETRIES = 2

/** GET with the host's queue, retrying 429 and 503 after the server's Retry-After (at most 5 s). */
async function request(fetch: Fetcher, url: string, headers: Record<string, string>): ReturnType<Fetcher> {
  for (let attempt = 0; ; attempt++) {
    const res = await gated(url, () => fetch(url, { headers }))
    if ((res.status !== 429 && res.status !== 503) || attempt >= RETRIES) return res
    const after = Number(res.headers?.get('retry-after'))
    await new Promise((r) => setTimeout(r, Math.min(5000, Number.isFinite(after) && after >= 0 ? after * 1000 : 1000 * 2 ** attempt)))
  }
}

async function getJson(fetch: Fetcher, url: string, headers: Record<string, string> = JSON_HEADERS): Promise<{ status: number; body?: unknown }> {
  const res = await request(fetch, url, headers)
  if (!res.ok) return { status: res.status }
  try {
    return { status: res.status, body: JSON.parse(await res.text()) }
  } catch {
    return { status: res.status }
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '').replace(/\s+/g, ' ').trim()
const yearOf = (v: unknown): number | undefined => {
  const y = Number((v as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]?.[0] ?? v)
  return Number.isInteger(y) && y > 1000 ? y : undefined
}

const NOTICE_KINDS: Record<string, RegistryNotice['kind']> = {
  retraction: 'retraction',
  partial_retraction: 'retraction',
  removal: 'retraction',
  withdrawal: 'withdrawal',
  expression_of_concern: 'concern',
  correction: 'correction',
  corrigendum: 'correction',
  erratum: 'correction'
}

/** Notices a title carries, for publishers that rename the article instead of linking a notice. */
function titleNotices(title: string, source: string): RegistryNotice[] {
  if (/^\s*(retracted|retraction)\b/i.test(title)) return [{ kind: 'retraction', source }]
  if (/^\s*withdrawn\b/i.test(title)) return [{ kind: 'withdrawal', source }]
  if (/^\s*expression of concern\b/i.test(title)) return [{ kind: 'concern', source }]
  return []
}

interface CslName {
  family?: string
  given?: string
  literal?: string
  name?: string
}
const author = (a: CslName): { family: string; given?: string } =>
  a.family ? { family: a.family, given: a.given } : { family: a.literal ?? a.name ?? a.given ?? '' }

/** A Crossref `works` message as a registry record plus its update notices. */
export function parseCrossref(message: Record<string, unknown>): { record: RegistryRecord; notices: RegistryNotice[] } {
  const title = str(message.title)
  const subtitle = str(message.subtitle)
  const notices: RegistryNotice[] = []
  for (const u of (message['updated-by'] as { DOI?: string; type?: string; source?: string; updated?: unknown }[] | undefined) ?? []) {
    const kind = NOTICE_KINDS[(u.type ?? '').toLowerCase()]
    if (kind) notices.push({ kind, doi: u.DOI?.toLowerCase(), source: u.source === 'retraction-watch' ? 'retraction-watch' : 'crossref', year: yearOf(u.updated) })
  }
  if (!notices.some((n) => n.kind === 'retraction' || n.kind === 'withdrawal')) notices.push(...titleNotices(title, 'crossref'))
  const relation = (message.relation ?? {}) as Record<string, { id?: string; 'id-type'?: string }[]>
  const dois = (name: string): string[] => (relation[name] ?? []).filter((r) => r['id-type'] === 'doi' && r.id).map((r) => r.id!.toLowerCase())
  const own = String(message.DOI ?? '').toLowerCase()
  const updates: { DOI?: string; type?: string }[] = []
  for (const u of (message['update-to'] as { DOI?: string; type?: string }[] | undefined) ?? []) {
    const kind = NOTICE_KINDS[(u.type ?? '').toLowerCase()]
    if (!u.DOI || !kind) continue
    // Some publishers retract in place: the article's own record carries the update.
    if (u.DOI.toLowerCase() === own) notices.push({ kind, doi: own, source: 'crossref' })
    else updates.push(u)
  }
  const record: RegistryRecord = {
    title: subtitle && !title.toLowerCase().includes(subtitle.toLowerCase()) ? `${title}: ${subtitle}` : title,
    authors: ((message.author as CslName[] | undefined) ?? []).map(author).filter((a) => a.family),
    year: yearOf(message.issued) ?? yearOf(message['published-print']) ?? yearOf(message['published-online']),
    venue: str(message['container-title']) || str((message.institution as { name?: string }[] | undefined)?.[0]?.name) || undefined,
    type: str(message.type) || undefined,
    publisher: str(message.publisher) || undefined,
    publishedAs: dois('is-preprint-of'),
    noticeFor: updates.length ? { doi: updates[0].DOI!.toLowerCase(), kind: NOTICE_KINDS[updates[0].type!.toLowerCase()] } : undefined
  }
  return { record, notices }
}

/** A DataCite `dois` record (attributes) as a registry record. */
export function parseDatacite(attrs: Record<string, unknown>): { record: RegistryRecord; notices: RegistryNotice[] } {
  const title = str((attrs.titles as { title?: string }[] | undefined)?.find((t) => t.title)?.title)
  const creators = (attrs.creators as { name?: string; givenName?: string; familyName?: string }[] | undefined) ?? []
  const types = (attrs.types ?? {}) as { resourceTypeGeneral?: string; resourceType?: string }
  const publisher = attrs.publisher
  const related = (attrs.relatedIdentifiers as { relationType?: string; relatedIdentifier?: string; relatedIdentifierType?: string }[] | undefined) ?? []
  const record: RegistryRecord = {
    title,
    authors: creators
      .map((c) => (c.familyName ? { family: c.familyName, given: c.givenName } : { family: c.name?.includes(',') ? c.name.split(',')[0].trim() : (c.name ?? '') }))
      .filter((a) => a.family),
    year: Number(attrs.publicationYear) || undefined,
    venue: str((attrs.container as { title?: string } | undefined)?.title) || undefined,
    type: (types.resourceTypeGeneral ?? types.resourceType)?.toLowerCase(),
    publisher: typeof publisher === 'string' ? publisher : str((publisher as { name?: string } | undefined)?.name) || undefined,
    publishedAs: related
      .filter((r) => r.relatedIdentifierType === 'DOI' && /^(IsVersionOf|IsPreviousVersionOf)$/.test(r.relationType ?? '') && r.relatedIdentifier)
      .map((r) => r.relatedIdentifier!.toLowerCase())
  }
  return { record, notices: titleNotices(title, 'datacite') }
}

/** CSL JSON from doi.org content negotiation, for agencies without a public API here (mEDRA, JaLC, CNKI…). */
export function parseCsl(csl: Record<string, unknown>): { record: RegistryRecord; notices: RegistryNotice[] } {
  const title = str(csl.title)
  return {
    record: {
      title,
      authors: ((csl.author as CslName[] | undefined) ?? []).map(author).filter((a) => a.family),
      year: yearOf(csl.issued),
      venue: str(csl['container-title']) || undefined,
      type: str(csl.type) || undefined,
      publisher: str(csl.publisher) || undefined
    },
    notices: titleNotices(title, 'doi.org')
  }
}

/**
 * What the DOI system says about a DOI: it resolves (with the registry's record when one could be
 * read), it does not exist, or the question could not be answered. Only a definitive answer from
 * the DOI system counts as `not_found`; a timeout or an unreachable registry is `unverifiable`.
 */
export async function resolveDoi(raw: string, fetch: Fetcher): Promise<DoiCheck> {
  const doi = normalizeDoi(raw)
  if (!doi) return { doi: raw, state: 'invalid', notices: [] }
  const hit = cache.get(doi.toLowerCase())
  if (hit && hit.at > Date.now() - CACHE_MS) return structuredClone(hit.check)
  const check = await lookup(doi, fetch)
  // Only complete answers are kept; an unanswered or partial lookup is tried again next time.
  if (check.state !== 'unverifiable' && !check.error) {
    cache.set(doi.toLowerCase(), { at: Date.now(), check: structuredClone(check) })
    if (cache.size > 2000) cache.delete(cache.keys().next().value!)
  }
  return check
}

const CACHE_MS = 30 * 60_000
const cache = new Map<string, { at: number; check: DoiCheck }>()

export function clearDoiCache(): void {
  cache.clear()
}

async function lookup(doi: string, fetch: Fetcher): Promise<DoiCheck> {
  const path = doiPath(doi)
  let check: DoiCheck
  try {
    check = await registryCheck(doi, path, fetch)
  } catch (err) {
    return { doi, state: 'unverifiable', notices: [], error: String((err as Error).message ?? err) }
  }
  // OpenAlex merges Retraction Watch and publisher flags; a second opinion, never a reason to fail.
  if (check.state === 'resolves' && !check.notices.some((n) => n.kind === 'retraction')) {
    try {
      const oa = await getJson(fetch, `https://api.openalex.org/works/doi:${path}?select=id,is_retracted`)
      if ((oa.body as { is_retracted?: boolean } | undefined)?.is_retracted) check.notices.push({ kind: 'retraction', source: 'openalex' })
    } catch {
      // best effort
    }
  }
  return check
}

async function registryCheck(doi: string, path: string, fetch: Fetcher): Promise<DoiCheck> {
  const crossref = await getJson(fetch, `https://api.crossref.org/works/${path}`).catch(() => ({ status: 0, body: undefined }))
  const message = (crossref.body as { message?: Record<string, unknown> } | undefined)?.message
  if (message) return { doi, state: 'resolves', registry: 'crossref', ...parseCrossref(message) }

  // Not a Crossref record (or Crossref is down): ask the DOI system which agency registered it.
  const ra = await getJson(fetch, `https://doi.org/ra/${path}`)
  const entry = (ra.body as { RA?: string; status?: string }[] | undefined)?.[0]
  if (!entry) throw new Error(`doi.org answered ${ra.status || 'nothing'}`)
  if (!entry.RA) {
    if (/does not exist/i.test(entry.status ?? '')) return { doi, state: 'not_found', notices: [] }
    if (/invalid/i.test(entry.status ?? '')) return { doi, state: 'invalid', notices: [] }
    throw new Error(entry.status ?? 'doi.org gave no agency')
  }
  const agency = entry.RA.toLowerCase()
  const base: DoiCheck = { doi, state: 'resolves', registry: agency, notices: [] }
  try {
    if (agency === 'crossref') return { ...base, error: `Crossref answered ${crossref.status || 'nothing'}` }
    if (agency === 'datacite') {
      const dc = await getJson(fetch, `https://api.datacite.org/dois/${path}`)
      const attrs = (dc.body as { data?: { attributes?: Record<string, unknown> } } | undefined)?.data?.attributes
      if (attrs) return { ...base, ...parseDatacite(attrs) }
    }
    const csl = await getJson(fetch, `https://doi.org/${path}`, { Accept: 'application/vnd.citationstyles.csl+json', 'User-Agent': UA })
    if (csl.body && typeof csl.body === 'object') return { ...base, ...parseCsl(csl.body as Record<string, unknown>) }
    return { ...base, error: `${entry.RA} gave no metadata` }
  } catch (err) {
    return { ...base, error: String((err as Error).message ?? err) }
  }
}

/** A registry record whose title matches, for a reference written without a DOI. */
export async function findCandidate(
  title: string,
  surname: string,
  year: number | undefined,
  fetch: Fetcher,
  types?: string[]
): Promise<RefCandidate | undefined> {
  const q = new URLSearchParams({ 'query.bibliographic': [title, surname, year].filter(Boolean).join(' '), rows: '5', select: 'DOI,title,subtitle,author,issued,type,container-title' })
  const res = await getJson(fetch, `https://api.crossref.org/works?${q}`)
  const items = (res.body as { message?: { items?: Record<string, unknown>[] } } | undefined)?.message?.items ?? []
  let best: RefCandidate | undefined
  for (const item of items) {
    const { record } = parseCrossref(item)
    if (types && !types.includes(record.type ?? '')) continue
    const similarity = titleSimilarity(title, record.title)
    if (similarity < 0.9) continue
    // Same title, different first author: a different work (or a reply to it).
    if (surname && record.authors[0] && !authorMatches(surname, record.authors.slice(0, 3))) continue
    // Prefer the original work over chapters, reviews and notices that reuse its title.
    const score = similarity + (record.type === 'journal-article' || record.type === 'proceedings-article' ? 0.05 : 0) + (year && record.year && Math.abs(record.year - year) <= 1 ? 0.05 : 0)
    if (!best || score > best.score) best = { doi: String(item.DOI).toLowerCase(), record, similarity, score, via: 'crossref' }
  }
  return best
}

const HAN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u

/** Whether a reference's first-author name matches one of the registry's authors. */
export function authorMatches(written: string, authors: { family: string; given?: string }[]): boolean {
  const plain = foldName(written).replace(/[\s,]/g, '')
  return authors.some((a) => {
    if (sameSurname(written, a.family)) return true
    // East Asian names are often written whole, family name first, with no separator.
    if (HAN.test(written) || HAN.test(a.family)) {
      const family = foldName(a.family).replace(/\s/g, '')
      const whole = family + foldName(a.given ?? '').replace(/\s/g, '')
      return plain === whole || plain === family || (family.length > 0 && plain.startsWith(family)) || (whole.length > 1 && whole.startsWith(plain))
    }
    return false
  })
}

/** One entry of a .bib file, fields lowercased with braces kept as written. */
export interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
  /** 1-based line of the `@type{key,` head. */
  line: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** BibTeX entries in a file; `@string` macros are expanded, `@comment` and `@preamble` skipped. */
export function parseBibtex(text: string): BibEntry[] {
  const out: BibEntry[] = []
  // Month names are predefined macros: month = apr.
  const strings: Record<string, string> = Object.fromEntries(MONTHS.map((m) => [m, m[0].toUpperCase() + m.slice(1)]))
  const head = /@(\w+)\s*([{(])/g
  let m: RegExpExecArray | null
  while ((m = head.exec(text))) {
    const type = m[1].toLowerCase()
    const close = m[2] === '{' ? '}' : ')'
    if (type === 'comment' || type === 'preamble') {
      // Skip the whole group, so an entry written inside a comment is not read.
      let depth = 1
      let i = head.lastIndex
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === m[2]) depth++
        else if (text[i] === close) depth--
      }
      head.lastIndex = i
      continue
    }
    let i = head.lastIndex
    let key = ''
    if (type !== 'string') {
      const k = /\s*([^,\s]*)\s*,/y
      k.lastIndex = i
      const km = k.exec(text)
      if (!km) continue
      key = km[1]
      i = k.lastIndex
    }
    const fields: Record<string, string> = {}
    while (i < text.length) {
      const name = /\s*([\w:.-]+)\s*=\s*/y
      name.lastIndex = i
      const nm = name.exec(text)
      if (!nm) break
      i = name.lastIndex
      let value = ''
      // A value is a braced group, a quoted string, a number or a macro, joined by `#`.
      for (;;) {
        while (/\s/.test(text[i] ?? '')) i++
        if (text[i] === '{') {
          let depth = 0
          const start = i
          for (; i < text.length; i++) {
            if (text[i] === '\\') i++
            else if (text[i] === '{') depth++
            else if (text[i] === '}' && --depth === 0) break
          }
          value += text.slice(start + 1, i)
          i++
        } else if (text[i] === '"') {
          const start = ++i
          let depth = 0
          for (; i < text.length; i++) {
            if (text[i] === '\\') i++
            else if (text[i] === '{') depth++
            else if (text[i] === '}') depth--
            else if (text[i] === '"' && depth === 0) break
          }
          value += text.slice(start, i)
          i++
        } else {
          const bare = /[^\s,#}\)]+/y
          bare.lastIndex = i
          const b = bare.exec(text)
          if (!b) break
          // A bare word is a number or a macro; an undefined macro is kept as written.
          value += /^\d+$/.test(b[0]) ? b[0] : (strings[b[0].toLowerCase()] ?? b[0])
          i = bare.lastIndex
        }
        while (/\s/.test(text[i] ?? '')) i++
        if (text[i] === '#') i++
        else break
      }
      fields[nm[1].toLowerCase()] = value.replace(/\s+/g, ' ').trim()
      while (/\s/.test(text[i] ?? '')) i++
      if (text[i] === ',') i++
      else break
    }
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] === close) i++
    head.lastIndex = i
    if (type === 'string') Object.assign(strings, fields)
    else out.push({ type, key, fields, line: text.slice(0, m.index).split('\n').length })
  }
  return out
}

/** Text of a field with TeX grouping and common accent commands removed. */
export function plainField(value: string | undefined): string {
  return detex(value ?? '')
    .replace(/\\(?:textit|textbf|emph|mathrm|text)\s*\{([^{}]*)\}/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The arXiv identifier an entry names in `eprint`, its journal line or its URL. */
export function arxivId(fields: Record<string, string>): string | undefined {
  const isArxiv = /arxiv/i.test(`${fields.archiveprefix ?? ''} ${fields.eprinttype ?? ''}`)
  const id = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/i
  if (fields.eprint && (isArxiv || id.test(fields.eprint.trim()))) return fields.eprint.trim().replace(/v\d+$/, '').replace(/^arxiv:/i, '')
  const text = `${fields.journal ?? ''} ${fields.url ?? ''} ${fields.howpublished ?? ''} ${fields.note ?? ''}`
  return text.match(/arxiv(?:\.org\/(?:abs|pdf)\/|:\s*)((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))/i)?.[1]
}

const SEVERITY_ORDER: Record<RefVerdict, number> = { fail: 4, warn: 3, inconclusive: 2, ok: 0 }

/** Compare what an entry says with the registry's record. */
export function compareRecord(entry: BibEntry, record: RegistryRecord, problems: RefProblem[]): void {
  const title = plainField(entry.fields.title)
  if (title && record.title) {
    const sim = titleSimilarity(title, record.title)
    if (sim < 0.5) problems.push({ code: 'title_mismatch', severity: 'fail', detail: record.title })
    else if (sim < 0.8) problems.push({ code: 'title_differs', severity: 'warn', detail: record.title })
  }
  const written = plainField(firstSurname(entry.fields.author ?? entry.fields.editor ?? ''))
  if (written && record.authors.length) {
    if (!authorMatches(written, record.authors.slice(0, 1))) {
      const listed = authorMatches(written, record.authors)
      problems.push({ code: 'author_differs', severity: listed ? 'info' : 'warn', detail: record.authors.slice(0, 3).map((a) => a.family).join(', ') })
    }
  }
  const year = Number(entry.fields.year?.match(/\d{4}/)?.[0])
  if (year && record.year && year !== record.year) {
    problems.push({ code: 'year_differs', severity: Math.abs(year - record.year) > 1 ? 'warn' : 'info', detail: String(record.year) })
  }
}

export function noticeProblems(check: DoiCheck, problems: RefProblem[]): void {
  const seen = new Set<string>()
  for (const n of check.notices) {
    if (seen.has(n.kind)) continue
    seen.add(n.kind)
    const code = n.kind === 'retraction' ? 'retracted' : n.kind === 'withdrawal' ? 'withdrawn' : n.kind === 'concern' ? 'concern' : 'corrected'
    const severity = n.kind === 'retraction' || n.kind === 'withdrawal' ? 'fail' : n.kind === 'concern' ? 'warn' : 'info'
    problems.push({ code, severity, detail: [n.doi, n.source].filter(Boolean).join(' · ') })
  }
  if (check.record?.noticeFor) problems.push({ code: 'is_notice', severity: 'warn', detail: check.record.noticeFor.doi })
}

/** A preprint whose registry links the published version should usually cite that instead. */
function publishedProblem(record: RegistryRecord | undefined, problems: RefProblem[]): void {
  const published = record?.publishedAs?.[0]
  if (published) problems.push({ code: 'has_published', severity: 'warn', detail: published })
}

export function verdictOf(problems: RefProblem[]): RefVerdict {
  let v: RefVerdict = 'ok'
  for (const p of problems) {
    const pv: RefVerdict = p.severity === 'fail' ? 'fail' : p.severity === 'warn' ? 'warn' : p.severity === 'inconclusive' ? 'inconclusive' : 'ok'
    if (SEVERITY_ORDER[pv] > SEVERITY_ORDER[v]) v = pv
  }
  return v
}

/**
 * Check one bibliography entry against the registries: its DOI resolves and the record agrees with
 * the title, first author and year written; an entry without a DOI gets a registry candidate when
 * one matches closely.
 */
export async function checkEntry(entry: BibEntry, fetch: Fetcher): Promise<RefEntryCheck> {
  const title = plainField(entry.fields.title)
  const author = plainField(entry.fields.author ?? entry.fields.editor)
  const year = entry.fields.year?.match(/\d{4}/)?.[0]
  const result: RefEntryCheck = { key: entry.key, type: entry.type, line: entry.line, title, author, year, verdict: 'ok', problems: [] }
  const problems = result.problems
  if (!title) problems.push({ code: 'no_title', severity: 'warn' })
  const written = entry.fields.doi?.trim()
  if (written) {
    result.doi = written
    const check = await resolveDoi(texDoi(written), fetch)
    result.check = check
    if (check.state === 'invalid') problems.push({ code: 'invalid_doi', severity: 'fail' })
    else if (check.state === 'not_found') problems.push({ code: 'not_found', severity: 'fail' })
    else if (check.state === 'unverifiable') problems.push({ code: 'unverifiable', severity: 'inconclusive', detail: check.error })
    else {
      if (check.record) compareRecord(entry, check.record, problems)
      // The DOI exists, but with no record (Crossref rate-limited or down, an agency with no metadata) the
      // title, author and year went unchecked.
      else problems.push({ code: 'no_record', severity: check.error ? 'inconclusive' : 'info', detail: check.error })
      noticeProblems(check, problems)
      publishedProblem(check.record, problems)
    }
  } else {
    const arxiv = arxivId(entry.fields)
    try {
      if (arxiv) {
        const doi = `10.48550/arXiv.${arxiv}`
        const check = await resolveDoi(doi, fetch)
        if (check.state === 'not_found') problems.push({ code: 'arxiv_not_found', severity: 'fail', detail: arxiv })
        else if (check.record) {
          result.candidate = { doi, record: check.record, similarity: titleSimilarity(title, check.record.title), score: 1, via: 'arxiv' }
          compareRecord(entry, check.record, problems)
          noticeProblems(check, problems)
          publishedProblem(check.record, problems)
          problems.push({ code: 'no_doi', severity: 'info' })
        } else problems.push({ code: 'unverifiable', severity: 'inconclusive', detail: check.error })
      } else if (title && title.split(/\s+/).length >= 3) {
        const candidate = await findCandidate(title, plainField(firstSurname(entry.fields.author ?? '')), year ? Number(year) : undefined, fetch)
        if (candidate) {
          result.candidate = candidate
          compareRecord(entry, candidate.record, problems)
          problems.push({ code: 'no_doi', severity: 'info' })
        } else problems.push({ code: 'no_match', severity: 'inconclusive' })
      } else problems.push({ code: 'no_match', severity: 'inconclusive' })
    } catch (err) {
      problems.push({ code: 'unverifiable', severity: 'inconclusive', detail: String((err as Error).message ?? err) })
    }
  }
  result.verdict = verdictOf(problems)
  return result
}

/** Run `fn` over items with at most `limit` in flight, spacing starts to stay polite to the registries. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, gapMs = 120): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let last = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      const wait = last + gapMs - Date.now()
      last = Math.max(Date.now(), last + gapMs)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Insert `doi = {…}` into the entry with this key, unless it already has one. */
export function withDoi(text: string, key: string, doi: string): string | null {
  const head = new RegExp(`(@\\w+\\s*[{(]\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,)`)
  const m = head.exec(text)
  if (!m) return null
  const entry = parseBibtex(text.slice(m.index)).find((e) => e.key === key)
  if (!entry || entry.fields.doi) return null
  const indent = /\n([ \t]+)\w/.exec(text.slice(m.index))?.[1] ?? '  '
  return text.slice(0, m.index + m[0].length) + `\n${indent}doi = {${doi}},` + text.slice(m.index + m[0].length)
}

/** .bib files under the project, nearest first, skipping hidden, dependency and output folders. */
export function bibFiles(projectDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    let names: import('node:fs').Dirent[]
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of names) {
      if (d.isFile() && d.name.endsWith('.bib')) out.push(relative(projectDir, join(dir, d.name)).split('\\').join('/'))
    }
    if (depth === 0) return
    for (const d of names) {
      if (d.isDirectory() && !d.name.startsWith('.') && !/^(node_modules|__pycache__|venv|out|dist|build)$/.test(d.name)) walk(join(dir, d.name), depth - 1)
    }
  }
  walk(projectDir, 3)
  return out.sort((a, b) => Number(!a.startsWith('paper/')) - Number(!b.startsWith('paper/')) || a.split('/').length - b.split('/').length || a.localeCompare(b))
}

/** Check every entry of one bibliography file, a few at a time. */
export async function checkBibliography(
  projectDir: string,
  rel: string | undefined,
  fetch: Fetcher,
  onProgress?: (done: number, total: number) => void
): Promise<RefReport> {
  const files = bibFiles(projectDir)
  const file = rel && files.includes(rel) ? rel : files[0]
  if (!file) return { file: '', files, checkedAt: Date.now(), entries: [] }
  const entries = parseBibtex(readFileSync(join(projectDir, file), 'utf8'))
  let done = 0
  onProgress?.(0, entries.length)
  const checked = await mapLimit(entries, 4, async (e) => {
    const r = await checkEntry(e, fetch)
    onProgress?.(++done, entries.length)
    return r
  })
  return { file, files, checkedAt: Date.now(), entries: checked }
}
