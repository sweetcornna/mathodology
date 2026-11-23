import { detex, normalizeDoi } from '@shared/biblio'

/** One entry of a .bib file, fields lowercased with braces kept as written. */
export interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
  /** 1-based line of the `@type{key,` head. */
  line: number
}

interface LocatedEntry extends BibEntry {
  start: number
  keyStart: number
  fieldsStart: number
  end: number
  closed: boolean
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** BibTeX entries in a file; `@string` macros are expanded, `@comment` and `@preamble` skipped. */
export function parseBibtex(text: string): BibEntry[] {
  return locatedEntries(text).map(({ type, key, fields, line }) => ({ type, key, fields, line }))
}

export function locatedEntries(text: string): LocatedEntry[] {
  const out: LocatedEntry[] = []
  const newlines = [...text.matchAll(/\n/g)].map((match) => match.index)
  let line = 1
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
      let braces = 0
      let quoted = false
      let i = head.lastIndex
      for (; i < text.length && depth > 0; i++) {
        const c = text[i]
        if (c === '\\') i++
        else if (m[2] === '{') {
          if (c === '{') depth++
          else if (c === '}') depth--
        } else if (c === '{') braces++
        else if (c === '}' && braces) braces--
        else if (!braces && c === '"') quoted = !quoted
        else if (!braces && !quoted && c === '(') depth++
        else if (!braces && !quoted && c === ')') depth--
      }
      head.lastIndex = i
      continue
    }
    let i = head.lastIndex
    let key = ''
    let keyStart = i
    if (type !== 'string') {
      const k = /\s*([^,\s]*)\s*,/y
      k.lastIndex = i
      const km = k.exec(text)
      if (!km) continue
      key = km[1]
      keyStart = i + km[0].indexOf(key)
      i = k.lastIndex
    }
    const fieldsStart = i
    const fields: Record<string, string> = Object.create(null)
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
    const closed = text[i] === close
    if (closed) i++
    head.lastIndex = i
    if (type === 'string') Object.assign(strings, fields)
    else {
      while (newlines[line - 1] !== undefined && newlines[line - 1] < m.index) line++
      out.push({ type, key, fields: { ...fields }, line, start: m.index, keyStart, fieldsStart, end: i, closed })
    }
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

/** Insert a DOI at the parsed start of the entry's fields and validate the result. */
export function withDoi(text: string, key: string, value: string): string | null {
  const doi = normalizeDoi(value)
  if (!doi || /[{}\\%\x00-\x1f\x7f]/.test(doi)) throw new Error('Invalid DOI for BibTeX')
  const matches = locatedEntries(text).filter((entry) => entry.key === key)
  if (matches.length > 1) throw new Error(`Duplicate BibTeX key: ${key}`)
  const [entry] = matches
  if (!entry || entry.fields.doi) return null
  if (!entry.closed) throw new Error(`Invalid BibTeX entry: ${key}`)
  const { start, fieldsStart, end } = entry
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const indent = /\n([ \t]+)\w/.exec(text.slice(fieldsStart, end))?.[1] ?? '  '
  const insertion = `${newline}${indent}doi = {${doi}},`
  const next = text.slice(0, fieldsStart) + insertion + text.slice(fieldsStart)
  const edited = locatedEntries(next).find((candidate) => candidate.start === start)
  if (!edited?.closed || edited.key !== key || edited.fields.doi !== doi || edited.end !== end + insertion.length) {
    throw new Error(`Invalid BibTeX edit: ${key}`)
  }
  return next
}
