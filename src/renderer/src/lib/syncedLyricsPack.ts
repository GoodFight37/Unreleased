// Community synced-lyrics pack loader (`userData/synced-lyrics-pack.json.gz`).
//
// Lets every user of Unreleased Glass benefit from the offline CUDA GPU
// forced-alignment pack published as a lightweight (~2-4 MB) GitHub Release
// asset, without bundling Whisper/Python inside Electron.
//
// Priority in useWrldLyricsSource:
//   1. Local user override (`userData/synced-lyrics/<songId>.lrc`)
//   2. Official API `synced_lyrics`
//   3. Community pack (`synced-lyrics-pack.json.gz`)
//   4. Plain `lyrics` / auto-pacing
import { useEffect, useState } from 'react'

interface PackPayload {
  version?: string
  generated_at?: string
  songs?: Record<string, string>
}

interface PackMeta {
  etag?: string
  version?: string
  checkedAt?: number
}

interface ElectronPackBridge {
  readSyncedLyricsPack?: () => Promise<{ ok: boolean; data?: PackPayload | Record<string, string> | null; meta?: PackMeta | null }>
  writeSyncedLyricsPack?: (gzBytes: Uint8Array, meta?: PackMeta) => Promise<{ ok: boolean; count?: number; error?: string }>
}

function bridge(): ElectronPackBridge | undefined {
  return (typeof window !== 'undefined' ? (window as unknown as { electron?: ElectronPackBridge }).electron : undefined)
}

/** GitHub Release asset URL for the latest community synced-lyrics pack. */
export const SYNCED_LYRICS_PACK_URL =
  'https://github.com/GoodFight37/Unreleased/releases/download/lyrics-pack-latest/synced-lyrics-pack.json.gz'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

let _songs: Record<string, string> = {}
let _meta: PackMeta | null = null
let _loaded = false
let _initPromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

function extractSongsMap(data: PackPayload | Record<string, string> | null | undefined): Record<string, string> {
  if (!data || typeof data !== 'object') return {}
  if ('songs' in data && data.songs && typeof data.songs === 'object') {
    return data.songs as Record<string, string>
  }
  return data as Record<string, string>
}

export function peekPackSyncedLyrics(songId: number | null | undefined): string | null {
  if (!songId || songId <= 0) return null
  const hit = _songs[String(songId)]
  return typeof hit === 'string' && hit.trim() ? hit : null
}

export function getPackSyncedLyricsCount(): number {
  return Object.keys(_songs).length
}

/**
 * Loads the locally cached pack from userData (instant) and, at most once per
 * 24h, checks GitHub Releases for an updated compressed pack in the background.
 * Completely silent if offline or if no release pack has been published yet.
 */
export function initSyncedLyricsPack(): Promise<void> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const el = bridge()
    if (!el?.readSyncedLyricsPack) {
      _loaded = true
      return
    }
    const local = await el.readSyncedLyricsPack().catch(() => ({ ok: false, data: null, meta: null }))
    if (local.ok && local.data) {
      _songs = extractSongsMap(local.data)
      _meta = local.meta ?? null
      emit()
    }
    _loaded = true

    const lastCheck = _meta?.checkedAt ?? 0
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return

    // Background conditional fetch — never blocks startup or throws visibly.
    try {
      const headers: Record<string, string> = {}
      if (_meta?.etag) headers['If-None-Match'] = _meta.etag
      const res = await fetch(SYNCED_LYRICS_PACK_URL, { headers })
      if (res.status === 304 || !res.ok) return
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength === 0) return
      const nextMeta: PackMeta = {
        etag: res.headers.get('etag') ?? undefined,
        checkedAt: Date.now(),
      }
      if (el.writeSyncedLyricsPack) {
        const saved = await el.writeSyncedLyricsPack(buf, nextMeta)
        if (saved.ok) {
          const reloaded = await el.readSyncedLyricsPack()
          if (reloaded.ok && reloaded.data) {
            _songs = extractSongsMap(reloaded.data)
            _meta = reloaded.meta ?? nextMeta
            emit()
          }
        }
      }
    } catch {
      // Offline or release not published yet — stay quiet.
    }
  })()
  return _initPromise
}

/** Reactive reader for a song's entry in the community synced-lyrics pack. */
export function usePackSyncedLyrics(songId: number | null | undefined): string | null {
  const [, setTick] = useState(0)

  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    listeners.add(fn)
    if (!_loaded) void initSyncedLyricsPack()
    return () => { listeners.delete(fn) }
  }, [])

  return peekPackSyncedLyrics(songId)
}
