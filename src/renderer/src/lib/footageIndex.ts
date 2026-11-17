import { loadFileIndex, type FileIndex } from './fileSearch'
import { normalizeForSearch, parseDuration, type JWApiFileEntry } from './juicewrldApi'
import { maxEdits, withinEdits } from './lyricSearch'

export interface FootageMatch {
  entry: JWApiFileEntry
  confidence: number
  level: 'exact' | 'shared' | 'approximate'
}

function titleKey(title: string): string {
  return normalizeForSearch(title.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/(?:\s*\([^()]*\)|\s*\[[^\[\]]*\])+\s*$/, ''))
    .replace(/\b(?:behind the scenes|studio sessions?|freestyle|snippets?|preview|bts|live|hd|official)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

/** Whole filename words only: folders and isolated substrings never identify a song. */
export function matchFootage(index: FileIndex, title: string, approximate = false): FootageMatch[] {
  const key = titleKey(title)
  if (key.replace(/ /g, '').length < 3) return []
  const words = [...new Set(key.split(' '))]
  const matches: FootageMatch[] = []
  for (const { entry, kind } of index.items) {
    if (kind !== 'video' || !/^(Footage|Snippets|Studio Sessions)\//i.test(entry.path)) continue
    const candidate = titleKey(entry.name)
    if (!candidate) continue
    if (candidate === key) {
      matches.push({ entry, confidence: 100, level: 'exact' })
      continue
    }
    const available = new Set(candidate.split(' '))
    const shared = words.filter(w => available.has(w)).length
    const coverage = shared / words.length
    if (shared >= 2 && coverage >= 0.7) {
      matches.push({ entry, confidence: Math.round(coverage * 100), level: 'shared' })
    } else if (approximate && words.length >= 2) {
      // Reserve exact words first, so one candidate word cannot satisfy two title words.
      for (const w of words) available.delete(w)
      let near = shared
      for (const w of words.filter(w => !candidate.split(' ').includes(w))) {
        const hit = [...available].find(c => maxEdits(w.length) > 0 && withinEdits(c, w, maxEdits(w.length)))
        if (hit) { available.delete(hit); near++ }
      }
      if (near >= 2 && near / words.length >= 0.7) matches.push({ entry, confidence: Math.round(near / words.length * 70), level: 'approximate' })
    }
  }
  const rank = { exact: 0, shared: 1, approximate: 2 }
  return matches.sort((a, b) => rank[a.level] - rank[b.level] || b.confidence - a.confidence || a.entry.path.localeCompare(b.entry.path))
}

/** Null means the file index is unavailable, rather than a confirmed empty result. */
export async function loadSongFootage(title: string, channel: string, approximate = false): Promise<FootageMatch[] | null> {
  const index = await loadFileIndex(channel)
  return index ? matchFootage(index, title, approximate) : null
}

export function footageBrowserOnly(entry: JWApiFileEntry): boolean {
  return (entry.size ?? 0) > 800_000_000 || parseDuration(entry.duration) > 60 * 60
}
