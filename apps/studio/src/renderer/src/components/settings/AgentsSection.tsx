import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { AgentId, AgentSettings } from '@shared/types'
import { agentSpec } from '@shared/agents'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useStudio } from '../../store'
import { AgentGlyph } from '../BrandIcon'
import { Spinner } from '../ui'

const BLANK: AgentSettings = { binaryPath: '', defaultModel: '', extraArgs: '', env: '' }

function AgentCard({ id }: { id: AgentId }) {
  const t = useT()
  const info = useStudio((x) => x.agents.find((a) => a.id === id))
  const successor = useStudio((x) => x.agents.find((a) => a.id === info?.supersededBy))
  const savedAgent = useStudio((x) => x.settings?.agents[id])
  const updateAgentSettings = useStudio((x) => x.updateAgentSettings)
  const install = agentSpec(id)?.install
  const [local, setLocal] = useState<AgentSettings>({ ...BLANK, ...savedAgent })

  useEffect(() => {
    setLocal({ ...BLANK, ...savedAgent })
  }, [savedAgent, id])

  const commit = (patch: Partial<AgentSettings>): void => {
    const next = { ...local, ...patch }
    setLocal(next)
    void updateAgentSettings(id, next)
  }

  if (!info) return null
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <AgentGlyph agent={id} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[0.98rem] font-semibold">
            {info.name}
            <span
              className={`rounded-full px-2 py-0.5 text-[0.72rem] font-medium ${
                info.available ? 'bg-success-soft text-success' : 'bg-surface-3 text-fg-3'
              }`}
            >
              {info.available ? t('settings.detected', { version: info.version ?? '' }) : t('settings.notFound')}
            </span>
            {info.supersededBy && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[0.72rem] font-medium text-fg-3">{t('settings.legacy')}</span>}
          </div>
          <div className="truncate font-mono text-[0.76rem] text-fg-3">{info.path ?? install?.cmd ?? install?.url}</div>
          {info.available && (
            <div className="mt-0.5 truncate text-[0.76rem] text-fg-3">
              {[info.account?.plan, info.account?.email, t('settings.modelCount', { n: Math.max(0, info.models.length - 1) })].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-[0.76rem] text-fg-3">
          <span>{info.supportsApproval ? t('settings.approval') : t('settings.noApproval')}</span>
          <span className="font-mono text-[0.72rem]">{t('settings.route', { route: info.route })}</span>
        </div>
      </div>
      {successor && <p className="mt-3 text-[0.82rem] text-fg-3">{t('settings.superseded', { agent: successor.name })}</p>}
      <div className="mt-4 grid grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2.5 text-[0.86rem]">
        <span className="text-fg-2">{t('settings.binaryPath')}</span>
        <input
          className="field h-8 font-mono text-[0.8rem]"
          placeholder={t('settings.binaryPathPlaceholder')}
          value={local.binaryPath}
          onChange={(e) => setLocal({ ...local, binaryPath: e.target.value })}
          onBlur={() => commit({})}
        />
        <span className="text-fg-2">{t('settings.defaultModel')}</span>
        <select className="field h-8" value={local.defaultModel} onChange={(e) => commit({ defaultModel: e.target.value })}>
          {[...new Set(info.models.map((m) => m.group ?? ''))].map((group) => {
            const options = info.models
              .filter((m) => (m.group ?? '') === group)
              .map((m) => (
                <option key={`${group}:${m.id || 'default'}`} value={m.id}>
                  {m.id ? m.label : t('composer.default')}
                </option>
              ))
            return group ? (
              <optgroup key={group} label={group}>
                {options}
              </optgroup>
            ) : (
              options
            )
          })}
        </select>
        <span className="text-fg-2">{t('settings.extraArgs')}</span>
        <input
          className="field h-8 font-mono text-[0.8rem]"
          value={local.extraArgs}
          onChange={(e) => setLocal({ ...local, extraArgs: e.target.value })}
          onBlur={() => commit({})}
          placeholder="--flag value"
        />
        <span className="self-start pt-1.5 text-fg-2">{t('settings.env')}</span>
        <textarea
          className="field min-h-[56px] resize-y py-1.5 font-mono text-[0.8rem]"
          rows={2}
          spellCheck={false}
          value={local.env}
          onChange={(e) => setLocal({ ...local, env: e.target.value })}
          onBlur={() => commit({})}
          placeholder={t('settings.envPlaceholder')}
        />
      </div>
      {!info.available && install && (
        <button className="mt-3 flex items-center gap-1.5 text-[0.84rem] text-accent hover:underline" onClick={() => void api.call('shell:openExternal', install.url)}>
          <ExternalLink size={13} />
          {t('settings.install')}
        </button>
      )}
    </div>
  )
}

/** A catalog agent that is not installed: one line, opening its full card to set a path. */
function MissingAgent({ id }: { id: AgentId }) {
  const t = useT()
  const info = useStudio((x) => x.agents.find((a) => a.id === id))
  const [open, setOpen] = useState(false)
  const install = agentSpec(id)?.install
  if (!info) return null
  if (open) return <AgentCard id={id} />
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <AgentGlyph agent={id} size={20} muted />
      <div className="min-w-0 flex-1">
        <div className="text-[0.9rem]">{info.name}</div>
        <div className="truncate font-mono text-[0.74rem] text-fg-3">{install?.cmd ?? install?.url}</div>
      </div>
      <span className="font-mono text-[0.72rem] text-fg-3">{info.route}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        {t('settings.configure')}
      </button>
      {install && (
        <button className="btn btn-ghost btn-sm" aria-label={t('settings.install')} onClick={() => void api.call('shell:openExternal', install.url)}>
          <ExternalLink size={13} />
        </button>
      )}
    </div>
  )
}

export function AgentsSection() {
  const t = useT()
  const refresh = useStudio((x) => x.refreshAgents)
  const agents = useStudio((x) => x.agents)
  const [busy, setBusy] = useState(false)
  const installed = agents.filter((a) => a.available)
  const missing = agents.filter((a) => !a.available)
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[1.05rem] font-semibold tracking-tight">{t('settings.agents')}</h3>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await refresh(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Spinner size={12} /> : <RefreshCw size={13} />}
          {t('settings.redetect')}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {installed.map((a) => (
          <AgentCard key={a.id} id={a.id} />
        ))}
      </div>
      {missing.length > 0 && (
        <>
          <h4 className="mt-6 mb-1 text-[0.86rem] font-medium text-fg-2">{t('settings.moreAgents')}</h4>
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {missing.map((a) => (
              <MissingAgent key={a.id} id={a.id} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
