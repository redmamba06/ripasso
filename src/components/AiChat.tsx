import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { Send, X, Sparkles, FilePlus2, Trash2, Loader2, Image as ImageIcon, Presentation, NotebookPen, Square } from 'lucide-react'
import { db, put, type Chat, type ChatMsg } from '../lib/db'
import { stream, SYSTEM_TUTOR, type GMsg, type Part } from '../lib/groq'
import { mdToHtml, renderMath } from '../lib/markdown'
import { settings } from '../lib/settings'
import { toast } from './Toast'

export interface ChatContext {
  courseName: string
  unitTitle: string
  slide?: (withImage: boolean) => Promise<{ page: number; text: string; image?: string } | null>
  notes?: () => string
}

export interface AiChatHandle {
  ask: (text: string, opts?: { withImage?: boolean }) => void
}

export function AiChat({
  unitId,
  ctx,
  onClose,
  onInsert,
  handle,
}: {
  unitId: string
  ctx: ChatContext
  onClose: () => void
  onInsert: (md: string) => void
  handle: React.MutableRefObject<AiChatHandle | null>
}) {
  const chatRec = useLiveQuery(() => db.chats.get(unitId), [unitId])
  const messages = chatRec?.deleted ? [] : (chatRec?.messages ?? [])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [useSlide, setUseSlide] = useState(true)
  const [useImage, setUseImage] = useState(false)
  const [useNotes, setUseNotes] = useState(true)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streaming])

  const save = (msgs: ChatMsg[]) => put<Chat>('chats', { id: unitId, unitId, messages: msgs.slice(-60), updatedAt: 0 })

  const send = async (text: string, opts: { withImage?: boolean } = {}) => {
    const q = text.trim()
    if (!q || streaming != null) return
    setInput('')
    const history = [...messages, { role: 'user' as const, content: q, at: Date.now() }]
    await save(history)
    setStreaming('')
    abort.current = new AbortController()
    try {
      const withImage = opts.withImage ?? useImage
      let context = `Corso: ${ctx.courseName}\nUnità: ${ctx.unitTitle}\n`
      let image: string | undefined
      if (useSlide && ctx.slide) {
        const s = await ctx.slide(!!withImage)
        if (s) {
          context += `\nSLIDE APERTA (pagina ${s.page}), testo estratto:\n"""\n${s.text.slice(0, 3500) || '(nessun testo: probabilmente solo immagini)'}\n"""\n`
          if (withImage && s.image) image = s.image
        }
      }
      if (useNotes && ctx.notes) {
        const n = ctx.notes().trim()
        if (n) context += `\nAPPUNTI DELLO STUDENTE su questa unità (estratto):\n"""\n${n.slice(-2500)}\n"""\n`
      }
      const msgs: GMsg[] = [{ role: 'system', content: SYSTEM_TUTOR + '\n\nCONTESTO ATTUALE:\n' + context }]
      for (const m of history.slice(-8, -1)) msgs.push({ role: m.role, content: m.content.slice(0, 2500) })
      const last: Part[] = [{ type: 'text', text: q }]
      if (image) last.push({ type: 'image_url', image_url: { url: image } })
      msgs.push({ role: 'user', content: image ? last : q })

      let acc = ''
      for await (const d of stream(msgs, {
        model: image ? settings().visionModel : undefined,
        maxTokens: 2500,
        signal: abort.current.signal,
        onWait: (s) => setStreaming(`_Attendo il limite gratuito di Groq (${s}s)…_`),
      })) {
        acc += d
        setStreaming(acc)
      }
      await save([...history, { role: 'assistant', content: acc || '…', at: Date.now() }])
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        toast((e as Error).message, 'error')
        await save([...history, { role: 'assistant', content: '⚠️ ' + (e as Error).message, at: Date.now() }])
      }
    } finally {
      setStreaming(null)
      abort.current = null
    }
  }
  handle.current = { ask: (t, o) => void send(t, o) }

  const quick = [
    { t: 'Spiegami questa slide', p: 'Spiegami in modo semplice e completo il contenuto della slide aperta, con un esempio.' },
    { t: 'Riassumi in appunti', p: 'Crea appunti sintetici e ben strutturati sulla slide aperta, pronti da inserire nel mio riassunto.' },
    { t: 'Domande d’esame', p: 'Fammi 4 possibili domande d’esame su questa slide, con risposta breve sotto ciascuna (nascondila con “Risposta:”).' },
    { t: 'Non ho capito…', p: 'Non ho capito bene questo concetto della slide, puoi spiegarmelo passo per passo con un’analogia?' },
  ]

  return (
    <motion.aside className="ai-panel glass-strong" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}>
      <div className="ai-head">
        <span className="ai-logo">
          <Sparkles size={15} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px]">Tutor AI</div>
          <div className="text-[11.5px] opacity-55 truncate">Groq · {settings().model.split('/').pop()}</div>
        </div>
        <button className="icon-btn sm" title="Svuota chat" onClick={() => confirm('Cancellare la conversazione?') && save([])}>
          <Trash2 size={14} />
        </button>
        <button className="icon-btn sm" onClick={onClose} title="Chiudi">
          <X size={16} />
        </button>
      </div>

      <div className="ai-msgs" ref={scroller}>
        {messages.length === 0 && streaming == null && (
          <div className="text-center py-6 px-3">
            <div className="text-[28px] mb-1">🎓</div>
            <div className="font-medium">Chiedimi qualsiasi cosa</div>
            <div className="text-[12.5px] opacity-55 mb-4">Vedo la slide aperta e i tuoi appunti.</div>
            <div className="flex flex-col gap-2">
              {quick.map((q) => (
                <button key={q.t} className="quick" onClick={() => send(q.p)}>
                  {q.t}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Msg key={i} m={m} onInsert={onInsert} />
        ))}
        {streaming != null && <Msg m={{ role: 'assistant', content: streaming || '…', at: 0 }} live />}
      </div>

      <div className="ai-foot">
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <button className={`chip ${useSlide ? 'on' : ''}`} onClick={() => setUseSlide(!useSlide)} title="Includi il testo della slide aperta">
            <Presentation size={12} /> Slide
          </button>
          <button className={`chip ${useImage ? 'on' : ''}`} onClick={() => setUseImage(!useImage)} title="Fai vedere all’AI l’immagine della slide (grafici, schemi)">
            <ImageIcon size={12} /> Immagine slide
          </button>
          <button className={`chip ${useNotes ? 'on' : ''}`} onClick={() => setUseNotes(!useNotes)} title="Includi i tuoi appunti">
            <NotebookPen size={12} /> Appunti
          </button>
        </div>
        <div className="ai-input">
          <textarea
            rows={1}
            value={input}
            placeholder="Chiedi una spiegazione…"
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
          />
          {streaming != null ? (
            <button className="send" onClick={() => abort.current?.abort()} title="Ferma">
              <Square size={14} />
            </button>
          ) : (
            <button className="send" onClick={() => send(input)} disabled={!input.trim()} title="Invia">
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  )
}

function Msg({ m, live, onInsert }: { m: ChatMsg; live?: boolean; onInsert?: (md: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')
  useEffect(() => {
    if (m.role !== 'assistant') return
    let ok = true
    void mdToHtml(m.content, false).then((h) => ok && setHtml(h))
    return () => {
      ok = false
    }
  }, [m.content, m.role])
  useEffect(() => {
    if (ref.current && html) void renderMath(ref.current)
  }, [html])
  if (m.role === 'user') return <div className="msg user">{m.content}</div>
  return (
    <div className="msg bot">
      <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: html || (live ? '<span class="typing"><i></i><i></i><i></i></span>' : '') }} />
      {!live && onInsert && (
        <button className="insert-btn" onClick={() => onInsert(m.content)}>
          <FilePlus2 size={13} /> Inserisci negli appunti
        </button>
      )}
      {live && <Loader2 size={12} className="spin opacity-40 mt-1" />}
    </div>
  )
}
