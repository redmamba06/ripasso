import type { Course, Unit, Quiz } from './db'

export interface PlanSettings {
  /** giorni della settimana in cui studi: 0 = lunedì … 6 = domenica */
  studyDays: number[]
  /** giorni finali dedicati solo a ripasso generale e simulazioni */
  reviewDays: number
}

export const DEFAULT_PLAN: PlanSettings = { studyDays: [0, 1, 2, 3, 4, 5], reviewDays: 3 }

export type Task =
  | { kind: 'unit'; unitId: string; title: string; done: boolean; part?: string }
  | { kind: 'review'; title: string }
  | { kind: 'quiz'; quizId: string; title: string }
  | { kind: 'summary'; title: string }

export interface PlanDay {
  date: string // YYYY-MM-DD
  tasks: Task[]
  review: boolean
}

export interface Plan {
  days: PlanDay[]
  remaining: number
  perDay: number
  tooLate: boolean
  noDate: boolean
}

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const today = () => iso(new Date())
const weekday = (d: Date) => (d.getDay() + 6) % 7 // lunedì = 0

/**
 * Piano ricalcolato ogni giorno a partire da oggi: le unità non ancora "fatte" vengono
 * distribuite sui giorni di studio disponibili prima dell'esame; gli ultimi giorni sono
 * riservati a ripasso del riassunto completo e simulazioni d'esame con i quiz.
 */
export function buildPlan(course: Course, units: Unit[], quizzes: Quiz[], ps: PlanSettings = course.plan ?? DEFAULT_PLAN): Plan {
  const exam = course.exam?.date
  const todo = units.filter((u) => u.status !== 'done')
  if (!exam) return { days: [], remaining: todo.length, perDay: 0, tooLate: false, noDate: true }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(exam + 'T00:00:00')
  const avail: Date[] = []
  for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    if (ps.studyDays.includes(weekday(d))) avail.push(new Date(d))
  }
  if (!avail.length) return { days: [], remaining: todo.length, perDay: 0, tooLate: end <= start, noDate: false }

  const reviewN = Math.min(ps.reviewDays, Math.max(0, avail.length - 1))
  const studyDays = avail.slice(0, avail.length - reviewN)
  const reviewDays = avail.slice(avail.length - reviewN)
  const days: PlanDay[] = []

  // distribuzione unità: se sono più dei giorni, più unità al giorno;
  // se sono meno, un'unità può occupare più giorni (parte 1/2…)
  const n = todo.length
  const s = Math.max(1, studyDays.length)
  if (n > 0 && studyDays.length) {
    if (n >= s) {
      let k = 0
      studyDays.forEach((d, i) => {
        const take = Math.floor(n / s) + (i < n % s ? 1 : 0)
        const tasks: Task[] = todo.slice(k, k + take).map((u) => ({ kind: 'unit', unitId: u.id, title: u.title, done: false }))
        k += take
        days.push({ date: iso(d), tasks, review: false })
      })
    } else {
      // più giorni che unità: ogni unità riceve un blocco di giorni
      let di = 0
      todo.forEach((u, i) => {
        const span = Math.floor(s / n) + (i < s % n ? 1 : 0)
        for (let j = 0; j < span; j++) {
          const d = studyDays[di++]
          if (!d) break
          days.push({
            date: iso(d),
            review: false,
            tasks: [{ kind: 'unit', unitId: u.id, title: u.title, done: false, part: span > 1 ? (j === span - 1 ? 'ripasso e schema' : j === 0 ? 'studio e appunti' : 'approfondimento') : undefined }],
          })
        }
      })
    }
  } else {
    for (const d of studyDays) days.push({ date: iso(d), tasks: [{ kind: 'review', title: 'Ripasso libero delle unità già studiate' }], review: false })
  }

  reviewDays.forEach((d, i) => {
    const tasks: Task[] = []
    if (i === 0) tasks.push({ kind: 'summary', title: 'Rileggi il riassunto completo del corso' })
    const q = quizzes[i % Math.max(1, quizzes.length)]
    if (q) tasks.push({ kind: 'quiz', quizId: q.id, title: `Simulazione: ${q.title}` })
    tasks.push({ kind: 'review', title: i === reviewDays.length - 1 ? 'Ripasso leggero dei riquadri “Da sapere per l’esame”' : 'Ripassa gli errori dei quiz e i punti deboli' })
    days.push({ date: iso(d), tasks, review: true })
  })

  return { days, remaining: n, perDay: studyDays.length ? n / studyDays.length : n, tooLate: false, noDate: false }
}

export const DAY_NAMES = ['L', 'M', 'M', 'G', 'V', 'S', 'D']

export function fmtDay(date: string) {
  const d = new Date(date + 'T00:00:00')
  const t = today()
  if (date === t) return 'Oggi'
  const tm = new Date()
  tm.setDate(tm.getDate() + 1)
  if (date === iso(tm)) return 'Domani'
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
}
