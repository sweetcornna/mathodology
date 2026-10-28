import { Command } from 'cmdk'
import { Dialog as RDialog } from 'radix-ui'
import { BookOpen, ClipboardCheck, FolderOpen, FolderPlus, Layers, ListChecks, MessageSquare, Moon, PanelLeft, PanelRight, Plus, Settings, ShieldCheck, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { mod } from '../lib/api'
import { useT } from '../lib/i18n'
import { useStudio } from '../store'

function Item({ icon, children, shortcut, onSelect, value }: { icon: ReactNode; children: ReactNode; shortcut?: string; onSelect: () => void; value: string }) {
  return (
    <Command.Item
      value={value}
      // The value is a stable English id; the visible label makes the item findable in Chinese too.
      keywords={typeof children === 'string' ? [children] : undefined}
      onSelect={onSelect}
      className="flex h-9 items-center gap-2.5 rounded-[6px] px-2.5 text-[0.929rem] text-fg-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg"
    >
      <span className="text-fg-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="kbd">{shortcut}</span>}
    </Command.Item>
  )
}

export function CommandPalette() {
  const t = useT()
  const open = useStudio((s) => s.dialog === 'palette')
  const setDialog = useStudio((s) => s.setDialog)
  const sessions = useStudio((s) => s.sessions)
  const projects = useStudio((s) => s.projects)
  const theme = useStudio((s) => s.settings?.theme)
  const st = useStudio.getState

  const run = (fn: () => void): void => {
    setDialog(null)
    fn()
  }

  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <RDialog.Portal>
        <RDialog.Overlay className="scrim" />
        <RDialog.Content className="dialog dialog-top w-[min(620px,calc(100vw-48px))] overflow-hidden" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">{t('shortcut.palette')}</RDialog.Title>
          <Command loop className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder={t('palette.placeholder')}
              className="h-12 border-b border-line bg-transparent px-4 focus-visible:shadow-none text-[1.071rem] text-fg outline-none placeholder:text-fg-3"
            />
            <Command.List className="scroll max-h-[min(420px,60vh)] p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-[0.929rem] text-fg-3">{t('palette.empty')}</Command.Empty>
              <Command.Group heading={t('palette.commands')} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.786rem] [&_[cmdk-group-heading]]:text-fg-3">
                <Item value="new session" icon={<Plus size={15} />} shortcut={`${mod}N`} onSelect={() => run(() => st().newSession())}>
                  {t('shortcut.newSession')}
                </Item>
                <Item value="new project" icon={<FolderPlus size={15} />} shortcut={`${mod}⇧N`} onSelect={() => run(() => setDialog('new-project'))}>
                  {t('shortcut.newProject')}
                </Item>
                <Item value="settings" icon={<Settings size={15} />} shortcut={`${mod},`} onSelect={() => run(() => setDialog('settings'))}>
                  {t('shortcut.settings')}
                </Item>
                <Item value="toggle sidebar" icon={<PanelLeft size={15} />} shortcut={`${mod}B`} onSelect={() => run(() => useStudio.setState((s) => ({ sidebarOpen: !s.sidebarOpen })))}>
                  {t('shortcut.sidebar')}
                </Item>
                <Item value="files panel" icon={<PanelRight size={15} />} shortcut={`${mod}\\`} onSelect={() => run(() => st().togglePane('files'))}>
                  {t('pane.files')}
                </Item>
                <Item value="tasks panel" icon={<ListChecks size={15} />} onSelect={() => run(() => st().togglePane('tasks'))}>
                  {t('pane.tasks')}
                </Item>
                <Item value="artifacts panel figures" icon={<Layers size={15} />} onSelect={() => run(() => st().togglePane('artifacts'))}>
                  {t('pane.artifacts')}
                </Item>
                <Item value="literature papers search references bibliography" icon={<BookOpen size={15} />} onSelect={() => run(() => st().togglePane('literature'))}>
                  {t('pane.literature')}
                </Item>
                <Item value="checks workbench results numbers latex compile" icon={<ClipboardCheck size={15} />} onSelect={() => run(() => st().togglePane('checks'))}>
                  {t('pane.checks')}
                </Item>
                {st().activeSessionId && (
                  <Item value="review session check" icon={<ShieldCheck size={15} />} onSelect={() => run(() => void st().startReview())}>
                    {t('review.start')}
                  </Item>
                )}
                <Item
                  value="toggle theme dark light"
                  icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                  onSelect={() => run(() => void st().saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' }))}
                >
                  {t('palette.toggleTheme')}
                </Item>
              </Command.Group>
              {projects.length > 0 && (
                <Command.Group heading={t('palette.projects')} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.786rem] [&_[cmdk-group-heading]]:text-fg-3">
                  {projects.map((p) => (
                    <Item key={p.id} value={`project ${p.name} ${p.id}`} icon={<FolderOpen size={15} />} onSelect={() => run(() => st().selectProject(p.id))}>
                      {p.name}
                    </Item>
                  ))}
                </Command.Group>
              )}
              {sessions.length > 0 && (
                <Command.Group heading={t('palette.sessions')} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.786rem] [&_[cmdk-group-heading]]:text-fg-3">
                  {[...sessions]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .slice(0, 50)
                    .map((s) => (
                      <Item key={s.id} value={`session ${s.title} ${s.id}`} icon={<MessageSquare size={15} />} onSelect={() => run(() => void st().selectSession(s.id))}>
                        {s.title || t('session.untitled')}
                        <span className="ml-2 text-[0.786rem] text-fg-3">{projects.find((p) => p.id === s.projectId)?.name}</span>
                      </Item>
                    ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
