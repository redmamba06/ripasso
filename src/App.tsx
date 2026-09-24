import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Menu } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Toaster, toast } from './components/Toast'
import { SearchPalette } from './components/SearchPalette'
import { useUI } from './lib/ui'
import { installShortcuts, registerShortcuts } from './lib/shortcuts'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { CourseForm } from './components/CourseForm'
import { useSettings } from './lib/settings'
import { startSync } from './lib/sync'
import Home from './pages/Home'
import CoursePage from './pages/CoursePage'
import UnitPage from './pages/UnitPage'
import QuizPlayer from './pages/QuizPlayer'
import Summary from './pages/Summary'
import SettingsPage from './pages/Settings'

function useTheme() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#12121a' : '#f6f5fb')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function Shell() {
  const sidebar = useUI((s) => s.sidebar)
  const setSidebar = useUI((s) => s.setSidebar)
  const loc = useLocation()
  const focusMode = loc.pathname.startsWith('/u/') || loc.pathname.startsWith('/q/')

  useEffect(() => {
    if (window.innerWidth < 900) setSidebar(false)
  }, [loc.pathname, setSidebar])

  const nav = useNavigate()
  useEffect(() => {
    installShortcuts()
    const ui = useUI.getState
    return registerShortcuts({
      search: () => ui().setSearch(true),
      help: () => ui().setHelp(!ui().help),
      sidebar: () => ui().setSidebar(!ui().sidebar),
      home: () => nav('/'),
      settings: () => nav('/settings'),
      newCourse: () => ui().setNewCourse(true),
      pencilMode: () => {
        const next = useSettings.getState().pencilMode === 'ink' ? 'text' : 'ink'
        useSettings.getState().set({ pencilMode: next })
        toast(next === 'ink' ? 'Apple Pencil: la scrittura resta a mano' : 'Apple Pencil: la scrittura diventa testo (Scribble)', 'info')
      },
    })
  }, [nav])

  return (
    <div className="app-shell">
      <AnimatePresence initial={false}>
        {sidebar && (
          <>
            <motion.div
              className="sidebar-backdrop md-hide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebar(false)}
            />
            <motion.div
              className="sidebar-slot"
              initial={{ x: -280, opacity: 0.4 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <Sidebar />
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <main className="main">
        {!sidebar && !focusMode && (
          <button className="menu-fab glass" onClick={() => setSidebar(true)} aria-label="Apri menu">
            <Menu size={18} />
          </button>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/c/:courseId" element={<CoursePage />} />
          <Route path="/c/:courseId/riassunto" element={<Summary />} />
          <Route path="/u/:unitId" element={<UnitPage />} />
          <Route path="/q/:quizId" element={<QuizPlayer />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <SearchPalette />
      <ShortcutsHelp />
      <GlobalCourseForm />
      <Toaster />
    </div>
  )
}

function GlobalCourseForm() {
  const open = useUI((s) => s.newCourse)
  return <CourseForm open={open} onClose={() => useUI.getState().setNewCourse(false)} />
}

export default function App() {
  useTheme()
  useEffect(() => startSync(), [])
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
