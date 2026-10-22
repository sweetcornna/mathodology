import { useState } from 'react'
import { ArrowRight, Check, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import type { AgentId } from '@shared/types'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { useStudio } from '../store'
import { AgentGlyph, Logo } from './Logo'
import { NewProjectForm } from './NewProjectDialog'
import { Modal, Segmented, Spinner } from './ui'

const INSTALL: Record<AgentId, { cmd: string; url: string }> = {
  claude: { cmd: 'npm install -g @anthropic-ai/claude-code', url: 'https://docs.claude.com/en/docs/claude-code/overview' },
  codex: { cmd: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  gemini: { cmd: 'npm install -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' }
}

function Steps({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-ink' : i < step ? 'w-3 bg-fg-3' : 'w-3 bg-surface-3'}`} />
      ))}
    </div>
  )
}

export function Onboarding() {
  const t = useT()
  const open = useStudio((s) => s.dialog === 'onboarding')
  const settings = useStudio((s) => s.settings)
  const agents = useStudio((s) => s.agents)
  const save = useStudio((s) => s.saveSettings)
  const refresh = useStudio((s) => s.refreshAgents)
  const setDialog = useStudio((s) => s.setDialog)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const finish = async (): Promise<void> => {
    await save({ onboarded: true })
    setDialog(null)
  }

  if (!settings) return null
  const available = agents.filter((a) => a.available)

  return (
    <Modal open={open} onClose={() => void finish()} width={600} hideClose label={t('onboard.welcome')}>
      <div className="flex min-h-[420px] flex-col px-8 pt-8 pb-6">
        {step === 0 && (
          <div className="flex flex-col items-center py-6 text-center rise-in">
            <Logo size={64} />
            <h2 className="mt-6 text-[1.571rem] font-semibold tracking-tight">{t('onboard.welcome')}</h2>
            <p className="mt-3 max-w-[440px] text-[1rem] leading-relaxed text-fg-2">{t('onboard.welcomeDesc')}</p>
            <div className="mt-6">
              <Segmented
                value={settings.locale}
                onChange={(locale) => void save({ locale })}
                options={[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en', label: 'English' }
                ]}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="rise-in">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[1.286rem] font-semibold tracking-tight">{t('onboard.agents')}</h2>
                <p className="mt-1 text-[0.929rem] text-fg-3">{t('onboard.agentsDesc')}</p>
              </div>
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
            <div className="mt-5 flex flex-col gap-2">
              {agents.length === 0 && (
                <div className="flex items-center gap-2 py-6 text-fg-3">
                  <Spinner /> …
                </div>
              )}
              {agents.map((a) => {
                const isDefault = settings.defaultAgent === a.id
                return (
                  <div
                    key={a.id}
                    className={`flex items-center gap-3 rounded-[12px] px-3.5 py-3 ${isDefault && a.available ? 'shadow-[0_0_0_1.5px_var(--accent)]' : 'shadow-[0_0_0_1px_var(--border)]'}`}
                  >
                    <AgentGlyph agent={a.id} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium">
                        {a.name}
                        {a.available ? (
                          <span className="rounded-full bg-success-soft px-1.5 text-[0.714rem] font-medium text-success-text">{a.version}</span>
                        ) : (
                          <span className="rounded-full bg-surface-2 px-1.5 text-[0.714rem] text-fg-3">{t('settings.notFound')}</span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[0.786rem] text-fg-3">{a.available ? a.path : INSTALL[a.id].cmd}</div>
                    </div>
                    {a.available ? (
                      isDefault ? (
                        <span className="flex items-center gap-1 text-[0.857rem] text-accent-text">
                          <Check size={14} />
                          {t('settings.defaultAgent')}
                        </span>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => void save({ defaultAgent: a.id })}>
                          {t('onboard.pickDefault')}
                        </button>
                      )
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => void api.call('shell:openExternal', INSTALL[a.id].url)}>
                        <ExternalLink size={13} />
                        {t('settings.install')}
                      </button>
                    )}
                  </div>
                )
              })}
              {agents.length > 0 && !available.length && <p className="text-[0.929rem] text-warning-text">{t('onboard.none')}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rise-in">
            <h2 className="text-[1.286rem] font-semibold tracking-tight">{t('onboard.workspace')}</h2>
            <p className="mt-1 text-[0.929rem] text-fg-3">{t('onboard.workspaceDesc')}</p>
            <div className="mt-5 flex items-center gap-2">
              <div className="field flex min-w-0 flex-1 items-center truncate font-mono text-[0.857rem]">{settings.workspaceRoot}</div>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const dir = await api.call('dialog:pickFolder', t('settings.workspace'))
                  if (dir) void save({ workspaceRoot: dir })
                }}
              >
                <FolderOpen size={14} />
                {t('project.choose')}
              </button>
            </div>
            <div className="mt-6 flex flex-col gap-2 rounded-[12px] bg-surface-2 p-4 text-[0.929rem] text-fg-2">
              <div className="font-medium text-fg">{t('onboard.kitTitle')}</div>
              <p className="leading-relaxed">{t('onboard.kitDesc')}</p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rise-in">
            <h2 className="text-[1.286rem] font-semibold tracking-tight">{t('onboard.firstProject')}</h2>
            <p className="mt-1 mb-5 text-[0.929rem] text-fg-3">{t('onboard.firstProjectDesc')}</p>
            <NewProjectForm
              compact
              onDone={() => void finish()}
              onCancel={() => void finish()}
              cancelLabel={t('onboard.skip')}
              leading={
                <div className="flex items-center gap-3">
                  <Steps step={step} />
                  <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
                    {t('onboard.back')}
                  </button>
                </div>
              }
            />
          </div>
        )}

        {step < 3 && (
          <div className="mt-auto flex items-center justify-between pt-8">
            <Steps step={step} />
            <div className="flex gap-2">
              {step > 0 && (
                <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
                  {t('onboard.back')}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
                {step === 0 ? t('onboard.start') : t('onboard.next')}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
