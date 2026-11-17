import { useEffect, useRef, useState } from 'react'
import { useStorePick } from '../store/useStore'
import { smallCoverUrl, fullCoverUrl, buildImageUrl } from '../lib/juicewrldApi'
import { getSkin } from '../lib/skins'
import { useEffectsState } from '../lib/effectsPreference'
import { listenToMeter } from '../desktop/meter'
import { FallbackImg } from './ProgressiveCover'

const FADE_MS = 900

type Layer = { id: number; src: string; shown: boolean }

// What the glass chrome frosts: the playing song's cover, blurred far past
// recognition and washed with the skin's surface color so text keeps its
// contrast, or an accent glow while nothing with art is playing. It sits
// behind the whole window (position: fixed, z-index -1; index.css keeps the
// boxes between it and the page background clear), so the views, the sidebar
// and the side panels all show it through their translucent fills.
//
// A new cover fades in over the old one once it has loaded, and the old ones
// are dropped when that fade ends. Blurred this far, the small cover is all
// it needs.
export default function AmbientBackdrop(): JSX.Element {
  const { theme, currentTrack, currentTrackFull, radioFmActive, radioFmPaused, radioFmMatchedSong, isPlaying } =
    useStorePick('theme', 'currentTrack', 'currentTrackFull', 'radioFmActive', 'radioFmPaused', 'radioFmMatchedSong', 'isPlaying')
  const { reducedMotion, gameMode } = useEffectsState()
  const playbackActive = radioFmActive ? !radioFmPaused : isPlaying
  const rootRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  // An album theme is a fixed backdrop of its own cover; Dark and Light follow the song.
  const art = buildImageUrl(getSkin(theme).art) || (radioFmActive
    ? radioFmMatchedSong?.imageUrl
    : (currentTrackFull?.albumArt ?? currentTrack?.imageUrl)) || null

  const [layers, setLayers] = useState<Layer[]>([])
  const nextId = useRef(0)
  const artRef = useRef(art)
  artRef.current = art

  useEffect(() => {
    const glow = glowRef.current
    if (!glow) return
    if (reducedMotion || gameMode || !playbackActive) {
      glow.style.removeProperty('opacity')
      return
    }
    let smooth = 0
    let lastAt = 0
    let lastOpacity = -1
    return listenToMeter((m) => {
      const punch = Math.min(1, Math.max(0, m.punch > 1 ? (m.punch - 1) * 1.15 : m.punch * 0.2))
      smooth += (punch - smooth) * (punch > smooth ? 0.45 : 0.14)
      const now = performance.now()
      if (now - lastAt < 48) return
      const next = Number((0.78 + smooth * 0.22).toFixed(2))
      if (Math.abs(next - lastOpacity) < 0.02) return
      lastAt = now
      lastOpacity = next
      glow.style.opacity = String(next)
    })
  }, [reducedMotion, gameMode, playbackActive])

  useEffect(() => {
    if (!art) {
      // Fade every cover out to the glow, then let them go.
      setLayers((ls) => ls.map((l) => ({ ...l, shown: false })))
      const t = setTimeout(() => setLayers([]), FADE_MS)
      return () => clearTimeout(t)
    }
    setLayers((ls) => {
      const top = ls[ls.length - 1]
      // Same cover again (it came back before its fade-out finished): it's
      // already loaded, so show it straight away.
      if (top?.src === art) return top.shown ? ls : ls.map((l) => (l === top ? { ...l, shown: true } : l))
      return [...ls, { id: nextId.current++, src: art, shown: false }]
    })
    return undefined
  }, [art])

  // A layer that has loaded fades in; once it covers everything under it,
  // those go.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const show = (id: number, src: string): void => {
    // Loaded after the song moved on (or stopped): nothing to show.
    if (artRef.current !== src) return
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, shown: true } : l)))
    const t = setTimeout(() => {
      timers.current.delete(t)
      setLayers((ls) => {
        const i = ls.findIndex((l) => l.id === id)
        return i > 0 && ls[i].shown ? ls.slice(i) : ls
      })
    }, FADE_MS)
    timers.current.add(t)
  }
  const drop = (id: number): void => setLayers((ls) => ls.filter((l) => l.id !== id))

  return (
    <div ref={rootRef} className="app-ambient" aria-hidden>
      <div ref={glowRef} className="app-ambient-glow" />
      {layers.map((l) => (
        <FallbackImg
          key={l.id}
          sources={[smallCoverUrl(l.src), fullCoverUrl(l.src), l.src]}
          className={`app-ambient-art${l.shown ? ' is-shown' : ''}`}
          onLoad={() => show(l.id, l.src)}
          onError={() => drop(l.id)}
          stallMs={4000}
        />
      ))}
      <div className="app-ambient-tint" />
      <div className="app-grain" />
    </div>
  )
}
