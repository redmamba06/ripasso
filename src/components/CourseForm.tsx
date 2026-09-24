import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { db, put, uid, alive, COURSE_COLORS, COURSE_EMOJI, type Course } from '../lib/db'

export function CourseForm({ open, onClose, course }: { open: boolean; onClose: () => void; course?: Course | null }) {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [prof, setProf] = useState('')
  const [emoji, setEmoji] = useState(COURSE_EMOJI[0])
  const [color, setColor] = useState(COURSE_COLORS[0])
  useEffect(() => {
    if (!open) return
    setName(course?.name ?? '')
    setProf(course?.professor ?? '')
    setEmoji(course?.emoji ?? COURSE_EMOJI[Math.floor(Math.random() * COURSE_EMOJI.length)])
    setColor(course?.color ?? COURSE_COLORS[Math.floor(Math.random() * COURSE_COLORS.length)])
  }, [open, course])

  const save = async () => {
    if (!name.trim()) return
    if (course) {
      await put<Course>('courses', { ...course, name: name.trim(), professor: prof.trim(), emoji, color })
      onClose()
    } else {
      const all = alive(await db.courses.toArray())
      const c = await put<Course>('courses', {
        id: uid(),
        name: name.trim(),
        professor: prof.trim(),
        emoji,
        color,
        order: all.reduce((m, x) => Math.max(m, x.order), 0) + 1,
        exam: {},
        updatedAt: 0,
      })
      onClose()
      nav(`/c/${c.id}`)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={course ? 'Modifica corso' : 'Nuovo corso'}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="course-badge big" style={{ background: color }}>
            {emoji}
          </div>
          <input className="field text-lg flex-1" autoFocus placeholder="Nome del corso (es. Sistemi Operativi)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <input className="field" placeholder="Docente (facoltativo)" value={prof} onChange={(e) => setProf(e.target.value)} />
        <div>
          <div className="label">Icona</div>
          <div className="flex flex-wrap gap-1.5">
            {COURSE_EMOJI.map((e) => (
              <button key={e} className={`emoji-pick ${e === emoji ? 'on' : ''}`} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">Colore</div>
          <div className="flex flex-wrap gap-2">
            {COURSE_COLORS.map((c) => (
              <button key={c} className={`color-pick ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            {course ? 'Salva' : 'Crea corso'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
