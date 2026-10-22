import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import type { ContestKind } from '@shared/types'
import { api } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { Modal, Segmented, Switch } from './ui'

const CONTESTS: ContestKind[] = ['MCM', 'ICM', 'CUMCM', 'Huashu', 'Other']

export function NewProjectForm({
  onDone,
  onCancel,
  compact,
  cancelLabel,
  leading
}: {
  onDone: () => void
  onCancel?: () => void
  compact?: boolean
  cancelLabel?: string
  /** Footer content on the left, such as onboarding's step dots. */
  leading?: ReactNode
}) {
  const t = useT()
  const settings = useStudio((s) => s.settings)
  const createProject = useStudio((s) => s.createProject)
  const showToast = useStudio((s) => s.showToast)
  const [name, setName] = useState('')
  const [contest, setContest] = useState<ContestKind>('MCM')
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [existing, setExisting] = useState('')
  const [installKit, setInstallKit] = useState(true)
  const [busy, setBusy] = useState(false)

  const valid = mode === 'new' ? name.trim().length > 0 : existing.length > 0

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const project = await api.call('projects:create', {
        name: name.trim() || existing.split('/').pop() || 'Project',
        contest,
        installKit,
        existingPath: mode === 'existing' ? existing : undefined
      })
      createProject(project)
      onDone()
    } catch (err) {
      showToast(String((err as Error).message ?? err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex flex-col gap-5 ${compact ? '' : 'px-6 pt-2 pb-6'}`}>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.86rem] font-medium text-fg-2">{t('project.name')}</span>
        <input
          autoFocus
          className="field"
          value={name}
          placeholder={t('project.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.86rem] font-medium text-fg-2">{t('project.contest')}</span>
        <Segmented value={contest} onChange={setContest} options={CONTESTS.map((c) => ({ value: c, label: t(`contest.${c}` as MessageKey) }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.86rem] font-medium text-fg-2">{t('project.location')}</span>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: t('project.locationNew') },
            { value: 'existing', label: t('project.locationExisting') }
          ]}
        />
        {mode === 'new' ? (
          <div className="truncate pt-1 font-mono text-[0.8rem] text-fg-3">
            {(settings?.workspaceRoot ?? '').replace(/^\/Users\/[^/]+/, '~')}/{name.trim() ? name.trim().replace(/\s+/g, '-') : '…'}
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            <div className="field flex min-w-0 flex-1 items-center truncate font-mono text-[0.8rem] text-fg-2">{existing || '—'}</div>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const dir = await api.call('dialog:pickFolder', t('project.locationExisting'))
                if (dir) {
                  setExisting(dir)
                  if (!name.trim()) setName(dir.split('/').pop() ?? '')
                }
              }}
            >
              <FolderOpen size={14} />
              {t('project.choose')}
            </button>
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-4 rounded-[12px] bg-surface-2 px-4 py-3">
        <div>
          <div className="text-[0.92rem] font-medium">{t('project.installKit')}</div>
          <div className="mt-0.5 text-[0.82rem] leading-snug text-fg-3">{t('project.installKitDesc')}</div>
        </div>
        <Switch checked={installKit} onChange={setInstallKit} label={t('project.installKit')} />
      </div>
      <div className="flex items-center justify-end gap-2">
        {leading && <div className="mr-auto">{leading}</div>}
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel ?? t('project.cancel')}
          </button>
        )}
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          {t('project.create')}
        </button>
      </div>
    </div>
  )
}

export function NewProjectDialog() {
  const t = useT()
  const open = useStudio((s) => s.dialog === 'new-project')
  const setDialog = useStudio((s) => s.setDialog)
  const [key, setKey] = useState(0)
  useEffect(() => {
    if (open) setKey((k) => k + 1)
  }, [open])
  return (
    <Modal open={open} onClose={() => setDialog(null)} title={t('project.new')} width={560}>
      <NewProjectForm key={key} onDone={() => setDialog(null)} onCancel={() => setDialog(null)} />
    </Modal>
  )
}
