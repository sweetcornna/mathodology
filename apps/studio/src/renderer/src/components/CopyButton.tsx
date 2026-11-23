import { Check, Copy } from 'lucide-react'
import { useCopyFeedback } from '../lib/useCopy'

/** Clipboard copy button shared across Transcript and Markdown code blocks. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopyFeedback()
  return (
    <button className="icon-btn-sm" aria-label={label} onClick={() => copy(text)}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}
