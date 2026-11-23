import { foldName, normalizeDoi, sameSurname, titleSimilarity } from '@shared/biblio'
import type { DoiCheck, RefCandidate, RegistryNotice, RegistryRecord } from '@shared/types'

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

