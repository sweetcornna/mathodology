import type { AgentQuestion, ArtifactKind, FileChange, NoticeCode, SessionEvent, TodoItem, ToolKind, Usage, VersionOrigin } from '@shared/types'

export interface ToolNode {
  callId: string
  name: string
  toolKind: ToolKind
  title: string
  input: unknown
  changes?: FileChange[]
  result?: { output: string; isError: boolean }
  /** The turn ended without a recorded result; this is not a successful result. */
  stopped?: boolean
  children: ToolNode[]
  /** Sub-agent prose, for Task calls. */
  notes: string[]
}

export interface PermissionItem {
  requestId: string
  toolName: string
  title: string
  input: unknown
  /** The agent asks the user to answer rather than to approve. */
  questions?: AgentQuestion[]
  resolved?: { allow: boolean; always?: boolean; answers?: Record<string, string[]> }
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
  | { type: 'generated'; key: string; files: GeneratedFile[] }

/** An artifact version produced during one turn, for the card row under that turn. */
export interface GeneratedFile {
  artifactId: string
  rel: string
  v: number
  kind: ArtifactKind
  origin: VersionOrigin
  added?: number
  removed?: number
}

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
  let turnTools: ToolNode[] = []
  let turnArtifacts = new Map<string, GeneratedFile>()
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
        turnTools.push(node)
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
        if (node) {
          node.result = { output: e.output, isError: e.isError }
          delete node.stopped
        }
        if (runningTool && runningTool.callId === e.callId) runningTool = undefined
        break
      }
      case 'todo.update':
        todos = e.items
        break
      case 'permission.request': {
        const perm: PermissionItem = { requestId: e.requestId, toolName: e.toolName, title: e.title, input: e.input, questions: e.questions }
        perms.set(e.requestId, perm)
        items.push({ type: 'permission', key: `p${e.seq}`, perm })
        break
      }
      case 'permission.resolved': {
        const perm = perms.get(e.requestId)
        if (perm) perm.resolved = { allow: e.allow, always: e.always, answers: e.answers }
        break
      }
      case 'notice':
        items.push({ type: 'notice', key: `n${e.seq}`, level: e.level, text: e.text, code: e.code, vars: e.vars })
        break
      case 'artifact.version':
        // Later versions in the same turn replace earlier ones; the card shows the newest.
        turnArtifacts.delete(e.artifactId)
        turnArtifacts.set(e.artifactId, { artifactId: e.artifactId, rel: e.rel, v: e.v, kind: e.artifactKind, origin: e.origin })
        break
      case 'turn.completed': {
        for (const node of turnTools) {
          if (!node.result) node.stopped = true
        }
        turnTools = []
        const files = mergeStats(turnEdits)
        if (turnArtifacts.size) {
          const stats = new Map(files.map((f) => [f.path.split(/[\\/]/).slice(-2).join('/'), f]))
          const generated = [...turnArtifacts.values()].map((g) => {
            const s = stats.get(g.rel.split('/').slice(-2).join('/'))
            return s ? { ...g, added: s.added, removed: s.removed } : g
          })
          items.push({ type: 'generated', key: `a${e.seq}`, files: generated })
        } else if (files.length) items.push({ type: 'changes', key: `c${e.seq}`, files })
        turnEdits = []
        turnArtifacts = new Map()
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

const EMPTY_TRANSCRIPT: Transcript = { items: [], todos: [], pending: [] }
const byEventsRef = new WeakMap<SessionEvent[], Transcript>()
const bySessionId = new Map<string, Transcript>()

function strArrEq(a: string[], b: string[]): boolean {
  return a === b || (a.length === b.length && a.every((v, i) => v === b[i]))
}

function recordStrArrEq(a?: Record<string, string[]>, b?: Record<string, string[]>): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] !== undefined && strArrEq(a[k], b[k]))
}

function permEqual(a: PermissionItem, b: PermissionItem): boolean {
  if (a === b) return true
  if (a.requestId !== b.requestId || a.toolName !== b.toolName || a.title !== b.title || a.input !== b.input) return false
  if (a.resolved === b.resolved) return true
  if (!a.resolved || !b.resolved) return false
  return (
    a.resolved.allow === b.resolved.allow &&
    a.resolved.always === b.resolved.always &&
    recordStrArrEq(a.resolved.answers, b.resolved.answers)
  )
}

function stabilizeNode(prev: ToolNode | undefined, next: ToolNode, stabilizedNodes: Map<string, ToolNode>): ToolNode {
  if (!prev || prev.callId !== next.callId || prev.name !== next.name || prev.toolKind !== next.toolKind || prev.title !== next.title || prev.input !== next.input || prev.changes !== next.changes) {
    const out = next.children.length
      ? { ...next, children: next.children.map((c) => stabilizeNode(undefined, c, stabilizedNodes)) }
      : next
    stabilizedNodes.set(out.callId, out)
    return out
  }
  const sameResult =
    prev.result === next.result ||
    (Boolean(prev.result && next.result) && prev.result!.isError === next.result!.isError && prev.result!.output === next.result!.output)
  const sameNotes = strArrEq(prev.notes, next.notes)
  let childrenSame = prev.children.length === next.children.length
  const children = next.children.map((c, idx) => {
    const sc = stabilizeNode(prev.children[idx], c, stabilizedNodes)
    if (sc !== prev.children[idx]) childrenSame = false
    return sc
  })
  if (sameResult && prev.stopped === next.stopped && sameNotes && childrenSame) {
    stabilizedNodes.set(prev.callId, prev)
    return prev
  }
  const out: ToolNode = {
    ...next,
    result: sameResult ? prev.result : next.result,
    notes: sameNotes ? prev.notes : next.notes,
    children: childrenSame ? prev.children : children
  }
  stabilizedNodes.set(out.callId, out)
  return out
}

function fileStatsEq(a: FileStat[], b: FileStat[]): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every((x, i) => x.path === b[i].path && x.added === b[i].added && x.removed === b[i].removed && x.created === b[i].created))
  )
}

function generatedEq(a: GeneratedFile[], b: GeneratedFile[]): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every(
        (x, i) =>
          x.artifactId === b[i].artifactId &&
          x.rel === b[i].rel &&
          x.v === b[i].v &&
          x.kind === b[i].kind &&
          x.origin === b[i].origin &&
          x.added === b[i].added &&
          x.removed === b[i].removed
      ))
  )
}

function stabilizeItem(prev: Item | undefined, next: Item, stabilizedNodes: Map<string, ToolNode>): Item {
  if (!prev || prev.type !== next.type || prev.key !== next.key) {
    if (next.type === 'tools') {
      return { ...next, tools: next.tools.map((t) => stabilizeNode(undefined, t, stabilizedNodes)) }
    }
    return next
  }
  switch (next.type) {
    case 'user': {
      const p = prev as typeof next
      return p.text === next.text && p.ts === next.ts && strArrEq(p.attachments, next.attachments) ? p : next
    }
    case 'text':
    case 'thinking': {
      const p = prev as typeof next
      return p.text === next.text ? p : next
    }
    case 'notice': {
      const p = prev as typeof next
      return p.level === next.level && p.text === next.text && p.code === next.code && p.vars === next.vars ? p : next
    }
    case 'turn': {
      const p = prev as typeof next
      return p.ok === next.ok && p.durationMs === next.durationMs && p.summary === next.summary && p.usage === next.usage ? p : next
    }
    case 'changes': {
      const p = prev as typeof next
      return fileStatsEq(p.files, next.files) ? p : next
    }
    case 'generated': {
      const p = prev as typeof next
      return generatedEq(p.files, next.files) ? p : next
    }
    case 'permission': {
      const p = prev as typeof next
      return permEqual(p.perm, next.perm) ? p : next
    }
    case 'tools': {
      const p = prev as typeof next
      let same = p.tools.length === next.tools.length
      const tools = next.tools.map((t, idx) => {
        const st = stabilizeNode(p.tools[idx], t, stabilizedNodes)
        if (st !== p.tools[idx]) same = false
        return st
      })
      return same ? p : { ...next, tools }
    }
  }
}

function stabilizeTranscript(prev: Transcript | undefined, next: Transcript): Transcript {
  if (!prev) return next
  const prevByKey = new Map(prev.items.map((item) => [item.key, item]))
  const stabilizedNodes = new Map<string, ToolNode>()
  let itemsSame = prev.items.length === next.items.length
  const items = next.items.map((item, i) => {
    const out = stabilizeItem(prevByKey.get(item.key), item, stabilizedNodes)
    if (out !== prev.items[i]) itemsSame = false
    return out
  })
  const todosSame =
    prev.todos === next.todos ||
    (prev.todos.length === next.todos.length &&
      prev.todos.every((x, i) => x.content === next.todos[i].content && x.status === next.todos[i].status))
  const todos = todosSame ? prev.todos : next.todos
  const pendingSame =
    prev.pending === next.pending ||
    (prev.pending.length === next.pending.length && prev.pending.every((x, i) => permEqual(x, next.pending[i])))
  const pending = pendingSame ? prev.pending : next.pending
  const runningTool = next.runningTool ? (stabilizedNodes.get(next.runningTool.callId) ?? next.runningTool) : undefined
  if (itemsSame && todosSame && pendingSame && runningTool === prev.runningTool) return prev
  return {
    items: itemsSame ? prev.items : items,
    todos,
    pending,
    runningTool
  }
}

/**
 * Shared memoized transcript projection across Transcript, Composer Dock, and Tasks tab.
 * Reuses the exact Transcript object for identical event arrays and preserves completed Item
 * and ToolNode object identities across appends so React.memo skips historical rows.
 */
export function projectTranscript(events: SessionEvent[], sessionId?: string): Transcript {
  if (events.length === 0) return EMPTY_TRANSCRIPT
  const cached = byEventsRef.get(events)
  if (cached) return cached
  const sid = sessionId ?? events[0]?.sessionId
  const prev = sid ? bySessionId.get(sid) : undefined
  const built = buildTranscript(events)
  const projected = stabilizeTranscript(prev, built)
  byEventsRef.set(events, projected)
  if (sid) bySessionId.set(sid, projected)
  return projected
}

/** Clear cached projection state when a session is deleted. */
export function evictTranscript(sessionId: string): void {
  bySessionId.delete(sessionId)
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
