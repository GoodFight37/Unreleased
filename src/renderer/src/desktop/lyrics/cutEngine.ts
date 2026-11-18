import type { TimedLyrics, TimedWord } from './timing'

export type CutTiming = 'word' | 'a' | 'b'
export interface CutWord { text: string; start: number; accent: 0 | 1 | 2 }
export interface CutLine {
  index: number
  time: number
  until: number
  enterAt: number
  words: CutWord[]
  ad: string
  adOnly: boolean
  kind: 'impact' | 'retained'
  timingSource: 'data' | 'groups' | 'syllables'
  gapBefore: number
  gapAfter: number
  breathAfter: boolean
}
export interface CutSong { duration: number; lines: CutLine[] }
export type CutPhase = 'before' | 'enter' | 'sing' | 'hold' | 'exit' | 'breath'

interface PreparedLine {
  time: number
  until: number
  words: TimedWord[]
  source: TimedWord[]
  ad: string
  adOnly: boolean
  wordTimed: boolean
  key: string
}

const LITTLE = new Set("a an the to of in on at and or but i im i'm you me my it is be we so for with that this just like oh yeah uh am are was were your his her they them has have had not can will get got".split(' '))
const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n))
const norm = (text: string): string => text.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}' ]/gu, '').replace(/\s+/g, ' ').trim()

function syllables(word: string): number {
  const text = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  let count = 0, vowelBefore = false
  for (const ch of text) {
    const vowel = 'aeiouy'.includes(ch)
    if (vowel && !vowelBefore) count++
    vowelBefore = vowel
  }
  return Math.max(1, count)
}

function prepare(lyrics: TimedLyrics): PreparedLine[] {
  const rows = lyrics.lines.filter(line => Number.isFinite(line.time)).map(line => {
    const adOnly = !line.words.length && line.adlibs.length > 0
    const words = adOnly ? line.adlibs : line.words
    return {
      time: line.time, until: line.time, words,
      source: line.all?.length ? line.all : [...line.words, ...line.adlibs],
      ad: line.adlibs.map(word => `(${word.text})`).join(' '), adOnly,
      wordTimed: line.wordTimed === true && words.every(word => Number.isFinite(word.start)),
      key: norm(words.map(word => word.text).join(' ')),
    }
  }).sort((a, b) => a.time - b.time)

  rows.forEach((line, i) => {
    const next = rows[i + 1]?.time
    const cap = line.time + clamp(line.words.length * 0.48, 1.4, 7) + 0.9
    let until = cap
    if (line.wordTimed && line.words.length) {
      const lastStart = Math.max(line.time, ...line.source.filter(w => Number.isFinite(w.start)).map(w => w.start))
      const lastEnd = Math.max(line.time, ...line.source.filter(w => Number.isFinite(w.end) && w.end >= w.start).map(w => w.end))
      until = lastEnd > lastStart ? lastEnd : Math.max(cap, lastStart + 0.9)
    }
    line.until = Math.max(line.time, Math.min(next ?? until, until))
  })
  return rows.filter(line => line.words.length)
}

function starts(line: PreparedLine, timing: CutTiming): number[] {
  if (timing === 'word' && line.wordTimed) return line.words.map(word => word.start)
  const span = Math.min(Math.max(0.6, (line.until - line.time) * 0.82), Math.max(0, line.until - line.time))
  if (timing === 'b') {
    const weights = line.words.map(word => syllables(word.text))
    const total = weights.reduce((a, b) => a + b, 0)
    let used = 0
    return weights.map(weight => {
      const start = line.time + span * used / total
      used += weight
      return start
    })
  }
  const groupSize = line.words.length > 10 ? 3 : 2
  const count = Math.ceil(line.words.length / groupSize)
  return line.words.map((_, i) => line.time + span * Math.floor(i / groupSize) / count)
}

function accentWord(line: PreparedLine, real: boolean): number {
  let index = -1, best = -Infinity
  const anchors = line.source.map(word => word.start).filter(Number.isFinite)
  line.words.forEach((word, i) => {
    const text = norm(word.text).replace(/ /g, '')
    const length = [...text.replace(/'/g, '')].length
    if (length < 3 || LITTLE.has(text) || line.adOnly) return
    // Shared anchors do not provide a duration for one individual word.
    const held = real && anchors.filter(time => time === word.start).length === 1 && Number.isFinite(word.end)
      ? clamp(word.end - word.start, 0, 1.8) : 0
    const position = 1 - Math.abs((i + 0.5) / line.words.length - 0.5) * 1.3
    const score = Math.min(length, 11) * 0.42 + position * 0.8 + held * 1.35
    if (score > best) { best = score; index = i }
  })
  return best >= 2.2 ? index : -1
}

export function buildCut(lyrics: TimedLyrics, timing: CutTiming = 'word'): CutSong {
  if (!['word', 'a', 'b'].includes(timing)) throw new TypeError('timing must be word, a or b')
  const rows = prepare(lyrics), count = new Map<string, number>(), occurrences = new Map<string, number>()
  rows.forEach(line => count.set(line.key, (count.get(line.key) ?? 0) + 1))
  let previousImpact = false
  const lines: CutLine[] = rows.map((line, index) => {
    const source: CutLine['timingSource'] = timing === 'word' && line.wordTimed ? 'data' : timing === 'b' ? 'syllables' : 'groups'
    const selected = accentWord(line, source === 'data')
    const occurrence = occurrences.get(line.key) ?? 0
    occurrences.set(line.key, occurrence + 1)
    const impact = selected >= 0 && (count.get(line.key) ?? 0) >= 2 && occurrence % 2 === 0 && !previousImpact
    previousImpact = impact
    const times = starts(line, timing), previous = rows[index - 1], next = rows[index + 1]
    const gapBefore = Math.max(0, line.time - (previous?.until ?? 0))
    const gapAfter = Math.max(0, (next?.time ?? line.until + 3) - line.until)
    return {
      index, time: line.time, until: line.until,
      enterAt: Math.max(line.time, (previous?.until ?? -Infinity) + 0.1),
      words: line.words.map((word, i) => ({ text: word.text, start: times[i], accent: selected === i ? (impact ? 2 : 1) : 0 })),
      ad: line.ad, adOnly: line.adOnly, kind: impact ? 'impact' : 'retained', timingSource: source,
      gapBefore, gapAfter, breathAfter: gapAfter > 2,
    }
  })
  return { duration: Math.max(0, lines[lines.length - 1]?.until ?? 0) + 3, lines }
}

export function cutAt(song: CutSong, t: number): { lineIndex: number; prevIndex: number | null; phase: CutPhase } {
  const time = Number.isFinite(t) ? t : 0, lines = song.lines
  let low = 0, high = lines.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= time) low = mid + 1
    else high = mid
  }
  const lineIndex = low - 1
  if (lineIndex < 0) return { lineIndex: -1, prevIndex: null, phase: 'before' }
  const line = lines[lineIndex]
  const enterEnd = Math.min(line.until, Math.max(line.enterAt, line.words[0]?.start ?? line.time) + 0.4)
  const holdAt = Math.max(enterEnd, line.until - 0.3), exitDuration = line.kind === 'impact' ? 0.24 : 0.22
  const phase: CutPhase = time < enterEnd ? 'enter' : time < holdAt ? 'sing' : time < line.until ? 'hold' : time < line.until + exitDuration ? 'exit' : 'breath'
  return { lineIndex, prevIndex: lineIndex > 0 ? lineIndex - 1 : null, phase }
}
