import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, CalendarDays, Download, MapPin, Clock, ChevronLeft, ChevronRight, Repeat, CalendarRange, GitBranch, Check, X, CalendarX2, Undo2, StickyNote } from 'lucide-react'
import { put, uid, type Course } from '../lib/db'
import { activeOn, buildIcs, occurrence, sessionRange, DAY_LONG, DAY_SHORT, SESSION_LABEL, toMin, type ClassSession, type SessionType, type Occurrence } from '../lib/ics'
import { download } from '../lib/export'
import { Modal } from './Modal'
import { WeekGrid, type GridEvent } from './WeekGrid'

export const TYPE_BADGE: Record<SessionType, string> = { lecture: 'L', exercise: 'E', lab: 'Lab', other: '•' }
const TYPES: SessionType[] = ['lecture', 'exercise', 'lab', 'other']
export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome'

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const mondayOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const addDays = (date: string, n: number) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoDate(d)
}
/** weekday (0 = Monday) of a YYYY-MM-DD date */
const weekdayOf = (date: string) => (new Date(date + 'T00:00:00').getDay() + 6) % 7
export const fmtDate = (date?: string) => (date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

/** "Every Mon · 21 Sep → 18 Oct" / "Once · Thu 5 Nov" */
export function periodLabel(c: Course, s: ClassSession) {
  if (s.once) return s.from ? `Once · ${new Date(s.from + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Once'
  const r = sessionRange(c, s)
  const span = r.from || r.until ? `${r.from ? fmtDate(r.from) : '…'} → ${r.until ? fmtDate(r.until) : '…'}` : 'every week'
  return `Every ${DAY_SHORT[s.day]} · ${span}`
}

/** past = finished, future = not started yet */
export function sessionStatus(c: Course, s: ClassSession, today = isoDate(new Date())): 'past' | 'future' | 'current' {
  const r = sessionRange(c, s)
  if (r.until && r.until < today) return 'past'
  if (r.from && r.from > today) return 'future'
  return 'current'
}

type Draft = ClassSession & { _splitOf?: string }

export function SessionEditor({
  open,
  onClose,
  course,
  session,
}: {
  open: boolean
  onClose: () => void
  course: Course
  session: Partial<Draft> | null
}) {
  const [s, setS] = useState<Draft>({ id: '', type: 'lecture', day: 0, start: '09:00', end: '11:00' })
  const [split, setSplit] = useState<string | null>(null) // date typed in "changes from…"
  useEffect(() => {
    if (!open) return
    setSplit(null)
    setS({
      id: session?.id ?? '',
      type: session?.type ?? 'lecture',
      day: session?.day ?? 0,
      start: session?.start ?? '09:00',
      end: session?.end ?? '11:00',
      room: session?.room ?? '',
      note: session?.note ?? '',
      from: session?.from ?? '',
      until: session?.until ?? '',
      once: session?.once ?? false,
      _splitOf: session?._splitOf,
    })
  }, [open, session])

  const list = course.schedule ?? []
  const timeOk = toMin(s.end) > toMin(s.start)
  const rangeOk = s.once ? !!s.from : !s.from || !s.until || s.until >= s.from
  const valid = timeOk && rangeOk
  const def = { from: course.term?.start, until: course.term?.end || course.exam?.date }

  const clean = (x: Draft): ClassSession => {
    const { _splitOf, ...rest } = x
    void _splitOf
    const out: ClassSession = { ...rest, room: rest.room?.trim() || undefined, note: rest.note?.trim() || undefined, from: rest.from || undefined, until: rest.once ? undefined : rest.until || undefined, once: rest.once || undefined }
    if (out.once && out.from) out.day = weekdayOf(out.from)
    return out
  }

  const save = async () => {
    if (!valid) return
    const x = clean(s)
    let next = x.id ? list.map((o) => (o.id === x.id ? x : o)) : [...list, { ...x, id: uid() }]
    // new version of a class that changes from a date: the old one stops the day before
    if (s._splitOf && x.from) next = next.map((o) => (o.id === s._splitOf ? { ...o, until: addDays(x.from!, -1) } : o))
    await put<Course>('courses', { ...course, schedule: next })
    onClose()
  }
  const del = async () => {
    await put<Course>('courses', { ...course, schedule: list.filter((o) => o.id !== s.id) })
    onClose()
  }
  const startSplit = () => {
    const today = isoDate(new Date())
    const from = sessionRange(course, s).from
    setSplit(from && from > today ? addDays(from, 7) : today)
  }
  const confirmSplit = () => {
    if (!split) return
    // the same class, from that date on: the user changes what is different
    setS({ ...s, id: '', from: split, _splitOf: s.id, once: false })
    setSplit(null)
  }

  const title = s._splitOf ? `New version from ${fmtDate(s.from)}` : s.id ? 'Edit class' : 'Add class'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        {s._splitOf && (
          <div className="info-box">
            <GitBranch size={15} /> The previous version stops on {fmtDate(addDays(s.from!, -1))}. Change here what is different from {fmtDate(s.from)} (time, room, day…).
          </div>
        )}
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
          <div className="label">When</div>
          <div className="seg w-fit mb-3">
            <button className={!s.once ? 'on' : ''} onClick={() => setS((p) => ({ ...p, once: false }))}>
              <Repeat size={14} /> Every week
            </button>
            <button className={s.once ? 'on' : ''} onClick={() => setS((p) => ({ ...p, once: true }))} disabled={!!s._splitOf}>
              <CalendarDays size={14} /> One date only
            </button>
          </div>
          {s.once ? (
            <label className="block max-w-[220px]">
              <span className="label">Date</span>
              <input className="field" type="date" value={s.from ?? ''} onChange={(e) => setS((p) => ({ ...p, from: e.target.value }))} />
            </label>
          ) : (
            <>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {DAY_SHORT.map((d, i) => (
                  <button key={d} className={`day-pick wide ${s.day === i ? 'on' : ''}`} onClick={() => setS((p) => ({ ...p, day: i }))}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="label">From</span>
                  <input className="field" type="date" value={s.from ?? ''} onChange={(e) => setS((p) => ({ ...p, from: e.target.value }))} />
                </label>
                <label>
                  <span className="label">Until</span>
                  <input className="field" type="date" value={s.until ?? ''} onChange={(e) => setS((p) => ({ ...p, until: e.target.value }))} />
                </label>
              </div>
              <p className="text-[12px] opacity-55 mt-1.5">
                Empty = the course’s teaching period
                {def.from || def.until ? ` (${def.from ? fmtDate(def.from) : '…'} → ${def.until ? fmtDate(def.until) : '…'})` : ''}.
              </p>
            </>
          )}
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
        {!timeOk && <div className="warn">The end time must be after the start time.</div>}
        {!rangeOk && <div className="warn">{s.once ? 'Pick the date of the class.' : 'The “Until” date must be after the “From” date.'}</div>}
        <input className="field" placeholder="Room / building (optional)" value={s.room ?? ''} onChange={(e) => setS((p) => ({ ...p, room: e.target.value }))} />
        <input className="field" placeholder="Note (optional) – e.g. “bring laptop”, “group A”" value={s.note ?? ''} onChange={(e) => setS((p) => ({ ...p, note: e.target.value }))} />

        {s.id && !s.once && !s._splitOf && (
          <div className="split-box">
            {split == null ? (
              <button className="btn w-full" onClick={startSplit}>
                <GitBranch size={15} /> Changes from a date…
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-[160px]">
                  <span className="label">From which date does it change?</span>
                  <input className="field" type="date" value={split} onChange={(e) => setSplit(e.target.value)} />
                </label>
                <button className="btn" onClick={() => setSplit(null)}>
                  <X size={15} />
                </button>
                <button className="btn btn-primary" onClick={confirmSplit} disabled={!split}>
                  <Check size={15} /> Continue
                </button>
              </div>
            )}
            <p className="text-[12px] opacity-55 mt-1.5">Use this when the time, room or day changes during the semester: the current version ends the day before and you set up the new one.</p>
          </div>
        )}

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

/** Grid event of a class on a given date, with that day's changes. */
export function occurrenceEvent(c: Course, s: ClassSession, date: string, day: number, onClick: () => void, withCourse = false): GridEvent {
  const o = occurrence(s, date)
  return {
    key: c.id + s.id + date,
    day,
    start: toMin(o.start),
    end: toMin(o.end),
    title: o.cancelled ? `No class${withCourse ? ` · ${c.name}` : ''}` : withCourse ? c.name : SESSION_LABEL[s.type],
    badge: TYPE_BADGE[s.type],
    sub: o.cancelled ? SESSION_LABEL[s.type] : [withCourse && SESSION_LABEL[s.type], o.room, o.note].filter(Boolean).join(' · '),
    color: c.color,
    dashed: s.type !== 'lecture',
    cancelled: o.cancelled,
    marked: o.changed,
    onClick,
  }
}

/** Changes to a single date of a class: cancel it, move it, or add a note for that day only. */
export function OccurrenceEditor({ open, onClose, course, session, date, onEditSeries }: { open: boolean; onClose: () => void; course: Course; session: ClassSession | null; date: string; onEditSeries: () => void }) {
  const [x, setX] = useState<Occurrence>({})
  useEffect(() => {
    if (open && session) setX({ ...(session.exceptions?.[date] ?? {}) })
  }, [open, session, date])
  if (!session) return null
  const o = occurrence({ ...session, exceptions: { [date]: x } }, date)
  const timeOk = toMin(o.end) > toMin(o.start)
  const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const write = async (value: Occurrence | null) => {
    const list = course.schedule ?? []
    const next = list.map((s) => {
      if (s.id !== session.id) return s
      const ex = { ...(s.exceptions ?? {}) }
      if (value && (value.cancelled || value.start || value.end || value.room || value.note)) ex[date] = value
      else delete ex[date]
      return { ...s, exceptions: Object.keys(ex).length ? ex : undefined }
    })
    await put<Course>('courses', { ...course, schedule: next })
    onClose()
  }
  const hasChanges = !!session.exceptions?.[date]
  // only store what differs from the series
  const cleaned = (v: Occurrence): Occurrence => ({
    cancelled: v.cancelled || undefined,
    start: v.start && v.start !== session.start ? v.start : undefined,
    end: v.end && v.end !== session.end ? v.end : undefined,
    room: v.room?.trim() && v.room.trim() !== (session.room ?? '') ? v.room.trim() : undefined,
    note: v.note?.trim() || undefined,
  })

  return (
    <Modal open={open} onClose={onClose} title={`${SESSION_LABEL[session.type]} · ${course.name}`}>
      <div className="occ-date">{dayLabel} — changes here apply to this day only</div>
      <div className="flex flex-col gap-4">
        {x.cancelled ? (
          <div className="warn">
            <CalendarX2 size={15} /> No class on this day. The other {session.once ? '' : `${DAY_LONG[session.day]}s `}are not affected.
          </div>
        ) : null}
        <button className={`btn ${x.cancelled ? '' : 'btn-danger-soft'}`} onClick={() => setX((p) => ({ ...p, cancelled: !p.cancelled }))}>
          {x.cancelled ? (
            <>
              <Undo2 size={15} /> Restore this class
            </>
          ) : (
            <>
              <CalendarX2 size={15} /> No class this day
            </>
          )}
        </button>
        {!x.cancelled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="label">Starts (this day)</span>
                <input className="field" type="time" step={300} value={o.start} onChange={(e) => setX((p) => ({ ...p, start: e.target.value }))} />
              </label>
              <label>
                <span className="label">Ends (this day)</span>
                <input className="field" type="time" step={300} value={o.end} onChange={(e) => setX((p) => ({ ...p, end: e.target.value }))} />
              </label>
            </div>
            {!timeOk && <div className="warn">The end time must be after the start time.</div>}
            <input className="field" placeholder={session.room ? `Room (usually ${session.room})` : 'Room (optional)'} value={x.room ?? ''} onChange={(e) => setX((p) => ({ ...p, room: e.target.value }))} />
          </>
        )}
        <label>
          <span className="label flex items-center gap-1">
            <StickyNote size={12} /> Note for this day only
          </span>
          <textarea className="field" rows={3} placeholder="e.g. “Mid-term test”, “Chapter 5”, “Bring laptop”, “Guest lecture”…" value={x.note ?? ''} onChange={(e) => setX((p) => ({ ...p, note: e.target.value }))} />
        </label>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={onEditSeries} title="Change the class for every week">
            <Repeat size={15} /> {session.once ? 'Edit class…' : `Edit all ${DAY_LONG[session.day]}s…`}
          </button>
          {hasChanges && (
            <button className="btn" onClick={() => write(null)} title="Remove this day’s changes">
              <Undo2 size={15} /> Reset day
            </button>
          )}
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => write(cleaned(x))} disabled={!x.cancelled && !timeOk}>
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
  const [editing, setEditing] = useState<Partial<Draft> | null>(null)
  const [occ, setOcc] = useState<{ session: ClassSession; date: string } | null>(null)
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const list = [...(course.schedule ?? [])].sort((a, b) => (a.once ? 1 : 0) - (b.once ? 1 : 0) || a.day - b.day || toMin(a.start) - toMin(b.start) || (a.from ?? '').localeCompare(b.from ?? ''))
  const setTerm = (k: 'start' | 'end', v: string) => put<Course>('courses', { ...course, term: { ...(course.term ?? {}), [k]: v || undefined } })
  const today = isoDate(new Date())

  const dayDate = (d: number) => {
    const x = new Date(week)
    x.setDate(x.getDate() + d)
    return isoDate(x)
  }
  const inWeek = list.filter((s) => activeOn(course, s, dayDate(s.once && s.from ? weekdayOf(s.from) : s.day)))
  const dayOfS = (s: ClassSession) => (s.once && s.from ? weekdayOf(s.from) : s.day)
  const hours = inWeek.reduce((h, s) => {
    const o = occurrence(s, dayDate(dayOfS(s)))
    return o.cancelled ? h : h + (toMin(o.end) - toMin(o.start)) / 60
  }, 0)
  const move = (n: number) => {
    const d = new Date(week)
    d.setDate(d.getDate() + n * 7)
    setWeek(d)
  }
  const thisWeek = isoDate(week) === isoDate(mondayOf(new Date()))
  const range = `${fmtDate(dayDate(0))} – ${fmtDate(dayDate(6))}`

  return (
    <div className="flex flex-col gap-5">
      <div className="card flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold text-[14px] flex items-center gap-1.5">
            <CalendarRange size={15} className="text-accent" /> Teaching period
          </div>
          <p className="text-[12.5px] opacity-60">Default dates for classes that don’t have their own. Each class can also have its own period.</p>
        </div>
        <label className="min-w-[140px]">
          <span className="label">Starts</span>
          <input className="field" type="date" value={course.term?.start ?? ''} onChange={(e) => setTerm('start', e.target.value)} />
        </label>
        <label className="min-w-[140px]">
          <span className="label">Ends</span>
          <input className="field" type="date" value={course.term?.end ?? ''} onChange={(e) => setTerm('end', e.target.value)} />
        </label>
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

      {list.length === 0 && (
        <button className="empty" onClick={() => setEditing({})}>
          No classes yet. Add your lectures and exercise sessions — or click an empty slot in the grid.
        </button>
      )}

      <div className="card !p-2">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2">
          <b className="text-[13.5px] flex-1">
            Week {range}
            <span className="opacity-50 font-normal"> · {hours % 1 ? hours.toFixed(1) : hours} h</span>
          </b>
          <button className="icon-btn sm" onClick={() => move(-1)} title="Previous week">
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-sm" onClick={() => setWeek(mondayOf(new Date()))} disabled={thisWeek}>
            Today
          </button>
          <button className="icon-btn sm" onClick={() => move(1)} title="Next week">
            <ChevronRight size={16} />
          </button>
        </div>
        <WeekGrid
          weekStart={week}
          events={inWeek.map((s) => occurrenceEvent(course, s, dayDate(dayOfS(s)), dayOfS(s), () => setOcc({ session: s, date: dayDate(dayOfS(s)) })))}
          onSlot={(day, m) => {
            const h = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
            setEditing({ day, start: h(m), end: h(m + 120) })
          }}
        />
      </div>

      {list.length > 0 && (
        <div>
          <div className="section-title">All classes ({list.length})</div>
          <div className="flex flex-col gap-2">
            {list.map((s) => {
              const st = sessionStatus(course, s, today)
              return (
                <button key={s.id} className={`card card-hover flex items-center gap-3 text-left !py-3 ${st === 'past' ? 'opacity-55' : ''}`} onClick={() => setEditing(s)}>
                  <span className="type-badge" style={{ ['--c' as string]: course.color }}>
                    {TYPE_BADGE[s.type]}
                  </span>
                  <span className="flex-1 min-w-0">
                    <b className="text-[14px] flex items-center gap-2 flex-wrap">
                      {SESSION_LABEL[s.type]} · {s.once ? 'one-off' : DAY_LONG[s.day]}
                      {st === 'past' && <span className="pill soft">ended</span>}
                      {st === 'future' && <span className="pill">starts {fmtDate(sessionRange(course, s).from)}</span>}
                    </b>
                    <span className="flex flex-wrap gap-x-3 text-[12.5px] opacity-60">
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {s.start}–{s.end}
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarRange size={12} /> {periodLabel(course, s)}
                      </span>
                      {s.room && (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} /> {s.room}
                        </span>
                      )}
                      {s.note && <span>{s.note}</span>}
                      {s.exceptions && Object.keys(s.exceptions).length > 0 && (
                        <span>
                          ✎ {Object.values(s.exceptions).filter((e) => e.cancelled).length} cancelled · {Object.values(s.exceptions).filter((e) => !e.cancelled).length} changed
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <SessionEditor open={!!editing} onClose={() => setEditing(null)} course={course} session={editing} />
      <OccurrenceEditor
        open={!!occ}
        onClose={() => setOcc(null)}
        course={course}
        session={occ?.session ?? null}
        date={occ?.date ?? ''}
        onEditSeries={() => {
          const s = occ!.session
          setOcc(null)
          setEditing(s)
        }}
      />
    </div>
  )
}
