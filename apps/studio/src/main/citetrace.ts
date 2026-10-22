import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { doiMatches, firstSurname, foldName, foldText, texDoi } from '@shared/biblio'
import type { CitationTrace, DoiCheck, Project, ReviewFinding, SessionEvent } from '@shared/types'
import { bibFiles, mapLimit, parseBibtex, plainField, resolveDoi, type BibEntry, type Fetcher } from './refcheck'

/** Text formats whose citations are checked when the session produced them. */
const DOCUMENT = /\.(md|markdown|tex|qmd|rmd|typ|txt|rst)$/i
const RESOLVE_LIMIT = 15

export type CitedKind = 'doi' | 'arxiv' | 'pmid' | 'nct' | 'cite' | 'author_year'

export interface Cited {
  kind: CitedKind
  /** Normalized identifier; for author-year citations `surname year`. */
  id: string
  /** As written, for display. */
  text: string
  /** Character offset in the source text. */
  at: number
}

/** Capitalised words that precede a year without naming an author: sentence words, dates, places ((September, 2021), (Beijing, 2020)). */
const STOP = new Set(
  [
    'the a an in on at by for from since during until as of to see table figure fig eq section chapter appendix model data step phase year',
    'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec',
    'spring summer autumn fall winter monday tuesday wednesday thursday friday saturday sunday',
    'africa america asia europe oceania china japan korea india russia germany france britain england italy spain canada australia brazil mexico',
    'beijing shanghai tianjin chongqing guangzhou shenzhen wuhan nanjing hangzhou chengdu taiwan macau singapore london paris berlin tokyo moscow sydney toronto'
  ]
    .join(' ')
    .split(' ')
)

/** Common Chinese surnames, to tell 王桂民等 (a three-character name) from 如李明等 (如 + 李明). */
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤欧司陳劉張黃趙吳孫馬鄭羅謝許韓馮鄧蕭蔣蘇呂葉錢嚴譚陸盧鍾龔賈楊歐'

/** Identifiers and author-year references written in a text. */
export function extractCitations(text: string): Cited[] {
  const out: Cited[] = []
  const add = (kind: CitedKind, id: string, written: string, at: number): void => {
    if (!out.some((c) => c.kind === kind && c.id === id)) out.push({ kind, id, text: written, at })
  }
  for (const { doi, at } of doiMatches(text)) add('doi', doi.toLowerCase(), doi, at)
  for (const m of text.matchAll(/\barxiv(?:\.org\/(?:abs|pdf)\/|:\s*)(\d{4}\.\d{4,5})(?:v\d+)?/gi)) add('arxiv', m[1], `arXiv:${m[1]}`, m.index)
  for (const m of text.matchAll(/\bPMID:?\s*(\d{6,9})\b/gi)) add('pmid', m[1], `PMID ${m[1]}`, m.index)
  for (const m of text.matchAll(/\bNCT\d{8}\b/g)) add('nct', m[0], m[0], m.index)
  for (const m of text.matchAll(/\\(?:no)?(?:cite|citep|citet|parencite|textcite|autocite|footcite|citeauthor|citeyear)\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g)) {
    for (const key of m[1].split(',').map((k) => k.trim())) if (key && key !== '*') add('cite', key, key, m.index)
  }
  // A capitalised surname, allowing inner capitals and particles' joins: McKendrick, O'Neil, Lotka-Volterra, Müller.
  const word = String.raw`\p{Lu}(?:\p{Ll}|['’-]|\p{Lu}(?=\p{Ll}))+`
  // The surname alone, or with a capitalised particle (De Jong, Van Dyke); never the sentence word before it.
  const name = String.raw`(?<![\p{L}'’-])(?:(?:De|Del|Della|Di|Da|Du|Le|La|Van|Von|Mac)\s+)?${word}`
  const patterns = [
    new RegExp(String.raw`(${name})\s+et\s+al\.?,?\s*(?:[(（]((?:1[89]|20)\d{2})[a-z]?[)）;,]|((?:1[89]|20)\d{2})\b)`, 'gu'),
    new RegExp(String.raw`(${name})\s+(?:and|&)\s+${name},?\s*[(（]((?:1[89]|20)\d{2})[a-z]?[)）]`, 'gu'),
    new RegExp(String.raw`[(（](${name})(?:\s+et\s+al\.?|\s+(?:and|&)\s+${name})?,\s*((?:1[89]|20)\d{2})[a-z]?[;)）]`, 'gu')
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (STOP.has(m[1].toLowerCase())) continue
      const written = m[0].startsWith('(') || m[0].startsWith('（') ? m[0].slice(1, -1) : m[0].replace(/[;,]$/, '')
      add('author_year', `${foldName(m[1])} ${m[2] ?? m[3]}`, written, m.index)
    }
  }
  // A Chinese name is the two or three characters right before 等; three when the first is a surname.
  for (const m of text.matchAll(/(\p{Script=Han}{2,3})等人?\s*[(（]((?:1[89]|20)\d{2})[a-z]?[)）]/gu)) {
    const skip = m[1].length === 3 && !SURNAMES.includes(m[1][0]) ? 1 : 0
    add('author_year', `${foldName(m[1].slice(skip))} ${m[2]}`, m[0].slice(skip), m.index + skip)
  }
  return out.sort((a, b) => a.at - b.at)
}

function lineAt(text: string, at: number): number {
  return text.slice(0, at).split('\n').length
}

/** Whether a text (folded with `foldText`) records an identifier: DOIs and ids anywhere, author-year as surname near year. */
function mentions(corpus: string, c: Cited): boolean {
  if (c.kind === 'doi') return corpus.includes(c.id) || corpus.includes(encodeURIComponent(c.id).toLowerCase())
  if (c.kind === 'author_year') {
    const [surname, year] = [c.id.slice(0, c.id.lastIndexOf(' ')), c.id.slice(c.id.lastIndexOf(' ') + 1)]
    for (let i = corpus.indexOf(surname); i >= 0; i = corpus.indexOf(surname, i + 1)) {
      if (corpus.slice(Math.max(0, i - 400), i + 400).includes(year)) return true
    }
    return false
  }
  return corpus.includes(c.id.toLowerCase())
}

interface Source {
  /** Project-relative path, or `reply` for the agent's messages. */
  where: string
  text: string
  document: boolean
}

export interface TraceInput {
  project: Project
  events: SessionEvent[]
  fetch: Fetcher
  language: 'zh-CN' | 'en'
  /** Stops waiting for DOI lookups; those not answered by then count as unverifiable. */
  signal?: AbortSignal
}

const L = {
  'zh-CN': {
    notFound: (id: string) => `DOI 不存在：${id}`,
    notFoundDetail: (where: string) => `${where} 引用了这个 DOI，但 DOI 系统里没有它，会话中也没有任何检索结果给出它；很可能是编造或抄错的。`,
    retracted: (id: string) => `引用了已撤稿的论文：${id}`,
    retractedDetail: (where: string, title: string, source: string) => `${where} 引用的《${title}》已被撤稿（${source}）。`,
    unsourced: (id: string) => `DOI 没有检索来源：${id}`,
    unsourcedDetail: (where: string, title: string) => `${where} 的这个 DOI 存在，登记的是《${title}》，但会话里没有检索或读取过它，引用处附近也没有它的作者。请确认它就是要引用的那篇。`,
    missingKeys: (where: string) => `${where} 引用了参考文献里没有的条目`,
    missingKeysDetail: (keys: string) => `这些 \\cite 键在项目的 .bib 中找不到：${keys}。编译时会变成问号，也可能是凭空写出的引用。`,
    untraced: (where: string) => `${where} 中的引用找不到来源`,
    untracedDetail: (items: string) => `以下引用在会话的检索结果、用户消息和参考文献里都找不到：${items}。`,
    unchecked: 'DOI 未能核验',
    uncheckedDetail: (items: string) => `登记机构没有应答，以下 DOI 是否存在尚未确认：${items}。`,
    timedOut: 'DOI 核验超时',
    timedOutDetail: (items: string) => `登记机构没有及时应答，Studio 停止了等待，以下 DOI 未核验：${items}。其余引用的核验结果照常列出。`,
    fixNotFound: '找到这篇文献的真实出处并替换，找不到就删除这条引用。',
    fixRetracted: '确认是否必须引用；如需引用，注明已撤稿，结论不要依赖它。',
    fixUnsourced: '用检索或打开 DOI 页面核对标题和作者。',
    fixMissing: '把对应条目加入 .bib（从 DOI 或 arXiv 取得），或改正键名。',
    fixUntraced: '逐条检索核实，补上 DOI 或可访问的链接；无法核实的删除。',
    reply: '回复'
  },
  en: {
    notFound: (id: string) => `DOI does not exist: ${id}`,
    notFoundDetail: (where: string) => `${where} cites this DOI, but the DOI system has no record of it and no search result in the session gave it; it is likely made up or mistyped.`,
    retracted: (id: string) => `Cites a retracted paper: ${id}`,
    retractedDetail: (where: string, title: string, source: string) => `"${title}", cited in ${where}, has been retracted (${source}).`,
    unsourced: (id: string) => `DOI with no recorded source: ${id}`,
    unsourcedDetail: (where: string, title: string) => `This DOI in ${where} exists and is registered to "${title}", but the session never searched for or opened it, and its author does not appear near the citation. Confirm it is the intended work.`,
    missingKeys: (where: string) => `${where} cites keys missing from the bibliography`,
    missingKeysDetail: (keys: string) => `These \\cite keys are not in any project .bib: ${keys}. They will compile as question marks and may be invented references.`,
    untraced: (where: string) => `Citations in ${where} have no source`,
    untracedDetail: (items: string) => `These citations appear in no search result, user message or bibliography in the session: ${items}.`,
    unchecked: 'DOIs could not be checked',
    uncheckedDetail: (items: string) => `No registry answered, so it is not confirmed that these DOIs exist: ${items}.`,
    timedOut: 'DOI lookups timed out',
    timedOutDetail: (items: string) => `The registries did not answer in time and Studio stopped waiting, so these DOIs were not checked: ${items}. The other citation findings stand.`,
    fixNotFound: 'Find the real source and replace it, or remove the citation.',
    fixRetracted: 'Decide whether it must be cited; if so, mark it as retracted and do not rest conclusions on it.',
    fixUnsourced: 'Search for it or open the DOI page to confirm the title and authors.',
    fixMissing: 'Add the entries to the .bib (from the DOI or arXiv) or correct the keys.',
    fixUntraced: 'Look each one up and add a DOI or a reachable link; remove what cannot be confirmed.',
    reply: 'the replies'
  }
}

/**
 * Trace every citation in the agent's replies and in the documents the session produced to the
 * session's own record: a tool result that retrieved it, a user message, or the project
 * bibliography. Untraced DOIs (and arXiv ids) are looked up in the DOI system; one that does not
 * exist is reported as likely fabricated. Returns findings plus counts for the reviewer prompt.
 */
export async function traceCitations({ project, events, fetch, language, signal }: TraceInput): Promise<{ trace: CitationTrace; findings: Omit<ReviewFinding, 'id'>[] }> {
  const text = L[language === 'en' ? 'en' : 'zh-CN']
  const calls = new Map<string, Extract<SessionEvent, { kind: 'tool.call' }>>()
  for (const e of events) if (e.kind === 'tool.call') calls.set(e.callId, e)

  const documents = new Set<string>()
  for (const e of events) if (e.kind === 'artifact.version' && DOCUMENT.test(e.rel)) documents.add(e.rel)

  // What the session retrieved: tool results other than the agent writing or re-reading its own documents.
  const own = [...documents].map((d) => basename(d))
  const retrieved: string[] = []
  const userText: string[] = []
  for (const e of events) {
    if (e.kind === 'user.message') userText.push(e.text)
    if (e.kind !== 'tool.result' || e.isError) continue
    const call = calls.get(e.callId)
    if (!call || ['edit', 'write', 'todo', 'task', 'skill'].includes(call.toolKind)) continue
    const input = JSON.stringify(call.input ?? {})
    if ((call.toolKind === 'read' || call.toolKind === 'shell') && (own.some((d) => input.includes(d)) || /\.bib\b/.test(input))) continue
    retrieved.push(e.output)
  }
  // Folded like the names looked up in them: Müller in a reply traces to a source writing Müller, Muller or M\"uller.
  const corpus = foldText(retrieved.join('\n'))
  const userCorpus = foldText(userText.join('\n'))

  const bib: BibEntry[] = []
  for (const rel of bibFiles(project.path)) {
    try {
      bib.push(...parseBibtex(readFileSync(join(project.path, rel), 'utf8')))
    } catch {
      // unreadable bibliography
    }
  }
  const bibKeys = new Set(bib.map((b) => b.key))
  const bibCorpus = foldText(bib.map((b) => `${texDoi(b.fields.doi ?? '')} ${b.fields.eprint ?? ''} ${b.fields.url ?? ''} ${b.fields.pmid ?? ''} ${b.fields.journal ?? ''}`).join('\n'))
  const bibAuthorYears = new Set(bib.map((b) => `${foldName(plainField(firstSurname(b.fields.author ?? b.fields.editor ?? '')))} ${b.fields.year?.match(/\d{4}/)?.[0] ?? ''}`))

  const sources: Source[] = []
  const replies = events.filter((e): e is Extract<SessionEvent, { kind: 'assistant.text' }> => e.kind === 'assistant.text' && !e.parentCallId).map((e) => e.text)
  if (replies.length) sources.push({ where: 'reply', text: replies.join('\n\n'), document: false })
  for (const rel of documents) {
    const abs = join(project.path, rel)
    try {
      if (existsSync(abs) && statSync(abs).size < 2_000_000) sources.push({ where: rel, text: readFileSync(abs, 'utf8'), document: true })
    } catch {
      // gone or unreadable
    }
  }
  // A document's own reference list (\bibitem[label]{key}) defines keys too.
  for (const s of sources) {
    if (s.document) for (const m of s.text.matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) bibKeys.add(m[1].trim())
  }

  const trace: CitationTrace = { found: 0, traced: 0, bibOnly: 0, untraced: 0, resolved: 0, notFound: 0, unverifiable: 0 }
  const findings: Omit<ReviewFinding, 'id'>[] = []
  const toResolve: { doi: string; cited: Cited; source: Source; traced: boolean }[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    const where = source.where === 'reply' ? text.reply : source.where
    const missingKeys: string[] = []
    const untraced: string[] = []
    for (const c of extractCitations(source.text)) {
      if (c.kind === 'cite') {
        if (!bibKeys.has(c.id)) missingKeys.push(c.id)
        continue
      }
      const key = `${c.kind}:${c.id}`
      const first = !seen.has(key)
      seen.add(key)
      if (first) trace.found++
      const inSession = mentions(corpus, c) || mentions(userCorpus, c)
      const inBib = !inSession && (c.kind === 'author_year' ? bibAuthorYears.has(c.id) : mentions(bibCorpus, c))
      if (first) {
        if (inSession) trace.traced++
        else if (inBib) trace.bibOnly++
        else trace.untraced++
      }
      const doi = c.kind === 'doi' ? c.id : c.kind === 'arxiv' ? `10.48550/arxiv.${c.id}` : undefined
      // Traced DOIs are still looked up for retractions, after the untraced ones.
      if (doi && first) toResolve.push({ doi, cited: c, source, traced: inSession || inBib })
      if (!inSession && !inBib && !doi) untraced.push(c.text.trim())
    }
    if (missingKeys.length && source.document) {
      findings.push({
        kind: 'citation',
        severity: 'fail',
        title: text.missingKeys(where),
        detail: text.missingKeysDetail(missingKeys.slice(0, 20).join(', ')),
        evidence: [source.where],
        suggestion: text.fixMissing,
        status: 'open'
      })
    }
    if (untraced.length) {
      findings.push({
        kind: 'citation',
        severity: source.document ? 'warn' : 'inconclusive',
        title: text.untraced(where),
        detail: text.untracedDetail(untraced.slice(0, 12).join('; ')),
        evidence: source.document ? [source.where] : [],
        suggestion: text.fixUntraced,
        status: 'open'
      })
    }
  }

  toResolve.sort((a, b) => Number(a.traced) - Number(b.traced) || Number(b.source.document) - Number(a.source.document))
  const batch = toResolve.slice(0, RESOLVE_LIMIT)
  // Answers are kept as they arrive, so stopping early keeps every lookup that already finished.
  const checks: (DoiCheck | undefined)[] = []
  const stopped = new Promise<void>((resolve) => {
    if (signal?.aborted) resolve()
    signal?.addEventListener('abort', () => resolve(), { once: true })
  })
  await Promise.race([
    mapLimit(batch, 4, async (r, i) => {
      if (!signal?.aborted) checks[i] = await resolveDoi(r.doi, fetch)
    }),
    stopped
  ])
  const unchecked: string[] = []
  const late: string[] = []
  batch.forEach((r, i) => {
    const check = checks[i]
    const where = r.source.where === 'reply' ? text.reply : `${r.source.where}:${lineAt(r.source.text, r.cited.at)}`
    const evidence = r.source.document ? [r.source.where] : []
    if (!check) {
      trace.unverifiable++
      late.push(r.cited.text)
      return
    }
    if (check.state === 'unverifiable') {
      trace.unverifiable++
      if (!r.traced) unchecked.push(r.cited.text)
      return
    }
    trace.resolved++
    if (check.state === 'not_found' || check.state === 'invalid') {
      trace.notFound++
      findings.push({ kind: 'citation', severity: 'fail', title: text.notFound(r.cited.text), detail: text.notFoundDetail(where), evidence, suggestion: text.fixNotFound, status: 'open' })
      return
    }
    const retraction = check.notices.find((n) => n.kind === 'retraction' || n.kind === 'withdrawal')
    if (retraction) {
      findings.push({
        kind: 'citation',
        severity: 'fail',
        title: text.retracted(r.cited.text),
        detail: text.retractedDetail(where, check.record?.title ?? r.cited.text, retraction.source ?? 'registry'),
        evidence,
        suggestion: text.fixRetracted,
        status: 'open'
      })
      return
    }
    if (r.traced || !check.record) return
    // An author named next to the DOI is a sign the writer had the actual paper in front of them.
    const near = r.source.text.slice(Math.max(0, r.cited.at - 400), r.cited.at + 400)
    const authorNear = check.record.authors.slice(0, 3).some((a) => a.family.length > 1 && foldName(near).includes(foldName(a.family)))
    if (!authorNear) {
      findings.push({
        kind: 'citation',
        severity: r.source.document ? 'warn' : 'inconclusive',
        title: text.unsourced(r.cited.text),
        detail: text.unsourcedDetail(where, check.record.title),
        evidence,
        suggestion: text.fixUnsourced,
        status: 'open'
      })
    }
  })
  if (unchecked.length) {
    findings.push({ kind: 'citation', severity: 'inconclusive', title: text.unchecked, detail: text.uncheckedDetail(unchecked.join(', ')), evidence: [], status: 'open' })
  }
  if (late.length) {
    findings.push({ kind: 'citation', severity: 'inconclusive', title: text.timedOut, detail: text.timedOutDetail(late.join(', ')), evidence: [], status: 'open' })
  }
  trace.skipped = Math.max(0, toResolve.length - batch.length) || undefined
  return { trace, findings }
}

/** A few lines for the reviewer: what Studio already checked, so it judges substance instead. */
export function traceSummary(trace: CitationTrace, findings: Omit<ReviewFinding, 'id'>[]): string {
  if (!trace.found && !findings.length) return ''
  const lines = [
    '# Citation trace (already checked by Studio; do not repeat these findings)',
    `- ${trace.found} cited identifier(s) or author-year reference(s): ${trace.traced} traced to a tool result or user message, ${trace.bibOnly} only in the project bibliography, ${trace.untraced} with no source in the session.`,
    `- DOI lookups: ${trace.resolved} answered (${trace.notFound} do not exist), ${trace.unverifiable} unanswered${trace.skipped ? `, ${trace.skipped} not looked up` : ''}.`
  ]
  for (const f of findings) lines.push(`- ${f.severity}: ${f.title}`)
  lines.push('Judge instead whether the cited sources support the claims they are attached to, where the digest or files let you.')
  return lines.join('\n')
}
