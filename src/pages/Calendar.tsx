import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, CalendarDays, Download, Link2, Copy, Check, RefreshCw, Loader2 } from 'lucide-react'
import { db, alive, type Course } from '../lib/db'
import { buildIcs, SESSION_LABEL, toMin, activeOn, type ClassSession } from '../lib/ics'
import { download } from '../lib/export'
import { useSync } from '../lib/sync'
import { feedUrl, googleAddUrl, webcalUrl } from '../lib/calfeed'
import { WeekGrid, type GridEvent } from '../components/WeekGrid'
import { SessionEditor, TYPE_BADGE, tz } from '../components/ScheduleTab'
import { CourseIcon } from '../components/CourseIcon'
import { toast } from '../components/Toast'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export default function CalendarPage() {
  const nav = useNavigate()
  const courses = useLiveQuery(async () => alive(await db.courses.orderBy('order').toArray()), []) ?? []
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const [editing, setEditing] = useState<{ course: Course; session: Partial<ClassSession> } | null>(null)
  const user = useSync((s) => s.user)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week)
    d.setDate(d.getDate() + i)
    return d
  })

  const { events, allDay } = useMemo(() => {
    const ev: GridEvent[] = []
    const ad: Record<number, { key: string; label: string; color: string; onClick?: () => void }[]> = {}
    for (const c of courses) {
      for (const s of c.schedule ?? []) {
        if (!activeOn(c, s, iso(days[s.day]))) continue
        ev.push({
          key: c.id + s.id,
          day: s.day,
          start: toMin(s.start),
          end: toMin(s.end),
          title: c.name,
          badge: TYPE_BADGE[s.type],
          sub: [SESSION_LABEL[s.type], s.room].filter(Boolean).join(' · '),
          color: c.color,
          dashed: s.type !== 'lecture',
          onClick: () => setEditing({ course: c, session: s }),
        })
      }
      const ed = c.exam?.date
      const di = ed ? days.findIndex((d) => iso(d) === ed) : -1
      if (di >= 0) {
        if (c.exam?.time) {
          const st = toMin(c.exam.time)
          ev.push({ key: 'exam' + c.id, day: di, start: st, end: st + 120, title: `Exam: ${c.name}`, badge: '📝', sub: c.exam.location, color: '#ef4468', onClick: () => nav(`/c/${c.id}?tab=exam`) })
        } else (ad[di] ??= []).push({ key: 'exam' + c.id, label: `📝 Exam: ${c.name}`, color: '#ef4468', onClick: () => nav(`/c/${c.id}?tab=exam`) })
      }
    }
    return { events: ev, allDay: ad }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, week])

  // weekly summary
  const perCourse = courses
    .map((c) => {
      const sessions = (c.schedule ?? []).filter((s) => activeOn(c, s, iso(days[s.day])))
      const h = (t?: string) => sessions.filter((s) => !t || s.type === t).reduce((a, s) => a + (toMin(s.end) - toMin(s.start)) / 60, 0)
      return { c, lec: h('lecture'), ex: h('exercise'), other: h() - h('lecture') - h('exercise') }
    })
    .filter((x) => x.lec + x.ex + x.other > 0)
  const total = perCourse.reduce((a, x) => a + x.lec + x.ex + x.other, 0)
  const thisWeek = iso(week) === iso(mondayOf(new Date()))
  const move = (n: number) => {
    const d = new Date(week)
    d.setDate(d.getDate() + n * 7)
    setWeek(d)
  }
  const range = `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const hasAny = courses.some((c) => c.schedule?.length)

  return (
    <div className="page max-w-[1250px]">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays size={26} className="text-accent" /> Calendar
          </h1>
          <p className="opacity-60 text-[14px]">{range}</p>
        </div>
        <div className="flex items-center gap-1">
          <button className="icon-btn" onClick={() => move(-1)} title="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button className="btn btn-sm" onClick={() => setWeek(mondayOf(new Date()))} disabled={thisWeek}>
            Today
          </button>
          <button className="icon-btn" onClick={() => move(1)} title="Next week">
            <ChevronRight size={18} />
          </button>
        </div>
      </motion.header>

      {!hasAny && (
        <div className="empty mb-5">
          No timetable yet. Open a course → <b>Schedule</b> tab to add its lectures and exercises.
          {courses.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              {courses.map((c) => (
                <button key={c.id} className="btn btn-sm" onClick={() => nav(`/c/${c.id}?tab=schedule`)}>
                  <span className="course-dot" style={{ background: c.color }}>
                    <CourseIcon course={c} />
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid xl:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="card !p-2">
          <WeekGrid events={events} weekStart={week} allDay={allDay} days={[0, 1, 2, 3, 4, 5, 6].filter((d) => d < 5 || events.some((e) => e.day === d) || allDay[d]?.length)} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="section-title">This week · {total % 1 ? total.toFixed(1) : total} h of class</div>
            {perCourse.length === 0 && <p className="text-[13px] opacity-60">No classes this week.</p>}
            <div className="flex flex-col gap-2.5">
              {perCourse.map(({ c, lec, ex, other }) => (
                <button key={c.id} className="flex items-center gap-2.5 text-left" onClick={() => nav(`/c/${c.id}?tab=schedule`)}>
                  <span className="course-dot" style={{ background: c.color }}>
                    <CourseIcon course={c} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                    <span className="block text-[12px] opacity-60">
                      {[lec && `${lec}h lectures`, ex && `${ex}h exercises`, other && `${other}h other`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <ExportCard courses={courses} signedIn={!!user} />
        </div>
      </div>
      {editing && <SessionEditor open onClose={() => setEditing(null)} course={editing.course} session={editing.session} />}
    </div>
  )
}

function ExportCard({ courses, signedIn }: { courses: Course[]; signedIn: boolean }) {
  const nav = useNavigate()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!signedIn) return
    void feedUrl()
      .then(setUrl)
      .catch(() => setUrl(null))
  }, [signedIn])
  const reset = async () => {
    if (!confirm('Create a new link? The old one stops working (you will have to add the new one to Google Calendar again).')) return
    setBusy(true)
    try {
      setUrl(await feedUrl(true))
      toast('New calendar link created')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <div className="section-title">Export</div>
      {signedIn ? (
        <>
          <p className="text-[12.5px] opacity-65 mb-3">A private link that stays in sync: when you change the timetable or an exam date here, Google Calendar updates by itself (Google refreshes every few hours).</p>
          {url ? (
            <div className="flex flex-col gap-2">
              <a className="btn btn-primary" href={googleAddUrl(url)} target="_blank" rel="noreferrer">
                <CalendarDays size={15} /> Add to Google Calendar
              </a>
              <a className="btn" href={webcalUrl(url)}>
                <Link2 size={15} /> Apple Calendar / iPhone
              </a>
              <div className="flex gap-2">
                <button
                  className="btn flex-1"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />} Copy link
                </button>
                <button className="btn" onClick={reset} disabled={busy} title="Create a new private link">
                  {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-2">
              <Loader2 className="spin opacity-40" />
            </div>
          )}
        </>
      ) : (
        <p className="text-[12.5px] opacity-65 mb-3">
          <button className="text-accent underline" onClick={() => nav('/settings')}>
            Sign in
          </button>{' '}
          to get a link that keeps Google Calendar up to date automatically.
        </p>
      )}
      <button className="btn w-full mt-2" onClick={() => download('Ripasso timetable.ics', buildIcs(courses, { tz: tz() }), 'text/calendar')}>
        <Download size={15} /> Download .ics (one-off import)
      </button>
    </div>
  )
}
