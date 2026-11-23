import { useCallback, useEffect, useRef, useState } from 'react'

/** Clipboard copy state with unmount cleanup and rapid-click timer replacement. */
export function useCopyFeedback(durationMs = 1200): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [])

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text).catch(() => undefined)
      if (!alive.current) return
      setCopied(true)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        if (alive.current) setCopied(false)
      }, durationMs)
    },
    [durationMs]
  )

  return { copied, copy }
}
