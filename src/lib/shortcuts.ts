import { useSettings } from './settings'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

export interface ShortcutDef {
  id: string
  label: string
  group: 'Generali' | 'Slide e appunti' | 'Disegno a mano' | 'AI'
  /** combinazione predefinita, es. "Mod+Shift+D" (Mod = ⌘ su Mac/iPad, Ctrl su Windows) */
  def: string
  hint?: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'search', label: 'Cerca negli appunti', group: 'Generali', def: 'Mod+K' },
  { id: 'help', label: 'Mostra tutte le scorciatoie', group: 'Generali', def: 'Mod+/' },
  { id: 'sidebar', label: 'Mostra/nascondi menu laterale', group: 'Generali', def: 'Mod+\\' },
  { id: 'home', label: 'Vai alla Home', group: 'Generali', def: 'Alt+0' },
  { id: 'settings', label: 'Apri Impostazioni', group: 'Generali', def: 'Mod+,' },
  { id: 'newCourse', label: 'Nuovo corso', group: 'Generali', def: 'Alt+N' },
  { id: 'summary', label: 'Apri il riassunto del corso', group: 'Generali', def: 'Alt+R' },

  { id: 'nextSlide', label: 'Slide successiva (anche mentre scrivi)', group: 'Slide e appunti', def: 'Alt+ArrowDown' },
  { id: 'prevSlide', label: 'Slide precedente (anche mentre scrivi)', group: 'Slide e appunti', def: 'Alt+ArrowUp' },
  { id: 'viewSplit', label: 'Vista divisa slide | appunti', group: 'Slide e appunti', def: 'Alt+1' },
  { id: 'viewSlides', label: 'Solo slide', group: 'Slide e appunti', def: 'Alt+2' },
  { id: 'viewNotes', label: 'Solo appunti', group: 'Slide e appunti', def: 'Alt+3' },
  { id: 'snip', label: 'Ritaglia una parte della slide', group: 'Slide e appunti', def: 'Mod+Shift+S' },
  { id: 'linkBlock', label: 'Collega il blocco alla slide aperta', group: 'Slide e appunti', def: 'Mod+Shift+L' },
  { id: 'autoLink', label: 'Attiva/disattiva collegamento automatico', group: 'Slide e appunti', def: 'Alt+L' },
  { id: 'examBox', label: 'Riquadro “Da sapere per l’esame”', group: 'Slide e appunti', def: 'Mod+Shift+E' },
  { id: 'terminal', label: 'Inserisci terminale Linux', group: 'Slide e appunti', def: 'Mod+Alt+T' },
  { id: 'codeBlock', label: 'Inserisci blocco di codice', group: 'Slide e appunti', def: 'Mod+Alt+C' },
  { id: 'markDone', label: 'Segna l’unità come studiata', group: 'Slide e appunti', def: 'Alt+D' },
  { id: 'zoomIn', label: 'Ingrandisci slide', group: 'Slide e appunti', def: 'Alt+=' },
  { id: 'zoomOut', label: 'Riduci slide', group: 'Slide e appunti', def: 'Alt+-' },

  { id: 'draw', label: 'Matita: scrivi a mano sugli appunti (attiva/disattiva)', group: 'Disegno a mano', def: 'Mod+Shift+D' },
  { id: 'pencilMode', label: 'Apple Pencil: a mano ↔ testo (Scribble)', group: 'Disegno a mano', def: 'Alt+T' },
  { id: 'drawFormula', label: 'Converti la scrittura a mano in formula', group: 'Disegno a mano', def: 'Mod+Shift+F', hint: 'con la matita attiva' },
  { id: 'toolPen', label: 'Penna', group: 'Disegno a mano', def: 'Alt+P', hint: 'mentre disegni' },
  { id: 'toolHl', label: 'Evidenziatore', group: 'Disegno a mano', def: 'Alt+H', hint: 'mentre disegni' },
  { id: 'toolEraser', label: 'Gomma', group: 'Disegno a mano', def: 'Alt+E', hint: 'mentre disegni' },
  { id: 'drawFull', label: 'Foglio da disegno a schermo intero', group: 'Disegno a mano', def: 'Alt+F', hint: 'nel foglio da disegno' },
  { id: 'drawDone', label: 'Fine matita / fine disegno', group: 'Disegno a mano', def: 'Escape', hint: 'mentre disegni' },
  { id: 'toLatex', label: 'Converti la scrittura a mano in testo', group: 'Disegno a mano', def: 'Alt+M', hint: 'mentre disegni' },

  { id: 'aiChat', label: 'Apri/chiudi chat AI', group: 'AI', def: 'Mod+J' },
  { id: 'aiNotes', label: 'Appunti AI dalla slide aperta', group: 'AI', def: 'Mod+Alt+A' },
  { id: 'aiExplain', label: 'Spiegami la slide aperta', group: 'AI', def: 'Mod+Shift+X' },
  { id: 'handwriting', label: 'Scrittura a mano → testo (pagina aperta)', group: 'AI', def: 'Mod+Alt+H' },
]

export const comboOf = (id: string) => {
  const o = useSettings.getState().shortcuts?.[id]
  return o !== undefined ? o : (SHORTCUTS.find((s) => s.id === id)?.def ?? '')
}

/** Tasto "fisico" normalizzato (su Mac Option+P produce "π": usiamo event.code). */
function keyName(e: KeyboardEvent) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  const map: Record<string, string> = { Equal: '=', Minus: '-', Slash: '/', Backslash: '\\', Comma: ',', Period: '.', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'Space', Enter: 'Enter' }
  if (map[e.code]) return map[e.code]
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(e.key)) return null
  const parts: string[] = []
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod) parts.push('Mod')
  if (isMac && e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(keyName(e))
  return parts.join('+')
}

export function prettyCombo(c: string) {
  if (!c) return '—'
  return c
    .split('+')
    .map((p) =>
      isMac
        ? ({ Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: '↩' } as Record<string, string>)[p] ?? p
        : ({ Mod: 'Ctrl', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' } as Record<string, string>)[p] ?? p,
    )
    .join(isMac ? '' : '+')
}

// ------- registro delle azioni: i componenti si registrano quando sono visibili -------
type Handler = () => void
const handlers = new Map<string, Handler[]>()

export function registerShortcut(id: string, fn: Handler) {
  const list = handlers.get(id) ?? []
  list.push(fn)
  handlers.set(id, list)
  return () => {
    const l = handlers.get(id) ?? []
    handlers.set(
      id,
      l.filter((f) => f !== fn),
    )
  }
}

export function registerShortcuts(map: Record<string, Handler>) {
  const offs = Object.entries(map).map(([id, fn]) => registerShortcut(id, fn))
  return () => offs.forEach((o) => o())
}

/** true mentre si sta registrando una nuova combinazione nelle Impostazioni */
export const recording = { on: false }

let installed = false
export function installShortcuts() {
  if (installed) return
  installed = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (recording.on) return
      const combo = comboFromEvent(e)
      if (!combo) return
      // ultimo registrato = il più "vicino" (es. disegno attivo prima della pagina)
      for (const s of SHORTCUTS) {
        if (comboOf(s.id) !== combo) continue
        const list = handlers.get(s.id)
        if (!list?.length) continue
        e.preventDefault()
        e.stopPropagation()
        list[list.length - 1]()
        return
      }
    },
    true,
  )
}

/** Conflitti: altre azioni con la stessa combinazione */
export function conflicts(id: string, combo: string) {
  if (!combo) return []
  return SHORTCUTS.filter((s) => s.id !== id && comboOf(s.id) === combo)
}
