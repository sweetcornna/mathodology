import { useState } from 'react'
import { ChevronDown, ChevronUp, CircleCheck } from 'lucide-react'
import type { TodoItem } from '@shared/types'
import { useT } from '../../lib/i18n'
import { Spinner } from '../ui'

export function TaskCard({ todos, running }: { todos: TodoItem[]; running: boolean }) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const done = todos.filter((x) => x.status === 'completed').length
  const active = running ? todos.find((x) => x.status === 'in_progress') : undefined
  return (
    <div className="card px-3 py-2">
      <button className="flex w-full items-center gap-2 text-left text-[0.929rem]" onClick={() => setCollapsed((c) => !c)}>
        <span className="font-medium">{t('plan.title')}</span>
        <span className="text-fg-3 tabular-nums">
          {done}/{todos.length}
        </span>
        {collapsed && active && <span className="min-w-0 flex-1 truncate text-fg-3">· {active.content}</span>}
        <span className="flex-1" />
        {collapsed ? <ChevronUp size={14} className="text-fg-3" /> : <ChevronDown size={14} className="text-fg-3" />}
      </button>
      {!collapsed && (
        <ul className="scroll mt-1.5 flex max-h-56 flex-col gap-0.5">
          {todos.map((item, i) => (
            <li key={i} className="flex items-start gap-2 py-0.5 text-[0.929rem] leading-[1.43]">
              <span className="mt-[2px] grid h-4 w-4 shrink-0 place-items-center">
                {item.status === 'completed' ? (
                  <CircleCheck size={15} className="text-fg-3" />
                ) : running && item.status === 'in_progress' ? (
                  <Spinner size={13} />
                ) : (
                  <span className="h-[13px] w-[13px] rounded-full border-[1.5px] border-dashed border-fg-4" />
                )}
              </span>
              <span className={item.status === 'completed' ? 'text-fg-3' : running && item.status === 'in_progress' ? 'text-fg' : 'text-fg-2'}>{item.content}</span>
            </li>
          ))}
        </ul>
      )}
      {!running && done < todos.length && <p className="mt-1.5 text-[0.857rem] text-fg-3">{t('plan.unfinished')}</p>}
    </div>
  )
}
