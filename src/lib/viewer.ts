import { create } from 'zustand'

interface ViewerState {
  fileId: string | null
  page: number
  numPages: number
  /** incrementato ad ogni richiesta di salto, così il viewer scorre anche se la pagina è la stessa */
  gotoSeq: number
  gotoPage: number
  snipping: boolean
  setOpen: (fileId: string | null) => void
  setPage: (p: number) => void
  setNumPages: (n: number) => void
  goto: (fileId: string, page: number) => void
  setSnipping: (b: boolean) => void
}

export const useViewer = create<ViewerState>((set) => ({
  fileId: null,
  page: 1,
  numPages: 0,
  gotoSeq: 0,
  gotoPage: 1,
  snipping: false,
  setOpen: (fileId) => set({ fileId, page: 1, numPages: 0 }),
  setPage: (page) => set({ page }),
  setNumPages: (numPages) => set({ numPages }),
  goto: (fileId, page) => set((s) => ({ fileId, gotoPage: page, gotoSeq: s.gotoSeq + 1 })),
  setSnipping: (snipping) => set({ snipping }),
}))

/** Riferimento a una slide salvato nei blocchi degli appunti: "fileId:pagina" */
export const encodeRef = (fileId: string, page: number) => `${fileId}:${page}`
export function decodeRef(ref: string | null | undefined): { fileId: string; page: number } | null {
  if (!ref || ref === 'none') return null
  const i = ref.lastIndexOf(':')
  if (i < 0) return null
  const page = parseInt(ref.slice(i + 1), 10)
  if (!page) return null
  return { fileId: ref.slice(0, i), page }
}

/** Snapshot corrente usato dal plugin di collegamento automatico. */
export function currentRef(): string | null {
  const { fileId, page } = useViewer.getState()
  return fileId ? encodeRef(fileId, page) : null
}
