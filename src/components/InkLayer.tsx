import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import getStroke from 'perfect-freehand'
import { inkKey } from '../editor/Ink'
import { useInk, spacesFrom, INK_SIZES, PAGE_UNITS, type InkStroke } from '../lib/ink'
import { chat } from '../lib/groq'
import { settings } from '../lib/settings'
import { mdToHtml } from '../lib/markdown'
import { toast } from './Toast'

let penSeen = false
const sid = () => Math.random().toString(36).slice(2, 10)

interface Block {
  bid: string
  pos: number
  top: number
  bottom: number
  origin: number
  empty: boolean
}

export interface InkHandle {
  undo: () => void
  redo: () => void
  convert: (mode: 'latex' | 'text') => Promise<void>
  finish: () => void
  canUndo: boolean
  canRedo: boolean
  session: number
}

function svgPath(pts: number[][]) {
  if (!pts.length) return ''
  const d = pts.reduce(
    (acc: (string | number)[], [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2))
      return acc
    },
    ['M', ...pts[0].map((v) => v.toFixed(2)), 'Q'],
  )
  d.push('Z')
  return d.join(' ')
}

function outline(points: number[][], t: 'pen' | 'hl', w: number, last = true) {
  return getStroke(points, {
    size: t === 'hl' ? w : w * 2,
    thinning: t === 'hl' ? 0 : 0.62,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: false,
    last,
    start: { cap: t !== 'hl' },
    end: { cap: t !== 'hl' },
  })
}

const triples = (p: number[]) => {
  const out: number[][] = []
  for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]])
  return out
}

export function InkLayer({
  editor,
  strokes,
  onChange,
  readOnly,
  handle,
}: {
  editor: Editor
  strokes: InkStroke[]
  onChange?: (s: InkStroke[]) => void
  readOnly?: boolean
  handle?: React.MutableRefObject<InkHandle | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const active = useInk((s) => s.active) && !readOnly
  const { tool, color, hl, size } = useInk()
  const [layout, setLayout] = useState<{ k: number; left: number; blocks: Map<string, Block>; h: number }>({ k: 1, left: 0, blocks: new Map(), h: 0 })
  const [live, setLive] = useState<number[][] | null>(null)
  const latest = useRef(strokes)
  latest.current = strokes
  const undoStack = useRef<InkStroke[][]>([])
  const redoStack = useRef<InkStroke[][]>([])
  const session = useRef<Set<string>>(new Set())
  const lastSpace = useRef<string | null>(null)
  const absTop = useRef(new Map<string, number>())
  const [, force] = useState(0)

  // ---------- misura dei blocchi ----------
  const measure = useCallback(() => {
    const h = host.current
    if (!h || editor.isDestroyed) return
    const hr = h.getBoundingClientRect()
    const pm = editor.view.dom as HTMLElement
    const k = pm.clientWidth / PAGE_UNITS || 1
    const st = inkKey.getState(editor.state)
    const blocks = new Map<string, Block>()
    editor.state.doc.forEach((node, offset) => {
      const bid = node.attrs?.bid as string | undefined
      if (!bid) return
      const dom = editor.view.nodeDOM(offset) as HTMLElement | null
      if (!dom || !(dom instanceof HTMLElement)) return
      const r = dom.getBoundingClientRect()
      const sp = (st?.spaces[bid] ?? 0) * (st?.k ?? k)
      blocks.set(bid, {
        bid,
        pos: offset,
        top: r.top - hr.top,
        bottom: r.bottom - hr.top,
        origin: r.top - hr.top - sp,
        empty: node.type.name === 'paragraph' && node.content.size === 0,
      })
    })
    setLayout({ k, left: pm.getBoundingClientRect().left - hr.left, blocks, h: h.scrollHeight })
  }, [editor])

  useLayoutEffect(() => {
    measure()
    let pending = false
    const on = () => {
      if (pending) return
      pending = true
      setTimeout(() => {
        pending = false
        measure()
      }, 16)
    }
    editor.on('transaction', on)
    const ro = new ResizeObserver(on)
    if (host.current) ro.observe(host.current)
    ro.observe(editor.view.dom)
    return () => {
      editor.off('transaction', on)
      ro.disconnect()
    }
  }, [editor, measure])

  // ---------- spazi per la mano → decorazioni dell'editor ----------
  useEffect(() => {
    if (editor.isDestroyed) return
    const spaces = spacesFrom(strokes)
    const cur = inkKey.getState(editor.state)
    if (cur && JSON.stringify(cur.spaces) === JSON.stringify(spaces) && Math.abs(cur.k - layout.k) < 0.001) return
    editor.view.dispatch(editor.state.tr.setMeta(inkKey, { spaces, k: layout.k }).setMeta('addToHistory', false))
  }, [strokes, layout.k, editor])

  // ---------- tratti rimasti senza blocco (paragrafo cancellato): si riancorano ----------
  useEffect(() => {
    if (readOnly || !onChange || !layout.blocks.size) return
    const orphans = strokes.filter((s) => !layout.blocks.has(s.b) && absTop.current.has(s.id))
    if (!orphans.length) return
    const list = [...layout.blocks.values()].sort((a, b) => a.top - b.top)
    const next = strokes.map((s) => {
      if (layout.blocks.has(s.b) || !absTop.current.has(s.id)) return s
      const oldOrigin = absTop.current.get(s.id)!
      let minY = Infinity
      for (let i = 1; i < s.p.length; i += 3) minY = Math.min(minY, s.p[i])
      const top = oldOrigin + minY * layout.k
      const target = s.sp ? (list.find((b) => b.top > top) ?? list[list.length - 1]) : ([...list].reverse().find((b) => b.origin <= top) ?? list[0])
      const dy = (oldOrigin - target.origin) / layout.k
      return { ...s, b: target.bid, p: s.p.map((v, i) => (i % 3 === 1 ? v + dy : v)) }
    })
    onChange(next)
  }, [layout, strokes, readOnly, onChange])

  // ---------- percorsi SVG (in unità, memorizzati) ----------
  const paths = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of strokes) m.set(s.id, svgPath(outline(triples(s.p), s.t, s.w)))
    return m
  }, [strokes])

  const commit = useCallback(
    (next: InkStroke[]) => {
      undoStack.current.push(latest.current)
      if (undoStack.current.length > 100) undoStack.current.shift()
      redoStack.current = []
      latest.current = next
      onChange?.(next)
      force((x) => x + 1)
    },
    [onChange],
  )

  // ---------- disegno ----------
  const cur = useRef<{ pts: number[][]; mode: 'draw' | 'erase' | 'scroll'; lastY: number } | null>(null)
  const pt = (e: PointerEvent | React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect()
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    return [e.clientX - r.left, e.clientY - r.top, p]
  }

  const eraseAt = (x: number, y: number) => {
    const { k, left, blocks } = layout
    const src = latest.current
    const keep = src.filter((s) => {
      const b = blocks.get(s.b)
      if (!b) return true
      const r = 10 + s.w * k
      for (let i = 0; i < s.p.length; i += 3) {
        const px = left + s.p[i] * k
        const py = b.origin + s.p[i + 1] * k
        if ((px - x) ** 2 + (py - y) ** 2 < r * r) return false
      }
      return true
    })
    if (keep.length !== src.length) commit(keep)
  }

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen = true
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* */
    }
    e.preventDefault()
    if (e.pointerType === 'touch' && penSeen) {
      cur.current = { pts: [], mode: 'scroll', lastY: e.clientY }
      return
    }
    const p = pt(e)
    if (tool === 'eraser') {
      cur.current = { pts: [], mode: 'erase', lastY: 0 }
      eraseAt(p[0], p[1])
      return
    }
    cur.current = { pts: [p], mode: 'draw', lastY: 0 }
    setLive([p])
  }

  const move = (e: React.PointerEvent) => {
    const c = cur.current
    if (!c) return
    if (c.mode === 'scroll') {
      const sc = host.current?.closest('.notes-scroll') as HTMLElement | null
      if (sc) sc.scrollTop -= e.clientY - c.lastY
      c.lastY = e.clientY
      return
    }
    const co = (e.nativeEvent as PointerEvent).getCoalescedEvents?.()
    const evs = co && co.length ? co : [e.nativeEvent]
    if (c.mode === 'erase') {
      for (const ev of evs) {
        const p = pt(ev)
        eraseAt(p[0], p[1])
      }
      return
    }
    for (const ev of evs) c.pts.push(pt(ev))
    setLive([...c.pts])
  }

  const up = () => {
    const c = cur.current
    cur.current = null
    setLive(null)
    if (!c || c.mode !== 'draw' || !c.pts.length) return
    finalize(c.pts)
  }

  const finalize = (pts: number[][]) => {
    const { k, left } = layout
    let blocks = layout.blocks
    const sy = pts[0][1]
    let list = [...blocks.values()].sort((a, b) => a.top - b.top)
    // sopra/vicino al testo → annotazione (sottolineature, cerchi, frecce): nessuno spazio extra
    let anchor = list.find((b) => !b.empty && sy >= b.top - 6 && sy <= b.bottom + 14)
    let sp: 1 | undefined
    if (!anchor) {
      // nel vuoto: su un paragrafo vuoto o nello spazio già lasciato per la mano
      anchor = list.find((b) => b.empty && sy >= b.origin && sy <= b.bottom)
      if (anchor) sp = 1
    }
    if (!anchor) {
      anchor = list.find((b) => b.top > sy)
      sp = 1
      if (!anchor) {
        // sotto tutto il testo: nuovo paragrafo in fondo, che scenderà sotto il disegno
        editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).setMeta('noAutoLink', true).run()
        const hr = host.current!.getBoundingClientRect()
        const lastNode = editor.state.doc.lastChild!
        const pos = editor.state.doc.content.size - lastNode.nodeSize
        const dom = editor.view.nodeDOM(pos) as HTMLElement
        const r = dom.getBoundingClientRect()
        anchor = { bid: lastNode.attrs.bid, pos, top: r.top - hr.top, bottom: r.bottom - hr.top, origin: r.top - hr.top, empty: true }
        blocks = new Map(blocks)
        blocks.set(anchor.bid, anchor)
        list = [...list, anchor]
      }
    }
    if (!anchor) return
    const s: InkStroke = {
      id: sid(),
      b: anchor.bid,
      t: tool === 'hl' ? 'hl' : 'pen',
      c: tool === 'hl' ? hl : color,
      w: tool === 'hl' ? 14 + size * 5 : INK_SIZES[size],
      p: pts.flatMap(([x, y, p]) => [Math.round(((x - left) / k) * 10) / 10, Math.round(((y - anchor!.origin) / k) * 10) / 10, Math.round(p * 100) / 100]),
      ...(sp ? { sp } : {}),
    }
    session.current.add(s.id)
    if (sp) lastSpace.current = anchor.bid
    commit([...latest.current, s])
  }

  // ---------- azioni esposte alla barra degli strumenti ----------
  const renderPng = (list: InkStroke[]) => {
    const { k, left, blocks } = layout
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    const abs = list.map((s) => {
      const b = blocks.get(s.b)!
      const pts = triples(s.p).map(([x, y, p]) => [left + x * k, b.origin + y * k, p])
      for (const [x, y] of pts) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      return { s, pts }
    })
    const pad = 16,
      sc = 2
    const c = document.createElement('canvas')
    c.width = Math.max(64, (maxX - minX + pad * 2) * sc)
    c.height = Math.max(64, (maxY - minY + pad * 2) * sc)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.scale(sc, sc)
    ctx.translate(pad - minX, pad - minY)
    for (const { s, pts } of abs) {
      if (s.t === 'hl') continue
      ctx.fillStyle = '#111'
      ctx.fill(new Path2D(svgPath(outline(pts, s.t, s.w * k))))
    }
    return c.toDataURL('image/png')
  }

  const convert = async (mode: 'latex' | 'text') => {
    const list = latest.current.filter((s) => session.current.has(s.id) && layout.blocks.has(s.b) && s.t === 'pen')
    if (!list.length) return toast('Scrivi prima qualcosa a mano', 'info')
    const img = renderPng(list)
    const prompt =
      mode === 'latex'
        ? 'Nell’immagine c’è una formula o un calcolo scritto a mano. Trascrivilo in LaTeX. Rispondi SOLO con il codice LaTeX, senza $ e senza spiegazioni; per più righe usa \\\\.'
        : 'Trascrivi fedelmente il testo scritto a mano nell’immagine, in italiano, in Markdown (formule tra $...$). Rispondi SOLO con la trascrizione.'
    const out = (await chat([{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img } }] }], { model: settings().visionModel, maxTokens: 1200, temperature: 0 }))
      .replace(/^```(latex|tex|markdown)?/i, '')
      .replace(/```$/, '')
      .replace(/^\$+|\$+$/g, '')
      .trim()
    const first = list[0]
    const b = layout.blocks.get(first.b)!
    const node = editor.state.doc.nodeAt(b.pos)
    const at = first.sp ? b.pos : b.pos + (node?.nodeSize ?? 0)
    if (mode === 'latex') editor.chain().insertContentAt(at, { type: 'blockMath', attrs: { latex: out } }).run()
    else editor.chain().insertContentAt(at, await mdToHtml(out)).run()
    const ids = new Set(list.map((s) => s.id))
    commit(latest.current.filter((s) => !ids.has(s.id)))
    session.current = new Set()
    toast(mode === 'latex' ? 'Scrittura a mano convertita in formula' : 'Scrittura a mano convertita in testo')
  }

  const finish = () => {
    useInk.getState().setActive(false)
    session.current = new Set()
    // il cursore va sotto l'ultimo disegno fatto nel vuoto
    const bid = lastSpace.current
    lastSpace.current = null
    if (!bid || readOnly) return
    let pos = -1
    let empty = false
    editor.state.doc.forEach((n, o) => {
      if (n.attrs?.bid === bid) {
        pos = o
        empty = n.type.name === 'paragraph' && n.content.size === 0
      }
    })
    if (pos < 0) return
    if (empty) {
      editor.chain().focus().setTextSelection(pos + 1).run()
      return
    }
    // il blocco sotto il disegno ha già del testo: nuovo paragrafo tra disegno e testo
    editor.chain().insertContentAt(pos, { type: 'paragraph' }).run()
    const nb = editor.state.doc.nodeAt(pos)?.attrs.bid as string
    if (nb) onChange?.(latest.current.map((s) => (s.b === bid && s.sp ? { ...s, b: nb } : s)))
    editor.chain().focus().setTextSelection(pos + 1).run()
  }

  if (handle)
    handle.current = {
      undo: () => {
        const prev = undoStack.current.pop()
        if (!prev) return
        redoStack.current.push(latest.current)
        latest.current = prev
        onChange?.(prev)
        force((x) => x + 1)
      },
      redo: () => {
        const nx = redoStack.current.pop()
        if (!nx) return
        undoStack.current.push(latest.current)
        latest.current = nx
        onChange?.(nx)
        force((x) => x + 1)
      },
      convert: (m) => convert(m).catch((e) => toast((e as Error).message, 'error')),
      finish,
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
      session: session.current.size,
    }

  // ---------- render ----------
  const { k, left, blocks } = layout
  const dark = document.documentElement.classList.contains('dark')
  const ink = (c: string, t: 'pen' | 'hl') => (dark && t === 'pen' && c === '#1f1f24' ? '#ececf2' : c)
  return (
    <div ref={host} className={`ink-host ${active ? 'ink-active' : ''}`}>
      <svg className="ink-svg" width="100%" height={layout.h || '100%'} aria-hidden>
        {strokes.map((s) => {
          const b = blocks.get(s.b)
          if (!b) return null
          absTop.current.set(s.id, b.origin)
          return (
            <g key={s.id} transform={`translate(${left} ${b.origin}) scale(${k})`}>
              <path d={paths.get(s.id)} fill={ink(s.c, s.t)} opacity={s.t === 'hl' ? (dark ? 0.3 : 0.38) : 1} style={s.t === 'hl' && !dark ? { mixBlendMode: 'multiply' } : undefined} />
            </g>
          )
        })}
        {live && live.length > 0 && (
          <path
            d={svgPath(outline(live, tool === 'hl' ? 'hl' : 'pen', (tool === 'hl' ? 14 + size * 5 : INK_SIZES[size]) * k, false))}
            fill={tool === 'hl' ? hl : ink(color, 'pen')}
            opacity={tool === 'hl' ? 0.38 : 1}
          />
        )}
      </svg>
      {active && <div className={`ink-capture tool-${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />}
    </div>
  )
}
