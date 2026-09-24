import type { Editor } from '@tiptap/react'

/** Collegamento tra l'editor e la pagina che lo ospita (slide aperta, AI, ritaglio…). */
export interface EditorBridge {
  courseId: string
  unitId?: string
  startSnip?: () => void
  aiFromSlide?: (mode: 'notes' | 'explain' | 'questions') => void
  askAi?: (text: string) => void
  pickImage?: () => void
  startInk?: () => void
}

export const bridge: { current: EditorBridge | null; editor: Editor | null } = { current: null, editor: null }
