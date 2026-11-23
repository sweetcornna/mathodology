import { Bot, Info, Keyboard, Package, Palette, Plug, SlidersHorizontal } from 'lucide-react'
import { useT, type MessageKey } from '../lib/i18n'
import { useStudio } from '../store'
import { AgentsSection } from './settings/AgentsSection'
import { ConnectorsSection } from './settings/ConnectorsSection'
import { AboutSection, AppearanceSection, GeneralSection, KitSection, ShortcutsSection } from './settings/GeneralSections'
import { Modal } from './ui'

const SECTIONS: { id: string; label: MessageKey; icon: typeof Info }[] = [
  { id: 'general', label: 'settings.general', icon: SlidersHorizontal },
  { id: 'agents', label: 'settings.agents', icon: Bot },
  { id: 'connectors', label: 'settings.connectors', icon: Plug },
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
          {section === 'general' && <GeneralSection />}
          {section === 'agents' && <AgentsSection />}
          {section === 'connectors' && <ConnectorsSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'kit' && <KitSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </Modal>
  )
}
