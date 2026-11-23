import { ExternalLink, FolderOpen } from 'lucide-react'
import type { PermissionMode } from '@shared/types'
import { PERMISSION_MODES } from '@shared/ipc'
import { api, mod } from '../../lib/api'
import { useT, type MessageKey } from '../../lib/i18n'
import { openPath } from '../../lib/open'
import { useStudio } from '../../store'
import { Row, Segmented, Switch } from '../ui'
import { Section, Select } from './SettingsWidgets'

export function GeneralSection() {
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
        <Select
          value={s.defaultAgent}
          onChange={(defaultAgent) => void save({ defaultAgent })}
          options={agents.filter((a) => a.available || a.id === s.defaultAgent).map((a) => ({ value: a.id, label: a.name }))}
        />
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
      <Row label={t('settings.humanizer')} desc={t('settings.humanizerDesc')}>
        <Switch checked={s.installHumanizer} onChange={(installHumanizer) => void save({ installHumanizer })} />
      </Row>
    </Section>
  )
}

export function AppearanceSection() {
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

export function KitSection() {
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

export function ShortcutsSection() {
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

export function AboutSection() {
  const t = useT()
  const info = useStudio((x) => x.info)
  return (
    <Section title={t('settings.about')}>
      <Row label={t('settings.version')}>
        <span className="font-mono text-[0.86rem] text-fg-2">{info?.version}</span>
      </Row>
      <Row label={t('settings.dataDir')} desc={<span className="font-mono text-[0.78rem]">{info?.userData}</span>}>
        <button className="btn btn-secondary btn-sm" onClick={() => info && openPath(info.userData)}>
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
