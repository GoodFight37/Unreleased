import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEffectsState } from '../lib/effectsPreference'
import { ADLIB_OPACITY, wordRuns } from '../lib/lyrics'
import { useVizStore } from '../store/vizStore'
import type { SyncedLyricWord } from '../types'

/** How bright a word of the playing line is before it is sung. */
const UNSUNG_OPACITY = 0.38

interface Props {
  words: SyncedLyricWord[]
  /** The line being sung. Other lines show every word at full strength and
   *  leave the dimming to the line around them. */
  active: boolean
  getTime: () => number
  /** The lyrics offset, subtracted from getTime the way the line index is. */
  offset: number
  /** Keep the sung word's fill when game mode or reduced motion turns the lift off (WRLD's Post frames). */
  fill?: boolean
}

/**
 * A word-timed lyric line (enhanced LRC). While it is the playing line, each
 * word reveals with a damped spring and sweeps with an accent-kissed luminous
 * gradient across the active syllable without causing layout reflow.
 */
export default memo(function WordLyricLine({ words, active, getTime, offset, fill }: Props): JSX.Element {
  const { reducedMotion, gameMode } = useEffectsState()
  const wrldAnimations = useVizStore((s) => s.wrldAnimations)
  const liftWords = active && !reducedMotion && !gameMode && wrldAnimations
  const fillWord = liftWords || (active && !!fill)
  const runs = useMemo(() => wordRuns(words), [words])
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])

  const sungAt = (): number => {
    const t = getTime() - offset
    let n = 0
    while (n < words.length && words[n].start <= t) n++
    return n
  }
  const [sung, setSung] = useState(() => (active ? sungAt() : words.length))

  useLayoutEffect(() => {
    if (!active) { setSung(words.length); return }
    let raf = 0
    let last = -1
    const tick = (): void => {
      if (document.hidden) { raf = 0; return }
      const t = getTime() - offset
      let n = 0
      while (n < words.length && words[n].start <= t) n++
      if (n !== last) { last = n; setSung(n) }
      if (fillWord && n > 0 && n <= words.length) {
        const curIdx = n - 1
        const start = words[curIdx].start
        // A Post frame can hand over part of a line (one word, a chunk): its last word then runs to its own end.
        const nextStart = curIdx + 1 < words.length ? words[curIdx + 1].start
          : fill && words[curIdx].end > start ? words[curIdx].end : start + 0.45
        const span = Math.max(0.14, nextStart - start)
        const pct = Math.min(100, Math.max(0, ((t - start) / span) * 100))
        const el = wordRefs.current[curIdx]
        if (el) el.style.setProperty('--lyric-word-pct', `${pct.toFixed(1)}%`)
      }
      raf = requestAnimationFrame(tick)
    }
    const onVis = (): void => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
      else if (!raf) tick()
    }
    document.addEventListener('visibilitychange', onVis)
    if (!document.hidden) tick()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(raf)
    }
  }, [active, words, offset, getTime, fillWord, fill])

  return (
    <>
      {runs.map((run, i) => {
        const isSung = i < sung
        const isCurrent = fillWord && isSung && i === sung - 1 && !run.color
        return (
          <Fragment key={i}>
            {i > 0 && ' '}
            <span
              ref={(el) => { wordRefs.current[i] = el }}
              className="inline-block transition-[opacity,transform,filter] duration-[280ms] ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:transition-none"
              style={{
                opacity: (isSung ? 1 : UNSUNG_OPACITY) * (run.adLib ? ADLIB_OPACITY : 1),
                color: run.color,
                filter: liftWords ? (isSung ? 'blur(0px)' : 'blur(2.5px)') : undefined,
                transform: liftWords
                  ? (isSung ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 6px, 0) scale(0.92)')
                  : undefined,
                textShadow: liftWords && isSung && !isCurrent && !run.color
                  ? '0 0 18px rgb(var(--accent-rgb) / 0.28)'
                  : undefined,
                ...(isCurrent ? {
                  backgroundImage: 'linear-gradient(90deg, color-mix(in srgb, currentColor 74%, var(--accent) 26%) var(--lyric-word-pct, 100%), color-mix(in srgb, currentColor 42%, transparent) var(--lyric-word-pct, 100%))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                } : {}),
              }}
            >
              {run.text}
            </span>
          </Fragment>
        )
      })}
    </>
  )
})
