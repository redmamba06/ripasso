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
    toast(next === 'ink' ? 'Apple Pencil: your writing stays handwritten' : 'Apple Pencil: your writing becomes text (Scribble)', 'info')
  }
  return (
    <button
      className={`btn btn-sm ${compact ? '' : 'pencil-mode'}`}
      onClick={flip}
      title={mode === 'ink' ? 'Apple Pencil: writing stays handwritten. Click to convert to text (Scribble)' : 'Apple Pencil: writing is converted to text. Click to keep it handwritten'}
    >
      {mode === 'ink' ? <PenLine size={15} /> : <CaseSensitive size={16} />}
      <span className={compact ? '' : 'hidden xl:inline'}>{mode === 'ink' ? 'Pencil: ink' : 'Pencil: text'}</span>
    </button>
  )
}
