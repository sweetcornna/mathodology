import { expect, it, vi } from 'vitest'
import type { SessionEvent, SessionEventBody } from '@shared/types'
import { sessionEventPush } from '../src/main/session-push'

it('coalesces deltas by block with interleaved progress and flushes before completion', () => {
  vi.useFakeTimers()
  try {
    const events: SessionEvent[] = []
    const push = sessionEventPush((event) => events.push(event))
    let seq = 0
    const emit = (body: SessionEventBody) => push({ ...body, sessionId: 'session', seq: ++seq, ts: 0 })
    emit({ kind: 'assistant.delta', blockId: 'think', text: 'one', thinking: true })
    emit({ kind: 'turn.progress', tokens: 1 })
    emit({ kind: 'assistant.delta', blockId: 'text', text: 'answer' })
    emit({ kind: 'assistant.delta', blockId: 'think', text: ' two', thinking: true })
    emit({ kind: 'turn.progress', tokens: 2 })
    emit({ kind: 'tool.output', callId: 'unused', chunk: 'discarded' })
    expect(events).toEqual([])
    emit({ kind: 'turn.completed', ok: true })
    expect(events).toMatchObject([
      { kind: 'assistant.delta', blockId: 'think', text: 'one two', thinking: true },
      { kind: 'assistant.delta', blockId: 'text', text: 'answer' },
      { kind: 'turn.progress', tokens: 2 },
      { kind: 'turn.completed', ok: true }
    ])
    vi.runAllTimers()
    expect(events).toHaveLength(4)
  } finally {
    vi.useRealTimers()
  }
})
