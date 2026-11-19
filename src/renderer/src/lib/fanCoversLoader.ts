// Async indexer for Fan Covers (by Era) from the Juice WRLD archive.
//
// Populates the synchronous cache in fanCovers.ts so overrideCoverUrl() can
// assign deterministic fan covers to unreleased songs with zero flicker.
import { buildCoverArtUrl, listFilesRecursive } from './juicewrldApi'
import { getMediaType } from './fileTypes'
import {
  getFanCoversIndex,
  isFanCoversIndexFresh,
  normalizeCoverTitle,
  normalizeEraKey,
  setFanCoversIndex,
  type FanCoversIndex,
} from './fanCovers'

const COVER_ART_ROOTS = [
  'Compilation/4. Cover Art',
  'Compilation/Cover Art',
]

let _inflight: Promise<FanCoversIndex> | null = null

/** Build the era -> URLs and title -> URL index from the archive's Cover Art tree. */
async function crawlArchiveFanCovers(): Promise<FanCoversIndex> {
  const byEra: Record<string, string[]> = {}
  const byTitle: Record<string, string> = {}
  const allSet = new Set<string>()

  for (const root of COVER_ART_ROOTS) {
    let entries: Awaited<ReturnType<typeof listFilesRecursive>> = []
    try {
      entries = await listFilesRecursive(root)
    } catch {
      continue
    }
    if (entries.length === 0) continue

    for (const entry of entries) {
      if (entry.type !== 'file' || getMediaType(entry.name) !== 'image') continue
      const url = buildCoverArtUrl(entry.path, false)
      if (!url || allSet.has(url)) continue
      allSet.add(url)

      // Determine era from the subfolder under root (e.g. "Compilation/4. Cover Art/GB&GR/foo.png")
      const rel = entry.path.startsWith(root) ? entry.path.slice(root.length).replace(/^\/+/, '') : entry.path
      const segments = rel.split('/').filter(Boolean)
      const folder = segments.length >= 2 ? segments[0] : ''
      const eraKey = normalizeEraKey(folder)
      if (eraKey) {
        if (!byEra[eraKey]) byEra[eraKey] = []
        byEra[eraKey].push(url)
      }

      const titleKey = normalizeCoverTitle(entry.name)
      if (titleKey && !byTitle[titleKey]) {
        byTitle[titleKey] = url
      }
    }
    if (allSet.size > 0) break
  }

  // Sort every pool deterministically so stableHash(songId) % pool.length
  // produces the exact same cover across sessions and machines.
  for (const key of Object.keys(byEra)) {
    byEra[key].sort()
  }
  const all = Array.from(allSet).sort()

  const index: FanCoversIndex = {
    updatedAt: Date.now(),
    byEra,
    byTitle,
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
