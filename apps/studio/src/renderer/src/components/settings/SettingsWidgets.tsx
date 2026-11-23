import type { ReactNode } from 'react'

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[1.05rem] font-semibold tracking-tight">{title}</h3>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  )
}
