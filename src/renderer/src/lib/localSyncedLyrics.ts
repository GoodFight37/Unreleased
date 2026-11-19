// Local user-saved synced lyrics (`userData/synced-lyrics/<songId>.lrc` in
// Electron, with a localStorage fallback when running in a plain browser).
//
// Highest priority in useWrldLyricsSource: local override -> API synced_lyrics
// -> community pack -> plain lyrics / auto-pacing.
import { useEffect, useState } from 'react'
import { ls } from './persist'

interface ElectronSyncedLyricsBridge {
  readLocalSyncedLyrics?: (songId: number) => Promise<{ ok: boolean; lrc?: string | null; error?: string }>
  writeLocalSyncedLyrics?: (songId: number, lrc: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  deleteLocalSyncedLyrics?: (songId: number) => Promise<{ ok: boolean; error?: string }>
}

function bridge(): ElectronSyncedLyricsBridge | undefined {
  return (typeof window !== 'undefined' ? (window as unknown as { electron?: ElectronSyncedLyricsBridge }).electron : undefined)
}

const LS_PREFIX = 'localSyncedLyrics:'
const cache = new Map<number, string | null>()
const inflight = new Map<number, Promise<string | null>>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function subscribeLocalSyncedLyrics(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function peekLocalSyncedLyrics(songId: number | null | undefined): string | null | undefined {
  if (!songId || songId <= 0) return null
  return cache.get(songId)
}

export async function loadLocalSyncedLyrics(songId: number): Promise<string | null> {
  if (!Number.isInteger(songId) || songId <= 0) return null
  if (cache.has(songId)) return cache.get(songId) ?? null
  const pending = inflight.get(songId)
  if (pending) return pending

  const run = (async (): Promise<string | null> => {
    const el = bridge()
    if (el?.readLocalSyncedLyrics) {
      const res = await el.readLocalSyncedLyrics(songId).catch(() => ({ ok: false, lrc: null }))
      const lrc = res.ok && typeof res.lrc === 'string' && res.lrc.trim() ? res.lrc : null
      cache.set(songId, lrc)
      emit()
      return lrc
    }
    const stored = ls.get<string>(`${LS_PREFIX}${songId}`)
    const lrc = typeof stored === 'string' && stored.trim() ? stored : null
    cache.set(songId, lrc)
    emit()
    return lrc
  })().finally(() => { inflight.delete(songId) })

  inflight.set(songId, run)
  return run
}

export async function saveLocalSyncedLyrics(songId: number, lrc: string): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(songId) || songId <= 0) return { ok: false, error: 'Invalid song ID' }
  const cleaned = lrc.trim()
  if (!cleaned) return { ok: false, error: 'Empty LRC content' }

  const el = bridge()
  if (el?.writeLocalSyncedLyrics) {
    const res = await el.writeLocalSyncedLyrics(songId, cleaned).catch((e: Error) => ({ ok: false, error: e.message }))
    if (!res.ok) return { ok: false, error: res.error ?? 'Could not save local lyrics' }
  } else {
    ls.set(`${LS_PREFIX}${songId}`, cleaned)
  }
  cache.set(songId, cleaned)
  emit()
  return { ok: true }
}

export async function deleteLocalSyncedLyrics(songId: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(songId) || songId <= 0) return { ok: false, error: 'Invalid song ID' }

  const el = bridge()
  if (el?.deleteLocalSyncedLyrics) {
    const res = await el.deleteLocalSyncedLyrics(songId).catch((e: Error) => ({ ok: false, error: e.message }))
    if (!res.ok) return { ok: false, error: res.error ?? 'Could not remove local lyrics' }
  } else {
    ls.remove(`${LS_PREFIX}${songId}`)
  }
  cache.set(songId, null)
  emit()
  return { ok: true }
}

/** Reactive reader for a song's local synced-lyrics override. */
export function useLocalSyncedLyrics(songId: number | null | undefined): string | null {
  const [, setTick] = useState(0)

  useEffect(() => subscribeLocalSyncedLyrics(() => setTick((t) => t + 1)), [])

  useEffect(() => {
    if (!songId || songId <= 0) return
    if (!cache.has(songId)) void loadLocalSyncedLyrics(songId)
  }, [songId])

  if (!songId || songId <= 0) return null
  return cache.get(songId) ?? null
}
