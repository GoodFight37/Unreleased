import { Fragment, memo, useLayoutEffect, useMemo, useState } from 'react'
import { useEffectsState } from '../lib/effectsPreference'
import { ADLIB_OPACITY, wordRuns } from '../lib/lyrics'
import { useVizStore } from '../store/vizStore'
import type { SyncedLyricWord } from '../types'

/** How bright a word of the playing line is before it is sung. */
const UNSUNG_OPACITY = 0.4

interface Props {
  words: SyncedLyricWord[]
  /** The line being sung. Other lines show every word at full strength and
   *  leave the dimming to the line around them. */
  active: boolean
  getTime: () => number
  /** The lyrics offset, subtracted from getTime the way the line index is. */
  offset: number
}

/**
 * A word-timed lyric line (enhanced LRC). While it is the playing line, each
 * word lights up as it is sung. Only this line re-renders as words change;
 * the list around it keeps following lines.
 */
export default memo(function WordLyricLine({ words, active, getTime, offset }: Props): JSX.Element {
  const { reducedMotion } = useEffectsState()
  const wrldAnimations = useVizStore((s) => s.wrldAnimations)
  const liftWords = active && !reducedMotion && wrldAnimations
  const runs = useMemo(() => wordRuns(words), [words])
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
      const n = sungAt()
      if (n !== last) { last = n; setSung(n) }
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
  }, [active, words, offset, getTime]) // what sungAt reads

  return (
    <>
      {runs.map((run, i) => {
        const isSung = i < sung
        return (
          <Fragment key={i}>
            {i > 0 && ' '}
            <span
              className="inline-block transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{
                opacity: (isSung ? 1 : UNSUNG_OPACITY) * (run.adLib ? ADLIB_OPACITY : 1),
                color: run.color,
                transform: liftWords ? (isSung ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 1px, 0) scale(0.985)') : undefined,
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
