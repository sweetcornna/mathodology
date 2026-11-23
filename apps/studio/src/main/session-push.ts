import type { SessionEvent } from '@shared/types'

type Delta = Extract<SessionEvent, { kind: 'assistant.delta' }>
type Progress = Extract<SessionEvent, { kind: 'turn.progress' }>

/** Batch transient updates and flush before durable events so finalization cannot overtake a block. */
export function sessionEventPush(push: (event: SessionEvent) => void): (event: SessionEvent) => void {
  const pending = new Map<string, { blocks: Map<string, Delta>; progress?: Progress }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (sessionId: string): void => {
    const batch = pending.get(sessionId)
    if (!batch) return
    pending.delete(sessionId)
    for (const delta of batch.blocks.values()) push(delta)
    if (batch.progress) push(batch.progress)
  }

  return (event) => {
    if (event.kind === 'tool.output') return
    if (event.kind !== 'assistant.delta' && event.kind !== 'turn.progress') {
      flush(event.sessionId)
      push(event)
      return
    }
    let batch = pending.get(event.sessionId)
    if (!batch) pending.set(event.sessionId, (batch = { blocks: new Map() }))
    if (event.kind === 'turn.progress') batch.progress = event
    else {
      const first = batch.blocks.get(event.blockId)
      batch.blocks.set(event.blockId, first ? { ...first, text: first.text + event.text, thinking: event.thinking } : event)
    }
    timer ??= setTimeout(() => {
      timer = undefined
      for (const sessionId of pending.keys()) flush(sessionId)
    }, 24)
  }
}
