import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, X } from 'lucide-react'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { liveVisualsAllowed, useEffectsState } from '../lib/effectsPreference'
import { videoFrameShape, windowForPath, type PreviewWindowResult, type VideoFrameShape } from '../lib/previewWindow'
import {
  createAudibleVideoGate,
  type FootageFamily,
  type FootageSongLink,
} from '../lib/footageCatalog'
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
}

interface PosterCacheEntry {
  canvas: HTMLCanvasElement
  window: PreviewWindowResult
  duration: number
  shape: VideoFrameShape
}

const posterCache = new Map<string, PosterCacheEntry>()
let activeHoverVideo: HTMLVideoElement | null = null
let activeModalVideo: HTMLVideoElement | null = null
let suppressingGateSync = false

export const footageModalVideoGate = createAudibleVideoGate({
  isMusicPlaying: () => useStore.getState().isPlaying,
  setMusicPlaying: (playing) => {
    suppressingGateSync = true
    try { useStore.getState().setIsPlaying(playing) } finally { suppressingGateSync = false }
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

export function FootageLinkChip({ link, strict = false }: { link?: FootageSongLink | null; strict?: boolean }): JSX.Element | null {
  if (!link) return null
  if (link.level === 'possible') {
    if (strict) return null
    return (
      <span className="coffre-chip is-warn" title="Same base title only: not verified">
        Possible match: {link.name}
      </span>
    )
  }
  const suffix = link.entries > 1 ? ` · ${link.entries} entries` : ''
  if (link.level === 'title+date') {
    return (
      <span className="coffre-chip is-strong" title="The file date equals the catalogue recording date">
        Same title and date as {link.name}{suffix}
      </span>
    )
  }
  const label = link.via === 'alias' ? `Listed as ${link.name}${suffix}` : `Same title as ${link.name}${suffix}`
  const title = link.via === 'alias'
    ? `The catalogue lists this as another title of ${link.name} (no date to compare)`
    : 'Same title as a catalogue entry (no date to compare)'
  return <span className="coffre-chip" title={title}>{label}</span>
}

export function useVideoPosterFrame(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  path: string,
  channel: string,
  enabled: boolean,
  onMeta?: (meta: { duration: number; shape: VideoFrameShape; window: PreviewWindowResult }) => void,
) {
  const [shape, setShape] = useState<VideoFrameShape>(() => posterCache.get(path)?.shape ?? 'wide')
  const [durationSec, setDurationSec] = useState<number | null>(() => posterCache.get(path)?.duration ?? null)
  const windowRef = useRef<PreviewWindowResult>(posterCache.get(path)?.window ?? windowForPath(0, path))
  const posterDrawnRef = useRef(false)

  useEffect(() => {
    if (!enabled || !path) return
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return

    const cached = posterCache.get(path)
    if (cached) {
      c.width = cached.canvas.width
      c.height = cached.canvas.height
      const ctx = c.getContext('2d')
      try { ctx?.drawImage(cached.canvas, 0, 0) } catch { /* ignore */ }
      posterDrawnRef.current = true
      windowRef.current = cached.window
      setShape(cached.shape)
      setDurationSec(cached.duration)
      v.style.opacity = '0'
      onMeta?.({ duration: cached.duration, shape: cached.shape, window: cached.window })
      return
    }

    const drawPoster = (): void => {
      if (posterDrawnRef.current || !v.videoWidth || !v.videoHeight) return
      c.width = v.videoWidth
      c.height = v.videoHeight
      try {
        const ctx = c.getContext('2d')
        ctx?.drawImage(v, 0, 0, c.width, c.height)
        posterDrawnRef.current = true
        const off = document.createElement('canvas')
        off.width = c.width
        off.height = c.height
        off.getContext('2d')?.drawImage(c, 0, 0)
        if (Number.isFinite(v.duration) && v.duration > 0) {
          const s = videoFrameShape(v.videoWidth, v.videoHeight)
          posterCache.set(path, { canvas: off, window: windowRef.current, duration: v.duration, shape: s })
        }
      } catch { /* ignore cross-origin or decode race */ }
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

    const onSeeked = (): void => {
      drawPoster()
    }

    v.addEventListener('loadedmetadata', onLoadedMeta)
    v.addEventListener('seeked', onSeeked)

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            io?.unobserve(v)
            const hit = posterCache.get(path)
            if (hit) {
              c.width = hit.canvas.width
              c.height = hit.canvas.height
              try { c.getContext('2d')?.drawImage(hit.canvas, 0, 0) } catch { /* ignore */ }
              posterDrawnRef.current = true
              windowRef.current = hit.window
              setShape(hit.shape)
              setDurationSec(hit.duration)
              v.style.opacity = '0'
              onMeta?.({ duration: hit.duration, shape: hit.shape, window: hit.window })
              return
            }
            v.preload = 'metadata'
            v.src = buildStreamUrl(path, channel || undefined)
          }
        }, { rootMargin: '300px' })
      : null

    if (io) io.observe(v)
    else {
      v.preload = 'metadata'
      v.src = buildStreamUrl(path, channel || undefined)
    }

    return () => {
      io?.disconnect()
      v.removeEventListener('loadedmetadata', onLoadedMeta)
      v.removeEventListener('seeked', onSeeked)
    }
  }, [path, channel, enabled])

  return { shape, durationSec, windowRef, posterDrawnRef }
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
  const { shape, durationSec, windowRef, posterDrawnRef } = useVideoPosterFrame(
    videoRef,
    canvasRef,
    item.path,
    channel,
    useLiveFrame,
  )

  useEffect(() => {
    const v = videoRef.current
    if (!v || !useLiveFrame) return
    const onTimeUpdate = (): void => {
      const w = windowRef.current
      if (!posterDrawnRef.current && v.readyState >= 2 && v.currentTime >= w.start && canvasRef.current && v.videoWidth) {
        const c = canvasRef.current
        c.width = v.videoWidth
        c.height = v.videoHeight
        try {
          c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
          posterDrawnRef.current = true
        } catch { /* ignore */ }
      }
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
    btnRef.current?.classList.remove('is-playing')
    if (playedRef.current) {
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
        v.src = buildStreamUrl(item.path, channel || undefined)
        v.addEventListener('seeked', startPlay, { once: true })
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
      <div className="coffre-vt-frame">
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
          </>
        ) : (
          <div className="coffre-vt-neutral">Studio archive clip</div>
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
      {item.linked && (
        <div className="mt-1.5">
          <FootageLinkChip link={item.linked} strict={strictLink} />
        </div>
      )}
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

export function FootagePlayerModal({
  item,
  channel = '',
  startAt = 0,
  onClose,
}: {
  item: FootageTileItem
  channel?: string
  startAt?: number
  onClose: () => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const isPlaying = useStore((s) => s.isPlaying)
  const { reducedMotion } = useEffectsState()
  const [fromStartShown, setFromStartShown] = useState(startAt > 1)
  const [musicPausedByVideo, setMusicPausedByVideo] = useState(false)

  useEffect(() => {
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
    if (isPlaying && !suppressingGateSync) {
      footageModalVideoGate.musicTouched()
      setMusicPausedByVideo(footageModalVideoGate.isMusicPausedByVideo())
    }
  }, [isPlaying])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const content = (
    <div
      className="coffre-vplay-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={cleanFootageDisplayTitle(item.title)}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`coffre-vplay-box ${reducedMotion ? '' : 'animate-in'}`}>
        <button type="button" className="coffre-vplay-close" aria-label="Close video" onClick={onClose}>
          <X size={18} />
        </button>
        <video
          ref={videoRef}
          controls
          autoPlay
          preload="metadata"
          playsInline
          src={buildStreamUrl(item.path, channel || undefined)}
          onLoadedMetadata={(e) => {
            if (startAt > 1) {
              const dur = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0
              try {
                e.currentTarget.currentTime = dur > 2 ? Math.min(startAt, Math.max(dur - 2, 0)) : startAt
              } catch { /* ignore */ }
            }
          }}
          onPlay={() => {
            footageModalVideoGate.videoWillPlay()
            setMusicPausedByVideo(footageModalVideoGate.isMusicPausedByVideo())
          }}
        />
        <div className="coffre-vplay-bar">
          {musicPausedByVideo && (
            <>
              <span className="coffre-chip">Music paused</span>
              <button
                type="button"
                className="coffre-secondary py-1 px-3 text-xs"
                onClick={onClose}
              >
                Resume music
              </button>
            </>
          )}
          <span className="font-semibold truncate">{cleanFootageDisplayTitle(item.title)}</span>
          {fromStartShown && startAt > 1 && (
            <>
              <span className="opacity-80 text-xs">from {formatVideoSeconds(startAt)}</span>
              <button
                type="button"
                className="coffre-secondary py-1 px-3 text-xs"
                onClick={() => {
                  const v = videoRef.current
                  if (v) {
                    v.currentTime = 0
                    v.play().catch(() => {})
                  }
                  setFromStartShown(false)
                }}
              >
                From the beginning
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
