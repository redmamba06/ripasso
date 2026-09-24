import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { motion } from 'motion/react'
import { Plus, CalendarClock, ArrowRight, Sparkles, KeyRound, CalendarCheck } from 'lucide-react'
import { buildPlan, today } from '../lib/plan'
import { TaskRow } from '../components/PlanTab'
import { db, alive, type Course } from '../lib/db'
import { CourseForm } from '../components/CourseForm'
import { useSettings } from '../lib/settings'

export function daysTo(date?: string) {
  if (!date) return null
  const d = new Date(date + 'T00:00:00')
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}

const greet = () => {
  const h = new Date().getHours()
  return h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'
}

export default function Home() {
  const nav = useNavigate()
  const [newCourse, setNewCourse] = useState(false)
  const groqKey = useSettings((s) => s.groqKey)
  const data = useLiveQuery(async () => {
    const courses = alive(await db.courses.orderBy('order').toArray())
    const units = alive(await db.units.toArray())
    const notes = alive(await db.notes.toArray())
    const quizzes = alive(await db.quizzes.toArray())
    return { courses, units, notes, quizzes }
  }, [])
  if (!data) return null
  const { courses, units, notes, quizzes } = data
  const todayTasks = courses
    .map((c) => {
      const p = buildPlan(
        c,
        units.filter((u) => u.courseId === c.id).sort((a, b) => a.order - b.order),
        quizzes.filter((q) => q.courseId === c.id),
      )
      return { c, day: p.days.find((d) => d.date === today()) }
    })
    .filter((x) => x.day && x.day.tasks.length)
  const exams = courses
    .map((c) => ({ c, d: daysTo(c.exam?.date) }))
    .filter((x) => x.d != null && x.d >= 0)
    .sort((a, b) => a.d! - b.d!)
  const recent = [...notes]
    .filter((n) => n.text.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)
    .map((n) => ({ n, u: units.find((u) => u.id === n.unitId), c: courses.find((c) => c.id === n.courseId) }))
    .filter((x) => x.u && x.c)

  const progress = (c: Course) => {
    const cu = units.filter((u) => u.courseId === c.id)
    const done = cu.filter((u) => u.status === 'done').length
    const withNotes = cu.filter((u) => notes.find((n) => n.unitId === u.id)?.text.trim()).length
    return { total: cu.length, done, withNotes }
  }

  return (
    <div className="page">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="text-[13px] font-medium text-accent mb-1">{new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{greet()} 👋</h1>
        <p className="opacity-60 mt-1">Riprendi gli appunti, ripassa e preparati agli esami.</p>
      </motion.header>

      {!groqKey && (
        <button className="banner mb-6" onClick={() => nav('/settings')}>
          <KeyRound size={18} /> Aggiungi la chiave Groq nelle impostazioni per usare l’AI <ArrowRight size={16} className="ml-auto" />
        </button>
      )}

      {exams.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title">
            <CalendarClock size={16} /> Prossimi esami
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {exams.map(({ c, d }, i) => (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="exam-card snap-start"
                style={{ ['--c' as string]: c.color }}
                onClick={() => nav(`/c/${c.id}?tab=esame`)}
              >
                <div className="text-[34px] font-bold leading-none">{d === 0 ? 'Oggi' : d}</div>
                <div className="text-[12px] opacity-70 mb-3">{d === 0 ? '' : d === 1 ? 'giorno' : 'giorni'}</div>
                <div className="font-medium truncate">
                  {c.emoji} {c.name}
                </div>
                <div className="text-[12px] opacity-60">
                  {new Date(c.exam!.date + 'T00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                  {c.exam?.type ? ` · ${c.exam.type}` : ''}
                </div>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {todayTasks.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title">
            <CalendarCheck size={16} /> Oggi da studiare
          </h2>
          <div className="grid md:grid-cols-2 gap-3">
            {todayTasks.map(({ c, day }) => (
              <div key={c.id} className="card" style={{ ['--c' as string]: c.color }}>
                <button className="flex items-center gap-2 mb-2 w-full text-left" onClick={() => nav(`/c/${c.id}?tab=piano`)}>
                  <span className="course-dot" style={{ background: c.color }}>
                    {c.emoji}
                  </span>
                  <b className="flex-1 truncate">{c.name}</b>
                  {day!.review && <span className="pill soft">ripasso finale</span>}
                </button>
                <div className="flex flex-col gap-1">
                  {day!.tasks.map((t, k) => (
                    <TaskRow key={k} t={t} courseId={c.id} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title">
            <Sparkles size={16} /> Continua da dove eri
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {recent.map(({ n, u, c }) => (
              <button key={n.id} className="card card-hover text-left flex gap-3 items-center" onClick={() => nav(`/u/${u!.id}`)}>
                <span className="course-badge" style={{ background: c!.color }}>
                  {c!.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{u!.title}</span>
                  <span className="block text-[12.5px] opacity-55 truncate">{n.text.slice(0, 90)}</span>
                </span>
                <ArrowRight size={16} className="opacity-40" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">I tuoi corsi</h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((c, i) => {
            const p = progress(c)
            const pct = p.total ? Math.round((p.withNotes / p.total) * 100) : 0
            return (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 * i }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                className="course-card"
                style={{ ['--c' as string]: c.color }}
                onClick={() => nav(`/c/${c.id}`)}
              >
                <div className="flex items-start justify-between">
                  <span className="course-badge big">{c.emoji}</span>
                  {daysTo(c.exam?.date) != null && daysTo(c.exam?.date)! >= 0 && <span className="pill">esame tra {daysTo(c.exam?.date)} gg</span>}
                </div>
                <div className="mt-4 font-semibold text-[17px] leading-tight">{c.name}</div>
                {c.professor && <div className="text-[12.5px] opacity-55">{c.professor}</div>}
                <div className="mt-auto pt-4 flex items-center justify-between text-[12px] opacity-70">
                  <span>{p.total} unità</span>
                  <span>{pct}% con appunti</span>
                </div>
                <div className="progress mt-1.5">
                  <motion.span initial={{ width: 0 }} animate={{ width: pct + '%' }} transition={{ duration: 0.8, delay: 0.2 }} />
                </div>
              </motion.button>
            )
          })}
          <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} className="course-card new" onClick={() => setNewCourse(true)}>
            <Plus size={26} />
            <span className="font-medium mt-2">Nuovo corso</span>
          </motion.button>
        </div>
      </section>
      <CourseForm open={newCourse} onClose={() => setNewCourse(false)} />
    </div>
  )
}
