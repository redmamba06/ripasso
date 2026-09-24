import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Code, Highlighter, Sparkles, Link2, Pencil, X, Crosshair, MessageCircleQuestion, Wand2, ListCollapse } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { buildExtensions, editorRef } from './extensions'
import { NO_AUTOLINK } from './SlideLink'
import { decodeRef, encodeRef, currentRef, useViewer } from '../lib/viewer'
import { bridge } from './bridge'
import { chat, SYSTEM_TUTOR } from '../lib/groq'
import { mdToHtml } from '../lib/markdown'
import { toast } from '../components/Toast'
import { InkLayer, type InkHandle } from '../components/InkLayer'
import { useInk, type InkStroke } from '../lib/ink'
import { useSettings } from '../lib/settings'

export interface NoteEditorProps {
  docKey: string
  initial: JSONContent | null
  onSave: (doc: JSONContent, text: string) => void
  /** nomi file per le etichette laterali */
  fileNames?: Record<string, string>
  mainFileId?: string | null
  gutter?: boolean
  placeholder?: string
  remoteStamp?: number
  onReady?: (e: Editor) => void
  className?: string
  /** scrittura a mano sopra gli appunti */
  ink?: InkStroke[]
  onInk?: (s: InkStroke[]) => void
  inkHandle?: React.MutableRefObject<InkHandle | null>
}

interface Group {
  top: number
  height: number
  ref: string
  pos: number
}

export function NoteEditor(p: NoteEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLocal = useRef(0)
  const wrap = useRef<HTMLDivElement>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [editing, setEditing] = useState<Group | null>(null)
  const onSave = useRef(p.onSave)
  onSave.current = p.onSave

  const flush = useCallback((ed: Editor) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    onSave.current(ed.getJSON(), ed.getText({ blockSeparator: '\n' }))
  }, [])

  const editor = useEditor(
    {
      extensions: buildExtensions({ placeholder: p.placeholder }),
      content: p.initial ?? '',
      editorProps: { attributes: { class: 'prose-note', spellcheck: 'true' } },
      onUpdate: ({ editor, transaction }) => {
        if (transaction.getMeta('remote')) return
        lastLocal.current = Date.now()
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => flush(editor), 600)
      },
      onFocus: ({ editor }) => {
        editorRef.current = editor
        bridge.editor = editor
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [p.docKey],
  )

  const onReady = useRef(p.onReady)
  onReady.current = p.onReady
  useEffect(() => {
    if (!editor) return
    editorRef.current = editor
    bridge.editor = editor
    onReady.current?.(editor)
    // assegna gli id ai blocchi degli appunti vecchi (servono per ancorare la scrittura a mano)
    editor.view.dispatch(editor.state.tr.setMeta('inkInit', true).setMeta('addToHistory', false))
  }, [editor])
  const inkOn = useInk((s) => s.active) && !!p.onInk

  // blocca Scribble (iPadOS converte in testo ciò che la Pencil scrive nei campi di testo)
  // quando l'utente ha scelto di tenere la scrittura a mano
  const inkWrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = inkWrap.current
    if (!el || !p.onInk) return
    const stylus = (e: TouchEvent) => [...e.touches, ...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
    const block = (e: TouchEvent) => {
      if (useSettings.getState().pencilMode === 'ink' && stylus(e)) e.preventDefault()
    }
    el.addEventListener('touchstart', block, { passive: false })
    el.addEventListener('touchmove', block, { passive: false })
    return () => {
      el.removeEventListener('touchstart', block)
      el.removeEventListener('touchmove', block)
    }
  }, [p.onInk, editor])

  // salva quando si esce/cambia nota
  useEffect(() => {
    const ed = editor
    const onHide = () => ed && saveTimer.current && flush(ed)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      if (ed && saveTimer.current) flush(ed)
    }
  }, [editor, flush])

  // aggiornamenti arrivati da un altro dispositivo
  useEffect(() => {
    if (!editor || !p.remoteStamp) return
    if (editor.isFocused || Date.now() - lastLocal.current < 4000) return
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(p.initial)) return
    editor.chain().setMeta('remote', true).setMeta(NO_AUTOLINK, true).setContent(p.initial ?? '', { emitUpdate: false }).run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.remoteStamp])

  // ---- colonna laterale con i collegamenti alle slide ----
  const measure = useCallback(() => {
    if (!editor || !wrap.current || p.gutter === false) return
    const base = wrap.current.getBoundingClientRect().top
    const out: Group[] = []
    editor.state.doc.forEach((node, offset) => {
      const ref = node.attrs?.slide as string | null
      const dom = editor.view.nodeDOM(offset) as HTMLElement | null
      if (!dom || !(dom instanceof HTMLElement)) return
      const r = dom.getBoundingClientRect()
      if (!ref || ref === 'none') return
      const last = out[out.length - 1]
      const top = r.top - base
      if (last && last.ref === ref && top - (last.top + last.height) < 40) {
        last.height = r.bottom - base - last.top
      } else out.push({ top, height: r.height, ref, pos: offset })
    })
    setGroups(out)
  }, [editor, p.gutter])

  useLayoutEffect(() => {
    if (!editor) return
    measure()
    const on = () => requestAnimationFrame(measure)
    editor.on('update', on)
    editor.on('transaction', on)
    const ro = new ResizeObserver(on)
    if (wrap.current) ro.observe(wrap.current)
    return () => {
      editor.off('update', on)
      editor.off('transaction', on)
      ro.disconnect()
    }
  }, [editor, measure])

  const openRef = (ref: string) => {
    const d = decodeRef(ref)
    if (d) useViewer.getState().goto(d.fileId, d.page)
  }

  const setRef = (pos: number, ref: string | null) => {
    if (!editor) return
    // aggiorna tutti i blocchi consecutivi del gruppo
    const g = groups.find((x) => x.pos === pos)
    const ends: number[] = []
    editor.state.doc.forEach((node, offset) => {
      if (!g) return
      if (offset >= g.pos && node.attrs?.slide === g.ref) {
        const dom = editor.view.nodeDOM(offset) as HTMLElement | null
        const base = wrap.current!.getBoundingClientRect().top
        if (dom && dom.getBoundingClientRect().top - base <= g.top + g.height + 1) ends.push(offset)
      }
    })
    const chain = editor.chain().setMeta(NO_AUTOLINK, true)
    for (const o of ends.length ? ends : [pos]) chain.setBlockSlide(o, ref)
    chain.run()
    setEditing(null)
  }

  const fileLabel = (fileId: string) => {
    if (!p.fileNames || fileId === p.mainFileId) return ''
    const n = p.fileNames[fileId]
    return n ? n.replace(/\.pdf$/i, '').slice(0, 10) + ' · ' : '? · '
  }

  if (!editor) return null
  return (
    <div className={`note-wrap ${p.gutter === false ? 'no-gutter' : ''} ${p.className ?? ''}`} ref={wrap}>
      {p.gutter !== false && (
        <div className="slide-gutter" aria-label="Collegamenti alle slide">
          {groups.map((g) => {
            const d = decodeRef(g.ref)
            if (!d) return null
            return (
              <div key={g.pos + g.ref} className="gutter-group" style={{ top: g.top, height: Math.max(g.height, 26) }}>
                <span className="gutter-line" />
                <button className="gutter-chip" title="Apri la slide collegata" onClick={() => openRef(g.ref)}>
                  {fileLabel(d.fileId)}
                  {d.page}
                </button>
                <button className="gutter-edit" title="Modifica collegamento" onClick={() => setEditing(g)}>
                  <Pencil size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <AnimatePresence>
        {editing && (
          <RefEditor
            key="refedit"
            g={editing}
            fileNames={p.fileNames ?? {}}
            onClose={() => setEditing(null)}
            onSet={(ref) => setRef(editing.pos, ref)}
          />
        )}
      </AnimatePresence>

      <BubbleMenu
        editor={editor}
        options={{ placement: 'top', offset: 8 }}
        shouldShow={({ editor, state }) => !state.selection.empty && editor.isEditable && !editor.isActive('codeBlock') && !editor.isActive('image') && !editor.isActive('drawing') && !editor.isActive('blockMath')}
      >
        <FormatBar editor={editor} />
      </BubbleMenu>

      <div
        ref={inkWrap}
        className={`ink-wrap ${inkOn ? 'ink-on' : ''}`}
        onPointerDownCapture={(e) => {
          // Apple Pencil sul testo in modalità "scrittura a mano": si scrive subito, senza passare dal testo
          if (!p.onInk || e.pointerType !== 'pen' || useSettings.getState().pencilMode !== 'ink' || useInk.getState().active) return
          e.preventDefault()
          e.stopPropagation()
          useInk.getState().setActive(true)
          p.inkHandle?.current?.start(e.nativeEvent)
        }}
      >
        <EditorContent editor={editor} className="editor-content" />
        {p.ink && <InkLayer editor={editor} strokes={p.ink} onChange={p.onInk} readOnly={!p.onInk} handle={p.inkHandle} />}
      </div>
    </div>
  )
}

function RefEditor({ g, fileNames, onClose, onSet }: { g: Group; fileNames: Record<string, string>; onClose: () => void; onSet: (r: string | null) => void }) {
  const d = decodeRef(g.ref)!
  const [page, setPage] = useState(String(d.page))
  const [file, setFile] = useState(d.fileId)
  const cur = currentRef()
  return (
    <motion.div
      className="ref-editor glass"
      style={{ top: g.top }}
      initial={{ opacity: 0, x: -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -8, scale: 0.97 }}
      transition={{ duration: 0.16 }}
    >
      <div className="flex items-center justify-between mb-2">
        <b className="text-[13px]">Collegamento alla slide</b>
        <button className="icon-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {Object.keys(fileNames).length > 1 && (
        <select className="field mb-2" value={file} onChange={(e) => setFile(e.target.value)}>
          {Object.entries(fileNames).map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2 mb-2">
        <input className="field w-20" inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ''))} />
        <button className="btn btn-primary flex-1" onClick={() => page && onSet(encodeRef(file, parseInt(page, 10)))}>
          Salva
        </button>
      </div>
      {cur && cur !== g.ref && (
        <button className="btn w-full mb-2" onClick={() => onSet(cur)}>
          <Crosshair size={14} /> Usa la slide aperta ({decodeRef(cur)?.page})
        </button>
      )}
      <button className="btn btn-danger-soft w-full" onClick={() => onSet('none')}>
        <Link2 size={14} /> Rimuovi collegamento
      </button>
    </motion.div>
  )
}

function FormatBar({ editor }: { editor: Editor }) {
  const [busy, setBusy] = useState<string | null>(null)
  const b = (active: boolean) => `fmt-btn ${active ? 'on' : ''}`

  const ai = async (mode: 'explain' | 'summarize' | 'improve' | 'list') => {
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, '\n')
    if (!text.trim()) return
    if (mode === 'explain') {
      bridge.current?.askAi?.(`Spiegami meglio questo passaggio dei miei appunti:\n\n"${text}"`)
      return
    }
    setBusy(mode)
    try {
      const instr = {
        summarize: 'Riassumi il testo in modo più breve mantenendo tutti i concetti chiave.',
        improve: 'Riscrivi il testo in modo più chiaro, ordinato e corretto, senza aggiungere informazioni nuove. Mantieni formule e termini tecnici.',
        list: 'Trasforma il testo in un elenco puntato sintetico e ben strutturato.',
      }[mode]
      const out = await chat(
        [
          { role: 'system', content: SYSTEM_TUTOR },
          { role: 'user', content: `${instr}\nRispondi SOLO con il risultato in Markdown, senza commenti.\n\n---\n${text}` },
        ],
        { maxTokens: 1800 },
      )
      editor.chain().focus().insertContentAt({ from, to }, await mdToHtml(out)).run()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fmt-bar glass">
      <button className={b(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Grassetto (⌘B)">
        <Bold size={15} />
      </button>
      <button className={b(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Corsivo (⌘I)">
        <Italic size={15} />
      </button>
      <button className={b(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sottolineato (⌘U)">
        <Underline size={15} />
      </button>
      <button className={b(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Barrato">
        <Strikethrough size={15} />
      </button>
      <button className={b(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()} title="Codice in linea">
        <Code size={15} />
      </button>
      {['#fff3a3', '#c8f7d4', '#ffd3e0', '#cfe3ff'].map((c) => (
        <button key={c} className="fmt-btn" title="Evidenzia" onClick={() => editor.chain().focus().toggleHighlight({ color: c }).run()}>
          <span className="w-3.5 h-3.5 rounded-full border border-black/10" style={{ background: c }} />
        </button>
      ))}
      <button className={b(false)} onClick={() => editor.chain().focus().unsetHighlight().run()} title="Togli evidenziazione">
        <Highlighter size={15} />
      </button>
      <span className="fmt-sep" />
      <button className="fmt-btn ai" onClick={() => ai('explain')} title="Chiedi spiegazione all’AI">
        <MessageCircleQuestion size={15} /> Spiega
      </button>
      <button className="fmt-btn ai" onClick={() => ai('improve')} disabled={!!busy} title="Riscrivi meglio">
        {busy === 'improve' ? <Sparkles size={15} className="spin" /> : <Wand2 size={15} />}
      </button>
      <button className="fmt-btn ai" onClick={() => ai('summarize')} disabled={!!busy} title="Riassumi">
        {busy === 'summarize' ? <Sparkles size={15} className="spin" /> : <ListCollapse size={15} />}
      </button>
      <button className="fmt-btn ai" onClick={() => ai('list')} disabled={!!busy} title="Trasforma in elenco">
        {busy === 'list' ? <Sparkles size={15} className="spin" /> : <Sparkles size={15} />}
      </button>
    </div>
  )
}
