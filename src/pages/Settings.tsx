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
      const r = await chat([{ role: 'user', content: 'Rispondi solo: ok' }], { maxTokens: 50 })
      toast(r ? 'AI funzionante ✓' : 'Risposta vuota', r ? 'ok' : 'error')
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
      toast('Accesso effettuato: sincronizzo…')
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
    toast('Backup scaricato (senza i PDF, che restano nel cloud / su questo dispositivo)')
  }
  const restore = async () => {
    const [f] = await pickFiles('application/json,.json', false)
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      for (const t of SYNC_TABLES) if (Array.isArray(data[t])) await (db[t] as unknown as import('dexie').Table<object, string>).bulkPut(data[t].map((r: object) => ({ ...r, dirty: 1 })))
      toast('Backup ripristinato')
    } catch {
      toast('File di backup non valido', 'error')
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
    if (location.hash.includes('scorciatoie')) setTimeout(() => document.getElementById('scorciatoie')?.scrollIntoView({ behavior: 'smooth' }), 300)
  }, [])

  const card = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05 } })

  return (
    <div className="page max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Impostazioni</h1>

      <motion.section {...card(0)} className="card mb-4">
        <h2 className="set-title">
          <Palette size={17} /> Aspetto
        </h2>
        <div className="seg w-fit">
          {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => s.set({ theme: t })}>
              {t === 'auto' ? 'Automatico' : t === 'light' ? 'Chiaro' : 'Scuro'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer">
          <input type="checkbox" className="toggle" checked={s.autoLink} onChange={(e) => s.set({ autoLink: e.target.checked })} />
          <span>
            <span className="font-medium flex items-center gap-1.5">
              <Link2 size={14} /> Collegamento automatico alle slide
            </span>
            <span className="block text-[12.5px] opacity-60">Ogni nuovo blocco di appunti viene collegato alla slide aperta. Puoi cambiarlo o toglierlo con la matita accanto al numero.</span>
          </span>
        </label>
        <div className="mt-4">
          <div className="label">Apple Pencil sugli appunti</div>
          <div className="seg w-fit">
            <button className={s.pencilMode === 'ink' ? 'on' : ''} onClick={() => s.set({ pencilMode: 'ink' })}>
              Resta scrittura a mano
            </button>
            <button className={s.pencilMode === 'text' ? 'on' : ''} onClick={() => s.set({ pencilMode: 'text' })}>
              Converti in testo (Scribble)
            </button>
          </div>
          <p className="text-[12.5px] opacity-60 mt-1.5">
            “A mano”: scrivi con la Pencil ovunque e resta la tua calligrafia (Scribble è disattivato negli appunti). “Testo”: l’iPad trasforma la scrittura in testo digitato. Puoi cambiarlo al volo anche dalla barra dell’unità.
          </p>
        </div>
      </motion.section>

      <motion.section {...card(1)} className="card mb-4">
        <h2 className="set-title">
          <Sparkles size={17} /> Intelligenza artificiale (Groq)
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0 text-[13.5px]">
            {ai === 'key' && <span>Stai usando una chiave Groq personale su questo dispositivo.</span>}
            {ai === 'account' && (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> AI attiva tramite il tuo account: la chiave è custodita sul server e non serve incollarla.
              </span>
            )}
            {ai === 'forbidden' && <span className="text-rose-500">Questo account non è abilitato all’AI.</span>}
            {ai === 'none' && <span className="opacity-70">Accedi al tuo account (qui sotto) per usare l’AI su qualsiasi dispositivo.</span>}
            {ai === null && <span className="opacity-50">Controllo…</span>}
          </div>
          <button className="btn" onClick={testKey} disabled={testing || ai === 'none' || ai === 'forbidden'}>
            {testing ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} Prova
          </button>
        </div>
        <details className="text-[13px] mt-3">
          <summary className="cursor-pointer opacity-70">Usa una chiave Groq personale (facoltativo)</summary>
          <div className="relative mt-2">
            <input className="field pr-10 font-mono text-[13px]" type={showKey ? 'text' : 'password'} value={s.groqKey} placeholder="gsk_… (lascia vuoto per usare l’account)" onChange={(e) => s.set({ groqKey: e.target.value.trim() })} />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50" onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-[12px] opacity-55 mt-1.5">Resta solo su questo dispositivo.</p>
        </details>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <label>
            <span className="label">Modello per testo</span>
            <select className="field" value={s.model} onChange={(e) => s.set({ model: e.target.value })}>
              <option value="openai/gpt-oss-120b">GPT-OSS 120B (migliore)</option>
              <option value="openai/gpt-oss-20b">GPT-OSS 20B (più veloce)</option>
              <option value="qwen/qwen3.8-27b">Qwen 3.8 27B</option>
            </select>
          </label>
          <label>
            <span className="label">Modello per immagini (slide, PDF scansionati)</span>
            <select className="field" value={s.visionModel} onChange={(e) => s.set({ visionModel: e.target.value })}>
              <option value="qwen/qwen3.8-27b">Qwen 3.8 27B (visione)</option>
            </select>
          </label>
        </div>
      </motion.section>

      <motion.section {...card(2)} className="card mb-4">
        <h2 className="set-title">
          <Cloud size={17} /> Sincronizzazione tra dispositivi
        </h2>
        {sync.user ? (
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <CheckCircle2 className="text-emerald-500" size={20} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{sync.user.email}</div>
                <div className="text-[12.5px] opacity-60">
                  {sync.status === 'syncing'
                    ? 'Sincronizzazione in corso…'
                    : sync.status === 'error'
                      ? `Errore: ${sync.error}`
                      : sync.lastSync
                        ? `Ultima sincronizzazione ${new Date(sync.lastSync).toLocaleTimeString('it-IT')}`
                        : 'Connesso'}
                </div>
              </div>
              <button className="btn" onClick={() => syncNow()}>
                <RefreshCw size={15} className={sync.status === 'syncing' ? 'spin' : ''} /> Sincronizza
              </button>
              <button className="btn btn-danger-soft" onClick={() => signOut()}>
                <LogOut size={15} /> Esci
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] opacity-70">Accedi con lo stesso account su PC, iPad e iPhone per avere appunti, PDF e quiz ovunque. Senza accesso i dati restano solo su questo dispositivo.</p>
            <details className="text-[13px]">
              <summary className="cursor-pointer opacity-60">Server (avanzato)</summary>
              <div className="grid gap-2 mt-2">
                <input className="field font-mono text-[12.5px]" placeholder="https://xxxx.supabase.co" value={s.supabaseUrl} onChange={(e) => s.set({ supabaseUrl: e.target.value.trim() })} />
                <input className="field font-mono text-[12.5px]" placeholder="chiave anon pubblica" value={s.supabaseAnon} onChange={(e) => s.set({ supabaseAnon: e.target.value.trim() })} />
              </div>
            </details>
            {s.supabaseUrl && s.supabaseAnon && (
              <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2">
                <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <input className="field" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && auth('in')} />
                <button className="btn btn-primary" disabled={authBusy || !email || pass.length < 6} onClick={() => auth('in')}>
                  {authBusy ? <Loader2 size={15} className="spin" /> : null} Accedi
                </button>
                <button className="btn" disabled={authBusy || !email || pass.length < 6} onClick={() => auth('up')}>
                  Registrati
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--line)]">
          <button className="btn" onClick={backup}>
            <Download size={15} /> Backup appunti
          </button>
          <button className="btn" onClick={restore}>
            <Upload size={15} /> Ripristina
          </button>
        </div>
      </motion.section>

      <motion.section {...card(3)} className="card mb-4" id="scorciatoie">
        <ShortcutsEditor />
      </motion.section>

      <motion.section {...card(4)} className="card mb-4">
        <h2 className="set-title">
          <Smartphone size={17} /> Installa l’app
        </h2>
        <ul className="text-[13.5px] opacity-80 flex flex-col gap-2 list-none">
          <li>
            <b>iPhone / iPad (Safari):</b> tasto Condividi → “Aggiungi alla schermata Home”.
          </li>
          <li>
            <b>Mac / PC (Chrome o Edge):</b> icona di installazione nella barra degli indirizzi → “Installa Ripasso”.
          </li>
          <li>
            <b>Mac (Safari):</b> menu File → “Aggiungi al Dock”.
          </li>
        </ul>
        <p className="text-[12.5px] opacity-55 mt-2">Funziona anche offline: le modifiche si sincronizzano appena torni online.</p>
      </motion.section>
    </div>
  )
}
