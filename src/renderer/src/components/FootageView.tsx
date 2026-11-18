import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Play, Search, X } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { loadFileIndex, parseFileQuery, peekFileIndex, searchFileIndex, type FileIndex } from '../lib/fileSearch'
import { buildImageUrl, buildStreamUrl, loadAllSongs, type JWApiFileEntry, type JWApiSong } from '../lib/juicewrldApi'
import {
  buildFootageSongIndex,
  classifyFootageEntry,
  excludedFootageReason,
  FOOTAGE_AUDIO_REPLACEMENTS,
  linkFootageToCatalogue,
  parseFreestyleName,
  scoreStudioFootage,
} from '../lib/footageCatalog'
import { parseVideoName } from '../lib/musicVideos'
import { ERA_LOOK } from '../lib/eraLook'
import { eraLabel } from '../lib/eras'
import { liveVisualsAllowed } from '../lib/effectsPreference'
import { saveTrackerSearch } from '../lib/apiTrackerShared'
import {
  cleanFootageDisplayTitle,
  FootageFamilyChip,
  FootagePlayerModal,
  FootageTile,
  formatVideoSeconds,
  releaseVideoStream,
  stopActiveHoverPreview,
  useVideoPosterFrame,
  type FootageTileItem,
} from './FootageTile'
import { ProgressiveCover } from './ProgressiveCover'

type FootageTabId = 'studio' | 'official' | 'snippet'

const ERA_KEY_BY_NUMBER: Record<number, string> = {
  1: 'jute',
  2: 'afflictions',
  3: 'HIH 999',
  4: 'jw 999',
  5: 'bdm',
  6: 'ND',
  7: 'GB&GR',
  8: 'WOD',
  9: 'DRFL',
  10: 'OUT',
  11: 'POST',
}

/** Shows a page of tiles and grows by one page on demand, so a few hundred videos are never mounted (or fetched) at once. */
function PagedGrid({
  items,
  pageSize = 24,
  className = 'coffre-vt-grid',
  render,
}: {
  items: FootageTileItem[]
  pageSize?: number
  className?: string
  render: (item: FootageTileItem) => JSX.Element
}): JSX.Element {
  const [count, setCount] = useState(pageSize)
  useEffect(() => setCount(pageSize), [items, pageSize])
  const left = items.length - count
  return (
    <>
      <div className={className}>{items.slice(0, count).map(render)}</div>
      {left > 0 && (
        <div className="coffre-more">
          <button type="button" className="coffre-secondary" onClick={() => setCount((c) => c + pageSize)}>
            Show {Math.min(left, pageSize).toLocaleString()} more · {left.toLocaleString()} left
          </button>
        </div>
      )}
    </>
  )
}

function FeaturedFootageBanner({
  item,
  channel,
  onWatch,
}: {
  item: FootageTileItem
  channel: string
  onWatch: (item: FootageTileItem, startAt: number, triggerEl: HTMLElement | null) => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const intentRef = useRef<number | null>(null)
  const wantRef = useRef(false)
  const playedRef = useRef(false)

  const { shape, durationSec, windowRef, posterState } = useVideoPosterFrame(
    videoRef,
    canvasRef,
    item.path,
    item.streamChannel ?? channel,
    true,
    undefined,
    1280,
  )

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
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
      }
    }
    v.addEventListener('timeupdate', onTimeUpdate)
    return () => v.removeEventListener('timeupdate', onTimeUpdate)
  }, [])

  const stopBannerPreview = (): void => {
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
  }

  const handleMouseEnter = (): void => {
    if (!liveVisualsAllowed()) return
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return
    wantRef.current = true
    if (intentRef.current !== null) window.clearTimeout(intentRef.current)
    intentRef.current = window.setTimeout(() => {
      const v = videoRef.current
      if (!wantRef.current || !v || !liveVisualsAllowed()) return
      stopActiveHoverPreview()
      v.dataset.hover = '1'
      const startPlay = (): void => {
        if (!wantRef.current || !liveVisualsAllowed()) return
        playedRef.current = true
        v.style.opacity = '1'
        v.play().then(() => {
          if (wantRef.current) btnRef.current?.classList.add('is-playing')
          else stopBannerPreview()
        }).catch(() => {})
      }
      if (!v.getAttribute('src')) {
        v.preload = 'metadata'
        v.src = buildStreamUrl(item.path, (item.streamChannel ?? channel) || undefined)
        v.addEventListener('loadedmetadata', startPlay, { once: true })
      } else if (v.readyState >= 3) {
        startPlay()
      } else {
        v.addEventListener('canplay', startPlay, { once: true })
      }
    }, 300)
  }

  const displayDuration = item.duration || (durationSec && durationSec > 0 ? formatVideoSeconds(durationSec) : null)

  return (
    <button
      ref={btnRef}
      type="button"
      className="coffre-vt coffre-fbanner"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={stopBannerPreview}
      onClick={() => {
        stopBannerPreview()
        onWatch(item, windowRef.current.start, btnRef.current?.querySelector('.coffre-vt-frame') as HTMLElement | null)
      }}
    >
      <div className={`coffre-vt-frame${posterState === 'failed' ? ' is-failed' : posterState !== 'ready' ? ' is-loading' : ''}`}>
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
        <div className="coffre-fbanner-shade" aria-hidden="true" />
        <span className="coffre-vt-badge">
          <FootageFamilyChip family={item.family} />
        </span>
        <span className="coffre-vt-play" aria-hidden="true">
          <Play size={18} fill="currentColor" />
        </span>
        <div className="coffre-fbanner-over">
          <div className="min-w-0">
            <h2>{cleanFootageDisplayTitle(item.title)}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="coffre-chip">Today&apos;s pick</span>
              {displayDuration && <span className="coffre-chip">{displayDuration}</span>}
            </div>
          </div>
          <span className="coffre-primary shrink-0">
            <Play size={15} fill="currentColor" /> Watch
          </span>
        </div>
      </div>
    </button>
  )
}

export default function FootageView(): JSX.Element {
  const {
    setActiveView,
    setApiTrackerCategory,
    setApiTrackerEra,
    setApiTrackerTab,
  } = useStorePick(
    'setActiveView',
    'setApiTrackerCategory',
    'setApiTrackerEra',
    'setApiTrackerTab',
  )
  // Studio footage, freestyles, official clips and primary snippets live on the primary channel ('').
  const channel = ''
  const [tab, setTab] = useState<FootageTabId>('studio')
  const [selectedEraFolder, setSelectedEraFolder] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [fileIndex, setFileIndex] = useState<FileIndex | null>(() => peekFileIndex(channel))
  const [songs, setSongs] = useState<JWApiSong[]>([])
  const [loading, setLoading] = useState(() => !peekFileIndex(channel))
  const [watching, setWatching] = useState<{ item: FootageTileItem; startAt: number } | null>(null)

  useEffect(() => {
    let stale = false
    setLoading(true)
    Promise.all([
      loadFileIndex(channel).catch(() => null),
      loadAllSongs().catch(() => [] as JWApiSong[]),
    ]).then(([idx, allSongs]) => {
      if (stale) return
      setFileIndex(idx)
      setSongs(allSongs)
      setLoading(false)
    })
    return () => {
      stale = true
      stopActiveHoverPreview()
    }
  }, [channel])

  const songIndex = useMemo(() => buildFootageSongIndex(songs), [songs])

  const catalogued = useMemo(() => {
    const studioRoot: FootageTileItem[] = []
    const freestyles: FootageTileItem[] = []
    const official: FootageTileItem[] = []
    const snippetFolders = new Map<string, {
      eraFolder: string
      eraKey: string | null
      clips: FootageTileItem[]
      songFolders: Set<string>
      exactSongFolders: Set<string>
    }>()
    let snippetClipsCount = 0
    const allSnippetSongFolders = new Set<string>()

    if (!fileIndex) {
      return {
        featured: [] as FootageTileItem[],
        studioMore: [] as FootageTileItem[],
        freestyles,
        official,
        snippetEras: [] as { eraFolder: string; eraKey: string | null; clips: FootageTileItem[]; songCount: number; exactCount: number }[],
        counts: { studioVideos: 0, freestyles: 0, officialClips: 0, snippetClips: 0, snippetSongs: 0 },
      }
    }

    const webpByStem = new Map<string, string>()
    for (const { entry } of fileIndex.items) {
      if (/^Footage\/Youtube\//i.test(entry.path) && /\.webp$/i.test(entry.path)) {
        webpByStem.set(entry.path.replace(/\.webp$/i, '').toLowerCase(), entry.path)
      }
    }

    const scoredStudio: { item: FootageTileItem; score: number }[] = []

    for (const { entry } of fileIndex.items) {
      if (excludedFootageReason(entry) === 'rights') continue
      const fam = classifyFootageEntry(entry)
      if (!fam) continue
      const browserOnly = excludedFootageReason(entry) === 'size'

      if (fam === 'studio') {
        const link = linkFootageToCatalogue(entry, songIndex)
        const fileDate = /(\d{4}-\d{2}-\d{2})/.exec(entry.name || entry.path)?.[1] ?? null
        const swap = FOOTAGE_AUDIO_REPLACEMENTS[entry.path]
        const item: FootageTileItem = {
          path: swap?.path ?? entry.path,
          streamChannel: swap?.channel,
          title: entry.name || entry.path.split('/').pop() || entry.path,
          family: 'studio',
          dateLabel: fileDate ? `file date ${fileDate}` : (entry.modified ? `file date ${entry.modified.slice(0, 10)}` : null),
          linked: link,
          // The replacement has its own length: let the player measure it.
          duration: swap ? null : entry.duration ?? null,
        }
        studioRoot.push(item)
        if (!browserOnly) {
          const s = scoreStudioFootage(entry, link)
          if (s > 0) scoredStudio.push({ item, score: s })
        }
      } else if (fam === 'freestyle') {
        const parsed = parseFreestyleName(entry.name || entry.path.split('/').pop() || '')
        const link = linkFootageToCatalogue(entry, songIndex)
        const item: FootageTileItem = {
          path: entry.path,
          title: parsed.title,
          family: 'freestyle',
          dateLabel: parsed.date ? `file date ${parsed.date}` : null,
          with: parsed.with,
          linked: link,
          duration: entry.duration ?? null,
        }
        freestyles.push(item)
        if (!browserOnly) {
          const s = scoreStudioFootage(entry, link)
          if (s > 0) scoredStudio.push({ item, score: s })
        }
      } else if (fam === 'official') {
        const parsed = parseVideoName(entry.name || '')
        const uploadDate = /\/(\d{4}-\d{2}-\d{2})\//.exec(entry.path)?.[1] ?? null
        const stem = entry.path.replace(/\.(mp4|webm|mov|m4v)$/i, '').toLowerCase()
        const thumbPath = webpByStem.get(stem)
        official.push({
          path: entry.path,
          title: parsed?.title || entry.name || entry.path,
          family: 'official',
          dateLabel: uploadDate ? `YouTube · ${uploadDate}` : 'YouTube',
          duration: entry.duration ?? null,
          thumbUrl: thumbPath ? buildStreamUrl(thumbPath, channel || undefined) : null,
        })
      } else if (fam === 'snippet') {
        snippetClipsCount++
        const parts = entry.path.split('/')
        const eraFolder = parts[1] || 'Other'
        const songFolder = parts[2] || ''
        if (songFolder) allSnippetSongFolders.add(`${eraFolder}/${songFolder}`)
        let group = snippetFolders.get(eraFolder)
        if (!group) {
          const num = parseInt(eraFolder, 10)
          group = {
            eraFolder,
            eraKey: Number.isFinite(num) ? (ERA_KEY_BY_NUMBER[num] ?? null) : null,
            clips: [],
            songFolders: new Set(),
            exactSongFolders: new Set(),
          }
          snippetFolders.set(eraFolder, group)
        }
        if (songFolder) {
          group.songFolders.add(songFolder)
          const link = linkFootageToCatalogue({ name: songFolder, path: entry.path }, songIndex)
          if (link && link.level !== 'possible') group.exactSongFolders.add(songFolder)
        }
        group.clips.push({
          path: entry.path,
          title: songFolder ? `${songFolder} · ${entry.name}` : entry.name,
          family: 'snippet',
          dateLabel: eraFolder.replace(/^\d+\.\s*/, ''),
          duration: entry.duration ?? null,
        })
      }
    }

    scoredStudio.sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path))
    const featured = scoredStudio.slice(0, 10).map((x) => x.item)
    const featuredPaths = new Set(featured.map((f) => f.path))
    const studioMore = studioRoot.filter((s) => !featuredPaths.has(s.path))

    const snippetEras = [...snippetFolders.values()]
      .sort((a, b) => a.eraFolder.localeCompare(b.eraFolder, undefined, { numeric: true }))
      .map((g) => ({
        eraFolder: g.eraFolder,
        eraKey: g.eraKey,
        clips: g.clips,
        songCount: g.songFolders.size,
        exactCount: g.exactSongFolders.size,
      }))

    return {
      featured,
      studioMore,
      freestyles,
      official,
      snippetEras,
      counts: {
        studioVideos: studioRoot.length,
        freestyles: freestyles.length,
        officialClips: official.length,
        snippetClips: snippetClipsCount,
        snippetSongs: allSnippetSongFolders.size,
      },
    }
  }, [fileIndex, songIndex, channel])

  const searchResults = useMemo(() => {
    const q = search.trim()
    if (!q || !fileIndex) return null
    const parsed = parseFileQuery(`${q} type:video`)
    const hits = searchFileIndex(fileIndex.items, parsed, { vocab: fileIndex.vocab }).entries
    const items: FootageTileItem[] = []
    for (const entry of hits) {
      if (excludedFootageReason(entry) === 'rights') continue
      const fam = classifyFootageEntry(entry)
      if (!fam) continue
      const link = (fam === 'studio' || fam === 'freestyle') ? linkFootageToCatalogue(entry, songIndex) : null
      items.push({
        path: entry.path,
        title: entry.name || entry.path.split('/').pop() || entry.path,
        family: fam,
        dateLabel: entry.path.split('/').slice(0, -1).join(' / '),
        linked: link,
        duration: entry.duration ?? null,
      })
      if (items.length >= 400) break
    }
    return items
  }, [search, fileIndex, songIndex])

  // Hero excluded; featured first, then the rest of the studio videos.
  const studioGrid = useMemo(() => [...catalogued.featured.slice(1), ...catalogued.studioMore], [catalogued])

  const openRecordingSessions = (): void => {
    saveTrackerSearch('')
    setApiTrackerCategory('recording_session')
    setApiTrackerEra('')
    setApiTrackerTab('songs')
    setActiveView('api-tracker')
  }

  const heroPick = catalogued.featured[0] ?? null
  const activeSnippetEra = selectedEraFolder
    ? catalogued.snippetEras.find((e) => e.eraFolder === selectedEraFolder) ?? null
    : null

  return (
    <div className="coffre-home glass-scroll pb-player">
      <div className="coffre-home-inner">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-extrabold tracking-tight text-text-primary">Footage</h1>
            <p className="text-sm text-text-secondary mt-1.5">
              Videos from the archive: Juice in the studio, official clips, and snippet previews. They are three different things, and each one is labelled.
            </p>
          </div>
          <label className="relative flex items-center w-full sm:w-72">
            <Search size={15} className="absolute left-3.5 text-text-muted pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search footage & snippets…"
              aria-label="Search footage"
              className="w-full pl-9 pr-8 py-2 rounded-full text-xs bg-[var(--fill)] border border-[var(--border)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--accent)]"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-2.5 text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        {loading && !fileIndex ? (
          <div className="coffre-empty" role="status">Loading footage archive…</div>
        ) : searchResults ? (
          <section aria-label="Search results">
            <div className="coffre-section-heading">
              <h2>Search results ({searchResults.length})</h2>
              <button type="button" onClick={() => setSearch('')}>Clear search</button>
            </div>
            {searchResults.length === 0 ? (
              <p className="text-sm text-text-secondary">No matching videos found in the archive.</p>
            ) : (
              <PagedGrid
                items={searchResults}
                render={(item) => (
                  <FootageTile
                    key={item.path}
                    item={item}
                    channel={channel}
                    onWatch={(it, startAt) => setWatching({ item: it, startAt })}
                  />
                )}
              />
            )}
          </section>
        ) : (
          <>
            {heroPick && (
              <FeaturedFootageBanner
                item={heroPick}
                channel={channel}
                onWatch={(it, startAt) => setWatching({ item: it, startAt })}
              />
            )}

            <div>
              <div className="coffre-ftabs" role="tablist" aria-label="Footage families">
                <button
                  type="button"
                  role="tab"
                  className="coffre-ftab"
                  aria-selected={tab === 'studio'}
                  onClick={() => { setTab('studio'); setSelectedEraFolder(null) }}
                >
                  Studio &amp; behind the scenes
                  <small>{catalogued.counts.studioVideos.toLocaleString()} videos · {catalogued.counts.freestyles.toLocaleString()} freestyles</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  className="coffre-ftab"
                  aria-selected={tab === 'official'}
                  onClick={() => { setTab('official'); setSelectedEraFolder(null) }}
                >
                  Official clips
                  <small>{catalogued.counts.officialClips.toLocaleString()} on YouTube</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  className="coffre-ftab"
                  aria-selected={tab === 'snippet'}
                  onClick={() => setTab('snippet')}
                >
                  Snippets
                  <small>{catalogued.counts.snippetClips.toLocaleString()} clips · {catalogued.counts.snippetSongs.toLocaleString()} songs</small>
                </button>
              </div>

              <p className="text-xs text-text-secondary mt-3 mb-5 max-w-3xl">
                {tab === 'studio'
                  ? 'Juice working: studio sessions, behind-the-scenes, freestyles, tour and travel. Dates are file dates, and a name in a title is someone present, not who filmed.'
                  : tab === 'official'
                    ? 'Videos published on YouTube, with their upload date.'
                    : 'Short previews of songs, filed by era and song. They are fragments, not full recordings.'}
              </p>

              {tab === 'studio' && (
                <div className="space-y-8">
                  <PagedGrid
                    items={studioGrid}
                    className="coffre-vt-grid is-three"
                    render={(item) => (
                      <FootageTile
                        key={item.path}
                        item={item}
                        channel={channel}
                        onWatch={(it, startAt) => setWatching({ item: it, startAt })}
                      />
                    )}
                  />

                  {catalogued.freestyles.length > 0 && (
                    <div>
                      <div className="coffre-section-heading">
                        <div>
                          <h2>Freestyles</h2>
                          <p className="text-xs text-text-secondary mt-0.5">
                            {catalogued.freestyles.length.toLocaleString()} in the archive · dated by file name · matches to a catalogue song are shown only when title and date agree
                          </p>
                        </div>
                      </div>
                      <PagedGrid
                        items={catalogued.freestyles}
                        pageSize={12}
                        render={(item) => (
                          <FootageTile
                            key={item.path}
                            item={item}
                            channel={channel}
                            strictLink
                            onWatch={(it, startAt) => setWatching({ item: it, startAt })}
                          />
                        )}
                      />
                    </div>
                  )}
                </div>
              )}

              {tab === 'official' && (
                <PagedGrid
                  items={catalogued.official}
                  render={(item) => (
                    <FootageTile
                      key={item.path}
                      item={item}
                      channel={channel}
                      hoverPreview={false}
                      onWatch={(it, startAt) => setWatching({ item: it, startAt })}
                    />
                  )}
                />
              )}

              {tab === 'snippet' && (
                activeSnippetEra ? (
                  <div>
                    <div className="coffre-section-heading">
                      <div>
                        <h2>{activeSnippetEra.eraFolder.replace(/^\d+\.\s*/, '')}</h2>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {activeSnippetEra.clips.length.toLocaleString()} snippet clips · {activeSnippetEra.songCount.toLocaleString()} songs
                        </p>
                      </div>
                      <button type="button" onClick={() => setSelectedEraFolder(null)}>
                        ← All snippet eras
                      </button>
                    </div>
                    <PagedGrid
                      items={activeSnippetEra.clips}
                      render={(item) => (
                        <FootageTile
                          key={item.path}
                          item={item}
                          channel={channel}
                          onWatch={(it, startAt) => setWatching({ item: it, startAt })}
                        />
                      )}
                    />
                  </div>
                ) : (
                  <div className="coffre-era-grid">
                    {catalogued.snippetEras.map((era) => {
                      const look = era.eraKey ? ERA_LOOK[era.eraKey] : undefined
                      const cover = buildImageUrl(look?.art)
                      return (
                        <button
                          key={era.eraFolder}
                          type="button"
                          className="coffre-era"
                          onClick={() => setSelectedEraFolder(era.eraFolder)}
                        >
                          <span className="coffre-era-cover">
                            <ProgressiveCover src={cover} alt="" className="w-full h-full object-cover" />
                          </span>
                          <span>
                            <strong>{era.eraKey ? eraLabel(era.eraKey, true) : era.eraFolder.replace(/^\d+\.\s*/, '')}</strong>
                            <small>
                              {era.clips.length.toLocaleString()} clips · {era.songCount.toLocaleString()} songs · {era.exactCount.toLocaleString()} matched to a catalogue title
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      )
                    })}
                  </div>
                )
              )}
            </div>

            <div className="coffre-footage-note">
              One film from the archive is not playable here while its rights are being clarified.{' '}
              <strong>ProTools session files</strong> are audio, not video:{' '}
              <button
                type="button"
                className="underline font-semibold text-text-primary hover:opacity-80"
                onClick={openRecordingSessions}
              >
                find them in the Catalogue →
              </button>
            </div>
          </>
        )}
      </div>

      {watching && (
        <FootagePlayerModal
          item={watching.item}
          channel={channel}
          onClose={() => setWatching(null)}
        />
      )}
    </div>
  )
}
