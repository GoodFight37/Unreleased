import { useEffect, useMemo, useRef, useState, CSSProperties, ReactNode } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import {
  X, Music2, Pencil, Flag,
  Clock, MicVocal, Music, Wrench, FileText, Piano, MapPin,
  Calendar, CalendarClock, CalendarDays, Droplets, Gauge, Layers,
  GitBranch, Info, StickyNote, Quote, Copy, Download, Loader2, LucideIcon, PictureInPicture2, Minimize2,
  Activity, Music4, ImagePlus, Clapperboard, ExternalLink, Play, FolderOpen, Star, SlidersHorizontal,
} from 'lucide-react'
import { useStore, useStorePick, IS_FLOAT_WINDOW } from '../store/useStore'
import { useDragToDismiss } from '../hooks/useDragToDismiss'
import { useCanEdit } from '../hooks/useChannelRoles'
import { attachToMainWindow, sendPlayerCommand } from '../lib/windowSync'
import { SongTruthLineLive } from './SongTruthLine'
import { JWApiSong, buildImageUrl, parseDuration, getSongById, loadAllSongs, resolvePrefCoverUrl } from '../lib/juicewrldApi'
import { isReleasedPath, loadMusicVideoIndex, videoFromPath, videosFor, VIDEO_KIND_LABEL, type MusicVideo } from '../lib/musicVideos'
import { clearMusicVideoDefault, getMusicVideoDefaults, onMusicVideoDefaultsChange, setMusicVideoDefault } from '../lib/musicVideoDefaultsApi'
import { openInFiles } from './SongContextMenu'
import MediaLightbox from './MediaLightbox'
import { versionsEnabled } from '../lib/versionsApi'
import { useVersionEntries } from '../hooks/useSongVersions'
import { formatDuration, displayDate } from '../lib/format'
import { copyCoverImage, saveCoverImage } from '../lib/coverImage'
import SongPrefsSection from './SongPrefsSection'
import { ProgressiveCover } from './ProgressiveCover'
import { loadSongFootage, footageBrowserOnly, type FootageMatch } from '../lib/footageIndex'
import { classifyFootageEntry, createAudibleVideoGate, excludedFootageReason, footageSourceOf } from '../lib/footageCatalog'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { firstRecordingLocation, sameDateAndStudio, songDates } from '../lib/onThisDay'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { glassPillButton } from './glassControls'
import { showAppToast } from '../lib/appToast'

// Shared with the Tracker: -700 shades on light themes, -400 on dark (lib/juicewrldApi).

function Section({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="group flex gap-3 p-3 rounded-2xl border border-[var(--border)] bg-[var(--fill)]/70 hover:bg-[var(--fill)] transition-colors">
      <div className="shrink-0 w-8 h-8 rounded-xl bg-[var(--fill-strong)]/70 border border-[var(--border)] flex items-center justify-center text-text-muted group-hover:text-text-primary transition-colors">
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1 select-none">{label}</p>
        <div className="select-text cursor-text">{children}</div>
      </div>
    </div>
  )
}

function GlassFactCard({ icon: Icon, label, primary, secondary }: {
  icon: LucideIcon
  label: string
  primary: string
  secondary?: string | null
}): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 p-3 rounded-2xl border border-[var(--border)] bg-[var(--fill)]/65">
      <div className="shrink-0 w-7 h-7 rounded-xl bg-[var(--fill-strong)]/65 border border-[var(--border)] flex items-center justify-center text-accent">
        <Icon size={13} strokeWidth={1.85} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted select-none">{label}</p>
        <p className="text-text-primary text-xs font-medium leading-snug mt-0.5 break-words select-text">{primary}</p>
        {secondary && (
          <p className="text-text-secondary text-[11px] leading-snug mt-0.5 break-words select-text">{secondary}</p>
        )}
      </div>
    </div>
  )
}

function TextSection({ icon, label, value, mono = false }: {
  icon: LucideIcon
  label: string
  value: string | null | undefined
  mono?: boolean
}): JSX.Element | null {
  if (!value) return null
  return (
    <Section icon={icon} label={label}>
      <p className={`text-text-primary leading-relaxed whitespace-pre-wrap ${mono ? 'text-[11px] font-mono' : 'text-xs'}`}>
        {value}
      </p>
    </Section>
  )
}

// A "Label: value" line inside a Section that holds several related fields.
function SubVal({ label, value }: { label: string; value: string | null | undefined }): JSX.Element | null {
  if (!value) return null
  return (
    <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">
      <span className="text-text-muted">{label}: </span>{value}
    </p>
  )
}

let activeFootageVideo: HTMLVideoElement | null = null
let suppressingGateStoreSync = false
const streamOf = (path: string, channel?: string): string => { const s = footageSourceOf(path, channel); return buildStreamUrl(s.path, s.channel || undefined) }

const songModalVideoGate = createAudibleVideoGate({
  isMusicPlaying: () => !!useStore.getState().isPlaying,
  setMusicPlaying: (playing) => {
    suppressingGateStoreSync = true
    try { useStore.getState().setIsPlaying(playing) } finally { suppressingGateStoreSync = false }
  },
  isRadioPlaying: () => {
    const s = useStore.getState()
    return s.radioFmActive && !s.radioFmPaused
  },
  setRadioPlaying: (playing) => {
    suppressingGateStoreSync = true
    try {
      const client = getActiveRadioClient()
      if (playing) {
        if (useStore.getState().radioFmActive) void client?.startListening().catch(() => {})
      } else {
        client?.stopListening()
      }
    } finally {
      suppressingGateStoreSync = false
    }
  },
  pauseActiveVideo: () => { if (activeFootageVideo && !activeFootageVideo.paused) activeFootageVideo.pause() },
})

function releaseFootage(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
  if (activeFootageVideo === video) activeFootageVideo = null
}

const FAMILY_BADGE_LABELS: Record<string, string> = {
  studio: 'Studio',
  freestyle: 'Freestyle',
  official: 'Official clip',
  snippet: 'Snippet',
}

function FootageSection({ song }: { song: JWApiSong }): JSX.Element {
  // Footage & primary snippets live on the primary archive channel ('').
  const channel = ''
  const isPlaying = useStore(s => s.isPlaying)
  const isRadioPlaying = useStore(s => s.radioFmActive && !s.radioFmPaused)
  const [approximate, setApproximate] = useState(false)
  const [matches, setMatches] = useState<FootageMatch[] | null>([])
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [active, setActive] = useState<FootageMatch | null>(null)
  const [browserOnly, setBrowserOnly] = useState<Set<string>>(new Set())
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!active || suppressingGateStoreSync) return
    const s = useStore.getState()
    if (s.isPlaying || (s.radioFmActive && !s.radioFmPaused)) songModalVideoGate.musicTouched()
  }, [active, isPlaying, isRadioPlaying])
  useEffect(() => {
    let stale = false
    setLoading(true)
    setActive(null)
    setMatches([])
    loadSongFootage(song.name, channel, approximate).then(result => {
      if (!stale) { setMatches(result); setLoading(false) }
    }).catch(() => { if (!stale) { setMatches(null); setLoading(false) } })
    return () => { stale = true }
  }, [song.id, song.name, channel, approximate, retry])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (activeFootageVideo && activeFootageVideo !== video) releaseFootage(activeFootageVideo)
    activeFootageVideo = video
    songModalVideoGate.videoWillPlay()
    return () => {
      releaseFootage(video)
      songModalVideoGate.videoDidClose()
    }
  }, [active])
  return (
    <Section icon={Clapperboard} label="Footage & Sessions">
      <label className="flex items-center gap-2 text-xs text-text-primary mb-3 cursor-pointer">
        <input type="checkbox" checked={approximate} onChange={e => setApproximate(e.target.checked)} />
        Show approximate matches
      </label>
      {loading ? <p className="text-xs text-text-primary" role="status">Looking for footage…</p>
        : matches === null ? <button className={glassPillButton(false)} onClick={() => setRetry(n => n + 1)}>Index unavailable · Retry</button>
        : matches.length === 0 ? <p className="text-xs text-text-primary">No matching footage found.</p>
        : <ul className="space-y-3 max-h-80 overflow-y-auto" aria-label="Matching footage">
          {matches.map(match => {
            const { entry } = match
            const rightsBlocked = excludedFootageReason(entry) === 'rights'
            const guarded = rightsBlocked || footageBrowserOnly(entry) || browserOnly.has(entry.path)
            const fam = classifyFootageEntry(entry)
            return <li key={entry.path} className="flex gap-3 items-start">
              {/* The song artwork is a fallback, never a downloaded video frame. */}
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--fill)] shrink-0" title="Song artwork">
                {song.image_url ? <img src={buildImageUrl(song.image_url) ?? undefined} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Clapperboard className="m-3 text-text-primary" size={24} />}
              </div>
              <div className="min-w-0 flex-1 text-xs text-text-primary">
                <p className="font-medium break-words">{entry.name}</p>
                <p className="mt-1">
                  {fam && FAMILY_BADGE_LABELS[fam] && (
                    <><span className="rounded px-1.5 py-0.5 bg-[var(--fill-strong)] font-semibold">{FAMILY_BADGE_LABELS[fam]}</span> · </>
                  )}
                  {entry.duration || 'Duration unavailable'} · <span className="rounded px-1 bg-[var(--fill)]">{match.level === 'exact' ? 'Exact' : `${match.confidence}%${match.level === 'approximate' ? ' · Approximate' : ''}`}</span>
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {!guarded && <button className={glassPillButton(active?.entry.path === entry.path)} onClick={() => setActive(active?.entry.path === entry.path ? null : match)}><Play size={12} />{active?.entry.path === entry.path ? 'Close video' : 'Watch here'}</button>}
                  {!rightsBlocked && <a href={streamOf(entry.path, channel)} target="_blank" rel="noopener noreferrer" className={glassPillButton(false)}><ExternalLink size={12} />Open in browser</a>}
                </div>
                {rightsBlocked ? <p className="mt-1">Not playable while its rights are being clarified.</p> : guarded && <p className="mt-1">Use your browser for this video.</p>}
              </div>
            </li>
          })}
        </ul>}
      {active && <video key={`${channel}:${active.entry.path}`} ref={videoRef} preload="none" controls playsInline
        aria-label={active.entry.name} src={streamOf(active.entry.path, channel)}
        className="w-full max-h-80 rounded-xl mt-3"
        onPlay={() => songModalVideoGate.videoWillPlay()}
        onLoadedMetadata={e => {
          if (!Number.isFinite(e.currentTarget.duration) || e.currentTarget.duration > 3600) {
            releaseFootage(e.currentTarget)
            setBrowserOnly(paths => new Set([...paths, active.entry.path]))
            setActive(null)
          }
        }}
        onError={() => { setBrowserOnly(paths => new Set([...paths, active.entry.path])); setActive(null) }}
      />}
    </Section>
  )
}

// The song's official videos in Files (Footage/Youtube): what WRLD plays in place of the visualizer. Listed by title,
// so for a song WRLD hasn't played yet this doesn't say whether a video's sound lines up; it nearly always does.
function MusicVideoSection({ song, onLeave }: { song: JWApiSong; onLeave: () => void }): JSX.Element | null {
  const [videos, setVideos] = useState<MusicVideo[]>([])
  const [watching, setWatching] = useState<number | null>(null)
  const isWatching = watching !== null
  const isPlaying = useStore(s => s.isPlaying)
  const isRadioPlaying = useStore(s => s.radioFmActive && !s.radioFmPaused)
  useEffect(() => {
    if (!isWatching) return
    songModalVideoGate.videoWillPlay()
    return () => songModalVideoGate.videoDidClose()
  }, [isWatching])
  useEffect(() => {
    if (!isWatching || suppressingGateStoreSync) return
    const s = useStore.getState()
    if (s.isPlaying || (s.radioFmActive && !s.radioFmPaused)) songModalVideoGate.musicTouched()
  }, [isWatching, isPlaying, isRadioPlaying])
  // The administrators' default for every player: a video's path, '' for no video, null for none set.
  const [serverDefault, setServerDefault] = useState<string | null>(null)
  const [defaultsTurn, setDefaultsTurn] = useState(0)
  useEffect(() => onMusicVideoDefaultsChange(() => setDefaultsTurn((n) => n + 1)), [])
  const isAdmin = useStore((s) => !!s.account?.is_administrator)
  const developerMode = useStore(s => s.developerMode)
  const released = song.category === 'released' && isReleasedPath(song.path)
  useEffect(() => {
    setVideos([])
    setServerDefault(null)
    if (!released || !song.path) return
    let live = true
    const songPath = song.path
    Promise.all([loadMusicVideoIndex(), getMusicVideoDefaults().catch(() => new Map<string, string>())])
      .then(([map, defaults]) => {
        if (!live) return
        const list = videosFor(map, song.name, 'all')
        const def = defaults.get(songPath) ?? null
        if (def && !list.some((v) => v.path === def)) list.unshift(videoFromPath(def))
        setVideos(list)
        setServerDefault(def)
      })
      .catch(() => { /* no section without the list */ })
    return () => { live = false }
  }, [song.name, song.path, released, defaultsTurn])
  if (!videos.length) return null

  // Optimistic: shown at once, put back with a note if the server says no.
  const setDefault = (next: string | null): void => {
    const before = serverDefault
    setServerDefault(next)
    const job = next === null ? clearMusicVideoDefault(song.id) : setMusicVideoDefault(song.id, next)
    job.then(() => showAppToast(next === null ? 'Back to the automatic video for everyone' : next === '' ? 'No video for everyone' : 'Default video for everyone set', { tone: 'info' }))
      .catch((err) => { setServerDefault(before); showAppToast(`Couldn’t change the default: ${err instanceof Error ? err.message : err}`) })
  }

  const showInFiles = (v: MusicVideo): void => {
    const at = { folder: v.path.split('/').slice(0, -1).join('/'), channel: useStore.getState().channels.find((c) => c.is_primary)?.slug ?? null }
    // A pop-out can't leave its page: the main window opens Files.
    if (IS_FLOAT_WINDOW) {
      sendPlayerCommand('open-in-files', at)
      ;(window as unknown as { electron?: { focusMainWindow?: () => void } }).electron?.focusMainWindow?.()
      return
    }
    openInFiles(at)
    onLeave()
  }
  const icon = 'shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors'
  return (
    <Section icon={Clapperboard} label={videos.length > 1 ? 'Music Videos' : 'Music Video'}>
      <div className="space-y-1">
        {videos.map((v, i) => (
          <div key={v.path} className="flex items-center gap-2 -mx-1.5 px-1.5 py-0.5 rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-xs truncate" title={v.path}>{v.path.split('/').pop()?.replace(/\.[^.]+$/, '')}</p>
              <p className="text-text-muted text-[11px]">{VIDEO_KIND_LABEL[v.kind]}{v.date ? ` · uploaded ${new Date(`${v.date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}</p>
            </div>
            {serverDefault === v.path && !isAdmin && <span className="shrink-0 text-[10.5px] font-semibold text-text-muted">Default</span>}
            {isAdmin && (
              <button
                onClick={() => setDefault(serverDefault === v.path ? null : v.path)}
                className={`${icon} ${serverDefault === v.path ? 'text-[var(--accent)] hover:text-[var(--accent)]' : ''}`}
                title={serverDefault === v.path ? 'The default for everyone - click to go back to the automatic pick' : 'Make this the video every player shows for this song'}
                aria-label="Default for everyone"
                aria-pressed={serverDefault === v.path}
              >
                <Star size={14} fill={serverDefault === v.path ? 'currentColor' : 'none'} />
              </button>
            )}
            <button onClick={() => setWatching(i)} className={icon} title="Watch" aria-label="Watch"><Play size={14} /></button>
            {developerMode && <button onClick={() => showInFiles(v)} className={icon} title="Show in Files" aria-label="Show in Files"><FolderOpen size={14} /></button>}
          </div>
        ))}
      </div>
      {serverDefault === '' && <p className="mt-1.5 text-text-muted text-[11px]">No video in WRLD for everyone: an administrator turned it off for this song.</p>}
      {isAdmin && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => setDefault(serverDefault === '' ? null : '')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${serverDefault === '' ? 'bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)]' : 'bg-[var(--fill)] text-text-muted hover:text-text-primary'}`}
            title="Every player shows the visualizer for this song instead of a video"
            aria-pressed={serverDefault === ''}
          >
            No video for everyone
          </button>
          {serverDefault !== null && (
            <button onClick={() => setDefault(null)} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--fill)] text-text-muted hover:text-text-primary transition-colors">
              Use the automatic pick
            </button>
          )}
        </div>
      )}
      {watching !== null && (
        <MediaLightbox
          items={videos.map((v) => ({ url: buildStreamUrl(v.path), type: 'video' as const, name: v.path.split('/').pop() ?? v.path }))}
          index={watching}
          onClose={() => setWatching(null)}
          onNav={setWatching}
        />
      )}
    </Section>
  )
}

interface Props {
  song: JWApiSong | null
  onClose: () => void
  onEdit?: (songId: number) => void
  // Rendered as the sole content of a pop-out BrowserWindow (see FloatApp):
  // the panel fills the window, the hero doubles as the drag handle, and
  // closing closes the OS window (via the caller's onClose).
  floating?: boolean
  // Explicitly render in-app and never auto-redirect to a float window, even
  // when the song-info pop-out is enabled. Used by the main window's global
  // host so "attach" docks here instead of bouncing straight back out.
  docked?: boolean
}

export default function SongInfoModal({ song, onClose, onEdit, floating = false, docked = false }: Props): JSX.Element | null {
  // Desktop: song info lives in its own pop-out window — every existing
  // in-app <SongInfoModal> caller redirects there instead of rendering the
  // overlay, unless the user disabled that pop-out. The overlay is the
  // fallback (and the only path on the web build, and for the pop-out itself,
  // which mounts this with floating=true).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron
  const popoutSongInfo = useStore((s) => s.popoutWindows.songInfo)
  const songPrefs = useStore((s) => s.songPrefs)
  const openReport = useStore((s) => s.openReport)
  const openCoverArtSubmit = useStore((s) => s.openCoverArtSubmit)
  const signedIn = useStore((s) => !!s.account)
  const redirectToFloat = !floating && !docked && !!el?.openFloatWindow && popoutSongInfo
  useEffect(() => {
    if (redirectToFloat && song) {
      el.openFloatWindow('song-info', { songId: song.id })
      onClose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectToFloat, song?.id])

  // Clicking a linked version swaps the displayed song in place, without the
  // caller needing to manage that - falls back to the `song` prop otherwise.
  const [overrideSong, setOverrideSong] = useState<JWApiSong | null>(null)
  useEffect(() => { setOverrideSong(null) }, [song?.id])
  // Rows from bulk fetches come with `?omit=lyrics,...` (see OMIT_BULK), so
  // the fields are absent rather than null - fetch the full song for those so
  // the lyrics section still shows. Rows that carry the field are used as-is.
  const [fullSong, setFullSong] = useState<JWApiSong | null>(null)
  useEffect(() => {
    setFullSong(null)
    if (!song || song.lyrics !== undefined) return
    let stale = false
    getSongById(song.id).then((s) => { if (!stale) setFullSong(s) }).catch(() => {})
    return () => { stale = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id])
  const displaySong = overrideSong ?? (fullSong && fullSong.id === song?.id ? fullSong : song)

  // "Other versions" - a separate database from juicewrldapi.com (see
  // lib/versionsApi.ts), since that API has no concept of grouping e.g.
  // "Song (v1)" / "(v2)" / "(TV Mix)" together as the same underlying song.
  // Linking/unlinking only happens from the editor (Edit song → Versions) -
  // this view is read-only. Same list and cache as Change version
  // (useVersionEntries), unplayable siblings included.
  const versionEntries = useVersionEntries(versionsEnabled && displaySong ? displaySong.id : null)
  const versions = useMemo(() => versionEntries.entries ?? [], [versionEntries.entries])
  const loadingVersions = versionEntries.loading

  const [sameDateStudioSongs, setSameDateStudioSongs] = useState<JWApiSong[]>([])
  const hasRecordedAndStudio = useMemo(() => {
    if (!displaySong) return false
    return !!firstRecordingLocation(displaySong.recording_locations)
      && songDates(displaySong).some((d) => d.kind === 'recorded')
  }, [displaySong])
  useEffect(() => {
    setSameDateStudioSongs([])
    if (!displaySong || !hasRecordedAndStudio) return
    let stale = false
    loadAllSongs()
      .then((all) => {
        if (!stale) setSameDateStudioSongs(sameDateAndStudio(displaySong, all))
      })
      .catch(() => {})
    return () => { stale = true }
  }, [displaySong, hasRecordedAndStudio])

  // Cover art actions (copy to clipboard / save to disk). `coverMsg` briefly
  // takes over the cover tile to report the outcome, since neither action
  // changes anything visible on its own.
  const [coverBusy, setCoverBusy] = useState<'copy' | 'save' | null>(null)
  const [coverMsg, setCoverMsg] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'lyrics' | 'footage' | 'details'>('overview')
  useEffect(() => { setActiveTab('overview') }, [song?.id])

  const handleViewVersion = async (id: number): Promise<void> => {
    try {
      const s = await getSongById(id)
      setOverrideSong(s)
    } catch { showAppToast("Couldn't load that version") }
  }

  // Swipe-down-to-dismiss on mobile, same curtain gesture as WRLD's full-
  // screen player. Only armed from the hero (cover/header) area - same
  // region the desktop drag-handle uses - so it doesn't fight the scrollable
  // info list below. dragY/dragging get handed to ModalOverlay so it can
  // translate the backdrop *with* the panel - otherwise the panel would slide
  // away while an opaque backdrop stayed put, hiding the app behind it until
  // the modal actually closed.
  // Called before the `!displaySong` early return below (hooks must run
  // unconditionally on every render) even though it's only used once we know
  // we're actually rendering the modal.
  const { dragY, dragging, handlers: dragHandlers } = useDragToDismiss(onClose)

  if (redirectToFloat || !displaySong) return null

  // The user's per-song override (custom name/cover). Subscribing to the whole
  // map keeps the hero in step when it's edited from the Personalize section
  // below (or another window) - the map's reference only changes on a write,
  // so this modal isn't re-rendering on unrelated store churn.
  const pref = songPrefs[displaySong.id]
  const apiCoverUrl = buildImageUrl(displaySong.image_url)
  const coverUrl = resolvePrefCoverUrl(pref?.cover_url) ?? apiCoverUrl
  const apiPrimaryTitle = displaySong.name
  const primaryTitle = pref?.name || apiPrimaryTitle
  // Every OTHER known title, not just track_titles[1:] - track_titles is an
  // unordered alias list, so its first entry isn't reliably the primary name
  // (see EditorPage's baseline() for the same mismatch). Excluding by value
  // rather than by index keeps a real alias from vanishing off this list just
  // because it happened to sort first.
  const altTitles = (displaySong.track_titles ?? []).filter(t => t && t !== apiPrimaryTitle)
  const duration = formatDuration(parseDuration(displaySong.length), '—')

  const hasInstrumentals = displaySong.instrumentals || displaySong.instrumental_names
  const hasSession = displaySong.session_titles || displaySong.session_tracking

  const flashCoverMsg = (msg: string): void => {
    setCoverMsg(msg)
    setTimeout(() => setCoverMsg(null), 1900)
  }

  const runCoverAction = async (kind: 'copy' | 'save'): Promise<void> => {
    if (!coverUrl || coverBusy) return
    setCoverBusy(kind)
    try {
      if (kind === 'copy') {
        await copyCoverImage(coverUrl)
        flashCoverMsg('Copied')
      } else if (await saveCoverImage(coverUrl, primaryTitle) === 'saved') {
        flashCoverMsg('Saved')
      }
    } catch {
      flashCoverMsg(kind === 'copy' ? "Couldn't copy" : "Couldn't save")
    } finally {
      setCoverBusy(null)
    }
  }

  let notesDisplay: string | null = null
  if (displaySong.notes) {
    try {
      const parsed = JSON.parse(displaySong.notes)
      if (typeof parsed === 'object' && parsed !== null) {
        notesDisplay = Object.entries(parsed)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      } else {
        notesDisplay = String(parsed)
      }
    } catch {
      notesDisplay = displaySong.notes
    }
  }

  const recordedDate = displaySong.record_dates?.trim() || null
  const recordedStudio = displaySong.recording_locations?.trim() || null
  const releaseOrLeakPrimary = displayDate(displaySong.release_date) || displayDate(displaySong.date_leaked) || null
  const releaseOrLeakLabel = displaySong.release_date ? 'Released' : 'Leaked'
  const releaseOrLeakSub = displaySong.release_date && displaySong.date_leaked
    ? `Leaked ${displayDate(displaySong.date_leaked)}`
    : displaySong.leak_type || null
  const hasLyrics = Boolean(displaySong.lyrics?.trim())

  return (
    <ModalOverlay
      onClose={onClose}
      floating={floating}
      zIndexClassName="z-[160]"
      panelClassName="modal-glass rounded-t-3xl md:rounded-3xl border border-[var(--border)] shadow-[0_32px_90px_rgba(0,0,0,0.6)] w-full md:max-w-2xl max-h-[88svh] md:max-h-[82vh]"
      minWidth={460} minHeight={440}
      dragY={dragY} dragging={dragging}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div
        className="select-text bg-[color-mix(in_srgb,var(--surface)_62%,transparent)] backdrop-blur-2xl ring-1 ring-inset ring-white/10 w-full flex-1 min-h-0 flex flex-col overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Translucent Liquid Glass Hero Header */}
        <div
          className="relative shrink-0 overflow-hidden border-b border-[var(--border)]"
          style={floating ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined}
          onMouseDown={onHandleMouseDown}
          {...dragHandlers}
        >
          {coverUrl && (
            <div
              className="pointer-events-none absolute inset-0 bg-cover bg-center scale-110 opacity-45"
              style={{
                backgroundImage: `url(${coverUrl})`,
                filter: 'blur(34px) saturate(1.4)',
                maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.35) 75%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.35) 75%, transparent 100%)',
              }}
            />
          )}
          <div
            className="absolute top-3.5 right-3.5 z-10 flex items-center gap-1.5"
            style={floating ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : undefined}
          >
            {!floating && canLock && (
              <LockToggle
                locked={locked}
                onClick={toggleLock}
                className={`w-7 h-7 flex items-center justify-center rounded-full backdrop-blur-md transition-colors ${
                  locked ? 'bg-accent/85 text-white' : 'bg-black/35 text-white/80 hover:text-white hover:bg-black/55'
                }`}
              />
            )}
            {!floating && el?.openFloatWindow && (
              <button
                onClick={() => { el.openFloatWindow('song-info', { songId: displaySong.id }); onClose() }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-black/35 text-white/80 hover:text-white hover:bg-black/55 backdrop-blur-md transition-colors"
                title="Open in a separate window"
              >
                <PictureInPicture2 size={13} />
              </button>
            )}
            {floating && (
              <button
                onClick={() => { attachToMainWindow({ view: 'song-info', songId: displaySong.id }); onClose() }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-black/35 text-white/80 hover:text-white hover:bg-black/55 backdrop-blur-md transition-colors"
                title="Dock into main window"
              >
                <Minimize2 size={13} />
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => { onEdit(displaySong.id); onClose() }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-black/35 text-white/80 hover:text-white hover:bg-black/55 backdrop-blur-md transition-colors"
                title="Edit song info"
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              onClick={onClose}
              title="Close"
              className="w-7 h-7 flex items-center justify-center rounded-full bg-black/35 text-white/80 hover:text-white hover:bg-black/55 backdrop-blur-md transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          <div className="relative flex items-center gap-4 px-5 pt-6 pb-4">
            <div className="relative shrink-0 w-[84px] h-[84px] rounded-2xl overflow-hidden shadow-[0_14px_34px_rgba(0,0,0,0.45)] border border-white/15 bg-[var(--fill)]">
              {coverUrl ? (
                <ProgressiveCover src={coverUrl} alt={primaryTitle} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music2 size={28} className="text-text-muted opacity-35" />
                </div>
              )}
              {coverUrl && (coverMsg ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-1 text-center">
                  <span className="text-white text-[10px] font-semibold">{coverMsg}</span>
                </div>
              ) : (
                <div
                  className="absolute bottom-1 right-1 flex items-center gap-1"
                  style={floating ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : undefined}
                >
                  <button
                    onClick={() => runCoverAction('copy')}
                    disabled={!!coverBusy}
                    className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/55 text-white hover:bg-black/75 disabled:opacity-50 transition-colors"
                    title="Copy cover image"
                  >
                    {coverBusy === 'copy' ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />}
                  </button>
                  <button
                    onClick={() => runCoverAction('save')}
                    disabled={!!coverBusy}
                    className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/55 text-white hover:bg-black/75 disabled:opacity-50 transition-colors"
                    title="Save cover image"
                  >
                    {coverBusy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex-1 min-w-0 pr-20">
              <h2 className="text-text-primary font-extrabold text-xl leading-tight truncate">{primaryTitle}</h2>
              <SongTruthLineLive song={displaySong} className="mt-1" />
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {displaySong.era?.name && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--fill-strong)]/70 text-text-primary border border-[var(--border)]">
                    {displaySong.era.name}
                  </span>
                )}
                {!!parseDuration(displaySong.length) && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--fill)] text-text-secondary border border-[var(--border)]">
                    <Clock size={9} /> {duration}
                  </span>
                )}
                {!!String(displaySong.bpm ?? '').trim() && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--fill)] text-text-secondary border border-[var(--border)]">
                    <Activity size={9} /> {String(displaySong.bpm).trim()} BPM
                  </span>
                )}
                {!!String(displaySong.key ?? '').trim() && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--fill)] text-text-secondary border border-[var(--border)]">
                    <Music4 size={9} /> {String(displaySong.key).trim()}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Clean segmented glass tabs so every view fits without endless scrolling */}
          <div
            className="relative flex items-center gap-1.5 px-5 pb-3.5"
            role="tablist"
            aria-label="Song details sections"
            style={floating ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : undefined}
          >
            {([
              { id: 'overview', label: 'Overview', show: true },
              { id: 'lyrics', label: 'Lyrics', show: hasLyrics },
              { id: 'footage', label: 'Footage', show: true },
              { id: 'details', label: 'Details & Edit', show: true },
            ] as const).filter((t) => t.show).map((tab) => {
              const selected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    selected
                      ? 'bg-[var(--fill-strong)] text-text-primary border border-[var(--border)] shadow-sm'
                      : 'text-text-secondary hover:text-text-primary hover:bg-[var(--fill)] border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab body */}
        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-3">
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <GlassFactCard
                  icon={MicVocal}
                  label="Artist"
                  primary={displaySong.credited_artists || 'Juice WRLD'}
                />
                {displaySong.producers && (
                  <GlassFactCard icon={Music} label="Produced by" primary={displaySong.producers} />
                )}
                {(recordedDate || recordedStudio) && (
                  <GlassFactCard
                    icon={recordedDate ? Calendar : MapPin}
                    label="Recorded"
                    primary={recordedDate || recordedStudio || ''}
                    secondary={recordedDate && recordedStudio ? recordedStudio : null}
                  />
                )}
                {releaseOrLeakPrimary && (
                  <GlassFactCard
                    icon={displaySong.release_date ? CalendarDays : Droplets}
                    label={releaseOrLeakLabel}
                    primary={releaseOrLeakPrimary}
                    secondary={releaseOrLeakSub}
                  />
                )}
              </div>

              {(displaySong.additional_information || notesDisplay) && (
                <div className="p-3.5 rounded-2xl border border-[var(--border)] bg-[var(--fill)]/65 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted flex items-center gap-1.5 select-none">
                    <Info size={11} className="text-accent" /> Behind the track
                  </p>
                  {displaySong.additional_information && (
                    <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">
                      {displaySong.additional_information}
                    </p>
                  )}
                  {notesDisplay && (
                    <p className="text-text-secondary text-xs leading-relaxed whitespace-pre-wrap">
                      {notesDisplay}
                    </p>
                  )}
                </div>
              )}

              {versionsEnabled && !loadingVersions && versions.length > 0 && (
                <div className="p-3.5 rounded-2xl border border-[var(--border)] bg-[var(--fill)]/65">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted flex items-center gap-1.5 mb-2 select-none">
                    <GitBranch size={11} className="text-accent" /> Other versions ({versions.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {versions.map(({ song: v, meta }) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleViewVersion(v.id)}
                        className="px-2.5 py-1.5 rounded-xl bg-[var(--fill)] hover:bg-[var(--fill-strong)] border border-[var(--border)] text-left text-xs text-text-primary transition-colors"
                      >
                        <span className="font-medium">{v.name}</span>
                        {(meta.version || meta.versionTitle) && (
                          <span className="text-text-muted ml-1">
                            ({meta.version}{meta.version && meta.versionTitle ? ' · ' : ''}{meta.versionTitle})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sameDateStudioSongs.length > 0 && (
                <div className="p-3.5 rounded-2xl border border-[var(--border)] bg-[var(--fill)]/65">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted flex items-center gap-1.5 mb-2 select-none">
                    <MapPin size={11} className="text-accent" /> Same studio & date
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {sameDateStudioSongs.slice(0, 8).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleViewVersion(s.id)}
                        className="px-2.5 py-1 rounded-full bg-[var(--fill)] hover:bg-[var(--fill-strong)] border border-[var(--border)] text-xs text-text-primary transition-colors"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActiveTab('details')}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                >
                  <SlidersHorizontal size={12} /> Personalize & archive details →
                </button>
                <button
                  type="button"
                  onClick={() => openReport({ kind: 'song', songId: displaySong.id, songName: apiPrimaryTitle })}
                  className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                >
                  <Flag size={11} /> Report info
                </button>
              </div>
            </>
          )}

          {activeTab === 'lyrics' && hasLyrics && (
            <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--fill)]/60">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-3 select-none">
                <Quote size={11} className="text-accent" /> Lyrics
              </div>
              <pre className="text-text-primary text-[13px] leading-[1.75] whitespace-pre-wrap font-sans select-text">
                {displaySong.lyrics}
              </pre>
            </div>
          )}

          {activeTab === 'footage' && (
            <div className="space-y-3">
              <FootageSection key={displaySong.id} song={displaySong} />
              <MusicVideoSection song={displaySong} onLeave={onClose} />
            </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-2.5">
              <SongPrefsSection
                songId={displaySong.id}
                apiTitle={apiPrimaryTitle}
                apiImageUrl={apiCoverUrl}
                ownImageRaw={displaySong.image_url}
                ownHasFile={!!displaySong.path}
                versions={versions}
                altTitles={altTitles}
              />

              <TextSection icon={Wrench} label="Engineer(s)" value={displaySong.engineers} />
              {hasInstrumentals && (
                <Section icon={Piano} label="Instrumental Name(s)">
                  <div className="space-y-0.5">
                    {displaySong.instrumentals && (
                      <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">{displaySong.instrumentals}</p>
                    )}
                    {displaySong.instrumental_names && displaySong.instrumental_names !== displaySong.instrumentals && (
                      <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">{displaySong.instrumental_names}</p>
                    )}
                  </div>
                </Section>
              )}
              <TextSection icon={CalendarClock} label="Preview Date" value={displayDate(displaySong.preview_date)} />
              <TextSection icon={CalendarDays} label="Other Date(s)" value={displaySong.dates} />
              <TextSection icon={Gauge} label="Bitrate" value={displaySong.bitrate} />
              {hasSession && (
                <Section icon={Layers} label="Session">
                  <div className="space-y-0.5">
                    <SubVal label="Titles" value={displaySong.session_titles} />
                    <SubVal label="Tracking" value={displaySong.session_tracking} />
                  </div>
                </Section>
              )}
              {displaySong.file_names && (
                <Section icon={FileText} label="File Name(s)">
                  <p className="text-text-primary text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                    {displaySong.file_names}
                  </p>
                </Section>
              )}
              <TextSection icon={StickyNote} label="Raw Notes" value={notesDisplay} />

              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => openReport({ kind: 'song', songId: displaySong.id, songName: apiPrimaryTitle })}
                  className="flex-1 min-w-[180px] flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--fill)] text-text-secondary hover:text-text-primary hover:bg-[var(--fill-strong)] transition-colors text-xs font-medium"
                >
                  <Flag size={13} /> Report info / lyrics
                </button>
                {signedIn && (
                  <button
                    onClick={() => openCoverArtSubmit({ songId: displaySong.id, songName: apiPrimaryTitle, currentCover: displaySong.image_url })}
                    className="flex-1 min-w-[160px] flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--fill)] text-text-secondary hover:text-text-primary hover:bg-[var(--fill-strong)] transition-colors text-xs font-medium"
                  >
                    <ImagePlus size={13} /> Submit cover art
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}

// Main-window-only host for the docked song-info modal. Renders nothing until
// something sets `infoSongId` (only the "attach" flow does — a floating
// song-info window asking to dock back in), then fetches that song and shows
// the modal in-app. `docked` keeps it from bouncing straight back out to a
// float window when the song-info pop-out is enabled.
export function GlobalSongInfoHost(): JSX.Element | null {
  const { infoSongId, setInfoSongId } = useStorePick('infoSongId', 'setInfoSongId')
  const [song, setSong] = useState<JWApiSong | null>(null)

  useEffect(() => {
    if (infoSongId == null) { setSong(null); return }
    let stale = false
    getSongById(infoSongId).then((s) => { if (!stale) setSong(s) }).catch(() => {})
    return () => { stale = true }
  }, [infoSongId])

  const canEdit = useCanEdit()

  if (infoSongId == null || !song) return null
  return (
    <SongInfoModal
      song={song}
      onClose={() => setInfoSongId(null)}
      onEdit={canEdit ? (id) => useStore.getState().openSongEditor(id) : undefined}
    />
  )
}
