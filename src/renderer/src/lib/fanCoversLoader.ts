// Async indexer for Fan Covers (by Era) from the Juice WRLD archive.
//
// Populates the synchronous cache in fanCovers.ts so overrideCoverUrl() can
// assign deterministic fan covers to unreleased songs with zero flicker.
import { buildStreamUrl, coverSearchQueries, filterSearchResults, getSongById, listFilesRecursive, searchFiles } from './juicewrldApi'
import { getMediaType } from './fileTypes'
import {
  getFanCoversIndex,
  isFanCoversIndexFresh,
  normalizeCoverTitle,
  normalizeEraKey,
  recordSongFanCover,
  setFanCoversIndex,
  stableHash,
  type FanCoversIndex,
} from './fanCovers'

const ERA_COVER_ROOTS = [
  'Compilation/4. Cover Art/2. Unreleased Discography',
  'Compilation/4. Cover Art',
]

let _inflight: Promise<FanCoversIndex> | null = null

/**
 * Build the era -> URLs fallback index strictly from generic era cover folders
 * (never from song-titled Cover Arts/<Artist>/<Song>.png files, so a song
 * without its own fan cover never displays another song's title on its art).
 * Title-specific fan covers from Cover Arts/ are resolved on demand in ~150 ms
 * by resolveSongFanCover().
 */
async function crawlArchiveFanCovers(): Promise<FanCoversIndex> {
  const byEra: Record<string, string[]> = {}
  const allSet = new Set<string>()

  for (const root of ERA_COVER_ROOTS) {
    let entries: Awaited<ReturnType<typeof listFilesRecursive>> = []
    try {
      entries = await listFilesRecursive(root)
    } catch {
      continue
    }
    if (entries.length === 0) continue

    for (const entry of entries) {
      if (entry.type !== 'file' || getMediaType(entry.name) !== 'image') continue
      const url = buildStreamUrl(entry.path)
      if (!url || allSet.has(url)) continue
      allSet.add(url)

      const rel = entry.path.startsWith(root) ? entry.path.slice(root.length).replace(/^\/+/, '') : entry.path
      const segments = rel.split('/').filter(Boolean)
      const folder = segments.length >= 2 ? segments[0] : ''
      const eraKey = normalizeEraKey(folder)
      if (eraKey) {
        if (!byEra[eraKey]) byEra[eraKey] = []
        byEra[eraKey].push(url)
      }
    }
    if (allSet.size > 0) break
  }

  for (const key of Object.keys(byEra)) {
    byEra[key].sort()
  }
  const all = Array.from(allSet).sort()

  const prev = getFanCoversIndex()
  const index: FanCoversIndex = {
    updatedAt: Date.now(),
    byEra,
    // Preserve on-demand song-title matches already discovered via resolveSongFanCover()
    byTitle: prev.byTitle ?? {},
    all,
  }
  if (all.length > 0) setFanCoversIndex(index)
  return index
}

/** Ensures the fan-cover index is loaded and reasonably fresh. Deduplicates concurrent calls. */
export function ensureFanCoversLoaded(force = false): Promise<FanCoversIndex> {
  if (!force && isFanCoversIndexFresh()) return Promise.resolve(getFanCoversIndex())
  if (_inflight) return _inflight
  _inflight = crawlArchiveFanCovers()
    .catch(() => getFanCoversIndex())
    .finally(() => { _inflight = null })
  return _inflight
}

const _songLookupInflight = new Map<number, Promise<string | undefined>>()
const _songLookupChecked = new Set<number>()

/**
 * Fast on-demand fan-cover lookup for a playing unreleased song (~150 ms).
 * Searches `Cover Arts/` and archive images matching the song title (or alt
 * titles), deterministically picks one via `stableHash(songId)`, and caches it
 * in `fanCovers.ts` so every future play is instant.
 */
export function resolveSongFanCover(songId: number, fallbackTitle?: string | null): Promise<string | undefined> {
  if (_songLookupChecked.has(songId)) return Promise.resolve(undefined)
  const pending = _songLookupInflight.get(songId)
  if (pending) return pending

  const run = (async (): Promise<string | undefined> => {
    let title = fallbackTitle ?? ''
    let queries: string[] = []
    try {
      const song = await getSongById(songId)
      if (song.category === 'released') return undefined
      title = song.name || title
      const existing = getFanCoversIndex().byTitle[normalizeCoverTitle(title)]
      if (existing) return existing
      queries = coverSearchQueries(song.name, (song.track_titles ?? []).filter(Boolean))
    } catch {
      if (!title) return undefined
      queries = [title]
    }
    if (queries.length === 0) return undefined

    const lists = await Promise.all(queries.slice(0, 2).map((q) =>
      searchFiles(q).then((entries) => filterSearchResults(entries, q)).catch(() => []),
    ))

    const seen = new Set<string>()
    const candidates: string[] = []
    for (const list of lists) {
      for (const e of list) {
        if (e.type !== 'file' || getMediaType(e.name) !== 'image' || seen.has(e.path)) continue
        seen.add(e.path)
        const url = buildStreamUrl(e.path)
        if (url) candidates.push(url)
      }
    }
    if (candidates.length === 0) return undefined

    // Prefer Cover Arts/<Artist>/ standard covers over "No Text" / "Alt" / generic paths
    const standard = candidates.filter((u) => !/no\s*text|alt|blank|clean/i.test(decodeURIComponent(u)))
    const pool = (standard.length > 0 ? standard : candidates).sort((a, b) => {
      const aFan = /Cover%20Arts|Cover Arts/i.test(a) ? 0 : 1
      const bFan = /Cover%20Arts|Cover Arts/i.test(b) ? 0 : 1
      return aFan - bFan || a.localeCompare(b)
    })

    const chosen = pool[stableHash(songId) % pool.length]
    recordSongFanCover(title, chosen)
    return chosen
  })()
    .catch(() => undefined)
    .finally(() => {
      _songLookupChecked.add(songId)
      _songLookupInflight.delete(songId)
    })

  _songLookupInflight.set(songId, run)
  return run
}
