import { CourseIcon } from '../components/CourseIcon'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Editor, JSONContent } from '@tiptap/react'
import { ArrowLeft, Sparkles, Link2, Unlink, Columns2, Presentation, NotebookPen, Plus, CheckCircle2, Circle, CircleDot, Loader2, Menu, PenLine, PencilLine, Pen, Highlighter, Eraser, Undo2, Redo2, Sigma, Type, Check } from 'lucide-react'
import { db, alive, put, patch, type Note, type Unit, type FileRec } from '../lib/db'
import { useViewer, encodeRef } from '../lib/viewer'
import { useSettings } from '../lib/settings'
import { onRemoteChange } from '../lib/sync'
import { addFiles, isPdf } from '../lib/files'
import { loadPdf, pageText, pageImage } from '../lib/pdf'
import { chat, SYSTEM_TUTOR } from '../lib/groq'
import { mdToHtml } from '../lib/markdown'
import { PdfViewer } from '../components/PdfViewer'
import { NoteEditor } from '../editor/NoteEditor'
import { AiChat, type AiChatHandle } from '../components/AiChat'
import { Dropzone, pickFiles } from '../components/Dropzone'
import { bridge } from '../editor/bridge'
import { saveAsset } from '../editor/AssetImage'
import { NO_AUTOLINK } from '../editor/SlideLink'
import { toast } from '../components/Toast'
import { useUI } from '../lib/ui'
import { useInk, INK_COLORS, INK_HL, INK_SIZES, type InkStroke } from '../lib/ink'
import type { InkHandle } from '../components/InkLayer'
import { PencilModeToggle } from '../components/PencilMode'
import { registerShortcuts } from '../lib/shortcuts'
import { currentRef } from '../lib/viewer'
import { NodeSelection } from '@tiptap/pm/state'

type Mode = 'split' | 'slides' | 'notes'

/** Dove inserire contenuti generati: dopo il blocco in cui si trova il cursore (o in fondo). */
function insertPos(ed: Editor) {
  const { $from } = ed.state.selection
  if ($from.depth < 1) return ed.state.doc.content.size
  const top = $from.node(1)
  // un paragrafo vuoto viene sostituito
  if (top.type.name === 'paragraph' && top.content.size === 0) return $from.before(1)
  return $from.after(1)
}

function useNarrow() {
  const [n, setN] = useState(() => window.innerWidth < 760)
  useEffect(() => {
    const on = () => setN(window.innerWidth < 760)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return n
}

export default function UnitPage() {
  const { unitId } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const narrow = useNarrow()
  const [mode, setMode] = useState<Mode>(() => (window.innerWidth < 760 ? 'notes' : 'split'))
  const [ai, setAi] = useState(false)
  const [remoteStamp, setRemoteStamp] = useState(0)
  const [aiBusy, setAiBusy] = useState(false)
  const chatHandle = useRef<AiChatHandle | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const autoLink = useSettings((s) => s.autoLink)
  const ratio = useSettings((s) => s.splitRatio)
  const setS = useSettings((s) => s.set)
  const fileId = useViewer((s) => s.fileId)
  const snipping = useViewer((s) => s.snipping)

  const data = useLiveQuery(async () => {
    const unit = await db.units.get(unitId!)
    if (!unit) return { unit: null }
    const course = await db.courses.get(unit.courseId)
    const files = alive(await db.files.where('unitId').equals(unit.id).toArray()).sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }))
    const allCourseFiles = alive(await db.files.where('courseId').equals(unit.courseId).toArray())
    const note = await db.notes.get(unit.id)
    return { unit, course, files, allCourseFiles, note }
  }, [unitId])

  // nota caricata una sola volta per unità (poi l'editor è la fonte di verità)
  const [initialNote, setInitialNote] = useState<{ id: string; doc: JSONContent | null } | null>(null)
  const [ink, setInk] = useState<InkStroke[]>([])
  const noteRef = useRef<{ doc: JSONContent | null; text: string; ink: InkStroke[] }>({ doc: null, text: '', ink: [] })
  const inkHandle = useRef<InkHandle | null>(null)
  const inkActive = useInk((s) => s.active)
  useEffect(() => {
    setInitialNote(null)
    useInk.getState().setActive(false)
    void db.notes.get(unitId!).then((n) => {
      noteRef.current = { doc: n?.doc ?? null, text: n?.text ?? '', ink: n?.ink ?? [] }
      setInk(n?.ink ?? [])
      setInitialNote({ id: unitId!, doc: n?.doc ?? null })
    })
    return () => useInk.getState().setActive(false)
  }, [unitId])

  // aggiornamenti da altri dispositivi
  useEffect(
    () =>
      onRemoteChange(async () => {
        const n = await db.notes.get(unitId!)
        if (n && !n.dirty) {
          noteRef.current = { doc: n.doc, text: n.text, ink: n.ink ?? [] }
          setInk(n.ink ?? [])
          setInitialNote({ id: unitId!, doc: n.doc })
          setRemoteStamp(Date.now())
        }
      }),
    [unitId],
  )

  const unit = data?.unit
  const course = data && 'course' in data ? data.course : null
  const files = useMemo(() => (data && 'files' in data ? (data.files ?? []) : []), [data])
  const pdfs = files.filter(isPdf)

  // file aperto
  useEffect(() => {
    if (!unit) return
    const want = sp.get('file') ?? unit.mainFileId ?? pdfs[0]?.id ?? null
    const cur = useViewer.getState().fileId
    if (!cur || !pdfs.some((f) => f.id === cur) || sp.get('file')) {
      if (want !== cur) useViewer.getState().setOpen(want && pdfs.some((f) => f.id === want) ? want : (pdfs[0]?.id ?? null))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.id, pdfs.map((f) => f.id).join(','), sp])

  useEffect(() => () => useViewer.getState().setOpen(null), [])

  const fileNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of (data && 'allCourseFiles' in data ? data.allCourseFiles : []) ?? []) if (isPdf(f)) m[f.id] = f.name
    return m
  }, [data])

  // se l'utente clicca un collegamento a una slide di un altro file o con le slide nascoste
  useEffect(
    () =>
      useViewer.subscribe((s, prev) => {
        if (s.gotoSeq !== prev.gotoSeq) {
          if (mode === 'notes') setMode(narrow ? 'slides' : 'split')
        }
        if (s.snipping && !prev.snipping && mode === 'notes') setMode(narrow ? 'slides' : 'split')
      }),
    [mode, narrow],
  )

  // testo e scrittura a mano si salvano insieme nella stessa nota
  const persist = useCallback(() => {
    if (!unit) return
    const n = noteRef.current
    void put<Note>('notes', { id: unit.id, unitId: unit.id, courseId: unit.courseId, doc: n.doc, text: n.text, ink: n.ink, updatedAt: 0 })
  }, [unit])
  const saveNote = useCallback(
    (doc: JSONContent, text: string) => {
      noteRef.current = { ...noteRef.current, doc, text }
      persist()
    },
    [persist],
  )
  const inkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInk = useCallback(
    (strokes: InkStroke[]) => {
      noteRef.current = { ...noteRef.current, ink: strokes }
      setInk(strokes)
      if (inkTimer.current) clearTimeout(inkTimer.current)
      inkTimer.current = setTimeout(persist, 500)
    },
    [persist],
  )
  const toggleInk = useCallback(() => {
    const on = !useInk.getState().active
    if (on) {
      if (mode === 'slides') setMode(narrow ? 'notes' : 'split')
      useInk.getState().setActive(true)
    } else inkHandle.current?.finish()
  }, [mode, narrow])

  const insertMarkdown = useCallback(async (md: string, slideRef?: string | null, atEnd = false) => {
    const ed = editorRef.current
    if (!ed) return
    const html = await mdToHtml(md)
    const at = atEnd ? ed.state.doc.content.size : insertPos(ed)
    const before = ed.state.doc.content.size
    ed.chain().insertContentAt(at, html).setMeta(NO_AUTOLINK, !!slideRef).run()
    if (slideRef) {
      // collega i nuovi blocchi alla slide
      const added = ed.state.doc.content.size - before
      const chain = ed.chain().setMeta(NO_AUTOLINK, true)
      ed.state.doc.forEach((node, offset) => {
        if (offset >= at - 1 && offset < at + added && !node.attrs.slide && 'slide' in node.attrs) chain.setBlockSlide(offset, slideRef)
      })
      chain.run()
    }
    if (!atEnd) toast('Inserito negli appunti')
  }, [])

  const onSnip = useCallback(
    async (blob: Blob, page: number) => {
      const ed = editorRef.current
      if (!ed || !unit) return
      const asset = await saveAsset(blob, unit.courseId)
      const fid = useViewer.getState().fileId
      const ref = fid ? encodeRef(fid, page) : null
      const node = { type: 'image', attrs: { asset, width: '100%', slide: ref, alt: `Slide ${page}` } }
      const pos = insertPos(ed)
      ed.chain().insertContentAt(pos, [node, { type: 'paragraph' }]).setMeta(NO_AUTOLINK, true).focus().run()
      toast('Ritaglio inserito negli appunti')
      if (narrow) setMode('notes')
    },
    [unit, narrow],
  )

  const slideCtx = useCallback(async (withImage = false) => {
    const { fileId, page } = useViewer.getState()
    if (!fileId) return null
    const doc = await loadPdf(fileId)
    const text = await pageText(doc, page)
    return { page, text, image: withImage ? await pageImage(doc, page) : undefined }
  }, [])

  const aiFromSlide = useCallback(
    async (m: 'notes' | 'explain' | 'questions') => {
      const s = await slideCtx(true)
      if (!s) return toast('Apri prima una slide', 'error')
      if (m === 'explain') {
        setAi(true)
        setTimeout(() => chatHandle.current?.ask(`Spiegami la slide ${s.page} in modo chiaro, con un esempio.`, { withImage: s.text.length < 80 }), 250)
        return
      }
      if (m === 'questions') {
        setAi(true)
        setTimeout(() => chatHandle.current?.ask(`Fammi 4 domande d’esame sulla slide ${s.page}, con una breve risposta per ciascuna.`), 250)
        return
      }
      setAiBusy(true)
      try {
        const useImg = s.text.replace(/\s/g, '').length < 80
        const prompt = `Trasforma il contenuto di questa slide (pagina ${s.page}) del corso "${course?.name}" in appunti di studio sintetici in italiano: concetti chiave in **grassetto**, elenchi puntati, eventuali definizioni o formule. Non aggiungere informazioni che non siano nella slide, salvo brevissimi chiarimenti. Rispondi SOLO con gli appunti in Markdown, senza titolo generale.\n\nTesto della slide:\n"""\n${s.text.slice(0, 3500)}\n"""`
        const out = await chat(
          [
            { role: 'system', content: SYSTEM_TUTOR },
            useImg && s.image
              ? { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: s.image } }] }
              : { role: 'user', content: prompt },
          ],
          { maxTokens: 2000, model: useImg ? useSettings.getState().visionModel : undefined },
        )
        const fid = useViewer.getState().fileId
        await insertMarkdown(out, fid ? encodeRef(fid, s.page) : null)
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setAiBusy(false)
      }
    },
    [slideCtx, course?.name, insertMarkdown],
  )

  // ---- appunti scritti a mano → testo ----
  const [tProgress, setTProgress] = useState<string | null>(null)
  const tCancel = useRef(false)
  const transcribe = useCallback(
    async (pages: number[]) => {
      const fid = useViewer.getState().fileId
      if (!fid || !editorRef.current) return
      tCancel.current = false
      const doc = await loadPdf(fid)
      let added = 0
      try {
        for (const [i, p] of pages.entries()) {
          if (tCancel.current) break
          setTProgress(pages.length > 1 ? `Leggo la scrittura a mano: pagina ${p} (${i + 1}/${pages.length})…` : `Leggo la scrittura a mano a pagina ${p}…`)
          const [img, printed] = await Promise.all([pageImage(doc, p, 1400), pageText(doc, p)])
          const prompt = `Questa è una slide universitaria (corso "${course?.name}") su cui lo studente ha preso appunti A MANO durante la lezione.
Il testo STAMPATO della slide è già noto, non ripeterlo:
«${printed.slice(0, 1500)}»
Trascrivi SOLO ciò che è scritto a mano (penna, matita, note), fedelmente, correggendo solo errori evidenti di lettura.
Organizzalo come appunti in Markdown (elenchi, **grassetto** per parole sottolineate o cerchiate). Se una nota si riferisce a un elemento della slide (freccia, cerchio), indica brevemente a cosa (es. "→ riferito a: Stack").
Se nella pagina non c'è NESSUNA scrittura a mano rispondi esattamente: NESSUNA`
          const out = await chat(
            [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img } }] }],
            { model: useSettings.getState().visionModel, maxTokens: 1500, temperature: 0.1, onWait: (sec) => setTProgress(`Attendo il limite gratuito di Groq (${sec}s)…`) },
          )
          const clean = out.trim()
          if (!clean || /^NESSUNA\.?$/i.test(clean)) continue
          await insertMarkdown(clean, encodeRef(fid, p), pages.length > 1)
          added++
        }
        toast(added ? `Trascritte ${added} pagin${added === 1 ? 'a' : 'e'} negli appunti` : 'Nessuna scrittura a mano trovata', added ? 'ok' : 'info')
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setTProgress(null)
      }
    },
    [course?.name, insertMarkdown],
  )

  // ponte per comandi "/" dell'editor
  useEffect(() => {
    if (!unit) return
    bridge.current = {
      courseId: unit.courseId,
      unitId: unit.id,
      startSnip: () => useViewer.getState().setSnipping(true),
      aiFromSlide: (m) => void aiFromSlide(m),
      startInk: () => useInk.getState().setActive(true),
      askAi: (t) => {
        setAi(true)
        setTimeout(() => chatHandle.current?.ask(t), 250)
      },
      pickImage: async () => {
        const [f] = await pickFiles('image/*', false)
        if (!f || !editorRef.current) return
        const asset = await saveAsset(f, unit.courseId)
        editorRef.current.chain().focus().insertContent({ type: 'image', attrs: { asset, width: '60%' } }).run()
      },
    }
    return () => {
      bridge.current = null
    }
  }, [unit, aiFromSlide])

  // scorciatoie da tastiera di questa pagina
  const drawShortcut = useCallback(
    (formula = false) => {
      const ed = editorRef.current
      if (!ed) return
      if (mode === 'slides') setMode(narrow ? 'notes' : 'split')
      const sel = ed.state.selection
      if (!formula && sel instanceof NodeSelection && sel.node.type.name === 'drawing') {
        window.dispatchEvent(new CustomEvent('ripasso:draw-activate', { detail: sel.from }))
        return
      }
      const pos = insertPos(ed)
      ed.chain()
        .focus()
        .setTextSelection(Math.min(pos, ed.state.doc.content.size))
        .insertDrawing(formula ? { height: 220, bg: 'grid' } : { height: 360, bg: 'blank' })
        .run()
    },
    [mode, narrow],
  )
  useEffect(() => {
    if (!unit) return
    const ed = () => editorRef.current
    return registerShortcuts({
      viewSplit: () => !narrow && setMode('split'),
      viewSlides: () => setMode('slides'),
      viewNotes: () => setMode('notes'),
      autoLink: () => {
        const v = !useSettings.getState().autoLink
        setS({ autoLink: v })
        toast(v ? 'Collegamento automatico attivo' : 'Collegamento automatico disattivato', 'info')
      },
      linkBlock: () => {
        const e = ed()
        const ref = currentRef()
        if (!e || !ref) return
        const { $from } = e.state.selection
        if ($from.depth < 1) return
        e.chain().setBlockSlide($from.before(1), ref).setMeta(NO_AUTOLINK, true).run()
        toast('Blocco collegato alla slide ' + useViewer.getState().page)
      },
      examBox: () => ed()?.chain().focus().setCallout('exam').run(),
      terminal: () =>
        ed()
          ?.chain()
          .focus()
          .insertContent({ type: 'codeBlock', attrs: { language: 'bash', variant: 'terminal' }, content: [{ type: 'text', text: '$ ' }] })
          .run(),
      codeBlock: () => ed()?.chain().focus().setCodeBlock({ language: 'python' }).run(),
      markDone: () => {
        void patch<Unit>('units', unit.id, { status: 'done' })
        toast('Unità segnata come studiata')
      },
      draw: toggleInk,
      drawFormula: toggleInk,
      aiChat: () => setAi((a) => !a),
      aiNotes: () => void aiFromSlide('notes'),
      aiExplain: () => void aiFromSlide('explain'),
      summary: () => nav(`/c/${unit.courseId}/riassunto`),
    })
  }, [unit, narrow, setS, drawShortcut, aiFromSlide, nav, toggleInk])

  // scorciatoie attive mentre si scrive a mano
  useEffect(() => {
    if (!inkActive) return
    const ink = useInk.getState
    const offKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) inkHandle.current?.redo()
        else inkHandle.current?.undo()
      }
    }
    window.addEventListener('keydown', offKeys, true)
    const off = registerShortcuts({
      toolPen: () => ink().set({ tool: 'pen' }),
      toolHl: () => ink().set({ tool: 'hl' }),
      toolEraser: () => ink().set({ tool: 'eraser' }),
      drawDone: () => inkHandle.current?.finish(),
      toLatex: () => void inkHandle.current?.convert('text'),
      drawFormula: () => void inkHandle.current?.convert('latex'),
    })
    return () => {
      off()
      window.removeEventListener('keydown', offKeys, true)
    }
  }, [inkActive])

  // divisore trascinabile
  const split = useRef<HTMLDivElement>(null)
  const dragDivider = (e: React.PointerEvent) => {
    e.preventDefault()
    const box = split.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => setS({ splitRatio: Math.min(0.78, Math.max(0.22, (ev.clientX - box.left) / box.width)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!data) return null
  if (!unit || unit.deleted || !course)
    return (
      <div className="page">
        <p className="opacity-60">Unità non trovata.</p>
      </div>
    )

  const showSlides = mode !== 'notes'
  const showNotes = mode !== 'slides'
  const cycleStatus = () => patch<Unit>('units', unit.id, { status: unit.status === 'todo' || !unit.status ? 'doing' : unit.status === 'doing' ? 'done' : 'todo' })

  return (
    <div className="unit-page">
      <header className="unit-bar">
        <button className="icon-btn" onClick={() => useUI.getState().setSidebar(!useUI.getState().sidebar)} title="Menu">
          <Menu size={17} />
        </button>
        <button className="icon-btn max-sm:hidden" onClick={() => nav(`/c/${course.id}`)} title="Torna al corso">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] opacity-55 truncate">
            <span className="inline-flex w-3.5 h-3.5 align-[-2px] mr-1"><CourseIcon course={course} /></span>{course.name}
          </div>
          <input
            key={unit.id + unit.title}
            className="unit-title"
            defaultValue={unit.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== unit.title && patch<Unit>('units', unit.id, { title: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <button className="icon-btn max-sm:hidden" onClick={cycleStatus} title="Stato dell’unità">
          {unit.status === 'done' ? <CheckCircle2 size={18} className="text-emerald-500" /> : unit.status === 'doing' ? <CircleDot size={18} className="text-amber-500" /> : <Circle size={18} className="opacity-40" />}
        </button>
        <div className="seg">
          {!narrow && (
            <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')} title="Diviso">
              <Columns2 size={15} />
            </button>
          )}
          <button className={mode === 'slides' ? 'on' : ''} onClick={() => setMode('slides')} title="Solo slide">
            <Presentation size={15} />
          </button>
          <button className={mode === 'notes' ? 'on' : ''} onClick={() => setMode('notes')} title="Solo appunti">
            <NotebookPen size={15} />
          </button>
        </div>
        <button
          className={`btn btn-sm ${autoLink ? 'btn-soft' : ''}`}
          onClick={() => setS({ autoLink: !autoLink })}
          title={autoLink ? 'Collegamento automatico alle slide ATTIVO: ogni nuovo paragrafo viene collegato alla slide aperta' : 'Collegamento automatico DISATTIVATO'}
        >
          {autoLink ? <Link2 size={15} /> : <Unlink size={15} />}
          <span className="hidden xl:inline">{autoLink ? 'Auto-link' : 'No link'}</span>
        </button>
        <button className={`btn btn-sm ${inkActive ? 'btn-primary' : ''}`} title="Matita: scrivi a mano ovunque sugli appunti (anche sopra il testo)" onClick={toggleInk}>
          <PencilLine size={15} /> <span className="hidden xl:inline">{inkActive ? 'Fine matita' : 'Matita'}</span>
        </button>
        <PencilModeToggle />
        <button className={`btn btn-sm ${ai ? 'btn-primary' : 'btn-ai'}`} onClick={() => setAi(!ai)}>
          {aiBusy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} <span className="hidden sm:inline">AI</span>
        </button>
      </header>

      {pdfs.length > 0 && showSlides && (
        <div className="file-tabs">
          {pdfs.map((f) => (
            <button key={f.id} className={`file-tab ${f.id === fileId ? 'on' : ''}`} onClick={() => useViewer.getState().setOpen(f.id)}>
              {f.kind === 'handwritten' && <PenLine size={12} className="inline mr-1 -mt-0.5" />}
              {f.name.replace(/\.pdf$/i, '')}
            </button>
          ))}
          <AddFileBtn unit={unit} kind="slides" />
          <AddFileBtn unit={unit} kind="handwritten" />
        </div>
      )}

      <div className={`split ${mode}`} ref={split} style={{ ['--ratio' as string]: ratio }}>
        {showSlides && (
          <section className="pane pane-slides">
            {fileId ? (
              <PdfViewer key={fileId} fileId={fileId} onSnip={onSnip} onTranscribe={transcribe} transcribing={!!tProgress} />
            ) : (
              <div className="p-5 flex flex-col gap-3 h-full justify-center">
                <Dropzone
                  onFiles={async (l) => {
                    const r = await addFiles(l, { courseId: unit.courseId, unitId: unit.id, kind: 'slides' })
                    toast(`${r.files.length} file aggiunti all’unità`)
                  }}
                  title="Carica le slide di questa unità"
                  hint="Trascina il PDF qui o clicca per sceglierlo"
                />
              </div>
            )}
          </section>
        )}
        {mode === 'split' && <div className="divider" onPointerDown={dragDivider} onDoubleClick={() => setS({ splitRatio: 0.5 })} />}
        {showNotes && (
          <section className="pane pane-notes">
            <div className="notes-scroll">
              <div className={`notes-inner ${snipping ? 'dim' : ''}`}>
                {initialNote && initialNote.id === unit.id ? (
                  <NoteEditor
                    docKey={unit.id}
                    initial={initialNote.doc}
                    onSave={saveNote}
                    fileNames={fileNames}
                    mainFileId={unit.mainFileId ?? pdfs[0]?.id}
                    remoteStamp={remoteStamp}
                    onReady={(e) => (editorRef.current = e)}
                    ink={ink}
                    onInk={saveInk}
                    inkHandle={inkHandle}
                  />
                ) : (
                  <Loader2 className="spin opacity-40 m-6" />
                )}
              </div>
            </div>
            <AnimatePresence>{inkActive && <InkBar handle={inkHandle} />}</AnimatePresence>
          </section>
        )}
        <AnimatePresence>
          {ai && (
            <AiChat
              unitId={unit.id}
              handle={chatHandle}
              onClose={() => setAi(false)}
              onInsert={(md) => {
                const fid = useViewer.getState().fileId
                void insertMarkdown(md, useSettings.getState().autoLink && fid ? encodeRef(fid, useViewer.getState().page) : null)
              }}
              ctx={{
                courseName: course.name,
                unitTitle: unit.title,
                slide: (withImage) => slideCtx(withImage),
                notes: () => editorRef.current?.getText() ?? '',
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {tProgress && (
          <motion.div className="task-pill glass-strong" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            <Loader2 size={15} className="spin text-accent" /> {tProgress}
            <button className="btn btn-sm" onClick={() => (tCancel.current = true)}>
              Annulla
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AddFileBtn({ unit, kind }: { unit: Unit; kind: 'slides' | 'handwritten' }) {
  return (
    <button
      className="file-tab add"
      title={kind === 'slides' ? 'Aggiungi un altro PDF di slide a questa unità' : 'Carica le slide annotate a mano sull’iPad (PDF esportato da GoodNotes, Notability, Note…)'}
      onClick={async () => {
        const l = await pickFiles('application/pdf,.pdf')
        if (!l.length) return
        const r = await addFiles(l, { courseId: unit.courseId, unitId: unit.id, kind })
        if (r.files[0]) useViewer.getState().setOpen(r.files[0].id)
        if (kind === 'handwritten') toast('PDF annotato caricato: usa “A mano → testo” per trascrivere la tua scrittura', 'info')
      }}
    >
      {kind === 'slides' ? (
        <Plus size={13} />
      ) : (
        <>
          <PenLine size={12} /> <span className="ml-1">Annotato</span>
        </>
      )}
    </button>
  )
}

export type { FileRec }

function InkBar({ handle }: { handle: React.MutableRefObject<InkHandle | null> }) {
  const { tool, color, hl, size, set } = useInk()
  const [busy, setBusy] = useState<string | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 400)
    return () => clearInterval(t)
  }, [])
  const h = handle.current
  const conv = async (m: 'latex' | 'text') => {
    setBusy(m)
    await h?.convert(m)
    setBusy(null)
  }
  return (
    <motion.div className="ink-bar glass-strong" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="draw-group">
        <button className={tool === 'pen' ? 'on' : ''} onClick={() => set({ tool: 'pen' })} title="Penna">
          <Pen size={16} />
        </button>
        <button className={tool === 'hl' ? 'on' : ''} onClick={() => set({ tool: 'hl' })} title="Evidenziatore">
          <Highlighter size={16} />
        </button>
        <button className={tool === 'eraser' ? 'on' : ''} onClick={() => set({ tool: 'eraser' })} title="Gomma">
          <Eraser size={16} />
        </button>
      </div>
      <div className="draw-group">
        {(tool === 'hl' ? INK_HL : INK_COLORS).map((c) => (
          <button key={c} className={`swatch ${(tool === 'hl' ? hl : color) === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set(tool === 'hl' ? { hl: c } : { color: c, tool: 'pen' })} />
        ))}
      </div>
      <div className="draw-group">
        {INK_SIZES.map((s, i) => (
          <button key={s} className={size === i ? 'on' : ''} onClick={() => set({ size: i })} title="Spessore">
            <span className="dot" style={{ width: 3 + i * 3, height: 3 + i * 3 }} />
          </button>
        ))}
      </div>
      <div className="draw-group">
        <button onClick={() => h?.undo()} disabled={!h?.canUndo} title="Annulla (⌘Z)">
          <Undo2 size={16} />
        </button>
        <button onClick={() => h?.redo()} disabled={!h?.canRedo} title="Ripeti (⌘⇧Z)">
          <Redo2 size={16} />
        </button>
      </div>
      <div className="draw-group">
        <button className="wide" onClick={() => conv('latex')} disabled={!!busy || !h?.session} title="Trasforma quello che hai appena scritto a mano in una formula LaTeX">
          {busy === 'latex' ? <Loader2 size={15} className="spin" /> : <Sigma size={15} />} Formula
        </button>
        <button className="wide" onClick={() => conv('text')} disabled={!!busy || !h?.session} title="Trasforma quello che hai appena scritto a mano in testo">
          {busy === 'text' ? <Loader2 size={15} className="spin" /> : <Type size={15} />} Testo
        </button>
      </div>
      <div className="draw-group">
        <PencilModeToggle compact />
      </div>
      <div className="draw-group">
        <button className="wide done" onClick={() => h?.finish()}>
          <Check size={15} /> Fatto
        </button>
      </div>
    </motion.div>
  )
}
