import { create } from 'zustand'

interface UIState {
  sidebar: boolean
  search: boolean
  setSidebar: (b: boolean) => void
  setSearch: (b: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  sidebar: typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
  search: false,
  setSidebar: (sidebar) => set({ sidebar }),
  setSearch: (search) => set({ search }),
}))
