import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  FileText,
  FolderOpen,
  Hand,
  ListOrdered,
  Paperclip,
  Pencil,
  PencilLine,
  Plus,
  ShieldCheck,
  Telescope,
  X,
  Zap
} from 'lucide-react'
import type { Attachment, PermissionMode, QueuedMessage, SessionEvent, TodoItem } from '@shared/types'
import { PERMISSION_MODES } from '@shared/ipc'
import { api, isMac, mod } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { buildTranscript, formatTokens, type PermissionItem } from '../lib/transcript'
import { useStudio } from '../store'
import { ModelPicker } from './ModelPicker'
import { Menu, MenuItem, MenuLabel, Spinner, Tip } from './ui'

const EMPTY: SessionEvent[] = []

const MODE_ICON: Record<PermissionMode, typeof Hand> = {
  ask: Hand,
  acceptEdits: PencilLine,
  plan: Telescope,
  bypass: Zap
}

/** Last insertion handled, so a composer that mounts later does not repeat it. */
let handledInsert = 0

export interface ComposerHandle {
  focus(): void
  setText(text: string): void
}

export function ModePicker({ pill }: { pill?: boolean }) {
  const t = useT()
  const draft = useStudio((s) => s.draft)
  const setDraft = useStudio((s) => s.setDraft)
  const agent = useStudio((s) => s.agents.find((a) => a.id === s.draft.agent))
  const Icon = MODE_ICON[draft.permissionMode]
  const bypass = draft.permissionMode === 'bypass'
  return (
    <Menu
      side="top"
      width={300}
      trigger={
        <button
          className={`flex items-center gap-1.5 transition-colors ${bypass ? 'text-warning-text' : 'text-fg-3 hover:text-fg'} ${
            pill ? 'h-7 rounded-full bg-surface-2 px-2.5 text-[0.857rem] hover:bg-surface-3' : 'h-6 rounded-[6px] px-1.5 text-[0.857rem] hover:bg-surface-2'
          }`}
        >
          <Icon size={13} />
          <span>{t(`mode.${draft.permissionMode}` as MessageKey)}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      <MenuLabel>{t('composer.mode')}</MenuLabel>
      {PERMISSION_MODES.map((m) => {
        const MIcon = MODE_ICON[m]
        return (
          <MenuItem key={m} icon={<MIcon size={14} />} onSelect={() => setDraft({ permissionMode: m })} right={m === draft.permissionMode ? <Check size={14} className="text-accent" /> : null}>
            <div className={m === 'bypass' ? 'text-warning-text' : ''}>{t(`mode.${m}` as MessageKey)}</div>
            <div className="text-[0.786rem] leading-snug text-fg-3">{t(`mode.${m}.desc` as MessageKey)}</div>
          </MenuItem>
        )
      })}
      {agent && !agent.supportsApproval && <div className="px-2 pt-2 pb-1.5 text-[0.786rem] leading-snug text-fg-3">{t('mode.noApproval', { agent: agent.name })}</div>}
    </Menu>
  )
}

function verbFor(perm: PermissionItem, lang: 'zh' | 'en'): string {
  const n = perm.toolName.toLowerCase()
  const zh = lang === 'zh'
  if (/bash|shell|command/.test(n)) return zh ? '运行' : 'run'
  if (/write/.test(n)) return zh ? '写入' : 'write'
  if (/edit|patch/.test(n)) return zh ? '修改' : 'edit'
  if (/web|fetch/.test(n)) return zh ? '访问' : 'fetch'
  if (/read/.test(n)) return zh ? '读取' : 'read'
  return zh ? '使用' : 'use'
}

/** Approval card docked above the composer. Esc denies, ⌘↵ allows once. */
function ApprovalCard({ perm, more }: { perm: PermissionItem; more: number }) {
  const t = useT()
  const lang = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
  const respond = useStudio((s) => s.respond)
  const agentName = useStudio((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    return s.agents.find((a) => a.id === session?.agent)?.name ?? 'Agent'
  })
  const input = (perm.input ?? {}) as Record<string, unknown>
  const detail =
    typeof input.command === 'string'
      ? input.command
      : typeof input.file_path === 'string'
        ? [input.file_path, typeof input.content === 'string' ? `\n${input.content.slice(0, 2000)}` : '', typeof input.new_string === 'string' ? `\n${input.new_string.slice(0, 2000)}` : ''].join('')
        : JSON.stringify(perm.input, null, 2)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        respond(perm.requestId, false)
      } else if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault()
        respond(perm.requestId, true, e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [perm.requestId, respond])

  return (
    <div className="relative">
      {more > 0 && <div className="absolute inset-x-3 -top-1.5 h-4 rounded-t-[12px] bg-surface shadow-[0_0_0_1px_var(--border)]" />}
      <div className="card promote relative flex max-h-[60vh] flex-col gap-3 p-3">
        <div className="text-[1rem] leading-snug">
          {t('perm.question', { agent: agentName, verb: verbFor(perm, lang) })} <span className="chip align-middle text-[0.857rem]">{perm.title || perm.toolName}</span>
          {lang === 'zh' ? '？' : '?'}
        </div>
        <pre className="selectable scroll m-0 max-h-48 rounded-[8px] bg-[var(--code-bg)] px-2.5 py-2 font-mono text-[0.786rem] leading-[1.5] whitespace-pre-wrap text-fg-2">{detail}</pre>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[0.786rem] text-fg-3">{perm.toolName}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => respond(perm.requestId, false)}>
            {t('perm.deny')} <span className="kbd">Esc</span>
          </button>
          <div className="flex">
            <button className="btn btn-primary btn-sm rounded-r-none" autoFocus onClick={() => respond(perm.requestId, true)}>
              {t('perm.allowOnce')} <span className="text-[0.786rem] opacity-60">{mod}↵</span>
            </button>
            <Menu
              side="top"
              align="end"
              trigger={
                <button className="btn btn-primary btn-sm rounded-l-none border-l border-white/20 px-1.5" aria-label={t('common.more')}>
                  <ChevronDown size={13} />
                </button>
              }
            >
              <MenuItem onSelect={() => respond(perm.requestId, true, true)} right={<span className="text-[0.786rem] text-fg-3">{mod}⇧↵</span>}>
                {t('perm.always')}
              </MenuItem>
            </Menu>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskCard({ todos }: { todos: TodoItem[] }) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const done = todos.filter((x) => x.status === 'completed').length
  const active = todos.find((x) => x.status === 'in_progress')
  return (
    <div className="card px-3 py-2">
      <button className="flex w-full items-center gap-2 text-left text-[0.929rem]" onClick={() => setCollapsed((c) => !c)}>
        <span className="font-medium">{t('plan.title')}</span>
        <span className="text-fg-3 tabular-nums">
          {done}/{todos.length}
        </span>
        {collapsed && active && <span className="min-w-0 flex-1 truncate text-fg-3">· {active.content}</span>}
        <span className="flex-1" />
        {collapsed ? <ChevronUp size={14} className="text-fg-3" /> : <ChevronDown size={14} className="text-fg-3" />}
      </button>
      {!collapsed && (
        <ul className="scroll mt-1.5 flex max-h-56 flex-col gap-0.5">
          {todos.map((item, i) => (
            <li key={i} className="flex items-start gap-2 py-0.5 text-[0.929rem] leading-[1.43]">
              <span className="mt-[2px] grid h-4 w-4 shrink-0 place-items-center">
                {item.status === 'completed' ? (
                  <CircleCheck size={15} className="text-fg-3" />
                ) : item.status === 'in_progress' ? (
                  <Spinner size={13} />
                ) : (
                  <span className="h-[13px] w-[13px] rounded-full border-[1.5px] border-dashed border-fg-4" />
                )}
              </span>
              <span className={item.status === 'completed' ? 'text-fg-3' : item.status === 'in_progress' ? 'text-fg' : 'text-fg-2'}>{item.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Messages sent while the agent was busy; each starts the next turn in order. */
function QueueCard({ sessionId, queue, running, onEdit }: { sessionId: string; queue: QueuedMessage[]; running: boolean; onEdit: (q: QueuedMessage) => void }) {
  const t = useT()
  const send = useStudio((s) => s.send)
  const remove = (id: string): Promise<unknown> => api.call('sessions:dequeue', sessionId, id)
  const sendNext = async (): Promise<void> => {
    const next = queue[0]
    await remove(next.id)
    await send(next.text, next.attachments)
  }
  return (
    <div className="card px-3 py-2">
      <div className="flex h-6 items-center gap-2 text-[0.857rem] text-fg-3">
        <ListOrdered size={13} />
        <span>{t('queue.title', { n: queue.length })}</span>
        {!running && <span className="truncate">· {t('queue.paused')}</span>}
        <span className="flex-1" />
        {!running && (
          <button className="btn btn-secondary btn-sm h-6" onClick={() => void sendNext()}>
            {t('queue.sendNext')}
          </button>
        )}
      </div>
      <ul className="scroll mt-1 flex max-h-40 flex-col">
        {queue.map((q, i) => (
          <li key={q.id} className="group flex h-7 items-center gap-2 text-[0.929rem]">
            <span className="w-4 shrink-0 text-center text-[0.786rem] text-fg-4 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-fg-2">{q.text}</span>
            {q.attachments.length > 0 && <Paperclip size={12} className="shrink-0 text-fg-3" />}
            <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <Tip label={t('queue.edit')}>
                <button
                  className="icon-btn-sm"
                  aria-label={t('queue.edit')}
                  onClick={async () => {
                    await remove(q.id)
                    onEdit(q)
                  }}
                >
                  <Pencil size={12} />
                </button>
              </Tip>
              <Tip label={t('common.remove')}>
                <button className="icon-btn-sm" aria-label={t('common.remove')} onClick={() => void remove(q.id)}>
                  <X size={12} />
                </button>
              </Tip>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Approval, task and queue cards stacked above the composer for the active session. */
function Dock({ onEdit }: { onEdit: (q: QueuedMessage) => void }) {
  const sessionId = useStudio((s) => s.activeSessionId)
  const queue = useStudio((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.queue)
  const events = useStudio((s) => (sessionId ? s.events[sessionId] ?? EMPTY : EMPTY))
  const running = useStudio((s) => {
    const st = s.sessions.find((x) => x.id === sessionId)?.status
    return st === 'running' || st === 'waiting'
  })
  const { todos, pending } = useMemo(() => buildTranscript(events), [events])
  const showTodos = todos.length > 0 && (running || todos.some((x) => x.status !== 'completed'))
  if (!pending.length && !showTodos && !queue?.length) return null
  return (
    <div className="mb-2 flex flex-col gap-2">
      {showTodos && <TaskCard todos={todos} />}
      {sessionId && queue && queue.length > 0 && <QueueCard sessionId={sessionId} queue={queue} running={running} onEdit={onEdit} />}
      {pending.length > 0 && <ApprovalCard key={pending[0].requestId} perm={pending[0]} more={pending.length - 1} />}
    </div>
  )
}

function UsageHint() {
  const session = useStudio((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  if (!session) return null
  const tokens = session.usage.inputTokens + session.usage.outputTokens + session.usage.cacheReadTokens
  if (!tokens) return null
  return (
    <Tip label={session.usage.costUsd ? `$${session.usage.costUsd.toFixed(3)}` : `${tokens} tokens`} side="top">
      <span className="text-[0.786rem] text-fg-4 tabular-nums">{formatTokens(tokens)}</span>
    </Tip>
  )
}

export const Composer = forwardRef<ComposerHandle, { disabled?: boolean; home?: boolean }>(function Composer({ disabled, home }, ref) {
  const t = useT()
  const send = useStudio((s) => s.send)
  const interrupt = useStudio((s) => s.interrupt)
  const settings = useStudio((s) => s.settings)
  const running = useStudio((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    return session?.status === 'running' || session?.status === 'waiting'
  })
  const hasSession = useStudio((s) => Boolean(s.activeSessionId))
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (v) => {
      setText(v)
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(v.length, v.length)
      })
    }
  }))

  // Citations and other snippets from the side panels land at the end of the draft.
  const insert = useStudio((s) => s.composerInsert)
  useEffect(() => {
    if (!insert || insert.n <= handledInsert) return
    handledInsert = insert.n
    setText((v) => (v && !/\s$/.test(v) ? `${v}\n${insert.text}` : v + insert.text))
    requestAnimationFrame(() => {
      const el = area.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }, [insert])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }, [text])

  // While a turn runs, sending adds the message to the session's queue.
  const canSend = !disabled && (text.trim().length > 0 || files.length > 0)

  const submit = (): void => {
    if (!canSend) return
    void send(text.trim() || '(see attached files)', files)
    setText('')
    setFiles([])
  }

  const addPaths = (paths: string[]): void => {
    setFiles((prev) => [
      ...prev,
      ...paths.filter((p) => !prev.some((f) => f.path === p)).map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }))
    ])
  }

  const sendWithEnter = settings?.sendWithEnter ?? true

  const attachMenu = (
          <Menu
            side="top"
            trigger={
              <button className="icon-btn shrink-0" disabled={disabled} aria-label={t('composer.attach')}>
                <Plus size={17} />
              </button>
            }
          >
            <MenuItem icon={<FileText size={14} />} onSelect={async () => addPaths(await api.call('dialog:pickFiles'))}>
              {t('composer.attachFiles')}
            </MenuItem>
            {hasSession && (
              <MenuItem icon={<ShieldCheck size={14} />} disabled={running} onSelect={() => void useStudio.getState().startReview()}>
                {t('review.start')}
              </MenuItem>
            )}
            <MenuItem
              icon={<FolderOpen size={14} />}
              onSelect={() => {
                const st = useStudio.getState()
                const project = st.projects.find((p) => p.id === st.activeProjectId)
                if (project) void api.call('shell:openPath', project.path)
              }}
            >
              {t('project.reveal')}
            </MenuItem>
          </Menu>
  )
  const textarea = (
          <textarea
            ref={area}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              const modKey = isMac ? e.metaKey : e.ctrlKey
              if ((sendWithEnter && !e.shiftKey && !modKey) || (!sendWithEnter && modKey)) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={disabled ? t('composer.placeholderNoProject') : running ? t('composer.placeholderRunning') : home ? t('composer.placeholderNew') : t('composer.placeholder')}
            className={`block max-h-[300px] w-full resize-none self-center bg-transparent focus-visible:shadow-none px-1 py-[5px] text-[1rem] leading-[1.43] text-fg outline-none placeholder:text-fg-3 ${home ? 'min-h-[48px] px-2' : 'min-h-[28px]'}`}
          />
  )
  const sendButton = running && !canSend ? (
            <Tip label={`${t('composer.stop')}  Esc`} side="top">
              <button className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-ink-fg transition-transform active:scale-95" onClick={interrupt} aria-label={t('composer.stop')}>
                <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              </button>
            </Tip>
          ) : (
            <button
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-ink-fg transition-all enabled:hover:opacity-85 enabled:active:scale-95 disabled:bg-surface-3 disabled:text-fg-3"
              disabled={!canSend}
              onClick={submit}
              aria-label={t(running ? 'queue.add' : 'composer.send')}
              title={running ? t('queue.add') : undefined}
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )

  return (
    <div>
      {!home && (
        <Dock
          onEdit={(q) => {
            setText(q.text)
            setFiles(q.attachments)
            requestAnimationFrame(() => area.current?.focus())
          }}
        />
      )}
      <div
        className={`relative rounded-[var(--radius-composer)] bg-composer transition-shadow ${
          dragging ? 'shadow-[0_0_0_2px_var(--accent),var(--composer-shadow)]' : 'shadow-[var(--composer-shadow)]'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean))
        }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {files.map((f) => (
              <span key={f.path} className="flex h-7 items-center gap-1.5 rounded-[8px] bg-surface-2 pr-1 pl-2 text-[0.857rem]">
                <FileText size={13} className="text-fg-3" />
                <span className="max-w-[200px] truncate">{f.name}</span>
                <button className="icon-btn-sm" onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))} aria-label={t('common.remove')}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={home ? 'flex flex-col gap-1 p-2 pt-3' : 'flex items-end gap-1 p-2'}>
          {home && textarea}
          <div className={home ? 'flex items-center justify-between' : 'contents'}>
            {attachMenu}
            {!home && textarea}
            {sendButton}
          </div>
        </div>
      </div>
      {!home && (
        <div className="mt-1.5 flex h-6 items-center gap-1 px-2">
          <ModePicker />
          <span className="flex-1" />
          <ModelPicker />
          <UsageHint />
        </div>
      )}
    </div>
  )
})
