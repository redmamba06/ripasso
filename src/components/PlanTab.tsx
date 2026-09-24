import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { CalendarDays, CheckCircle2, Circle, BookOpen, ListChecks, ScrollText, RotateCcw, Sparkles, Loader2, AlertTriangle, Target } from 'lucide-react'
import { db, alive, patch, put, type Course, type Unit, type Quiz } from '../lib/db'
import { buildPlan, DAY_NAMES, DEFAULT_PLAN, fmtDay, today, type Task } from '../lib/plan'
import { analyzeWeak } from '../lib/quiz'
import { toast } from './Toast'

export function TaskRow({ t, courseId }: { t: Task; courseId: string }) {
  const nav = useNavigate()
  if (t.kind === 'unit')
    return (
      <div className="task">
        <button onClick={() => patch<Unit>('units', t.unitId, { status: 'done' })} title="Segna l’unità come studiata">
          <Circle size={17} className="opacity-40" />
        </button>
        <button className="flex-1 text-left min-w-0" onClick={() => nav(`/u/${t.unitId}`)}>
          <span className="block truncate font-medium text-[14px]">{t.title}</span>
          {t.part && <span className="block text-[12px] opacity-55">{t.part}</span>}
        </button>
        <BookOpen size={15} className="opacity-40" />
      </div>
    )
  const icon = t.kind === 'quiz' ? <ListChecks size={15} /> : t.kind === 'summary' ? <ScrollText size={15} /> : <RotateCcw size={15} />
  const go = () => (t.kind === 'quiz' ? nav(`/q/${t.quizId}`) : t.kind === 'summary' ? nav(`/c/${courseId}/riassunto`) : nav(`/c/${courseId}?tab=quiz`))
  return (
    <button className="task text-left w-full" onClick={go}>
      <span className="text-accent">{icon}</span>
      <span className="flex-1 text-[14px]">{t.title}</span>
    </button>
  )
}

export function PlanTab({ course, units, quizzes }: { course: Course; units: Unit[]; quizzes: Quiz[] }) {
  const [, setSp] = useSearchParams()
  const ps = course.plan ?? DEFAULT_PLAN
  const plan = useMemo(() => buildPlan(course, units, quizzes, ps), [course, units, quizzes, ps])
  const attempts = useLiveQuery(async () => alive(await db.attempts.where('courseId').equals(course.id).toArray()), [course.id]) ?? []
  const [busy, setBusy] = useState(false)
  const t = today()
  const done = units.filter((u) => u.status === 'done').length

  const setPs = (p: Partial<typeof ps>) => put<Course>('courses', { ...course, plan: { ...ps, ...p } })

  const analyze = async () => {
    setBusy(true)
    try {
      const topics = await analyzeWeak(course.name, units, quizzes, attempts)
      if (!topics.length) toast('Nessun errore da analizzare: fai prima qualche quiz', 'info')
      await put<Course>('courses', { ...course, weak: { at: Date.now(), topics } })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (plan.noDate)
    return (
      <div className="empty flex flex-col items-center gap-3">
        <CalendarDays size={28} className="text-accent" />
        <div>Imposta la data dell’esame per generare il piano di studio.</div>
        <button className="btn btn-primary" onClick={() => setSp({ tab: 'esame' }, { replace: true })}>
          Imposta data esame
        </button>
      </div>
    )

  // raggruppa per settimana
  const weeks: { label: string; days: typeof plan.days }[] = []
  for (const d of plan.days) {
    const dt = new Date(d.date + 'T00:00:00')
    const monday = new Date(dt)
    monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
    const label = 'Settimana del ' + monday.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })
    let w = weeks[weeks.length - 1]
    if (!w || w.label !== label) weeks.push((w = { label, days: [] }))
    w.days.push(d)
  }

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-5">
      <div className="flex flex-col gap-4">
        <div className="card">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <div className="text-3xl font-bold">
                {done}/{units.length}
              </div>
              <div className="text-[12px] opacity-60">unità studiate</div>
            </div>
            <div>
              <div className="text-3xl font-bold">{plan.days.length}</div>
              <div className="text-[12px] opacity-60">giorni di studio</div>
            </div>
          </div>
          <div className="progress mt-4">
            <span style={{ width: `${units.length ? (done / units.length) * 100 : 0}%` }} />
          </div>
          {plan.perDay > 1.5 && (
            <div className="warn mt-3">
              <AlertTriangle size={15} /> Ritmo alto: ~{plan.perDay.toFixed(1)} unità al giorno. Aggiungi giorni di studio o riduci il ripasso finale.
            </div>
          )}
          {plan.tooLate && <div className="warn mt-3">L’esame è già passato: aggiorna la data.</div>}
        </div>

        <div className="card">
          <div className="label">Giorni in cui studi</div>
          <div className="flex gap-1.5">
            {DAY_NAMES.map((n, i) => (
              <button
                key={i}
                className={`day-pick ${ps.studyDays.includes(i) ? 'on' : ''}`}
                onClick={() => setPs({ studyDays: ps.studyDays.includes(i) ? ps.studyDays.filter((x) => x !== i) : [...ps.studyDays, i].sort() })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="label mt-4">Giorni di ripasso finale: {ps.reviewDays}</div>
          <input type="range" min={0} max={10} value={ps.reviewDays} onChange={(e) => setPs({ reviewDays: +e.target.value })} className="w-full accent-[var(--accent)]" />
          <p className="text-[12px] opacity-55 mt-2">Il piano si ricalcola ogni giorno: segna le unità come studiate e il resto viene ridistribuito.</p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Target size={16} className="text-accent" />
            <b className="flex-1">Punti deboli</b>
            <button className="btn btn-sm btn-ai" onClick={analyze} disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Analizza
            </button>
          </div>
          {!course.weak?.topics.length ? (
            <p className="text-[12.5px] opacity-60">Dopo aver fatto qualche quiz, l’AI raggruppa i tuoi errori per argomento e ti dice cosa ripassare.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {course.weak.topics.map((w, i) => (
                <div key={i} className="weak">
                  <div className="flex items-center gap-2">
                    <b className="text-[13.5px] flex-1">{w.topic}</b>
                    <span className="pill">{w.errors} errori</span>
                  </div>
                  {w.units.length > 0 && <div className="text-[12px] opacity-65 mt-0.5">Ripassa: {w.units.join(', ')}</div>}
                  <div className="text-[12.5px] mt-1 opacity-85">{w.tip}</div>
                </div>
              ))}
              <div className="text-[11px] opacity-45">Analisi del {new Date(course.weak.at).toLocaleDateString('it-IT')}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {weeks.map((w) => (
          <section key={w.label}>
            <h3 className="section-title">{w.label}</h3>
            <div className="flex flex-col gap-2">
              {w.days.map((d, i) => (
                <motion.div
                  key={d.date}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.03 }}
                  className={`plan-day card ${d.date === t ? 'today' : ''} ${d.review ? 'review' : ''}`}
                >
                  <div className="plan-date">
                    <b>{fmtDay(d.date)}</b>
                    {d.review && <span className="pill soft">ripasso</span>}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {d.tasks.map((tk, k) => (
                      <TaskRow key={k} t={tk} courseId={course.id} />
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        ))}
        {units.filter((u) => u.status === 'done').length > 0 && (
          <section>
            <h3 className="section-title">Già studiate</h3>
            <div className="flex flex-wrap gap-2">
              {units
                .filter((u) => u.status === 'done')
                .map((u) => (
                  <button key={u.id} className="chip on" onClick={() => patch<Unit>('units', u.id, { status: 'todo' })} title="Clic per rimetterla da studiare">
                    <CheckCircle2 size={12} /> {u.title}
                  </button>
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
