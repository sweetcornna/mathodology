import { useMemo, useState } from 'react'
import { Popover } from 'radix-ui'
import { Command } from 'cmdk'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { AgentId, AgentInfo, ModelInfo } from '@shared/types'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { AgentGlyph, ModelIcon } from './BrandIcon'

/** Models in display order, grouped by provider or routing group, with ungrouped models first. */
function grouped(models: ModelInfo[]): [string, ModelInfo[]][] {
  const groups = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const key = m.group ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : 0))
}

const EFFORT_KEYS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

function effortLabel(t: ReturnType<typeof useT>, effort: string): string {
  return EFFORT_KEYS.has(effort) ? t(`effort.${effort}` as MessageKey) : effort
}

function AgentTabs({ agents, value, onPick }: { agents: AgentInfo[]; value: AgentId; onPick: (id: AgentId) => void }) {
  const t = useT()
  // Installed agents only (and the current one): the catalog lists many more than anyone has.
  const shown = agents.filter((a) => a.available || a.id === value)
  return (
    <div className="grid max-h-[132px] grid-cols-3 gap-1 overflow-y-auto border-b border-line p-1.5">
      {shown.map((a) => (
        <button
          key={a.id}
          disabled={!a.available}
          title={a.available ? a.version : t('composer.unavailable')}
          onClick={() => onPick(a.id)}
          className={`flex h-8 items-center justify-center gap-1.5 rounded-[7px] text-[0.857rem] transition-colors disabled:opacity-40 ${
            a.id === value ? 'bg-surface-3 text-fg' : 'text-fg-3 hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <AgentGlyph agent={a.id} size={15} />
          <span className="truncate">{a.name}</span>
        </button>
      ))}
    </div>
  )
}

function EffortRow({ model, value, onPick }: { model: ModelInfo; value: string; onPick: (e: string) => void }) {
  const t = useT()
  const levels = model.efforts ?? []
  const current = value || model.defaultEffort || ''
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2">
      <span className="shrink-0 text-[0.786rem] text-fg-3">{t('composer.effort')}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {levels.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e === model.defaultEffort ? '' : e)}
            className={`h-6 rounded-full px-2 text-[0.786rem] transition-colors ${
              e === current ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'
            }`}
          >
            {effortLabel(t, e)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Agent and model picker: the agent CLI on top, then every model that CLI reports for the
 * signed-in account (searchable and grouped by source), then the model's reasoning effort.
 */
export function ModelPicker({ pill }: { pill?: boolean }) {
  const t = useT()
  const agents = useStudio((s) => s.agents)
  const draft = useStudio((s) => s.draft)
  const setDraft = useStudio((s) => s.setDraft)
  const fallback = useStudio((s) => s.settings?.agents[s.draft.agent]?.defaultModel ?? '')
  const [open, setOpen] = useState(false)
  const agent = agents.find((a) => a.id === draft.agent)
  const models = agent?.models ?? []
  const effective = draft.model || fallback
  const model = models.find((m) => m.id === effective) ?? models[0]
  const groups = useMemo(() => grouped(models), [models])
  const label = (m: ModelInfo | undefined): string => (!m || !m.id ? t('composer.default') : m.label)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={`flex min-w-0 items-center gap-1.5 text-fg-3 transition-colors hover:text-fg ${
            pill ? 'h-7 rounded-full bg-surface-2 px-2.5 text-[0.857rem] hover:bg-surface-3' : 'h-6 rounded-[6px] px-1.5 text-[0.857rem] hover:bg-surface-2'
          }`}
        >
          <AgentGlyph agent={draft.agent} size={14} />
          <span className="text-fg-3">{agent?.name ?? draft.agent}</span>
          <span className="text-fg-4">·</span>
          <ModelIcon model={model} agent={draft.agent} size={13} />
          <span className="max-w-[180px] truncate text-fg-2">{label(model)}</span>
          {draft.effort && <span className="text-fg-3">{effortLabel(t, draft.effort)}</span>}
          <ChevronDown size={12} className="shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} className="menu flex w-[360px] flex-col overflow-hidden p-0" style={{ maxHeight: 'min(520px, var(--radix-popover-content-available-height))' }}>
          <AgentTabs agents={agents} value={draft.agent} onPick={(id) => setDraft({ agent: id, model: '', effort: '' })} />
          <Command loop className="flex min-h-0 flex-1 flex-col">
            {models.length > 8 && (
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search size={14} className="text-fg-3" />
                <Command.Input autoFocus placeholder={t('composer.searchModels')} className="h-9 min-w-0 flex-1 bg-transparent text-[0.893rem] outline-none placeholder:text-fg-3 focus-visible:shadow-none" />
              </div>
            )}
            <Command.List className="scroll min-h-0 flex-1 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-[0.857rem] text-fg-3">{t('palette.empty')}</Command.Empty>
              {groups.map(([group, list]) => (
                <Command.Group
                  key={group || 'main'}
                  heading={group || undefined}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.75rem] [&_[cmdk-group-heading]]:text-fg-3"
                >
                  {list.map((m) => {
                    const selected = m.id === (model?.id ?? '')
                    return (
                      <Command.Item
                        key={`${group}:${m.id}`}
                        value={`${group} ${m.id} ${m.label}`}
                        keywords={m.description ? [m.description] : undefined}
                        onSelect={() => {
                          setDraft({ model: m.id, effort: '' })
                          if (!m.efforts?.length) setOpen(false)
                        }}
                        className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[0.893rem] data-[selected=true]:bg-surface-2"
                      >
                        <ModelIcon model={m} agent={draft.agent} size={16} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-fg">{label(m)}</div>
                          {m.description && <div className="truncate text-[0.75rem] text-fg-3">{m.description}</div>}
                        </div>
                        {selected && <Check size={14} className="shrink-0 text-accent" />}
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          {model?.efforts?.length ? <EffortRow model={model} value={draft.effort} onPick={(effort) => setDraft({ effort })} /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
