import type { ToolKind } from '@shared/types'
import type { ToolNode } from './transcript'

type Lang = 'zh' | 'en'

interface Verb {
  one: (title: string) => string
  many: (n: number) => string
  running: (title: string) => string
}

const EN: Record<ToolKind, Verb> = {
  shell: { one: () => 'ran a command', many: (n) => `ran ${n} commands`, running: (t) => `Running ${t}` },
  read: { one: (t) => `read ${t}`, many: (n) => `read ${n} files`, running: (t) => `Reading ${t}` },
  edit: { one: (t) => `edited ${t}`, many: (n) => `edited ${n} files`, running: (t) => `Editing ${t}` },
  write: { one: (t) => `created ${t}`, many: (n) => `created ${n} files`, running: (t) => `Writing ${t}` },
  search: { one: () => 'searched the project', many: (n) => `searched ${n} times`, running: () => 'Searching' },
  web: { one: () => 'fetched a page', many: (n) => `fetched ${n} pages`, running: () => 'Looking things up' },
  task: { one: () => 'ran a sub-agent', many: (n) => `ran ${n} sub-agents`, running: (t) => `Delegating: ${t}` },
  todo: { one: () => 'updated tasks', many: () => 'updated tasks', running: () => 'Planning' },
  mcp: { one: (t) => `used ${t}`, many: (n) => `used ${n} tools`, running: (t) => `Using ${t}` },
  skill: { one: (t) => `loaded skill ${t}`, many: (n) => `loaded ${n} skills`, running: (t) => `Loading ${t}` },
  other: { one: () => 'used a tool', many: (n) => `used ${n} tools`, running: () => 'Working' }
}

const ZH: Record<ToolKind, Verb> = {
  shell: { one: () => '运行了 1 条命令', many: (n) => `运行了 ${n} 条命令`, running: (t) => `正在运行 ${t}` },
  read: { one: (t) => `读取 ${t}`, many: (n) => `读取了 ${n} 个文件`, running: (t) => `正在读取 ${t}` },
  edit: { one: (t) => `编辑 ${t}`, many: (n) => `编辑了 ${n} 个文件`, running: (t) => `正在编辑 ${t}` },
  write: { one: (t) => `创建 ${t}`, many: (n) => `创建了 ${n} 个文件`, running: (t) => `正在写入 ${t}` },
  search: { one: () => '搜索了项目', many: (n) => `搜索了 ${n} 次`, running: () => '正在搜索' },
  web: { one: () => '查阅了 1 个网页', many: (n) => `查阅了 ${n} 个网页`, running: () => '正在查资料' },
  task: { one: () => '委派了 1 个子 agent', many: (n) => `委派了 ${n} 个子 agent`, running: (t) => `子 agent：${t}` },
  todo: { one: () => '更新了任务', many: () => '更新了任务', running: () => '正在规划' },
  mcp: { one: (t) => `调用 ${t}`, many: (n) => `调用了 ${n} 个工具`, running: (t) => `正在调用 ${t}` },
  skill: { one: (t) => `加载技能 ${t}`, many: (n) => `加载了 ${n} 个技能`, running: (t) => `正在加载 ${t}` },
  other: { one: () => '使用了 1 个工具', many: (n) => `使用了 ${n} 个工具`, running: () => '正在处理' }
}

export interface Phrase {
  text: string
  /** Part of the phrase shown as a mono chip (a file or tool name). */
  chip?: string
  tone: 'normal' | 'running' | 'failed'
}

function short(name: string): string {
  return name.replace(/^mcp__/, '').split('__').pop() ?? name
}

/** Comma-joined phrases describing a run of tool calls, e.g. "Ran 2 commands, edited model.py". */
export function summarize(nodes: ToolNode[], lang: Lang): Phrase[] {
  const table = lang === 'zh' ? ZH : EN
  const order: ToolKind[] = []
  const byKind = new Map<ToolKind, ToolNode[]>()
  for (const n of nodes) {
    if (!byKind.has(n.toolKind)) {
      byKind.set(n.toolKind, [])
      order.push(n.toolKind)
    }
    byKind.get(n.toolKind)!.push(n)
  }
  const phrases: Phrase[] = []
  for (const kind of order) {
    const list = byKind.get(kind)!
    const done = list.filter((n) => n.result && !n.result.isError)
    const failed = list.filter((n) => n.result?.isError)
    const running = list.filter((n) => !n.result)
    const v = table[kind]
    if (done.length === 1) {
      const n = done[0]
      const command = String(((n.input ?? {}) as Record<string, unknown>).command ?? '')
      if (kind === 'shell' && n.title && command && !command.startsWith(n.title.replace(/…$/, ''))) {
        // Claude's Bash calls carry a description; it reads better than the command.
        phrases.push({ text: n.title, tone: 'normal' })
        continue
      }
      const chip =
        kind === 'shell' ? n.title : ['read', 'edit', 'write', 'skill', 'mcp'].includes(kind) ? (kind === 'mcp' ? short(n.name) : n.title) : undefined
      phrases.push({ text: chip ? (kind === 'shell' ? (lang === 'zh' ? '运行' : 'ran') : v.one('').trimEnd()) : v.one(n.title), chip, tone: 'normal' })
    } else if (done.length > 1) {
      phrases.push({ text: v.many(done.length), tone: 'normal' })
    }
    if (failed.length) {
      phrases.push({
        text: lang === 'zh' ? `${failed.length} 个失败` : `${failed.length} failed`,
        tone: 'failed'
      })
    }
    if (running.length) {
      const n = running[running.length - 1]
      phrases.push({ text: v.running(kind === 'mcp' ? short(n.name) : n.title) + '…', tone: 'running' })
    }
  }
  if (lang === 'en' && phrases.length && phrases[0].tone === 'normal') {
    phrases[0] = { ...phrases[0], text: phrases[0].text.charAt(0).toUpperCase() + phrases[0].text.slice(1) }
  }
  return phrases
}

/** Present-tense label for the status line while a turn runs. */
export function activityLabel(node: ToolNode | undefined, lang: Lang): string {
  if (!node) return lang === 'zh' ? '正在思考' : 'Thinking'
  const table = lang === 'zh' ? ZH : EN
  return table[node.toolKind].running(node.toolKind === 'mcp' ? short(node.name) : node.title)
}
