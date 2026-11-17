import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, ArrowUpRight, Disc3, Music2, Pause, Play } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import type { useHomeData } from '../hooks/useHomeData'
import { useCanEdit } from '../hooks/useChannelRoles'
import { buildImageUrl, songToTrack } from '../lib/juicewrldApi'
import { ERA_LOOK, eraStart } from '../lib/eraLook'
import { saveTrackerSearch } from '../lib/apiTrackerShared'
import { eraLabel, loadEraFullNames } from '../lib/eras'
import { trackIdToSongId } from '../lib/userApi'
import { getSkin } from '../lib/skins'
import { useEffectsState } from '../lib/effectsPreference'
import { ERA_TIME_FRAMES, resolveWrldEra } from '../lib/wrldAtmospheres'
import { lazyOverlay } from '../lib/lazyView'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import LiquidMeshBackdrop from './LiquidMeshBackdrop'
import { ProgressiveCover } from './ProgressiveCover'
import type { Track } from '../types'
import type { SongContextMenuState } from './SongContextMenu'

const SongContextMenu = lazyOverlay(() => import('./SongContextMenu'))

const cleanMeta = (v: string | null | undefined): string | null => {
  const s = v?.trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}

export default function CoffreHome({ data }: { data: ReturnType<typeof useHomeData> }): JSX.Element {
  const {
    theme, currentTrack, currentTrackFull, isPlaying, setIsPlaying, playTrack, playNext,
    setActiveView, setApiTrackerCategory, setApiTrackerEra, setApiTrackerTab,
  } = useStorePick(
    'theme', 'currentTrack', 'currentTrackFull', 'isPlaying', 'setIsPlaying', 'playTrack', 'playNext',
    'setActiveView', 'setApiTrackerCategory', 'setApiTrackerEra', 'setApiTrackerTab',
  )
  const [context, setContext] = useState<SongContextMenuState | null>(null)
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
  const available = useMemo(() => data.catalogue.filter((song) => song.category === 'unreleased' && !!song.path), [data.catalogue])
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
  const heroEraMeta = typeof resolveWrldEra === 'function'
    ? resolveWrldEra(hero?.imageUrl ?? heroEraLook?.art ?? null, heroEraName || null)
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

  const openCatalogue = (era = ''): void => {
    saveTrackerSearch('')
    setApiTrackerCategory('unreleased')
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

  return <div className="coffre-home glass-scroll pb-player">
    <div className="coffre-stage-backdrop" aria-hidden="true">
      <LiquidMeshBackdrop
        artUrl={heroArtwork}
        eraAsset={heroEraMeta.eraAsset}
        atmosphere={roomAtmosphere}
        isDark={isDarkTheme}
        playing
        audioReactive={false}
        animated={!still}
      />
      <div className={`coffre-stage-vignette ${isDarkTheme ? 'is-dark' : 'is-light'}`} />
    </div>
    <div className="coffre-home-inner">
      <header className="coffre-hero-head coffre-reveal">
        <div className="coffre-hero-titles">
          <span className="coffre-kicker"><span className="coffre-kicker-dot" aria-hidden />999 — THE VAULT</span>
          <h1>Beyond the albums.</h1>
          <p>Unreleased tracks, studio sessions and alternate versions from Juice WRLD’s archive.</p>
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
          onClick={() => hero ? playTrack(hero) : openCatalogue()}
          aria-label={hero ? `Play ${hero.title}` : 'Explore the catalogue'}
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

      <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '80ms' } as CSSProperties} aria-labelledby="coffre-resume">
        <div className="coffre-section-heading"><h2 id="coffre-resume">{resume.length ? 'Continue listening' : 'From the vault'}</h2>
          <button onClick={() => setActiveView('playlists')}>Your collection <ArrowRight size={16} /></button></div>
        {row.length ? <div className="coffre-cover-row">{row.map((track) => <button className="coffre-cover-card" key={track.id}
          onClick={() => playTrack(track, row)} onContextMenu={(event) => openContext(track, event)} aria-label={`Play ${track.title}`}>
          <span className="coffre-cover"><AlbumArtThumbnail track={track} fill eager res={320} className="w-full h-full object-cover" /><span className="coffre-card-play"><Play size={17} fill="currentColor" /></span></span>
          <strong>{track.title}</strong><span>{track.era ?? track.artist}</span>
        </button>)}</div> : <div className="coffre-empty"><Music2 size={27} /><p role={data.catalogueState === 'error' ? 'alert' : 'status'}>{data.catalogueState === 'loading' ? 'Loading the catalogue…' : data.catalogueState === 'error' ? 'The catalogue could not be loaded. Open Catalogue to try again.' : 'Your listening will appear here. Explore the catalogue to find your first track.'}</p><button onClick={() => openCatalogue()}>Open catalogue <ArrowRight size={16} /></button></div>}
      </section>

      {eras.length > 0 && <section className="coffre-reveal" style={{ '--coffre-reveal-delay': '120ms' } as CSSProperties} aria-labelledby="coffre-eras">
        <div className="coffre-section-heading"><h2 id="coffre-eras">Find your era</h2><button onClick={() => openCatalogue()}>Explore the archive <ArrowRight size={16} /></button></div>
        <div className="coffre-era-grid">{eras.map((era) => <button className="coffre-era" key={era.name} style={era.accent ? { '--era-accent': era.accent } as CSSProperties : undefined} onClick={() => openCatalogue(era.name)} onPointerEnter={() => { void loadEraFullNames() }}>
          <span className="coffre-era-cover"><ProgressiveCover src={era.cover} alt="" className="w-full h-full object-cover" /></span>
          <span><strong>{eraLabel(era.name, true)}</strong><small>{era.count.toLocaleString()} unreleased tracks</small></span><ArrowUpRight size={16} />
        </button>)}</div>
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
  </div>
}
