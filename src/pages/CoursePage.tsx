import { CourseIcon } from '../components/CourseIcon'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Pencil,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  FileText,
  BookOpenCheck,
  GraduationCap,
  Files,
  Layers,
  ListChecks,
  Download,
  CheckCircle2,
  Circle,
  CircleDot,
  Sparkles,
  Loader2,
  Play,
  ScrollText,
  CalendarDays,
  RefreshCw,
} from 'lucide-react'
import { db, alive, put, patch, remove, uid, deleteCourseDeep, deleteUnitDeep, type Course, type Unit, type FileRec, type FileKind, type Quiz } from '../lib/db'
import { addFiles, newUnit, fmtSize, downloadFile, isPdf } from '../lib/files'
import { getBlob } from '../lib/sync'
import { Dropzone, pickFiles } from '../components/Dropzone'
import { CourseForm } from '../components/CourseForm'
import { NoteEditor } from '../editor/NoteEditor'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { extractQuiz } from '../lib/quiz'
import { daysTo } from './Home'
import { PlanTab } from '../components/PlanTab'
import { replaceFile } from '../lib/versions'
import { registerShortcuts } from '../lib/shortcuts'

const TABS = [
  { id: 'unita', label: 'Unità', icon: Layers },
  { id: 'file', label: 'File', icon: Files },
  { id: 'esame', label: 'Esame', icon: GraduationCap },
  { id: 'piano', label: 'Piano', icon: CalendarDays },
  { id: 'quiz', label: 'Quiz', icon: ListChecks },
  { id: 'riassunto', label: 'Riassunto', icon: ScrollText },
] as const

export default function CoursePage() {
  const { courseId } = useParams()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') ?? 'unita'
  const nav = useNavigate()
  const [edit, setEdit] = useState(false)
  useEffect(() => registerShortcuts({ summary: () => nav(`/c/${courseId}/riassunto`) }), [courseId, nav])
  const data = useLiveQuery(async () => {
    const course = await db.courses.get(courseId!)
    const units = alive(await db.units.where('courseId').equals(courseId!).toArray()).sort((a, b) => a.order - b.order)
    const files = alive(await db.files.where('courseId').equals(courseId!).toArray())
    const notes = alive(await db.notes.where('courseId').equals(courseId!).toArray())
    const quizzes = alive(await db.quizzes.where('courseId').equals(courseId!).toArray()).sort((a, b) => b.createdAt - a.createdAt)
    return { course, units, files, notes, quizzes }
  }, [courseId])
  if (!data) return null
  const { course, units, files, notes, quizzes } = data
  if (!course || course.deleted)
    return (
      <div className="page">
        <p className="opacity-60">Corso non trovato.</p>
      </div>
    )

  const del = async () => {
    if (!confirm(`Eliminare il corso "${course.name}" con tutte le unità, gli appunti e i quiz?`)) return
    await deleteCourseDeep(course.id)
    nav('/')
  }
  const d = daysTo(course.exam?.date)

  return (
    <div className="page">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="course-hero" style={{ ['--c' as string]: course.color }}>
        <span className="course-badge xl"><CourseIcon course={course} /></span>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight truncate">{course.name}</h1>
          <div className="text-[13.5px] opacity-65 flex flex-wrap gap-x-3">
            {course.professor && <span>{course.professor}</span>}
            <span>{units.length} unità</span>
            <span>{files.length} file</span>
            {d != null && d >= 0 && <span className="text-accent font-medium">Esame tra {d} giorni</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setEdit(true)} title="Modifica">
          <Pencil size={17} />
        </button>
        <button className="icon-btn danger" onClick={del} title="Elimina corso">
          <Trash2 size={17} />
        </button>
      </motion.header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setSp({ tab: t.id }, { replace: true })}>
            {tab === t.id && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: 'spring', damping: 30, stiffness: 400 }} />}
            <t.icon size={15} /> <span>{t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
          {tab === 'unita' && <UnitsTab course={course} units={units} files={files} notes={data.notes} />}
          {tab === 'file' && <FilesTab course={course} units={units} files={files} />}
          {tab === 'esame' && <ExamTab course={course} />}
          {tab === 'piano' && <PlanTab course={course} units={units} quizzes={quizzes} />}
          {tab === 'quiz' && <QuizTab course={course} files={files} quizzes={quizzes} />}
          {tab === 'riassunto' && <SummaryTab course={course} units={units} notes={notes} />}
        </motion.div>
      </AnimatePresence>
      <CourseForm open={edit} onClose={() => setEdit(false)} course={course} />
    </div>
  )
}

// ------------------------------------------------------------------ Unità
function UnitsTab({ course, units, files, notes }: { course: Course; units: Unit[]; files: FileRec[]; notes: { unitId: string; text: string }[] }) {
  const nav = useNavigate()
  const [renaming, setRenaming] = useState<string | null>(null)
  const upload = async (list: File[]) => {
    const r = await addFiles(list, { courseId: course.id, autoUnits: true })
    toast(`${r.files.length} file caricati · ${r.units.length} unità create`)
  }
  const move = async (u: Unit, dir: -1 | 1) => {
    const i = units.indexOf(u)
    const o = units[i + dir]
    if (!o) return
    await patch<Unit>('units', u.id, { order: o.order })
    await patch<Unit>('units', o.id, { order: u.order })
  }
  const cycle = (u: Unit) => patch<Unit>('units', u.id, { status: u.status === 'todo' || !u.status ? 'doing' : u.status === 'doing' ? 'done' : 'todo' })
  const StatusIcon = ({ s }: { s?: string }) => (s === 'done' ? <CheckCircle2 size={18} className="text-emerald-500" /> : s === 'doing' ? <CircleDot size={18} className="text-amber-500" /> : <Circle size={18} className="opacity-35" />)

  return (
    <div>
      <Dropzone onFiles={upload} title="Trascina qui i PDF delle lezioni" hint="Ogni PDF diventa un’unità con la sua pagina di appunti · clicca per sceglierli" />
      <div className="flex items-center justify-between mt-6 mb-3">
        <h2 className="section-title !mb-0">Unità del corso</h2>
        <button
          className="btn"
          onClick={async () => {
            const u = await newUnit(course.id, `Unità ${units.length + 1}`)
            setRenaming(u.id)
          }}
        >
          <Plus size={15} /> Unità vuota
        </button>
      </div>
      {units.length === 0 && <div className="empty">Nessuna unità: carica i PDF delle slide qui sopra.</div>}
      <div className="flex flex-col gap-2">
        {units.map((u, i) => {
          const uf = files.filter((f) => f.unitId === u.id)
          const n = notes.find((x) => x.unitId === u.id)
          return (
            <motion.div layout key={u.id} className="unit-row card card-hover" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
              <button onClick={() => cycle(u)} title="Stato: da fare → in corso → fatto" className="shrink-0">
                <StatusIcon s={u.status} />
              </button>
              <span className="unit-num">{i + 1}</span>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => renaming !== u.id && nav(`/u/${u.id}`)}>
                {renaming === u.id ? (
                  <input
                    className="field py-1"
                    autoFocus
                    defaultValue={u.title}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      void patch<Unit>('units', u.id, { title: e.target.value.trim() || u.title })
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <div className="font-medium truncate">{u.title}</div>
                )}
                <div className="text-[12px] opacity-55 truncate">
                  {uf.length} file · {n?.text.trim() ? `${n.text.trim().split(/\s+/).length} parole di appunti` : 'nessun appunto'}
                </div>
              </div>
              <div className="unit-actions">
                <button className="icon-btn sm" onClick={() => move(u, -1)} disabled={i === 0} title="Su">
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn sm" onClick={() => move(u, 1)} disabled={i === units.length - 1} title="Giù">
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn sm" onClick={() => setRenaming(u.id)} title="Rinomina">
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn sm danger"
                  onClick={() => confirm(`Eliminare l’unità "${u.title}" e i suoi appunti? (i file restano nel corso)`) && deleteUnitDeep(u.id)}
                  title="Elimina"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ File
const KIND_LABEL: Record<FileKind, string> = { slides: 'Slide', handwritten: 'Annotate a mano', exam: 'Esame / quiz', solution: 'Soluzioni', material: 'Materiale' }

function FilesTab({ course, units, files }: { course: Course; units: Unit[]; files: FileRec[] }) {
  const nav = useNavigate()
  const upload = async (list: File[]) => {
    const r = await addFiles(list, { courseId: course.id })
    toast(`${r.files.length} file caricati`)
  }
  const open = async (f: FileRec) => {
    if (f.unitId && isPdf(f)) return nav(`/u/${f.unitId}?file=${f.id}`)
    const b = await getBlob(f.id)
    if (!b) return toast('File non ancora disponibile su questo dispositivo', 'error')
    window.open(URL.createObjectURL(b), '_blank')
  }
  const groups = (Object.keys(KIND_LABEL) as FileKind[]).map((k) => ({ k, list: files.filter((f) => f.kind === k).sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true })) }))
  return (
    <div>
      <Dropzone onFiles={upload} title="Carica file nel corso" hint="PDF di slide, esami passati, soluzioni, dispense… il tipo viene riconosciuto dal nome" />
      {groups.map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.k} className="mt-6">
              <h2 className="section-title">
                {KIND_LABEL[g.k]} <span className="opacity-45 font-normal">({g.list.length})</span>
              </h2>
              <div className="flex flex-col gap-2">
                {g.list.map((f) => (
                  <div key={f.id} className="file-row card">
                    <FileText size={18} className="text-accent shrink-0" />
                    <button className="flex-1 min-w-0 text-left" onClick={() => open(f)}>
                      <div className="truncate font-medium text-[14px]">{f.name}</div>
                      <div className="text-[12px] opacity-55">
                        {fmtSize(f.size)}
                        {f.pageCount ? ` · ${f.pageCount} pagine` : ''}
                        {f.uploaded ? ' · ☁︎' : ''}
                      </div>
                    </button>
                    <select className="field sel-sm" value={f.kind} onChange={(e) => patch<FileRec>('files', f.id, { kind: e.target.value as FileKind })}>
                      {Object.entries(KIND_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <select
                      className="field sel-sm hidden sm:block"
                      value={f.unitId ?? ''}
                      onChange={async (e) => {
                        const unitId = e.target.value || null
                        await patch<FileRec>('files', f.id, { unitId })
                        if (unitId) {
                          const u = units.find((x) => x.id === unitId)
                          if (u && !u.mainFileId && isPdf(f)) await patch<Unit>('units', u.id, { mainFileId: f.id })
                        }
                      }}
                    >
                      <option value="">— nessuna unità —</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.title}
                        </option>
                      ))}
                    </select>
                    {isPdf(f) && (
                      <button
                        className="icon-btn sm"
                        title="Carica una versione aggiornata (gli appunti restano)"
                        onClick={async () => {
                          const [nf] = await pickFiles('application/pdf,.pdf', false)
                          if (!nf) return
                          toast('Carico la nuova versione…', 'info')
                          try {
                            const r = await replaceFile(f, nf)
                            toast(`Nuova versione di “${f.name}” caricata${r.moved ? ` · ${r.moved} collegamenti aggiornati` : ''}`)
                          } catch (e) {
                            toast((e as Error).message, 'error')
                          }
                        }}
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    <button
                      className="icon-btn sm"
                      title="Scarica"
                      onClick={async () => {
                        const b = await getBlob(f.id)
                        if (b) void downloadFile(f, b)
                      }}
                    >
                      <Download size={14} />
                    </button>
                    <button className="icon-btn sm danger" title="Elimina" onClick={() => confirm(`Eliminare "${f.name}"?`) && remove('files', f.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ),
      )}
      {files.length === 0 && <div className="empty mt-6">Nessun file caricato.</div>}
    </div>
  )
}

// ------------------------------------------------------------------ Esame
function ExamTab({ course }: { course: Course }) {
  const exam = course.exam ?? {}
  const set = (k: string, v: string) => put<Course>('courses', { ...course, exam: { ...exam, [k]: v } })
  const F = ({ k, label, ph, type = 'text' }: { k: keyof typeof exam; label: string; ph?: string; type?: string }) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field" type={type} placeholder={ph} defaultValue={(exam[k] as string) ?? ''} onBlur={(e) => e.target.value !== (exam[k] ?? '') && set(k, e.target.value)} />
    </label>
  )
  const d = daysTo(exam.date)
  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5">
      <div className="card flex flex-col gap-3 h-fit">
        {d != null && d >= 0 && (
          <div className="countdown" style={{ ['--c' as string]: course.color }}>
            <div className="text-4xl font-bold">{d}</div>
            <div className="text-[13px] opacity-75">giorni all’esame</div>
          </div>
        )}
        <F k="date" label="Data esame" type="date" />
        <F k="time" label="Ora" type="time" />
        <label className="block">
          <span className="label">Tipo di esame</span>
          <select className="field" defaultValue={exam.type ?? ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">—</option>
            {['Scritto', 'Orale', 'Scritto + orale', 'Quiz a crocette', 'Progetto', 'Pratico / laboratorio', 'Esame al computer'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <F k="duration" label="Durata" ph="es. 2 ore" />
        <F k="location" label="Aula / luogo" ph="es. Aula 3, piattaforma Moodle" />
        <F k="materials" label="Materiale ammesso" ph="es. nessuno, calcolatrice, formulario" />
        <F k="grading" label="Valutazione" ph="es. 30 domande, +1 giusta −0.25 sbagliata" />
      </div>
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <BookOpenCheck size={17} className="text-accent" />
          <b>Informazioni e argomenti d’esame</b>
        </div>
        <p className="text-[12.5px] opacity-55 mb-3">Programma, argomenti più chiesti, consigli del professore, modalità d’iscrizione… Usa “/” per formattare.</p>
        <NoteEditor
          docKey={'exam:' + course.id}
          initial={exam.doc ?? null}
          gutter={false}
          placeholder="Es. “Il prof chiede sempre la dimostrazione del teorema X”…"
          onSave={(doc) => put<Course>('courses', { ...course, exam: { ...(course.exam ?? {}), doc } })}
        />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Quiz
function QuizTab({ course, files, quizzes }: { course: Course; files: FileRec[]; quizzes: Quiz[] }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const attempts = useLiveQuery(async () => alive(await db.attempts.where('courseId').equals(course.id).toArray()), [course.id]) ?? []
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="opacity-65 text-[14px] max-w-xl">Carica esami passati o quiz in PDF (anche con le soluzioni): l’AI estrae le domande così come sono e le rende interattive, senza inventarne di nuove.</p>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Sparkles size={15} /> Crea quiz da PDF
        </button>
      </div>
      {quizzes.length === 0 && <div className="empty">Ancora nessun quiz.</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        {quizzes.map((q) => {
          const at = attempts.filter((a) => a.quizId === q.id && a.finishedAt).sort((a, b) => b.finishedAt! - a.finishedAt!)
          const best = at.reduce((m, a) => Math.max(m, a.total ? a.score / a.total : 0), 0)
          return (
            <motion.div key={q.id} className="card card-hover flex flex-col gap-2" whileHover={{ y: -2 }}>
              <div className="flex items-start gap-2">
                <ListChecks size={18} className="text-accent mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{q.title}</div>
                  <div className="text-[12.5px] opacity-55">
                    {q.questions.length} domande · {q.questions.filter((x) => x.type === 'open').length} aperte · {q.questions.filter((x) => x.solutionFromPdf).length} con soluzione
                  </div>
                </div>
                <button className="icon-btn sm danger" onClick={() => confirm('Eliminare il quiz?') && remove('quizzes', q.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              {at.length > 0 && (
                <div className="text-[12.5px] opacity-70">
                  {at.length} tentativ{at.length === 1 ? 'o' : 'i'} · migliore {Math.round(best * 100)}%
                </div>
              )}
              <button className="btn btn-primary mt-1" onClick={() => nav(`/q/${q.id}`)}>
                <Play size={15} /> {at.length ? 'Rifai' : 'Inizia'}
              </button>
            </motion.div>
          )
        })}
      </div>
      <NewQuizModal open={open} onClose={() => setOpen(false)} course={course} files={files} />
    </div>
  )
}

function NewQuizModal({ open, onClose, course, files }: { open: boolean; onClose: () => void; course: Course; files: FileRec[] }) {
  const nav = useNavigate()
  const pdfs = files.filter(isPdf)
  const [exam, setExam] = useState<string[]>([])
  const [sol, setSol] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [frac, setFrac] = useState(0)

  const uploadTo = async (which: 'exam' | 'sol') => {
    const list = await pickFiles('application/pdf,.pdf')
    if (!list.length) return
    const r = await addFiles(list, { courseId: course.id, kind: which === 'exam' ? 'exam' : 'solution' })
    const ids = r.files.map((f) => f.id)
    if (which === 'exam') {
      setExam((x) => [...x, ...ids])
      if (!title) setTitle(r.files[0].name.replace(/\.pdf$/i, ''))
    } else setSol((x) => [...x, ...ids])
  }

  const go = async () => {
    if (!exam.length) return
    setBusy('Preparo…')
    try {
      const questions = await extractQuiz(exam, sol, (m, f) => {
        setBusy(m)
        if (f != null) setFrac(f)
      })
      if (!questions.length) throw new Error('Non ho trovato domande in questi PDF.')
      const q = await put<Quiz>('quizzes', {
        id: uid(),
        courseId: course.id,
        title: title.trim() || pdfs.find((f) => f.id === exam[0])?.name.replace(/\.pdf$/i, '') || 'Quiz',
        fileIds: [...exam, ...sol],
        questions,
        createdAt: Date.now(),
        updatedAt: 0,
      })
      toast(`${questions.length} domande estratte`)
      onClose()
      nav(`/q/${q.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
      setFrac(0)
    }
  }

  const Pick = ({ sel, setSel, kind }: { sel: string[]; setSel: (f: (x: string[]) => string[]) => void; kind: 'exam' | 'sol' }) => {
    const list = pdfs.sort((a, b) => {
      const pref = kind === 'exam' ? 'exam' : 'solution'
      return (b.kind === pref ? 1 : 0) - (a.kind === pref ? 1 : 0)
    })
    return (
      <div className="pick-list">
        {list.map((f) => (
          <label key={f.id} className={`pick ${sel.includes(f.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.includes(f.id)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, f.id] : x.filter((y) => y !== f.id)))} />
            <span className="truncate flex-1">{f.name}</span>
            <span className="text-[11px] opacity-50">{KIND_LABEL[f.kind]}</span>
          </label>
        ))}
        <button className="pick add" onClick={() => uploadTo(kind)}>
          <Plus size={14} /> Carica PDF…
        </button>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Nuovo quiz da PDF" wide>
      {busy ? (
        <div className="py-10 flex flex-col items-center gap-4 text-center">
          <Loader2 size={34} className="spin text-accent" />
          <div className="font-medium">{busy}</div>
          <div className="progress w-64">
            <span style={{ width: `${Math.round(frac * 100)}%` }} />
          </div>
          <p className="text-[12.5px] opacity-55 max-w-sm">Con il piano gratuito di Groq i PDF lunghi richiedono qualche minuto: puoi lasciare aperta questa finestra.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <input className="field" placeholder="Titolo (es. Appello giugno 2025)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <div className="label">1 · PDF con le domande</div>
            <Pick sel={exam} setSel={setExam} kind="exam" />
          </div>
          <div>
            <div className="label">2 · PDF con le soluzioni (facoltativo, se sono in un file separato)</div>
            <Pick sel={sol} setSel={setSol} kind="sol" />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Annulla
            </button>
            <button className="btn btn-primary" disabled={!exam.length} onClick={go}>
              <Sparkles size={15} /> Estrai domande
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ Riassunto
function SummaryTab({ course, units, notes }: { course: Course; units: Unit[]; notes: { unitId: string; text: string }[] }) {
  const nav = useNavigate()
  const words = notes.reduce((s, n) => s + (n.text.trim() ? n.text.trim().split(/\s+/).length : 0), 0)
  const withNotes = units.filter((u) => notes.find((n) => n.unitId === u.id)?.text.trim()).length
  return (
    <div className="card flex flex-col md:flex-row gap-6 items-start md:items-center">
      <div className="summary-art" style={{ ['--c' as string]: course.color }}>
        <ScrollText size={40} />
      </div>
      <div className="flex-1">
        <h2 className="text-xl font-semibold">Riassunto completo del corso</h2>
        <p className="opacity-65 text-[14px] mt-1 max-w-xl">
          Tutti gli appunti delle unità uniti in un unico documento, in ordine, con indice. Si aggiorna da solo mentre scrivi. Puoi esportarlo in PDF o Markdown per ripassare prima dell’esame.
        </p>
        <div className="flex gap-4 mt-3 text-[13px] opacity-75">
          <span>
            {withNotes}/{units.length} unità con appunti
          </span>
          <span>{words} parole</span>
          <span>~{Math.max(1, Math.round(words / 200))} min di lettura</span>
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => nav(`/c/${course.id}/riassunto`)}>
        <BookOpenCheck size={16} /> Apri riassunto
      </button>
    </div>
  )
}
