import { Dialog as RDialog, DropdownMenu, Switch as RSwitch, Tooltip as RTooltip } from 'radix-ui'
import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n'

export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" side={side} sideOffset={6}>
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

export const TipProvider = RTooltip.Provider

export function Menu({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  width
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  width?: number
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align={align} side={side} sideOffset={6} style={width ? { width } : undefined}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  icon,
  right
}: {
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
  right?: ReactNode
}) {
  return (
    <DropdownMenu.Item className={`menu-item ${danger ? 'danger' : ''}`} onSelect={onSelect} disabled={disabled}>
      {icon && <span className="flex w-4 shrink-0 justify-center text-fg-3">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {right}
    </DropdownMenu.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="menu-label">{children}</DropdownMenu.Label>
}

export function MenuSep() {
  return <DropdownMenu.Separator className="menu-sep" />
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full bg-surface-3 transition-colors duration-150 data-[state=checked]:bg-accent"
    >
      <RSwitch.Thumb className="block h-[18px] w-[18px] translate-x-[2px] rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-[10px] bg-surface-2 p-[3px]" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-[7px] px-3 text-[0.86rem] font-medium transition-colors ${
            value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-2 hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  width = 520,
  children,
  hideClose,
  label
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Accessible name for dialogs without a visible title. */
  label?: string
  width?: number
  children: ReactNode
  hideClose?: boolean
}) {
  const t = useT()
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="scrim" />
        <RDialog.Content className="dialog flex flex-col" style={{ width: `min(${width}px, calc(100vw - 48px))` }} aria-describedby={undefined}>
          {title ? (
            <div className="flex items-center justify-between px-6 pt-5 pb-2">
              <RDialog.Title className="text-[1.15rem] font-semibold tracking-tight">{title}</RDialog.Title>
              {!hideClose && (
                <RDialog.Close className="icon-btn" aria-label={t('common.close')}>
                  <X size={16} />
                </RDialog.Close>
              )}
            </div>
          ) : (
            <RDialog.Title className="sr-only">{label}</RDialog.Title>
          )}
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Row({ label, desc, children }: { label: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[0.95rem] font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-[0.85rem] text-fg-3">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const GLYPHS = ['∂', '∫', '∑', '∏', '∇', '∏', '∑', '∫']

/** Mathodology's working indicator: a stepped flipbook of operator glyphs. */
export function GlyphSpinner({ paused }: { paused?: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => setI((x) => (x + 1) % GLYPHS.length), 220)
    return () => clearInterval(timer)
  }, [paused])
  return (
    <span
      className={`inline-grid h-4 w-4 shrink-0 place-items-center font-serif text-[15px] leading-none ${paused ? 'text-warning' : 'text-accent'}`}
      aria-hidden
    >
      {GLYPHS[i]}
    </span>
  )
}
