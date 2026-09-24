import { create } from 'zustand'

interface UIState {
  sidebar: boolean
  search: boolean
  help: boolean
  newCourse: boolean
  setHelp: (b: boolean) => void
  setNewCourse: (b: boolean) => void
  setSidebar: (b: boolean) => void
  setSearch: (b: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  sidebar: typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
  search: false,
  help: false,
  newCourse: false,
  setHelp: (help) => set({ help }),
  setNewCourse: (newCourse) => set({ newCourse }),
  setSidebar: (sidebar) => set({ sidebar }),
  setSearch: (search) => set({ search }),
}))
