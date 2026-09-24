import { create } from 'zustand'

/** Tratto a mano ancorato a un blocco degli appunti. Coordinate in unità (foglio largo 800). */
export interface InkStroke {
  id: string
  /** bid del blocco a cui è ancorato */
  b: string
  t: 'pen' | 'hl'
  c: string
  w: number
  /** x, y, pressione ripetuti — y relativa all'inizio dello spazio del blocco */
  p: number[]
  /** 1 = disegnato nel vuoto: il blocco scende per fargli spazio */
  sp?: 1
}

export type InkTool = 'pen' | 'hl' | 'eraser'

interface InkUI {
  active: boolean
  tool: InkTool
  color: string
  hl: string
  size: number
  setActive: (b: boolean) => void
  set: (p: Partial<Omit<InkUI, 'set' | 'setActive'>>) => void
}

export const INK_COLORS = ['#1f1f24', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c']
export const INK_HL = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd']
export const INK_SIZES = [2.2, 3.4, 5.5]
export const PAGE_UNITS = 800

export const useInk = create<InkUI>((set) => ({
  active: false,
  tool: 'pen',
  color: INK_COLORS[0],
  hl: INK_HL[0],
  size: 1,
  setActive: (active) => set({ active }),
  set: (p) => set(p),
}))

/** Spazio necessario sopra ogni blocco, derivato dai tratti "nel vuoto". */
export function spacesFrom(strokes: InkStroke[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of strokes) {
    if (!s.sp) continue
    let maxY = 0
    for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i])
    const need = maxY + s.w + 14
    out[s.b] = Math.max(out[s.b] ?? 0, need)
  }
  return out
}
