import { useEffect, useMemo, type ReactNode } from 'react'
import { MessageSquareText } from 'lucide-react'
import type { ArtifactVersion } from '@shared/types'
import { useT, type MessageKey } from '../../lib/i18n'
import { useStudio } from '../../store'
import { formatSize } from '../Preview'
import { ORIGIN_ICON } from './helpers'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-1 text-[0.857rem]">
      <dt className="text-fg-3">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-fg-2">{children}</dd>
    </div>
  )
}

export function Provenance({ v }: { v: ArtifactVersion }) {
  const t = useT()
  const session = useStudio((s) => s.sessions.find((x) => x.id === v.sessionId))
  const events = useStudio((s) => (v.sessionId ? s.events[v.sessionId] : undefined))
  const loadEvents = useStudio((s) => s.loadEvents)
  const jumpTo = useStudio((s) => s.jumpTo)

  useEffect(() => {
    if (v.sessionId && session && !events) void loadEvents(v.sessionId)
  }, [v.sessionId, session, events, loadEvents])

  const { prompt, call, result, commands } = useMemo(() => {
    const list = events ?? []
    const prompt = list.find((e) => e.kind === 'user.message' && e.seq === v.turnSeq)
    const call = v.callId ? list.find((e) => e.kind === 'tool.call' && e.callId === v.callId) : undefined
    const result = v.callId ? list.find((e) => e.kind === 'tool.result' && e.callId === v.callId) : undefined
    // For turn-level versions, the commands run in that turn are the likely producers.
    const commands: string[] = []
    if (v.origin === 'turn' && v.turnSeq !== undefined) {
      for (const e of list) {
        if (e.seq <= v.turnSeq) continue
        if (e.kind === 'turn.completed') break
        if (e.kind === 'tool.call' && e.toolKind === 'shell') {
          const cmd = (e.input as Record<string, unknown> | undefined)?.command
          if (typeof cmd === 'string') commands.push(cmd)
        }
      }
    }
    return { prompt, call, result, commands }
  }, [events, v])

  const Icon = ORIGIN_ICON[v.origin]
  return (
    <div className="scroll min-h-0 flex-1 px-4 py-3">
      <div className="mb-3 flex items-start gap-2.5 rounded-[10px] bg-surface-2 px-3 py-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${v.origin === 'tool' ? 'text-success' : v.origin === 'turn' ? 'text-result' : 'text-fg-3'}`} />
        <div className="min-w-0">
          <div className="text-[0.929rem] font-medium">{t(`origin.${v.origin}` as MessageKey)}</div>
          <div className="text-[0.857rem] leading-snug text-fg-3">{t(`origin.${v.origin}.desc` as MessageKey)}</div>
        </div>
      </div>
      <dl className="m-0">
        {v.sessionId && (
          <Field label={t('prov.session')}>
            {session ? (
              <button className="text-left text-accent-text hover:underline" onClick={() => void jumpTo(session.id, v.turnSeq)}>
                {session.title || t('session.untitled')}
              </button>
            ) : (
              t('prov.unknownSession')
            )}
          </Field>
        )}
        {prompt?.kind === 'user.message' && (
          <Field label={t('prov.turn')}>
            <span className="line-clamp-3 whitespace-pre-wrap">{prompt.text}</span>
          </Field>
        )}
        {call?.kind === 'tool.call' && (
          <Field label={t('prov.call')}>
            <span className="chip">{call.name}</span> {call.title}
          </Field>
        )}
        {result?.kind === 'tool.result' && (
          <Field label={t('prov.status')}>
            <span className={result.isError ? 'text-danger-text' : 'text-success'}>{t(result.isError ? 'prov.failed' : 'prov.ok')}</span>
          </Field>
        )}
        {v.restoredFrom !== undefined && <Field label={t('prov.restoredFrom')}>v{v.restoredFrom}</Field>}
        <Field label={t('prov.created')}>{new Date(v.createdAt).toLocaleString()}</Field>
        <Field label={t('prov.size')}>{formatSize(v.size)}</Field>
        <Field label={t('prov.checksum')}>
          <span className="font-mono text-[0.786rem]">{v.sha256.slice(0, 16)}…</span>
        </Field>
        {!v.stored && <Field label="">{t('artifacts.notStored')}</Field>}
      </dl>
      {commands.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[0.786rem] text-fg-3">{t('prov.commands')}</div>
          <pre className="selectable scroll m-0 max-h-48 rounded-[8px] bg-[var(--code-bg)] px-2.5 py-2 font-mono text-[0.786rem] leading-[1.5] whitespace-pre-wrap text-fg-2">
            {commands.slice(-6).join('\n')}
          </pre>
        </div>
      )}
      {result?.kind === 'tool.result' && result.output.trim() && (
        <div className="mt-3">
          <div className="mb-1 text-[0.786rem] text-fg-3">{t('prov.output')}</div>
          <pre className="selectable scroll m-0 max-h-48 rounded-[8px] bg-[var(--code-bg)] px-2.5 py-2 font-mono text-[0.786rem] leading-[1.5] whitespace-pre-wrap text-fg-2">
            {result.output.slice(0, 4000)}
          </pre>
        </div>
      )}
      {v.sessionId && session && (
        <button className="btn btn-secondary btn-sm mt-4" onClick={() => void jumpTo(session.id, v.turnSeq)}>
          <MessageSquareText size={13} /> {t('prov.jump')}
        </button>
      )}
    </div>
  )
}
