// Deterministic fan-cover assignment for unreleased songs.
//
// Like coverRotation.ts and songPrefs.ts, this module stays import-free except
// for persist.ts so juicewrldApi.ts can read it synchronously inside
// overrideCoverUrl() / songToTrack() without creating a circular dependency.
import { ls } from './persist'

export type UnreleasedCoverMode = 'official_era' | 'fan_era' | 'manual_only'

export interface FanCoversIndex {
  /** Unix ms timestamp of when this index was built. */
  updatedAt: number
  /** Normalized era key -> sorted list of validated fan-cover URLs. */
  byEra: Record<string, string[]>
  /** Normalized song title -> validated fan-cover URL (exact title match). */
  byTitle: Record<string, string>
  /** Fallback pool of all validated fan covers when an era has no dedicated folder. */
  all: string[]
}

const MODE_KEY = 'unreleasedCoverMode'
const INDEX_KEY = 'fanCoversIndex:v2'
const INDEX_TTL_MS = 24 * 60 * 60 * 1000

const EMPTY_INDEX: FanCoversIndex = {
  updatedAt: 0,
  byEra: {},
  byTitle: {},
  all: [],
}

function normalizeMode(v: unknown): UnreleasedCoverMode {
  return v === 'fan_era' || v === 'manual_only' ? v : 'official_era'
}

let _mode: UnreleasedCoverMode = normalizeMode(ls.get<unknown>(MODE_KEY))
let _index: FanCoversIndex = ls.get<FanCoversIndex>(INDEX_KEY) ?? EMPTY_INDEX

/** Normalize an era name or folder name into a canonical lookup key. */
export function normalizeEraKey(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/^\d+\s*[.)-]?\s*/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!s) return ''
  // Common aliases between API era names and Compilation/4. Cover Art folder names
  if (s.includes('goodbye') || s === 'gbgr' || s === 'gb and gr') return 'gbgr'
  if (s.includes('death race') || s === 'drfl') return 'drfl'
  if (s.includes('wrld on drugs') || s === 'wod') return 'wod'
  if (s.includes('legends never die') || s === 'lnd' || s.includes('outsiders')) return 'lnd'
  if (s.includes('fighting demons') || s === 'fd') return 'fd'
  if (s.includes('party never ends') || s === 'tpne') return 'tpne'
  if (s.includes('9 9 9') || s === '999' || s.includes('juicewrld 999') || s.includes('juicethekidd')) return '999'
  if (s.includes('bingedrinking') || s === 'bdm') return 'bdm'
  if (s.includes('affliction')) return 'affliction'
  if (s.includes('heartbroken')) return 'hih'
  if (s.includes('nothings different') || s.includes('nothing s different')) return 'nd'
  if (s.includes('juiced up')) return 'jute'
  return s
}

/** Normalize a song title or cover filename stem for exact title matching. */
export function normalizeCoverTitle(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Deterministic 32-bit unsigned FNV-1a hash on songId (zero randomness, zero flicker). */
export function stableHash(songId: number): number {
  let h = 2166136261 >>> 0
  const s = String(songId)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function peekUnreleasedCoverMode(): UnreleasedCoverMode {
  return _mode
}

export function setUnreleasedCoverModeValue(mode: UnreleasedCoverMode): void {
  _mode = normalizeMode(mode)
  ls.set(MODE_KEY, _mode)
}

export function getFanCoversIndex(): FanCoversIndex {
  return _index
}

export function isFanCoversIndexFresh(): boolean {
  return _index.all.length > 0 && (Date.now() - _index.updatedAt) < INDEX_TTL_MS
}

export function setFanCoversIndex(next: FanCoversIndex): void {
  _index = next
  ls.set(INDEX_KEY, next)
}

/**
 * Deterministic fan-cover lookup for an unreleased song.
 * Priority:
 *   1. Exact title-matched fan cover (if indexed)
 *   2. Era-matched fan cover pool indexed by `stableHash(songId) % pool.length`
 *   3. Returns `undefined` when no pool exists so the caller falls back to the official era cover.
 */
export function peekFanCoverForSong(
  songId: number,
  era: string | null | undefined,
  title?: string | null,
): string | undefined {
  if (_index.all.length === 0) return undefined
  if (title) {
    const tKey = normalizeCoverTitle(title)
    if (tKey && _index.byTitle[tKey]) return _index.byTitle[tKey]
  }
  const eraKey = normalizeEraKey(era)
  const pool = (eraKey && _index.byEra[eraKey]?.length ? _index.byEra[eraKey] : null)
    ?? (_index.all.length > 0 ? _index.all : null)
  if (!pool || pool.length === 0) return undefined
  return pool[stableHash(songId) % pool.length]
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage || !e.key) return
    if (e.key === `unreleased:${MODE_KEY}`) {
      try {
        _mode = normalizeMode(e.newValue ? JSON.parse(e.newValue) : null)
      } catch { /* ignore */ }
    } else if (e.key === `unreleased:${INDEX_KEY}`) {
      try {
        _index = (e.newValue ? JSON.parse(e.newValue) : null) ?? EMPTY_INDEX
      } catch { /* ignore */ }
    }
  })
}
