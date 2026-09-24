import Dexie, { type Table } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export interface Base {
  id: string
  updatedAt: number
  deleted?: 0 | 1
  dirty?: 0 | 1
}

export interface ExamInfo {
  date?: string // YYYY-MM-DD
  time?: string
  type?: string // scritto / orale / quiz / progetto
  duration?: string
  location?: string
  materials?: string
  grading?: string
  doc?: JSONContent // note libere sull'esame
}

export interface Course extends Base {
  name: string
  emoji: string
  color: string
  order: number
  professor?: string
  exam?: ExamInfo
  plan?: { studyDays: number[]; reviewDays: number }
  weak?: { at: number; topics: WeakTopic[] }
}

export interface WeakTopic {
  topic: string
  errors: number
  units: string[]
  tip: string
}

export interface Unit extends Base {
  courseId: string
  title: string
  order: number
  mainFileId?: string | null
  status?: 'todo' | 'doing' | 'done'
}

export type FileKind = 'slides' | 'handwritten' | 'exam' | 'solution' | 'material'

export interface FileRec extends Base {
  courseId: string
  unitId: string | null
  name: string
  mime: string
  size: number
  kind: FileKind
  uploaded?: 0 | 1
  pageCount?: number
}

export interface Note extends Base {
  unitId: string
  courseId: string
  doc: JSONContent | null
  text: string
}

export type QType = 'single' | 'multi' | 'truefalse' | 'open'

export interface Question {
  id: string
  number?: string
  type: QType
  text: string
  options: string[]
  correct: number[] | null // indici corretti (per single/multi/truefalse)
  solution: string | null // soluzione testuale (aperte) o spiegazione presente nel pdf
  solutionFromPdf: boolean
  points?: string
  page?: number
  fileId?: string
}

export interface Quiz extends Base {
  courseId: string
  title: string
  fileIds: string[]
  questions: Question[]
  createdAt: number
}

export interface AnswerResult {
  given: number[] | string | null
  correct: boolean | null // null = da valutare / non valutabile
  score?: number // 0..1 per aperte
  feedback?: string
  aiCorrect?: number[] // risposta giusta stabilita dall'AI se il PDF non la contiene
}

export interface Attempt extends Base {
  quizId: string
  courseId: string
  answers: Record<string, AnswerResult>
  score: number
  total: number
  finishedAt: number | null
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  at: number
}

export interface Chat extends Base {
  unitId: string
  messages: ChatMsg[]
}

export interface Asset extends Base {
  courseId: string
  mime: string
  uploaded?: 0 | 1
}

export interface Flashcard extends Base {
  courseId: string
  unitId: string | null
  front: string
  back: string
  // Leitner / SM-2 semplificato
  due: number
  interval: number
  ease: number
  reps: number
}

export interface BlobRec {
  id: string
  blob: Blob
}

export interface MetaRec {
  key: string
  value: unknown
}

class RipassoDB extends Dexie {
  courses!: Table<Course, string>
  units!: Table<Unit, string>
  files!: Table<FileRec, string>
  notes!: Table<Note, string>
  quizzes!: Table<Quiz, string>
  attempts!: Table<Attempt, string>
  chats!: Table<Chat, string>
  assets!: Table<Asset, string>
  flashcards!: Table<Flashcard, string>
  blobs!: Table<BlobRec, string>
  meta!: Table<MetaRec, string>

  constructor() {
    super('ripasso')
    this.version(1).stores({
      courses: 'id, order, dirty, deleted',
      units: 'id, courseId, order, dirty, deleted',
      files: 'id, courseId, unitId, dirty, deleted',
      notes: 'id, unitId, courseId, dirty, deleted',
      quizzes: 'id, courseId, dirty, deleted',
      attempts: 'id, quizId, courseId, dirty, deleted',
      chats: 'id, unitId, dirty, deleted',
      assets: 'id, courseId, dirty, deleted',
      flashcards: 'id, courseId, unitId, due, dirty, deleted',
      blobs: 'id',
      meta: 'key',
    })
  }
}

export const db = new RipassoDB()

export const SYNC_TABLES = [
  'courses',
  'units',
  'files',
  'notes',
  'quizzes',
  'attempts',
  'chats',
  'assets',
  'flashcards',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 20)

type Listener = () => void
const changeListeners = new Set<Listener>()
export const onLocalChange = (fn: Listener) => {
  changeListeners.add(fn)
  return () => {
    changeListeners.delete(fn)
  }
}
const emitChange = () => changeListeners.forEach((f) => f())

/** Salva (crea o aggiorna) un record e lo marca da sincronizzare. */
export async function put<T extends Base>(table: SyncTable, rec: T): Promise<T> {
  const r = { ...rec, updatedAt: Date.now(), dirty: 1 as const, deleted: rec.deleted ?? 0 }
  await (db[table] as unknown as Table<T, string>).put(r)
  emitChange()
  return r
}

export async function patch<T extends Base>(table: SyncTable, id: string, changes: Partial<T>) {
  const t = db[table] as unknown as Table<T, string>
  const cur = await t.get(id)
  if (!cur) return
  await put(table, { ...cur, ...changes })
}

/** Cancellazione "soft" così si propaga agli altri dispositivi. */
export async function remove(table: SyncTable, id: string) {
  await patch(table, id, { deleted: 1 } as Partial<Base>)
}

export const alive = <T extends Base>(arr: T[]) => arr.filter((r) => !r.deleted)

export async function getMeta<T>(key: string, def: T): Promise<T> {
  const r = await db.meta.get(key)
  return (r?.value as T) ?? def
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

export const COURSE_COLORS = ['#6d5efc', '#e05cff', '#ff6b8b', '#ff9f43', '#f7c948', '#2ecc9a', '#27b3e6', '#5b8cff', '#a0a4b8']
export const COURSE_EMOJI = ['📘', '🧮', '💻', '🧪', '📐', '🧠', '⚙️', '📊', '🌍', '⚖️', '🧬', '🎨', '📡', '🔐', '🗄️', '🐧']

export async function deleteCourseDeep(courseId: string) {
  for (const u of await db.units.where('courseId').equals(courseId).toArray()) await remove('units', u.id)
  for (const f of await db.files.where('courseId').equals(courseId).toArray()) await remove('files', f.id)
  for (const n of await db.notes.where('courseId').equals(courseId).toArray()) await remove('notes', n.id)
  for (const q of await db.quizzes.where('courseId').equals(courseId).toArray()) await remove('quizzes', q.id)
  for (const c of await db.flashcards.where('courseId').equals(courseId).toArray()) await remove('flashcards', c.id)
  await remove('courses', courseId)
}

export async function deleteUnitDeep(unitId: string) {
  for (const f of await db.files.where('unitId').equals(unitId).toArray()) await patch<FileRec>('files', f.id, { unitId: null })
  const n = await db.notes.get(unitId)
  if (n) await remove('notes', n.id)
  await remove('units', unitId)
}
