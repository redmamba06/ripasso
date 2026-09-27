// Live calendar feed (.ics) for Google / Apple Calendar.
// Public URL protected by a random token saved in the user's records (tbl = 'calfeed').
// ics.ts is a copy of src/lib/ics.ts (same builder used by the app's download button).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildIcs, type IcsCourse } from './ics.ts'

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t') ?? ''
  if (!/^[a-f0-9]{32,64}$/.test(token)) return new Response('Not found', { status: 404 })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: feed } = await sb.from('records').select('user_id, data').eq('tbl', 'calfeed').eq('data->>token', token).maybeSingle()
  if (!feed) return new Response('Not found', { status: 404 })
  const { data: rows, error } = await sb.from('records').select('data').eq('user_id', feed.user_id).eq('tbl', 'courses').eq('deleted', false)
  if (error) return new Response('Error', { status: 500 })
  const ics = buildIcs((rows ?? []).map((r) => r.data as IcsCourse), { calName: 'Ripasso – timetable', tz: (feed.data as { tz?: string }).tz || 'Europe/Rome' })
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="ripasso.ics"',
      'Cache-Control': 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
    },
  })
})
