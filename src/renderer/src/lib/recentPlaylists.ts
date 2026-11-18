// Most-recently-opened playlists, for ordering Home's playlist row.
//
// Playlist plays go through dozens of call sites, so "opened" (selected in the
// Playlists view) stands in for "played". Keys match HomePlaylistCard.key
// ('p<id>' own, 'f<id>' followed); we only see numeric ids from the view's
// selectedId, so 'p' and 'f' both get stamped.

import { ls } from './persist'

const KEY = 'recent-playlists'
const PINNED_KEY = 'pinned-playlist-key'
const LIMIT = 30

export interface LeadPlaylistCandidate {
  kind: 'api' | 'local'
  key: string
  id: number | string
  name: string
  trackCount: number
  pinned: boolean
}

export function loadRecentPlaylistIds(): number[] {
  const saved = ls.get<number[]>(KEY)
  return Array.isArray(saved) ? saved.slice(0, LIMIT) : []
}

export function rememberRecentPlaylist(id: number): void {
  ls.set(KEY, [id, ...loadRecentPlaylistIds().filter((x) => x !== id)].slice(0, LIMIT))
}

export function loadPinnedPlaylistKey(): string | null {
  const saved = ls.get<string>(PINNED_KEY)
  return typeof saved === 'string' && /^(api|local):.+/.test(saved) ? saved : null
}

export function savePinnedPlaylistKey(key: string | null): void {
  if (key) ls.set(PINNED_KEY, key)
  else ls.remove(PINNED_KEY)
}

/** Picks the lead playlist for Collection: explicit pin first, then most-recently
 *  opened synced playlist, then the first non-empty synced or local playlist,
 *  and finally any existing playlist. Returns null when the user has none. */
export function pickLeadPlaylist(
  playlists: ReadonlyArray<{ id: number; name: string; track_count: number }>,
  localPlaylists: ReadonlyArray<{ id: string; name: string; trackIds: string[] }>,
  pinnedKey: string | null,
  recentIds: ReadonlyArray<number>,
): LeadPlaylistCandidate | null {
  const toApi = (p: { id: number; name: string; track_count: number }, pinned: boolean): LeadPlaylistCandidate => ({
    kind: 'api', key: `api:${p.id}`, id: p.id, name: p.name, trackCount: p.track_count, pinned,
  })
  const toLocal = (lp: { id: string; name: string; trackIds: string[] }, pinned: boolean): LeadPlaylistCandidate => ({
    kind: 'local', key: `local:${lp.id}`, id: lp.id, name: lp.name, trackCount: lp.trackIds.length, pinned,
  })

  if (pinnedKey) {
    if (pinnedKey.startsWith('api:')) {
      const id = Number(pinnedKey.slice(4))
      const found = playlists.find((p) => p.id === id)
      if (found) return toApi(found, true)
    } else if (pinnedKey.startsWith('local:')) {
      const id = pinnedKey.slice(6)
      const found = localPlaylists.find((lp) => lp.id === id)
      if (found) return toLocal(found, true)
    }
  }

  for (const recentId of recentIds) {
    const found = playlists.find((p) => p.id === recentId)
    if (found) return toApi(found, false)
  }

  const nonEmptyApi = playlists.find((p) => p.track_count > 0)
  if (nonEmptyApi) return toApi(nonEmptyApi, false)
  const nonEmptyLocal = localPlaylists.find((lp) => lp.trackIds.length > 0)
  if (nonEmptyLocal) return toLocal(nonEmptyLocal, false)
  if (playlists[0]) return toApi(playlists[0], false)
  if (localPlaylists[0]) return toLocal(localPlaylists[0], false)
  return null
}
