import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, MessageCircleQuestion } from 'lucide-react'
import { isMac, mod } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { PermissionItem } from '../../lib/transcript'
import { useStudio } from '../../store'
import { Menu, MenuItem } from '../ui'

function useCardHotkeys(requestId: string, onDeny: () => void, onConfirm: (shiftKey: boolean) => void): void {
  const denyRef = useRef(onDeny)
  const confirmRef = useRef(onConfirm)
  denyRef.current = onDeny
  confirmRef.current = onConfirm

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        denyRef.current()
      } else if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault()
        confirmRef.current(e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [requestId])
}

function useActiveAgentName(): string {
  return useStudio((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    return s.agents.find((a) => a.id === session?.agent)?.name ?? 'Agent'
  })
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
export function ApprovalCard({ perm, more }: { perm: PermissionItem; more: number }) {
  const t = useT()
  const lang = useStudio((s) => (s.settings?.locale === 'en' ? 'en' : 'zh'))
  const respond = useStudio((s) => s.respond)
  const agentName = useActiveAgentName()
  const input = (perm.input ?? {}) as Record<string, unknown>
  const detail =
    typeof input.command === 'string'
      ? input.command
      : typeof input.file_path === 'string'
        ? [input.file_path, typeof input.content === 'string' ? `\n${input.content.slice(0, 2000)}` : '', typeof input.new_string === 'string' ? `\n${input.new_string.slice(0, 2000)}` : ''].join('')
        : JSON.stringify(perm.input, null, 2)

  useCardHotkeys(
    perm.requestId,
    () => respond(perm.requestId, false),
    (shift) => respond(perm.requestId, true, shift)
  )

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

/** A question the agent asks, docked above the composer. Esc skips, ⌘↵ submits. */
export function QuestionCard({ perm, more }: { perm: PermissionItem; more: number }) {
  const t = useT()
  const respond = useStudio((s) => s.respond)
  const agentName = useActiveAgentName()
  const questions = perm.questions ?? []
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const answers = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const q of questions) {
      const list = [...(picked[q.id] ?? []), ...(other[q.id]?.trim() ? [other[q.id].trim()] : [])]
      if (list.length) out[q.id] = list
    }
    return out
  }, [questions, picked, other])
  const ready = Object.keys(answers).length > 0
  const submit = (): void => {
    if (ready) respond(perm.requestId, true, false, answers)
  }

  useCardHotkeys(
    perm.requestId,
    () => respond(perm.requestId, false),
    () => submit()
  )

  const toggle = (id: string, label: string, multi: boolean): void => {
    setPicked((cur) => {
      const list = cur[id] ?? []
      const on = list.includes(label)
      return { ...cur, [id]: multi ? (on ? list.filter((x) => x !== label) : [...list, label]) : on ? [] : [label] }
    })
    // A single choice replaces a typed answer.
    if (!multi) setOther((cur) => ({ ...cur, [id]: '' }))
  }

  return (
    <div className="relative">
      {more > 0 && <div className="absolute inset-x-3 -top-1.5 h-4 rounded-t-[12px] bg-surface shadow-[0_0_0_1px_var(--border)]" />}
      <div className="card promote relative flex max-h-[60vh] flex-col gap-3 p-3">
        <div className="flex items-center gap-1.5 text-[0.857rem] text-fg-3">
          <MessageCircleQuestion size={14} />
          {t('ask.title', { agent: agentName })}
        </div>
        <div className="scroll flex flex-col gap-4">
          {questions.map((q) => (
            <fieldset key={q.id} className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1.5 text-[1rem] leading-snug">
                {q.header && <span className="chip mr-1.5 align-middle text-[0.786rem]">{q.header}</span>}
                <span className="selectable">{q.question}</span>
                {q.multiSelect && <span className="ml-1.5 text-[0.786rem] text-fg-3">{t('ask.multi')}</span>}
              </legend>
              {q.options.map((o) => {
                const on = (picked[q.id] ?? []).includes(o.label)
                return (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(q.id, o.label, Boolean(q.multiSelect))}
                    className={`flex items-start gap-2 rounded-[8px] border px-2.5 py-1.5 text-left ${on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}
                  >
                    <span className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${q.multiSelect ? 'rounded-[3px]' : 'rounded-full'} ${on ? 'border-accent bg-accent text-accent-fg' : 'border-fg-3'}`}>
                      {on && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[0.929rem]">{o.label}</span>
                      {o.description && <span className="text-[0.786rem] leading-snug text-fg-3">{o.description}</span>}
                    </span>
                  </button>
                )
              })}
              {(q.allowOther || q.options.length === 0) && (
                <input
                  className="field h-8 text-[0.929rem]"
                  type={q.secret ? 'password' : 'text'}
                  autoFocus={questions[0] === q && q.options.length === 0}
                  placeholder={q.options.length ? t('ask.other') : t('ask.typeAnswer')}
                  value={other[q.id] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setOther((cur) => ({ ...cur, [q.id]: v }))
                    if (v && !q.multiSelect) setPicked((cur) => ({ ...cur, [q.id]: [] }))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !(isMac ? e.metaKey : e.ctrlKey)) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                />
              )}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn btn-ghost btn-sm mr-auto" onClick={() => respond(perm.requestId, false)}>
            {t('ask.skip')} <span className="kbd">Esc</span>
          </button>
          <button className="btn btn-primary btn-sm" disabled={!ready} onClick={submit}>
            {t('ask.submit')} <span className="text-[0.786rem] opacity-60">{mod}↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}
