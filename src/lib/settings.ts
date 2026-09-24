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
  /** combinazioni personalizzate per le scorciatoie (id azione → combinazione, '' = disattivata) */
  shortcuts: Record<string, string>
  /** Apple Pencil sugli appunti: 'ink' = resta scrittura a mano, 'text' = Scribble di iPadOS converte in testo */
  pencilMode: 'ink' | 'text'
  set: (p: Partial<Omit<Settings, 'set'>>) => void
}

// progetto Supabase dell'app (la chiave anon è pubblica per definizione: i dati sono protetti da RLS)
export const DEFAULT_SUPABASE_URL = 'https://ufcfpxqfhvbnpunfzrea.supabase.co'
export const DEFAULT_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmY2ZweHFmaHZibnB1bmZ6cmVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDUzNzcsImV4cCI6MjEwNTgyMTM3N30.tarbWBXzwZq2-Ic5rZGC5zv9uVKi5Add6ccklHB0ZKU'

// In sviluppo la chiave arriva da .env.local; nella build pubblicata NON viene inclusa.
const devKey = import.meta.env.DEV ? ((import.meta.env.VITE_GROQ_KEY as string) ?? '') : ''

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: 'auto',
      groqKey: devKey,
      model: 'openai/gpt-oss-120b',
      visionModel: 'qwen/qwen3.8-27b',
      supabaseUrl: DEFAULT_SUPABASE_URL,
      supabaseAnon: DEFAULT_SUPABASE_ANON,
      autoLink: true,
      editorWidth: 'narrow',
      splitRatio: 0.5,
      shortcuts: {},
      pencilMode: 'ink',
      set: (p) => set(p),
    }),
    {
      name: 'ripasso:settings',
      merge: (persisted, current) => {
        const p = { ...current, ...(persisted as Partial<Settings>) }
        if (!p.groqKey && devKey) p.groqKey = devKey
        if (!p.supabaseUrl) p.supabaseUrl = DEFAULT_SUPABASE_URL
        if (!p.supabaseAnon) p.supabaseAnon = DEFAULT_SUPABASE_ANON
        return p
      },
    },
  ),
)

export const settings = () => useSettings.getState()

/** Impostazioni che viaggiano col proprio account (le altre restano per-dispositivo). */
// la chiave Groq NON viaggia: l'AI passa dal server (funzione `groq` su Supabase)
export const SYNCED_SETTINGS = ['model', 'visionModel', 'autoLink', 'shortcuts', 'pencilMode'] as const
