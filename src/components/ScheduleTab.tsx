import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, CalendarDays, Download, MapPin, Clock } from 'lucide-react'
import { put, uid, type Course } from '../lib/db'
import { buildIcs, DAY_LONG, DAY_SHORT, SESSION_LABEL, toMin, type ClassSession, type SessionType } from '../lib/ics'
import { download } from '../lib/export'
import { Modal } from './Modal'
import { WeekGrid } from './WeekGrid'

export const TYPE_BADGE: Record<SessionType, string> = { lecture: 'L', exercise: 'E', lab: 'Lab', other: '•' }
const TYPES: SessionType[] = ['lecture', 'exercise', 'lab', 'other']
export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome'

export function SessionEditor({
  open,
  onClose,
  course,
  session,
}: {
  open: boolean
  onClose: () => void
  course: Course
  session: Partial<ClassSession> | null
}) {
  const [s, setS] = useState<ClassSession>({ id: '', type: 'lecture', day: 0, start: '09:00', end: '11:00' })
  useEffect(() => {
    if (open) setS({ id: session?.id ?? '', type: session?.type ?? 'lecture', day: session?.day ?? 0, start: session?.start ?? '09:00', end: session?.end ?? '11:00', room: session?.room ?? '', note: session?.note ?? '' })
  }, [open, session])
  const valid = toMin(s.end) > toMin(s.start)
  const list = course.schedule ?? []
  const save = async () => {
    if (!valid) return
    const next = s.id ? list.map((x) => (x.id === s.id ? s : x)) : [...list, { ...s, id: uid() }]
    await put<Course>('courses', { ...course, schedule: next })
    onClose()
  }
  const del = async () => {
    await put<Course>('courses', { ...course, schedule: list.filter((x) => x.id !== s.id) })
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={s.id ? 'Edit class' : 'Add class'}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="label">Type</div>
          <div className="seg w-fit flex-wrap">
            {TYPES.map((t) => (
              <button key={t} className={s.type === t ? 'on' : ''} onClick={() => setS((p) => ({ ...p, type: t }))}>
                {SESSION_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">Day</div>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_SHORT.map((d, i) => (
              <button key={d} className={`day-pick wide ${s.day === i ? 'on' : ''}`} onClick={() => setS((p) => ({ ...p, day: i }))}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Starts</span>
            <input className="field" type="time" step={300} value={s.start} onChange={(e) => setS((p) => ({ ...p, start: e.target.value }))} />
          </label>
          <label>
            <span className="label">Ends</span>
            <input className="field" type="time" step={300} value={s.end} onChange={(e) => setS((p) => ({ ...p, end: e.target.value }))} />
          </label>
        </div>
        {!valid && <div className="warn">The end time must be after the start time.</div>}
        <input className="field" placeholder="Room / building (optional)" value={s.room ?? ''} onChange={(e) => setS((p) => ({ ...p, room: e.target.value }))} />
        <input className="field" placeholder="Note (optional) – e.g. “bring laptop”, “group A”" value={s.note ?? ''} onChange={(e) => setS((p) => ({ ...p, note: e.target.value }))} />
        <div className="flex gap-2">
          {s.id && (
            <button className="btn btn-danger-soft" onClick={del}>
              <Trash2 size={15} /> Delete
            </button>
          )}
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!valid}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Timetable of a single course. */
export function ScheduleTab({ course }: { course: Course }) {
  const nav = useNavigate()
  const [editing, setEditing] = useState<Partial<ClassSession> | null>(null)
  const list = [...(course.schedule ?? [])].sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start))
  const setTerm = (k: 'start' | 'end', v: string) => put<Course>('courses', { ...course, term: { ...(course.term ?? {}), [k]: v || undefined } })
  const hours = list.reduce((h, s) => h + (toMin(s.end) - toMin(s.start)) / 60, 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="card flex flex-wrap items-end gap-4">
        <label className="min-w-[150px]">
          <span className="label">Classes start</span>
          <input className="field" type="date" value={course.term?.start ?? ''} onChange={(e) => setTerm('start', e.target.value)} />
        </label>
        <label className="min-w-[150px]">
          <span className="label">Classes end</span>
          <input className="field" type="date" value={course.term?.end ?? ''} onChange={(e) => setTerm('end', e.target.value)} />
        </label>
        <p className="text-[12.5px] opacity-60 flex-1 min-w-[200px]">Classes repeat every week between these dates (in the calendar and in Google Calendar). Leave them empty to repeat until the exam.</p>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={() => download(`${course.name} – timetable.ics`, buildIcs([course], { calName: course.name, tz: tz() }), 'text/calendar')} disabled={!list.length && !course.exam?.date}>
            <Download size={15} /> .ics
          </button>
          <button className="btn" onClick={() => nav('/calendar')}>
            <CalendarDays size={15} /> Full calendar
          </button>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={15} /> Add class
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <button className="empty" onClick={() => setEditing({})}>
          No classes yet. Add your lectures and exercise sessions — or click an empty slot in the grid.
        </button>
      ) : null}

      <div className="card !p-2">
        <WeekGrid
          events={list.map((s) => ({
            key: s.id,
            day: s.day,
            start: toMin(s.start),
            end: toMin(s.end),
            title: SESSION_LABEL[s.type],
            badge: TYPE_BADGE[s.type],
            sub: s.room,
            color: course.color,
            dashed: s.type !== 'lecture',
            onClick: () => setEditing(s),
          }))}
          onSlot={(day, m) => {
            const h = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
            setEditing({ day, start: h(m), end: h(m + 120) })
          }}
        />
      </div>

      {list.length > 0 && (
        <div>
          <div className="section-title">
            {list.length} class{list.length === 1 ? '' : 'es'} per week · {hours % 1 ? hours.toFixed(1) : hours} h
          </div>
          <div className="flex flex-col gap-2">
            {list.map((s) => (
              <button key={s.id} className="card card-hover flex items-center gap-3 text-left !py-3" onClick={() => setEditing(s)}>
                <span className="type-badge" style={{ ['--c' as string]: course.color }}>
                  {TYPE_BADGE[s.type]}
                </span>
                <span className="flex-1 min-w-0">
                  <b className="text-[14px]">
                    {SESSION_LABEL[s.type]} · {DAY_LONG[s.day]}
                  </b>
                  <span className="flex flex-wrap gap-x-3 text-[12.5px] opacity-60">
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {s.start}–{s.end}
                    </span>
                    {s.room && (
                      <span className="flex items-center gap-1">
                        <MapPin size={12} /> {s.room}
                      </span>
                    )}
                    {s.note && <span>{s.note}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <SessionEditor open={!!editing} onClose={() => setEditing(null)} course={course} session={editing} />
    </div>
  )
}
