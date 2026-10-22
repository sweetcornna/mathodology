import { describe, expect, it } from 'vitest'
import type { SessionEventBody } from '@shared/types'
import { LineSplitter, classifyTool, splitArgs, toolTitle } from '../src/main/agents/base'
import { joinArgs } from '../src/shared/args'
import { ClaudeStreamParser, claudeArgs } from '../src/main/agents/claude'
import { CodexAppServerParser, codexArgs } from '../src/main/agents/codex'
import { GeminiStreamParser, geminiArgs, geminiInput } from '../src/main/agents/gemini'
import type { TurnRequest } from '../src/main/agents/base'

function sink() {
  const events: SessionEventBody[] = []
  const native: string[] = []
  return { events, native, emit: (e: SessionEventBody) => events.push(e), nativeSession: (id: string) => native.push(id) }
}

const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o))

const req: TurnRequest = {
  binary: 'x',
  cwd: '/tmp/p',
  prompt: 'hi',
  permissionMode: 'ask',
  settings: { binaryPath: '', defaultModel: '', extraArgs: '--foo "a b"' },
  env: {}
}

describe('base helpers', () => {
  it('splits lines across chunks', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\r\n')).toEqual(['{"b":2}'])
    expect(s.flush()).toEqual([])
  })
  it('splits quoted extra args', () => {
    expect(splitArgs(`--foo "a b" 'c d' e`)).toEqual(['--foo', 'a b', 'c d', 'e'])
  })
  it('keeps backslashes when quoting args for display and reading them back', () => {
    const parts = ['--config', 'C:\\Program Files\\tool\\cfg.json', 'say "hi" now', 'x']
    expect(splitArgs(joinArgs(parts))).toEqual(parts)
  })
  it('classifies and titles tools', () => {
    expect(classifyTool('Bash')).toBe('shell')
    expect(classifyTool('mcp__search__fetch')).toBe('mcp')
    expect(classifyTool('TodoWrite')).toBe('todo')
    expect(toolTitle('Read', { file_path: '/a/b/model.py' })).toBe('model.py')
    expect(toolTitle('Read', { file_path: 'C:\\proj\\code\\model.py' })).toBe('model.py')
    expect(toolTitle('Bash', { command: 'ls', description: 'List files' })).toBe('List files')
  })
})

describe('Claude Code stream-json', () => {
  it('maps init, streamed text, tool use, results and usage', () => {
    const s = sink()
    const p = new ClaudeStreamParser(s)
    for (const l of lines(
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus', cwd: '/tmp/p', tools: [] },
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } }, parent_tool_use_id: null },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Hello' }] }, parent_tool_use_id: null },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls', description: 'List' } },
            { type: 'tool_use', id: 'tu_2', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'in_progress', activeForm: 'A' }] } }
          ]
        },
        parent_tool_use_id: null
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'x.py' }], is_error: false }] } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1200,
        total_cost_usd: 0.01,
        session_id: 'sess-1',
        usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 20 }
      }
    ))
      p.line(l)

    const kinds = s.events.map((e) => e.kind)
    expect(kinds).toEqual([
      'session.started',
      'turn.progress',
      'assistant.delta',
      'assistant.delta',
      'assistant.text',
      'tool.call',
      'tool.call',
      'todo.update',
      'tool.result',
      'turn.completed'
    ])
    const delta = s.events[2] as Extract<SessionEventBody, { kind: 'assistant.delta' }>
    const text = s.events[4] as Extract<SessionEventBody, { kind: 'assistant.text' }>
    expect(delta.blockId).toBe(text.blockId)
    expect(s.native).toContain('sess-1')
    const done = s.events[9] as Extract<SessionEventBody, { kind: 'turn.completed' }>
    expect(done.ok).toBe(true)
    expect(done.usage).toEqual({ inputTokens: 15, outputTokens: 20, cacheReadTokens: 100, costUsd: 0.01 })
    expect(p.sawResult).toBe(true)
  })

  it('surfaces permission requests and nests sub-agent calls', () => {
    const s = sink()
    const p = new ClaudeStreamParser(s)
    for (const l of lines(
      {
        type: 'control_request',
        request_id: 'req-1',
        request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: '/p/a.md', content: 'x' }, tool_use_id: 'tu_9' }
      },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu_3', name: 'Read', input: { file_path: '/p/b' } }] }, parent_tool_use_id: 'tu_task' }
    ))
      p.line(l)
    expect(s.events[0]).toMatchObject({ kind: 'permission.request', requestId: 'req-1', callId: 'tu_9', toolName: 'Write', title: 'a.md' })
    expect(p.pending.has('req-1')).toBe(true)
    expect(s.events[1]).toMatchObject({ kind: 'tool.call', callId: 'tu_3', parentCallId: 'tu_task' })
  })

  it('builds headless arguments', () => {
    const args = claudeArgs({ ...req, resumeId: 'sess-1', model: 'opus', systemAppend: 'S' })
    expect(args).toContain('--include-partial-messages')
    expect(args.join(' ')).toContain('--permission-prompt-tool stdio')
    expect(args.join(' ')).toContain('--resume sess-1')
    expect(args.join(' ')).toContain('--permission-mode manual')
    expect(claudeArgs({ ...req, newSessionId: 'new-1' }).join(' ')).toContain('--session-id new-1')
    expect(args.slice(-2)).toEqual(['--foo', 'a b'])
    const bypass = claudeArgs({ ...req, permissionMode: 'bypass' }).join(' ')
    expect(bypass).not.toContain('--permission-prompt-tool')
    expect(bypass).toContain('--dangerously-skip-permissions')
  })
})

describe('Codex app-server', () => {
  it('maps deltas, commands, file changes, plans and usage', () => {
    const s = sink()
    const p = new CodexAppServerParser(s)
    p.notification('turn/started', { threadId: 'th', turn: { id: 'turn-1' } })
    p.notification('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'Plan', summaryIndex: 0 })
    p.notification('item/completed', { item: { type: 'reasoning', id: 'r1', summary: ['Plan'], content: [] } })
    p.notification('item/started', { item: { type: 'commandExecution', id: 'c1', command: 'ls', cwd: '/p', status: 'inProgress' } })
    p.notification('item/completed', { item: { type: 'commandExecution', id: 'c1', command: 'ls', aggregatedOutput: 'a\n', exitCode: 0, status: 'completed' } })
    p.notification('item/started', { item: { type: 'fileChange', id: 'f1', changes: [{ path: '/p/x.py', kind: { type: 'add' }, diff: '+a\n+b' }], status: 'inProgress' } })
    p.notification('item/completed', { item: { type: 'fileChange', id: 'f1', changes: [{ path: '/p/x.py', kind: { type: 'add' }, diff: '+a\n+b' }], status: 'completed' } })
    p.notification('turn/plan/updated', { plan: [{ step: 'a', status: 'completed' }, { step: 'b', status: 'inProgress' }] })
    p.notification('item/agentMessage/delta', { itemId: 'm1', delta: 'Do' })
    p.notification('item/completed', { item: { type: 'agentMessage', id: 'm1', text: 'Done' } })
    p.notification('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 7 } } })
    p.notification('turn/completed', { turn: { id: 'turn-1', status: 'completed', durationMs: 900 } })

    expect(p.turnId).toBe('turn-1')
    expect(s.events.map((e) => e.kind)).toEqual([
      'assistant.delta',
      'thinking',
      'tool.call',
      'tool.result',
      'tool.call',
      'tool.result',
      'todo.update',
      'assistant.delta',
      'assistant.text',
      'turn.progress',
      'turn.completed'
    ])
    expect(s.events[4]).toMatchObject({ toolKind: 'edit', changes: [{ path: '/p/x.py', kind: 'add', diff: '+a\n+b' }] })
    expect(s.events[6]).toMatchObject({ items: [{ status: 'completed' }, { status: 'in_progress' }] })
    expect(s.events[10]).toMatchObject({ ok: true, durationMs: 900, usage: { inputTokens: 40, cacheReadTokens: 60, outputTokens: 7 } })
    expect(p.done).toBe(true)
  })

  it('turns approval requests into permission events and answers them', () => {
    const s = sink()
    const p = new CodexAppServerParser(s)
    const reply = p.request({ id: 7, method: 'item/commandExecution/requestApproval', params: { itemId: 'c2', command: 'rm -rf build', threadId: 't', turnId: 'u' } })
    expect(reply).toBeNull()
    expect(s.events[0]).toMatchObject({ kind: 'permission.request', requestId: '7', toolName: 'shell', title: 'rm -rf build' })
    expect(p.decision('7', true, true)).toEqual({ id: 7, result: { decision: 'acceptForSession' } })
    expect(p.decision('7', true)).toBeNull()
    p.request({ id: 8, method: 'applyPatchApproval', params: {} })
    expect(p.decision('8', false)).toEqual({ id: 8, result: { decision: 'denied' } })
    expect(p.request({ id: 9, method: 'item/tool/requestUserInput', params: {} })).toBeUndefined()
  })

  it('starts an app-server with plan and reasoning enabled', () => {
    const args = codexArgs(req)
    expect(args[0]).toBe('app-server')
    expect(args.join(' ')).toContain('tools.update_plan.enabled=true')
    expect(args.slice(-2)).toEqual(['--foo', 'a b'])
  })
})

describe('Gemini stream-json', () => {
  it('maps init, deltas, tools and result', () => {
    const s = sink()
    const p = new GeminiStreamParser(s)
    for (const l of lines(
      { type: 'init', session_id: 'g-1', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'message', role: 'assistant', content: 'Hel', delta: true },
      { type: 'message', role: 'assistant', content: 'lo', delta: true },
      { type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { absolute_path: '/p/a.csv' } },
      { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
      { type: 'result', status: 'success', stats: { input_tokens: 3, output_tokens: 4, duration_ms: 9 } }
    ))
      p.line(l)
    expect(s.events.map((e) => e.kind)).toEqual([
      'session.started',
      'assistant.delta',
      'assistant.delta',
      'assistant.text',
      'tool.call',
      'tool.result',
      'turn.completed'
    ])
    expect(s.events[3]).toMatchObject({ text: 'Hello' })
    expect(s.events[4]).toMatchObject({ title: 'a.csv', toolKind: 'read' })
  })

  it('sends the prompt on stdin, never as an argument', () => {
    // A prompt as an argument hits command-line limits, and Gemini's parser refuses "- fix ..." there.
    const turn = { ...req, prompt: '- fix the axis labels\n- rerun', resumeId: 'g-1' }
    const args = geminiArgs(turn)
    expect(args.join(' ')).toContain('--resume g-1 --foo a b')
    expect(args.some((a) => a.includes('fix the axis'))).toBe(false)
    expect(args.some((a) => a === '-p' || a.startsWith('--prompt'))).toBe(false)
    expect(geminiInput(turn)).toBe('- fix the axis labels\n- rerun')
    expect(geminiInput({ ...req, systemAppend: 'S' })).toBe('S\n\n---\n\nhi')
  })
})
