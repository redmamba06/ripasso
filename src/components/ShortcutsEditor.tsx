import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw, X } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { SHORTCUTS, comboOf, comboFromEvent, conflicts, prettyCombo, recording } from '../lib/shortcuts'
import { toast } from './Toast'

/** Elenco delle scorciatoie con registrazione di nuove combinazioni. */
export function ShortcutsEditor() {
  const overrides = useSettings((s) => s.shortcuts)
  const set = useSettings((s) => s.set)
  const [rec, setRec] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!rec) return
    recording.on = true
    const k = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && rec !== 'drawDone') {
        setRec(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      const c = conflicts(rec, combo)
      const next = { ...overrides, [rec]: combo }
      // chi aveva già quella combinazione la perde
      for (const x of c) next[x.id] = ''
      set({ shortcuts: next })
      if (c.length) toast(`Tolta da: ${c.map((x) => x.label).join(', ')}`, 'info')
      setRec(null)
    }
    window.addEventListener('keydown', k, true)
    return () => {
      recording.on = false
      window.removeEventListener('keydown', k, true)
    }
  }, [rec, overrides, set])

  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]
  const list = SHORTCUTS.filter((s) => !q || s.label.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="set-title !mb-0 flex-1">
          <Keyboard size={17} /> Scorciatoie da tastiera
        </h2>
        <input className="field sel-sm !w-44" placeholder="Filtra…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-sm" onClick={() => confirm('Ripristinare tutte le scorciatoie predefinite?') && set({ shortcuts: {} })}>
          <RotateCcw size={14} /> Predefinite
        </button>
      </div>
      <p className="text-[12.5px] opacity-60 mb-3">
        Clicca su una combinazione e premi i tasti nuovi (Esc per annullare). Funzionano anche sull’iPad con la tastiera collegata. {prettyCombo('Mod+/')} mostra l’elenco ovunque.
      </p>
      {groups.map((g) => {
        const items = list.filter((s) => s.group === g)
        if (!items.length) return null
        return (
          <section key={g} className="mb-4">
            <div className="label">{g}</div>
            {items.map((s) => {
              const combo = comboOf(s.id)
              const custom = overrides[s.id] !== undefined && overrides[s.id] !== s.def
              return (
                <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-[var(--line)] text-[13.5px]">
                  <span className="flex-1 min-w-0">
                    {s.label}
                    {s.hint && <span className="opacity-45 text-[12px]"> · {s.hint}</span>}
                  </span>
                  <button className={`kbd ${rec === s.id ? 'rec' : ''}`} onClick={() => setRec(rec === s.id ? null : s.id)} title="Clicca e premi la nuova combinazione">
                    {rec === s.id ? 'Premi i tasti…' : prettyCombo(combo)}
                  </button>
                  <button className="icon-btn sm" title="Disattiva" onClick={() => set({ shortcuts: { ...overrides, [s.id]: '' } })} disabled={!combo}>
                    <X size={13} />
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Ripristina predefinita"
                    disabled={!custom}
                    onClick={() => {
                      const n = { ...overrides }
                      delete n[s.id]
                      set({ shortcuts: n })
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
