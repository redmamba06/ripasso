import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Crop, Maximize2, Loader2, X, PenLine } from 'lucide-react'
import { loadPdf, renderPageToCanvas } from '../lib/pdf'
import { useViewer } from '../lib/viewer'
import { registerShortcuts } from '../lib/shortcuts'

interface Props {
  fileId: string
  onSnip: (blob: Blob, page: number) => void
  onTranscribe?: (pages: number[]) => void
  transcribing?: boolean
}

export function PdfViewer({ fileId, onSnip, onTranscribe, transcribing }: Props) {
  const [tMenu, setTMenu] = useState(false)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ratio, setRatio] = useState(0.5625) // h/w della prima pagina
  const [width, setWidth] = useState(600)
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const { page, numPages, gotoSeq, gotoPage, snipping } = useViewer()
  const setPage = useViewer((s) => s.setPage)
  const [pageInput, setPageInput] = useState('1')
  const [flash, setFlash] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setDoc(null)
    setErr(null)
    loadPdf(fileId)
      .then(async (d) => {
        if (!alive) return
        const p1 = await d.getPage(1)
        const vp = p1.getViewport({ scale: 1 })
        setRatio(vp.height / vp.width)
        setDoc(d)
        useViewer.getState().setNumPages(d.numPages)
        // ripristina ultima pagina vista
        const last = parseInt(localStorage.getItem('ripasso:lastpage:' + fileId) ?? '1', 10)
        const st = useViewer.getState()
        const target = st.gotoSeq > 0 && st.fileId === fileId ? st.gotoPage : last
        requestAnimationFrame(() => scrollToPage(target, false))
      })
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32))
    ro.observe(el)
    setWidth(el.clientWidth - 32)
    return () => ro.disconnect()
  }, [])

  const pageW = Math.max(200, width * zoom)
  const pageH = pageW * ratio

  const scrollToPage = useCallback((p: number, smooth = true) => {
    const el = pagesRef.current?.querySelector<HTMLElement>(`[data-page="${p}"]`)
    if (!el || !scroller.current) return
    scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // salto richiesto dagli appunti
  useEffect(() => {
    if (!gotoSeq || !doc) return
    const st = useViewer.getState()
    if (st.fileId !== fileId) return
    scrollToPage(gotoPage)
    setFlash(gotoPage)
    const t = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(t)
  }, [gotoSeq, doc, fileId, gotoPage, scrollToPage])

  useEffect(() => setPageInput(String(page)), [page])

  const onScroll = () => {
    const el = scroller.current
    if (!el || !doc) return
    // in fondo al documento l'ultima pagina non può salire in alto: la consideriamo aperta
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4 && doc.numPages > 0) {
      if (useViewer.getState().page !== doc.numPages && Date.now() - lastGo.current > 700) setPage(doc.numPages)
      return
    }
    if (Date.now() - lastGo.current < 700) return
    const probe = el.scrollTop + el.clientHeight * 0.35
    const kids = pagesRef.current?.children ?? []
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i] as HTMLElement
      if (k.offsetTop + k.offsetHeight > probe) {
        const p = i + 1
        if (p !== useViewer.getState().page) {
          setPage(p)
          localStorage.setItem('ripasso:lastpage:' + fileId, String(p))
        }
        break
      }
    }
  }

  const lastGo = useRef(0)
  const go = (p: number) => {
    const n = Math.min(Math.max(1, p), useViewer.getState().numPages || 1)
    lastGo.current = Date.now()
    setPage(n)
    localStorage.setItem('ripasso:lastpage:' + fileId, String(n))
    scrollToPage(n)
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.closest?.('.ProseMirror, input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(useViewer.getState().page + 1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(useViewer.getState().page - 1)
      if (e.key === 'Escape') useViewer.getState().setSnipping(false)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const goRef = useRef(go)
  goRef.current = go
  useEffect(
    () =>
      registerShortcuts({
        nextSlide: () => goRef.current(useViewer.getState().page + 1),
        prevSlide: () => goRef.current(useViewer.getState().page - 1),
        zoomIn: () => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2))),
        zoomOut: () => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2))),
        snip: () => useViewer.getState().setSnipping(!useViewer.getState().snipping),
        handwriting: () => onTranscribe?.([useViewer.getState().page]),
      }),
    [onTranscribe],
  )

  // ---------- ritaglio ----------
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [snipBusy, setSnipBusy] = useState(false)
  const pt = (e: React.PointerEvent) => {
    const r = pagesRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const p = pt(e)
    setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const move = (e: React.PointerEvent) => {
    if (!sel) return
    const p = pt(e)
    setSel({ ...sel, x1: p.x, y1: p.y })
  }
  const up = async () => {
    if (!sel || !doc) return
    const x = Math.min(sel.x0, sel.x1)
    const y = Math.min(sel.y0, sel.y1)
    const w = Math.abs(sel.x1 - sel.x0)
    const h = Math.abs(sel.y1 - sel.y0)
    setSel(null)
    if (w < 8 || h < 8) return
    // pagina con la maggiore sovrapposizione
    let best: { el: HTMLElement; area: number } | null = null
    for (const k of Array.from(pagesRef.current!.querySelectorAll<HTMLElement>(":scope > [data-page]"))) {
      const ox = Math.max(0, Math.min(x + w, k.offsetLeft + k.offsetWidth) - Math.max(x, k.offsetLeft))
      const oy = Math.max(0, Math.min(y + h, k.offsetTop + k.offsetHeight) - Math.max(y, k.offsetTop))
      if (ox * oy > (best?.area ?? 0)) best = { el: k, area: ox * oy }
    }
    if (!best) return
    const pnum = parseInt(best.el.dataset.page!, 10)
    const el = best.el
    setSnipBusy(true)
    try {
      const pg = await doc.getPage(pnum)
      const vp1 = pg.getViewport({ scale: 1 })
      const hiScale = Math.min(4, 2600 / vp1.width)
      const canvas = await renderPageToCanvas(doc, pnum, hiScale)
      const fx = canvas.width / el.offsetWidth
      const fy = canvas.height / el.offsetHeight
      const cx = Math.max(0, (x - el.offsetLeft) * fx)
      const cy = Math.max(0, (y - el.offsetTop) * fy)
      const cw = Math.min(canvas.width - cx, w * fx)
      const ch = Math.min(canvas.height - cy, h * fy)
      const out = document.createElement('canvas')
      out.width = Math.round(cw)
      out.height = Math.round(ch)
      out.getContext('2d')!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch)
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
      if (blob) onSnip(blob, pnum)
    } finally {
      setSnipBusy(false)
      useViewer.getState().setSnipping(false)
    }
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="icon-btn sm" onClick={() => go(page - 1)} disabled={page <= 1} title="Pagina precedente (←)">
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1 text-[13px]">
          <input
            className="page-input"
            value={pageInput}
            inputMode="numeric"
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && go(parseInt(pageInput || '1', 10))}
            onBlur={() => setPageInput(String(page))}
          />
          <span className="opacity-50">/ {numPages || '–'}</span>
        </div>
        <button className="icon-btn sm" onClick={() => go(page + 1)} disabled={page >= numPages} title="Pagina successiva (→)">
          <ChevronRight size={16} />
        </button>
        <span className="flex-1" />
        <button className="icon-btn sm" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))} title="Riduci">
          <ZoomOut size={16} />
        </button>
        <button className="icon-btn sm text-[11px] w-auto px-1.5" onClick={() => setZoom(1)} title="Adatta alla larghezza">
          {zoom === 1 ? <Maximize2 size={14} /> : Math.round(zoom * 100) + '%'}
        </button>
        <button className="icon-btn sm" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} title="Ingrandisci">
          <ZoomIn size={16} />
        </button>
        {onTranscribe && (
          <div className="relative">
            <button className="btn btn-sm" disabled={transcribing} onClick={() => setTMenu(!tMenu)} title="Trasforma in testo gli appunti scritti a mano su questa slide">
              {transcribing ? <Loader2 size={15} className="spin" /> : <PenLine size={15} />} <span className="hidden xl:inline">A mano → testo</span>
            </button>
            {tMenu && (
              <div className="menu glass-strong" onMouseLeave={() => setTMenu(false)}>
                <button
                  onClick={() => {
                    setTMenu(false)
                    onTranscribe([page])
                  }}
                >
                  Trascrivi questa pagina ({page})
                </button>
                <button
                  onClick={() => {
                    setTMenu(false)
                    onTranscribe(Array.from({ length: numPages }, (_, i) => i + 1))
                  }}
                >
                  Trascrivi tutte le pagine ({numPages})
                </button>
                <div className="menu-hint">Riconosce solo ciò che hai scritto a mano (non il testo stampato) e lo inserisce negli appunti collegato alla pagina.</div>
              </div>
            )}
          </div>
        )}
        <button className={`btn btn-sm ${snipping ? 'btn-primary' : ''}`} onClick={() => useViewer.getState().setSnipping(!snipping)} title="Ritaglia una parte della slide negli appunti">
          {snipping ? <X size={15} /> : <Crop size={15} />} <span className="hidden lg:inline">{snipping ? 'Annulla' : 'Ritaglia'}</span>
        </button>
      </div>
      {snipping && <div className="snip-hint">Trascina per selezionare la parte della slide da inserire negli appunti · Esc per annullare</div>}
      <div className="pdf-scroll" ref={scroller} onScroll={onScroll}>
        {err && <div className="empty m-4">{err}</div>}
        {!doc && !err && (
          <div className="flex justify-center p-10">
            <Loader2 className="spin opacity-50" />
          </div>
        )}
        {doc && (
          <div className="pdf-pages" ref={pagesRef} style={{ width: pageW }}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} num={i + 1} width={pageW} height={pageH} flash={flash === i + 1} />
            ))}
            {snipping && (
              <div className="snip-layer" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
                {sel && (
                  <div
                    className="snip-rect"
                    style={{ left: Math.min(sel.x0, sel.x1), top: Math.min(sel.y0, sel.y1), width: Math.abs(sel.x1 - sel.x0), height: Math.abs(sel.y1 - sel.y0) }}
                  />
                )}
              </div>
            )}
            {snipBusy && (
              <div className="snip-busy">
                <Loader2 className="spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PdfPage({ doc, num, width, height, flash }: { doc: PDFDocumentProxy; num: number; width: number; height: number; flash: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [h, setH] = useState(height)
  useEffect(() => setH(height), [height])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { cancel: () => void } | null = null
    let tl: TextLayer | null = null
    const el = box.current!
    ;(async () => {
      const page = await doc.getPage(num)
      if (cancelled) return
      const vp1 = page.getViewport({ scale: 1 })
      const scale = width / vp1.width
      const vp = page.getViewport({ scale })
      setH(vp.height)
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = vp.width + 'px'
      canvas.style.height = vp.height + 'px'
      const rt = page.render({ canvas, viewport: page.getViewport({ scale: scale * dpr }) })
      task = rt
      try {
        await rt.promise
      } catch {
        return
      }
      if (cancelled) return
      el.querySelector('canvas')?.remove()
      el.querySelector('.textLayer')?.remove()
      el.prepend(canvas)
      const div = document.createElement('div')
      div.className = 'textLayer'
      el.appendChild(div)
      div.style.setProperty('--scale-factor', String(scale))
      tl = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport: vp })
      try {
        await tl.render()
      } catch {
        /* */
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      tl?.cancel()
    }
  }, [visible, doc, num, width])

  return (
    <div ref={box} className={`pdf-page ${flash ? 'flash' : ''}`} data-page={num} style={{ width, height: h }}>
      <span className="page-num">{num}</span>
    </div>
  )
}
