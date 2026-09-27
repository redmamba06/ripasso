import { supa, useSync } from './sync'
import { settings } from './settings'

/**
 * Private, auto-updating calendar link (read-only).
 * A random token saved in the user's account lets the `calendar` Supabase function
 * serve the timetable as .ics to Google/Apple Calendar without a login.
 */
export async function feedUrl(reset = false): Promise<string | null> {
  const c = supa()
  const user = useSync.getState().user
  if (!c || !user) return null
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome'
  let token: string | undefined
  if (!reset) {
    const { data } = await c.from('records').select('data').eq('tbl', 'calfeed').eq('id', 'calfeed').maybeSingle()
    token = (data?.data as { token?: string } | undefined)?.token
  }
  if (!token) {
    token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const { error } = await c.from('records').upsert({ user_id: user.id, tbl: 'calfeed', id: 'calfeed', data: { token, tz }, updated_at: Date.now(), deleted: false })
    if (error) throw new Error(error.message)
  }
  return `${settings().supabaseUrl}/functions/v1/calendar?t=${token}`
}

export const googleAddUrl = (feed: string) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https:/, 'webcal:'))}`
export const webcalUrl = (feed: string) => feed.replace(/^https:/, 'webcal:')
