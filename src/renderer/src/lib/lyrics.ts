import { useEffect, useState } from 'react'
import type { FullTrack, SyncedLyricLine, SyncedLyricWord, Track } from '../types'

/**
 * True while the playing track's lyrics aren't known yet: Player hasn't built
 * its FullTrack (queue actions reset currentTrackFull to null on every track
 * change), or it has and the /songs/ fetch is still out. Pass as
 * useLyricsVisible's `pending`.
 */
export function lyricsLoading(track: Track | null, full: FullTrack | null): boolean {
  return !!track && (full?.id !== track.id || !!full.lyricsPending)
}

/**
 * Whether a lyrics section should be shown, debounced against the
 * lyrics-null placeholder `currentTrackFull` briefly holds while the real
 * lyrics for a newly-started track are still loading in - collapsing
 * immediately on that placeholder made the lyrics panel flash shut and
 * reopen on every track change. Expanding is instant (nothing to hide);
 * collapsing waits a beat in case lyrics show up before it commits to "no
 * lyrics."
 *
 * Flipping `override` is the user toggling lyrics, though, not lyrics loading
 * in - that applies at once, even mid-load. Debouncing it too left WRLD's
 * queue -> off toggle showing the lyrics column for the 250ms collapse delay.
 */
export function useLyricsVisible(hasLyricsNatural: boolean, override: boolean, pending = false): boolean {
  const wantVisible = hasLyricsNatural !== override
  const [visible, setVisible] = useState(wantVisible)
  // Adjusted during render (not in the effect) so no frame ever commits with
  // the pre-toggle value.
  const [seenOverride, setSeenOverride] = useState(override)
  if (override !== seenOverride) {
    setSeenOverride(override)
    setVisible(wantVisible)
  }

  useEffect(() => {
    // Lyrics are still being fetched for the current track - hold whatever
    // arrangement was already on screen instead of collapsing to the
    // no-lyrics layout just because they haven't loaded yet.
    if (pending) return
    if (wantVisible) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(false), 250)
    return () => clearTimeout(t)
  }, [wantVisible, pending])

  return visible
}

const WORD_TAG_RE = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g
const tagSeconds = (m: string, s: string): number => Number(m) * 60 + Number(s.replace(':', '.'))

/** A word-tagged line's text between tags, each piece with the time it starts. */
interface WordChunk { text: string; at: number }

/**
 * Parse LRC format into timed lines.
 * Handles: [mm:ss.xx] or [mm:ss:xx] timestamps, and enhanced LRC word tags
 * (`[0:06.88] <0:06.88>No, <0:07.20>no<0:08.10>`), which become the line's
 * `words` and are left out of its text. A trailing tag is when the last word
 * ends.
 */
export function parseLrc(lrc: string): SyncedLyricLine[] {
  const lines: (SyncedLyricLine & { chunks?: WordChunk[]; until?: number })[] = []
  const timeRegex = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/g

  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timeRegex)]
    if (matches.length === 0) continue

    const body = rawLine.replace(timeRegex, '')
    const tags = [...body.matchAll(WORD_TAG_RE)]
    const text = (tags.length ? body.replace(WORD_TAG_RE, ' ') : body).replace(/\s+/g, ' ').trim()

    for (const match of matches) {
      const min = parseInt(match[1])
      const sec = parseInt(match[2])
      const ms = parseInt(match[3].padEnd(3, '0'))
      const time = min * 60 + sec + ms / 1000
      // Word times are absolute, so they only fit a line sung once.
      if (!tags.length || matches.length > 1) { lines.push({ time, text }); continue }
      const chunks: WordChunk[] = []
      let at = time
      let from = 0
      for (const t of tags) {
        const piece = body.slice(from, t.index)
        if (piece.trim()) chunks.push({ text: piece, at })
        at = tagSeconds(t[1], t[2])
        from = (t.index ?? 0) + t[0].length
      }
      const tail = body.slice(from)
      if (tail.trim()) chunks.push({ text: tail, at })
      lines.push({ time, text, chunks, until: tail.trim() ? undefined : at })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines.map((line, i) => {
    const { chunks, until, ...rest } = line
    if (!chunks?.length) return rest
    const next = lines[i + 1]?.time
    const words: SyncedLyricWord[] = []
    chunks.forEach((chunk, ci) => {
      const parts = chunk.text.trim().split(/\s+/)
      const last = chunks[ci + 1]?.at ?? until
        ?? Math.min(next ?? Infinity, chunk.at + 0.45 * parts.length)
      const step = Math.max(last - chunk.at, 0) / parts.length
      parts.forEach((p, pi) => words.push({ text: p, start: chunk.at + pi * step, end: chunk.at + (pi + 1) * step }))
    })
    return { ...rest, words }
  })
}

/**
 * Check if a string contains LRC timestamps
 */
export function isLrcFormat(text: string): boolean {
  return /\[\d{1,2}:\d{2}[.:]\d{2}/.test(text)
}

/**
 * Find current lyric line index for given time. `lines` are sorted by time
 * (parseLrc sorts them), so this is a binary search: the lyric views call it
 * every frame.
 */
export function getCurrentLineIndex(lines: SyncedLyricLine[], currentTime: number): number {
  let low = 0
  let high = lines.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= currentTime) low = mid + 1
    else high = mid
  }
  return low - 1
}

const SECTION_HEADER_RE = /^\[[^\]]+\]$/

/**
 * Synthesize estimated line timestamps for plain unsynced lyrics over a track's
 * duration so Focus and Classic views scroll smoothly even when the API has no
 * LRC timestamps (matching Cinema / 999 / Cut's auto-paced fallback).
 */
export function pacePlainLyrics(rawLyrics: string, duration: number): SyncedLyricLine[] {
  const raw = rawLyrics
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!raw.length) return []
  const withoutHeaders = raw.filter((line) => !SECTION_HEADER_RE.test(line))
  const lines = withoutHeaders.length > 0 ? withoutHeaders : raw
  const totalDur = Number.isFinite(duration) && duration > 0 ? duration : lines.length * 3
  // Gently weight each line by word count so longer verses get a bit more time than short ad-lib lines.
  const weights = lines.map((line) => {
    const wordCount = line.split(/\s+/).filter(Boolean).length
    const clamped = Math.min(Math.max(wordCount / 7, 0.35), 2.2)
    return 0.65 + 0.35 * clamped
  })
  const weightSum = weights.reduce((acc, w) => acc + w, 0) || lines.length
  let cursor = 0
  return lines.map((text, i) => {
    const time = cursor
    cursor += (weights[i] / weightSum) * totalDur
    return { time, text }
  })
}

/** Ad-libs render at the same size as the line around them, just dimmer.
 *  Applied as `opacity` on the run, which multiplies with whatever opacity the
 *  line already carries (active vs. distant), so it reads as a consistent step
 *  down from its own line rather than a fixed tone. */
export const ADLIB_OPACITY = 0.7

/**
 * Split a lyric line into plain runs and parenthesized ad-lib runs, so the
 * renderers can dim the ad-libs ("I'm still here (still here)"). The
 * brackets stay in the output - they're part of how ad-libs read.
 *
 * Only balanced `(...)` pairs on a single line count; an unclosed bracket is
 * left as ordinary text rather than swallowing the rest of the lyrics (this
 * also runs over whole multi-line plain-text lyrics, where a stray "(" would
 * otherwise shrink everything down to the next line's ")"). Nesting isn't
 * handled - it doesn't occur in practice, and the failure mode is just a
 * normally-sized fragment.
 */
export function splitAdLibs(text: string): { text: string; adLib: boolean }[] {
  const parts: { text: string; adLib: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(/\([^)\r\n]*\)/g)) {
    const start = m.index ?? 0
    if (start > last) parts.push({ text: text.slice(last, start), adLib: false })
    parts.push({ text: m[0], adLib: true })
    last = start + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), adLib: false })
  return parts.length > 0 ? parts : [{ text, adLib: false }]
}

export interface WordRun { text: string; start: number; adLib: boolean; color?: string }

export interface ColorWordRule {
  phrase: string
  /** High-contrast color on dark WRLD backdrops (WCAG AA >= 4.5:1). */
  color: string
  /** High-contrast color on light backdrops like GB&GR soft sky (WCAG AA >= 4.5:1). */
  lightColor?: string
}

export interface ColorWordOptions {
  light?: boolean
  enabled?: boolean
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ruleColor(rule: ColorWordRule, light?: boolean): string {
  return light ? (rule.lightColor ?? rule.color) : rule.color
}

/**
 * A word-timed line's words with the same ad-lib dimming and color keyword
 * highlights the plain renderers apply (see splitAdLibs / splitColorWords),
 * worked out on the joined text so phrases spanning words still match.
 */
export function wordRuns(
  words: SyncedLyricWord[],
  rules: ColorWordRule[] = LYRIC_COLOR_WORDS,
  options?: ColorWordOptions,
): WordRun[] {
  const text = words.map(w => w.text).join(' ')
  const adLibAt = new Array<boolean>(text.length).fill(false)
  for (const m of text.matchAll(/\([^)\r\n]*\)/g)) adLibAt.fill(true, m.index ?? 0, (m.index ?? 0) + m[0].length)
  const colorAt = new Array<string | undefined>(text.length).fill(undefined)
  if (options?.enabled !== false) {
    for (const rule of rules) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(rule.phrase)}(?![A-Za-z0-9])`, 'gi')
      const col = ruleColor(rule, options?.light)
      for (const m of text.matchAll(re)) colorAt.fill(col, m.index ?? 0, (m.index ?? 0) + m[0].length)
    }
  }
  let pos = 0
  return words.map(w => {
    const at = pos
    pos += w.text.length + 1
    return { text: w.text, start: w.start, adLib: adLibAt[at], color: colorAt[at] }
  })
}

/** Thematic Juice WRLD keyword -> color rules for synced lyrics (WCAG AA on dark and light backdrops). */
export const LYRIC_COLOR_WORDS: ColorWordRule[] = [
  // Signature Juice WRLD / 999 gold
  { phrase: '999', color: '#ffd166', lightColor: '#9a5b00' },
  { phrase: 'Juice WRLD', color: '#ffd166', lightColor: '#9a5b00' },
  { phrase: 'Juice', color: '#ffd166', lightColor: '#9a5b00' },
  { phrase: 'WRLD', color: '#ffd166', lightColor: '#9a5b00' },
  // Ice / cold / blue
  { phrase: 'cold', color: '#7dd3fc', lightColor: '#0369a1' },
  { phrase: 'winter', color: '#7dd3fc', lightColor: '#0369a1' },
  { phrase: 'ice', color: '#7dd3fc', lightColor: '#0369a1' },
  { phrase: 'frozen', color: '#7dd3fc', lightColor: '#0369a1' },
  { phrase: 'blue', color: '#7dd3fc', lightColor: '#0369a1' },
  // Lean / purple / codeine
  { phrase: 'lean', color: '#d8b4fe', lightColor: '#6d28d9' },
  { phrase: 'Wock', color: '#d8b4fe', lightColor: '#6d28d9' },
  { phrase: 'purple', color: '#d8b4fe', lightColor: '#6d28d9' },
  { phrase: 'codeine', color: '#d8b4fe', lightColor: '#6d28d9' },
  // Fire / hell / demons / red
  { phrase: 'fire', color: '#fb7185', lightColor: '#be123c' },
  { phrase: 'hell', color: '#fb7185', lightColor: '#be123c' },
  { phrase: 'blood', color: '#fb7185', lightColor: '#be123c' },
  { phrase: 'demons', color: '#fb7185', lightColor: '#be123c' },
  { phrase: 'demon', color: '#fb7185', lightColor: '#be123c' },
  { phrase: 'red', color: '#fb7185', lightColor: '#be123c' },
  // Love / heart / angel / heaven
  { phrase: 'love', color: '#f9a8d4', lightColor: '#be185d' },
  { phrase: 'heart', color: '#f9a8d4', lightColor: '#be185d' },
  { phrase: 'angel', color: '#f9a8d4', lightColor: '#be185d' },
  { phrase: 'heaven', color: '#f9a8d4', lightColor: '#be185d' },
  // Gold / diamonds / money / rich
  { phrase: 'gold', color: '#fde047', lightColor: '#854d0e' },
  { phrase: 'diamonds', color: '#6ee7b7', lightColor: '#047857' },
  { phrase: 'money', color: '#6ee7b7', lightColor: '#047857' },
  { phrase: 'rich', color: '#6ee7b7', lightColor: '#047857' },
  // Existing easter egg
  { phrase: 'R Kelly', color: '#fcba03', lightColor: '#9a5b00' },
  { phrase: 'R. Kelly', color: '#fcba03', lightColor: '#9a5b00' },
]

/**
 * Split a run of lyric text around any configured color-word phrases, so the
 * renderer can color just the matched text and leave the rest untouched.
 * Case-insensitive with word boundaries; matched phrases keep their original casing.
 */
export function splitColorWords(
  text: string,
  rules: ColorWordRule[] = LYRIC_COLOR_WORDS,
  options?: ColorWordOptions,
): { text: string; color?: string }[] {
  if (options?.enabled === false || rules.length === 0 || !text) return [{ text }]
  // Match longer phrases first so "Juice WRLD" wins before "Juice".
  const ordered = [...rules].sort((a, b) => b.phrase.length - a.phrase.length)
  const pattern = ordered.map(r => escapeRegex(r.phrase)).join('|')
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${pattern})(?![A-Za-z0-9])`, 'gi')
  const out: { text: string; color?: string }[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ text: text.slice(last, idx) })
    const matched = m[0]
    const rule = ordered.find(r => r.phrase.toLowerCase() === matched.toLowerCase())
    out.push(rule ? { text: matched, color: ruleColor(rule, options?.light) } : { text: matched })
    last = idx + matched.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length > 0 ? out : [{ text }]
}

/**
 * Save a synced (LRC) lyrics string as a local .lrc file - a plain client-side
 * Blob download, not a server fetch, since the lyrics text is already in
 * memory (loaded with the track).
 */
export function downloadSyncedLyrics(title: string, artist: string, lrcContent: string): void {
  // Strip characters that are invalid in filenames on Windows/macOS.
  const safeName = `${title} - ${artist}`.replace(/[/\\?%*:|"<>]/g, '').trim() || 'lyrics'
  const blob = new Blob([lrcContent], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.lrc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
