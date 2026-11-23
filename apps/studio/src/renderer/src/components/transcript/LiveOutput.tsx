import { memo, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { formatTokens, type ToolNode } from '../../lib/transcript'
import { activityLabel } from '../../lib/verbs'
import { useStudio } from '../../store'
import { Markdown } from '../Markdown'
import { GlyphSpinner } from '../ui'
import { formatDuration, Thinking } from './MessageItems'

/** Spinner · activity · elapsed · tokens, at the foot of the running turn. */
function StatusLine({ sessionId, runningTool, blocked, thinking }: { sessionId: string; runningTool?: ToolNode; blocked: boolean; thinking: boolean }) {
  const t = useT()
  const lang = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
  const live = useStudio((s) => s.live[sessionId])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = live ? now - live.startedAt : 0
  const label = blocked ? t('status.blocked') : thinking ? t('transcript.thinking') : activityLabel(runningTool, lang)
  return (
    <div className="flex items-center gap-2 text-[1rem] text-fg-3" data-state={blocked ? 'blocked' : 'busy'}>
      <GlyphSpinner paused={blocked} />
      <span className={`min-w-0 truncate ${blocked ? 'text-warning-text' : 'shimmer-text'}`}>{label}…</span>
      {elapsed > 1500 && <span className="shrink-0 tabular-nums">{formatDuration(elapsed)}</span>}
      {live && live.tokens > 0 && <span className="shrink-0 tabular-nums">· {formatTokens(live.tokens)} tokens</span>}
    </div>
  )
}

const LiveBlock = memo(function LiveBlock({ text, thinking }: { text: string; thinking: boolean }) {
  return thinking ? <Thinking text={text} live /> : <Markdown text={text} className="streaming" streaming />
})

/** Isolated streaming subscriber so delta chunks never re-render historical transcript rows. */
export function LiveOutput({
  sessionId,
  running,
  runningTool,
  blocked,
  onUpdate
}: {
  sessionId: string
  running: boolean
  runningTool?: ToolNode
  blocked: boolean
  onUpdate: () => void
}) {
  const streaming = useStudio((s) => s.streaming[sessionId])
  const entries = useMemo(() => (streaming ? Object.entries(streaming) : []), [streaming])
  const thinkingLive = entries.some(([, b]) => b.thinking)

  useLayoutEffect(() => {
    onUpdate()
  }, [entries, running, onUpdate])

  if (!entries.length && !running) return null
  return (
    <>
      {entries.map(([id, block]) => (
        <LiveBlock key={id} text={block.text} thinking={block.thinking} />
      ))}
      {running && <StatusLine sessionId={sessionId} runningTool={runningTool} blocked={blocked} thinking={thinkingLive} />}
    </>
  )
}
