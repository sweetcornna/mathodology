import { memo, useEffect, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Check, Copy } from 'lucide-react'
import { api } from '../lib/api'
import { highlight } from '../lib/highlight'
import { useT } from '../lib/i18n'
import { useStudio } from '../store'

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

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const t = useT()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let alive = true
    void highlight(code, lang).then((h) => alive && setHtml(h))
    return () => {
      alive = false
    }
  }, [code, lang])
  return (
    <div className="code-block group">
      <div className="code-block-bar">
        <span>{lang || 'text'}</span>
        <button
          className="icon-btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          aria-label={t('common.copy')}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
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
}

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

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`prose ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
        components={components}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
})
