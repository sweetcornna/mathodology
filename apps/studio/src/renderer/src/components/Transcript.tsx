import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranscript } from '../lib/useTranscript'
import { useStudio } from '../store'
import { ReviewCard } from './ReviewCard'
import { LiveOutput } from './transcript/LiveOutput'
import { ItemView } from './transcript/MessageItems'

export function Transcript({ sessionId }: { sessionId: string }) {
  const events = useStudio((s) => s.events[sessionId])
  const running = useStudio((s) => {
    const st = s.sessions.find((x) => x.id === sessionId)?.status
    return st === 'running' || st === 'waiting'
  })
  const { items, runningTool, pending } = useTranscript(sessionId)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const focusKey = useStudio((s) => s.focusKey)
  const reviewedThrough = useStudio((s) => s.reviews[sessionId]?.at(-1)?.throughSeq)
  const reviewId = useStudio((s) => s.reviews[sessionId]?.at(-1)?.id)

  // A review sits after the last item it covered, so later turns read below it.
  const reviewAt = useMemo(() => {
    if (reviewedThrough === undefined) return -2
    for (let i = items.length - 1; i >= 0; i--) if (Number(items[i].key.slice(1)) <= reviewedThrough) return i
    return items.length - 1
  }, [items, reviewedThrough])
  const lastSeq = events?.[events.length - 1]?.seq ?? 0
  const atEndRef = useRef(false)
  atEndRef.current = reviewAt === items.length - 1

  const followIfPinned = useCallback(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [])

  useLayoutEffect(() => {
    followIfPinned()
  }, [items, reviewAt, followIfPinned])

  useEffect(() => {
    pinned.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessionId])

  // A review started from the end of the conversation is followed like a new turn.
  useEffect(() => {
    const el = scroller.current
    if (!reviewId || !el || !atEndRef.current) return
    pinned.current = true
    el.scrollTop = el.scrollHeight
  }, [reviewId])

  // Provenance links land on the turn that produced a version.
  useEffect(() => {
    if (!focusKey) return
    const target = scroller.current?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)
    if (!target) return
    pinned.current = false
    target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    target.classList.remove('focus-flash')
    void target.offsetWidth
    target.classList.add('focus-flash')
    useStudio.setState({ focusKey: null })
  }, [focusKey, items])

  return (
    <div
      ref={scroller}
      className="scroll min-h-0 flex-1"
      style={{ maskImage: 'linear-gradient(to bottom, black calc(100% - 48px), transparent)' }}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      <div className="mx-auto flex w-full max-w-[var(--column)] flex-col gap-[14px] px-8 pt-4 pb-14">
        {reviewAt === -1 && <ReviewCard sessionId={sessionId} lastSeq={lastSeq} />}
        {items.map((item, i) => (
          <Fragment key={item.key}>
            <div data-key={item.key}>
              <ItemView item={item} />
            </div>
            {i === reviewAt && <ReviewCard sessionId={sessionId} lastSeq={lastSeq} />}
          </Fragment>
        ))}
        <LiveOutput sessionId={sessionId} running={running} runningTool={runningTool} blocked={pending.length > 0} onUpdate={followIfPinned} />
      </div>
    </div>
  )
}
