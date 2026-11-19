import {
  buildImageUrl,
  type JWApiSong,
  normalizeForSearch,
  parseDuration,
  smallCoverUrl,
} from './juicewrldApi'
import { eraFullName } from './eras'
import type { LibraryTrack } from '../types'

export interface IndexedSongEntry {
  song: JWApiSong
  normName: string
  normAliases: string[]
  normMeta: string
  eraDisplay: string
  coverUrl: string | undefined
  durationSec: number
  playable: boolean
}

export interface VaultSongMatch {
  entry: IndexedSongEntry
  score: number
}

let cachedSource: ReadonlyArray<JWApiSong> | null = null
let cachedEntries: IndexedSongEntry[] = []

/** Builds or reuses a normalized search index for the full catalogue.
 *  Re-indexing ~3,000 songs takes < 5 ms and only runs when the array ref changes. */
export function getSongSearchIndex(songs: ReadonlyArray<JWApiSong>): IndexedSongEntry[] {
  if (songs === cachedSource) return cachedEntries
  const out: IndexedSongEntry[] = new Array(songs.length)
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i]
    const eraRaw = song.era?.name ?? ''
    const eraFull = eraFullName(eraRaw) ?? eraRaw
    const aliases = (song.track_titles ?? []).map((a) => normalizeForSearch(a)).filter(Boolean)
    const metaParts = [
      eraRaw,
      eraFull,
      song.producers ?? '',
      song.credited_artists ?? '',
      song.category ?? '',
    ].filter(Boolean).join(' ')
    out[i] = {
      song,
      normName: normalizeForSearch(song.name),
      normAliases: aliases,
      normMeta: normalizeForSearch(metaParts),
      eraDisplay: eraFull || eraRaw,
      coverUrl: smallCoverUrl(buildImageUrl(song.image_url)),
      durationSec: parseDuration(song.length),
      playable: !!song.path,
    }
  }
  cachedSource = songs
  cachedEntries = out
  return out
}

export function searchVaultSongs(
  songs: ReadonlyArray<JWApiSong>,
  rawQuery: string,
  limit = 12,
): VaultSongMatch[] {
  const q = normalizeForSearch(rawQuery).trim()
  if (q.length < 2 || songs.length === 0) return []
  const tokens = q.split(/\s+/).filter(Boolean)
  const index = getSongSearchIndex(songs)
  const matches: VaultSongMatch[] = []

  for (let i = 0; i < index.length; i++) {
    const entry = index[i]
    let score = -1
    if (entry.normName === q) score = 0
    else if (entry.normName.startsWith(q)) score = 1
    else if (entry.normAliases.some((a) => a === q || a.startsWith(q))) score = 2
    else if (entry.normName.includes(q)) score = 3
    else if (entry.normAliases.some((a) => a.includes(q))) score = 4
    else if (entry.normMeta.includes(q)) score = 5
    else if (tokens.length > 1) {
      const combined = `${entry.normName} ${entry.normAliases.join(' ')} ${entry.normMeta}`
      if (tokens.every((t) => combined.includes(t))) score = 6
    }

    if (score >= 0) {
      // Slightly prefer playable tracks over metadata-only entries at the same tier.
      const tieBreak = entry.playable ? 0 : 0.4
      matches.push({ entry, score: score + tieBreak })
    }
  }

  matches.sort((a, b) => a.score - b.score || a.entry.normName.length - b.entry.normName.length)
  return matches.slice(0, limit)
}

export function searchLocalLibrary(
  tracks: ReadonlyArray<LibraryTrack>,
  rawQuery: string,
  limit = 6,
): LibraryTrack[] {
  const q = normalizeForSearch(rawQuery).trim()
  if (q.length < 2 || tracks.length === 0) return []
  const out: { track: LibraryTrack; score: number }[] = []
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]
    const title = normalizeForSearch(t.title || '')
    const artist = normalizeForSearch(t.artist || '')
    const album = normalizeForSearch(t.album || '')
    let score = -1
    if (title === q) score = 0
    else if (title.startsWith(q)) score = 1
    else if (title.includes(q)) score = 2
    else if (artist.includes(q) || album.includes(q)) score = 3
    if (score >= 0) out.push({ track: t, score })
  }
  out.sort((a, b) => a.score - b.score)
  return out.slice(0, limit).map((x) => x.track)
}
