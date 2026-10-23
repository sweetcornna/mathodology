import { describe, expect, it } from 'vitest'
import type { SessionEventBody } from '@shared/types'
import { AGENTS, agentSpec } from '../src/shared/agents'
import { parseEnv } from '../src/shared/args'
import { modelBrand } from '../src/shared/brands'
import { AcpUpdateParser, acpMcpServers, autoDecision, permissionOption, pickMode } from '../src/main/agents/acp'
import { AgyStreamParser, agyArgs, agyInput, agyModels } from '../src/main/agents/agy'
import type { TurnRequest } from '../src/main/agents/base'
import { classifyTool, toolTitle } from '../src/main/agents/base'
import { envFor } from '../src/main/agents/detect'
import { PiRpcParser, piModels } from '../src/main/agents/pi'
import { qoderArgs } from '../src/main/agents/qoder'
import { ADAPTERS } from '../src/main/agents/registry'

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
  settings: { binaryPath: '', defaultModel: '', extraArgs: '', env: '' },
  env: {}
}

describe('agent catalog', () => {
  it('has one adapter per entry, with ids, binaries and ACP arguments', () => {
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length)
    for (const spec of AGENTS) {
      const adapter = ADAPTERS[spec.id]
      expect(adapter.id).toBe(spec.id)
      expect(adapter.binaryNames.length).toBeGreaterThan(0)
      if (spec.route === 'acp') expect(spec.acpArgs).toBeDefined()
    }
    expect(Object.keys(ADAPTERS)).toEqual(AGENTS.map((a) => a.id))
  })
  it('keeps Gemini CLI as a legacy entry pointing at Antigravity CLI', () => {
    expect(agentSpec('gemini')?.supersededBy).toBe('agy')
    expect(agentSpec('agy')?.route).toBe('agy-stream')
  })
  it('falls back to the agent brand only when the agent has one', () => {
    expect(modelBrand({ id: '', label: 'Default' }, 'agy')).toBe('gemini')
    expect(modelBrand({ id: '', label: 'Default' }, 'opencode')).toBeNull()
    expect(modelBrand({ id: 'magpie/claude/claude-haiku-5-5', label: 'Haiku' }, 'pi')).toBe('claude')
  })
})

describe('per-agent environment', () => {
  it('reads KEY=VALUE lines and removes keys left empty', () => {
    expect(parseEnv('# gateway\nGEMINI_API_KEY=abc\nexport BASE="http://x:1"\nbad line\nTOKEN=\n')).toEqual({
      GEMINI_API_KEY: 'abc',
      BASE: 'http://x:1',
      TOKEN: ''
    })
    const env = envFor({ PATH: '/bin', TOKEN: 'secret' }, { ...req.settings, env: 'TOKEN=\nKEY=v' })
    expect(env).toEqual({ PATH: '/bin', KEY: 'v' })
  })
})

describe('tool names across agents', () => {
  it('classifies Antigravity, pi and Qoder tools', () => {
    expect(classifyTool('run_command')).toBe('shell')
    expect(classifyTool('view_file')).toBe('read')
    expect(classifyTool('write_to_file')).toBe('write')
    expect(classifyTool('replace_file_content')).toBe('edit')
    expect(classifyTool('read_url_content')).toBe('web')
    expect(classifyTool('search_web')).toBe('web')
    expect(classifyTool('grep_search')).toBe('search')
    expect(classifyTool('list_dir')).toBe('search')
    expect(toolTitle('run_command', { CommandLine: 'ls -la' })).toBe('ls -la')
    expect(toolTitle('view_file', { AbsolutePath: '/a/b/data.csv' })).toBe('data.csv')
  })
})

describe('Qoder CLI', () => {
  it('maps permission modes onto its own flags', () => {
    expect(qoderArgs({ ...req, permissionMode: 'ask', model: 'ultimate', effort: 'high', newSessionId: 'n1' })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'default',
      '--model', 'ultimate', '--reasoning-effort', 'high', '--session-id', 'n1'
    ])
    expect(qoderArgs({ ...req, permissionMode: 'acceptEdits' })).toContain('accept_edits')
    expect(qoderArgs({ ...req, permissionMode: 'plan' })).toContain('--disallowed-tools')
    expect(qoderArgs({ ...req, permissionMode: 'bypass', resumeId: 'r1' })).toEqual(
      expect.arrayContaining(['--dangerously-skip-permissions', '--resume', 'r1'])
    )
  })
})

describe('Antigravity CLI stream-json', () => {
  it('builds its arguments and stdin line', () => {
    expect(agyArgs({ ...req, permissionMode: 'plan', model: 'm', resumeId: 'c1' })).toEqual([
      '--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'plan', '--model', 'm', '--conversation', 'c1', '-p='
    ])
    expect(agyArgs({ ...req, permissionMode: 'bypass' })).toContain('--dangerously-skip-permissions')
    const line = JSON.parse(agyInput({ prompt: 'hi', systemAppend: 'note' }))
    expect(line.event).toBe('user')
    expect(line.message.content[0].text).toBe('note\n\n---\n\nhi')
  })

  it('maps init, steps, tools, denied actions and usage', () => {
    const s = sink()
    const p = new AgyStreamParser(s)
    for (const l of lines(
      { event: 'init', conversation_id: 'c1', init: { model: 'gemini-x', cwd: '/tmp/p', permission_mode: 'request-review' } },
      { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 0, state: 'DONE', step_type: 'user_input' } },
      { event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Sum ' } },
      { event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'is 6', usage: { total_tokens: 12 } } },
      { event: 'step_update', step_update: { step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'awk' } } } },
      { event: 'step_update', step_update: { step_index: 2, state: 'ERROR', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'awk' }, error: { type: 'TOOL_ERROR', message: 'denied' } } } },
      {
        event: 'result',
        result: {
          conversation_id: 'c1',
          status: 'SUCCESS',
          response: 'Sum is 6',
          duration_seconds: 2,
          usage: { input_tokens: 10, output_tokens: 3, thinking_tokens: 2, cache_read_tokens: 5 },
          denied_actions: [{ action: 'command', display_name: 'RunCommand' }]
        }
      }
    ))
      p.line(l)
    expect(s.events.map((e) => e.kind)).toEqual([
      'session.started',
      'assistant.delta',
      'assistant.delta',
      'assistant.text',
      'turn.progress',
      'tool.call',
      'tool.result',
      'notice',
      'turn.completed'
    ])
    expect(s.native).toContain('c1')
    expect((s.events[3] as { text: string }).text).toBe('Sum is 6')
    expect(s.events[6]).toMatchObject({ kind: 'tool.result', isError: true, output: 'denied' })
    expect(s.events[7]).toMatchObject({ code: 'deniedActions', vars: { actions: 'RunCommand' } })
    expect(s.events[8]).toMatchObject({ ok: true, durationMs: 2000, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 5 } })
  })

  it('shows a reply that arrives only in the result', () => {
    const s = sink()
    const p = new AgyStreamParser(s)
    p.line(JSON.stringify({ event: 'result', result: { status: 'ERROR', response: 'partial', error: 'model is empty' } }))
    expect(s.events.map((e) => e.kind)).toEqual(['assistant.text', 'notice', 'turn.completed'])
    expect(s.events[2]).toMatchObject({ ok: false })
  })

  it('reads `agy models`', () => {
    expect(agyModels('Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\n')).toEqual([
      { id: '', label: 'Default' },
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' }
    ])
    expect(agyModels('error: not signed in')).toEqual([])
  })
})

describe('pi and oh-my-pi RPC', () => {
  it('maps a pi run: state, streamed text, tools and usage', () => {
    const s = sink()
    const p = new PiRpcParser(s, 'pi')
    for (const l of lines(
      { id: 'studio-state', type: 'response', command: 'get_state', success: true, data: { sessionId: 'ps1', model: { id: 'claude-haiku-5-5', provider: 'magpie' } } },
      { id: 'studio-prompt', type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } },
      { type: 'agent_start' },
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      { type: 'message_update', usage: { totalTokens: 40 }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' } },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }, { type: 'toolCall', id: 't1', name: 'bash' }], usage: { input: 30, output: 10, cacheRead: 5, cacheWrite: 2, totalTokens: 47, cost: { total: 0.01 } } } },
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
      { type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'a.csv' }] }, isError: false },
      { type: 'agent_end', messages: [] },
      { type: 'agent_settled', aborted: false }
    ))
      p.line(l)
    expect(s.events.map((e) => e.kind)).toEqual([
      'session.started',
      'assistant.delta',
      'turn.progress',
      'assistant.text',
      'tool.call',
      'tool.result',
      'turn.completed'
    ])
    expect(s.native).toEqual(['ps1'])
    expect(s.events[0]).toMatchObject({ agent: 'pi', model: 'magpie/claude-haiku-5-5' })
    expect((s.events[1] as { blockId: string }).blockId).toBe((s.events[3] as { blockId: string }).blockId)
    expect(s.events[6]).toMatchObject({ ok: true, usage: { inputTokens: 32, outputTokens: 10, cacheReadTokens: 5, costUsd: 0.01 } })
    expect(p.settled).toBe(true)
  })

  it('turns an oh-my-pi tool approval dialog into a permission request and answers it', () => {
    const s = sink()
    const p = new PiRpcParser(s, 'omp')
    for (const l of lines(
      { type: 'ready', protocolVersion: 1 },
      { type: 'agent_start' },
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'awk x' }, intent: 'Sum column' },
      { type: 'extension_ui_request', id: 'd1', method: 'select', title: 'Allow tool: bash\nCommand: awk x', options: ['Approve', 'Approve bash for this session', 'Deny'] }
    ))
      p.line(l)
    const reqEvent = s.events.find((e) => e.kind === 'permission.request')
    expect(reqEvent).toMatchObject({ requestId: 'd1', callId: 'c1', toolName: 'bash', input: { command: 'awk x' } })
    expect(p.reply('d1', true, true)).toEqual({ type: 'extension_ui_response', id: 'd1', value: 'Approve bash for this session' })
    expect(p.reply('d1', true)).toBeNull()
    p.line(JSON.stringify({ type: 'extension_ui_request', id: 'd2', method: 'select', title: 'Allow tool: write', options: ['Approve', 'Deny'] }))
    expect(p.reply('d2', false)).toEqual({ type: 'extension_ui_response', id: 'd2', value: 'Deny' })
    p.line(JSON.stringify({ type: 'extension_ui_request', id: 'd3', method: 'confirm', title: 'Clear?' }))
    expect(p.reply('d3', true)).toEqual({ type: 'extension_ui_response', id: 'd3', confirmed: true })
    // oh-my-pi ends a prompt with prompt_result, then session_settled.
    p.line(JSON.stringify({ type: 'prompt_result', id: 'studio-prompt', status: 'completed', sessionSettled: true }))
    expect(s.events.at(-1)).toMatchObject({ kind: 'turn.completed', ok: true })
  })

  it('cancels free-text dialogs it cannot show and ignores settle signals before the run', () => {
    const s = sink()
    const p = new PiRpcParser(s, 'omp')
    const sent: unknown[] = []
    p.autoReply = (o) => sent.push(o)
    p.line(JSON.stringify({ type: 'session_settled' }))
    expect(p.settled).toBe(false)
    p.line(JSON.stringify({ type: 'extension_ui_request', id: 'i1', method: 'input', title: 'Name?' }))
    expect(sent).toEqual([{ type: 'extension_ui_response', id: 'i1', cancelled: true }])
  })

  it('reads models with their thinking levels', () => {
    const models = piModels(
      [
        { id: 'haiku', name: 'Haiku', provider: 'magpie', reasoning: true, thinkingLevelMap: { off: null, xhigh: 'xhigh' } },
        { id: 'gpt', name: 'GPT', provider: 'codex', thinking: { mode: 'effort', efforts: ['low', 'high'] } },
        { id: 'plain', name: 'Plain', provider: 'local', reasoning: false }
      ],
      'medium'
    )
    expect(models[0]).toEqual({ id: '', label: 'Default' })
    expect(models[1]).toMatchObject({ id: 'magpie/haiku', group: 'magpie', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' })
    expect(models[2]).toMatchObject({ id: 'codex/gpt', efforts: ['low', 'high'] })
    expect(models[3].efforts).toBeUndefined()
  })
})

describe('Agent Client Protocol', () => {
  it('maps streamed messages, thoughts, tool calls, plans and usage', () => {
    const s = sink()
    const p = new AcpUpdateParser(s)
    p.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'think' } })
    p.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } })
    p.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } })
    p.update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Write sum.txt', kind: 'edit', status: 'pending', locations: [{ path: '/tmp/p/sum.txt' }] })
    p.update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'diff', path: '/tmp/p/sum.txt', oldText: null, newText: '6' }] })
    p.update({ sessionUpdate: 'plan', entries: [{ content: 'sum', priority: 'high', status: 'in_progress' }] })
    p.update({ sessionUpdate: 'usage_update', used: 900, size: 200000 })
    p.update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'ls', kind: 'execute', status: 'in_progress' })
    p.close()
    expect(s.events.map((e) => e.kind)).toEqual([
      'assistant.delta',
      'thinking',
      'assistant.delta',
      'assistant.delta',
      'assistant.text',
      'tool.call',
      'tool.result',
      'todo.update',
      'turn.progress',
      'tool.call',
      'tool.result'
    ])
    expect(s.events[4]).toMatchObject({ text: 'Hello' })
    expect(s.events[5]).toMatchObject({ kind: 'tool.call', toolKind: 'edit', title: 'Write sum.txt', input: { path: '/tmp/p/sum.txt' } })
    expect(s.events[6]).toMatchObject({ output: '/tmp/p/sum.txt (edited)', isError: false })
    expect(s.events[10]).toMatchObject({ callId: 't2', isError: true })
  })

  it('skips replayed history while a session loads', () => {
    const s = sink()
    const p = new AcpUpdateParser(s)
    p.muted = true
    p.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old' } })
    expect(s.events).toEqual([])
  })

  it('answers permission requests and picks modes for each permission mode', () => {
    const options = [
      { optionId: 'a1', kind: 'allow_once' },
      { optionId: 'a2', kind: 'allow_always' },
      { optionId: 'r1', kind: 'reject_once' }
    ]
    expect(permissionOption(options, true)).toBe('a1')
    expect(permissionOption(options, true, true)).toBe('a2')
    expect(permissionOption(options, false)).toBe('r1')
    expect(permissionOption([], false)).toBeUndefined()

    const modes = [{ id: 'default' }, { id: 'autoEdit', name: 'Auto Edit' }, { id: 'yolo' }, { id: 'plan' }]
    expect(pickMode(modes, 'ask')).toBe('default')
    expect(pickMode(modes, 'acceptEdits')).toBe('autoEdit')
    expect(pickMode(modes, 'bypass')).toBe('yolo')
    expect(pickMode(modes, 'plan')).toBe('plan')
    expect(pickMode([{ id: 'build' }, { id: 'plan' }], 'bypass')).toBeUndefined()

    expect(autoDecision('bypass', 'execute')).toBe(true)
    expect(autoDecision('acceptEdits', 'edit')).toBe(true)
    expect(autoDecision('acceptEdits', 'execute')).toBeUndefined()
    expect(autoDecision('plan', 'execute')).toBe(false)
    expect(autoDecision('plan', 'read')).toBe(true)
    expect(autoDecision('ask', 'read')).toBeUndefined()
  })

  it('passes Studio connectors as ACP MCP servers', () => {
    const connectors = [
      { id: 'search', name: 'Search', enabled: true, command: 'uvx', args: ['free-search-mcp'], env: { A: '1' } },
      { id: 'remote', name: 'Remote', enabled: true, url: 'https://mcp.example/mcp' }
    ]
    expect(acpMcpServers(connectors, false)).toEqual([{ name: 'search', command: 'uvx', args: ['free-search-mcp'], env: [{ name: 'A', value: '1' }] }])
    expect(acpMcpServers(connectors, true)[1]).toEqual({ type: 'http', name: 'remote', url: 'https://mcp.example/mcp', headers: [] })
  })
})
