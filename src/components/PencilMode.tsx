import { PenLine, CaseSensitive } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { toast } from './Toast'

/** Sceglie cosa fa la Apple Pencil sugli appunti: lascia la scrittura a mano o la converte in testo (Scribble). */
export function PencilModeToggle({ compact }: { compact?: boolean }) {
  const mode = useSettings((s) => s.pencilMode)
  const set = useSettings((s) => s.set)
  const flip = () => {
    const next = mode === 'ink' ? 'text' : 'ink'
    set({ pencilMode: next })
    toast(next === 'ink' ? 'Apple Pencil: la scrittura resta a mano' : 'Apple Pencil: la scrittura diventa testo (Scribble)', 'info')
  }
  return (
    <button
      className={`btn btn-sm ${compact ? '' : 'pencil-mode'}`}
      onClick={flip}
      title={mode === 'ink' ? 'Apple Pencil: la scrittura resta a mano. Clic per convertire in testo (Scribble)' : 'Apple Pencil: la scrittura viene convertita in testo. Clic per lasciarla a mano'}
    >
      {mode === 'ink' ? <PenLine size={15} /> : <CaseSensitive size={16} />}
      <span className={compact ? '' : 'hidden xl:inline'}>{mode === 'ink' ? 'Pencil: a mano' : 'Pencil: testo'}</span>
    </button>
  )
}
