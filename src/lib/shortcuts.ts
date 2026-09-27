import { useSettings } from './settings'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

export interface ShortcutDef {
  id: string
  label: string
  group: 'General' | 'Slides & notes' | 'Handwriting' | 'AI'
  /** combinazione predefinita, es. "Mod+Shift+D" (Mod = ⌘ su Mac/iPad, Ctrl su Windows) */
  def: string
  hint?: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'search', label: 'Search your notes', group: 'General', def: 'Mod+K' },
  { id: 'help', label: 'Show all shortcuts', group: 'General', def: 'Mod+/' },
  { id: 'sidebar', label: 'Show/hide sidebar', group: 'General', def: 'Mod+\\' },
  { id: 'home', label: 'Go to Home', group: 'General', def: 'Alt+0' },
  { id: 'settings', label: 'Open Settings', group: 'General', def: 'Mod+,' },
  { id: 'newCourse', label: 'New course', group: 'General', def: 'Alt+N' },
  { id: 'summary', label: 'Open the course summary', group: 'General', def: 'Alt+R' },

  { id: 'nextSlide', label: 'Next slide (even while typing)', group: 'Slides & notes', def: 'Alt+ArrowDown' },
  { id: 'prevSlide', label: 'Previous slide (even while typing)', group: 'Slides & notes', def: 'Alt+ArrowUp' },
  { id: 'viewSplit', label: 'Split view slides | notes', group: 'Slides & notes', def: 'Alt+1' },
  { id: 'viewSlides', label: 'Slides only', group: 'Slides & notes', def: 'Alt+2' },
  { id: 'viewNotes', label: 'Notes only', group: 'Slides & notes', def: 'Alt+3' },
  { id: 'snip', label: 'Snip part of the slide', group: 'Slides & notes', def: 'Mod+Shift+S' },
  { id: 'linkBlock', label: 'Link the block to the open slide', group: 'Slides & notes', def: 'Mod+Shift+L' },
  { id: 'autoLink', label: 'Toggle auto-link', group: 'Slides & notes', def: 'Alt+L' },
  { id: 'examBox', label: '“Exam must-know” box', group: 'Slides & notes', def: 'Mod+Shift+E' },
  { id: 'terminal', label: 'Insert Linux terminal', group: 'Slides & notes', def: 'Mod+Alt+T' },
  { id: 'codeBlock', label: 'Insert code block', group: 'Slides & notes', def: 'Mod+Alt+C' },
  { id: 'markDone', label: 'Mark unit as studied', group: 'Slides & notes', def: 'Alt+D' },
  { id: 'zoomIn', label: 'Zoom in on slides', group: 'Slides & notes', def: 'Alt+=' },
  { id: 'zoomOut', label: 'Zoom out of slides', group: 'Slides & notes', def: 'Alt+-' },

  { id: 'draw', label: 'Pencil: write by hand on your notes (on/off)', group: 'Handwriting', def: 'Mod+Shift+D' },
  { id: 'pencilMode', label: 'Apple Pencil: handwriting ↔ text (Scribble)', group: 'Handwriting', def: 'Alt+T' },
  { id: 'drawFormula', label: 'Convert handwriting to a formula', group: 'Handwriting', def: 'Mod+Shift+F', hint: 'with the pencil on' },
  { id: 'toolPen', label: 'Pen', group: 'Handwriting', def: 'Alt+P', hint: 'while drawing' },
  { id: 'toolHl', label: 'Highlighter', group: 'Handwriting', def: 'Alt+H', hint: 'while drawing' },
  { id: 'toolEraser', label: 'Eraser', group: 'Handwriting', def: 'Alt+E', hint: 'while drawing' },
  { id: 'drawFull', label: 'Drawing sheet full screen', group: 'Handwriting', def: 'Alt+F', hint: 'in a drawing sheet' },
  { id: 'drawDone', label: 'Finish pencil / drawing', group: 'Handwriting', def: 'Escape', hint: 'while drawing' },
  { id: 'toLatex', label: 'Convert handwriting to text', group: 'Handwriting', def: 'Alt+M', hint: 'while drawing' },

  { id: 'aiChat', label: 'Open/close AI chat', group: 'AI', def: 'Mod+J' },
  { id: 'aiNotes', label: 'AI notes from the open slide', group: 'AI', def: 'Mod+Alt+A' },
  { id: 'aiExplain', label: 'Explain the open slide', group: 'AI', def: 'Mod+Shift+X' },
  { id: 'handwriting', label: 'Handwriting → text (open page)', group: 'AI', def: 'Mod+Alt+H' },
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
