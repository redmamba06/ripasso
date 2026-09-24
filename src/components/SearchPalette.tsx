import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Search, FileText, BookOpen, ListChecks } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useUI } from '../lib/ui'
import { db, alive } from '../lib/db'

interface Hit {
  kind: 'course' | 'unit' | 'note' | 'quiz'
  title: string
  sub: string
  to: string
  snippet?: string
}

export function SearchPalette() {
  const open = useUI((s) => s.search)
  const setOpen = useUI((s) => s.setSearch)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const data = useLiveQuery(
    async () =>
      open
        ? {
            courses: alive(await db.courses.toArray()),
            units: alive(await db.units.toArray()),
            notes: alive(await db.notes.toArray()),
            quizzes: alive(await db.quizzes.toArray()),
          }
        : null,
    [open],
  )

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => input.current?.focus(), 30)
    }
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    if (!data) return []
    const s = q.toLowerCase().trim()
    const cname = (id: string) => data.courses.find((c) => c.id === id)?.name ?? ''
    const out: Hit[] = []
    for (const c of data.courses) if (!s || c.name.toLowerCase().includes(s)) out.push({ kind: 'course', title: `${c.emoji} ${c.name}`, sub: 'Corso', to: `/c/${c.id}` })
    for (const u of data.units) if (!s || u.title.toLowerCase().includes(s)) out.push({ kind: 'unit', title: u.title, sub: cname(u.courseId), to: `/u/${u.id}` })
    for (const qz of data.quizzes) if (s && qz.title.toLowerCase().includes(s)) out.push({ kind: 'quiz', title: qz.title, sub: 'Quiz · ' + cname(qz.courseId), to: `/q/${qz.id}` })
    if (s.length >= 2) {
      for (const n of data.notes) {
        const i = n.text.toLowerCase().indexOf(s)
        if (i < 0) continue
        const u = data.units.find((x) => x.id === n.unitId)
        if (!u) continue
        const a = Math.max(0, i - 40)
        out.push({
          kind: 'note',
          title: u.title,
          sub: 'Appunti · ' + cname(n.courseId),
          to: `/u/${u.id}`,
          snippet: (a > 0 ? '…' : '') + n.text.slice(a, i + s.length + 60).replace(/\n/g, ' ') + '…',
        })
      }
    }
    return out.slice(0, 40)
  }, [data, q])

  const go = (h: Hit) => {
    setOpen(false)
    nav(h.to)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-back items-start pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setOpen(false)}>
          <motion.div
            className="palette glass-strong"
            initial={{ y: -12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 border-b border-[var(--line)]">
              <Search size={18} className="opacity-50" />
              <input
                ref={input}
                className="flex-1 bg-transparent outline-none py-4 text-[16px]"
                placeholder="Cerca corsi, unità, appunti…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setSel(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false)
                  if (e.key === 'ArrowDown') setSel((x) => Math.min(x + 1, hits.length - 1))
                  if (e.key === 'ArrowUp') setSel((x) => Math.max(x - 1, 0))
                  if (e.key === 'Enter' && hits[sel]) go(hits[sel])
                }}
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {hits.length === 0 && <div className="p-6 text-center opacity-50 text-sm">Nessun risultato</div>}
              {hits.map((h, i) => (
                <button key={h.kind + h.to + i} className={`pal-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
                  <span className="pal-icon">{h.kind === 'course' ? <BookOpen size={15} /> : h.kind === 'quiz' ? <ListChecks size={15} /> : <FileText size={15} />}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium text-[14px]">{h.title}</span>
                    <span className="block truncate text-[12px] opacity-55">{h.snippet ?? h.sub}</span>
                  </span>
                  {h.snippet && <span className="text-[11px] opacity-45 shrink-0">{h.sub}</span>}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
