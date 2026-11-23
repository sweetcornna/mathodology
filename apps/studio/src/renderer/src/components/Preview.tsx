import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { FilePreview } from '@shared/types'
import { highlight } from '../lib/highlight'
import { useT } from '../lib/i18n'
import { openPath } from '../lib/open'
import { Markdown } from './Markdown'

/** File extensions the code preview highlights, mapped to highlighter language names. */
const CODE_LANGS: Record<string, string> = {
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  json: 'json',
  tex: 'latex',
  bib: 'latex',
  m: 'matlab',
  r: 'r',
  jl: 'julia',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql'
}

const DIFF_PAGE = 500

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 text-[0.786rem] font-medium tabular-nums">
      <span className="text-diff-add">+{added}</span> <span className="text-diff-del">−{removed}</span>
    </span>
  )
}

export function DiffView({ text, className = 'max-h-80' }: { text: string; className?: string }) {
  const t = useT()
  const lines = useMemo(() => text.split('\n'), [text])
  const [limit, setLimit] = useState(DIFF_PAGE)

  useEffect(() => {
    setLimit(DIFF_PAGE)
  }, [text])

  const shown = lines.length > limit ? lines.slice(0, limit) : lines
  const remaining = lines.length - shown.length

  return (
    <div className={`overflow-auto ${className}`}>
      <pre className="selectable m-0 py-1.5 font-mono text-[0.786rem] leading-[1.5]">
        {shown.map((line, i) => {
          const cls = line.startsWith('+')
            ? 'bg-[color-mix(in_srgb,var(--diff-add)_14%,transparent)] text-fg'
            : line.startsWith('-')
              ? 'bg-[color-mix(in_srgb,var(--diff-del)_14%,transparent)] text-fg'
              : line.startsWith('@@')
                ? 'text-fg-3'
                : 'text-fg-2'
          return (
            <div key={i} className={`px-2.5 ${cls}`}>
              {line || ' '}
            </div>
          )
        })}
      </pre>
      {remaining > 0 && (
        <div className="flex items-center gap-2 border-t border-line px-2.5 py-2 text-[0.786rem]">
          <button className="btn btn-secondary btn-sm h-6" onClick={() => setLimit((l) => l + DIFF_PAGE)}>
            {t('diff.linesMore', { n: Math.min(DIFF_PAGE, remaining) })}
          </button>
          <button className="btn btn-ghost btn-sm h-6" onClick={() => setLimit(lines.length)}>
            {t('diff.showAll', { n: lines.length })}
          </button>
        </div>
      )}
    </div>
  )
}

function CodeView({ rel, text }: { rel: string; text: string }) {
  const lang = CODE_LANGS[rel.split('.').pop()?.toLowerCase() ?? '']
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setHtml(null)
    if (lang) void highlight(text, lang).then((h) => alive && setHtml(h))
    return () => {
      alive = false
    }
  }, [text, lang])
  return html ? (
    <div className="scroll selectable code-block-body min-h-0 flex-1 px-4 py-3" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre className="scroll selectable m-0 min-h-0 flex-1 px-4 py-3 font-mono text-[0.786rem] leading-[1.6] whitespace-pre text-fg-2">{text}</pre>
  )
}

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => {
    const sep = text.includes('\t') && !text.split('\n')[0].includes(',') ? '\t' : ','
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 300)
      .map((l) => l.split(sep))
  }, [text])
  return (
    <div className="scroll min-h-0 flex-1">
      <table className="w-full border-collapse font-mono text-[0.76rem] tabular-nums">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i === 0 ? 'sticky top-0 bg-surface-2 font-semibold' : 'border-t border-line'}>
              {r.map((c, j) => (
                <td key={j} className="px-2.5 py-1 whitespace-nowrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The body of a file preview; `pdfSrc` is the URL the PDF viewer loads. */
export function PreviewBody({ preview, rel, pdfSrc }: { preview: FilePreview; rel: string; pdfSrc: string }) {
  const t = useT()
  if (preview.kind === 'image')
    return (
      <div className="scroll grid min-h-0 flex-1 place-items-center bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
        <img src={preview.content} className="max-w-full rounded-[6px] shadow-[var(--shadow-md)]" alt={rel} />
      </div>
    )
  if (preview.kind === 'pdf') return <iframe title={rel} src={pdfSrc} className="min-h-0 w-full flex-1 border-0 bg-white" />
  if (preview.kind === 'markdown')
    return (
      <div className="scroll min-h-0 flex-1 px-5 py-4">
        <Markdown className="serif" text={preview.content ?? ''} />
      </div>
    )
  if (preview.kind === 'csv') return <CsvTable text={preview.content ?? ''} />
  if (preview.kind === 'text') return <CodeView rel={rel} text={preview.content ?? ''} />
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[0.88rem] text-fg-3">
      {preview.kind === 'too-large' ? t('pane.tooLarge') : t('pane.binary')}
      <button className="btn btn-secondary btn-sm" onClick={() => openPath(preview.path)}>
        <ExternalLink size={13} /> {t('pane.openExternal')}
      </button>
    </div>
  )
}
