import { useEffect, useState, type ReactNode } from 'react'
import { Bot, ExternalLink, FolderOpen, Info, Keyboard, Package, Palette, RefreshCw, SlidersHorizontal } from 'lucide-react'
import type { AgentId, AgentSettings, PermissionMode } from '@shared/types'
import { PERMISSION_MODES } from '@shared/ipc'
import { api, mod } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { AgentGlyph } from './Logo'
import { Modal, Row, Segmented, Spinner, Switch } from './ui'

const INSTALL: Record<AgentId, { cmd: string; url: string }> = {
  claude: { cmd: 'npm install -g @anthropic-ai/claude-code', url: 'https://docs.claude.com/en/docs/claude-code/overview' },
  codex: { cmd: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  gemini: { cmd: 'npm install -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' }
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select className="field h-8 w-auto min-w-[160px] pr-8" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[1.05rem] font-semibold tracking-tight">{title}</h3>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  )
}

function General() {
  const t = useT()
  const s = useStudio((x) => x.settings)!
  const agents = useStudio((x) => x.agents)
  const save = useStudio((x) => x.saveSettings)
  return (
    <Section title={t('settings.general')}>
      <Row label={t('settings.language')}>
        <Segmented
          value={s.locale}
          onChange={(locale) => void save({ locale })}
          options={[
            { value: 'zh-CN', label: '简体中文' },
            { value: 'en', label: 'English' }
          ]}
        />
      </Row>
      <Row label={t('settings.workspace')} desc={<span className="font-mono text-[0.78rem]">{s.workspaceRoot}</span>}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={async () => {
            const dir = await api.call('dialog:pickFolder', t('settings.workspace'))
            if (dir) void save({ workspaceRoot: dir })
          }}
        >
          <FolderOpen size={13} />
          {t('project.choose')}
        </button>
      </Row>
      <Row label={t('settings.defaultAgent')}>
        <Select value={s.defaultAgent} onChange={(defaultAgent) => void save({ defaultAgent })} options={agents.map((a) => ({ value: a.id, label: a.name }))} />
      </Row>
      <Row label={t('settings.defaultMode')}>
        <Select<PermissionMode>
          value={s.defaultPermissionMode}
          onChange={(defaultPermissionMode) => void save({ defaultPermissionMode })}
          options={PERMISSION_MODES.map((m) => ({ value: m, label: t(`mode.${m}` as MessageKey) }))}
        />
      </Row>
      <Row label={t('settings.sendWithEnter')} desc={t('settings.sendWithEnterDesc', { mod })}>
        <Switch checked={s.sendWithEnter} onChange={(sendWithEnter) => void save({ sendWithEnter })} />
      </Row>
      <Row label={t('settings.searchMcp')} desc={t('settings.searchMcpDesc')}>
        <Switch checked={s.enableSearchMcp} onChange={(enableSearchMcp) => void save({ enableSearchMcp })} />
      </Row>
    </Section>
  )
}

function Appearance() {
  const t = useT()
  const s = useStudio((x) => x.settings)!
  const save = useStudio((x) => x.saveSettings)
  return (
    <Section title={t('settings.appearance')}>
      <Row label={t('settings.theme')}>
        <Segmented
          value={s.theme}
          onChange={(theme) => void save({ theme })}
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') }
          ]}
        />
      </Row>
      <Row label={t('settings.fontScale')}>
        <Segmented
          value={String(s.fontScale)}
          onChange={(v) => void save({ fontScale: Number(v) })}
          options={[
            { value: '0.93', label: 'A−' },
            { value: '1', label: 'A' },
            { value: '1.07', label: 'A+' },
            { value: '1.14', label: 'A++' }
          ]}
        />
      </Row>
    </Section>
  )
}

function AgentCard({ id }: { id: AgentId }) {
  const t = useT()
  const info = useStudio((x) => x.agents.find((a) => a.id === id))
  const s = useStudio((x) => x.settings)!
  const save = useStudio((x) => x.saveSettings)
  const [local, setLocal] = useState<AgentSettings>(s.agents[id])
  useEffect(() => setLocal(s.agents[id]), [s.agents, id])
  const commit = (patch: Partial<AgentSettings>): void => {
    const next = { ...local, ...patch }
    setLocal(next)
    void save({ agents: { ...s.agents, [id]: next } })
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
          </div>
          <div className="truncate font-mono text-[0.76rem] text-fg-3">{info.path ?? INSTALL[id].cmd}</div>
        </div>
        <span className="text-[0.76rem] text-fg-3">{info.supportsApproval ? t('settings.approval') : t('settings.noApproval')}</span>
      </div>
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
          {info.models.map((m) => (
            <option key={m.id || 'default'} value={m.id}>
              {m.id ? m.label : t('composer.default')}
            </option>
          ))}
        </select>
        <span className="text-fg-2">{t('settings.extraArgs')}</span>
        <input
          className="field h-8 font-mono text-[0.8rem]"
          value={local.extraArgs}
          onChange={(e) => setLocal({ ...local, extraArgs: e.target.value })}
          onBlur={() => commit({})}
          placeholder="--flag value"
        />
      </div>
      {!info.available && (
        <button className="mt-3 flex items-center gap-1.5 text-[0.84rem] text-accent hover:underline" onClick={() => void api.call('shell:openExternal', INSTALL[id].url)}>
          <ExternalLink size={13} />
          {t('settings.install')}
        </button>
      )}
    </div>
  )
}

function Agents() {
  const t = useT()
  const refresh = useStudio((x) => x.refreshAgents)
  const [busy, setBusy] = useState(false)
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[1.05rem] font-semibold tracking-tight">{t('settings.agents')}</h3>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await refresh(true)
            setBusy(false)
          }}
        >
          {busy ? <Spinner size={12} /> : <RefreshCw size={13} />}
          {t('settings.redetect')}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {(['claude', 'codex', 'gemini'] as AgentId[]).map((id) => (
          <AgentCard key={id} id={id} />
        ))}
      </div>
    </section>
  )
}

function Kit() {
  const t = useT()
  const info = useStudio((x) => x.info)
  if (!info) return null
  return (
    <section className="flex flex-col gap-5">
      <h3 className="text-[1.05rem] font-semibold tracking-tight">{t('settings.kit')}</h3>
      <div className="text-[0.84rem] text-fg-3">
        {t('settings.kitSource')}: <span className="font-mono text-[0.78rem]">{info.kit.source}</span>
      </div>
      <div>
        <div className="mb-2 text-[0.86rem] font-medium text-fg-2">{t('settings.kitSkills')}</div>
        <div className="flex flex-col gap-2">
          {info.kit.skills.map((s) => (
            <div key={s.name} className="rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
              <div className="font-mono text-[0.82rem] font-medium">{s.name}</div>
              <div className="mt-0.5 text-[0.84rem] text-fg-3">{s.description}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[0.86rem] font-medium text-fg-2">{t('settings.kitRoles')}</div>
        <div className="grid grid-cols-2 gap-2">
          {info.kit.roles.map((r) => (
            <div key={r.name} className="rounded-[10px] border border-line bg-surface px-3 py-2">
              <div className="font-mono text-[0.78rem] font-medium">{r.name.replace('mathodology-', '')}</div>
              <div className="mt-0.5 text-[0.8rem] leading-snug text-fg-3">{r.description}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-[0.84rem] text-fg-3">
        {t('settings.kitWorkflows')}: {info.kit.workflows.join(', ')}
      </div>
    </section>
  )
}

function Shortcuts() {
  const t = useT()
  const rows: [MessageKey, string][] = [
    ['shortcut.newSession', `${mod}N`],
    ['shortcut.newProject', `${mod}⇧N`],
    ['shortcut.palette', `${mod}K`],
    ['shortcut.settings', `${mod},`],
    ['shortcut.sidebar', `${mod}⇧S`],
    ['shortcut.pane', `${mod}\\`],
    ['shortcut.stop', 'Esc']
  ]
  return (
    <Section title={t('settings.shortcuts')}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between py-2.5 text-[0.92rem]">
          {t(k)}
          <span className="kbd h-6 px-2 text-[0.8rem]">{v}</span>
        </div>
      ))}
    </Section>
  )
}

function About() {
  const t = useT()
  const info = useStudio((x) => x.info)
  return (
    <Section title={t('settings.about')}>
      <Row label={t('settings.version')}>
        <span className="font-mono text-[0.86rem] text-fg-2">{info?.version}</span>
      </Row>
      <Row label={t('settings.dataDir')} desc={<span className="font-mono text-[0.78rem]">{info?.userData}</span>}>
        <button className="btn btn-secondary btn-sm" onClick={() => info && void api.call('shell:openPath', info.userData)}>
          <FolderOpen size={13} />
        </button>
      </Row>
      <p className="py-4 text-[0.88rem] leading-relaxed text-fg-2">{t('settings.license')}</p>
      <div className="py-3">
        <button className="btn btn-secondary btn-sm" onClick={() => void api.call('shell:openExternal', 'https://github.com/sweetcornna/mathodology')}>
          <ExternalLink size={13} /> GitHub
        </button>
      </div>
    </Section>
  )
}

const SECTIONS: { id: string; label: MessageKey; icon: typeof Info }[] = [
  { id: 'general', label: 'settings.general', icon: SlidersHorizontal },
  { id: 'agents', label: 'settings.agents', icon: Bot },
  { id: 'appearance', label: 'settings.appearance', icon: Palette },
  { id: 'kit', label: 'settings.kit', icon: Package },
  { id: 'shortcuts', label: 'settings.shortcuts', icon: Keyboard },
  { id: 'about', label: 'settings.about', icon: Info }
]

export function SettingsDialog() {
  const t = useT()
  const open = useStudio((s) => s.dialog === 'settings')
  const section = useStudio((s) => s.settingsSection)
  const setDialog = useStudio((s) => s.setDialog)
  const settings = useStudio((s) => s.settings)
  if (!settings) return null
  return (
    <Modal open={open} onClose={() => setDialog(null)} width={860} label={t('settings.title')}>
      <div className="flex h-[min(640px,calc(100vh-80px))]">
        <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 rounded-l-[var(--radius-xl)] border-r border-line bg-sidebar p-3">
          <div className="px-2.5 pt-1 pb-3 text-[1.05rem] font-semibold">{t('settings.title')}</div>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => useStudio.setState({ settingsSection: id })}
              className={`flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-[0.92rem] transition-colors ${
                section === id ? 'bg-surface-3 font-medium text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
              }`}
            >
              <Icon size={15} />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="scroll min-w-0 flex-1 px-8 py-6">
          {section === 'general' && <General />}
          {section === 'agents' && <Agents />}
          {section === 'appearance' && <Appearance />}
          {section === 'kit' && <Kit />}
          {section === 'shortcuts' && <Shortcuts />}
          {section === 'about' && <About />}
        </div>
      </div>
    </Modal>
  )
}
