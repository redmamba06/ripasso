import { db, put, uid, alive, type FileRec, type FileKind, type Unit, type Note } from './db'
import { pageCount } from './pdf'

export function guessKind(name: string): FileKind {
  const n = name.toLowerCase()
  if (/soluz|solution|correz|risposte|answers/.test(n)) return 'solution'
  if (/annotat|goodnotes|notability|a mano|handwrit|scritt[oe] a mano/.test(n)) return 'handwritten'
  if (/esam|exam|compit|appell|quiz|test|simulaz|prova/.test(n)) return 'exam'
  return 'slides'
}

export function prettyName(name: string) {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const isPdf = (f: { mime?: string; name: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name)

export interface AddOpts {
  courseId: string
  unitId?: string | null
  kind?: FileKind
  /** crea un'unità per ogni PDF di slide senza unità */
  autoUnits?: boolean
}

export async function newUnit(courseId: string, title: string, mainFileId: string | null = null): Promise<Unit> {
  const units = alive(await db.units.where('courseId').equals(courseId).toArray())
  const order = units.reduce((m, u) => Math.max(m, u.order), 0) + 1
  const u = await put<Unit>('units', { id: uid(), courseId, title, order, mainFileId, status: 'todo', updatedAt: 0 })
  await put<Note>('notes', { id: u.id, unitId: u.id, courseId, doc: null, text: '', updatedAt: 0 })
  return u
}

export async function addFiles(list: File[], o: AddOpts): Promise<{ files: FileRec[]; units: Unit[] }> {
  const out: FileRec[] = []
  const units: Unit[] = []
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }))
  for (const f of sorted) {
    const id = uid()
    const mime = f.type || (isPdf(f) ? 'application/pdf' : 'application/octet-stream')
    await db.blobs.put({ id, blob: f })
    const kind = o.kind ?? guessKind(f.name)
    let unitId = o.unitId ?? null
    if (!unitId && o.autoUnits && kind === 'slides' && isPdf(f)) {
      const u = await newUnit(o.courseId, prettyName(f.name), id)
      units.push(u)
      unitId = u.id
    }
    const rec = await put<FileRec>('files', {
      id,
      courseId: o.courseId,
      unitId,
      name: f.name,
      mime,
      size: f.size,
      kind,
      uploaded: 0,
      pageCount: isPdf(f) ? await pageCount(f) : undefined,
      updatedAt: 0,
    })
    if (unitId && (kind === 'slides' || kind === 'handwritten') && isPdf(f)) {
      const u = await db.units.get(unitId)
      if (u && !u.mainFileId) await put<Unit>('units', { ...u, mainFileId: id })
    }
    out.push(rec)
  }
  return { files: out, units }
}

export function fmtSize(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

export async function downloadFile(rec: FileRec, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = rec.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
