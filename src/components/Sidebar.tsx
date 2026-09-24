import { CourseIcon } from './CourseIcon'
import { useLiveQuery } from 'dexie-react-hooks'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Home, Plus, Settings, Search, ChevronRight, Cloud, CloudOff, RefreshCw, AlertTriangle, FileText, PanelLeftClose } from 'lucide-react'
import { db, alive } from '../lib/db'
import { useSync } from '../lib/sync'
import { addFiles } from '../lib/files'
import { CourseForm } from './CourseForm'
import { toast } from './Toast'
import { useUI } from '../lib/ui'

export function Sidebar() {
  const courses = useLiveQuery(async () => alive(await db.courses.orderBy('order').toArray()), []) ?? []
  const units = useLiveQuery(async () => alive(await db.units.toArray()), []) ?? []
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [newCourse, setNewCourse] = useState(false)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const loc = useLocation()
  const nav = useNavigate()
  const sync = useSync()
  const setSidebar = useUI((s) => s.setSidebar)

  const drop = async (e: React.DragEvent, courseId: string, unitId?: string) => {
    e.preventDefault()
    setDropOn(null)
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    const r = await addFiles(files, { courseId, unitId: unitId ?? null, autoUnits: !unitId })
    toast(`${r.files.length} file caricati${r.units.length ? ` · ${r.units.length} unità create` : ''}`)
    setOpen((o) => ({ ...o, [courseId]: true }))
  }

  const SyncIcon = sync.status === 'syncing' ? RefreshCw : sync.status === 'error' ? AlertTriangle : sync.status === 'off' || sync.status === 'offline' ? CloudOff : Cloud
  const syncLabel =
    sync.status === 'syncing' ? 'Sincronizzo…' : sync.status === 'error' ? 'Errore di sincronizzazione' : sync.status === 'offline' ? 'Offline' : sync.status === 'off' ? 'Solo su questo dispositivo' : 'Sincronizzato'

  return (
    <aside className="sidebar">
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
        <img src="./favicon.svg" className="w-8 h-8 rounded-[10px] shadow-sm" alt="" />
        <div className="font-semibold text-[17px] tracking-tight flex-1">Ripasso</div>
        <button className="icon-btn md:hidden" onClick={() => setSidebar(false)} aria-label="Chiudi menu">
          <PanelLeftClose size={18} />
        </button>
      </div>

      <button className="side-search" onClick={() => useUI.getState().setSearch(true)}>
        <Search size={15} /> Cerca negli appunti <kbd>⌘K</kbd>
      </button>

      <nav className="px-2 flex flex-col gap-0.5">
        <NavLink to="/" end className="side-link">
          <Home size={16} /> Home
        </NavLink>
      </nav>

      <div className="side-section">
        <span>Corsi</span>
        <button className="icon-btn sm" onClick={() => setNewCourse(true)} title="Nuovo corso">
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {courses.length === 0 && (
          <button className="side-empty" onClick={() => setNewCourse(true)}>
            <Plus size={15} /> Crea il tuo primo corso
          </button>
        )}
        {courses.map((c) => {
          const cu = units.filter((u) => u.courseId === c.id).sort((a, b) => a.order - b.order)
          const isOpen = open[c.id] ?? loc.pathname.includes(c.id)
          return (
            <div key={c.id} className="mb-0.5">
              <div
                className={`side-course ${loc.pathname === `/c/${c.id}` ? 'active' : ''} ${dropOn === c.id ? 'drop' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropOn(c.id)
                }}
                onDragLeave={() => setDropOn(null)}
                onDrop={(e) => drop(e, c.id)}
              >
                <button className="chev" onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))} aria-label="Espandi">
                  <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
                </button>
                <button className="flex-1 flex items-center gap-2 min-w-0 text-left" onClick={() => nav(`/c/${c.id}`)}>
                  <span className="course-dot" style={{ background: c.color }}>
                    <CourseIcon course={c} />
                  </span>
                  <span className="truncate">{c.name}</span>
                </button>
              </div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                    <div className="side-units">
                      {cu.map((u) => (
                        <NavLink
                          key={u.id}
                          to={`/u/${u.id}`}
                          className={`side-unit ${dropOn === u.id ? 'drop' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setDropOn(u.id)
                          }}
                          onDragLeave={() => setDropOn(null)}
                          onDrop={(e) => {
                            e.stopPropagation()
                            void drop(e, c.id, u.id)
                          }}
                        >
                          <FileText size={13} className="opacity-50 shrink-0" />
                          <span className="truncate">{u.title}</span>
                          {u.status === 'done' && <span className="unit-done">✓</span>}
                        </NavLink>
                      ))}
                      {cu.length === 0 && <div className="text-[12px] opacity-50 px-3 py-1">Trascina qui i PDF delle slide</div>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>

      <div className="side-foot">
        <NavLink to="/settings" className="side-link flex-1">
          <Settings size={16} /> Impostazioni
        </NavLink>
        <button className={`sync-pill ${sync.status}`} title={sync.error ?? syncLabel} onClick={() => nav('/settings')}>
          <SyncIcon size={14} className={sync.status === 'syncing' ? 'spin' : ''} />
        </button>
      </div>
      <CourseForm open={newCourse} onClose={() => setNewCourse(false)} />
    </aside>
  )
}
