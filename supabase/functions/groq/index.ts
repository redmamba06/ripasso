// Proxy verso Groq: la chiave resta nei segreti di Supabase e non arriva mai al browser.
// Risponde solo agli utenti autenticati la cui email è in ALLOWED_EMAILS.
import { createClient } from 'npm:@supabase/supabase-js@2'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'retry-after',
}
const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data, error } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  const email = data?.user?.email?.toLowerCase()
  if (error || !email) return json(401, { error: { message: 'Accesso richiesto' } })
  if (allowed.length && !allowed.includes(email)) return json(403, { error: { message: 'Questo account non è abilitato all’AI' } })
  if (req.method === 'GET') return json(200, { ok: true })

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
    body: await req.text(),
  })
  const headers = new Headers(cors)
  headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/json')
  const ra = res.headers.get('retry-after')
  if (ra) headers.set('retry-after', ra)
  return new Response(res.body, { status: res.status, headers })
})
