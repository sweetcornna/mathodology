import { memo, useState } from 'react'
import { ChevronRight, CircleAlert, Info, MessageCircleQuestion, Paperclip, ShieldCheck, ShieldX } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { formatTokens, type Item } from '../../lib/transcript'
import { useStudio } from '../../store'
import { GeneratedRow } from '../Artifacts'
import { CopyButton } from '../CopyButton'
import { Markdown } from '../Markdown'
import { ChangesCard, ToolGroup } from './ToolItems'

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function UserMessage({ text, attachments }: { text: string; attachments: string[] }) {
  const openPreview = useStudio((s) => s.openPreview)
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 900 || text.split('\n').length > 16
  return (
    <div className="group flex flex-col items-end gap-1.5 bubble-in">
      {attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {attachments.map((a) => (
            <button
              key={a}
              onClick={() => openPreview(a)}
              className="flex h-7 items-center gap-1.5 rounded-[8px] bg-surface-2 px-2.5 text-[0.857rem] text-fg-2 hover:bg-surface-3"
            >
              <Paperclip size={12} />
              {a.split(/[\\/]/).pop()}
            </button>
          ))}
        </div>
      )}
      <div
        className={`selectable relative max-w-[85%] rounded-[12px] bg-surface-2 px-4 py-2.5 text-[1rem] leading-[1.43] whitespace-pre-wrap ${
          long && !expanded ? 'max-h-[min(40vh,24rem)] overflow-hidden' : ''
        }`}
      >
        {text}
        {long && !expanded && (
          <button
            className="absolute inset-x-0 bottom-0 h-12 rounded-b-[12px] bg-gradient-to-t from-[var(--bg)] to-transparent"
            onClick={() => setExpanded(true)}
            aria-label={t('common.expand')}
          />
        )}
      </div>
      <div className="opacity-0 transition-opacity delay-100 group-hover:opacity-100">
        <CopyButton text={text} label={t('transcript.copy')} />
      </div>
    </div>
  )
}

export function Thinking({ text, live }: { text: string; live?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="text-fg-3">
      <button className="flex items-center gap-1 text-[1rem] hover:text-fg-2" onClick={() => setOpen((o) => !o)}>
        <span className={live ? 'shimmer-text' : ''}>{t(live ? 'transcript.thinking' : 'transcript.thoughtFor')}</span>
        <ChevronRight size={14} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="selectable mt-1.5 border-l-2 border-line pl-3 text-[0.929rem] leading-relaxed whitespace-pre-wrap italic">{text}</div>
      )}
    </div>
  )
}

function ResolvedPermission({ item }: { item: Extract<Item, { type: 'permission' }> }) {
  const t = useT()
  if (!item.perm.resolved) return null
  const allow = item.perm.resolved.allow
  const questions = item.perm.questions
  if (questions?.length) {
    const answers = item.perm.resolved.answers ?? {}
    return (
      <div className="flex flex-col gap-0.5 text-[0.929rem] text-fg-3">
        {questions.map((q, i) => (
          <div key={q.id} className="flex items-start gap-1.5">
            <MessageCircleQuestion size={14} className={`mt-[3px] shrink-0 ${i ? 'invisible' : ''}`} />
            <span className="selectable min-w-0">
              {q.question}
              {' · '}
              {answers[q.id]?.length ? (
                <span className="text-fg-2">{q.secret ? '••••' : answers[q.id].join(', ')}</span>
              ) : (
                Object.keys(answers).length ? '—' : t('ask.skipped')
              )}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-[0.929rem] text-fg-3">
      {allow ? <ShieldCheck size={14} className="text-success" /> : <ShieldX size={14} className="text-danger" />}
      <span className="truncate">
        {t(allow ? (item.perm.resolved.always ? 'perm.alwaysAllowed' : 'perm.allowed') : 'perm.denied')} · {item.perm.toolName}
        {item.perm.title ? ` · ${item.perm.title}` : ''}
      </span>
    </div>
  )
}

function Notice({ level, text, code, vars }: Pick<Extract<Item, { type: 'notice' }>, 'level' | 'text' | 'code' | 'vars'>) {
  const t = useT()
  if (code) {
    const v = { ...vars }
    text = t(`notice.${code}`, v)
    if (code === 'agentExited' && v.tail) text += `:\n${v.tail}`
  }
  const tone =
    level === 'error' ? 'bg-danger-soft text-danger-text' : level === 'warning' ? 'bg-warning-soft text-warning-text' : 'bg-surface-2 text-fg-2'
  const Icon = level === 'info' ? Info : CircleAlert
  return (
    <div className={`flex items-start gap-2 rounded-[10px] px-3 py-2.5 ${tone}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="selectable min-w-0 text-[0.929rem] leading-snug whitespace-pre-wrap">{text}</div>
    </div>
  )
}

function TurnFooter({ item }: { item: Extract<Item, { type: 'turn' }> }) {
  const t = useT()
  const parts: string[] = []
  if (item.summary === 'interrupted') parts.push(t('transcript.interrupted'))
  else if (!item.ok) parts.push(t('transcript.turnFailed'))
  if (item.durationMs) parts.push(t('transcript.took', { t: formatDuration(item.durationMs) }))
  const tokens = (item.usage?.inputTokens ?? 0) + (item.usage?.outputTokens ?? 0) + (item.usage?.cacheReadTokens ?? 0)
  if (tokens) parts.push(`${formatTokens(tokens)} tokens`)
  if (item.usage?.costUsd) parts.push(`$${item.usage.costUsd.toFixed(item.usage.costUsd < 0.1 ? 3 : 2)}`)
  if (!parts.length) return null
  return <div className="text-[0.857rem] text-fg-4 tabular-nums">{parts.join(' · ')}</div>
}

const TextMessage = memo(function TextMessage({ text }: { text: string }) {
  const t = useT()
  return (
    <div className="group relative">
      <Markdown text={text} />
      <div className="mt-1 h-[22px] opacity-0 transition-opacity delay-100 group-hover:opacity-100">
        <CopyButton text={text} label={t('transcript.copy')} />
      </div>
    </div>
  )
})

export const ItemView = memo(function ItemView({ item }: { item: Item }) {
  switch (item.type) {
    case 'user':
      return <UserMessage text={item.text} attachments={item.attachments} />
    case 'text':
      return <TextMessage text={item.text} />
    case 'thinking':
      return <Thinking text={item.text} />
    case 'tools':
      return <ToolGroup tools={item.tools} />
    case 'permission':
      return <ResolvedPermission item={item} />
    case 'notice':
      return <Notice level={item.level} text={item.text} code={item.code} vars={item.vars} />
    case 'changes':
      return <ChangesCard files={item.files} />
    case 'generated':
      return <GeneratedRow files={item.files} />
    case 'turn':
      return <TurnFooter item={item} />
  }
})
