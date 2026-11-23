import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { DoiCheck, RefEntryCheck, RefProblem, RefReport, RefVerdict, RegistryRecord } from '@shared/types'
import { firstSurname, texDoi, titleSimilarity } from '@shared/biblio'

import { arxivId, parseBibtex, plainField, type BibEntry } from './bibtex'
export { arxivId, parseBibtex, plainField, withDoi, type BibEntry } from './bibtex'

import { authorMatches, findCandidate, resolveDoi, type Fetcher } from './registry'
export * from './registry'

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
          // Search records rank candidates; they are not a full notice check. Resolve the
          // matched DOI exactly as for an explicit DOI, including registry and OpenAlex flags.
          const check = await resolveDoi(candidate.doi, fetch)
          result.check = check
          compareRecord(entry, check.record ?? candidate.record, problems)
          if (check.state !== 'resolves') {
            problems.push({ code: 'unverifiable', severity: 'inconclusive', detail: check.error })
          } else {
            if (!check.record) problems.push({ code: 'no_record', severity: check.error ? 'inconclusive' : 'info', detail: check.error })
            noticeProblems(check, problems)
            publishedProblem(check.record ?? candidate.record, problems)
          }
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
