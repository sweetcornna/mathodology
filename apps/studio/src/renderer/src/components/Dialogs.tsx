import { useEffect, useState } from 'react'
import { CircleAlert, Info } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useStudio } from '../store'
import { Modal } from './ui'

export function ConfirmDialog() {
  const t = useT()
  const state = useStudio((s) => s.confirmState)
  return (
    <Modal open={Boolean(state)} onClose={() => state?.resolve(false)} title={state?.title} width={420} hideClose>
      {state && (
        <div className="px-6 pb-5">
          <p className="text-[0.929rem] leading-relaxed text-fg-2">{state.body}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => state.resolve(false)}>
              {t('common.cancel')}
            </button>
            <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => state.resolve(true)}>
              {state.confirmLabel ?? t('common.confirm')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function PromptDialog() {
  const t = useT()
  const state = useStudio((s) => s.promptState)
  const [value, setValue] = useState('')
  useEffect(() => {
    if (state) setValue(state.value)
  }, [state])
  return (
    <Modal open={Boolean(state)} onClose={() => state?.resolve(null)} title={state?.title} width={440} hideClose>
      {state && (
        <form
          className="px-6 pb-5"
          onSubmit={(e) => {
            e.preventDefault()
            state.resolve(value)
          }}
        >
          <input autoFocus className="field mt-1" value={value} placeholder={state.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => state.resolve(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export function Toast() {
  const toast = useStudio((s) => s.toast)
  if (!toast) return null
  const Icon = toast.tone === 'error' ? CircleAlert : Info
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center">
      <div
        className={`pointer-events-auto flex max-w-[560px] items-start gap-2 rounded-[10px] px-3.5 py-2.5 text-[0.929rem] shadow-[0_0_0_0.5px_var(--border-strong),var(--shadow-popover)] rise-in ${
          toast.tone === 'error' ? 'bg-danger-soft text-danger-text' : 'bg-composer text-fg'
        }`}
      >
        <Icon size={15} className="mt-0.5 shrink-0" />
        <span className="selectable">{toast.text}</span>
      </div>
    </div>
  )
}
