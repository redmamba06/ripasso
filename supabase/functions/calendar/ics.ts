// Timetable model + iCalendar (.ics) builder.
// Kept free of imports: the same file is deployed with the `calendar` Supabase function.

export type SessionType = 'lecture' | 'exercise' | 'lab' | 'other'

export interface ClassSession {
  id: string
  type: SessionType
  /** 0 = Monday … 6 = Sunday */
  day: number
  /** "HH:MM" */
  start: string
  end: string
  room?: string
  note?: string
  /** first date of this class (YYYY-MM-DD); empty = course teaching period start */
  from?: string
  /** last date of this class (YYYY-MM-DD); empty = course teaching period end / exam */
  until?: string
  /** a single class on `from` instead of a weekly one */
  once?: boolean
  /** changes to single dates of the series (key = YYYY-MM-DD) */
  exceptions?: Record<string, Occurrence>
}

/** Change to one date only: cancelled, different time/room, or a note for that day. */
export interface Occurrence {
  cancelled?: boolean
  start?: string
  end?: string
  room?: string
  note?: string
}

/** Details of a class on a given date, with that date's changes applied. */
export function occurrence(s: ClassSession, date: string) {
  const x = s.exceptions?.[date]
  return {
    cancelled: !!x?.cancelled,
    start: x?.start || s.start,
    end: x?.end || s.end,
    room: x?.room || s.room,
    note: x?.note,
    changed: !!x && !x.cancelled && !!(x.start || x.end || x.room || x.note),
  }
}

export interface IcsCourse {
  id: string
  name: string
  professor?: string
  schedule?: ClassSession[]
  term?: { start?: string; end?: string }
  exam?: { date?: string; time?: string; type?: string; location?: string; duration?: string }
  deleted?: 0 | 1
}

export const SESSION_LABEL: Record<SessionType, string> = { lecture: 'Lecture', exercise: 'Exercises', lab: 'Lab', other: 'Class' }
export const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** Effective period of a class: its own dates, otherwise the course's. */
export function sessionRange(c: Pick<IcsCourse, 'term' | 'exam'>, s: ClassSession): { from?: string; until?: string } {
  if (s.once) return { from: s.from, until: s.from }
  return { from: s.from || c.term?.start, until: s.until || c.term?.end || c.exam?.date }
}

/** Does the class take place on this date (YYYY-MM-DD, which must fall on s.day)? */
export function activeOn(c: Pick<IcsCourse, 'term' | 'exam'>, s: ClassSession, date: string) {
  if (s.once) return !!s.from && s.from === date
  const r = sessionRange(c, s)
  return (!r.from || date >= r.from) && (!r.until || date <= r.until)
}

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

/** Lines longer than 75 octets must be folded (RFC 5545). */
function fold(line: string) {
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) {
      out.push(cur)
      cur = ' ' + ch
    } else cur += ch
  }
  out.push(cur)
  return out.join('\r\n')
}

/** First date ≥ from that falls on `day` (0 = Monday). */
function firstOn(from: Date, day: number) {
  const d = new Date(from)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() + ((day - wd + 7) % 7))
  return d
}

export function buildIcs(courses: IcsCourse[], opts: { calName?: string; tz?: string; now?: Date } = {}): string {
  const tz = opts.tz || 'Europe/Rome'
  const now = opts.now ?? new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const L: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ripasso//Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(opts.calName ?? 'Ripasso – timetable')}`,
    `X-WR-TIMEZONE:${tz}`,
  ]
  for (const c of courses) {
    if (c.deleted) continue
    // without dates the repetition starts from the Monday of the current week
    const monday = firstOn(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), 0)
    for (const s of c.schedule ?? []) {
      const r = sessionRange(c, s)
      if (s.once && !r.from) continue
      const from = r.from ? new Date(r.from + 'T00:00:00') : monday
      const until = r.until
      const d = s.once ? from : firstOn(from, s.day)
      if (!s.once && until && ymd(d) > until.replace(/-/g, '')) continue
      const summary = `SUMMARY:${esc(`${c.name} – ${SESSION_LABEL[s.type] ?? 'Class'}`)}`
      const desc = (note?: string) => [note, c.professor && `Professor: ${c.professor}`, s.note].filter(Boolean).join('\n')
      if (s.once) {
        // single class: its changes are applied directly
        const o = occurrence(s, r.from!)
        if (o.cancelled) continue
        const [osh, osm] = o.start.split(':')
        const [oeh, oem] = o.end.split(':')
        L.push('BEGIN:VEVENT', `UID:${s.id}@ripasso`, `DTSTAMP:${stamp}`, summary)
        L.push(`DTSTART;TZID=${tz}:${ymd(d)}T${pad(+osh)}${pad(+osm)}00`, `DTEND;TZID=${tz}:${ymd(d)}T${pad(+oeh)}${pad(+oem)}00`)
        if (o.room) L.push(`LOCATION:${esc(o.room)}`)
        if (desc(o.note)) L.push(`DESCRIPTION:${esc(desc(o.note))}`)
        L.push(`CATEGORIES:${esc(SESSION_LABEL[s.type] ?? 'Class')}`, 'END:VEVENT')
        continue
      }
      const [sh, sm] = s.start.split(':')
      const [eh, em] = s.end.split(':')
      L.push('BEGIN:VEVENT')
      L.push(`UID:${s.id}@ripasso`)
      L.push(`DTSTAMP:${stamp}`)
      L.push(summary)
      L.push(`DTSTART;TZID=${tz}:${ymd(d)}T${pad(+sh)}${pad(+sm)}00`)
      L.push(`DTEND;TZID=${tz}:${ymd(d)}T${pad(+eh)}${pad(+em)}00`)
      L.push(`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.day]}${until ? `;UNTIL=${until.replace(/-/g, '')}T235959Z` : ''}`)
      // dates of the series with changes: cancelled → EXDATE, modified → own event (RECURRENCE-ID)
      const exc = Object.entries(s.exceptions ?? {}).filter(([date]) => (!r.from || date >= r.from) && (!until || date <= until))
      const cancelled = exc.filter(([, x]) => x.cancelled).map(([date]) => `${date.replace(/-/g, '')}T${pad(+sh)}${pad(+sm)}00`)
      if (cancelled.length) L.push(`EXDATE;TZID=${tz}:${cancelled.join(',')}`)
      if (s.room) L.push(`LOCATION:${esc(s.room)}`)
      if (desc()) L.push(`DESCRIPTION:${esc(desc())}`)
      L.push(`CATEGORIES:${esc(SESSION_LABEL[s.type] ?? 'Class')}`)
      L.push('END:VEVENT')
      for (const [date, x] of exc) {
        if (x.cancelled) continue
        const o = occurrence(s, date)
        if (!o.changed) continue
        const dd = date.replace(/-/g, '')
        const [osh, osm] = o.start.split(':')
        const [oeh, oem] = o.end.split(':')
        L.push('BEGIN:VEVENT', `UID:${s.id}@ripasso`, `DTSTAMP:${stamp}`, `RECURRENCE-ID;TZID=${tz}:${dd}T${pad(+sh)}${pad(+sm)}00`, summary)
        L.push(`DTSTART;TZID=${tz}:${dd}T${pad(+osh)}${pad(+osm)}00`, `DTEND;TZID=${tz}:${dd}T${pad(+oeh)}${pad(+oem)}00`)
        if (o.room) L.push(`LOCATION:${esc(o.room)}`)
        if (desc(o.note)) L.push(`DESCRIPTION:${esc(desc(o.note))}`)
        L.push('END:VEVENT')
      }
    }
    if (c.exam?.date) {
      L.push('BEGIN:VEVENT')
      L.push(`UID:exam-${c.id}@ripasso`)
      L.push(`DTSTAMP:${stamp}`)
      L.push(`SUMMARY:${esc(`📝 Exam: ${c.name}${c.exam.type ? ` (${c.exam.type})` : ''}`)}`)
      if (c.exam.time) {
        const [h, m] = c.exam.time.split(':')
        const mins = parseInt(c.exam.duration ?? '') ? Math.round(parseFloat(c.exam.duration!) * (/min/i.test(c.exam.duration!) ? 1 : 60)) : 120
        const end = new Date(`${c.exam.date}T${pad(+h)}:${pad(+m)}:00`)
        end.setMinutes(end.getMinutes() + mins)
        L.push(`DTSTART;TZID=${tz}:${c.exam.date.replace(/-/g, '')}T${pad(+h)}${pad(+m)}00`)
        L.push(`DTEND;TZID=${tz}:${ymd(end)}T${pad(end.getHours())}${pad(end.getMinutes())}00`)
      } else {
        const next = new Date(c.exam.date + 'T00:00:00')
        next.setDate(next.getDate() + 1)
        L.push(`DTSTART;VALUE=DATE:${c.exam.date.replace(/-/g, '')}`)
        L.push(`DTEND;VALUE=DATE:${ymd(next)}`)
      }
      if (c.exam.location) L.push(`LOCATION:${esc(c.exam.location)}`)
      L.push('END:VEVENT')
    }
  }
  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}
