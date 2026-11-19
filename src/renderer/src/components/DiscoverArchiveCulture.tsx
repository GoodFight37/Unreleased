import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Camera, Disc3, Play, RefreshCw, Sparkles, Star } from 'lucide-react'
import { getFeaturedArchivePhotos, type ArchivePhoto } from '../lib/archivePhotos'
import { buildImageUrl, songToTrack, type JWApiSong } from '../lib/juicewrldApi'
import { saveTrackerSearch } from '../lib/apiTrackerShared'
import { useStore } from '../store/useStore'
import AlbumThemeStrip from './AlbumThemeStrip'
import { ProgressiveCover } from './ProgressiveCover'
import type { Track } from '../types'

const ICONIC_PRODUCERS = [
  { name: 'Nick Mira', note: 'Melodic & GB&GR' },
  { name: 'Maxlord', note: 'JW3 & Vault' },
  { name: 'DT', note: 'Hype & 808s' },
  { name: 'Metro Boomin', note: 'Dark & Moody' },
  { name: 'Wheezy', note: 'WOD & Trap' },
  { name: '808 Mafia', note: 'Hard Unreleased' },
  { name: 'Rex Kudo', note: 'Rockstar & Melodic' },
  { name: 'Take a Daytrip', note: 'Anthems' },
] as const

/** Compact album strip shown inline on narrow screens (< 1280px) in Spatial mode where the top-left pill hides. */
export function DiscoverTopBar(): JSX.Element | null {
  const interfaceStyle = useStore((s) => s.interfaceStyle)
  if (interfaceStyle === 'editorial') return null
  return (
    <div className="flex xl:hidden flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-text-muted">Album theme</span>
        <AlbumThemeStrip compact />
      </div>
    </div>
  )
}

/** Real Juice WRLD photography backdrop for the Discover Hero (from Others/Photos/2018–2019).
 *  Ensures the hero is never an empty black void while giving authentic archival presence. */
export function DiscoverArchiveBackdrop({
  onOpenPhotos,
  showControls = true,
}: {
  onOpenPhotos: () => void
  showControls?: boolean
}): JSX.Element | null {
  const [photos, setPhotos] = useState<ArchivePhoto[]>([])
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getFeaturedArchivePhotos().then((list) => {
      if (!cancelled && list.length > 0) {
        setPhotos(list)
        // Pick a fresh daily photo deterministically so it feels curated, not random flicker.
        const daySeed = Math.floor(Date.now() / 86_400_000) % list.length
        setIdx(daySeed)
      }
    })
    return () => { cancelled = true }
  }, [])

  const photo = photos[idx]
  if (!photo) return null

  return (
    <>
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
        <img
          key={photo.path}
          src={photo.thumbUrl}
          alt=""
          className="w-full h-full object-cover object-[50%_22%] opacity-75 scale-[1.01] transition-opacity duration-500"
          style={{ filter: 'contrast(1.05) saturate(0.92)' }}
          onError={(e) => {
            if (e.currentTarget.src !== photo.fullUrl) e.currentTarget.src = photo.fullUrl
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(95deg, rgba(6,6,8,0.88) 0%, rgba(6,6,8,0.62) 48%, rgba(6,6,8,0.72) 100%)',
          }}
        />
      </div>
      {showControls && (
        <div className="absolute top-3 right-4 z-20 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenPhotos}
            title="Open Juice WRLD Photo Archive"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 hover:bg-black/70 border border-white/15 text-[10px] font-mono-ui tracking-wider text-white/85 backdrop-blur-md transition-colors"
          >
            <Camera size={11} />
            <span>{photo.caption}</span>
          </button>
          {photos.length > 1 && (
            <button
              type="button"
              onClick={() => setIdx((n) => (n + 1) % photos.length)}
              title="Next archive photo"
              aria-label="Next archive photo"
              className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 border border-white/15 text-white/80 hover:text-white backdrop-blur-md transition-colors"
            >
              <RefreshCw size={11} />
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** Producer DNA exploration strip + Your Grails shelf + One-Take Studio Sessions shortcut. */
export function DiscoverVaultCulture({
  catalogue,
  onPlayTrack,
}: {
  catalogue: ReadonlyArray<JWApiSong>
  onPlayTrack: (track: Track, context?: Track[]) => void
}): JSX.Element {
  const grailSongIds = useStore((s) => s.grailSongIds)
  const toggleGrailSong = useStore((s) => s.toggleGrailSong)
  const setApiTrackerCategory = useStore((s) => s.setApiTrackerCategory)
  const setApiTrackerEra = useStore((s) => s.setApiTrackerEra)
  const setApiTrackerTab = useStore((s) => s.setApiTrackerTab)
  const setActiveView = useStore((s) => s.setActiveView)

  const grailSongs = useMemo(() => {
    if (grailSongIds.length === 0 || catalogue.length === 0) return []
    const byId = new Map(catalogue.map((s) => [s.id, s]))
    return grailSongIds.map((id) => byId.get(id)).filter((s): s is JWApiSong => !!s)
  }, [grailSongIds, catalogue])

  const openProducer = (name: string): void => {
    saveTrackerSearch(`producer:"${name}"`)
    setApiTrackerCategory('')
    setApiTrackerEra('')
    setApiTrackerTab('songs')
    setActiveView('api-tracker')
  }

  const openSessions = (): void => {
    saveTrackerSearch('')
    setApiTrackerCategory('recording_session')
    setApiTrackerEra('')
    setApiTrackerTab('songs')
    setActiveView('api-tracker')
  }

  return (
    <div className="space-y-8">
      {grailSongs.length > 0 && (
        <section className="coffre-reveal" aria-labelledby="coffre-grails-head">
          <div className="coffre-section-heading">
            <div className="flex items-center gap-2">
              <Star size={16} className="text-accent" fill="currentColor" />
              <h2 id="coffre-grails-head">Your Grails</h2>
            </div>
            <span className="font-mono-ui text-[11px] text-text-muted">{grailSongs.length} pinned</span>
          </div>
          <div className="coffre-cover-row">
            {grailSongs.map((song) => {
              const playable = !!song.path
              const track = songToTrack(song)
              const queue = grailSongs.filter((s) => !!s.path).map(songToTrack)
              return (
                <div key={song.id} className="coffre-cover-card relative group">
                  <button
                    type="button"
                    className="text-left w-full"
                    onClick={() => (playable ? onPlayTrack(track, queue) : useStore.getState().setInfoSongId(song.id))}
                  >
                    <span className="coffre-cover">
                      <ProgressiveCover src={buildImageUrl(song.image_url)} alt="" className="w-full h-full object-cover" />
                      {playable && <span className="coffre-card-play"><Play size={17} fill="currentColor" /></span>}
                    </span>
                    <strong>{song.name}</strong>
                    <span>{song.era?.name ?? 'Vault'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleGrailSong(song.id)}
                    title="Unpin Grail"
                    aria-label={`Unpin ${song.name} from Grails`}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/55 text-accent opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Star size={12} fill="currentColor" />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="coffre-reveal" aria-labelledby="coffre-producers-head">
        <div className="coffre-section-heading">
          <div>
            <h2 id="coffre-producers-head">Producer DNA</h2>
            <p className="text-xs text-text-secondary mt-0.5">Explore the studio chemistry behind Juice WRLD’s vault.</p>
          </div>
          <button type="button" onClick={openSessions}>
            <Sparkles size={14} /> Studio Sessions (One-Take) <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {ICONIC_PRODUCERS.map((prod) => (
            <button
              key={prod.name}
              type="button"
              onClick={() => openProducer(prod.name)}
              className="group flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--fill)] hover:bg-[var(--fill-strong)] hover:border-[var(--accent)] text-left transition-all"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary truncate">{prod.name}</span>
                <span className="block text-[11px] text-text-muted truncate">{prod.note}</span>
              </span>
              <Disc3 size={15} className="shrink-0 text-text-muted group-hover:text-accent transition-colors" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
