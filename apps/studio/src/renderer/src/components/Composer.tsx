import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, FileText, FolderOpen, Hand, PencilLine, Plus, ShieldCheck, Telescope, X, Zap } from 'lucide-react'
import type { Attachment, PermissionMode } from '@shared/types'
import { PERMISSION_MODES } from '@shared/ipc'
import { api, isMac } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { openPath } from '../lib/open'
import { formatTokens } from '../lib/transcript'
import { activeDraftKey, useStudio } from '../store'
import { Dock } from './composer/Dock'
import { ModelPicker } from './ModelPicker'
import { Menu, MenuItem, MenuLabel, Tip } from './ui'

const EMPTY_FILES: Attachment[] = []

const MODE_ICON: Record<PermissionMode, typeof Hand> = {
  ask: Hand,
  acceptEdits: PencilLine,
  plan: Telescope,
  bypass: Zap
}

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
  const activeProjectId = useStudio((s) => s.activeProjectId)
  const activeSessionId = useStudio((s) => s.activeSessionId)
  const setComposerDraft = useStudio((s) => s.setComposerDraft)
  const clearComposerDraft = useStudio((s) => s.clearComposerDraft)
  const running = useStudio((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    return session?.status === 'running' || session?.status === 'waiting'
  })

  const draftKey = activeDraftKey(activeProjectId, activeSessionId)
  const draft = useStudio((s) => (draftKey ? s.composerDrafts[draftKey] : undefined))
  const text = draft?.text ?? ''
  const files = draft?.attachments ?? EMPTY_FILES

  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const handledInsert = useRef(useStudio.getState().composerInsert?.n ?? 0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (v) => {
      if (!draftKey) return
      setComposerDraft(draftKey, { text: v })
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(v.length, v.length)
      })
    }
  }))

  // Store already appended inserted text to the active draft; focus and place caret at end.
  const insert = useStudio((s) => s.composerInsert)
  useEffect(() => {
    if (!insert || insert.n <= handledInsert.current) return
    handledInsert.current = insert.n
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [insert])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }, [text])

  const isSending = sendingKey !== null && sendingKey === draftKey
  // While a turn runs, sending adds the message to the session's queue.
  const canSend = !disabled && !isSending && Boolean(draftKey) && (text.trim().length > 0 || files.length > 0)

  const submit = async (): Promise<void> => {
    if (!canSend || !draftKey) return
    const targetKey = draftKey
    const submitted = { text, attachments: files }
    setSendingKey(targetKey)
    try {
      const ok = await send(text.trim() || '(see attached files)', files)
      if (ok) clearComposerDraft(targetKey, submitted)
    } finally {
      if (alive.current) setSendingKey((cur) => (cur === targetKey ? null : cur))
    }
  }

  const addPaths = (paths: string[]): void => {
    if (!draftKey || !paths.length) return
    const current = useStudio.getState().composerDrafts[draftKey]?.attachments ?? EMPTY_FILES
    const added = paths
      .filter((p) => !current.some((f) => f.path === p))
      .map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }))
    if (added.length) setComposerDraft(draftKey, { attachments: [...current, ...added] })
  }

  const sendWithEnter = settings?.sendWithEnter ?? true
  const hasSession = Boolean(activeSessionId)

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
          if (project) openPath(project.path)
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
      onChange={(e) => {
        if (draftKey) setComposerDraft(draftKey, { text: e.target.value })
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        const modKey = isMac ? e.metaKey : e.ctrlKey
        if ((sendWithEnter && !e.shiftKey && !modKey) || (!sendWithEnter && modKey)) {
          e.preventDefault()
          void submit()
        }
      }}
      placeholder={disabled ? t('composer.placeholderNoProject') : running ? t('composer.placeholderRunning') : home ? t('composer.placeholderNew') : t('composer.placeholder')}
      className={`block max-h-[300px] w-full resize-none self-center bg-transparent focus-visible:shadow-none px-1 py-[5px] text-[1rem] leading-[1.43] text-fg outline-none placeholder:text-fg-3 ${home ? 'min-h-[48px] px-2' : 'min-h-[28px]'}`}
    />
  )

  const sendButton =
    running && !canSend ? (
      <Tip label={`${t('composer.stop')}  Esc`} side="top">
        <button className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-ink-fg transition-transform active:scale-95" onClick={interrupt} aria-label={t('composer.stop')}>
          <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
        </button>
      </Tip>
    ) : (
      <button
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-ink-fg transition-all enabled:hover:opacity-85 enabled:active:scale-95 disabled:bg-surface-3 disabled:text-fg-3"
        disabled={!canSend}
        onClick={() => void submit()}
        aria-label={t(running ? 'queue.add' : 'composer.send')}
        title={running ? t('queue.add') : undefined}
      >
        <ArrowUp size={16} strokeWidth={2.4} />
      </button>
    )

  return (
    <div>
      {!home && <Dock onFocusedEdit={() => requestAnimationFrame(() => area.current?.focus())} />}
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
                <button
                  className="icon-btn-sm"
                  onClick={() => {
                    if (draftKey) setComposerDraft(draftKey, { attachments: files.filter((y) => y.path !== f.path) })
                  }}
                  aria-label={t('common.remove')}
                >
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
