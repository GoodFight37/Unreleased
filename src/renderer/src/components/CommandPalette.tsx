import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Command, Search, Compass, Zap, Sparkles, SlidersHorizontal, ArrowRight, CornerDownLeft,
} from 'lucide-react'
import { ModalOverlay } from './Modal'
import { useStore } from '../store/useStore'
import { IS_ELECTRON } from '../lib/platform'
import { hasChatAccess } from '../lib/chatAccess'
import {
  HOTKEY_ACTIONS,
  comboTokens,
  effectiveBinding,
  runHotkeyAction,
} from '../lib/hotkeys'
import { GLASS_LOOKS, setGlassLook, type GlassLookId } from '../lib/glass/presets'
import type { ViewType } from '../types'
import { SKINS } from '../lib/skins'

interface PaletteItem {
  id: string
  label: string
  category: 'View' | 'Tool' | 'Appearance' | 'Playback' | 'Volume' | 'Navigation' | 'App'
  keywords?: string
  tokens?: string[]
  run: () => void
}

const VIEW_ENTRIES: { view: ViewType; label: string; keywords?: string; electronOnly?: boolean; staffOnly?: boolean; devOnly?: boolean }[] = [
  { view: 'home', label: 'Home', keywords: 'dashboard overview' },
  { view: 'api-tracker', label: 'Tracker', keywords: 'songs catalog search leaks' },
  { view: 'api-files', label: 'Files', keywords: 'browser folders audio' },
  { view: 'library', label: 'Library', keywords: 'local music folders', electronOnly: true },
  { view: 'playlists', label: 'Playlists', keywords: 'collections' },
  { view: 'wrld', label: 'WRLD', keywords: 'player lyrics 999 fm visualizer' },
  { view: 'albums', label: 'Albums', keywords: 'discography releases' },
  { view: 'liked', label: 'Liked Songs', keywords: 'favorites hearts' },
  { view: 'heardle', label: 'Heardle', keywords: 'games guess' },
  { view: 'wordle', label: 'Wordle', keywords: 'games puzzle' },
  { view: 'tierlist', label: 'Tier List', keywords: 'games rank' },
  { view: 'stats', label: 'Wrapped', keywords: 'listening stats' },
  { view: 'statistics', label: 'Statistics', keywords: 'charts analytics' },
  { view: 'news', label: 'News', keywords: 'updates announcements' },
  { view: 'docs', label: 'API Docs', keywords: 'documentation endpoints', devOnly: true },
  { view: 'terminal', label: 'Terminal', keywords: 'cli shell commands', devOnly: true },
  { view: 'thanks', label: 'Thank You', keywords: 'credits acknowledgements' },
  { view: 'chat', label: 'Chat', keywords: 'staff messages', staffOnly: true },
  { view: 'editor', label: 'Song Editor', keywords: 'staff edit proposal', staffOnly: true, devOnly: true },
  { view: 'contributor', label: 'Contributor', keywords: 'staff submit', staffOnly: true, devOnly: true },
  { view: 'admin', label: 'Admin', keywords: 'moderation queue logs', staffOnly: true, devOnly: true },
  { view: 'albums-admin', label: 'Albums Admin', keywords: 'staff catalog', staffOnly: true, devOnly: true },
]

export default function CommandPalette({ onClose }: { onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const account = useStore((s) => s.account)
  const developerMode = useStore((s) => s.developerMode)
  const hotkeyBindings = useStore((s) => s.hotkeyBindings)
  const currentTrack = useStore((s) => s.currentTrack)
  const radioFmActive = useStore((s) => s.radioFmActive)
  const setActiveView = useStore((s) => s.setActiveView)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setShowDiagnostics = useStore((s) => s.setShowDiagnostics)
  const setTheme = useStore((s) => s.setTheme)

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = []
    const isStaff = hasChatAccess(account)

    for (const v of VIEW_ENTRIES) {
      if (v.electronOnly && !IS_ELECTRON) continue
      if (v.staffOnly && !isStaff) continue
      // Developer and admin pages stay out of a fan's way unless Developer mode is on.
      if (v.devOnly && !developerMode) continue
      out.push({
        id: `view:${v.view}`,
        label: `Go to ${v.label}`,
        category: 'View',
        keywords: v.keywords,
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

    for (const action of HOTKEY_ACTIONS) {
      if (action.electronOnly && !IS_ELECTRON) continue
      if (action.devModeOnly && !developerMode) continue
      if (action.id === 'open-settings' || action.id === 'open-diagnostics') continue
      const combo = effectiveBinding(action.id, hotkeyBindings)
      out.push({
        id: `hk:${action.id}`,
        label: action.label,
        category: action.category,
        keywords: action.id,
        tokens: comboTokens(combo),
        run: () => runHotkeyAction(action.id),
      })
    }

    return out
  }, [account, developerMode, hotkeyBindings, currentTrack, radioFmActive, setActiveView, setShowSettings, setShowDiagnostics, setTheme])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    const scored = items
      .map((item) => {
        const hay = `${item.label} ${item.category} ${item.keywords ?? ''}`.toLowerCase()
        const labelLower = item.label.toLowerCase()
        if (labelLower === q) return { item, score: 0 }
        if (labelLower.startsWith(q)) return { item, score: 1 }
        if (labelLower.includes(q)) return { item, score: 2 }
        if (hay.includes(q)) return { item, score: 3 }
        // Simple subsequence fuzzy match
        let qi = 0
        for (let i = 0; i < hay.length && qi < q.length; i++) {
          if (hay[i] === q[qi]) qi++
        }
        return qi === q.length ? { item, score: 4 } : null
      })
      .filter((x): x is { item: PaletteItem; score: number } => x !== null)
    scored.sort((a, b) => a.score - b.score)
    return scored.map((x) => x.item)
  }, [items, query])

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

  const execute = (item: PaletteItem | undefined): void => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <ModalOverlay
      standalone
      motion={false}
      onClose={onClose}
      zIndexClassName="z-[210]"
      panelClassName="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-xl max-h-[74vh]"
      minWidth={360}
      minHeight={260}
    >
      {() => (
        <div
          className="flex flex-col max-h-[74vh]"
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
              execute(filtered[activeIdx])
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
              placeholder="Search views, actions, Glass looks, shortcuts…"
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
                No matching views or commands.
              </div>
            ) : (
              filtered.map((item, idx) => {
                const selected = idx === activeIdx
                const Icon = item.category === 'View'
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
                    onClick={() => execute(item)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                      selected ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon size={14} className={selected ? 'text-accent shrink-0' : 'text-text-muted shrink-0'} />
                      <span className="text-sm font-medium truncate">{item.label}</span>
                      <span className="text-[10px] uppercase tracking-wider text-text-muted shrink-0">
                        {item.category}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.tokens?.map((tok, ti) => (
                        <kbd
                          key={ti}
                          className="px-1.5 py-0.5 rounded bg-[var(--surface-highest)] text-[10px] font-mono text-text-muted"
                        >
                          {tok}
                        </kbd>
                      ))}
                      {selected && <ArrowRight size={13} className="text-accent ml-1" />}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-text-muted shrink-0">
            <span className="flex items-center gap-1.5">
              <Command size={11} /> {filtered.length} commands
            </span>
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1"><CornerDownLeft size={11} /> Run</span>
              <span>↑↓ Navigate</span>
            </span>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
