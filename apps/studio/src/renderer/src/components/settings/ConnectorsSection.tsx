import { useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleX, Plug, Plus, Trash2 } from 'lucide-react'
import type { Connector, ConnectorCheck } from '@shared/types'
import { joinArgs, splitArgs } from '@shared/args'
import { api } from '../../lib/api'
import { formatIpcError } from '../../lib/errors'
import { useT } from '../../lib/i18n'
import { useStudio } from '../../store'
import { Segmented, Spinner, Switch } from '../ui'
import { Section } from './SettingsWidgets'

function connectorLine(c: Connector): string {
  return c.url ?? joinArgs([c.command ?? '', ...(c.args ?? [])])
}

/** Same rule as the main process: a key every CLI accepts, unique among the connectors. */
function newId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server'
  let id = base
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`
  return id
}

function ConnectorRow({ c }: { c: Connector }) {
  const t = useT()
  const updateConnectors = useStudio((x) => x.updateConnectors)
  const [check, setCheck] = useState<ConnectorCheck | 'running' | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const put = (next: Connector | null): void => {
    void updateConnectors((list) => (next ? list.map((x) => (x.id === c.id ? next : x)) : list.filter((x) => x.id !== c.id)))
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <Plug size={15} className="shrink-0 text-fg-3" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[0.95rem] font-medium">
            {c.name}
            {c.builtin && <span className="kbd">{t('connectors.builtin')}</span>}
          </div>
          <div className="truncate font-mono text-[0.78rem] text-fg-3" title={connectorLine(c)}>
            {connectorLine(c)}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          disabled={check === 'running'}
          onClick={async () => {
            setCheck('running')
            try {
              const res = await api.call('connectors:check', c)
              if (alive.current) setCheck(res)
            } catch (err) {
              if (alive.current) setCheck({ ok: false, tools: [], error: formatIpcError(err) })
            }
          }}
        >
          {check === 'running' ? <Spinner size={12} /> : null}
          {t('connectors.check')}
        </button>
        {!c.builtin && (
          <button className="icon-btn-sm" aria-label={t('common.remove')} onClick={() => put(null)}>
            <Trash2 size={13} />
          </button>
        )}
        <Switch checked={c.enabled} onChange={(enabled) => put({ ...c, enabled })} label={c.name} />
      </div>
      {check && check !== 'running' && (
        <div className={`mt-2 ml-[27px] flex items-start gap-1.5 text-[0.82rem] ${check.ok ? 'text-fg-2' : 'text-danger-text'}`}>
          {check.ok ? <CircleCheck size={13} className="mt-0.5 shrink-0 text-success" /> : <CircleX size={13} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 break-words">
            {check.ok ? t('connectors.ok', { n: check.tools.length }) + (check.tools.length ? ` · ${check.tools.slice(0, 12).join(', ')}` : '') : check.error}
          </span>
        </div>
      )}
    </div>
  )
}

function AddConnector({ onDone }: { onDone: () => void }) {
  const t = useT()
  const updateConnectors = useStudio((x) => x.updateConnectors)
  const [kind, setKind] = useState<'stdio' | 'http'>('stdio')
  const [name, setName] = useState('')
  const [line, setLine] = useState('')
  const [env, setEnv] = useState('')
  const parts = splitArgs(line)
  const valid = name.trim() && (kind === 'http' ? /^https?:\/\/\S+$/.test(line.trim()) : parts.length > 0)

  const add = (): void => {
    const vars = Object.fromEntries(
      env
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    )
    const trimmedName = name.trim()
    const trimmedLine = line.trim()
    void updateConnectors((list) => {
      const id = newId(trimmedName, list.map((c) => c.id))
      const c: Connector =
        kind === 'http'
          ? { id, name: trimmedName, enabled: true, url: trimmedLine }
          : { id, name: trimmedName, enabled: true, command: parts[0], args: parts.slice(1), ...(Object.keys(vars).length ? { env: vars } : {}) }
      return [...list, c]
    })
    onDone()
  }

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-[10px] bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <input className="field h-8 flex-1" placeholder={t('connectors.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'stdio', label: t('connectors.local') },
            { value: 'http', label: t('connectors.remote') }
          ]}
        />
      </div>
      <input
        className="field h-8 font-mono text-[0.82rem]"
        placeholder={kind === 'http' ? 'https://example.com/mcp' : 'npx -y @scope/server --flag'}
        value={line}
        onChange={(e) => setLine(e.target.value)}
      />
      {kind === 'stdio' && (
        <textarea className="field min-h-[56px] py-1.5 font-mono text-[0.82rem]" placeholder={t('connectors.env')} value={env} onChange={(e) => setEnv(e.target.value)} />
      )}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary btn-sm" disabled={!valid} onClick={add}>
          {t('connectors.add')}
        </button>
      </div>
    </div>
  )
}

export function ConnectorsSection() {
  const t = useT()
  const connectors = useStudio((x) => x.settings!.connectors)
  const [adding, setAdding] = useState(false)
  return (
    <Section title={t('settings.connectors')}>
      <p className="pb-3 text-[0.88rem] leading-relaxed text-fg-3">{t('connectors.intro')}</p>
      {connectors.map((c) => (
        <ConnectorRow key={c.id} c={c} />
      ))}
      <div className="py-3">
        {adding ? (
          <AddConnector onDone={() => setAdding(false)} />
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> {t('connectors.new')}
          </button>
        )}
      </div>
    </Section>
  )
}
