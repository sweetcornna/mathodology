import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventBody, TodoItem } from '@shared/types'
import { buildTranscript, evictTranscript, fileStats, projectTranscript, type ToolNode } from '../src/renderer/src/lib/transcript'
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

  it('computes identical MultiEdit line counts in fileStats and turn change summaries', () => {
    const multiEditCall: SessionEventBody = {
      kind: 'tool.call',
      callId: 'me1',
      name: 'MultiEdit',
      toolKind: 'edit',
      title: 'model.py',
      input: {
        file_path: 'code/model.py',
        edits: [
          { old_string: 'a = 1\nb = 2\n', new_string: 'a = 10\n' },
          { old_string: 'c = 3', new_string: 'c = 30\nd = 40\ne = 50' }
        ]
      }
    }
    const transcript = buildTranscript(events(multiEditCall, result('me1'), { kind: 'turn.completed', ok: true }))
    const toolNode = nodes(transcript)[0]
    const perCall = fileStats(toolNode)
    const changesItem = transcript.items.find((i) => i.type === 'changes')

    expect(perCall).toEqual([{ path: 'code/model.py', added: 4, removed: 3, created: false }])
    expect(changesItem?.type === 'changes' ? changesItem.files : []).toEqual(perCall)
  })
})

describe('shared memoized transcript projection', () => {
  it('shares projection per event array and preserves completed item identity across appends', () => {
    const base = events(
      { kind: 'user.message', text: 'Run script', attachments: [] },
      { kind: 'assistant.text', blockId: 'a1', text: 'Running now.' },
      call('t1'),
      result('t1'),
      { kind: 'todo.update', items: [{ content: 'Step 1', status: 'completed' }] },
      { kind: 'turn.completed', ok: true }
    )
    const first = projectTranscript(base, 's1')
    // Identical event array returns exact same Transcript object (shared by Transcript/Dock/Tasks).
    expect(projectTranscript(base, 's1')).toBe(first)

    const appended: SessionEvent[] = [
      ...base,
      { kind: 'user.message', sessionId: 's1', seq: base.length, ts: base.length, text: 'Next turn', attachments: [] },
      { ...call('t2'), sessionId: 's1', seq: base.length + 1, ts: base.length + 1 }
    ]
    const second = projectTranscript(appended, 's1')
    expect(second).not.toBe(first)
    // All completed historical items from turn 1 keep exact === object identity.
    for (let i = 0; i < first.items.length; i++) {
      expect(second.items[i]).toBe(first.items[i])
    }
    expect(second.todos).toBe(first.todos)
    expect(second.pending).toBe(first.pending)

    // Late tool result updates only the affected tool group and preserves other items.
    const withLateResult = projectTranscript(
      [...appended, { ...result('t1', true), sessionId: 's1', seq: appended.length, ts: appended.length }],
      's1'
    )
    expect(withLateResult.items[0]).toBe(second.items[0]) // user message
    expect(withLateResult.items[1]).toBe(second.items[1]) // assistant text
    expect(withLateResult.items[2]).not.toBe(second.items[2]) // t1 group updated
    expect(withLateResult.items[5]).toBe(second.items[5]) // next turn user message

    evictTranscript('s1')
  })
})
