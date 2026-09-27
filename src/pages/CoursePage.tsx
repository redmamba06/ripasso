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
  Clock,
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
import { ScheduleTab } from '../components/ScheduleTab'
import { replaceFile } from '../lib/versions'
import { registerShortcuts } from '../lib/shortcuts'

const TABS = [
  { id: 'units', label: 'Units', icon: Layers },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'exam', label: 'Exam', icon: GraduationCap },
  { id: 'schedule', label: 'Schedule', icon: Clock },
  { id: 'plan', label: 'Study plan', icon: CalendarDays },
  { id: 'quiz', label: 'Quiz', icon: ListChecks },
  { id: 'summary', label: 'Summary', icon: ScrollText },
] as const

export default function CoursePage() {
  const { courseId } = useParams()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') ?? 'units'
  const nav = useNavigate()
  const [edit, setEdit] = useState(false)
  useEffect(() => registerShortcuts({ summary: () => nav(`/c/${courseId}/summary`) }), [courseId, nav])
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
        <p className="opacity-60">Course not found.</p>
      </div>
    )

  const del = async () => {
    if (!confirm(`Delete the course "${course.name}" with all its units, notes and quizzes?`)) return
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
            <span>{units.length} unit{units.length === 1 ? '' : 's'}</span>
            <span>{files.length} file{files.length === 1 ? '' : 's'}</span>
            {d != null && d >= 0 && <span className="text-accent font-medium">Exam in {d} day{d === 1 ? '' : 's'}</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setEdit(true)} title="Edit">
          <Pencil size={17} />
        </button>
        <button className="icon-btn danger" onClick={del} title="Delete course">
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
          {tab === 'units' && <UnitsTab course={course} units={units} files={files} notes={data.notes} />}
          {tab === 'files' && <FilesTab course={course} units={units} files={files} />}
          {tab === 'exam' && <ExamTab course={course} />}
          {tab === 'schedule' && <ScheduleTab course={course} />}
          {tab === 'plan' && <PlanTab course={course} units={units} quizzes={quizzes} />}
          {tab === 'quiz' && <QuizTab course={course} files={files} quizzes={quizzes} />}
          {tab === 'summary' && <SummaryTab course={course} units={units} notes={notes} />}
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
    toast(`${r.files.length} file(s) uploaded · ${r.units.length} unit(s) created`)
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
      <Dropzone onFiles={upload} title="Drop your lecture PDFs here" hint="Each PDF becomes a unit with its own notes page · or click to choose" />
      <div className="flex items-center justify-between mt-6 mb-3">
        <h2 className="section-title !mb-0">Course units</h2>
        <button
          className="btn"
          onClick={async () => {
            const u = await newUnit(course.id, `Unit ${units.length + 1}`)
            setRenaming(u.id)
          }}
        >
          <Plus size={15} /> Empty unit
        </button>
      </div>
      {units.length === 0 && <div className="empty">No units yet: upload your slide PDFs above.</div>}
      <div className="flex flex-col gap-2">
        {units.map((u, i) => {
          const uf = files.filter((f) => f.unitId === u.id)
          const n = notes.find((x) => x.unitId === u.id)
          return (
            <motion.div layout key={u.id} className="unit-row card card-hover" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
              <button onClick={() => cycle(u)} title="Status: to do → in progress → done" className="shrink-0">
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
                  {uf.length} file{uf.length === 1 ? '' : 's'} · {n?.text.trim() ? `${n.text.trim().split(/\s+/).length} words of notes` : 'no notes yet'}
                </div>
              </div>
              <div className="unit-actions">
                <button className="icon-btn sm" onClick={() => move(u, -1)} disabled={i === 0} title="Move up">
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn sm" onClick={() => move(u, 1)} disabled={i === units.length - 1} title="Move down">
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn sm" onClick={() => setRenaming(u.id)} title="Rename">
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn sm danger"
                  onClick={() => confirm(`Delete the unit "${u.title}" and its notes? (the files stay in the course)`) && deleteUnitDeep(u.id)}
                  title="Delete"
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
const KIND_LABEL: Record<FileKind, string> = { slides: 'Slides', handwritten: 'Handwritten notes', exam: 'Exam / quiz', solution: 'Solutions', material: 'Material' }

function FilesTab({ course, units, files }: { course: Course; units: Unit[]; files: FileRec[] }) {
  const nav = useNavigate()
  const upload = async (list: File[]) => {
    const r = await addFiles(list, { courseId: course.id })
    toast(`${r.files.length} file(s) uploaded`)
  }
  const open = async (f: FileRec) => {
    if (f.unitId && isPdf(f)) return nav(`/u/${f.unitId}?file=${f.id}`)
    const b = await getBlob(f.id)
    if (!b) return toast('File not available on this device yet', 'error')
    window.open(URL.createObjectURL(b), '_blank')
  }
  const groups = (Object.keys(KIND_LABEL) as FileKind[]).map((k) => ({ k, list: files.filter((f) => f.kind === k).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
  return (
    <div>
      <Dropzone onFiles={upload} title="Upload files to this course" hint="Slide PDFs, past exams, solutions, handouts… the type is detected from the file name" />
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
                        {f.pageCount ? ` · ${f.pageCount} pages` : ''}
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
                      <option value="">— no unit —</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.title}
                        </option>
                      ))}
                    </select>
                    {isPdf(f) && (
                      <button
                        className="icon-btn sm"
                        title="Upload an updated version (your notes are kept)"
                        onClick={async () => {
                          const [nf] = await pickFiles('application/pdf,.pdf', false)
                          if (!nf) return
                          toast('Uploading the new version…', 'info')
                          try {
                            const r = await replaceFile(f, nf)
                            toast(`New version of “${f.name}” uploaded${r.moved ? ` · ${r.moved} slide links updated` : ''}`)
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
                      title="Download"
                      onClick={async () => {
                        const b = await getBlob(f.id)
                        if (b) void downloadFile(f, b)
                      }}
                    >
                      <Download size={14} />
                    </button>
                    <button className="icon-btn sm danger" title="Delete" onClick={() => confirm(`Delete "${f.name}"?`) && remove('files', f.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ),
      )}
      {files.length === 0 && <div className="empty mt-6">No files uploaded yet.</div>}
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
            <div className="text-[13px] opacity-75">days to the exam</div>
          </div>
        )}
        <F k="date" label="Exam date" type="date" />
        <F k="time" label="Time" type="time" />
        <label className="block">
          <span className="label">Exam type</span>
          <select className="field" defaultValue={exam.type ?? ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">—</option>
            {['Written', 'Oral', 'Written + oral', 'Multiple choice', 'Project', 'Practical / lab', 'Computer-based'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <F k="duration" label="Duration" ph="e.g. 2 hours" />
        <F k="location" label="Room / place" ph="e.g. Room 3, Moodle" />
        <F k="materials" label="Allowed materials" ph="e.g. none, calculator, formula sheet" />
        <F k="grading" label="Grading" ph="e.g. 30 questions, +1 right −0.25 wrong" />
      </div>
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <BookOpenCheck size={17} className="text-accent" />
          <b>Exam info and topics</b>
        </div>
        <p className="text-[12.5px] opacity-55 mb-3">Syllabus, most-asked topics, professor’s tips, how to register… Type “/” for formatting.</p>
        <NoteEditor
          docKey={'exam:' + course.id}
          initial={exam.doc ?? null}
          gutter={false}
          placeholder="E.g. “The professor always asks for the proof of theorem X”…"
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
        <p className="opacity-65 text-[14px] max-w-xl">Upload past exams or quizzes as PDF (with solutions too): the AI extracts the questions exactly as they are and makes them interactive — it never invents new ones.</p>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Sparkles size={15} /> Create quiz from PDF
        </button>
      </div>
      {quizzes.length === 0 && <div className="empty">No quizzes yet.</div>}
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
                    {q.questions.length} questions · {q.questions.filter((x) => x.type === 'open').length} open · {q.questions.filter((x) => x.solutionFromPdf).length} with solution
                  </div>
                </div>
                <button className="icon-btn sm danger" onClick={() => confirm('Delete this quiz?') && remove('quizzes', q.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              {at.length > 0 && (
                <div className="text-[12.5px] opacity-70">
                  {at.length} attempt{at.length === 1 ? '' : 's'} · best {Math.round(best * 100)}%
                </div>
              )}
              <button className="btn btn-primary mt-1" onClick={() => nav(`/q/${q.id}`)}>
                <Play size={15} /> {at.length ? 'Retake' : 'Start'}
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
    setBusy('Getting ready…')
    try {
      const questions = await extractQuiz(exam, sol, (m, f) => {
        setBusy(m)
        if (f != null) setFrac(f)
      })
      if (!questions.length) throw new Error('No questions found in these PDFs.')
      const q = await put<Quiz>('quizzes', {
        id: uid(),
        courseId: course.id,
        title: title.trim() || pdfs.find((f) => f.id === exam[0])?.name.replace(/\.pdf$/i, '') || 'Quiz',
        fileIds: [...exam, ...sol],
        questions,
        createdAt: Date.now(),
        updatedAt: 0,
      })
      toast(`${questions.length} questions extracted`)
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
          <Plus size={14} /> Upload PDF…
        </button>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="New quiz from PDF" wide>
      {busy ? (
        <div className="py-10 flex flex-col items-center gap-4 text-center">
          <Loader2 size={34} className="spin text-accent" />
          <div className="font-medium">{busy}</div>
          <div className="progress w-64">
            <span style={{ width: `${Math.round(frac * 100)}%` }} />
          </div>
          <p className="text-[12.5px] opacity-55 max-w-sm">On Groq’s free plan long PDFs take a few minutes: you can keep this window open.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <input className="field" placeholder="Title (e.g. June 2025 exam)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <div className="label">1 · PDF with the questions</div>
            <Pick sel={exam} setSel={setExam} kind="exam" />
          </div>
          <div>
            <div className="label">2 · PDF with the solutions (optional, if they are in a separate file)</div>
            <Pick sel={sol} setSel={setSol} kind="sol" />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!exam.length} onClick={go}>
              <Sparkles size={15} /> Extract questions
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
        <h2 className="text-xl font-semibold">Full course summary</h2>
        <p className="opacity-65 text-[14px] mt-1 max-w-xl">
          All your unit notes merged into one document, in order, with a table of contents. It updates as you write. Export it as PDF or Markdown to revise before the exam.
        </p>
        <div className="flex gap-4 mt-3 text-[13px] opacity-75">
          <span>
            {withNotes}/{units.length} units with notes
          </span>
          <span>{words} words</span>
          <span>~{Math.max(1, Math.round(words / 200))} min read</span>
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => nav(`/c/${course.id}/summary`)}>
        <BookOpenCheck size={16} /> Open summary
      </button>
    </div>
  )
}
