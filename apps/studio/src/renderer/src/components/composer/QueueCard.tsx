import { useState } from 'react'
import { ListOrdered, Paperclip, Pencil, X } from 'lucide-react'
import type { QueuedMessage } from '@shared/types'
import { useT } from '../../lib/i18n'
import { useStudio } from '../../store'
import { Tip } from '../ui'

/** Messages sent while the agent was busy; each starts the next turn in order. */
export function QueueCard({
  sessionId,
  queue,
  running,
  onFocusedEdit
}: {
  sessionId: string
  queue: QueuedMessage[]
  running: boolean
  onFocusedEdit: () => void
}) {
  const t = useT()
  const sendQueued = useStudio((s) => s.sendQueued)
  const dequeue = useStudio((s) => s.dequeue)
  const editQueued = useStudio((s) => s.editQueued)
  const [sendingId, setSendingId] = useState<string | null>(null)

  const sendNext = async (): Promise<void> => {
    const next = queue[0]
    if (!next || sendingId) return
    setSendingId(next.id)
    try {
      await sendQueued(sessionId, next.id)
    } finally {
      setSendingId((cur) => (cur === next.id ? null : cur))
    }
  }

  return (
    <div className="card px-3 py-2">
      <div className="flex h-6 items-center gap-2 text-[0.857rem] text-fg-3">
        <ListOrdered size={13} />
        <span>{t('queue.title', { n: queue.length })}</span>
        {!running && <span className="truncate">· {t('queue.paused')}</span>}
        <span className="flex-1" />
        {!running && (
          <button className="btn btn-secondary btn-sm h-6" disabled={sendingId !== null} onClick={() => void sendNext()}>
            {t('queue.sendNext')}
          </button>
        )}
      </div>
      <ul className="scroll mt-1 flex max-h-40 flex-col">
        {queue.map((q, i) => (
          <li key={q.id} className="group flex h-7 items-center gap-2 text-[0.929rem]">
            <span className="w-4 shrink-0 text-center text-[0.786rem] text-fg-4 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-fg-2">{q.text}</span>
            {q.attachments.length > 0 && <Paperclip size={12} className="shrink-0 text-fg-3" />}
            <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <Tip label={t('queue.edit')}>
                <button
                  className="icon-btn-sm"
                  aria-label={t('queue.edit')}
                  onClick={async () => {
                    if ((await editQueued(sessionId, q)) && useStudio.getState().activeSessionId === sessionId) {
                      onFocusedEdit()
                    }
                  }}
                >
                  <Pencil size={12} />
                </button>
              </Tip>
              <Tip label={t('common.remove')}>
                <button className="icon-btn-sm" aria-label={t('common.remove')} onClick={() => void dequeue(sessionId, q.id)}>
                  <X size={12} />
                </button>
              </Tip>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
