import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Film, Maximize2, Minimize2, Music2, Pause, Play, RotateCcw, RotateCw, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import FootageDvdBouncer, { DVD_LOGO_OPTIONS, type DvdLogoId } from './FootageDvdBouncer'
import { ls } from '../lib/persist'
import { saveTrackerSearch } from '../lib/apiTrackerShared'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { liveVisualsAllowed, useEffectsState } from '../lib/effectsPreference'
import { videoFrameShape, windowForPath, type PreviewWindowResult, type VideoFrameShape } from '../lib/previewWindow'
import {
  createAudibleVideoGate,
  videoHasNoSound,
  footageSourceOf,
  type FootageFamily,
  type FootageSongLink,
} from '../lib/footageCatalog'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { useStore } from '../store/useStore'

export interface FootageTileItem {
  path: string
  title: string
  family: FootageFamily
  dateLabel?: string | null
  with?: string[]
  linked?: FootageSongLink | null
  duration?: string | null
  thumbUrl?: string | null
  youtubeUrl?: string | null
  channel?: string | null
  /** Explicit source channel for entries from a different archive channel. */
  streamChannel?: string
}

interface PosterCacheEntry {
  canvas: HTMLCanvasElement
  window: PreviewWindowResult
  duration: number
  shape: VideoFrameShape
}

const posterCache = new Map<string, PosterCacheEntry>()
const POSTER_CACHE_MAX = 120
const POSTER_MAX_CONCURRENT = 3
const POSTER_TIMEOUT_MS = 12000
let posterActive = 0
const posterWaiting: Array<() => void> = []

export type PosterState = 'idle' | 'loading' | 'ready' | 'failed'

/** Runs `start` when one of a few shared slots is free, so scrolling a long page never opens hundreds of video streams.
 *  The returned function cancels a waiting job, or frees the slot of a running one. */
function queuePoster(start: () => void): () => void {
  let state: 'wait' | 'run' | 'done' = 'wait'
  const job = (): void => { state = 'run'; posterActive++; start() }
  if (posterActive < POSTER_MAX_CONCURRENT) job()
  else posterWaiting.push(job)
  return () => {
    if (state === 'wait') {
      const i = posterWaiting.indexOf(job)
      if (i >= 0) posterWaiting.splice(i, 1)
    } else if (state === 'run') {
      posterActive--
      posterWaiting.shift()?.()
    }
    state = 'done'
  }
}

function cachePoster(key: string, entry: PosterCacheEntry): void {
  posterCache.delete(key)
  posterCache.set(key, entry)
  if (posterCache.size > POSTER_CACHE_MAX) posterCache.delete(posterCache.keys().next().value as string)
}
let activeHoverVideo: HTMLVideoElement | null = null
let activeModalVideo: HTMLVideoElement | null = null
let suppressingGateSync = false

/** The stream URL of the original archive file and channel. */
export const footageUrl = (path: string, channel?: string): string => {
  const s = footageSourceOf(path, channel)
  return buildStreamUrl(s.path, s.channel || undefined)
}

export const footageModalVideoGate = createAudibleVideoGate({
  isMusicPlaying: () => useStore.getState().isPlaying,
  setMusicPlaying: (playing) => {
    suppressingGateSync = true
    try { useStore.getState().setIsPlaying(playing) } finally { suppressingGateSync = false }
  },
  isRadioPlaying: () => {
    const s = useStore.getState()
    return s.radioFmActive && !s.radioFmPaused
  },
  setRadioPlaying: (playing) => {
    suppressingGateSync = true
    try {
      const client = getActiveRadioClient()
      if (playing) {
        if (useStore.getState().radioFmActive) void client?.startListening().catch(() => {})
      } else {
        client?.stopListening()
      }
    } finally {
      suppressingGateSync = false
    }
  },
  pauseActiveVideo: () => {
    if (activeModalVideo && !activeModalVideo.paused) activeModalVideo.pause()
  },
})

export function formatVideoSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const x = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
    : `${m}:${String(x).padStart(2, '0')}`
}

export function cleanFootageDisplayTitle(raw: string): string {
  return String(raw)
    .replace(/\.(mp4|webm|mov|m4v)$/i, '')
    .replace(/\s*[\[(](Part\s*\d+)[\])]/i, ' · $1')
    .trim()
}

export function releaseVideoStream(v: HTMLVideoElement | null): void {
  if (!v || !v.getAttribute('src')) return
  v.pause()
  v.removeAttribute('src')
  v.load()
  v.style.opacity = '0'
}

export function stopActiveHoverPreview(): void {
  if (!activeHoverVideo) return
  const v = activeHoverVideo
  activeHoverVideo = null
  v.pause()
  const tile = v.closest('.coffre-vt')
  if (tile) tile.classList.remove('is-playing')
  releaseVideoStream(v)
}

const FAMILY_BADGE: Record<FootageFamily, { label: string; cls: string }> = {
  studio: { label: 'Studio', cls: 'is-studio' },
  freestyle: { label: 'Freestyle', cls: 'is-studio' },
  official: { label: 'Official clip', cls: 'is-official' },
  snippet: { label: 'Snippet', cls: 'is-snippet' },
}

export function FootageFamilyChip({ family }: { family: FootageFamily }): JSX.Element {
  const info = FAMILY_BADGE[family] ?? FAMILY_BADGE.studio
  return <span className={`coffre-chip ${info.cls}`}>{info.label}</span>
}

/** Opens the catalogue searched on the song title. Never opens "a" version: the catalogue lists every candidate and the user picks. */
function openSongSearch(name: string): void {
  const s = useStore.getState()
  saveTrackerSearch(name)
  s.setApiTrackerCategory('')
  s.setApiTrackerEra('')
  s.setApiTrackerTab('songs')
  s.setActiveView('api-tracker')
}

/** One plain action instead of match jargon. A reliable match says "View song"; a weak one (strict = false only) says "Find in catalogue" and claims nothing. */
export function FootageLinkChip({ link, strict = false }: { link?: FootageSongLink | null; strict?: boolean }): JSX.Element | null {
  if (!link) return null
  const weak = link.level === 'possible'
  if (weak && strict) return null
  const label = weak ? 'Find in catalogue' : 'View song'
  const go = (e: React.SyntheticEvent): void => { e.stopPropagation(); e.preventDefault(); openSongSearch(link.name) }
  return (
    <span
      role="link"
      tabIndex={0}
      className="coffre-songlink"
      title={weak ? `Search the catalogue for “${link.name}”` : `Open “${link.name}” in the catalogue`}
      onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go(e) }}
    >
      <Music2 size={12} aria-hidden="true" /> {label}
    </span>
  )
}

export function useVideoPosterFrame(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  path: string,
  channel: string,
  enabled: boolean,
  onMeta?: (meta: { duration: number; shape: VideoFrameShape; window: PreviewWindowResult }) => void,
  maxWidth = 480,
) {
  const cacheKey = `${path}|${maxWidth}`
  const [shape, setShape] = useState<VideoFrameShape>(() => posterCache.get(cacheKey)?.shape ?? 'wide')
  const [durationSec, setDurationSec] = useState<number | null>(() => posterCache.get(cacheKey)?.duration ?? null)
  const [posterState, setPosterState] = useState<PosterState>(() => (posterCache.has(cacheKey) ? 'ready' : 'idle'))
  const windowRef = useRef<PreviewWindowResult>(posterCache.get(cacheKey)?.window ?? windowForPath(0, path))
  const posterDrawnRef = useRef(false)

  useEffect(() => {
    if (!enabled || !path) return
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return

    const paintFromCache = (hit: PosterCacheEntry): void => {
      c.width = hit.canvas.width
      c.height = hit.canvas.height
      try { c.getContext('2d')?.drawImage(hit.canvas, 0, 0) } catch { /* ignore */ }
      posterDrawnRef.current = true
      windowRef.current = hit.window
      setShape(hit.shape)
      setDurationSec(hit.duration)
      setPosterState('ready')
      v.style.opacity = '0'
      onMeta?.({ duration: hit.duration, shape: hit.shape, window: hit.window })
    }

    const cached = posterCache.get(cacheKey)
    if (cached) {
      paintFromCache(cached)
      return
    }

    let cancelQueue: (() => void) | null = null
    let timeout: number | null = null

    // Frees the slot and the connection as soon as the still frame is drawn (or has failed); hover reopens the stream itself.
    const finish = (state: PosterState): void => {
      if (timeout !== null) { window.clearTimeout(timeout); timeout = null }
      cancelQueue?.()
      cancelQueue = null
      setPosterState(state)
      if (v.dataset.hover !== '1') releaseVideoStream(v)
    }

    // currentTime already reports the seek target while seeking, so a decoded frame (readyState >= 2, not seeking) is the real test.
    const drawPoster = (): void => {
      if (posterDrawnRef.current || !v.videoWidth || !v.videoHeight || v.seeking || v.readyState < 2) return
      const scale = Math.min(1, maxWidth / v.videoWidth)
      c.width = Math.round(v.videoWidth * scale)
      c.height = Math.round(v.videoHeight * scale)
      try {
        c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
      } catch {
        finish('failed')
        return
      }
      posterDrawnRef.current = true
      if (Number.isFinite(v.duration) && v.duration > 0) {
        const off = document.createElement('canvas')
        off.width = c.width
        off.height = c.height
        off.getContext('2d')?.drawImage(c, 0, 0)
        cachePoster(cacheKey, { canvas: off, window: windowRef.current, duration: v.duration, shape: videoFrameShape(v.videoWidth, v.videoHeight) })
      }
      finish('ready')
    }

    const onLoadedMeta = (): void => {
      const dur = Number.isFinite(v.duration) ? v.duration : 0
      const w = windowForPath(dur, path)
      const s = videoFrameShape(v.videoWidth, v.videoHeight)
      windowRef.current = w
      setShape(s)
      if (dur > 0) setDurationSec(dur)
      onMeta?.({ duration: dur, shape: s, window: w })
      if (w.start > 0) {
        try { v.currentTime = w.start } catch { /* ignore */ }
      }
    }
    const onSeeked = drawPoster
    const onReady = drawPoster
    const onError = (): void => { if (!posterDrawnRef.current && v.getAttribute('src')) finish('failed') }

    v.addEventListener('loadedmetadata', onLoadedMeta)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('loadeddata', onReady)
    v.addEventListener('canplay', onReady)
    v.addEventListener('error', onError)

    const begin = (): void => {
      setPosterState('loading')
      v.preload = 'metadata'
      v.src = footageUrl(path, channel)
      timeout = window.setTimeout(() => { if (!posterDrawnRef.current) finish('failed') }, POSTER_TIMEOUT_MS)
    }
    const request = (): void => {
      if (cancelQueue || posterDrawnRef.current) return
      const hit = posterCache.get(cacheKey)
      if (hit) { paintFromCache(hit); return }
      setPosterState('loading')
      cancelQueue = queuePoster(begin)
    }
    const leave = (): void => {
      // Scrolled away before its turn: give the slot back; a running load is left to finish.
      if (cancelQueue && !v.getAttribute('src')) { cancelQueue(); cancelQueue = null; setPosterState('idle') }
    }

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) entry.isIntersecting ? request() : leave()
        }, { rootMargin: '200px' })
      : null

    if (io) io.observe(v)
    else request()

    return () => {
      io?.disconnect()
      if (timeout !== null) window.clearTimeout(timeout)
      cancelQueue?.()
      if (!posterDrawnRef.current) releaseVideoStream(v)
      v.removeEventListener('loadedmetadata', onLoadedMeta)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('loadeddata', onReady)
      v.removeEventListener('canplay', onReady)
      v.removeEventListener('error', onError)
    }
  }, [path, channel, enabled])

  return { shape, durationSec, windowRef, posterDrawnRef, posterState }
}

export function FootageTile({
  item,
  channel = '',
  showFrame = true,
  hoverPreview = true,
  strictLink = false,
  onWatch,
}: {
  item: FootageTileItem
  channel?: string
  showFrame?: boolean
  hoverPreview?: boolean
  strictLink?: boolean
  onWatch: (item: FootageTileItem, startAt: number, triggerEl: HTMLElement | null) => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const intentRef = useRef<number | null>(null)
  const wantRef = useRef(false)
  const playedRef = useRef(false)

  const useLiveFrame = showFrame && !item.thumbUrl
  const { shape, durationSec, windowRef, posterState } = useVideoPosterFrame(
    videoRef,
    canvasRef,
    item.path,
    item.streamChannel ?? channel,
    useLiveFrame,
  )

  useEffect(() => {
    const v = videoRef.current
    if (!v || !useLiveFrame) return
    const onTimeUpdate = (): void => {
      const w = windowRef.current
      if (v.paused) return
      const limit = Math.min(w.len, 5)
      if (v.currentTime - w.start >= limit) {
        v.pause()
        btnRef.current?.classList.remove('is-playing')
        if (playedRef.current) {
          releaseVideoStream(v)
          playedRef.current = false
        }
        if (activeHoverVideo === v) activeHoverVideo = null
      }
    }
    v.addEventListener('timeupdate', onTimeUpdate)
    return () => v.removeEventListener('timeupdate', onTimeUpdate)
  }, [useLiveFrame])

  const stopTilePreview = (): void => {
    wantRef.current = false
    if (intentRef.current !== null) {
      window.clearTimeout(intentRef.current)
      intentRef.current = null
    }
    const v = videoRef.current
    if (!v) return
    v.pause()
    delete v.dataset.hover
    btnRef.current?.classList.remove('is-playing')
    if (playedRef.current || posterState === 'ready') {
      releaseVideoStream(v)
      playedRef.current = false
    } else if (v.getAttribute('src')) {
      try { v.currentTime = windowRef.current.start } catch { /* ignore */ }
    }
    if (activeHoverVideo === v) activeHoverVideo = null
  }

  const handleMouseEnter = (): void => {
    if (!hoverPreview || !useLiveFrame || !liveVisualsAllowed()) return
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return
    wantRef.current = true
    if (intentRef.current !== null) window.clearTimeout(intentRef.current)
    intentRef.current = window.setTimeout(() => {
      const v = videoRef.current
      if (!wantRef.current || !v || !liveVisualsAllowed()) return
      if (activeHoverVideo && activeHoverVideo !== v) stopActiveHoverPreview()
      v.dataset.hover = '1'
      const startPlay = (): void => {
        if (!wantRef.current || !liveVisualsAllowed()) return
        activeHoverVideo = v
        playedRef.current = true
        v.style.opacity = '1'
        v.play().then(() => {
          if (wantRef.current) btnRef.current?.classList.add('is-playing')
          else stopTilePreview()
        }).catch(() => {})
      }
      if (!v.getAttribute('src')) {
        v.preload = 'metadata'
        v.src = footageUrl(item.path, item.streamChannel ?? channel)
        // play() right at metadata: the seek to the preview start (if any) is already queued, and no seek happens when it starts at 0.
        v.addEventListener('loadedmetadata', startPlay, { once: true })
      } else if (v.readyState >= 3) {
        startPlay()
      } else {
        v.addEventListener('canplay', startPlay, { once: true })
      }
    }, 300)
  }

  const metaParts = [
    item.dateLabel,
    item.with && item.with.length > 0 ? `With: ${item.with.join(', ')}` : null,
  ].filter(Boolean)

  const displayDuration = item.duration || (durationSec && durationSec > 0 ? formatVideoSeconds(durationSec) : null)

  return (
    <button
      ref={btnRef}
      type="button"
      className="coffre-vt"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={stopTilePreview}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return
        stopTilePreview()
        onWatch(item, windowRef.current.start, btnRef.current?.querySelector('.coffre-vt-frame') as HTMLElement | null)
      }}
    >
      <div className={`coffre-vt-frame${useLiveFrame && posterState !== 'ready' ? ` is-${posterState === 'failed' ? 'failed' : 'loading'}` : ''}`}>
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="" loading="lazy" />
        ) : showFrame ? (
          <>
            <canvas ref={canvasRef} className="vposter" data-shape={shape} aria-hidden="true" />
            <video
              ref={videoRef}
              muted
              playsInline
              preload="none"
              data-shape={shape}
              aria-hidden="true"
              tabIndex={-1}
            />
            {posterState === 'failed' && (
              <div className="coffre-vt-neutral is-failed">
                <Film size={20} aria-hidden="true" />
                Preview unavailable
              </div>
            )}
          </>
        ) : (
          <div className="coffre-vt-neutral">No preview</div>
        )}
        <span className="coffre-vt-badge">
          <FootageFamilyChip family={item.family} />
        </span>
        {displayDuration && <span className="coffre-vt-dur">{displayDuration}</span>}
        <span className="coffre-vt-play" aria-hidden="true">
          <Play size={18} fill="currentColor" />
        </span>
      </div>
      <div className="coffre-vt-title">{cleanFootageDisplayTitle(item.title)}</div>
      {metaParts.length > 0 && <div className="coffre-vt-meta">{metaParts.join(' · ')}</div>}
      {item.linked && <FootageLinkChip link={item.linked} strict={strictLink} />}
      {item.youtubeUrl && (
        <a
          href={item.youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
          onClick={(e) => e.stopPropagation()}
        >
          Watch on YouTube ↗
        </a>
      )}
    </button>
  )
}

const SPEEDS = [0.75, 1, 1.25, 1.5] as const

export function FootagePlayerModal({
  item,
  channel = '',
  onClose,
}: {
  item: FootageTileItem
  channel?: string
  onClose: () => void
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlaying = useStore((s) => s.isPlaying)
  const isRadioPlaying = useStore((s) => s.radioFmActive && !s.radioFmPaused)
  const { reducedMotion, gameMode } = useEffectsState()
  const [musicPausedByVideo, setMusicPausedByVideo] = useState(false)
  const [noSound, setNoSound] = useState(false)

  const [vPlaying, setVPlaying] = useState(true)
  const [curTime, setCurTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [bufEnd, setBufEnd] = useState(0)
  const [muted, setMuted] = useState(false)
  const [vol, setVol] = useState(1)
  const [speedIdx, setSpeedIdx] = useState(1)
  const [isFs, setIsFs] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)

  const [dvdEnabled, setDvdEnabled] = useState<boolean>(() => ls.get<boolean>('footageDvdEnabled') ?? true)
  const [dvdLogo, setDvdLogo] = useState<DvdLogoId>(() => ls.get<DvdLogoId>('footageDvdLogo') ?? 'mix')
  const [cornerHits, setCornerHits] = useState(0)

  const wakeChrome = useCallback(() => {
    setChromeVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setChromeVisible(false)
    }, 2600)
  }, [])

  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }, [])

  useEffect(() => {
    setNoSound(false)
    setCurTime(0)
    setDur(0)
    setBufEnd(0)
    stopActiveHoverPreview()
    footageModalVideoGate.videoWillPlay()
    setMusicPausedByVideo(footageModalVideoGate.isMusicPausedByVideo())
    const v = videoRef.current
    if (v) activeModalVideo = v
    return () => {
      if (v) releaseVideoStream(v)
      if (activeModalVideo === v) activeModalVideo = null
      footageModalVideoGate.videoDidClose()
    }
  }, [item.path])

  useEffect(() => {
    if (suppressingGateSync) return
    const s = useStore.getState()
    if (s.isPlaying || (s.radioFmActive && !s.radioFmPaused)) {
      footageModalVideoGate.musicTouched()
      setMusicPausedByVideo(footageModalVideoGate.isMusicPausedByVideo())
    }
  }, [isPlaying, isRadioPlaying])

  useEffect(() => {
    const onFsChange = (): void => setIsFs(document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); wakeChrome() }
    else { v.pause(); setChromeVisible(true) }
  }, [wakeChrome])

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta))
    setCurTime(v.currentTime)
    wakeChrome()
  }, [wakeChrome])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
    wakeChrome()
  }, [wakeChrome])

  const toggleFullscreen = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    if (document.fullscreenElement === box) document.exitFullscreen?.().catch(() => {})
    else box.requestFullscreen?.().catch(() => {})
    wakeChrome()
  }, [wakeChrome])

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (videoRef.current) videoRef.current.playbackRate = SPEEDS[next]
    wakeChrome()
  }, [speedIdx, wakeChrome])

  const toggleDvd = (): void => {
    setDvdEnabled((prev) => {
      const next = !prev
      ls.set('footageDvdEnabled', next)
      return next
    })
  }

  const cycleDvdLogo = (): void => {
    const idx = DVD_LOGO_OPTIONS.findIndex((o) => o.id === dvdLogo)
    const next = DVD_LOGO_OPTIONS[(idx + 1) % DVD_LOGO_OPTIONS.length].id
    setDvdLogo(next)
    ls.set('footageDvdLogo', next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) return
        e.stopPropagation()
        onClose()
        return
      }
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space' || e.key.toLowerCase() === 'k') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-10) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(10) }
      else if (e.key.toLowerCase() === 'm') { e.preventDefault(); toggleMute() }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, togglePlay, seekBy, toggleMute, toggleFullscreen])

  const pct = dur > 0 ? Math.min(100, (curTime / dur) * 100) : 0
  const bufPct = dur > 0 ? Math.min(100, (bufEnd / dur) * 100) : 0
  const currentLogoLabel = DVD_LOGO_OPTIONS.find((o) => o.id === dvdLogo)?.label ?? 'Mix 999'
  const isOneTakeSession = item.family === 'studio' && dur >= 600
  const showChrome = chromeVisible || !vPlaying

  const content = (
    <div
      className="coffre-vplay-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={cleanFootageDisplayTitle(item.title)}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <FootageDvdBouncer
        enabled={dvdEnabled && !isFs}
        logo={dvdLogo}
        reducedMotion={reducedMotion || gameMode}
        onCornerHit={() => setCornerHits((n) => n + 1)}
      />
      <div
        ref={boxRef}
        className={`coffre-vplay-box ${reducedMotion ? '' : 'animate-in'}`}
        onPointerMove={wakeChrome}
        onPointerLeave={() => { if (vPlaying) setChromeVisible(false) }}
      >
        <button type="button" className="coffre-vplay-close" aria-label="Close video" onClick={onClose}>
          <X size={17} />
        </button>
        <video
          ref={videoRef}
          autoPlay
          preload="metadata"
          playsInline
          src={footageUrl(item.path, item.streamChannel ?? channel)}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (Number.isFinite(v.duration)) setDur(v.duration)
            v.playbackRate = SPEEDS[speedIdx]
          }}
          onPlay={() => {
            setVPlaying(true)
            footageModalVideoGate.videoWillPlay()
            setMusicPausedByVideo(footageModalVideoGate.isMusicPausedByVideo())
            wakeChrome()
          }}
          onPause={() => { setVPlaying(false); setChromeVisible(true) }}
          onProgress={(e) => {
            const v = e.currentTarget
            if (v.buffered.length > 0) setBufEnd(v.buffered.end(v.buffered.length - 1))
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            setCurTime(v.currentTime)
            if (v.buffered.length > 0) setBufEnd(v.buffered.end(v.buffered.length - 1))
            if (!noSound && videoHasNoSound(v)) setNoSound(true)
          }}
        />
        <div className="coffre-vplay-bar" style={{ opacity: showChrome ? 1 : 0 }}>
          <span className="coffre-chip font-mono-ui !text-[10px] tracking-[0.14em] uppercase">999 VAULT</span>
          <FootageFamilyChip family={item.family} />
          {isOneTakeSession && <span className="coffre-chip">Full Session · One-Take</span>}
          {musicPausedByVideo && (
            <button
              type="button"
              className="coffre-secondary !py-1 !px-2.5 !text-[11px]"
              onClick={onClose}
            >
              Resume music
            </button>
          )}
          {noSound && <span className="coffre-chip" title="The archive file has no audio track">No sound</span>}
          <span className="font-semibold truncate max-w-[40%]">{cleanFootageDisplayTitle(item.title)}</span>
          {!isFs && !reducedMotion && !gameMode && (
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleDvd}
                title="Toggle bouncing Juice WRLD DVD screensaver around the video"
                className={`coffre-secondary !py-1 !px-2.5 !text-[11px] ${dvdEnabled ? '!border-[var(--accent)] !text-white' : 'opacity-65'}`}
              >
                <Sparkles size={11} /> DVD {dvdEnabled ? 'On' : 'Off'}
              </button>
              {dvdEnabled && (
                <button
                  type="button"
                  onClick={cycleDvdLogo}
                  title="Switch bouncing Juice WRLD logo"
                  className="coffre-secondary !py-1 !px-2.5 !text-[11px]"
                >
                  {currentLogoLabel}
                </button>
              )}
              {cornerHits > 0 && (
                <span className="coffre-chip font-mono-ui !text-[10px]" title="DVD exact corner hits">
                  Corner ×{cornerHits}
                </span>
              )}
            </div>
          )}
        </div>

        <div className={`coffre-vplay-controls ${showChrome ? '' : 'is-hidden'}`} onClick={(e) => e.stopPropagation()}>
          <div
            className="coffre-vplay-seek"
            role="slider"
            aria-label="Seek video"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(curTime)}
            tabIndex={0}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (rect.width <= 0 || dur <= 0 || !videoRef.current) return
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              videoRef.current.currentTime = ratio * dur
              setCurTime(ratio * dur)
              wakeChrome()
            }}
          >
            <div className="coffre-vplay-seek-track">
              <div className="coffre-vplay-seek-buf" style={{ width: `${bufPct}%` }} />
              <div className="coffre-vplay-seek-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button type="button" className="coffre-vplay-btn is-primary" onClick={togglePlay} aria-label={vPlaying ? 'Pause' : 'Play'}>
                {vPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-[1px]" />}
              </button>
              <button type="button" className="coffre-vplay-btn" onClick={() => seekBy(-10)} title="Back 10s (←)" aria-label="Back 10 seconds">
                <RotateCcw size={15} />
              </button>
              <button type="button" className="coffre-vplay-btn" onClick={() => seekBy(10)} title="Forward 10s (→)" aria-label="Forward 10 seconds">
                <RotateCw size={15} />
              </button>
              <span className="font-mono-ui text-[11px] text-white/85 tabular-nums ml-1.5">
                {formatVideoSeconds(curTime)} / {formatVideoSeconds(dur)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {item.linked && <FootageLinkChip link={item.linked} strict />}
              <button type="button" className="coffre-vplay-btn" onClick={toggleMute} title={muted ? 'Unmute (M)' : 'Mute (M)'} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || vol === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : vol}
                aria-label="Video volume"
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setVol(next)
                  if (videoRef.current) {
                    videoRef.current.volume = next
                    videoRef.current.muted = next === 0
                    setMuted(next === 0)
                  }
                }}
                className="w-16 accent-[var(--accent)] cursor-pointer"
              />
              <button
                type="button"
                onClick={cycleSpeed}
                title="Playback speed"
                className="px-2 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-mono-ui font-semibold text-white/90 transition-colors"
              >
                {SPEEDS[speedIdx]}×
              </button>
              <button type="button" className="coffre-vplay-btn" onClick={toggleFullscreen} title={isFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen'}>
                {isFs ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
