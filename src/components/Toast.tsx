import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'

type Kind = 'ok' | 'error' | 'info'
interface T {
  id: number
  msg: string
  kind: Kind
}
const useToasts = create<{ list: T[] }>(() => ({ list: [] }))
let n = 0
export function toast(msg: string, kind: Kind = 'ok') {
  const id = ++n
  useToasts.setState((s) => ({ list: [...s.list, { id, msg, kind }] }))
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3000)
}

export function Toaster() {
  const list = useToasts((s) => s.list)
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none safe-bottom">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="toast glass"
          >
            {t.kind === 'ok' ? <CheckCircle2 size={16} className="text-emerald-500" /> : t.kind === 'error' ? <AlertCircle size={16} className="text-rose-500" /> : <Info size={16} className="text-accent" />}
            <span>{t.msg}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
