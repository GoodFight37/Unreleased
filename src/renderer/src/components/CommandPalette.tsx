import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Command, Search, Compass, Zap, Sparkles, SlidersHorizontal, ArrowRight, CornerDownLeft,
  Music2, Disc3, HardDrive, ListPlus, Info,
} from 'lucide-react'
import { ModalOverlay } from './Modal'
import { useStore } from '../store/useStore'
import { IS_ELECTRON } from '../lib/platform'
import { hasChatAccess } from '../lib/chatAccess'
import {
  HOTKEY_ACTIONS,
  hotkeyActionLabel,
  comboTokens,
  effectiveBinding,
  runHotkeyAction,
} from '../lib/hotkeys'
import { GLASS_LOOKS, setGlassLook, type GlassLookId } from '../lib/glass/presets'
import type { ViewType } from '../types'
import { SKINS } from '../lib/skins'
import { viewLabel } from '../lib/viewLabels'
import { loadAllSongs, peekTrackerCatalog, songToTrack, type JWApiSong } from '../lib/juicewrldApi'
import { searchLocalLibrary, searchVaultSongs } from '../lib/vaultSearchIndex'
import { loadEraFullNames } from '../lib/eras'
import { formatDuration } from '../lib/format'
import { libraryTrackToTrack } from '../lib/fileTypes'
import { showAppToast } from '../lib/appToast'

interface PaletteItem {
  id: string
  label: string
  subtitle?: string
  badge?: string
  badgeTitle?: string
  coverUrl?: string
  duration?: string
  category: 'Song' | 'Local' | 'Playlist' | 'View' | 'Tool' | 'Appearance' | 'Playback' | 'Volume' | 'Navigation' | 'App'
  keywords?: string
  tokens?: string[]
  run: () => void
  onPlayNext?: () => void
  onInfo?: () => void
}

const VIEW_ENTRIES: { view: ViewType; label: string; keywords?: string; electronOnly?: boolean; staffOnly?: boolean; devOnly?: boolean }[] = [
  { view: 'home', label: 'Home', keywords: 'dashboard overview discover' },
  { view: 'api-tracker', label: 'Tracker', keywords: 'songs catalog catalogue search leaks' },
  { view: 'footage', label: 'Footage', keywords: 'videos studio freestyles clips snippets' },
  { view: 'api-files', label: 'Files', keywords: 'browser folders audio', devOnly: true },
  { view: 'library', label: 'Library', keywords: 'local music folders', electronOnly: true },
  { view: 'playlists', label: 'Playlists', keywords: 'collections' },
  { view: 'wrld', label: 'WRLD', keywords: 'player lyrics 999 fm visualizer' },
  { view: 'albums', label: 'Albums', keywords: 'discography releases' },
  { view: 'liked', label: 'Liked Songs', keywords: 'favorites hearts grails' },
  { view: 'heardle', label: 'Heardle', keywords: 'games guess' },
  { view: 'tierlist', label: 'Tier List', keywords: 'games rank' },
  { view: 'stats', label: 'Wrapped', keywords: 'listening stats' },
  { view: 'statistics', label: 'Statistics', keywords: 'charts analytics' },
  { view: 'news', label: 'News', keywords: 'updates announcements' },
  { view: 'docs', label: 'API Docs', keywords: 'documentation endpoints', devOnly: true },
  { view: 'terminal', label: 'Terminal', keywords: 'cli shell commands', devOnly: true },
  { view: 'thanks', label: 'Built by & Credits', keywords: 'credits goodfight37 wrldmlk about' },
  { view: 'chat', label: 'Chat', keywords: 'staff messages', staffOnly: true },
  { view: 'editor', label: 'Song Editor', keywords: 'staff edit proposal', staffOnly: true, devOnly: true },
  { view: 'contributor', label: 'Contributor', keywords: 'staff submit', staffOnly: true, devOnly: true },
  { view: 'admin', label: 'Admin', keywords: 'moderation queue logs', staffOnly: true, devOnly: true },
  { view: 'albums-admin', label: 'Albums Admin', keywords: 'staff catalog', staffOnly: true, devOnly: true },
]

export default function CommandPalette({ onClose }: { onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [vaultSongs, setVaultSongs] = useState<JWApiSong[]>(() => peekTrackerCatalog('') ?? [])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const account = useStore((s) => s.account)
  const developerMode = useStore((s) => s.developerMode)
  const hotkeyBindings = useStore((s) => s.hotkeyBindings)
  const currentTrack = useStore((s) => s.currentTrack)
  const radioFmActive = useStore((s) => s.radioFmActive)
  const libraryTracks = useStore((s) => s.libraryTracks)
  const playlists = useStore((s) => s.playlists)
  const setActiveView = useStore((s) => s.setActiveView)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setShowDiagnostics = useStore((s) => s.setShowDiagnostics)
  const setTheme = useStore((s) => s.setTheme)
  const setInterfaceStyle = useStore((s) => s.setInterfaceStyle)
  const playTrack = useStore((s) => s.playTrack)
  const playNext = useStore((s) => s.playNext)
  const setInfoSongId = useStore((s) => s.setInfoSongId)

  // Warm the catalogue + era display names asynchronously when opened.
  useEffect(() => {
    let cancelled = false
    void loadEraFullNames().catch(() => {})
    if (vaultSongs.length === 0) {
      void loadAllSongs().then((songs) => {
        if (!cancelled && Array.isArray(songs)) setVaultSongs(songs)
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [vaultSongs.length])

  const commandItems = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = []
    const isStaff = hasChatAccess(account)

    for (const v of VIEW_ENTRIES) {
      if (v.electronOnly && !IS_ELECTRON) continue
      if (v.staffOnly && !isStaff) continue
      if (v.devOnly && !developerMode) continue
      out.push({
        id: `view:${v.view}`,
        label: `Go to ${viewLabel(v.view, v.label, developerMode)}`,
        category: 'View',
        keywords: `${v.label} ${v.keywords ?? ''}`,
        run: () => setActiveView(v.view),
      })
    }

    out.push(
      {
        id: 'tool:share-studio',
        label: 'Open Share Studio (PNG & MP4)',
        category: 'Tool',
        keywords: 'export video story 9:16 16:9 lyrics card',
        run: () => {
          if (currentTrack || radioFmActive) window.dispatchEvent(new Event('open-share-studio'))
        },
      },
      {
        id: 'tool:settings',
        label: 'Open Settings',
        category: 'Tool',
        keywords: 'preferences appearance effects shortcuts',
        tokens: comboTokens(effectiveBinding('open-settings', hotkeyBindings)),
        run: () => setShowSettings(true),
      },
    )

    out.push(
      {
        id: 'style:editorial',
        label: 'Interface Style: Obsidian Editorial (Sidebar)',
        category: 'Appearance',
        keywords: 'editorial piste a sidebar serif obsidian layout',
        run: () => setInterfaceStyle('editorial'),
      },
      {
        id: 'style:spatial',
        label: 'Interface Style: Apple Spatial Glass (Floating Pill)',
        category: 'Appearance',
        keywords: 'spatial piste b pill glass floating layout',
        run: () => setInterfaceStyle('spatial'),
      },
    )

    for (const skin of SKINS) {
      out.push({
        id: `theme:${skin.id}`,
        label: `Theme: ${skin.name}`,
        category: 'Appearance',
        keywords: `${skin.dark ? 'dark' : 'light'} mode skin album`,
        run: () => setTheme(skin.id),
      })
    }

    if (developerMode) {
      out.push(
        {
          id: 'tool:glass-lab',
          label: 'Open Glass Lab',
          category: 'Tool',
          keywords: 'webgpu optics benchmark shader',
          run: () => window.dispatchEvent(new Event('open-glass-lab')),
        },
        {
          id: 'tool:diagnostics',
          label: 'Open Diagnostics',
          category: 'Tool',
          keywords: 'debug cache log',
          run: () => setShowDiagnostics(true),
        },
      )
      for (const [id, look] of Object.entries(GLASS_LOOKS) as [GlassLookId, { label: string }][]) {
        out.push({
          id: `look:${id}`,
          label: `Glass Look: ${look.label}`,
          category: 'Tool',
          keywords: 'liquid glass preset style',
          run: () => setGlassLook({ id }),
        })
      }
    }

    // In normal mode, surface only genuinely useful quick actions (no `Seek 10%..90%`
    // or technical hotkey clutter). Full hotkey list stays available in Developer mode.
    const CURATED_HOTKEYS = new Set([
      'play-pause',
      'next-track',
      'prev-track',
      'toggle-shuffle',
      'toggle-repeat',
      'toggle-mute',
      'toggle-queue',
      'toggle-eq',
      'toggle-wrld-fullscreen',
    ])
    for (const action of HOTKEY_ACTIONS) {
      if (action.electronOnly && !IS_ELECTRON) continue
      if (action.devModeOnly && !developerMode) continue
      if (action.id === 'open-settings' || action.id === 'open-diagnostics') continue
      if (!developerMode && !CURATED_HOTKEYS.has(action.id)) continue
      const combo = effectiveBinding(action.id, hotkeyBindings)
      out.push({
        id: `hk:${action.id}`,
        label: hotkeyActionLabel(action, developerMode),
        category: action.category,
        keywords: action.id,
        tokens: comboTokens(combo),
        run: () => runHotkeyAction(action.id),
      })
    }

    return out
  }, [account, developerMode, hotkeyBindings, currentTrack, radioFmActive, setActiveView, setShowSettings, setShowDiagnostics, setTheme])

  const filtered = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commandItems

    const scoredCommands = commandItems
      .map((item) => {
        const hay = `${item.label} ${item.category} ${item.keywords ?? ''}`.toLowerCase()
        const labelLower = item.label.toLowerCase()
        if (labelLower === q || labelLower === `go to ${q}`) return { item, score: 0 }
        if (labelLower.startsWith(q) || labelLower.startsWith(`go to ${q}`)) return { item, score: 0.5 }
        if (labelLower.includes(q)) return { item, score: 2 }
        if (hay.includes(q)) return { item, score: 3.5 }
        let qi = 0
        for (let i = 0; i < hay.length && qi < q.length; i++) {
          if (hay[i] === q[qi]) qi++
        }
        return qi === q.length ? { item, score: 5 } : null
      })
      .filter((x): x is { item: PaletteItem; score: number } => x !== null)

    const musicResults: { item: PaletteItem; score: number }[] = []

    if (q.length >= 2) {
      // Catalogue songs (Vault Search)
      const songMatches = searchVaultSongs(vaultSongs, q, 14)
      for (const { entry, score } of songMatches) {
        const { song } = entry
        const track = entry.playable ? songToTrack(song) : null
        const subParts = [entry.eraDisplay, song.producers ? `Prod. ${song.producers}` : ''].filter(Boolean)
        const isSession = song.category === 'recording_session'
        const badge = !entry.playable
          ? 'Unsurfaced'
          : isSession
            ? 'Session'
            : song.category === 'released'
              ? 'Released'
              : 'Unreleased'
        musicResults.push({
          score: 0.8 + score * 0.45,
          item: {
            id: `song:${song.id}`,
            label: song.name,
            subtitle: subParts.join(' · ') || 'Juice WRLD',
            badge,
            badgeTitle: !entry.playable ? 'Still in the vault — Soon™' : undefined,
            coverUrl: entry.coverUrl,
            duration: entry.durationSec > 0 ? formatDuration(entry.durationSec, '') : undefined,
            category: 'Song',
            run: () => {
              if (track) playTrack(track)
              else setInfoSongId(song.id)
            },
            onPlayNext: track
              ? () => {
                  playNext(track)
                  showAppToast(`Playing next: ${track.title}`)
                }
              : undefined,
            onInfo: () => setInfoSongId(song.id),
          },
        })
      }

      // Playlists
      for (const pl of playlists) {
        const nameLower = pl.name.toLowerCase()
        if (!nameLower.includes(q)) continue
        musicResults.push({
          score: nameLower.startsWith(q) ? 1.2 : 2.6,
          item: {
            id: `pl:${pl.id}`,
            label: pl.name,
            subtitle: `${pl.track_count} ${pl.track_count === 1 ? 'track' : 'tracks'}`,
            category: 'Playlist',
            run: () => setActiveView('playlists'),
          },
        })
      }

      // Local library tracks
      const localMatches = searchLocalLibrary(libraryTracks, q, 6)
      for (const lt of localMatches) {
        const track = libraryTrackToTrack(lt)
        musicResults.push({
          score: 1.9,
          item: {
            id: `local:${lt.id}`,
            label: lt.title,
            subtitle: [lt.artist, lt.album].filter(Boolean).join(' · ') || 'On this device',
            duration: lt.duration > 0 ? formatDuration(lt.duration, '') : undefined,
            category: 'Local',
            run: () => playTrack(track),
            onPlayNext: () => {
              playNext(track)
              showAppToast(`Playing next: ${track.title}`)
            },
          },
        })
      }
    }

    const merged = [...scoredCommands, ...musicResults]
    merged.sort((a, b) => a.score - b.score)
    return merged.slice(0, 40).map((x) => x.item)
  }, [commandItems, query, vaultSongs, playlists, libraryTracks, playTrack, playNext, setInfoSongId, setActiveView])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, filtered.length])

  const execute = (item: PaletteItem | undefined, mode: 'run' | 'next' | 'info' = 'run'): void => {
    if (!item) return
    if (mode === 'next' && item.onPlayNext) {
      onClose()
      item.onPlayNext()
      return
    }
    if (mode === 'info' && item.onInfo) {
      onClose()
      item.onInfo()
      return
    }
    onClose()
    item.run()
  }

  const activeItem = filtered[activeIdx]

  return (
    <ModalOverlay
      standalone
      motion={false}
      onClose={onClose}
      zIndexClassName="z-[210]"
      panelClassName="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[76vh]"
      minWidth={380}
      minHeight={280}
    >
      {() => (
        <div
          className="flex flex-col max-h-[76vh]"
          data-command-palette="1"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIdx((i) => (filtered.length ? (i + 1) % filtered.length : 0))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIdx((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) execute(filtered[activeIdx], 'next')
              else if (e.altKey) execute(filtered[activeIdx], 'info')
              else execute(filtered[activeIdx], 'run')
            }
          }}
        >
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)] shrink-0">
            <Search size={16} className="text-text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs, eras, producers, playlists or commands…"
              aria-label="Command palette search"
              className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-highest)] text-[10px] font-mono text-text-muted shrink-0">
              Esc
            </kbd>
          </div>

          <div ref={listRef} role="listbox" className="flex-1 min-h-0 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-xs text-text-muted">
                Not even in the vault yet.
              </div>
            ) : (
              filtered.map((item, idx) => {
                const selected = idx === activeIdx
                const Icon = item.category === 'Song'
                  ? Music2
                  : item.category === 'Playlist'
                    ? Disc3
                    : item.category === 'Local'
                      ? HardDrive
                      : item.category === 'View'
                        ? Compass
                        : item.category === 'Appearance'
                          ? Sparkles
                          : item.category === 'Tool'
                            ? SlidersHorizontal
                            : Zap
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-palette-idx={idx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={(e) => {
                      if (e.shiftKey) execute(item, 'next')
                      else if (e.altKey) execute(item, 'info')
                      else execute(item, 'run')
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                      selected ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      {item.coverUrl ? (
                        <img
                          src={item.coverUrl}
                          alt=""
                          loading="lazy"
                          className="w-8 h-8 rounded-md object-cover shrink-0 bg-surface-overlay"
                        />
                      ) : (
                        <span className="w-8 h-8 rounded-md bg-[var(--fill)] flex items-center justify-center shrink-0">
                          <Icon size={14} className={selected ? 'text-accent' : 'text-text-muted'} />
                        </span>
                      )}
                      <span className="min-w-0 flex flex-col">
                        <span className="text-sm font-medium truncate text-text-primary">{item.label}</span>
                        {item.subtitle && (
                          <span className="text-[11px] text-text-muted truncate">{item.subtitle}</span>
                        )}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {item.badge && (
                        <span
                          title={item.badgeTitle}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            item.badge === 'Unsurfaced'
                              ? 'bg-[var(--fill)] text-text-muted'
                              : item.badge === 'Session'
                                ? 'bg-purple-500/15 text-purple-300'
                                : 'bg-accent/15 text-accent'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.duration && (
                        <span className="text-[11px] font-mono tabular-nums text-text-muted">
                          {item.duration}
                        </span>
                      )}
                      {!item.badge && (
                        <span className="text-[10px] uppercase tracking-wider text-text-muted">
                          {item.category}
                        </span>
                      )}
                      {item.tokens?.map((tok, ti) => (
                        <kbd
                          key={ti}
                          className="px-1.5 py-0.5 rounded bg-[var(--surface-highest)] text-[10px] font-mono text-text-muted"
                        >
                          {tok}
                        </kbd>
                      ))}
                      {selected && item.onPlayNext && (
                        <span
                          role="button"
                          tabIndex={-1}
                          title="Play next (Shift+Enter)"
                          onClick={(e) => { e.stopPropagation(); execute(item, 'next') }}
                          className="p-1 rounded hover:bg-[var(--fill-strong)] text-text-muted hover:text-text-primary"
                        >
                          <ListPlus size={13} />
                        </span>
                      )}
                      {selected && item.onInfo && (
                        <span
                          role="button"
                          tabIndex={-1}
                          title="Song details (Alt+Enter)"
                          onClick={(e) => { e.stopPropagation(); execute(item, 'info') }}
                          className="p-1 rounded hover:bg-[var(--fill-strong)] text-text-muted hover:text-text-primary"
                        >
                          <Info size={13} />
                        </span>
                      )}
                      {selected && <ArrowRight size={13} className="text-accent ml-0.5" />}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-text-muted shrink-0">
            <span className="flex items-center gap-1.5">
              <Command size={11} /> {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
              {vaultSongs.length > 0 && <span className="opacity-60">· {vaultSongs.length.toLocaleString()} songs indexed</span>}
            </span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><CornerDownLeft size={11} /> {activeItem?.category === 'Song' ? 'Play' : 'Run'}</span>
              {activeItem?.onPlayNext && <span>Shift+↵ Play next</span>}
              {activeItem?.onInfo && <span>Alt+↵ Info</span>}
              <span>↑↓ Navigate</span>
            </span>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
