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

const ERA_COVER_ROOTS = [
  'Compilation/4. Cover Art/2. Unreleased Discography',
  'Compilation/4. Cover Art',
]
const FAN_ARTISTS_ROOT = 'Cover Arts'

let _inflight: Promise<FanCoversIndex> | null = null

/** Build the era -> URLs and title -> URL index from the archive's Cover Art trees. */
async function crawlArchiveFanCovers(): Promise<FanCoversIndex> {
  const byEra: Record<string, string[]> = {}
  const byTitleCandidates: Record<string, string[]> = {}
  const allSet = new Set<string>()

  const registerTitle = (name: string, url: string) => {
    const titleKey = normalizeCoverTitle(name)
    if (!titleKey) return
    if (!byTitleCandidates[titleKey]) byTitleCandidates[titleKey] = []
    byTitleCandidates[titleKey].push(url)
  }

  // 1. Era-organized covers under Compilation/4. Cover Art/2. Unreleased Discography
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
      const url = buildCoverArtUrl(entry.path, false)
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
      registerTitle(entry.name, url)
    }
    if (allSet.size > 0) break
  }

  // 2. Community fan-artist covers under Cover Arts/<Artist>/<Song Title>.png
  try {
    const fanEntries = await listFilesRecursive(FAN_ARTISTS_ROOT)
    for (const entry of fanEntries) {
      if (entry.type !== 'file' || getMediaType(entry.name) !== 'image') continue
      const url = buildCoverArtUrl(entry.path, false)
      if (!url || allSet.has(url)) continue
      allSet.add(url)
      registerTitle(entry.name, url)
    }
  } catch {
    // Non-fatal: keep era covers if Cover Arts tree is unavailable
  }

  // Pick a deterministic primary cover per title (preferring standard covers over "No Text" / "Alt")
  const byTitle: Record<string, string> = {}
  for (const [titleKey, urls] of Object.entries(byTitleCandidates)) {
    urls.sort((a, b) => {
      const aAlt = /no\s*text|alt|blank|clean/i.test(a) ? 1 : 0
      const bAlt = /no\s*text|alt|blank|clean/i.test(b) ? 1 : 0
      return aAlt - bAlt || a.localeCompare(b)
    })
    byTitle[titleKey] = urls[0]
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
