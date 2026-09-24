import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { db, SYNC_TABLES, getMeta, setMeta, onLocalChange, type SyncTable, type Base } from './db'
import { useSettings, SYNCED_SETTINGS } from './settings'

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

interface SyncState {
  status: SyncStatus
  user: User | null
  lastSync: number | null
  error: string | null
}
export const useSync = create<SyncState>(() => ({ status: 'off', user: null, lastSync: null, error: null }))

let client: SupabaseClient | null = null
let clientKey = ''
const BUCKET = 'blobs'

export function supa(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnon } = useSettings.getState()
  if (!supabaseUrl || !supabaseAnon) return null
  const key = supabaseUrl + '|' + supabaseAnon
  if (!client || key !== clientKey) {
    client = createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ripasso:auth' },
    })
    clientKey = key
    client.auth.onAuthStateChange((_e, session) => {
      useSync.setState({ user: session?.user ?? null, status: session?.user ? 'idle' : 'off' })
      if (session?.user) scheduleSync(50)
    })
  }
  return client
}

export async function signIn(email: string, password: string) {
  const c = supa()
  if (!c) throw new Error('Configura prima Supabase')
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}
export async function signUp(email: string, password: string) {
  const c = supa()
  if (!c) throw new Error('Configura prima Supabase')
  const { data, error } = await c.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  if (!data.session) throw new Error('Account creato: conferma l’email e poi accedi.')
}
export async function signOut() {
  await supa()?.auth.signOut()
  useSync.setState({ user: null, status: 'off' })
}

// ---------- sync dati ----------
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | null = null

export function scheduleSync(delay = 1500) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

async function pushSettings(c: SupabaseClient, userId: string) {
  const s = useSettings.getState()
  const data: Record<string, unknown> = {}
  SYNCED_SETTINGS.forEach((k) => (data[k] = s[k]))
  const stamp = await getMeta<number>('settingsStamp', 0)
  const pushed = await getMeta<number>('settingsPushed', -1)
  if (stamp === pushed) return
  const { error } = await c.from('records').upsert({ user_id: userId, tbl: 'settings', id: 'settings', data, updated_at: stamp, deleted: false })
  if (error) throw error
  await setMeta('settingsPushed', stamp)
}

async function push(c: SupabaseClient, userId: string) {
  for (const t of SYNC_TABLES) {
    const table = db[t] as unknown as import('dexie').Table<Base, string>
    const dirty = await table.where('dirty').equals(1).toArray()
    for (let i = 0; i < dirty.length; i += 200) {
      const chunk = dirty.slice(i, i + 200)
      const rows = chunk.map((r) => {
        const { dirty: _d, ...data } = r
        return { user_id: userId, tbl: t, id: r.id, data, updated_at: r.updatedAt, deleted: !!r.deleted }
      })
      const { error } = await c.from('records').upsert(rows)
      if (error) throw error
      await db.transaction('rw', table, async () => {
        for (const r of chunk) {
          const cur = await table.get(r.id)
          if (cur && cur.updatedAt === r.updatedAt) await table.update(r.id, { dirty: 0 } as never)
        }
      })
    }
  }
}

async function pull(c: SupabaseClient) {
  let since = await getMeta<string>('lastPull', '1970-01-01T00:00:00Z')
  for (;;) {
    const { data, error } = await c
      .from('records')
      .select('tbl,id,data,updated_at,deleted,server_ts')
      .gt('server_ts', since)
      .order('server_ts', { ascending: true })
      .limit(500)
    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      if (row.tbl === 'settings') {
        const localStamp = await getMeta<number>('settingsStamp', 0)
        if (row.updated_at > localStamp) {
          applyingRemoteSettings = true
          useSettings.getState().set(row.data)
          applyingRemoteSettings = false
          await setMeta('settingsStamp', row.updated_at)
          await setMeta('settingsPushed', row.updated_at)
        }
        continue
      }
      if (!(SYNC_TABLES as readonly string[]).includes(row.tbl)) continue
      const table = db[row.tbl as SyncTable] as unknown as import('dexie').Table<Base, string>
      const local = await table.get(row.id)
      if (local && local.dirty && local.updatedAt > row.updated_at) continue
      await table.put({ ...(row.data as Base), updatedAt: row.updated_at, deleted: row.deleted ? 1 : 0, dirty: 0 })
    }
    since = data[data.length - 1].server_ts
    await setMeta('lastPull', since)
    if (data.length < 500) break
  }
  remoteListeners.forEach((f) => f())
}

async function uploadBlobs(c: SupabaseClient, userId: string) {
  for (const t of ['files', 'assets'] as const) {
    const pending = (await db[t].toArray()).filter((r) => !r.uploaded && !r.deleted)
    for (const r of pending) {
      const b = await db.blobs.get(r.id)
      if (!b) continue
      const { error } = await c.storage.from(BUCKET).upload(`${userId}/${r.id}`, b.blob, { upsert: true, contentType: r.mime })
      if (error) throw error
      await db[t].update(r.id, { uploaded: 1, dirty: 1, updatedAt: Date.now() })
    }
  }
}

export async function syncNow() {
  const c = supa()
  if (!c) return
  if (running) {
    again = true
    return
  }
  const { data } = await c.auth.getSession()
  const user = data.session?.user
  if (!user) {
    useSync.setState({ status: 'off', user: null })
    return
  }
  if (!navigator.onLine) {
    useSync.setState({ status: 'offline' })
    return
  }
  running = true
  useSync.setState({ status: 'syncing', user })
  try {
    await uploadBlobs(c, user.id)
    await push(c, user.id)
    await pushSettings(c, user.id)
    await pull(c)
    useSync.setState({ status: 'idle', lastSync: Date.now(), error: null })
  } catch (e) {
    console.error('sync', e)
    useSync.setState({ status: 'error', error: (e as Error).message ?? String(e) })
  } finally {
    running = false
    if (again) {
      again = false
      scheduleSync(300)
    }
  }
}

/** Restituisce il contenuto binario di un file/immagine: locale o scaricato dal cloud. */
const inflight = new Map<string, Promise<Blob | null>>()
export function getBlob(id: string): Promise<Blob | null> {
  if (inflight.has(id)) return inflight.get(id)!
  const p = (async () => {
    const local = await db.blobs.get(id)
    if (local) return local.blob
    const c = supa()
    const user = useSync.getState().user
    if (!c || !user) return null
    const { data, error } = await c.storage.from(BUCKET).download(`${user.id}/${id}`)
    if (error || !data) return null
    await db.blobs.put({ id, blob: data })
    return data
  })()
  inflight.set(id, p)
  p.finally(() => inflight.delete(id))
  return p
}

const remoteListeners = new Set<() => void>()
export const onRemoteChange = (f: () => void) => {
  remoteListeners.add(f)
  return () => {
    remoteListeners.delete(f)
  }
}

let applyingRemoteSettings = false
let started = false
export function startSync() {
  if (started) return
  started = true
  // settings locali cambiate → nuovo stamp
  let prev = JSON.stringify(SYNCED_SETTINGS.map((k) => useSettings.getState()[k]))
  useSettings.subscribe((s) => {
    const cur = JSON.stringify(SYNCED_SETTINGS.map((k) => s[k]))
    if (cur !== prev) {
      prev = cur
      if (!applyingRemoteSettings) void setMeta('settingsStamp', Date.now()).then(() => scheduleSync())
    }
  })
  onLocalChange(() => scheduleSync())
  window.addEventListener('online', () => scheduleSync(100))
  window.addEventListener('focus', () => scheduleSync(100))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleSync(100))
  setInterval(() => scheduleSync(0), 60_000)

  const c = supa()
  if (!c) return
  void c.auth.getSession().then(({ data }) => {
    const user = data.session?.user ?? null
    useSync.setState({ user, status: user ? 'idle' : 'off' })
    if (user) {
      scheduleSync(10)
      c.channel('records-' + user.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${user.id}` }, () => scheduleSync(400))
        .subscribe()
    }
  })
}
