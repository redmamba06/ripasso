import type { Editor, JSONContent } from '@tiptap/react'
import { db, put, alive, type FileRec, type Note } from './db'
import { getBlob } from './sync'
import { pdfFromBlob, pageText } from './pdf'
import { encodeRef, decodeRef } from './viewer'
import { NO_AUTOLINK } from '../editor/SlideLink'

const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  )

function sim(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 0.5 // pagine senza testo (solo immagini): neutre
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

async function pagesWords(blob: Blob, onP?: (s: string) => void, label = '') {
  const doc = await pdfFromBlob(blob)
  const out: Set<string>[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    if (p % 10 === 1) onP?.(`${label} pagina ${p}/${doc.numPages}…`)
    out.push(words(await pageText(doc, p)))
  }
  void doc.cleanup()
  return out
}

/**
 * Allinea le pagine della versione vecchia a quelle nuove mantenendo l'ordine
 * (come un "diff": slide aggiunte o tolte in mezzo non spostano le altre).
 * Restituisce vecchia pagina → nuova pagina.
 */
export function alignPages(oldP: Set<string>[], newP: Set<string>[]): Map<number, number> {
  const m = oldP.length,
    n = newP.length
  const S = (i: number, j: number) => sim(oldP[i], newP[j])
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const s = S(i - 1, j - 1)
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s >= 0.3 ? dp[i - 1][j - 1] + s : -Infinity)
    }
  const map = new Map<number, number>()
  let i = m,
    j = n
  while (i > 0 && j > 0) {
    const s = S(i - 1, j - 1)
    if (s >= 0.3 && dp[i][j] === dp[i - 1][j - 1] + s) {
      map.set(i, j)
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  // pagine vecchie senza corrispondenza: restano vicino alla pagina precedente abbinata
  let lastOld = 0,
    lastNew = 0
  for (let k = 1; k <= m; k++) {
    if (map.has(k)) {
      lastOld = k
      lastNew = map.get(k)!
    } else map.set(k, Math.min(n, Math.max(1, lastNew + (k - lastOld))))
  }
  return map
}

function remapDoc(doc: JSONContent | null, fileId: string, map: Map<number, number>): { doc: JSONContent | null; changed: number } {
  if (!doc?.content) return { doc, changed: 0 }
  let changed = 0
  const content = doc.content.map((b) => {
    const d = decodeRef(b.attrs?.slide)
    if (!d || d.fileId !== fileId) return b
    const np = map.get(d.page) ?? d.page
    if (np === d.page) return b
    changed++
    return { ...b, attrs: { ...b.attrs, slide: encodeRef(fileId, np) } }
  })
  return { doc: { ...doc, content }, changed }
}

export interface ReplaceResult {
  oldPages: number
  newPages: number
  moved: number
}

/**
 * Sostituisce il PDF con una versione aggiornata (es. slide annotate a lezione)
 * mantenendo lo stesso file: appunti, scrittura a mano e collegamenti restano.
 */
export async function replaceFile(rec: FileRec, file: File, opts: { editor?: Editor | null; openNoteId?: string; onProgress?: (s: string) => void } = {}): Promise<ReplaceResult> {
  const onP = opts.onProgress
  onP?.('Leggo la versione attuale…')
  const oldBlob = await getBlob(rec.id)
  const newWords = await pagesWords(file, onP, 'Nuova versione:')
  let map = new Map<number, number>()
  let oldPages = rec.pageCount ?? 0
  if (oldBlob) {
    const oldWords = await pagesWords(oldBlob, onP, 'Versione attuale:')
    oldPages = oldWords.length
    onP?.('Confronto le pagine…')
    map = alignPages(oldWords, newWords)
  }

  const rev = (rec.rev ?? 0) + 1
  await db.blobs.put({ id: rec.id, blob: file, rev })
  await put<FileRec>('files', { ...rec, size: file.size, pageCount: newWords.length, rev, uploaded: 0 })

  // collegamenti alle slide negli appunti del corso
  let moved = 0
  const identity = [...map].every(([a, b]) => a === b)
  if (map.size && !identity) {
    onP?.('Aggiorno i collegamenti alle slide…')
    const notes = alive(await db.notes.where('courseId').equals(rec.courseId).toArray())
    for (const n of notes) {
      if (n.id === opts.openNoteId && opts.editor && !opts.editor.isDestroyed) {
        // nota aperta: si aggiorna direttamente l'editor (che poi la salva)
        const ed = opts.editor
        const chain = ed.chain().setMeta(NO_AUTOLINK, true)
        ed.state.doc.forEach((node, offset) => {
          const d = decodeRef(node.attrs?.slide)
          if (!d || d.fileId !== rec.id) return
          const np = map.get(d.page) ?? d.page
          if (np !== d.page) {
            chain.setBlockSlide(offset, encodeRef(rec.id, np))
            moved++
          }
        })
        chain.run()
        continue
      }
      const r = remapDoc(n.doc, rec.id, map)
      if (r.changed) {
        moved += r.changed
        await put<Note>('notes', { ...n, doc: r.doc })
      }
    }
  }
  // ultima pagina vista: riportata sulla nuova numerazione
  const last = parseInt(localStorage.getItem('ripasso:lastpage:' + rec.id) ?? '0', 10)
  if (last && map.get(last)) localStorage.setItem('ripasso:lastpage:' + rec.id, String(map.get(last)))
  return { oldPages, newPages: newWords.length, moved }
}
