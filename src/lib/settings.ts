import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'auto' | 'light' | 'dark'

export interface Settings {
  theme: Theme
  groqKey: string
  model: string
  visionModel: string
  supabaseUrl: string
  supabaseAnon: string
  autoLink: boolean
  editorWidth: 'narrow' | 'wide'
  splitRatio: number
  set: (p: Partial<Omit<Settings, 'set'>>) => void
}

// In sviluppo la chiave arriva da .env.local; nella build pubblicata NON viene inclusa
// (va incollata in Impostazioni e poi si sincronizza col proprio account).
const devKey = import.meta.env.DEV ? ((import.meta.env.VITE_GROQ_KEY as string) ?? '') : ''

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: 'auto',
      groqKey: devKey,
      model: 'openai/gpt-oss-120b',
      visionModel: 'qwen/qwen3.8-27b',
      supabaseUrl: '',
      supabaseAnon: '',
      autoLink: true,
      editorWidth: 'narrow',
      splitRatio: 0.5,
      set: (p) => set(p),
    }),
    {
      name: 'ripasso:settings',
      merge: (persisted, current) => {
        const p = { ...current, ...(persisted as Partial<Settings>) }
        if (!p.groqKey && devKey) p.groqKey = devKey
        return p
      },
    },
  ),
)

export const settings = () => useSettings.getState()

/** Impostazioni che viaggiano col proprio account (le altre restano per-dispositivo). */
export const SYNCED_SETTINGS = ['groqKey', 'model', 'visionModel', 'autoLink'] as const
