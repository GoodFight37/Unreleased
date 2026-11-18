import { normalizeForSearch, parseDuration, type JWApiFileEntry, type JWApiSong } from './juicewrldApi'
import { parseVideoName } from './musicVideos'
import { baseTitle, songDates } from './onThisDay'

export type FootageFamily = 'studio' | 'freestyle' | 'official' | 'snippet'
export type FootageExclusionReason = 'rights' | 'size'
export type FootageLinkLevel = 'title+date' | 'title' | 'possible'

export interface FootageSongLink {
  level: FootageLinkLevel
  via: 'name' | 'alias' | 'base'
  name: string
  entries: number
  id: number
  era: string | null
}

export interface ParsedFreestyleMeta {
  title: string
  date: string | null
  with: string[]
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i
const RIGHTS_EXCLUDED_NAMES = new Set([
  'music box juice wrld into the abyss.mp4',
])

/** Priorityfeatured paths chosen by Malik (empty by default; always ranked first when populated). */
export const FEATURED_FOOTAGE_PATHS: string[] = []

/** Archive videos that have no audio track, mapped to a copy of the same piece that has sound (another channel). */
export const FOOTAGE_AUDIO_REPLACEMENTS: Record<string, { path: string; channel: string }> = {
  'Footage/Flex (with Polo G).mp4': {
    path: 'Snippets/Polo G - Flex (feat. Juice WRLD)/Polo G - Flex (feat. Juice WRLD) (1).mov',
    channel: 'legacy',
  },
}

export function isVideoPath(path: string): boolean {
  return VIDEO_EXT_RE.test(path) && !/\.temp\.\w+$/i.test(path)
}

export function excludedFootageReason(entry: { name?: string; path: string; size?: number | null; duration?: string | null }): FootageExclusionReason | null {
  const lowerName = (entry.name || entry.path.split('/').pop() || '').toLowerCase()
  if (RIGHTS_EXCLUDED_NAMES.has(lowerName)) return 'rights'
  if ((entry.size ?? 0) > 800_000_000 || parseDuration(entry.duration) > 60 * 60) return 'size'
  return null
}

/** Classifies a file entry into one of the video footage families, or null if it is not footage
 *  (e.g. ProTools audio sessions, YouTube "Official Audio" / "Lyric Video" / "Visualizer", thumbnails). */
export function classifyFootageEntry(entry: { name?: string; path: string; type?: string }): FootageFamily | null {
  if (entry.type && entry.type !== 'file') return null
  if (!isVideoPath(entry.path)) return null
  if (/^Snippets\//i.test(entry.path)) return 'snippet'
  if (/^Footage\/Youtube\//i.test(entry.path)) {
    const parsed = parseVideoName(entry.name || entry.path.split('/').pop() || '')
    return parsed && parsed.kind === 'music' ? 'official' : null
  }
  if (/^Footage\/Freestyles\//i.test(entry.path)) return 'freestyle'
  if (/^Footage\//i.test(entry.path)) return 'studio'
  return null
}

export function cleanFootageTitleKey(raw: string): string {
  const noExt = raw.replace(VIDEO_EXT_RE, '')
  const stripped = noExt
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d+\s+/, '')
    .replace(/\s*[\[(](?:part\s*\d+|studio\s*sessions?|full\s*session\s*recording|preview(?:\s*\+\s*studio\s*session)?|freestyle|bts|behind\s*the\s*scenes|v\d+)[\])]/gi, ' ')
    .replace(/\b(?:behind the scenes|behind the shot|full session recording|studio sessions?|freestyle|snippets?|preview|bts)\b/gi, ' ')
  return normalizeForSearch(stripped).replace(/\s+/g, ' ').trim()
}

export function baseFootageTitleKey(raw: string): string {
  const noExt = raw.replace(VIDEO_EXT_RE, '')
  const noParens = noExt.replace(/\s*(?:\([^()]*\)|\[[^\[\]]*\])/g, ' ')
  return cleanFootageTitleKey(noParens)
}

export function parseFreestyleName(fileName: string): ParsedFreestyleMeta {
  const base = fileName.replace(VIDEO_EXT_RE, '').trim()
  const m = /^(\d{4}-\d{2}-\d{2})\s+\d+\s+(.+)$/.exec(base)
  if (!m) {
    return { title: base.replace(/\s*[-–]\s*Freestyle$/i, '').trim() || 'Freestyle', date: null, with: [] }
  }
  const date = m[1]
  const parts = m[2].split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean)
  const rawTitle = parts[0] || 'Freestyle'
  const withNames: string[] = []
  for (let i = 1; i < parts.length; i++) {
    if (/^freestyle$/i.test(parts[i])) continue
    withNames.push(parts[i])
  }
  return { title: rawTitle, date, with: withNames }
}

function recordedDateSet(song: JWApiSong): Set<string> {
  const out = new Set<string>()
  for (const d of songDates(song)) {
    if (d.kind === 'recorded') {
      out.add(`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`)
    }
  }
  return out
}

interface IndexedSongCandidate {
  song: JWApiSong
  via: 'name' | 'alias' | 'base'
  dates: Set<string>
}

export interface FootageSongIndex {
  byKey: Map<string, IndexedSongCandidate[]>
}

export function buildFootageSongIndex(songs: ReadonlyArray<JWApiSong>): FootageSongIndex {
  const byKey = new Map<string, IndexedSongCandidate[]>()
  const add = (key: string, cand: IndexedSongCandidate): void => {
    if (!key) return
    const list = byKey.get(key)
    if (list) {
      if (!list.some((x) => x.song.id === cand.song.id)) list.push(cand)
    } else {
      byKey.set(key, [cand])
    }
  }
  for (const song of songs) {
    const dates = recordedDateSet(song)
    const primaryKey = cleanFootageTitleKey(song.name)
    add(primaryKey, { song, via: 'name', dates })
    for (const alias of song.track_titles ?? []) {
      const aliasKey = cleanFootageTitleKey(alias)
      if (aliasKey && aliasKey !== primaryKey) add(aliasKey, { song, via: 'alias', dates })
    }
    const baseKey = baseFootageTitleKey( baseTitle(song.name))
    if (baseKey && baseKey !== primaryKey) add(baseKey, { song, via: 'base', dates })
  }
  return { byKey }
}

/** Links a studio or freestyle video to the catalogue using the 3-level certainty rule:
 *  - 'title+date': file date matches a catalogue Recorded date for a song with that title/alias.
 *  - 'title': exact title or declared catalogue alias, with no conflicting date (short generic titles <5 chars require a date or an explicit Studio Session label).
 *  - 'possible': base title match only (never counted in strict totals).
 *  - null: no candidate, or the file date contradicts the song's recording date. */
export function linkFootageToCatalogue(
  entry: Pick<JWApiFileEntry, 'name' | 'path'>,
  index: FootageSongIndex,
): FootageSongLink | null {
  const fileName = entry.name || entry.path.split('/').pop() || ''
  const isFreestyle = /^Footage\/Freestyles\//i.test(entry.path)
  const parsed = isFreestyle ? parseFreestyleName(fileName) : null
  const fileDate = parsed?.date ?? (/(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null)
  const rawTitle = parsed ? parsed.title : fileName
  const key = cleanFootageTitleKey(rawTitle)
  if (!key || key === 'freestyle' || key === 'instagram live') return null

  const baseKey = baseFootageTitleKey(rawTitle)
  const exactCandidates = index.byKey.get(key)
  const baseCandidates = (!exactCandidates && baseKey && baseKey !== key) ? index.byKey.get(baseKey) : undefined
  const candidates = exactCandidates ?? baseCandidates
  if (!candidates || candidates.length === 0) return null
  const matchedViaBaseKeyOnly = !exactCandidates && !!baseCandidates

  const anyCandidateHasDates = candidates.some((c) => c.dates.size > 0)
  if (fileDate && anyCandidateHasDates) {
    const dateMatches = candidates.filter((c) => c.dates.has(fileDate))
    if (dateMatches.length === 0) {
      // Conflicting date: title matches a song whose recording date disagrees with the file date.
      return null
    }
    const best = dateMatches.find((c) => c.via === 'name') ?? dateMatches.find((c) => c.via === 'alias') ?? dateMatches[0]
    return {
      level: 'title+date',
      via: best.via === 'base' ? 'name' : best.via,
      name: best.song.name.replace(/\s*\(v\d+\)$/i, ''),
      entries: candidates.length,
      id: best.song.id,
      era: best.song.era?.name ?? null,
    }
  }

  const compactLen = key.replace(/\s+/g, '').length
  const explicitStudioSession = /\((?:studio\s*session|full\s*session)/i.test(fileName)
  if (compactLen < 5 && !explicitStudioSession) return null

  const exact = !matchedViaBaseKeyOnly
    ? (candidates.find((c) => c.via === 'name') ?? candidates.find((c) => c.via === 'alias'))
    : undefined
  if (exact) {
    return {
      level: 'title',
      via: exact.via,
      name: exact.song.name.replace(/\s*\(v\d+\)$/i, ''),
      entries: candidates.length,
      id: exact.song.id,
      era: exact.song.era?.name ?? null,
    }
  }

  const base = candidates[0]
  return {
    level: 'possible',
    via: 'base',
    name: base.song.name,
    entries: candidates.length,
    id: base.song.id,
    era: base.song.era?.name ?? null,
  }
}

export function scoreStudioFootage(
  entry: { name?: string; path: string; size?: number | null; duration?: string | null; type?: string },
  link: FootageSongLink | null,
): number {
  if (excludedFootageReason(entry)) return -1
  const family = classifyFootageEntry(entry)
  if (family !== 'studio' && family !== 'freestyle') return -1
  if (FEATURED_FOOTAGE_PATHS.includes(entry.path)) return 1000 - FEATURED_FOOTAGE_PATHS.indexOf(entry.path)
  const name = entry.name || entry.path
  let score = family === 'studio' ? 40 : 20
  if (/studio\s*session|full\s*session\s*recording/i.test(name)) score += 35
  if (/behind\s*the\s*scenes|\bbts\b|behind\s*the\s*shot/i.test(name)) score += 25
  if (/freestyle/i.test(name)) score += 15
  if (/tour/i.test(name)) score += 10
  if (/instagram\s*live/i.test(name)) score -= 15
  if (link?.level === 'title+date') score += 30
  else if (link?.level === 'title') score += 20
  return score
}

export function formatFootageMenuLabel(
  matches: ReadonlyArray<{ entry: { name?: string; path: string; type?: string } }>,
): string | null {
  let studio = 0
  let snippets = 0
  for (const m of matches) {
    if (excludedFootageReason(m.entry as Pick<JWApiFileEntry, 'name' | 'path' | 'size' | 'duration'>) === 'rights') continue
    const fam = classifyFootageEntry(m.entry)
    if (fam === 'snippet') snippets++
    else if (fam) studio++
  }
  const total = studio + snippets
  if (total === 0) return null
  if (studio > 0 && snippets > 0) return `Watch footage (${studio} studio · ${snippets} snippet${snippets === 1 ? '' : 's'})`
  if (snippets > 0) return `Watch snippets (${snippets})`
  return `Watch footage (${studio})`
}

/** One audible source at a time: pauses music when a video with sound starts,
 *  and resumes music on close only if it was playing and the user didn't touch
 *  the music controls while the video was open. */
export interface AudibleVideoGate {
  videoWillPlay: () => void
  videoDidClose: () => void
  musicTouched: () => void
  isMusicPausedByVideo: () => boolean
}

export function createAudibleVideoGate(deps: {
  isMusicPlaying: () => boolean
  setMusicPlaying: (playing: boolean) => void
  pauseActiveVideo?: () => void
}): AudibleVideoGate {
  let resumeAfterVideo = false
  let touchedDuringVideo = false
  let videoOpen = false
  return {
    videoWillPlay: () => {
      if (!videoOpen) {
        resumeAfterVideo = deps.isMusicPlaying()
        touchedDuringVideo = false
        videoOpen = true
      } else if (deps.isMusicPlaying()) {
        resumeAfterVideo = true
      }
      if (deps.isMusicPlaying()) deps.setMusicPlaying(false)
    },
    videoDidClose: () => {
      if (!videoOpen) return
      const shouldResume = resumeAfterVideo && !touchedDuringVideo
      videoOpen = false
      resumeAfterVideo = false
      touchedDuringVideo = false
      if (shouldResume) deps.setMusicPlaying(true)
    },
    musicTouched: () => {
      if (!videoOpen) return
      touchedDuringVideo = true
      deps.pauseActiveVideo?.()
    },
    isMusicPausedByVideo: () => videoOpen && resumeAfterVideo && !touchedDuringVideo,
  }
}

/** Builds a fast normalized lookup set of song titles that have at least one non-excluded video entry. */
export function buildVideoTitleKeySet(entries: ReadonlyArray<Pick<JWApiFileEntry, 'name' | 'path' | 'type'>>): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (excludedFootageReason(entry) === 'rights') continue
    const fam = classifyFootageEntry(entry)
    if (!fam) continue
    if (fam === 'snippet') {
      const folder = entry.path.split('/')[2] || ''
      const k = cleanFootageTitleKey(folder)
      if (k && k.replace(/\s+/g, '').length >= 3) keys.add(k)
    } else if (fam === 'official') {
      const parsed = parseVideoName(entry.name || entry.path.split('/').pop() || '')
      const k = cleanFootageTitleKey(parsed?.title ?? entry.name)
      if (k && k.replace(/\s+/g, '').length >= 3) keys.add(k)
    } else {
      const parsed = fam === 'freestyle' ? parseFreestyleName(entry.name || entry.path.split('/').pop() || '') : null
      const k = cleanFootageTitleKey(parsed ? parsed.title : (entry.name || ''))
      if (k && k.replace(/\s+/g, '').length >= 4) keys.add(k)
    }
  }
  return keys
}

export function songHasVideoMatch(song: Pick<JWApiSong, 'name' | 'track_titles'>, videoKeys: ReadonlySet<string>): boolean {
  if (videoKeys.size === 0) return false
  if (videoKeys.has(cleanFootageTitleKey(song.name))) return true
  for (const alias of song.track_titles ?? []) {
    if (videoKeys.has(cleanFootageTitleKey(alias))) return true
  }
  return false
}
