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
    // start of the repetition: term start, otherwise the Monday of the current week
    const monday = firstOn(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), 0)
    const from = c.term?.start ? new Date(c.term.start + 'T00:00:00') : monday
    const until = c.term?.end || c.exam?.date
    for (const s of c.schedule ?? []) {
      const d = firstOn(from, s.day)
      const [sh, sm] = s.start.split(':')
      const [eh, em] = s.end.split(':')
      L.push('BEGIN:VEVENT')
      L.push(`UID:${s.id}@ripasso`)
      L.push(`DTSTAMP:${stamp}`)
      L.push(`SUMMARY:${esc(`${c.name} – ${SESSION_LABEL[s.type] ?? 'Class'}`)}`)
      L.push(`DTSTART;TZID=${tz}:${ymd(d)}T${pad(+sh)}${pad(+sm)}00`)
      L.push(`DTEND;TZID=${tz}:${ymd(d)}T${pad(+eh)}${pad(+em)}00`)
      L.push(`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.day]}${until ? `;UNTIL=${until.replace(/-/g, '')}T235959Z` : ''}`)
      if (s.room) L.push(`LOCATION:${esc(s.room)}`)
      const desc = [c.professor && `Professor: ${c.professor}`, s.note].filter(Boolean).join('\n')
      if (desc) L.push(`DESCRIPTION:${esc(desc)}`)
      L.push(`CATEGORIES:${esc(SESSION_LABEL[s.type] ?? 'Class')}`)
      L.push('END:VEVENT')
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
