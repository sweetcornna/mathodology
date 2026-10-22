/** Bibliographic helpers shared by the main process and the interface. */

const DOI_PREFIX = /^(?:(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\/|doi:\s*|doi\s+)/i
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }

const count = (s: string, c: string): number => s.split(c).length - 1

/** Drop trailing punctuation and closing brackets the DOI never opened, e.g. keep 10.1016/S0140-6736(97)11096-0. */
function trimDoi(doi: string): string {
  for (;;) {
    const last = doi.at(-1)
    if (!last || !(".,;:'\"".includes(last) || (CLOSERS[last] && count(doi, last) > count(doi, CLOSERS[last])))) return doi
    doi = doi.slice(0, -1)
  }
}

/** A DOI in canonical form, or null when the text is not one. */
export function normalizeDoi(raw: string): string | null {
  let doi = raw.trim()
  const prefix = DOI_PREFIX.exec(doi)
  if (prefix) {
    doi = doi.slice(prefix[0].length)
    // A link's query string or fragment is not part of the DOI.
    if (/doi\.org/i.test(prefix[0])) doi = doi.split(/[?#]/)[0]
  }
  // %-escapes are decoded where they are valid and kept where they are not.
  doi = doi.replace(/(?:%[0-9a-f]{2})+/gi, (s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  doi = trimDoi(doi.trim())
  if (doi.length >= 300 || !/^10\.\d{4,9}\/\S+$/.test(doi)) return null
  if (/(^|\/)\.\.?(\/|$)/.test(doi)) return null
  return doi
}

/** A DOI field as written in BibTeX or LaTeX: grouping braces dropped, `\_` `\%` `\#` `\&` unescaped. */
export function texDoi(raw: string): string {
  return raw.replace(/\\([_%#&])/g, '$1').replace(/[{}]/g, '').trim()
}

/**
 * A DOI in prose ends at a space, a quote, Markdown emphasis or a table bar, or CJK text and
 * punctuation (Chinese puts no space after it); TeX escapes such as `\_` are part of it.
 */
const DOI_TOKEN = /(?<![0-9A-Za-z_.])10\.\d{4,9}\/(?:\\[_%#&]|[^\s"'`*|\\\u2013\u2014\u2018-\u201f\u2026\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef])+/g

/** Cut a token at the first closing bracket that was never opened inside it. */
function cutUnbalanced(token: string): string {
  const depth: Record<string, number> = { '(': 0, '[': 0, '{': 0, '<': 0 }
  for (let i = 0; i < token.length; i++) {
    const open = CLOSERS[token[i]]
    if (token[i] in depth) depth[token[i]]++
    else if (open && depth[open]-- === 0) return token.slice(0, i)
  }
  return token
}

function insideUrl(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 300), at).split(/[\s"'<>()[\]{}]/).pop() ?? ''
  return before.includes('://') || before.toLowerCase().endsWith('doi.org/')
}

/** Each DOI written in a text (links, `doi:` prefixes or bare) with the offset where it starts. */
export function doiMatches(text: string): { doi: string; at: number }[] {
  const out: { doi: string; at: number }[] = []
  const re = new RegExp(DOI_TOKEN)
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // `\href{https://doi.org/…}{label}`: the label is not part of the DOI.
    const raw = cutUnbalanced(m[0].split('}{')[0])
    re.lastIndex = m.index + raw.length
    let token = raw.replace(/\\([_%#&])/g, '$1').replace(/&(lt|gt|amp);/gi, (_, e: string) => ({ lt: '<', gt: '>', amp: '&' })[e.toLowerCase()]!)
    if (insideUrl(text, m.index)) token = token.split(/[?#]/)[0]
    const doi = normalizeDoi(token)
    if (doi) out.push({ doi, at: m.index })
  }
  return out
}

/** DOIs written anywhere in a text: links, `doi:` prefixes or bare. */
export function findDois(text: string): string[] {
  return [...new Set(doiMatches(text).map((m) => m.doi))]
}

/** TeX accent and letter commands as the letters they write: `\H{o}` → o, `{\ss}` → ss. */
export function detex(s: string): string {
  return s
    .replace(/\\([`'^"~=.])\s*\{?([A-Za-z])\}?/g, '$2')
    .replace(/\\([uvHtcdbkr])(?:\s+|\{)([A-Za-z])\}?/g, '$2')
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|[ijoOlL])(?![A-Za-z])/g, '$1')
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', minus: '−', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×', szlig: 'ß' }
const MARKS: Record<string, string> = { grave: '\u0300', acute: '\u0301', circ: '\u0302', tilde: '\u0303', uml: '\u0308', ring: '\u030a', cedil: '\u0327', caron: '\u030c' }

/** HTML character references as the characters they stand for (`&amp;`, `&#x3b1;`, `&eacute;`); unknown names are kept. */
export function unescapeHtml(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (all, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name === undefined) {
      const cp = dec !== undefined ? Number(dec) : parseInt(hex!, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all
    }
    const accented = /^([a-z])(grave|acute|circ|tilde|uml|ring|cedil|caron)$/i.exec(name)
    return NAMED[name] ?? (accented ? accented[1] + MARKS[accented[2]] : all)
  })
}

/** HTML and MathML tags, as registries put them in titles: `<i>`, `<sub>`, `<mml:math …>`. */
const MARKUP = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>/g

/** Lowercase, accents folded, HTML/LaTeX markup and punctuation removed, single spaces. */
export function normalizeTitle(title: string): string {
  // Tags go before and after unescaping, for `CO<sub>2</sub>` and `CO&lt;sub&gt;2&lt;/sub&gt;` alike.
  return detex(unescapeHtml(title.replace(MARKUP, '')).replace(MARKUP, ''))
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/\\./g, '')
    .replace(/[{}$]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/**
 * How alike two titles are, 0–1 (character-bigram Dice on normalized text). A title that is the
 * other one plus a subtitle counts as a near match.
 */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 20 && long.startsWith(short)) return 0.95
  const gx = bigrams(x)
  const gy = bigrams(y)
  let shared = 0
  for (const [g, n] of gx) shared += Math.min(n, gy.get(g) ?? 0)
  const total = x.length - 1 + (y.length - 1)
  return total > 0 ? (2 * shared) / total : 0
}

/** Lowercase text with TeX accents and diacritics folded, so a folded name can be searched for in it. */
export function foldText(text: string): string {
  return detex(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Folded, lowercase surname for comparisons. */
export function foldName(name: string): string {
  return foldText(name)
    .replace(/[^\p{L}\s-]/gu, '')
    .trim()
}

/** Split at brace depth 0 wherever `sep` matches one character. */
function splitTop(value: string, sep: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const c of value) {
    if (c === '{') depth++
    else if (c === '}') depth--
    if (depth === 0 && sep.test(c)) {
      parts.push(current)
      current = ''
    } else current += c
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** The names in a BibTeX name list, split on `and` outside braces: {Smith and Sons} is one name. */
export function splitNames(authors: string): string[] {
  const names: string[] = []
  const and = /\s+and\s+/iy
  let depth = 0
  let start = 0
  for (let i = 0; i < authors.length; i++) {
    if (authors[i] === '{') depth++
    else if (authors[i] === '}') depth--
    else if (depth === 0 && /\s/.test(authors[i])) {
      and.lastIndex = i
      if (!and.test(authors)) continue
      names.push(authors.slice(start, i))
      start = and.lastIndex
      i = start - 1
    }
  }
  names.push(authors.slice(start))
  return names.map((n) => n.trim()).filter(Boolean)
}

/** The first author's surname from a BibTeX author field ("Last, First and ..." or "First Last and ..."). */
export function firstSurname(authors: string): string {
  const first = splitNames(authors)[0] ?? ''
  if (!first || /^others$/i.test(first)) return ''
  const parts = splitTop(first, /,/)
  if (parts.length > 1) return parts[0]
  // A braced part is a single unit: {World Health Organization}, Johannes {van der Waals}.
  return splitTop(parts[0] ?? '', /\s/).pop() ?? ''
}

/** Whether two surnames name the same person, allowing particles ("van der Berg" vs "Berg"). */
export function sameSurname(a: string, b: string): boolean {
  const x = foldName(a)
  const y = foldName(b)
  if (!x || !y) return false
  return x === y || x.endsWith(` ${y}`) || y.endsWith(` ${x}`) || x.replace(/[\s-]/g, '') === y.replace(/[\s-]/g, '')
}

export type SourceKind = 'published' | 'preprint' | 'dataset' | 'web'

const PREPRINT_HOSTS = /(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|researchsquare\.com|preprints\.org|chemrxiv\.org|osf\.io|psyarxiv\.com|engrxiv\.org|techrxiv\.org)$/i
const PREPRINT_DOIS = /^10\.(48550|1101|2139|21203|20944|26434|31219|31224|36227)\//
const DATASET_HOSTS = /(^|\.)(zenodo\.org|figshare\.com|datadryad\.org|kaggle\.com|dataverse\.[a-z.]+|openml\.org|data\.gov|data\.europa\.eu|archive\.ics\.uci\.edu|pangaea\.de)$/i
const DATASET_DOIS = /^10\.(5281|6084|5061|7910|1594|24432)\//
const INDEX_HOSTS = /(^|\.)(pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|europepmc\.org|semanticscholar\.org|openalex\.org)$/i

/** Peer-reviewed publication, preprint, dataset or other web page, from the DOI and host. */
export function sourceKind(url: string, doi?: string, hint?: string): SourceKind {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    // not a URL
  }
  if (hint === 'dataset' || (doi && DATASET_DOIS.test(doi)) || DATASET_HOSTS.test(host) || /huggingface\.co\/datasets\//.test(url)) return 'dataset'
  if ((doi && PREPRINT_DOIS.test(doi)) || PREPRINT_HOSTS.test(host)) return 'preprint'
  if (doi || INDEX_HOSTS.test(host)) return 'published'
  return 'web'
}
