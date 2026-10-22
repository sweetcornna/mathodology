import type { FileChange, NoticeCode, SessionEvent, TodoItem, ToolKind, Usage } from '@shared/types'

export interface ToolNode {
  callId: string
  name: string
  toolKind: ToolKind
  title: string
  input: unknown
  changes?: FileChange[]
  result?: { output: string; isError: boolean }
  children: ToolNode[]
  /** Sub-agent prose, for Task calls. */
  notes: string[]
}

export interface PermissionItem {
  requestId: string
  toolName: string
  title: string
  input: unknown
  resolved?: { allow: boolean; always?: boolean }
}

export type Item =
  | { type: 'user'; key: string; text: string; attachments: string[]; ts: number }
  | { type: 'text'; key: string; text: string }
  | { type: 'thinking'; key: string; text: string }
  | { type: 'tools'; key: string; tools: ToolNode[] }
  | { type: 'permission'; key: string; perm: PermissionItem }
  | { type: 'notice'; key: string; level: 'info' | 'warning' | 'error'; text: string; code?: NoticeCode; vars?: Record<string, string> }
  | { type: 'turn'; key: string; ok: boolean; durationMs?: number; usage?: Partial<Usage>; summary?: string }
  | { type: 'changes'; key: string; files: FileStat[] }

export interface FileStat {
  path: string
  added: number
  removed: number
  created: boolean
}

export interface Transcript {
  items: Item[]
  todos: TodoItem[]
  /** Unresolved permission requests, newest last. */
  pending: PermissionItem[]
  /** The newest tool call that has not finished. */
  runningTool?: ToolNode
}

function lines(s: unknown): number {
  const t = String(s ?? '')
  return t ? t.replace(/\n$/, '').split('\n').length : 0
}

/** Line-level stats for a file-changing tool call, from its input or its unified diff. */
export function fileStats(node: ToolNode): FileStat[] {
  const i = (node.input ?? {}) as Record<string, unknown>
  if (node.changes?.length) {
    return node.changes.map((c) => {
      let added = 0
      let removed = 0
      for (const l of (c.diff ?? '').split('\n')) {
        if (l.startsWith('+') && !l.startsWith('+++')) added++
        else if (l.startsWith('-') && !l.startsWith('---')) removed++
      }
      return { path: c.path, added, removed, created: c.kind === 'add' }
    })
  }
  const path = String(i.file_path ?? i.path ?? i.notebook_path ?? '')
  if (!path) return []
  if (node.name === 'Write' || node.name === 'write_file') return [{ path, added: lines(i.content), removed: 0, created: true }]
  if (node.name === 'MultiEdit' && Array.isArray(i.edits)) {
    const edits = i.edits as Record<string, unknown>[]
    return [
      {
        path,
        added: edits.reduce((n, e) => n + lines(e.new_string), 0),
        removed: edits.reduce((n, e) => n + lines(e.old_string), 0),
        created: false
      }
    ]
  }
  if (node.toolKind === 'edit') return [{ path, added: lines(i.new_string), removed: lines(i.old_string), created: false }]
  return []
}

function mergeStats(nodes: ToolNode[]): FileStat[] {
  const map = new Map<string, FileStat>()
  for (const n of nodes) {
    if (!n.result || n.result.isError) continue
    for (const f of fileStats(n)) {
      const prev = map.get(f.path)
      if (prev) {
        prev.added += f.added
        prev.removed += f.removed
      } else map.set(f.path, { ...f })
    }
  }
  return [...map.values()]
}

/**
 * Fold persisted events into display items. Consecutive tool calls are grouped so a burst of
 * reads and searches reads as one step list, the way agent transcripts are usually skimmed.
 */
export function buildTranscript(events: SessionEvent[]): Transcript {
  const items: Item[] = []
  const tools = new Map<string, ToolNode>()
  const perms = new Map<string, PermissionItem>()
  let todos: TodoItem[] = []
  let turnEdits: ToolNode[] = []
  let runningTool: ToolNode | undefined

  const lastGroup = (): Extract<Item, { type: 'tools' }> | null => {
    const last = items[items.length - 1]
    return last?.type === 'tools' ? last : null
  }

  for (const e of events) {
    switch (e.kind) {
      case 'user.message':
        items.push({ type: 'user', key: `u${e.seq}`, text: e.text, attachments: e.attachments, ts: e.ts })
        break
      case 'assistant.text':
        if (e.parentCallId) {
          tools.get(e.parentCallId)?.notes.push(e.text)
          break
        }
        items.push({ type: 'text', key: `t${e.seq}`, text: e.text })
        break
      case 'thinking':
        items.push({ type: 'thinking', key: `k${e.seq}`, text: e.text })
        break
      case 'tool.call': {
        const node: ToolNode = {
          callId: e.callId,
          name: e.name,
          toolKind: e.toolKind,
          title: e.title,
          input: e.input,
          changes: e.changes,
          children: [],
          notes: []
        }
        tools.set(e.callId, node)
        if (e.toolKind === 'edit' || e.toolKind === 'write') turnEdits.push(node)
        runningTool = node
        const parent = e.parentCallId ? tools.get(e.parentCallId) : undefined
        if (parent) {
          parent.children.push(node)
          break
        }
        if (e.toolKind === 'todo') break // shown as the task list instead
        const group = lastGroup()
        if (group) group.tools.push(node)
        else items.push({ type: 'tools', key: `g${e.seq}`, tools: [node] })
        break
      }
      case 'tool.result': {
        const node = tools.get(e.callId)
        if (node) node.result = { output: e.output, isError: e.isError }
        if (runningTool && runningTool.callId === e.callId) runningTool = undefined
        break
      }
      case 'todo.update':
        todos = e.items
        break
      case 'permission.request': {
        const perm: PermissionItem = { requestId: e.requestId, toolName: e.toolName, title: e.title, input: e.input }
        perms.set(e.requestId, perm)
        items.push({ type: 'permission', key: `p${e.seq}`, perm })
        break
      }
      case 'permission.resolved': {
        const perm = perms.get(e.requestId)
        if (perm) perm.resolved = { allow: e.allow, always: e.always }
        break
      }
      case 'notice':
        items.push({ type: 'notice', key: `n${e.seq}`, level: e.level, text: e.text, code: e.code, vars: e.vars })
        break
      case 'turn.completed': {
        const files = mergeStats(turnEdits)
        if (files.length) items.push({ type: 'changes', key: `c${e.seq}`, files })
        turnEdits = []
        runningTool = undefined
        items.push({ type: 'turn', key: `d${e.seq}`, ok: e.ok, durationMs: e.durationMs, usage: e.usage, summary: e.summary })
        break
      }
      default:
        break
    }
  }
  const pending = [...perms.values()].filter((p) => !p.resolved)
  return { items, todos, pending, runningTool }
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
