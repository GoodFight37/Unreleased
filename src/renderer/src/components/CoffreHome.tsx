import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ArrowUpRight, Disc3, Gamepad2, Music2, Pause, Play, Radio } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import type { useHomeData } from '../hooks/useHomeData'
import { useCanEdit } from '../hooks/useChannelRoles'
import { buildImageUrl, songToTrack, type JWApiSong } from '../lib/juicewrldApi'
import { ERA_LOOK, eraStart } from '../lib/eraLook'
import { saveTrackerSearch } from '../lib/apiTrackerShared'
import { eraLabel, listEras, loadEraFullNames } from '../lib/eras'
import { hasDirectAudioPath } from '../lib/songVersions'
import { SongTruthLine, SongTruthLineLive } from './SongTruthLine'
import { trackIdToSongId } from '../lib/userApi'
import { backdropArt, getSkin } from '../lib/skins'
import { useEffectsState } from '../lib/effectsPreference'
import { ERA_TIME_FRAMES, resolveWrldEra } from '../lib/wrldAtmospheres'
import { lazyOverlay } from '../lib/lazyView'
import { thisWeekRecorded } from '../lib/onThisDay'
import {
  buildFootageSongIndex,
  classifyFootageEntry,
  excludedFootageReason,
  linkFootageToCatalogue,
  parseFreestyleName,
  scoreStudioFootage,
} from '../lib/footageCatalog'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import LiquidMeshBackdrop from './LiquidMeshBackdrop'
import { ProgressiveCover } from './ProgressiveCover'
import { DiscoverArchiveBackdrop, DiscoverTopBar, DiscoverVaultCulture } from './DiscoverArchiveCulture'
import {
  cleanFootageDisplayTitle,
  FootageFamilyChip,
  FootageLinkChip,
  FootagePlayerModal,
  FootageTile,
  footageUrl,
  formatVideoSeconds,
  releaseVideoStream,
  useVideoPosterFrame,
  type FootageTileItem,
} from './FootageTile'
import type { Track } from '../types'
import type { SongContextMenuState } from './SongContextMenu'

const SongContextMenu = lazyOverlay(() => import('./SongContextMenu'))

const cleanMeta = (v: string | null | undefined): string | null => {
  const s = v?.trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}

function firstStudioLocation(song: JWApiSong): string {
  const raw = cleanMeta(song.recording_locations)
  if (!raw) return ''
  return raw.split(/\r?\n/)[0]?.trim() ?? ''
}

const HERO_PAUSED_KEY = 'unreleased:discoverHeroPaused'
function readHeroPaused(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(HERO_PAUSED_KEY) === '1' } catch { return false }
}
function writeHeroPaused(paused: boolean): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(HERO_PAUSED_KEY, paused ? '1' : '0') } catch { /* ignore */ }
}

function DiscoverHeroVideo({
  item,
  channel,
  still,
  modalOpen,
  onMetaDur,
}: {
  item: FootageTileItem
  channel: string
  still: boolean
  modalOpen: boolean
  onMetaDur: (durSec: number) => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pausedByUser, setPausedByUser] = useState<boolean>(readHeroPaused)
  const flagsRef = useRef({ pausedByUser, still, modalOpen })
  flagsRef.current = { pausedByUser, still, modalOpen }

  const { shape, windowRef, posterDrawnRef } = useVideoPosterFrame(
    videoRef,
    canvasRef,
    item.path,
    channel,
    true,
    (meta) => {
      if (meta.duration > 0) onMetaDur(meta.duration)
    },
  )

  // Keep the stream alive across pause/resume toggles; only release on path change or unmount.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
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
      const limit = Math.min(Math.max(w.len, 8), 16)
      if (v.currentTime - w.start >= limit || (v.duration > 0 && v.currentTime >= v.duration - 0.15)) {
        try { v.currentTime = w.start } catch { /* ignore */ }
      }
    }
    const onEnded = (): void => {
      try {
        v.currentTime = windowRef.current.start
        const f = flagsRef.current
        if (!f.pausedByUser && !f.still && !f.modalOpen && !document.hidden) v.play().catch(() => {})
      } catch { /* ignore */ }
    }
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('ended', onEnded)
      releaseVideoStream(v)
    }
  }, [item.path])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const startLoop = (): void => {
      const f = flagsRef.current
      if (f.still || f.modalOpen || f.pausedByUser || document.hidden) return
      const start = windowRef.current.start
      if (v.readyState >= 1 && start > 0 && Math.abs(v.currentTime - start) > 0.5 && v.currentTime < start) {
        try { v.currentTime = start } catch { /* ignore */ }
      }
      v.style.opacity = '1'
      v.play().catch(() => {})
    }
    const sync = (): void => {
      if (!still && !modalOpen && !pausedByUser && !document.hidden) {
        v.dataset.hover = '1'
        if (!v.currentSrc && !v.getAttribute('src')) {
          v.src = footageUrl(item.path, item.streamChannel ?? channel)
          v.load()
        }
        startLoop()
      } else {
        delete v.dataset.hover
        v.pause()
        // Always return cleanly to the opening poster frame when paused instead of freezing mid-expression.
        v.style.opacity = '0'
        if (pausedByUser && v.readyState >= 1) {
          const start = windowRef.current.start
          if (Math.abs(v.currentTime - start) > 0.25) {
            try { v.currentTime = start } catch { /* ignore */ }
          }
        }
      }
    }
    sync()
    const onVis = (): void => sync()
    document.addEventListener('visibilitychange', onVis)
    v.addEventListener('loadedmetadata', startLoop)
    v.addEventListener('canplay', startLoop)
    v.addEventListener('seeked', sync)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      v.removeEventListener('loadedmetadata', startLoop)
      v.removeEventListener('canplay', startLoop)
      v.removeEventListener('seeked', sync)
    }
  }, [still, modalOpen, pausedByUser, item.path, item.streamChannel, channel])

  const togglePause = (): void => {
    setPausedByUser((prev) => {
      const next = !prev
      writeHeroPaused(next)
      return next
    })
  }

  return (
    <>
      <div className="coffre-hero-media" aria-hidden="true">
        <canvas ref={canvasRef} className="vposter" data-shape={shape} />
        <video ref={videoRef} muted loop playsInline preload="none" data-shape={shape} tabIndex={-1} />
      </div>
      {!still && (
        <button
          type="button"
          onClick={togglePause}
          title={pausedByUser ? 'Play studio loop' : 'Pause studio loop'}
          aria-label={pausedByUser ? 'Play studio loop' : 'Pause studio loop'}
          aria-pressed={pausedByUser}
          className="absolute top-3.5 right-3.5 z-20 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/45 hover:bg-black/68 border border-white/20 text-[11px] font-medium text-white/90 backdrop-blur-md transition-colors"
        >
          {pausedByUser ? <Play size={11} fill="currentColor" /> : <Pause size={11} fill="currentColor" />}
          <span>{pausedByUser ? 'Play loop' : 'Pause'}</span>
        </button>
      )}
    </>
  )
}

export default function CoffreHome({ data }: { data: ReturnType<typeof useHomeData> }): JSX.Element {
  const {
    theme, adaptiveColors, currentTrack, currentTrackFull, isPlaying, setIsPlaying, playTrack, playNext,
    setActiveView, setApiTrackerCategory, setApiTrackerEra, setApiTrackerTab,
  } = useStorePick(
    'theme', 'adaptiveColors', 'currentTrack', 'currentTrackFull', 'isPlaying', 'setIsPlaying', 'playTrack', 'playNext',
    'setActiveView', 'setApiTrackerCategory', 'setApiTrackerEra', 'setApiTrackerTab',
  )
  const [context, setContext] = useState<SongContextMenuState | null>(null)
  const [watching, setWatching] = useState<{ item: FootageTileItem; startAt: number } | null>(null)
  const [heroVideoDur, setHeroVideoDur] = useState<number>(0)
  const [selectedEra, setSelectedEra] = useState<string | null>(null)
  const [, setErasLoaded] = useState(0)
  const canEdit = useCanEdit()
  const effects = typeof useEffectsState === 'function' ? useEffectsState() : { reducedMotion: false, gameMode: false }
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setSystemReduced(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])
  const still = effects.reducedMotion || effects.gameMode || systemReduced
  const isDarkTheme = typeof getSkin === 'function' ? getSkin(theme ?? 'glass-dark').dark : true
  const channel = data.channel ?? ''

  const available = useMemo(() => data.catalogue.filter((song) => song.category === 'unreleased' && !!song.path), [data.catalogue])
  const songById = useMemo(() => new Map(data.catalogue.map((song) => [song.id, song])), [data.catalogue])
  const nameOnly = useMemo(() => data.catalogue.filter((song) => song.category === 'unsurfaced').slice(0, 8), [data.catalogue])
  const sessionCount = useMemo(() => data.catalogue.filter((song) => song.category === 'recording_session').length, [data.catalogue])
  const discoveries = useMemo(() => {
    const firstByEra = new Map<string, typeof available[number]>()
    for (const song of available) if (!firstByEra.has(song.era?.name ?? '')) firstByEra.set(song.era?.name ?? '', song)
    const firstIds = new Set([...firstByEra.values()].map((song) => song.id))
    return [...firstByEra.values(), ...available.filter((song) => !firstIds.has(song.id))].slice(0, 6).map(songToTrack)
  }, [available])
  const resume = data.recent.filter((track) => !!track.path || !!track.streamUrl).slice(0, 6)
  const row = resume.length ? resume : discoveries
  const hero = currentTrack ?? row[0]
  const heroSongId = hero ? trackIdToSongId(hero.id) : null
  const heroSong = data.catalogue.find((song) => song.id === heroSongId)
  const isHeroCurrent = Boolean(currentTrack && hero && currentTrack.id === hero.id)
  const heroPlaying = isHeroCurrent && isPlaying
  const heroArtwork = (isHeroCurrent ? currentTrackFull?.albumArt : null) ?? hero?.imageUrl ?? buildImageUrl(heroSong?.image_url) ?? null
  const heroEraName = heroSong?.era?.name ?? hero?.era ?? ''
  const heroEraLook = ERA_LOOK[heroEraName]
  const roomArt = buildImageUrl(backdropArt(theme ?? 'glass-dark', adaptiveColors, heroArtwork)) || null
  const heroEraMeta = typeof resolveWrldEra === 'function'
    ? resolveWrldEra(roomArt, getSkin(theme).art ? getSkin(theme).name : heroEraName || null)
    : { eraLabel: null, eraAsset: heroEraLook?.art ?? null, atmosphere: undefined }
  const roomAtmosphere = useMemo(() => ({
    ...heroEraMeta.atmosphere,
    id: heroEraMeta.atmosphere?.id ?? '999' as const,
    speed: 0.14, energyPush: 0, grain: 0, calmness: 0.98, warmth: 0, butterflies: false,
  }), [heroEraMeta.atmosphere])
  const contextLabel = heroPlaying
    ? 'Now playing'
    : isHeroCurrent
      ? 'Current session'
      : resume.length > 0
        ? 'Continue listening'
        : 'Featured from the vault'
  const heroDuration = hero && (hero.duration ?? 0) > 0
    ? `${Math.floor(hero.duration / 60)}:${String(Math.floor(hero.duration % 60)).padStart(2, '0')}`
    : null
  const heroMetaParts = [
    hero?.artist || 'Juice WRLD',
    heroSong?.era ? eraLabel(heroSong.era.name, true) : hero?.era,
    heroDuration,
  ].filter((part): part is string => !!part && part.trim().toLowerCase() !== 'null')

  const humanLine = cleanMeta(heroSong?.additional_information) ?? cleanMeta(heroSong?.notes)

  const studioMoments = useMemo<FootageTileItem[]>(() => {
    if (!data.fileIndex || typeof buildFootageSongIndex !== 'function') return []
    const songIndex = buildFootageSongIndex(data.catalogue)
    const scored: { item: FootageTileItem; score: number }[] = []
    for (const { entry } of data.fileIndex.items) {
      if (excludedFootageReason(entry)) continue
      const fam = classifyFootageEntry(entry)
      if (fam !== 'studio' && fam !== 'freestyle') continue
      const link = linkFootageToCatalogue(entry, songIndex)
      const score = scoreStudioFootage(entry, link)
      if (score <= 0) continue
      const parsed = fam === 'freestyle' ? parseFreestyleName(entry.name || entry.path) : null
      const fileDate = parsed?.date ?? /(\d{4}-\d{2}-\d{2})/.exec(entry.name || entry.path)?.[1] ?? null
      scored.push({
        score,
        item: {
          path: entry.path,
          title: parsed ? parsed.title : (entry.name || entry.path.split('/').pop() || entry.path),
          family: fam,
          dateLabel: fileDate ? `file date ${fileDate}` : null,
          with: parsed?.with,
          linked: link,
          duration: entry.duration ?? null,
        },
      })
    }
    scored.sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path))
    return scored.slice(0, 5).map((x) => x.item)
  }, [data.fileIndex, data.catalogue])

  const heroFootage = studioMoments[0] ?? null
  const studioRow = studioMoments.slice(1, 5)

  const weekEntries = useMemo(
    () => (typeof thisWeekRecorded === 'function' ? thisWeekRecorded(data.catalogue) : []),
    [data.catalogue],
  )
  const weekPick = useMemo(() => {
    if (weekEntries.length <= 4) return weekEntries
    return [
      weekEntries[0],
      weekEntries[Math.floor(weekEntries.length / 3)],
      weekEntries[Math.floor((2 * weekEntries.length) / 3)],
      weekEntries[weekEntries.length - 1],
    ]
  }, [weekEntries])

  const eras = useMemo(() => {
    const groups = new Map<string, { name: string; cover: string | undefined; accent: string | undefined; count: number }>()
    for (const song of available) {
      const name = song.era?.name
      if (!name) continue
      const group = groups.get(name)
      if (group) group.count++
      else groups.set(name, { name, cover: buildImageUrl(ERA_LOOK[name]?.art ?? song.image_url), accent: ERA_LOOK[name]?.accent, count: 1 })
    }
    const order = (name: string): number => (typeof eraStart === 'function' ? eraStart(ERA_TIME_FRAMES?.[name]) : Infinity)
    return [...groups.values()]
      .sort((a, b) => order(a.name) - order(b.name) || b.count - a.count)
      .slice(0, 6)
  }, [available])

  const openCatalogue = (era = '', category: string = 'unreleased'): void => {
    saveTrackerSearch('')
    setApiTrackerCategory(category)
    setApiTrackerEra(era)
    setApiTrackerTab('songs')
    setActiveView('api-tracker')
  }
  const handleHeroPrimary = (): void => {
    if (!hero) {
      openCatalogue()
      return
    }
    if (isHeroCurrent && setIsPlaying) {
      setIsPlaying(!isPlaying)
      return
    }
    playTrack(hero, row.length ? row : [hero])
  }
  const openContext = (track: Track, event: React.MouseEvent): void => {
    event.preventDefault()
    setContext({ track, songId: trackIdToSongId(track.id), x: event.clientX, y: event.clientY })
  }

  const stageBackdrop = roomArt ? (
    <div className="coffre-stage-backdrop" aria-hidden="true">
      <LiquidMeshBackdrop
        artUrl={roomArt}
        eraAsset={heroEraMeta.eraAsset}
        atmosphere={roomAtmosphere}
        isDark={isDarkTheme}
        playing
        audioReactive={false}
        animated={!still}
      />
      <div className={`coffre-stage-vignette ${isDarkTheme ? 'is-dark' : 'is-light'}`} />
    </div>
  ) : null

  return <div className="coffre-home glass-scroll pb-player">
    {stageBackdrop && (typeof document !== 'undefined' && typeof createPortal === 'function'
      ? createPortal(stageBackdrop, document.body)
      : stageBackdrop)}
    <div className="coffre-home-inner">
      <DiscoverTopBar />
      {heroFootage ? (
        <section className="coffre-discover-hero coffre-reveal" aria-label="Featured studio footage">
          <DiscoverArchiveBackdrop onOpenPhotos={() => setActiveView('footage')} showControls={false} />
          <DiscoverHeroVideo
            item={heroFootage}
            channel={channel}
            still={still}
            modalOpen={watching !== null}
            onMetaDur={setHeroVideoDur}
          />
          <div className="coffre-discover-hero-grid">
            <div className="coffre-hero-titles text-white">
              <span className="coffre-kicker"><span className="coffre-kicker-dot" aria-hidden />999 — THE VAULT</span>
              <h1 className="!text-white">Beyond the albums.</h1>
              <p className="!text-white/85">Unreleased songs, studio sessions and footage from Juice WRLD’s archive.</p>
              <p className="!text-white/70 text-sm mt-2 max-w-xl">999 means taking whatever you’re going through and turning it into something that pushes you forward.</p>
              <div className="flex flex-wrap items-center gap-2.5 mt-4">
                <button type="button" className="coffre-primary !bg-white !text-black" onClick={() => setWatching({ item: heroFootage, startAt: 0 })}>
                  <Play size={15} fill="currentColor" /> Watch in the studio
                </button>
                <button type="button" className="coffre-secondary !bg-white/15 !text-white !border-white/25" onClick={() => setActiveView('footage')}>
                  All footage <ArrowRight size={15} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-white/80">
                <FootageFamilyChip family={heroFootage.family} />
                <span>
                  {cleanFootageDisplayTitle(heroFootage.title)}
                  {heroVideoDur > 0 ? ` · ${formatVideoSeconds(heroVideoDur)}` : heroFootage.duration ? ` · ${heroFootage.duration}` : ''}
                </span>
                {heroFootage.linked && <FootageLinkChip link={heroFootage.linked} strict />}
              </div>
            </div>

            <article
              className="coffre-banner coffre-lead-glass coffre-reveal"
              style={{ '--coffre-reveal-delay': '40ms', ...(heroEraLook?.accent ? { '--era-accent': heroEraLook.accent } : {}) } as CSSProperties}
              aria-label="Behind the track"
            >
              <button
                className="coffre-hero-art"
                onClick={handleHeroPrimary}
                aria-label={hero ? `${heroPlaying ? 'Pause' : isHeroCurrent ? 'Resume' : 'Play'} ${hero.title}` : 'Explore the catalogue'}
                onContextMenu={hero ? (event) => openContext(hero, event) : undefined}
              >
                {hero ? <AlbumArtThumbnail track={hero} fill eager res={512} className="coffre-hero-cover" /> : <Disc3 size={68} aria-hidden />}
                <span className="coffre-banner-play" aria-hidden>
                  {heroPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                </span>
              </button>

              <div className="coffre-banner-body">
                <div className="coffre-banner-top">
                  <span className={`coffre-context-badge ${heroPlaying ? 'is-live' : ''}`}>
                    <span className="coffre-context-dot" aria-hidden />
                    {contextLabel}
                  </span>
                  {heroMetaParts.length > 0 && <span className="coffre-banner-meta">{heroMetaParts.join(' · ')}</span>}
                </div>

                <h2 className="coffre-banner-title">{hero?.title ?? 'Juice WRLD Archive'}</h2>

                {humanLine && <p className="coffre-track-note">{humanLine}</p>}

                <div className="coffre-banner-actions">
                  <button className="coffre-primary" onClick={handleHeroPrimary}>
                    {heroPlaying
                      ? <><Pause size={15} fill="currentColor" /> Pause</>
                      : isHeroCurrent
                        ? <><Play size={15} fill="currentColor" /> Resume</>
                        : hero
                          ? <><Play size={15} fill="currentColor" /> Play track</>
                          : <>Explore the unreleased <ArrowUpRight size={16} /></>}
                  </button>
                  {heroSongId != null && (
                    <button className="coffre-secondary" onClick={() => useStore.getState().setInfoSongId(heroSongId)}>
                      Full song details <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : (
        <>
          <header className="coffre-hero-head coffre-reveal">
            <div className="coffre-hero-titles">
              <span className="coffre-kicker"><span className="coffre-kicker-dot" aria-hidden />999 — THE VAULT</span>
              <h1>Beyond the albums.</h1>
              <p>Unreleased tracks, studio sessions and alternate versions from Juice WRLD’s archive.</p>
              <p className="text-sm mt-2 max-w-xl opacity-70">999 means taking whatever you’re going through and turning it into something that pushes you forward.</p>
            </div>
            <button className="coffre-secondary" onClick={() => openCatalogue()}>Explore the unreleased <ArrowUpRight size={15} /></button>
          </header>

          <article
            className="coffre-banner coffre-reveal"
            style={{ '--coffre-reveal-delay': '40ms', ...(heroEraLook?.accent ? { '--era-accent': heroEraLook.accent } : {}) } as CSSProperties}
            aria-label="Behind the track"
          >
            <button
              className="coffre-hero-art"
              onClick={handleHeroPrimary}
              aria-label={hero ? `${heroPlaying ? 'Pause' : isHeroCurrent ? 'Resume' : 'Play'} ${hero.title}` : 'Explore the catalogue'}
              onContextMenu={hero ? (event) => openContext(hero, event) : undefined}
            >
              {hero ? <AlbumArtThumbnail track={hero} fill eager res={512} className="coffre-hero-cover" /> : <Disc3 size={68} aria-hidden />}
              <span className="coffre-banner-play" aria-hidden>
                {heroPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </span>
            </button>

            <div className="coffre-banner-body">
              <div className="coffre-banner-top">
                <span className={`coffre-context-badge ${heroPlaying ? 'is-live' : ''}`}>
                  <span className="coffre-context-dot" aria-hidden />
                  {contextLabel}
                </span>
                {heroMetaParts.length > 0 && <span className="coffre-banner-meta">{heroMetaParts.join(' · ')}</span>}
              </div>

              <h2 className="coffre-banner-title">{hero?.title ?? 'Juice WRLD Archive'}</h2>

              {humanLine && <p className="coffre-track-note">{humanLine}</p>}

              <div className="coffre-banner-actions">
                <button className="coffre-primary" onClick={handleHeroPrimary}>
                  {heroPlaying
                    ? <><Pause size={15} fill="currentColor" /> Pause</>
                    : isHeroCurrent
                      ? <><Play size={15} fill="currentColor" /> Resume</>
                      : hero
                        ? <><Play size={15} fill="currentColor" /> Play track</>
                        : <>Explore the unreleased <ArrowUpRight size={16} /></>}
                </button>
                {heroSongId != null && (
                  <button className="coffre-secondary" onClick={() => useStore.getState().setInfoSongId(heroSongId)}>
                    Full song details <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            </div>
          </article>
        </>
      )}

      {studioRow.length > 0 && (
        <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '60ms' } as CSSProperties} aria-labelledby="coffre-studio-head">
          <div className="coffre-section-heading">
            <div>
              <h2 id="coffre-studio-head">In the studio</h2>
              <p className="text-xs text-text-secondary mt-0.5">Hover a tile for a silent preview.</p>
            </div>
            <button type="button" onClick={() => setActiveView('footage')}>
              All footage <ArrowRight size={16} />
            </button>
          </div>
          <div className="coffre-vt-grid">
            {studioRow.map((item) => (
              <FootageTile
                key={item.path}
                item={item}
                channel={channel}
                showFrame
                strictLink
                onWatch={(it, startAt) => setWatching({ item: it, startAt })}
              />
            ))}
          </div>
        </section>
      )}

      {weekPick.length > 0 && (
        <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '80ms' } as CSSProperties} aria-labelledby="coffre-week-head">
          <div className="coffre-section-heading">
            <div>
              <h2 id="coffre-week-head">This week, years ago</h2>
              <p className="text-xs text-text-secondary mt-0.5">Songs recorded around this week across the years, as dated in the catalogue.</p>
            </div>
            <button type="button" onClick={() => openCatalogue('', '')}>
              See all {weekEntries.length} <ArrowRight size={16} />
            </button>
          </div>
          <div className="coffre-vt-grid">
            {weekPick.map((entry) => {
              const track = songToTrack(entry.song)
              const loc = firstStudioLocation(entry.song)
              return (
                <button
                  key={entry.song.id}
                  type="button"
                  className="coffre-cover-card"
                  onClick={() => entry.song.path ? playTrack(track, weekPick.filter((e) => !!e.song.path).map((e) => songToTrack(e.song))) : useStore.getState().setInfoSongId(entry.song.id)}
                  onContextMenu={(event) => openContext(track, event)}
                >
                  <span className="coffre-cover">
                    <ProgressiveCover src={buildImageUrl(entry.song.image_url)} alt="" className="w-full h-full object-cover" />
                    {entry.song.path && <span className="coffre-card-play"><Play size={17} fill="currentColor" /></span>}
                  </span>
                  <strong>{entry.title}</strong>
                  <span className="coffre-week-date">{entry.dateText}</span>
                  {loc && <span className="coffre-week-studio">{loc}</span>}
                  <SongTruthLineLive song={entry.song} />
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '100ms' } as CSSProperties} aria-labelledby="coffre-resume">
        <div className="coffre-section-heading"><h2 id="coffre-resume">{resume.length ? 'Continue listening' : 'From the vault'}</h2>
          <button onClick={() => setActiveView('playlists')}>Your collection <ArrowRight size={16} /></button></div>
        {row.length ? <div className="coffre-cover-row">{row.map((track) => <button className="coffre-cover-card" key={track.id}
          onClick={() => playTrack(track, row)} onContextMenu={(event) => openContext(track, event)} aria-label={`Play ${track.title}`}>
          <span className="coffre-cover"><AlbumArtThumbnail track={track} fill eager res={320} className="w-full h-full object-cover" /><span className="coffre-card-play"><Play size={17} fill="currentColor" /></span></span>
          <strong>{track.title}</strong><span>{track.era ?? track.artist}</span>
          {(() => { const song = songById.get(trackIdToSongId(track.id) ?? -1); return song ? <SongTruthLineLive song={song} /> : null })()}
        </button>)}</div> : <div className="coffre-empty"><Music2 size={27} /><p role={data.catalogueState === 'error' ? 'alert' : 'status'}>{data.catalogueState === 'loading' ? 'Loading the catalogue…' : data.catalogueState === 'error' ? 'The catalogue could not be loaded. Open Catalogue to try again.' : 'Your listening will appear here. Explore the catalogue to find your first track.'}</p><button onClick={() => openCatalogue()}>Open catalogue <ArrowRight size={16} /></button></div>}
      </section>

      <DiscoverVaultCulture catalogue={data.catalogue} onPlayTrack={playTrack} />

      <div className="coffre-reveal flex flex-wrap items-center gap-2.5">
        <button type="button" className="coffre-secondary" onClick={() => setActiveView('heardle')}><Gamepad2 size={15} /> Games · Heardle</button>
        <button type="button" className="coffre-secondary" onClick={data.openRadioFm}><Radio size={15} /> 999 FM</button>
      </div>

      {nameOnly.length > 0 && <section className="coffre-reveal" aria-labelledby="coffre-name-only">
        <div className="coffre-section-heading">
          <div>
            <h2 id="coffre-name-only">Unsurfaced</h2>
            <p className="text-xs text-text-secondary mt-0.5" title="Still in the vault — Soon™">Hasn't leaked. Nothing to play yet.</p>
          </div>
        </div>
        <div className="coffre-vt-grid">{nameOnly.map((song) => <div key={song.id} className="coffre-cover-card" style={{ cursor: 'default' }}>
          <strong>{song.name}</strong>
          <SongTruthLine song={song} playable={false} showCredit />
        </div>)}</div>
      </section>}

      {eras.length > 0 && <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '120ms' } as CSSProperties} aria-labelledby="coffre-eras">
        <div className="coffre-section-heading">
          <h2 id="coffre-eras">Find your era</h2>
          <button onClick={() => openCatalogue()}>
            {sessionCount > 0
              ? `${available.length.toLocaleString()} unreleased · ${sessionCount.toLocaleString()} sessions`
              : 'Explore the archive'} <ArrowRight size={16} />
          </button>
        </div>
        <div className="coffre-era-grid">{eras.map((era) => <button className="coffre-era" key={era.name} style={era.accent ? { '--era-accent': era.accent } as CSSProperties : undefined} onClick={() => { setSelectedEra((cur) => cur === era.name ? null : era.name); void loadEraFullNames().then(() => setErasLoaded((n) => n + 1), () => {}) }} aria-expanded={selectedEra === era.name} onPointerEnter={() => { void loadEraFullNames() }}>
          <span className="coffre-era-cover"><ProgressiveCover src={era.cover} alt="" className="w-full h-full object-cover" /></span>
          <span><strong>{eraLabel(era.name, true)}</strong><small>{era.count.toLocaleString()} unreleased tracks</small></span><ArrowUpRight size={16} />
        </button>)}</div>
        {selectedEra && (() => {
          const record = listEras().find((e) => e.name === selectedEra)
          const era = eras.find((e) => e.name === selectedEra)
          const songs = available.filter((song) => song.era?.name === selectedEra).slice(0, 12)
          return <div className="mt-4 rounded-xl border border-[var(--border)] p-4" style={era?.accent ? { '--era-accent': era.accent, borderColor: era.accent } as CSSProperties : undefined} role="region" aria-label={eraLabel(selectedEra, true)}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-semibold">{eraLabel(selectedEra, true)}</h3>
                {record?.time_frame && <p className="text-xs text-text-secondary mt-0.5">{record.time_frame}</p>}
                {record?.description && <p className="text-sm text-text-secondary mt-1.5 max-w-2xl">{record.description}</p>}
              </div>
              <button type="button" className="coffre-secondary" onClick={() => openCatalogue(selectedEra)}>Open in Catalogue <ArrowUpRight size={15} /></button>
            </div>
            <div className="coffre-vt-grid mt-3">{songs.map((song) => {
              const playable = hasDirectAudioPath(song)
              return <button key={song.id} type="button" className="coffre-cover-card"
                onClick={() => playable ? playTrack(songToTrack(song), songs.filter(hasDirectAudioPath).map(songToTrack)) : useStore.getState().setInfoSongId(song.id)}
                onContextMenu={(event) => openContext(songToTrack(song), event)}>
                <strong>{song.name}</strong>
                <SongTruthLineLive song={song} />
              </button>
            })}</div>
          </div>
        })()}
      </section>}

      {data.albumRow.length > 0 && <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '160ms' } as CSSProperties} aria-labelledby="coffre-albums">
        <div className="coffre-section-heading"><h2 id="coffre-albums">The albums, too</h2><button onClick={() => setActiveView('albums')}>All albums <ArrowRight size={16} /></button></div>
        <div className="coffre-album-row">{data.albumRow.slice(0, 5).map((album) => <button key={album.key} className="coffre-cover-card" onClick={album.open}>
          <span className="coffre-cover"><ProgressiveCover src={album.cover} alt="" className="w-full h-full object-cover" /></span><strong>{album.title}</strong><span>{album.subtitle}</span>
        </button>)}</div>
      </section>}
    </div>
    {context && <SongContextMenu state={context} onClose={() => setContext(null)} canEdit={canEdit}
      onInfo={() => context.songId != null && useStore.getState().setInfoSongId(context.songId)}
      onPlay={() => playTrack(context.track)} onPlayNext={() => playNext(context.track)} />}
    {watching && (
      <FootagePlayerModal
        item={watching.item}
        channel={channel}
        onClose={() => setWatching(null)}
      />
    )}
  </div>
}
