import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventBody, TodoItem } from '@shared/types'
import { buildTranscript, type ToolNode } from '../src/renderer/src/lib/transcript'
import { summarize } from '../src/renderer/src/lib/verbs'

function events(...bodies: SessionEventBody[]): SessionEvent[] {
  return bodies.map((body, seq) => ({ ...body, sessionId: 's1', seq, ts: seq }))
}

function call(callId: string, extra: Partial<Extract<SessionEventBody, { kind: 'tool.call' }>> = {}): SessionEventBody {
  return { kind: 'tool.call', callId, name: 'shell', toolKind: 'shell', title: callId, input: { command: callId }, ...extra }
}

function result(callId: string, isError = false): SessionEventBody {
  return { kind: 'tool.result', callId, output: isError ? 'failed' : 'done', isError }
}

function nodes(transcript: ReturnType<typeof buildTranscript>): ToolNode[] {
  return transcript.items.flatMap((item) => item.type === 'tools' ? item.tools : [])
}

describe('transcript at turn completion', () => {
  it.each([true, false])('stops unresolved tools, including nested calls, when ok=%s without inventing results', (ok) => {
    const transcript = buildTranscript(events(
      call('parent', { name: 'Task', toolKind: 'task' }),
      call('child', { parentCallId: 'parent' }),
      call('done'), result('done'),
      call('failed'), result('failed', true),
      { kind: 'turn.completed', ok }
    ))
    const [parent, done, failed] = nodes(transcript)

    expect(parent.stopped).toBe(true)
    expect(parent.result).toBeUndefined()
    expect(parent.children[0].stopped).toBe(true)
    expect(parent.children[0].result).toBeUndefined()
    expect(done.result).toEqual({ output: 'done', isError: false })
    expect(failed.result).toEqual({ output: 'failed', isError: true })
    expect(done.stopped).toBeUndefined()
    expect(failed.stopped).toBeUndefined()
    expect(transcript.runningTool).toBeUndefined()
    for (const lang of ['zh', 'en'] as const) {
      expect(summarize([parent, ...parent.children], lang).map((phrase) => phrase.tone)).toEqual(['stopped', 'stopped'])
    }
  })

  it('preserves unfinished task states after a turn ends', () => {
    const todos: TodoItem[] = [
      { content: 'Gather evidence', status: 'completed' },
      { content: 'Calculate', status: 'in_progress' },
      { content: 'Write paper', status: 'pending' }
    ]
    const transcript = buildTranscript(events(
      { kind: 'todo.update', items: todos },
      { kind: 'turn.completed', ok: true }
    ))
    expect(transcript.todos).toEqual(todos)
    expect(transcript.todos.filter((todo) => todo.status === 'completed')).toHaveLength(1)
  })

  it('keeps old calls stopped while a new turn is running', () => {
    const transcript = buildTranscript(events(
      call('previous'), { kind: 'turn.completed', ok: false },
      { kind: 'user.message', text: 'Continue', attachments: [] },
      call('current')
    ))
    const [previous, current] = nodes(transcript)
    expect(previous.stopped).toBe(true)
    expect(current.stopped).toBeUndefined()
    expect(transcript.runningTool).toBe(current)
    expect(summarize([previous, current], 'en').map((phrase) => phrase.tone)).toEqual(['stopped', 'running'])
  })

  it.each([false, true])('accepts a late tool result (isError=%s) without stopping the current call', (isError) => {
    const transcript = buildTranscript(events(
      call('previous'), { kind: 'turn.completed', ok: true },
      call('current'), result('previous', isError)
    ))
    const [previous, current] = nodes(transcript)
    expect(previous.stopped).toBeUndefined()
    expect(previous.result).toEqual({ output: isError ? 'failed' : 'done', isError })
    expect(transcript.runningTool).toBe(current)
    expect(summarize([previous], 'en')[0].tone).toBe(isError ? 'failed' : 'normal')
  })
})

describe('tool summaries', () => {
  it('shows stopped and active calls alongside a completed command description', () => {
    const transcript = buildTranscript(events(
      call('setup', { title: 'Prepare inputs' }), result('setup'),
      call('unrecorded'), { kind: 'turn.completed', ok: true },
      call('failed'), result('failed', true),
      call('active')
    ))
    for (const lang of ['zh', 'en'] as const) {
      const phrases = summarize(nodes(transcript), lang)
      expect(phrases.map((phrase) => phrase.tone)).toEqual(['normal', 'failed', 'stopped', 'running'])
      expect(phrases[0].text).toBe('Prepare inputs')
      expect(phrases[2].chip).toBe('unrecorded')
      expect(phrases[2].text).toBe(lang === 'zh' ? '未记录结果' : 'Result not recorded')
    }
  })
})
