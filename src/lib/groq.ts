import { settings } from './settings'
import { supa } from './sync'

const URL = 'https://api.groq.com/openai/v1/chat/completions'

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export interface GMsg {
  role: 'system' | 'user' | 'assistant'
  content: string | Part[]
}

export class GroqError extends Error {}

// Il piano gratuito di Groq ha ~8000 token/minuto: teniamo una finestra scorrevole
// per non superarla ed evitare errori 429.
const TPM = 7600
const used: { t: number; n: number }[] = []
const estimate = (msgs: GMsg[], maxTokens: number) => {
  let chars = 0
  for (const m of msgs) {
    if (typeof m.content === 'string') chars += m.content.length
    else for (const p of m.content) chars += p.type === 'text' ? p.text.length : 3000
  }
  return Math.ceil(chars / 3.2) + maxTokens
}
async function waitBudget(n: number, onWait?: (s: number) => void) {
  for (;;) {
    const now = Date.now()
    while (used.length && now - used[0].t > 60_000) used.shift()
    const sum = used.reduce((a, b) => a + b.n, 0)
    if (sum + n <= TPM || used.length === 0) {
      const e = { t: now, n }
      used.push(e)
      return e
    }
    const wait = 60_000 - (now - used[0].t) + 200
    onWait?.(Math.ceil(wait / 1000))
    await new Promise((r) => setTimeout(r, Math.min(wait, 5000)))
  }
}

export interface CallOpts {
  model?: string
  maxTokens?: number
  temperature?: number
  json?: boolean
  signal?: AbortSignal
  onWait?: (seconds: number) => void
  reasoning?: 'low' | 'medium' | 'high'
}

function body(msgs: GMsg[], o: CallOpts, stream: boolean) {
  const model = o.model ?? settings().model
  const b: Record<string, unknown> = {
    model,
    messages: msgs,
    max_completion_tokens: o.maxTokens ?? 2000,
    temperature: o.temperature ?? 0.4,
    stream,
  }
  if (o.json) b.response_format = { type: 'json_object' }
  if (model.startsWith('openai/gpt-oss')) b.reasoning_effort = o.reasoning ?? 'low'
  if (model.startsWith('qwen/')) b.reasoning_effort = 'none'
  return JSON.stringify(b)
}

let lastSlot: { n: number } | null = null
/** dopo la risposta sostituisce la stima con i token realmente usati */
const settle = (slot: { n: number } | null, real?: number) => {
  if (slot && real && real > 0) slot.n = real
}

/** Chiave personale → Groq diretto; altrimenti passa dal server con l'account (la chiave resta segreta). */
async function endpoint(): Promise<{ url: string; headers: Record<string, string> }> {
  const key = settings().groqKey
  if (key) return { url: URL, headers: { Authorization: `Bearer ${key}` } }
  const c = supa()
  const token = c ? (await c.auth.getSession()).data.session?.access_token : null
  if (!token) throw new GroqError('Per usare l’AI accedi al tuo account in Impostazioni.')
  const { supabaseUrl, supabaseAnon } = settings()
  return { url: `${supabaseUrl}/functions/v1/groq`, headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon } }
}

async function doFetch(msgs: GMsg[], o: CallOpts, stream: boolean): Promise<Response> {
  const ep = await endpoint()
  const maxTokens = o.maxTokens ?? 2000
  for (let attempt = 0; attempt < 4; attempt++) {
    const slot = await waitBudget(estimate(msgs, Math.min(maxTokens, 1500)), o.onWait)
    lastSlot = slot
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { ...ep.headers, 'Content-Type': 'application/json' },
      body: body(msgs, o, stream),
      signal: o.signal,
    })
    if (res.status === 429) {
      const ra = parseFloat(res.headers.get('retry-after') ?? '') || 12
      o.onWait?.(Math.ceil(ra))
      await new Promise((r) => setTimeout(r, ra * 1000 + 300))
      continue
    }
    if (!res.ok) {
      let msg = `Errore Groq ${res.status}`
      try {
        const j = await res.json()
        msg = j?.error?.message ?? msg
      } catch {
        /* */
      }
      if (res.status === 401) msg = settings().groqKey ? 'Chiave Groq non valida: controllala in Impostazioni.' : 'Sessione scaduta: rifai l’accesso in Impostazioni.'
      if (res.status === 413) msg = 'Richiesta troppo lunga per il piano gratuito Groq: prova con meno testo.'
      throw new GroqError(msg)
    }
    return res
  }
  throw new GroqError('Groq è sovraccarico, riprova tra un minuto.')
}

/** L'AI è utilizzabile? (chiave personale oppure account abilitato) */
export async function aiStatus(): Promise<'key' | 'account' | 'forbidden' | 'none'> {
  if (settings().groqKey) return 'key'
  try {
    const ep = await endpoint()
    const r = await fetch(ep.url, { headers: ep.headers })
    return r.ok ? 'account' : r.status === 403 ? 'forbidden' : 'none'
  } catch {
    return 'none'
  }
}

export async function chat(msgs: GMsg[], o: CallOpts = {}): Promise<string> {
  const res = await doFetch(msgs, o, false)
  const slot = lastSlot
  const j = await res.json()
  settle(slot, j.usage?.total_tokens)
  return (j.choices?.[0]?.message?.content ?? '').trim()
}

export async function chatJSON<T>(msgs: GMsg[], o: CallOpts = {}): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const txt = await chat(msgs, { ...o, json: true })
      return parseJSON<T>(txt)
    } catch (e) {
      lastErr = e
      if (e instanceof GroqError && !/json|parse|validate/i.test(e.message)) throw e
    }
  }
  throw lastErr
}

export function parseJSON<T>(txt: string): T {
  const s = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(s)
  } catch {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1))
    throw new GroqError('Risposta AI non in formato JSON')
  }
}

export async function* stream(msgs: GMsg[], o: CallOpts = {}): AsyncGenerator<string> {
  const res = await doFetch(msgs, o, true)
  const slot = lastSlot
  let outChars = 0
  let settled = false
  const inTok = estimate(msgs, 0)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const l = line.trim()
      if (!l.startsWith('data:')) continue
      const data = l.slice(5).trim()
      if (data === '[DONE]') {
        if (!settled) settle(slot, inTok + Math.ceil(outChars / 3.2))
        return
      }
      try {
        const j = JSON.parse(data)
        const d = j.choices?.[0]?.delta?.content
        const u = j.x_groq?.usage ?? j.usage
        if (u?.total_tokens) {
          settle(slot, u.total_tokens)
          settled = true
        }
        if (d) {
          outChars += d.length
          yield d
        }
      } catch {
        /* riga parziale */
      }
    }
  }
}

export const SYSTEM_TUTOR = `Sei "Ripasso", un tutor universitario che aiuta uno studente italiano a capire le slide dei corsi e a preparare gli esami.
- Rispondi sempre in italiano, in modo chiaro e preciso, con esempi concreti quando utili.
- Usa Markdown: titoletti brevi, elenchi, **grassetto** per i concetti chiave, blocchi di codice con il linguaggio indicato, formule LaTeX tra $...$ o $$...$$.
- Se ti vengono date slide o appunti, basati su quelli; se aggiungi qualcosa che non c'è, dillo.
- Niente preamboli o frasi di cortesia inutili.`
