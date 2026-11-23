import { useTranscript } from '../../lib/useTranscript'
import { useStudio } from '../../store'
import { ApprovalCard, QuestionCard } from './ApprovalCard'
import { QueueCard } from './QueueCard'
import { TaskCard } from './TaskCard'

/** Approval, task and queue cards stacked above the composer for the active session. */
export function Dock({ onFocusedEdit }: { onFocusedEdit: () => void }) {
  const sessionId = useStudio((s) => s.activeSessionId)
  const queue = useStudio((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.queue)
  const running = useStudio((s) => {
    const st = s.sessions.find((x) => x.id === sessionId)?.status
    return st === 'running' || st === 'waiting'
  })
  const { todos, pending } = useTranscript(sessionId)
  const showTodos = todos.length > 0 && (running || todos.some((x) => x.status !== 'completed'))
  if (!pending.length && !showTodos && !queue?.length) return null
  return (
    <div className="mb-2 flex flex-col gap-2">
      {showTodos && <TaskCard todos={todos} running={running} />}
      {sessionId && queue && queue.length > 0 && <QueueCard sessionId={sessionId} queue={queue} running={running} onFocusedEdit={onFocusedEdit} />}
      {pending.length > 0 &&
        (pending[0].questions?.length ? (
          <QuestionCard key={pending[0].requestId} perm={pending[0]} more={pending.length - 1} />
        ) : (
          <ApprovalCard key={pending[0].requestId} perm={pending[0]} more={pending.length - 1} />
        ))}
    </div>
  )
}
