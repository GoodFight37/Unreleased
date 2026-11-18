import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Play } from 'lucide-react'
import { loadSongFootage, type FootageMatch } from '../lib/footageIndex'
import {
  classifyFootageEntry,
  excludedFootageReason,
  linkFootageToCatalogue,
  buildFootageSongIndex,
  parseFreestyleName,
} from '../lib/footageCatalog'
import { buildStreamUrl, loadAllSongs, type JWApiSong } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import {
  cleanFootageDisplayTitle,
  FootageFamilyChip,
  FootagePlayerModal,
  type FootageTileItem,
} from './FootageTile'

let cachedSongsPromise: Promise<JWApiSong[]> | null = null
function loadSongsOnce(): Promise<JWApiSong[]> {
  if (!cachedSongsPromise) {
    cachedSongsPromise = loadAllSongs().catch(() => {
      cachedSongsPromise = null
      return []
    })
  }
  return cachedSongsPromise
}

export default function SongFootagePill({
  songTitle,
  songId,
  light = false,
  placement = 'bar',
}: {
  songTitle: string | null | undefined
  songId: number | null
  light?: boolean
  placement?: 'bar' | 'wrld'
}): JSX.Element | null {
  // Video archive lives on the primary channel ('').
  const channel = ''
  const [matches, setMatches] = useState<FootageMatch[]>([])
  const [open, setOpen] = useState(false)
  const [watching, setWatching] = useState<FootageTileItem | null>(null)
  const [panelPos, setPanelPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [songIndexReady, setSongIndexReady] = useState<ReturnType<typeof buildFootageSongIndex> | null>(null)

  useEffect(() => {
    setOpen(false)
    if (!songTitle || songTitle.trim().length < 2) {
      setMatches([])
      return
    }
    let stale = false
    loadSongFootage(songTitle, channel, false)
      .then((res) => {
        if (stale) return
        if (!res) {
          setMatches([])
          return
        }
        const clean = res.filter((m) => {
          if (excludedFootageReason(m.entry) === 'rights') return false
          return classifyFootageEntry(m.entry) !== null
        })
        setMatches(clean)
      })
      .catch(() => {
        if (!stale) setMatches([])
      })
    return () => { stale = true }
  }, [songTitle, channel])

  useEffect(() => {
    if (!open || songIndexReady) return
    let stale = false
    loadSongsOnce().then((all) => {
      if (!stale && all.length) setSongIndexReady(buildFootageSongIndex(all))
    })
    return () => { stale = true }
  }, [open, songIndexReady])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const width = 340
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    if (placement === 'bar') {
      setPanelPos({ left, bottom: window.innerHeight - rect.top + 10 })
    } else {
      setPanelPos({ left, top: rect.bottom + 8 })
    }
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (matches.length === 0) return null

  const count = matches.length
  const pillStyle = placement === 'wrld'
    ? {
        color: light ? '#141418' : '#fff',
        borderColor: light ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.24)',
        backgroundColor: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
      }
    : undefined

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Watch footage for this song"
        style={pillStyle}
        className={`coffre-vpill ${placement === 'wrld' ? 'is-wrld' : ''}`}
      >
        <Play size={10} fill="currentColor" />
        <span>{count} {count === 1 ? 'video' : 'videos'}</span>
      </button>

      {open && panelPos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Videos for ${songTitle ?? 'this song'}`}
          className="coffre-vpanel floating-panel-glass glass-thick"
          style={{
            left: `${panelPos.left}px`,
            ...(panelPos.top !== undefined ? { top: `${panelPos.top}px` } : {}),
            ...(panelPos.bottom !== undefined ? { bottom: `${panelPos.bottom}px` } : {}),
          }}
        >
          <div className="font-semibold text-sm text-text-primary truncate">
            Videos for {songTitle}
          </div>
          <p className="text-[11.5px] text-text-secondary mt-0.5 mb-3">
            Matched by title{songIndexReady ? ' and recording date when available' : ''}. Playing a video pauses the music.
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {matches.slice(0, 8).map((m) => {
              const fam = classifyFootageEntry(m.entry) ?? 'studio'
              const reason = excludedFootageReason(m.entry)
              const browserOnly = reason === 'size'
              const freestyleMeta = fam === 'freestyle' ? parseFreestyleName(m.entry.name || m.entry.path) : null
              const link = songIndexReady && (fam === 'studio' || fam === 'freestyle')
                ? linkFootageToCatalogue(m.entry, songIndexReady)
                : null
              const item: FootageTileItem = {
                path: m.entry.path,
                title: freestyleMeta ? freestyleMeta.title : m.entry.name,
                family: fam,
                dateLabel: freestyleMeta?.date ?? (m.entry.duration || null),
                with: freestyleMeta?.with,
                linked: link,
                duration: m.entry.duration ?? null,
              }
              return browserOnly ? (
                <a
                  key={m.entry.path}
                  href={buildStreamUrl(m.entry.path, channel || undefined)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="coffre-vpanel-row"
                  onClick={() => setOpen(false)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-text-primary truncate">
                      {cleanFootageDisplayTitle(item.title)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-text-secondary">
                      <FootageFamilyChip family={fam} />
                      <span>Open in browser</span>
                    </div>
                  </div>
                  <ExternalLink size={14} className="text-text-secondary shrink-0" />
                </a>
              ) : (
                <button
                  key={m.entry.path}
                  type="button"
                  className="coffre-vpanel-row"
                  onClick={() => {
                    setOpen(false)
                    setWatching(item)
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-text-primary truncate">
                      {cleanFootageDisplayTitle(item.title)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-text-secondary">
                      <FootageFamilyChip family={fam} />
                      {m.entry.duration && <span>{m.entry.duration}</span>}
                    </div>
                  </div>
                  <Play size={14} fill="currentColor" className="text-text-primary shrink-0" />
                </button>
              )
            })}
          </div>

          {songId != null && (
            <button
              type="button"
              className="mt-3 text-xs font-semibold text-text-secondary hover:text-text-primary"
              onClick={() => {
                setOpen(false)
                useStore.getState().setInfoSongId(songId)
              }}
            >
              See all videos &amp; snippets in Song info →
            </button>
          )}
        </div>,
        document.body,
      )}

      {watching && (
        <FootagePlayerModal
          item={watching}
          channel={channel}
          onClose={() => setWatching(null)}
        />
      )}
    </>
  )
}
