import { useNavigate } from 'react-router-dom'
import { Keyboard } from 'lucide-react'
import { Modal } from './Modal'
import { useUI } from '../lib/ui'
import { useSettings } from '../lib/settings'
import { SHORTCUTS, comboOf, prettyCombo } from '../lib/shortcuts'

export function ShortcutsHelp() {
  const open = useUI((s) => s.help)
  useSettings((s) => s.shortcuts)
  const nav = useNavigate()
  const close = () => useUI.getState().setHelp(false)
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]
  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title={
        <span className="flex items-center gap-2">
          <Keyboard size={18} /> Scorciatoie da tastiera
        </span>
      }
    >
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-5 max-h-[65vh] overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g}>
            <div className="label">{g}</div>
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-[var(--line)] text-[13.5px]">
                <span className="flex-1">
                  {s.label}
                  {s.hint && <span className="opacity-45 text-[12px]"> · {s.hint}</span>}
                </span>
                <kbd className="kbd">{prettyCombo(comboOf(s.id))}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <button
          className="btn"
          onClick={() => {
            close()
            nav('/settings#scorciatoie')
          }}
        >
          Personalizza…
        </button>
      </div>
    </Modal>
  )
}
