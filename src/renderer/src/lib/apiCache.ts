// Hybrid memory + IndexedDB + small-entry localStorage cache for GET API
// responses. Small responses (<= 250 KB) mirror to localStorage for instant
// synchronous cold-boot apiPeek; large responses (including the 3.5 MB bulk
// catalog /songs/?all=true) persist asynchronously to IndexedDB without
// blocking the main thread or hitting localStorage's 10 MB quota.

const PREFIX = 'unreleased:apicache:'
const MAX_ENTRIES = 300
const EVICT_SLACK = 20
const MAX_LS_CHARS = 250_000
const IDB_NAME = 'unreleased-apicache-v1'
const IDB_STORE = 'entries'

interface CacheEntry<T> {
  data: T
  ts: number
}

const memCache = new Map<string, CacheEntry<unknown>>()
let idbPromise: Promise<IDBDatabase | null> | null = null

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!idbPromise) {
    idbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return idbPromise
}

function idbPut(key: string, entry: CacheEntry<unknown>): void {
  void openIdb().then((db) => {
    if (!db) return
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(entry, key)
    } catch { /* ignore quota/private mode */ }
  })
}

function idbDelete(key: string): void {
  void openIdb().then((db) => {
    if (!db) return
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(key)
    } catch { /* ignore */ }
  })
}

function idbClear(): void {
  void openIdb().then((db) => {
    if (!db) return
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).clear()
    } catch { /* ignore */ }
  })
}

/** Hydrates in-memory cache from IndexedDB in the background so large offline
 *  entries (like /songs/?all=true) are ready without synchronous startup I/O. */
export function hydrateApiCache(): Promise<void> {
  return openIdb().then((db) => {
    if (!db) return
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const store = tx.objectStore(IDB_STORE)
        const req = store.openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) { resolve(); return }
          const k = String(cursor.key)
          if (!memCache.has(k) && cursor.value && typeof cursor.value === 'object') {
            memCache.set(k, cursor.value as CacheEntry<unknown>)
          }
          cursor.continue()
        }
        req.onerror = () => resolve()
      } catch {
        resolve()
      }
    })
  })
}

// Start hydrating immediately on module load (non-blocking).
void hydrateApiCache()

function cacheKeys(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) keys.push(k)
    }
  } catch { /* storage unavailable */ }
  return keys
}

function entryTs(raw: string | null): number {
  const m = raw ? /"ts":(\d+)\}$/.exec(raw) : null
  if (m) return Number(m[1])
  try {
    return (JSON.parse(raw as string) as CacheEntry<unknown>).ts || 0
  } catch {
    return 0
  }
}

function evictOldest(count: number): void {
  const entries = cacheKeys().map((k) => ({ k, ts: entryTs(localStorage.getItem(k)) }))
  entries.sort((a, b) => a.ts - b.ts)
  for (const { k } of entries.slice(0, count)) localStorage.removeItem(k)
}

export function cacheGet<T>(key: string): T | undefined {
  const mem = memCache.get(key)
  if (mem) return mem.data as T
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as CacheEntry<T>
    memCache.set(key, parsed)
    return parsed.data
  } catch {
    return undefined
  }
}

export function cacheHas(key: string): boolean {
  if (memCache.has(key)) return true
  try {
    return localStorage.getItem(PREFIX + key) !== null
  } catch {
    return false
  }
}

export function cacheSet<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, ts: Date.now() }
  memCache.set(key, entry)
  if (memCache.size > MAX_ENTRIES * 2) {
    const oldestKey = memCache.keys().next().value
    if (oldestKey !== undefined) memCache.delete(oldestKey)
  }
  idbPut(key, entry)

  // Mirror only compact entries to localStorage for instant sync cold-boot peek.
  try {
    const raw = JSON.stringify(entry)
    if (raw.length > MAX_LS_CHARS) return
    try {
      localStorage.setItem(PREFIX + key, raw)
    } catch {
      evictOldest(Math.max(20, Math.floor(cacheKeys().length / 3)))
      try { localStorage.setItem(PREFIX + key, raw) } catch {}
    }
    const keys = cacheKeys()
    if (keys.length > MAX_ENTRIES) evictOldest(keys.length - MAX_ENTRIES + EVICT_SLACK)
  } catch { /* ignore stringify/storage errors */ }
}

export function cacheDelete(key: string): void {
  memCache.delete(key)
  idbDelete(key)
  try { localStorage.removeItem(PREFIX + key) } catch {}
}

export function cacheClearAll(): number {
  const keys = cacheKeys()
  const count = Math.max(keys.length, memCache.size)
  memCache.clear()
  idbClear()
  for (const k of keys) localStorage.removeItem(k)
  return count
}

export function cacheStats(): { count: number; bytes: number } {
  const keys = cacheKeys()
  let bytes = 0
  for (const k of keys) bytes += ((localStorage.getItem(k)?.length ?? 0) + k.length) * 2
  return { count: Math.max(keys.length, memCache.size), bytes }
}
