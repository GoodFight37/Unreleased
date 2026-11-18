import type { JWApiSong } from './juicewrldApi'

export type SongTruthKind = 'released' | 'unreleased' | 'snippet' | 'name-only' | 'session' | 'no-audio'

export interface SongTruth {
  kind: SongTruthKind
  kindLabel: string
  leakLabel: string | null
  alsoKnownAs: string | null
  credit: string | null
  canPlay: boolean
}

const KIND_LABELS: Record<SongTruthKind, string> = {
  released: 'Released',
  unreleased: 'Unreleased',
  snippet: 'Snippet',
  'name-only': 'Name only',
  session: 'Session',
  'no-audio': 'No audio',
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
// The API fills unknown credits with a placeholder word; that is not a credit.
const credit = (v: unknown): string | null => { const c = clean(v); return c && !/^(unknown|n\/a|none|\?)$/i.test(c) ? c : null }

/** What a song really is, from API fields only. Missing fields give null, never a guess.
 *  `playable` comes from isPlayableSong (or hasDirectAudioPath when sync is all we have). */
export function songTruth(
  song: Partial<Pick<JWApiSong, 'name' | 'category' | 'leak_type' | 'track_titles' | 'original_key' | 'producers' | 'recording_locations' | 'record_dates'>>,
  playable: boolean,
): SongTruth {
  const leak = clean(song.leak_type)
  let kind: SongTruthKind
  if (song.category === 'unsurfaced') kind = 'name-only'
  else if (leak && /snippet/i.test(leak)) kind = 'snippet'
  else if (song.category === 'recording_session') kind = 'session'
  else if (song.category === 'released') kind = 'released'
  else if (song.category === 'unreleased') kind = 'unreleased'
  else kind = 'no-audio'

  const name = clean(song.name)?.toLowerCase()
  const seen = new Set<string>(name ? [name] : [])
  const aka: string[] = []
  for (const t of [...(song.track_titles ?? []), song.original_key]) {
    const v = clean(t)
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); aka.push(v) }
  }

  return {
    kind,
    kindLabel: KIND_LABELS[kind],
    // a bare "Snippet" leak_type would just repeat the kind badge
    leakLabel: leak && !(kind === 'snippet' && leak.toLowerCase() === 'snippet') ? leak : null,
    alsoKnownAs: aka.length ? aka.slice(0, 3).join(', ') : null,
    credit: credit(song.producers) ?? credit(song.recording_locations) ?? credit(song.record_dates),
    canPlay: kind === 'name-only' ? false : playable,
  }
}
