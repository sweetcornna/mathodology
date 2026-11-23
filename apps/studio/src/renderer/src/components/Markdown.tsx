import { createContext, memo, useContext, useEffect, useMemo, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { api } from '../lib/api'
import { getCachedHighlight, highlight } from '../lib/highlight'
import { useT } from '../lib/i18n'
import { useStudio } from '../store'
import { CopyButton } from './CopyButton'

const StreamingOpenCodeContext = createContext<string | null>(null)

/**
 * Agents often write \( \) and \[ \] delimiters, and $$...$$ on one line; remark-math only
 * understands dollars and treats single-line $$ as inline math.
 */
function normalizeMath(src: string): string {
  return src
    .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_m, body: string) => `$$\n${body.trim()}\n$$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body.trim()}$`)
}

/** Return the raw body of an unclosed trailing code fence while streaming, or null if all fences are closed. */
function trailingOpenFenceCode(src: string): string | null {
  let fence: { char: string; len: number; lines: string[] } | null = null
  for (const line of src.split('\n')) {
    if (!fence) {
      const m = /^[ ]{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!m) continue
      const marker = m[1]
      const info = m[2]
      if (marker[0] === '`' && info.includes('`')) continue
      fence = { char: marker[0], len: marker.length, lines: [] }
    } else {
      const close = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence = null
      } else {
        fence.lines.push(line)
      }
    }
  }
  return fence ? fence.lines.join('\n').replace(/\n$/, '') : null
}

const CodeBlock = memo(function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const t = useT()
  const openFenceCode = useContext(StreamingOpenCodeContext)
  const defer = openFenceCode !== null && code === openFenceCode
  const [html, setHtml] = useState<string | null>(() => (defer ? null : getCachedHighlight(code, lang)))

  useEffect(() => {
    if (defer) {
      setHtml(null)
      return
    }
    const cached = getCachedHighlight(code, lang)
    if (cached !== null) {
      setHtml(cached)
      return
    }
    let alive = true
    void highlight(code, lang).then((h) => {
      if (alive) setHtml(h)
    })
    return () => {
      alive = false
    }
  }, [code, lang, defer])

  return (
    <div className="code-block group">
      <div className="code-block-bar">
        <span>{lang || 'text'}</span>
        <CopyButton text={code} label={t('common.copy')} />
      </div>
      {html ? (
        <div className="code-block-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-block-body">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
})

/** Paths the agent mentions in inline code become links into the project preview. */
function InlineCode({ children }: { children?: React.ReactNode }) {
  const openPreview = useStudio((s) => s.openPreview)
  const text = String(children ?? '')
  const isPath = /^[\w./-]+\.(png|jpe?g|svg|pdf|md|csv|tsv|py|tex|json|txt|ipynb|m|r)$/i.test(text) && !text.startsWith('http')
  if (isPath) {
    return (
      <code className="inline-code is-link" onClick={() => openPreview(text.replace(/^\.\//, ''))} title="Preview">
        {text}
      </code>
    )
  }
  return <code className="inline-code">{children}</code>
}

const components: ComponentProps<typeof ReactMarkdown>['components'] = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1]
    const text = String(children ?? '')
    if (lang || text.includes('\n')) return <CodeBlock lang={lang ?? ''} code={text.replace(/\n$/, '')} />
    return <InlineCode>{children}</InlineCode>
  },
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void api.call('shell:openExternal', href)
      }}
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  const normalized = useMemo(() => normalizeMath(text), [text])
  const openFenceCode = useMemo(() => (streaming ? trailingOpenFenceCode(normalized) : null), [normalized, streaming])
  return (
    <StreamingOpenCodeContext.Provider value={openFenceCode}>
      <div className={`prose ${className ?? ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
          components={components}
        >
          {normalized}
        </ReactMarkdown>
      </div>
    </StreamingOpenCodeContext.Provider>
  )
})
