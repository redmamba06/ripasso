import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pen, Highlighter, Eraser, Undo2, Redo2, Trash2, Maximize2, Minimize2, Sigma, Type, Check, GripVertical, Loader2, Grid3x3, Rows3, Square, PencilLine } from 'lucide-react'
import { chat } from '../lib/groq'
import { settings } from '../lib/settings'
import { toast } from '../components/Toast'
import { mdToHtml } from '../lib/markdown'

/** Tratto vettoriale: coordinate in uno spazio logico largo 1000 unità. */
export interface Stroke {
  t: 'pen' | 'hl'
  c: string
  w: number
  p: number[] // x,y,pressione ripetuti
}

const W = 1000
const COLORS = ['#1f1f24', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c']
const HL_COLORS = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd']
const SIZES = [2, 3.5, 6]

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawing: { insertDrawing: (opts?: { height?: number; bg?: string }) => ReturnType }
  }
}

// l'utente usa la Pencil? da quel momento le dita non disegnano (palm rejection)
let penSeen = false
// blocco appena inserito: si apre subito in modalità disegno
let autoEditNext = false

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number) {
  for (const s of strokes) drawStroke(ctx, s, scale)
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number, from = 0) {
  const p = s.p
  const n = p.length / 3
  if (!n) return
  ctx.save()
  ctx.lineCap = s.t === 'hl' ? 'butt' : 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = s.c
  ctx.fillStyle = s.c
  if (s.t === 'hl') ctx.globalAlpha = 0.38
  if (n === 1) {
    ctx.beginPath()
    ctx.arc(p[0] * scale, p[1] * scale, (s.w * scale * (0.5 + p[2])) / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  if (s.t === 'hl') {
    // evidenziatore: tratto unico a larghezza costante (niente sovrapposizioni più scure)
    ctx.lineWidth = s.w * scale
    ctx.beginPath()
    ctx.moveTo(p[0] * scale, p[1] * scale)
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3] * scale, p[i * 3 + 1] * scale)
    ctx.stroke()
    ctx.restore()
    return
  }
  // penna: segmenti curvi con spessore che segue la pressione
  for (let i = Math.max(1, from); i < n; i++) {
    const x0 = p[(i - 1) * 3],
      y0 = p[(i - 1) * 3 + 1]
    const x1 = p[i * 3],
      y1 = p[i * 3 + 1]
    const pr = (p[(i - 1) * 3 + 2] + p[i * 3 + 2]) / 2
    ctx.lineWidth = Math.max(0.6, s.w * scale * (0.35 + pr * 1.3))
    ctx.beginPath()
    if (i >= 2) {
      const xm0 = (p[(i - 2) * 3] + x0) / 2,
        ym0 = (p[(i - 2) * 3 + 1] + y0) / 2
      ctx.moveTo(xm0 * scale, ym0 * scale)
    } else ctx.moveTo(x0 * scale, y0 * scale)
    ctx.quadraticCurveTo(x0 * scale, y0 * scale, ((x0 + x1) / 2) * scale, ((y0 + y1) / 2) * scale)
    ctx.stroke()
  }
  ctx.restore()
}

function hitStroke(s: Stroke, x: number, y: number, r: number) {
  for (let i = 0; i < s.p.length; i += 3) {
    const dx = s.p[i] - x,
      dy = s.p[i + 1] - y
    if (dx * dx + dy * dy < (r + s.w) * (r + s.w)) return true
  }
  return false
}

/** Esporta il disegno come PNG su fondo bianco, ritagliato sul contenuto (per l'AI). */
function exportPng(strokes: Stroke[], height: number): string {
  let minX = W,
    minY = height,
    maxX = 0,
    maxY = 0
  for (const s of strokes)
    for (let i = 0; i < s.p.length; i += 3) {
      minX = Math.min(minX, s.p[i])
      maxX = Math.max(maxX, s.p[i])
      minY = Math.min(minY, s.p[i + 1])
      maxY = Math.max(maxY, s.p[i + 1])
    }
  const pad = 20
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(W, maxX + pad)
  maxY = Math.min(height, maxY + pad)
  const scale = 1.6
  const c = document.createElement('canvas')
  c.width = Math.max(64, (maxX - minX) * scale)
  c.height = Math.max(64, (maxY - minY) * scale)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.translate(-minX * scale, -minY * scale)
  drawStrokes(ctx, strokes, scale)
  return c.toDataURL('image/png')
}


function DrawingView({ node, updateAttributes, editor, selected, deleteNode, getPos }: NodeViewProps) {
  const strokes: Stroke[] = node.attrs.strokes ?? []
  const height: number = node.attrs.height ?? 360
  const bg: string = node.attrs.bg ?? 'grid'
  const [editing, setEditing] = useState(false)
  const [full, setFull] = useState(false)
  const [tool, setTool] = useState<'pen' | 'hl' | 'eraser'>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [hl, setHl] = useState(HL_COLORS[0])
  const [size, setSize] = useState(1)
  const [redo, setRedo] = useState<Stroke[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const canEdit = editor.isEditable

  useEffect(() => {
    if (autoEditNext && canEdit) {
      autoEditNext = false
      setEditing(true)
    }
  }, [canEdit])

  // a schermo intero il foglio riempie lo schermo
  useEffect(() => {
    if (!full) return
    const w = Math.min(1100, window.innerWidth - 24)
    const need = Math.round((window.innerHeight - 150) / (w / W))
    if (height < need) updateAttributes({ height: need })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  // elenco sempre aggiornato (i tratti rapidi arrivano prima del re-render)
  const latest = useRef(strokes)
  latest.current = strokes
  const commit = useCallback(
    (s: Stroke[]) => {
      latest.current = s
      updateAttributes({ strokes: s })
    },
    [updateAttributes],
  )

  const convert = async (mode: 'latex' | 'text') => {
    if (!strokes.length) return
    setBusy(mode)
    try {
      const img = exportPng(strokes, height)
      const prompt =
        mode === 'latex'
          ? 'Nell’immagine c’è una formula o un calcolo matematico scritto a mano. Trascrivilo in LaTeX. Rispondi SOLO con il codice LaTeX, senza $ e senza spiegazioni. Se ci sono più righe usa \\\\ per andare a capo.'
          : 'Trascrivi fedelmente il testo scritto a mano nell’immagine, in italiano, in Markdown (elenchi se presenti, formule tra $...$). Rispondi SOLO con la trascrizione.'
      const out = (await chat([{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img } }] }], { model: settings().visionModel, maxTokens: 1200, temperature: 0 }))
        .replace(/^```(latex|tex)?/i, '')
        .replace(/```$/, '')
        .replace(/^\$+|\$+$/g, '')
        .trim()
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (pos == null) return
      const after = pos + node.nodeSize
      if (mode === 'latex') editor.chain().insertContentAt(after, { type: 'blockMath', attrs: { latex: out, slide: node.attrs.slide } }).run()
      else editor.chain().insertContentAt(after, await mdToHtml(out)).run()
      toast(mode === 'latex' ? 'Formula inserita sotto il disegno' : 'Testo inserito sotto il disegno')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const toolbar = (
    <div className="draw-tools" contentEditable={false} onPointerDown={(e) => e.stopPropagation()}>
      <div className="draw-group">
        <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title="Penna">
          <Pen size={16} />
        </button>
        <button className={tool === 'hl' ? 'on' : ''} onClick={() => setTool('hl')} title="Evidenziatore">
          <Highlighter size={16} />
        </button>
        <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} title="Gomma (cancella tratti)">
          <Eraser size={16} />
        </button>
      </div>
      <div className="draw-group">
        {(tool === 'hl' ? HL_COLORS : COLORS).map((c) => (
          <button key={c} className={`swatch ${(tool === 'hl' ? hl : color) === c ? 'on' : ''}`} style={{ background: c }} onClick={() => (tool === 'hl' ? setHl(c) : (setColor(c), tool === 'eraser' && setTool('pen')))} />
        ))}
      </div>
      <div className="draw-group">
        {SIZES.map((s, i) => (
          <button key={s} className={size === i ? 'on' : ''} onClick={() => setSize(i)} title="Spessore">
            <span className="dot" style={{ width: 3 + i * 3, height: 3 + i * 3 }} />
          </button>
        ))}
      </div>
      <div className="draw-group">
        <button
          onClick={() => {
            if (!strokes.length) return
            setRedo([...redo, strokes[strokes.length - 1]])
            commit(strokes.slice(0, -1))
          }}
          disabled={!strokes.length}
          title="Annulla"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={() => {
            if (!redo.length) return
            commit([...strokes, redo[redo.length - 1]])
            setRedo(redo.slice(0, -1))
          }}
          disabled={!redo.length}
          title="Ripeti"
        >
          <Redo2 size={16} />
        </button>
        <button onClick={() => updateAttributes({ bg: bg === 'grid' ? 'lines' : bg === 'lines' ? 'blank' : 'grid' })} title="Sfondo: quadretti / righe / bianco">
          {bg === 'grid' ? <Grid3x3 size={16} /> : bg === 'lines' ? <Rows3 size={16} /> : <Square size={16} />}
        </button>
        <button onClick={() => strokes.length && confirm('Cancellare tutto il disegno?') && commit([])} title="Svuota">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="draw-group">
        <button className="wide" onClick={() => convert('latex')} disabled={!!busy || !strokes.length} title="Riconosce la formula scritta a mano e la inserisce in LaTeX">
          {busy === 'latex' ? <Loader2 size={15} className="spin" /> : <Sigma size={15} />} Formula
        </button>
        <button className="wide" onClick={() => convert('text')} disabled={!!busy || !strokes.length} title="Trasforma la scrittura a mano in testo">
          {busy === 'text' ? <Loader2 size={15} className="spin" /> : <Type size={15} />} Testo
        </button>
      </div>
      <span className="flex-1" />
      <div className="draw-group">
        <button onClick={() => setFull(!full)} title={full ? 'Riduci' : 'Schermo intero'}>
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          className="wide done"
          onClick={() => {
            setEditing(false)
            setFull(false)
          }}
        >
          <Check size={15} /> Fatto
        </button>
      </div>
    </div>
  )

  const surface = (
    <Surface
      strokes={strokes}
      height={height}
      bg={bg}
      editing={editing && canEdit}
      tool={{ t: tool, c: tool === 'hl' ? hl : color, w: tool === 'hl' ? 18 + size * 6 : SIZES[size] }}
      getStrokes={() => latest.current}
      onStroke={(s) => {
        setRedo([])
        commit([...latest.current, s])
      }}
      onErase={(next) => commit(next)}
      onHeight={(h) => updateAttributes({ height: h })}
      onActivate={() => canEdit && setEditing(true)}
    />
  )

  return (
    <NodeViewWrapper className={`draw-block ${editing ? 'editing' : ''} ${selected ? 'is-selected' : ''}`} data-slide={node.attrs.slide ?? undefined}>
      {canEdit && !editing && (
        <div className="draw-hover" contentEditable={false}>
          <span className="draw-handle" data-drag-handle title="Trascina per spostare">
            <GripVertical size={14} />
          </span>
          <button onClick={() => setEditing(true)}>
            <PencilLine size={14} /> Disegna
          </button>
          <button onClick={() => { setEditing(true); setFull(true) }}>
            <Maximize2 size={14} />
          </button>
          <button onClick={() => deleteNode()} title="Elimina disegno">
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {editing && !full && toolbar}
      {!full && surface}
      {full &&
        createPortal(
          <div className="draw-full">
            {toolbar}
            <div className="draw-full-scroll">{surface}</div>
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}

function Surface({
  strokes,
  height,
  bg,
  editing,
  tool,
  onStroke,
  onErase,
  onHeight,
  onActivate,
  getStrokes,
}: {
  getStrokes: () => Stroke[]
  strokes: Stroke[]
  height: number
  bg: string
  editing: boolean
  tool: { t: 'pen' | 'hl' | 'eraser'; c: string; w: number }
  onStroke: (s: Stroke) => void
  onErase: (s: Stroke[]) => void
  onHeight: (h: number) => void
  onActivate: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef<HTMLCanvasElement>(null)
  const [cssW, setCssW] = useState(600)
  const cur = useRef<Stroke | null>(null)
  const erasing = useRef<Stroke[] | null>(null)
  const scale = cssW / W
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setCssW(el.clientWidth))
    ro.observe(el)
    setCssW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // ridisegna tutto quando cambiano i tratti o le dimensioni
  useEffect(() => {
    for (const c of [canvas.current, live.current]) {
      if (!c) continue
      c.width = Math.round(cssW * dpr)
      c.height = Math.round(height * scale * dpr)
    }
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, height * scale)
    drawStrokes(ctx, erasing.current ?? strokes, scale)
  }, [strokes, cssW, height, scale, dpr])

  const pos = (e: PointerEvent | React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    const pr = e.pointerType === 'pen' ? e.pressure || 0.5 : e.pointerType === 'touch' ? 0.45 : 0.5
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * height, Math.round(pr * 100) / 100]
  }

  const down = (e: React.PointerEvent) => {
    if (!editing) return
    if (e.pointerType === 'pen') penSeen = true
    if (e.pointerType === 'touch' && penSeen) return // palm rejection: con la Pencil le dita non disegnano
    e.preventDefault()
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* puntatore non catturabile */
    }
    const [x, y, p] = pos(e)
    if (tool.t === 'eraser') {
      erasing.current = getStrokes().filter((s) => !hitStroke(s, x, y, 12))
      redraw()
      return
    }
    cur.current = { t: tool.t, c: tool.c, w: tool.w, p: [round(x), round(y), p] }
  }

  const redraw = () => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, height * scale)
    drawStrokes(ctx, erasing.current ?? strokes, scale)
  }

  const move = (e: React.PointerEvent) => {
    if (!editing) return
    if (erasing.current) {
      const [x, y] = pos(e)
      const before = erasing.current.length
      erasing.current = erasing.current.filter((s) => !hitStroke(s, x, y, 12))
      if (erasing.current.length !== before) redraw()
      return
    }
    const s = cur.current
    if (!s) return
    const co = (e.nativeEvent as PointerEvent).getCoalescedEvents?.()
    const evs = co && co.length ? co : [e.nativeEvent]
    for (const ev of evs) {
      const [x, y, p] = pos(ev)
      const lx = s.p[s.p.length - 3],
        ly = s.p[s.p.length - 2]
      if ((x - lx) ** 2 + (y - ly) ** 2 < 0.8) continue
      s.p.push(round(x), round(y), p)
    }
    const ctx = live.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (s.t === 'hl') {
      ctx.clearRect(0, 0, cssW, height * scale)
      drawStroke(ctx, s, scale)
    } else drawStroke(ctx, s, scale, Math.max(1, s.p.length / 3 - evs.length - 1))
  }

  const up = () => {
    if (erasing.current) {
      const next = erasing.current
      erasing.current = null
      if (next.length !== getStrokes().length) onErase(next)
      return
    }
    const s = cur.current
    cur.current = null
    const ctx = live.current?.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, live.current!.width, live.current!.height)
    if (s) {
      // se si disegna vicino al fondo, lo spazio cresce da solo
      let maxY = 0
      for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i])
      onStroke(s)
      if (maxY > height - 50) onHeight(Math.min(4000, height + 220))
    }
  }

  // maniglia per cambiare l'altezza
  const resize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = height
    const mv = (ev: PointerEvent) => onHeight(Math.max(120, Math.min(4000, Math.round(startH + (ev.clientY - startY) / scale))))
    const u = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', u)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', u)
  }

  return (
    <div
      ref={box}
      className={`draw-surface bg-${bg} ${editing ? 'active' : ''} tool-${tool.t}`}
      style={{ height: height * scale, ['--gs' as string]: `${40 * scale}px` }}
      contentEditable={false}
      onDoubleClick={() => !editing && onActivate()}
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      <canvas
        ref={live}
        className="draw-live"
        style={{ width: '100%', height: '100%', touchAction: editing ? 'none' : 'auto' }}
        onPointerDown={(e) => {
          if (!editing && e.pointerType === 'pen') {
            // la Pencil attiva il disegno direttamente
            onActivate()
            return
          }
          down(e)
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {!editing && strokes.length === 0 && <div className="draw-empty">Tocca “Disegna” o scrivi con la Apple Pencil</div>}
      {editing && <div className="draw-resize" onPointerDown={resize} title="Trascina per cambiare l’altezza" />}
    </div>
  )
}

const round = (v: number) => Math.round(v * 10) / 10

export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      strokes: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-strokes') || '[]')
          } catch {
            return []
          }
        },
        renderHTML: (a) => ({ 'data-strokes': JSON.stringify(a.strokes ?? []) }),
      },
      height: { default: 360, parseHTML: (el) => Number(el.getAttribute('data-height')) || 360, renderHTML: (a) => ({ 'data-height': a.height }) },
      bg: { default: 'grid', parseHTML: (el) => el.getAttribute('data-bg') || 'grid', renderHTML: (a) => ({ 'data-bg': a.bg }) },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="drawing"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView, {
      // i tocchi/la penna sulla tela e i pulsanti non devono arrivare all'editor di testo
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('.draw-surface, .draw-tools, .draw-hover button'),
    })
  },
  addCommands() {
    return {
      insertDrawing:
        (opts = {}) =>
        ({ commands }) => {
          autoEditNext = true
          return commands.insertContent([{ type: this.name, attrs: { height: opts.height ?? 360, bg: opts.bg ?? 'grid' } }, { type: 'paragraph' }])
        },
    }
  },
})
