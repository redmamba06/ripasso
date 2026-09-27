import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { KeyRound, Cloud, Palette, Sparkles, Smartphone, Loader2, CheckCircle2, LogOut, RefreshCw, Eye, EyeOff, Download, Upload, Link2 } from 'lucide-react'
import { useSettings, type Theme } from '../lib/settings'
import { useSync, signIn, signUp, signOut, syncNow, supa } from '../lib/sync'
import { chat, aiStatus } from '../lib/groq'
import { ShortcutsEditor } from '../components/ShortcutsEditor'
import { db, SYNC_TABLES } from '../lib/db'
import { toast } from '../components/Toast'
import { download } from '../lib/export'
import { pickFiles } from '../components/Dropzone'

export default function SettingsPage() {
  const s = useSettings()
  const sync = useSync()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  const testKey = async () => {
    setTesting(true)
    try {
      const r = await chat([{ role: 'user', content: 'Reply only: ok' }], { maxTokens: 50 })
      toast(r ? 'AI is working ✓' : 'Empty reply', r ? 'ok' : 'error')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  const auth = async (mode: 'in' | 'up') => {
    setAuthBusy(true)
    try {
      supa()
      if (mode === 'in') await signIn(email, pass)
      else await signUp(email, pass)
      toast('Signed in: syncing…')
      await syncNow()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setAuthBusy(false)
    }
  }

  const backup = async () => {
    const out: Record<string, unknown[]> = {}
    for (const t of SYNC_TABLES) out[t] = await db[t].toArray()
    download(`ripasso-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), 'application/json')
    toast('Backup downloaded (without the PDFs, which stay in the cloud / on this device)')
  }
  const restore = async () => {
    const [f] = await pickFiles('application/json,.json', false)
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      for (const t of SYNC_TABLES) if (Array.isArray(data[t])) await (db[t] as unknown as import('dexie').Table<object, string>).bulkPut(data[t].map((r: object) => ({ ...r, dirty: 1 })))
      toast('Backup restored')
    } catch {
      toast('Invalid backup file', 'error')
    }
  }

  const [ai, setAi] = useState<Awaited<ReturnType<typeof aiStatus>> | null>(null)
  useEffect(() => {
    let ok = true
    setAi(null)
    void aiStatus().then((r) => ok && setAi(r))
    return () => {
      ok = false
    }
  }, [sync.user, s.groqKey])
  useEffect(() => {
    if (location.hash.includes('shortcuts')) setTimeout(() => document.getElementById('shortcuts')?.scrollIntoView({ behavior: 'smooth' }), 300)
  }, [])

  const card = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05 } })

  return (
    <div className="page max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Settings</h1>

      <motion.section {...card(0)} className="card mb-4">
        <h2 className="set-title">
          <Palette size={17} /> Appearance
        </h2>
        <div className="seg w-fit">
          {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => s.set({ theme: t })}>
              {t === 'auto' ? 'Automatic' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer">
          <input type="checkbox" className="toggle" checked={s.autoLink} onChange={(e) => s.set({ autoLink: e.target.checked })} />
          <span>
            <span className="font-medium flex items-center gap-1.5">
              <Link2 size={14} /> Auto-link notes to slides
            </span>
            <span className="block text-[12.5px] opacity-60">Every new block of notes is linked to the open slide. Change or remove the link with the pencil next to the number.</span>
          </span>
        </label>
        <div className="mt-4">
          <div className="label">Apple Pencil on your notes</div>
          <div className="seg w-fit">
            <button className={s.pencilMode === 'ink' ? 'on' : ''} onClick={() => s.set({ pencilMode: 'ink' })}>
              Keep handwriting
            </button>
            <button className={s.pencilMode === 'text' ? 'on' : ''} onClick={() => s.set({ pencilMode: 'text' })}>
              Convert to text (Scribble)
            </button>
          </div>
          <p className="text-[12.5px] opacity-60 mt-1.5">
            “Handwriting”: write anywhere with the Pencil and your handwriting stays (Scribble is disabled on your notes). “Text”: the iPad turns your writing into typed text. You can switch on the fly from the unit toolbar too. If the iPad still converts to text, turn off Scribble in the iPad’s Settings → Apple Pencil → Scribble.
          </p>
        </div>
      </motion.section>

      <motion.section {...card(1)} className="card mb-4">
        <h2 className="set-title">
          <Sparkles size={17} /> Artificial intelligence (Groq)
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0 text-[13.5px]">
            {ai === 'key' && <span>You are using a personal Groq key on this device.</span>}
            {ai === 'account' && (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> AI active through your account: the key is kept on the server, no need to paste it.
              </span>
            )}
            {ai === 'forbidden' && <span className="text-rose-500">This account is not enabled for the AI.</span>}
            {ai === 'none' && <span className="opacity-70">Sign in to your account (below) to use the AI on any device.</span>}
            {ai === null && <span className="opacity-50">Checking…</span>}
          </div>
          <button className="btn" onClick={testKey} disabled={testing || ai === 'none' || ai === 'forbidden'}>
            {testing ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} Test
          </button>
        </div>
        <details className="text-[13px] mt-3">
          <summary className="cursor-pointer opacity-70">Use a personal Groq key (optional)</summary>
          <div className="relative mt-2">
            <input className="field pr-10 font-mono text-[13px]" type={showKey ? 'text' : 'password'} value={s.groqKey} placeholder="gsk_… (leave empty to use your account)" onChange={(e) => s.set({ groqKey: e.target.value.trim() })} />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50" onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-[12px] opacity-55 mt-1.5">Stays on this device only.</p>
        </details>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <label>
            <span className="label">Text model</span>
            <select className="field" value={s.model} onChange={(e) => s.set({ model: e.target.value })}>
              <option value="openai/gpt-oss-120b">GPT-OSS 120B (best)</option>
              <option value="openai/gpt-oss-20b">GPT-OSS 20B (faster)</option>
              <option value="qwen/qwen3.8-27b">Qwen 3.8 27B</option>
            </select>
          </label>
          <label>
            <span className="label">Image model (slides, scanned PDFs)</span>
            <select className="field" value={s.visionModel} onChange={(e) => s.set({ visionModel: e.target.value })}>
              <option value="qwen/qwen3.8-27b">Qwen 3.8 27B (vision)</option>
            </select>
          </label>
        </div>
        <label className="block mt-4">
          <span className="label">AI language</span>
          <div className="seg w-fit">
            <button className={s.aiLang === 'en' ? 'on' : ''} onClick={() => s.set({ aiLang: 'en' })}>
              English
            </button>
            <button className={s.aiLang === 'it' ? 'on' : ''} onClick={() => s.set({ aiLang: 'it' })}>
              Italiano
            </button>
          </div>
          <span className="block text-[12px] opacity-55 mt-1.5">Language of chat answers, AI notes, explanations and grading. Exam questions are always kept in their original language.</span>
        </label>
      </motion.section>

      <motion.section {...card(2)} className="card mb-4">
        <h2 className="set-title">
          <Cloud size={17} /> Sync across devices
        </h2>
        {sync.user ? (
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <CheckCircle2 className="text-emerald-500" size={20} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{sync.user.email}</div>
                <div className="text-[12.5px] opacity-60">
                  {sync.status === 'syncing'
                    ? 'Syncing…'
                    : sync.status === 'error'
                      ? `Error: ${sync.error}`
                      : sync.lastSync
                        ? `Last synced at ${new Date(sync.lastSync).toLocaleTimeString('en-GB')}`
                        : 'Connected'}
                </div>
              </div>
              <button className="btn" onClick={() => syncNow()}>
                <RefreshCw size={15} className={sync.status === 'syncing' ? 'spin' : ''} /> Sync now
              </button>
              <button className="btn btn-danger-soft" onClick={() => signOut()}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] opacity-70">Sign in with the same account on your computer, iPad and iPhone to have notes, PDFs and quizzes everywhere. Without an account your data stays on this device only.</p>
            <details className="text-[13px]">
              <summary className="cursor-pointer opacity-60">Server (advanced)</summary>
              <div className="grid gap-2 mt-2">
                <input className="field font-mono text-[12.5px]" placeholder="https://xxxx.supabase.co" value={s.supabaseUrl} onChange={(e) => s.set({ supabaseUrl: e.target.value.trim() })} />
                <input className="field font-mono text-[12.5px]" placeholder="public anon key" value={s.supabaseAnon} onChange={(e) => s.set({ supabaseAnon: e.target.value.trim() })} />
              </div>
            </details>
            {s.supabaseUrl && s.supabaseAnon && (
              <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2">
                <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <input className="field" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && auth('in')} />
                <button className="btn btn-primary" disabled={authBusy || !email || pass.length < 6} onClick={() => auth('in')}>
                  {authBusy ? <Loader2 size={15} className="spin" /> : null} Sign in
                </button>
                <button className="btn" disabled={authBusy || !email || pass.length < 6} onClick={() => auth('up')}>
                  Sign up
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--line)]">
          <button className="btn" onClick={backup}>
            <Download size={15} /> Back up notes
          </button>
          <button className="btn" onClick={restore}>
            <Upload size={15} /> Restore
          </button>
        </div>
      </motion.section>

      <motion.section {...card(3)} className="card mb-4" id="shortcuts">
        <ShortcutsEditor />
      </motion.section>

      <motion.section {...card(4)} className="card mb-4">
        <h2 className="set-title">
          <Smartphone size={17} /> Install the app
        </h2>
        <ul className="text-[13.5px] opacity-80 flex flex-col gap-2 list-none">
          <li>
            <b>iPhone / iPad (Safari):</b> Share button → “Add to Home Screen”.
          </li>
          <li>
            <b>Mac / PC (Chrome or Edge):</b> install icon in the address bar → “Install Ripasso”.
          </li>
          <li>
            <b>Mac (Safari):</b> File menu → “Add to Dock”.
          </li>
        </ul>
        <p className="text-[12.5px] opacity-55 mt-2">Works offline too: changes sync as soon as you are back online.</p>
      </motion.section>
    </div>
  )
}
