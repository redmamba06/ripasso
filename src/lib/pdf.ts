import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getBlob } from './sync'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const cache = new Map<string, Promise<PDFDocumentProxy>>()

export function loadPdf(fileId: string): Promise<PDFDocumentProxy> {
  if (!cache.has(fileId)) {
    const p = (async () => {
      const blob = await getBlob(fileId)
      if (!blob) throw new Error('File non disponibile su questo dispositivo (accedi per scaricarlo dal cloud).')
      const data = new Uint8Array(await blob.arrayBuffer())
      return pdfjs.getDocument({ data }).promise
    })()
    p.catch(() => cache.delete(fileId))
    cache.set(fileId, p)
  }
  return cache.get(fileId)!
}

export async function pdfFromBlob(blob: Blob) {
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
}

/** Testo di una pagina ricostruito per righe (utile all'AI). */
export async function pageText(doc: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await doc.getPage(pageNum)
  const tc = await page.getTextContent()
  const rows: { y: number; parts: { x: number; s: string }[] }[] = []
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue
    const x = it.transform[4]
    const y = Math.round(it.transform[5])
    let row = rows.find((r) => Math.abs(r.y - y) < 4)
    if (!row) rows.push((row = { y, parts: [] }))
    row.parts.push({ x, s: it.str })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n')
}

export async function renderPageToCanvas(doc: PDFDocumentProxy, pageNum: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum)
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  await page.render({ canvas, viewport: vp }).promise
  return canvas
}

/** Immagine JPEG (dataURL) di una pagina, larghezza massima `maxW` px — per l'AI con visione. */
export async function pageImage(doc: PDFDocumentProxy, pageNum: number, maxW = 1100): Promise<string> {
  const page = await doc.getPage(pageNum)
  const vp1 = page.getViewport({ scale: 1 })
  const canvas = await renderPageToCanvas(doc, pageNum, Math.min(2.5, maxW / vp1.width))
  return canvas.toDataURL('image/jpeg', 0.82)
}

export async function pageCount(blob: Blob) {
  try {
    const d = await pdfFromBlob(blob)
    const n = d.numPages
    void d.cleanup()
    return n
  } catch {
    return undefined
  }
}
