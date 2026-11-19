import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import { useShallow } from 'zustand/react/shallow'
import { LyricStage, type LyricTune, type StageSong } from '../desktop/lyrics/stage'
import { lyricFontFor } from '../desktop/lyrics/looks'
import { timedFromLines, pacedFromText } from '../desktop/lyrics/timing'
import { useAlbumColors } from '../desktop/artColors'
import { hsbToRgb } from '../desktop/light/engine'
import { usePlayClock } from '../desktop/playClock'
import { seekAudio } from './Player'
import type { SyncedLyricLine } from '../types'

// WRLD's lyrics in one of the iJWA styles (Settings > Desktop > Lyric style): the app's own lyrics, offset and play
// clock, sung by the style picked. Line-timed lyrics get their words paced over each line; untimed ones over the song.

/** The styles were laid out for a box about this big; a bigger one sets everything larger. */
const DESIGN_WIDTH = 420
const DESIGN_HEIGHT = 360

interface Props {
  look: string
  trackId: string
  title: string
  artist: string
  duration: number
  rawLyrics: string
  isSynced: boolean
  syncedLines: SyncedLyricLine[]
  artUrl: string | null | undefined
  lightBg?: boolean
  /** A font stack to set the style in instead of its own face (WRLD's Post font picker). */
  face?: string
}

export default function LyricStageView({ look, trackId, title, artist, duration, rawLyrics, isSynced, syncedLines, artUrl, lightBg, face }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<LyricStage | null>(null)
  const lyricsOffset = useStore((s) => s.lyricsOffset)
  const fonts = useStore((s) => s.desktop.lyrics.fonts)
  const cutAccent = useVizStore((s) => s.wrldCutAccent)
  const coverLyricColors = useVizStore((s) => s.wrldCoverLyricColors)
  const colors = useAlbumColors(artUrl)
  // The app's lyric size and colors, for the styles that follow them.
  const baseTune = useStore(useShallow((s): LyricTune => ({
    size: s.lyricsScale,
    active: s.developerMode ? s.lyricsColorActive : null,
    inactive: s.developerMode ? s.lyricsColorInactive : null,
  })))
  const coverActiveColor = useMemo(() => {
    if (!coverLyricColors || !colors) return null
    const c = colors.primary
    const sat = c.saturation < 0.14 ? c.saturation : Math.min(Math.max(c.saturation, 0.58), 0.92)
    const bri = lightBg ? Math.min(c.brightness, 0.42) : Math.max(c.brightness, 0.94)
    const [r, g, b] = hsbToRgb({ hue: c.hue, saturation: sat, brightness: bri })
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
  }, [coverLyricColors, colors, lightBg])
  const effectiveCutAccent = coverLyricColors ? (cutAccent === 'juice' ? 'cover' : cutAccent) : cutAccent
  const tune = useMemo<LyricTune>(
    () => ({
      ...baseTune,
      active: baseTune.active ?? coverActiveColor,
      lightBg: Boolean(lightBg),
      cutAccent: effectiveCutAccent,
    }),
    [baseTune, coverActiveColor, lightBg, effectiveCutAccent],
  )
  // A line clicked plays the song from it - not on 999 FM, which can't be moved.
  const radioFmActive = useStore((s) => s.radioFmActive)
  const seek = useMemo(() => (radioFmActive ? undefined : (seconds: number) => seekAudio(Math.max(seconds, 0))), [radioFmActive])
  const clock = usePlayClock()
  const [scale, setScale] = useState(1)
  // In sight: the page shown, and the stage laid out. WRLD keeps its own layout mounted but hidden under the Widgets
  // layout, and its phone layout hidden on a wide window; a stage there waits instead of drawing words no one sees.
  const [seen, setSeen] = useState(false)

  const lyrics = useMemo(
    () => (isSynced && syncedLines.length ? timedFromLines(syncedLines, lyricsOffset) : pacedFromText(rawLyrics, duration)),
    [isSynced, syncedLines, lyricsOffset, rawLyrics, duration],
  )
  const song = useMemo<StageSong>(() => ({ id: trackId, title, artist, lyrics }), [trackId, title, artist, lyrics])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const stage = new LyricStage(host)
    stageRef.current = stage
    let laidOut = false
    const onVisibility = (): void => setSeen(laidOut && document.visibilityState === 'visible')
    const measure = (): void => {
      laidOut = host.clientWidth > 0 && host.clientHeight > 0
      if (laidOut) {
        const s = Math.min(host.clientWidth / DESIGN_WIDTH, host.clientHeight / DESIGN_HEIGHT)
        setScale(Math.round(Math.min(Math.max(s, 0.7), 2.7) * 20) / 20)
      }
      onVisibility()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      stage.destroy()
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.use(look)
    // Out of sight it's emptied rather than kept up: even setting a new song's words out costs a frame or two.
    if (!seen || !song.lyrics.lines.length || !clock) { stage.stop(); return }
    stage.show(song, { clock, isSeen: true, colors: coverLyricColors ? colors : null, face: face ?? lyricFontFor(fonts, stage.look), scale, tune, seek })
  }, [look, song, clock, seen, colors, coverLyricColors, fonts, scale, tune, seek, face])

  return (
    <div className="relative flex-1 min-h-0" onWheel={(e) => stageRef.current?.scrollBy(e.deltaY)}>
      <div ref={hostRef} />
    </div>
  )
}
