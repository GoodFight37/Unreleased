import { useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, Disc3, Music2, Play } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import type { useHomeData } from '../hooks/useHomeData'
import { useCanEdit } from '../hooks/useChannelRoles'
import { buildImageUrl, songToTrack } from '../lib/juicewrldApi'
import { ERA_LOOK } from '../lib/eraLook'
import { saveTrackerSearch } from '../lib/apiTrackerShared'
import { eraLabel, loadEraFullNames } from '../lib/eras'
import { trackIdToSongId } from '../lib/userApi'
import { lazyOverlay } from '../lib/lazyView'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import type { Track } from '../types'
import type { SongContextMenuState } from './SongContextMenu'

const SongContextMenu = lazyOverlay(() => import('./SongContextMenu'))

export default function CoffreHome({ data }: { data: ReturnType<typeof useHomeData> }): JSX.Element {
  const { currentTrack, playTrack, playNext, setActiveView, setApiTrackerCategory, setApiTrackerEra, setApiTrackerTab } = useStorePick(
    'currentTrack', 'playTrack', 'playNext', 'setActiveView', 'setApiTrackerCategory', 'setApiTrackerEra', 'setApiTrackerTab')
  const [context, setContext] = useState<SongContextMenuState | null>(null)
  const canEdit = useCanEdit()
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
  const eras = useMemo(() => {
    const groups = new Map<string, { name: string; cover: string | undefined; count: number }>()
    for (const song of available) {
      const name = song.era?.name
      if (!name) continue
      const group = groups.get(name)
      if (group) group.count++
      else groups.set(name, { name, cover: buildImageUrl(ERA_LOOK[name]?.art ?? song.image_url), count: 1 })
    }
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 4)
  }, [available])
  const openCatalogue = (era = ''): void => {
    saveTrackerSearch('')
    setApiTrackerCategory('unreleased')
    setApiTrackerEra(era)
    setApiTrackerTab('songs')
    setActiveView('api-tracker')
  }
  const openContext = (track: Track, event: React.MouseEvent): void => {
    event.preventDefault()
    setContext({ track, songId: trackIdToSongId(track.id), x: event.clientX, y: event.clientY })
  }
  return <div className="coffre-home glass-scroll pb-player">
    <div className="coffre-home-inner">
      <section className="coffre-hero" aria-label="Discover Juice WRLD">
        <div className="coffre-hero-copy">
          <h1>Beyond<br />the albums.</h1>
          <p>Unreleased tracks, sessions and other versions.<br />A different way into Juice WRLD’s world.</p>
          <button className="coffre-primary" onClick={() => openCatalogue()}>Explore the unreleased <ArrowUpRight size={17} /></button>
        </div>
        <button className="coffre-hero-art" onClick={() => hero ? playTrack(hero) : openCatalogue()}
          aria-label={hero ? `Play ${hero.title}` : 'Explore the catalogue'} onContextMenu={hero ? (event) => openContext(hero, event) : undefined}>
          {hero ? <AlbumArtThumbnail track={hero} fill eager res={768} className="coffre-hero-cover" /> : <Disc3 size={110} aria-hidden />}
          <span className="coffre-art-caption"><span>{hero?.title ?? 'Juice WRLD'}<small>{hero?.era ?? 'The unreleased archive'}</small></span><span className="coffre-999">999</span></span>
        </button>
      </section>

      <section aria-labelledby="coffre-resume">
        <div className="coffre-section-heading"><h2 id="coffre-resume">{resume.length ? 'Continue listening' : 'From the vault'}</h2>
          <button onClick={() => setActiveView('library')}>Your collection <ArrowRight size={16} /></button></div>
        {row.length ? <div className="coffre-cover-row">{row.map((track) => <button className="coffre-cover-card" key={track.id}
          onClick={() => playTrack(track, row)} onContextMenu={(event) => openContext(track, event)} aria-label={`Play ${track.title}`}>
          <span className="coffre-cover"><AlbumArtThumbnail track={track} fill eager res={320} className="w-full h-full object-contain" /><span className="coffre-card-play"><Play size={19} fill="currentColor" /></span></span>
          <strong>{track.title}</strong><span>{track.era ?? track.artist}</span>
        </button>)}</div> : <div className="coffre-empty"><Music2 size={27} /><p>Your listening will appear here. Explore the catalogue to find your first track.</p><button onClick={() => openCatalogue()}>Open catalogue <ArrowRight size={16} /></button></div>}
      </section>

      {eras.length > 0 && <section aria-labelledby="coffre-eras">
        <div className="coffre-section-heading"><h2 id="coffre-eras">Find your era</h2><button onClick={() => openCatalogue()}>Explore the archive <ArrowRight size={16} /></button></div>
        <div className="coffre-era-grid">{eras.map((era) => <button className="coffre-era" key={era.name} onClick={() => openCatalogue(era.name)} onPointerEnter={() => { void loadEraFullNames() }}>
          <span className="coffre-era-cover"><ProgressiveCover src={era.cover} alt="" className="w-full h-full object-contain" /></span>
          <span><strong>{eraLabel(era.name, true)}</strong><small>{era.count.toLocaleString()} unreleased tracks</small></span><ArrowUpRight size={16} />
        </button>)}</div>
      </section>}

      {data.albumRow.length > 0 && <section aria-labelledby="coffre-albums">
        <div className="coffre-section-heading"><h2 id="coffre-albums">The albums, too</h2><button onClick={() => setActiveView('albums')}>All albums <ArrowRight size={16} /></button></div>
        <div className="coffre-album-row">{data.albumRow.slice(0, 5).map((album) => <button key={album.key} className="coffre-cover-card" onClick={album.open}>
          <span className="coffre-cover"><ProgressiveCover src={album.cover} alt="" className="w-full h-full object-contain" /></span><strong>{album.title}</strong><span>{album.subtitle}</span>
        </button>)}</div>
      </section>}
    </div>
    {context && <SongContextMenu state={context} onClose={() => setContext(null)} canEdit={canEdit}
      onInfo={() => context.songId != null && useStore.getState().setInfoSongId(context.songId)}
      onPlay={() => playTrack(context.track)} onPlayNext={() => playNext(context.track)} />}
  </div>
}
