import { getActiveRadioClient } from '../lib/radioSocketService'
import { resumeEffectsContext } from '../lib/audioEffects'
import { hasChatAccess } from '../lib/chatAccess'
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Menu, Check, RefreshCw, AlertTriangle } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { useCatalogSync } from '../store/catalogSyncStore'
import { effectiveBinding, comboTokens, runHotkeyAction } from '../lib/hotkeys'
import { trackIdToSongId } from '../lib/userApi'
import { orderedNavItems } from '../lib/navItems'
import type { ViewType } from '../types'
import { APP_VERSION } from '../lib/appVersion'
import { useSlidingIndicator } from '../hooks/useSlidingIndicator'
import { useEscapeToClose } from '../hooks/useEscapeToClose'
import { popOut, useExitGhost } from '../hooks/useExitGhost'
import { ClampedMenu } from './ClampedMenu'

// View tabs that have a dedicated navigation hotkey — the rest navigate via
// setActiveView. Keyed by the nav item's `view` id.
const VIEW_HOTKEYS: Partial<Record<ViewType, string>> = {
  'api-tracker': 'view-tracker',
  playlists: 'view-playlists',
  library: 'view-library',
  wrld: 'view-wrld',
}

// MusicBee-style application menu: a button that drops down the top-level menus
// (File, Edit, View…), each opening its own submenu flyout. Desktop only — the
// web build has no frameless title strip and no `window.electron`.
//
// `variant` decides where it lives (Settings → Appearance → Menu button):
//   'bar'     — floating pill pinned to the window's title strip (top-left).
//   'sidebar' — a normal row rendered inside the Sidebar (App.tsx skips the
//               floating one). Avoids overlapping whatever sits in the content
//               area's top-left corner (radio widget, WRLD controls…).
// The dropdown itself anchors to the trigger button's measured position either
// way, so it opens in the right spot wherever the button is placed.
//
// Entries that mirror a keyboard shortcut dispatch by hotkey id through
// runHotkeyAction rather than reimplementing the behavior, so a menu click and
// its shortcut always run the identical handler (and the combo shown on the
// right stays truthful even after the user rebinds it in Settings).

type Entry =
  | { kind: 'sep' }
  | {
      /** A nested flyout — its own list of entries, opened to the side. */
      kind: 'submenu'
      label: string
      entries: Entry[]
      disabled?: boolean
    }
  | {
      kind: 'item'
      label: string
      onClick: () => void
      /** Hotkey action id — dispatches the action and shows its bound combo. */
      hotkey?: string
      /** Overrides the combo shown when the entry isn't hotkey-driven. */
      combo?: string
      checked?: boolean
      disabled?: boolean
      /** Right-aligned status adornment (e.g. the update-check spinner). Shown
       *  in place of a combo. */
      trailing?: ReactNode
      /** Leave the menu open after the click, so the row can show progress or a toggle. */
      keepOpen?: boolean
    }

interface MenuDef { id: string; label: string; entries: Entry[] }

function openExternal(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// 'bar' — floating title-strip pill · 'titlebar' — the same pill but rendered
// inline inside App's reserved title-bar row (so it never overlaps content) ·
// 'sidebar' — full-width row for the vertical side menu · 'sidebar-icon' —
// compact icon button for the collapsed side menu and the horizontal bar.
type AppMenuVariant = 'bar' | 'titlebar' | 'sidebar' | 'sidebar-icon'

export default function AppMenu({ variant = 'bar', collapsed = false }: { variant?: AppMenuVariant; collapsed?: boolean } = {}): JSX.Element | null {
  const {
    account, logoutAccount, setShowUserAuth,
    openSettings, openConvert,
    setActiveView, setShowDownloadManager, clearCompletedDownloads,
    showQueue, showNowPlaying, setShowNowPlaying,
    showEqPanel, shuffle, repeat, isPlaying, currentTrack,
    sleepTimerEnd, crossfadeEnabled, crossfadeDuration, setCrossfade,
    preferOgVersion, pauseFadeEnabled,
    playbackSpeed, setPlaybackSpeed,
    eqEnabled, setEqEnabled, eqMono, setEqMono,
    skipSilence, setSkipSilence, reverbEnabled, setReverbEnabled,
    pitchShift, setPitchShift,
    lastfmEnabled, setLastfmEnabled,
    globalHotkeysEnabled, setGlobalHotkeysEnabled,
    developerMode, setDeveloperMode,
    addLibraryFolder, libraryScanning, libraryAutoRefresh, setLibraryAutoRefresh,
    syncOfflinePlaylists, openReport, openLyricsGen, openCoverArtSubmit,
    hotkeyBindings, navOrder,
  } = useStorePick(
    'account', 'logoutAccount', 'setShowUserAuth',
    'openSettings', 'openConvert',
    'setActiveView', 'setShowDownloadManager', 'clearCompletedDownloads',
    'showQueue', 'showNowPlaying', 'setShowNowPlaying',
    'showEqPanel', 'shuffle', 'repeat', 'isPlaying', 'currentTrack',
    'sleepTimerEnd', 'crossfadeEnabled', 'crossfadeDuration', 'setCrossfade',
    'preferOgVersion', 'pauseFadeEnabled',
    'playbackSpeed', 'setPlaybackSpeed',
    'eqEnabled', 'setEqEnabled', 'eqMono', 'setEqMono',
    'skipSilence', 'setSkipSilence', 'reverbEnabled', 'setReverbEnabled',
    'pitchShift', 'setPitchShift',
    'lastfmEnabled', 'setLastfmEnabled',
    'globalHotkeysEnabled', 'setGlobalHotkeysEnabled',
    'developerMode', 'setDeveloperMode',
    'addLibraryFolder', 'libraryScanning', 'libraryAutoRefresh', 'setLibraryAutoRefresh',
    'syncOfflinePlaylists', 'openReport', 'openLyricsGen', 'openCoverArtSubmit',
    'hotkeyBindings', 'navOrder',
  )

  const [open, setOpen] = useState(false)
  // The trigger's rect when the menu opened - the dropdown anchors to it.
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number; bottom: number } | null>(null)
  // In-menu updater status so "Check for updates" gives feedback in place
  // rather than silently closing the menu (mirrors Settings' own state machine).
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [updatePercent, setUpdatePercent] = useState(0)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  // Discord Rich Presence on/off lives in main-process app settings, not the
  // store — mirror it here so the Tools entry can show a checkmark.
  const [discordOn, setDiscordOn] = useState(false)
  const [activeTab, setActiveTab] = useState('file')
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const el = (window as any).electron

  // Follow updater progress so the "Check for updates" row reflects it live
  // (available → downloading% → ready). Auto-updates fired elsewhere land here
  // too, so the row is accurate even if the user didn't start the check.
  useEffect(() => {
    if (!el?.onUpdateStatus) return
    return el.onUpdateStatus((d: { type: string; version?: string; percent?: number }) => {
      if (d.type === 'checking') { setUpdateState('checking'); setUpdateVersion(null) }
      else if (d.type === 'available') { setUpdateState('available'); setUpdateVersion(d.version ?? null) }
      else if (d.type === 'not-available') { setUpdateState('latest'); setTimeout(() => setUpdateState('idle'), 5000) }
      else if (d.type === 'downloading') { setUpdateState('downloading'); setUpdatePercent(d.percent ?? 0) }
      else if (d.type === 'downloaded') { setUpdateState('downloaded'); setUpdateVersion(d.version ?? null) }
      else if (d.type === 'error') { setUpdateState('error'); setTimeout(() => setUpdateState('idle'), 5000) }
    })
  }, [el])

  // Refresh the Discord toggle from app settings each time the menu opens, so
  // the checkmark is accurate even if it changed elsewhere (Settings, hotkey).
  useEffect(() => {
    if (!open || !el?.getAppSettings) return
    el.getAppSettings().then((s: { discordRpcEnabled?: boolean }) => setDiscordOn(!!s.discordRpcEnabled)).catch(() => {})
  }, [open, el])

  // Read the source of truth, flip it, persist, and reflect it — kept open so
  // the checkmark toggles in place.
  const toggleDiscord = async (): Promise<void> => {
    if (!el?.getAppSettings || !el?.setAppSetting) return
    try {
      const s = await el.getAppSettings()
      const next = !s?.discordRpcEnabled
      setDiscordOn(next)
      await el.setAppSetting('discordRpcEnabled', next)
    } catch { /* ignore */ }
  }

  // Kicks off a check (or installs a ready download). Deliberately does NOT
  // close the menu — the row updates in place instead.
  const checkForUpdates = async (): Promise<void> => {
    if (updateState === 'downloaded') { el?.installUpdate?.(); return }
    if (updateState === 'checking' || updateState === 'downloading') return
    setUpdateState('checking')
    try {
      await el?.checkForUpdates?.()
      // If nothing came back through onUpdateStatus, assume up to date.
      setUpdateState((s) => (s === 'checking' ? 'latest' : s))
      setTimeout(() => setUpdateState((s) => (s === 'latest' ? 'idle' : s)), 4000)
    } catch {
      setUpdateState('error')
      setTimeout(() => setUpdateState('idle'), 4000)
    }
  }

  const updateLabel = updateState === 'checking' ? 'Checking for updates…'
    : updateState === 'downloading' ? `Downloading update… ${updatePercent}%`
    : updateState === 'downloaded' ? 'Restart to update'
    : updateState === 'available' ? `Update available${updateVersion ? ` (v${updateVersion})` : ''}`
    : updateState === 'latest' ? 'Up to date'
    : updateState === 'error' ? 'Update check failed'
    : 'Check for updates'
  const updateTrailing: ReactNode =
    updateState === 'checking' || updateState === 'downloading' ? <RefreshCw size={12} className="animate-spin text-text-muted" />
    : updateState === 'downloaded' ? <RefreshCw size={12} className="text-emerald-400" />
    : updateState === 'latest' ? <Check size={12} className="text-emerald-400" />
    : updateState === 'available' ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
    : updateState === 'error' ? <AlertTriangle size={12} className="text-red-400" />
    : null

  // Local library files have no backing API song, so song-scoped entries
  // (report) stay disabled for them.
  const currentSongId = currentTrack ? trackIdToSongId(currentTrack.id) : null
  // Convert only works on an on-disk local file (it transcodes the source);
  // API/stream tracks have no local path to read.
  const canConvert = !!currentTrack?.path && currentTrack.id.startsWith('local-')

  const close = (): void => setOpen(false)
  // ContextMenu closes itself on every click (except `keepOpen` entries), so
  // actions here are the bare behavior.
  const run = (fn: () => void) => fn
  const hk = (id: string) => (): void => runHotkeyAction(id)
  const openGlassLab = (): void => { window.dispatchEvent(new Event('open-glass-lab')) }
  const openShareStudio = (): void => { window.dispatchEvent(new Event('open-share-studio')) }
  const openCommandPalette = (): void => { window.dispatchEvent(new Event('open-command-palette')) }

  const pickLibraryFolder = async (): Promise<void> => {
    const picked = await el?.pickFolder()
    if (picked) addLibraryFolder(picked)
  }

  // Main sets the flag; there's no mirrored store field, so read the live
  // window state rather than tracking a copy that could drift (F11, the OS
  // window buttons and WRLD's focus mode all change it behind our back).
  const toggleFullscreen = async (): Promise<void> => {
    const on = await el?.isFullscreen?.()
    await el?.setFullscreen?.(!on)
  }

  const expertMenus: MenuDef[] = [
    {
      id: 'file', label: 'File',
      entries: [
        { kind: 'item', label: 'Add folder to library…', onClick: run(pickLibraryFolder) },
        { kind: 'item', label: libraryScanning ? 'Scanning library…' : 'Rescan library', hotkey: 'rescan-library', onClick: hk('rescan-library'), disabled: libraryScanning },
        { kind: 'item', label: 'Auto-refresh library', onClick: run(() => setLibraryAutoRefresh(!libraryAutoRefresh)), checked: libraryAutoRefresh },
        { kind: 'sep' },
        { kind: 'item', label: 'Downloads', onClick: run(() => setShowDownloadManager(true)) },
        { kind: 'item', label: 'Clear finished downloads', onClick: run(() => clearCompletedDownloads()) },
        { kind: 'item', label: 'Sync offline playlists', onClick: run(() => syncOfflinePlaylists()) },
        { kind: 'sep' },
        account
          ? { kind: 'item', label: `Log out (${account.display_name || account.discord_username})`, onClick: run(() => logoutAccount()) }
          : { kind: 'item', label: 'Log in…', onClick: run(() => setShowUserAuth(true)) },
        { kind: 'sep' },
        { kind: 'item', label: 'Minimize', onClick: run(() => el?.minimizeWindow?.()) },
        { kind: 'item', label: 'Exit', onClick: run(() => el?.closeWindow?.()) },
      ],
    },
    {
      id: 'edit', label: 'Edit',
      entries: [
        { kind: 'item', label: 'Song info', hotkey: 'song-info', onClick: hk('song-info'), disabled: !currentTrack },
        { kind: 'item', label: 'Edit current song', hotkey: 'edit-song', onClick: hk('edit-song'), disabled: !currentTrack },
        { kind: 'item', label: 'Like current song', hotkey: 'like', onClick: hk('like'), disabled: !currentTrack },
        { kind: 'sep' },
        { kind: 'item', label: 'Report an issue with this song', onClick: run(() => { if (currentSongId != null) openReport({ kind: 'song', songId: currentSongId, songName: currentTrack?.title ?? '' }) }), disabled: currentSongId == null },
        { kind: 'item', label: 'Submit cover art for this song…', onClick: run(() => { if (currentSongId != null) openCoverArtSubmit({ songId: currentSongId, songName: currentTrack?.title ?? '', currentCover: currentTrack?.apiImageUrl ?? currentTrack?.imageUrl }) }), disabled: currentSongId == null || !account },
        { kind: 'sep' },
        { kind: 'item', label: 'Focus search', hotkey: 'focus-search', onClick: hk('focus-search') },
        { kind: 'item', label: 'Clear queue', hotkey: 'clear-queue', onClick: hk('clear-queue') },
        { kind: 'sep' },
        { kind: 'item', label: 'Preferences…', hotkey: 'open-settings', onClick: hk('open-settings') },
      ],
    },
    {
      id: 'view', label: 'View',
      entries: [
        // Every nav destination — including tabs the user has hidden from the
        // side menu — generated from the shared registry, in their arranged
        // order, so a new tab shows here automatically. (electronOnly items are
        // fine: AppMenu only renders on the desktop build.)
        ...orderedNavItems(navOrder).map((it): Entry => {
          const hotkey = VIEW_HOTKEYS[it.view]
          return hotkey
            ? { kind: 'item', label: it.label, hotkey, onClick: hk(hotkey) }
            : { kind: 'item', label: it.label, onClick: run(() => setActiveView(it.view)) }
        }),
        { kind: 'sep' },
        { kind: 'item', label: 'Queue panel', hotkey: 'toggle-queue', onClick: hk('toggle-queue'), checked: showQueue },
        { kind: 'item', label: 'Now playing', onClick: run(() => setShowNowPlaying(!showNowPlaying)), checked: showNowPlaying },
        { kind: 'item', label: 'Equalizer panel', hotkey: 'equalizer', onClick: hk('equalizer'), checked: showEqPanel },
        { kind: 'sep' },
        { kind: 'item', label: 'Full screen', onClick: run(toggleFullscreen) },
      ],
    },
    {
      id: 'controls', label: 'Controls',
      entries: [
        { kind: 'item', label: isPlaying ? 'Pause' : 'Play', hotkey: 'play-pause', onClick: hk('play-pause'), disabled: !currentTrack },
        { kind: 'item', label: 'Next track', hotkey: 'next', onClick: hk('next'), disabled: !currentTrack },
        { kind: 'item', label: 'Previous track', hotkey: 'previous', onClick: hk('previous'), disabled: !currentTrack },
        { kind: 'submenu', label: 'Seek', entries: [
          { kind: 'item', label: 'Skip forward', hotkey: 'seek-forward', onClick: hk('seek-forward'), disabled: !currentTrack },
          { kind: 'item', label: 'Skip backward', hotkey: 'seek-backward', onClick: hk('seek-backward'), disabled: !currentTrack },
        ] },
        { kind: 'sep' },
        { kind: 'item', label: 'Shuffle', hotkey: 'shuffle', onClick: hk('shuffle'), checked: shuffle },
        {
          kind: 'item',
          label: repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat',
          hotkey: 'loop', onClick: hk('loop'), checked: repeat !== 'none',
        },
        { kind: 'sep' },
        { kind: 'submenu', label: 'Volume & speed', entries: [
          { kind: 'item', label: 'Volume up', hotkey: 'volume-up', onClick: hk('volume-up') },
          { kind: 'item', label: 'Volume down', hotkey: 'volume-down', onClick: hk('volume-down') },
          { kind: 'item', label: 'Mute', hotkey: 'mute', onClick: hk('mute') },
          { kind: 'sep' },
          { kind: 'item', label: 'Increase speed', hotkey: 'speed-up', onClick: hk('speed-up') },
          { kind: 'item', label: 'Decrease speed', hotkey: 'speed-down', onClick: hk('speed-down') },
          { kind: 'item', label: `Reset speed (${playbackSpeed.toFixed(2)}x)`, onClick: run(() => setPlaybackSpeed(1)), disabled: playbackSpeed === 1 },
        ] },
        { kind: 'submenu', label: 'Crossfade & playback', entries: [
          { kind: 'item', label: 'Crossfade', hotkey: 'crossfade', onClick: hk('crossfade'), checked: crossfadeEnabled },
          { kind: 'item', label: 'Crossfade duration', combo: `${crossfadeDuration}s`, onClick: run(() => setCrossfade(true, crossfadeDuration >= 12 ? 1 : crossfadeDuration + 1)), disabled: !crossfadeEnabled },
          { kind: 'item', label: 'Smooth pause fade', hotkey: 'smooth-playback', onClick: hk('smooth-playback'), checked: pauseFadeEnabled },
          { kind: 'item', label: 'Prefer OG version', hotkey: 'prefer-og', onClick: hk('prefer-og'), checked: preferOgVersion },
        ] },
        // Web Audio effect chain — same switches as the EQ panel.
        { kind: 'submenu', label: 'Audio effects', entries: [
          { kind: 'item', label: 'Equalizer', onClick: run(() => setEqEnabled(!eqEnabled)), checked: eqEnabled },
          { kind: 'item', label: 'Mono output', onClick: run(() => setEqMono(!eqMono)), checked: eqMono },
          { kind: 'item', label: 'Skip silence', onClick: run(() => setSkipSilence(!skipSilence)), checked: skipSilence },
          { kind: 'item', label: 'Reverb', onClick: run(() => setReverbEnabled(!reverbEnabled)), checked: reverbEnabled },
          { kind: 'item', label: 'Pitch shift', onClick: run(() => setPitchShift(!pitchShift)), checked: pitchShift },
        ] },
        { kind: 'sep' },
        { kind: 'item', label: 'Sleep timer', hotkey: 'sleep-timer', onClick: hk('sleep-timer'), checked: !!sleepTimerEnd },
      ],
    },
    {
      id: 'tools', label: 'Tools',
      entries: [
        { kind: 'item', label: 'Command Palette…', combo: 'Ctrl+K', onClick: openCommandPalette },
        { kind: 'item', label: 'Share Studio (PNG/MP4)…', onClick: openShareStudio, disabled: !currentTrack && !useStore.getState().radioFmActive },
        { kind: 'sep' },
        { kind: 'item', label: 'Identify song…', onClick: () => useStore.getState().setShowRecognition(true) },
        { kind: 'item', label: 'Convert current song…', onClick: run(() => { if (canConvert && currentTrack) openConvert({ id: currentTrack.id, path: currentTrack.path, title: currentTrack.title }) }), disabled: !canConvert },
        // Timing lyrics by hand is for everyone; its Whisper side is a donor
        // feature, and administrators also see everyone's jobs there.
        { kind: 'item', label: 'Synced lyrics…', onClick: run(() => openLyricsGen()) },
        { kind: 'item', label: 'Submit a remix or edit…', onClick: () => useStore.getState().openCommunityEditSubmit() },
        { kind: 'item', label: 'Sync…', onClick: run(() => useCatalogSync.getState().setOpen(true)) },
        { kind: 'sep' },
        { kind: 'item', label: 'Mini player', hotkey: 'mini-player', onClick: hk('mini-player') },
        { kind: 'item', label: 'Close pop-out windows', hotkey: 'close-float-windows', onClick: hk('close-float-windows') },
        { kind: 'sep' },
        { kind: 'item', label: 'Discord status', hotkey: 'discord-status', checked: discordOn, keepOpen: true, onClick: () => { void toggleDiscord() } },
        { kind: 'item', label: 'Last.fm scrobbling', onClick: run(() => setLastfmEnabled(!lastfmEnabled)), checked: lastfmEnabled },
        { kind: 'item', label: 'Global shortcuts', onClick: run(() => setGlobalHotkeysEnabled(!globalHotkeysEnabled)), checked: globalHotkeysEnabled },
        { kind: 'sep' },
        { kind: 'item', label: 'Developer mode', onClick: run(() => setDeveloperMode(!developerMode)), checked: developerMode },
        // Developer tools stay hidden until Developer mode is on.
        ...(developerMode
          ? [
              { kind: 'item' as const, label: 'Glass Lab', onClick: openGlassLab },
              { kind: 'item' as const, label: 'Diagnostics', hotkey: 'open-diagnostics', onClick: hk('open-diagnostics') },
              { kind: 'item' as const, label: 'Open logs folder', onClick: run(() => el?.openLogsFolder?.()) },
              { kind: 'item' as const, label: 'Clear image cache', onClick: run(() => el?.clearImageCache?.()) },
              { kind: 'item' as const, label: 'Toggle DevTools', hotkey: 'toggle-devtools', onClick: hk('toggle-devtools') },
            ]
          : []),
        { kind: 'sep' },
        { kind: 'item', label: 'Restart app', hotkey: 'restart-app', onClick: hk('restart-app') },
      ],
    },
    {
      id: 'help', label: 'Help',
      entries: [
        { kind: 'item', label: 'API docs', onClick: run(() => setActiveView('docs')) },
        { kind: 'item', label: 'Keyboard shortcuts', onClick: run(() => openSettings('shortcuts')) },
        { kind: 'item', label: 'Send feedback…', onClick: run(() => openReport({ kind: 'feedback' })) },
        { kind: 'sep' },
        // keepOpen — the row reports progress in place.
        { kind: 'item', label: updateLabel, trailing: updateTrailing, keepOpen: true, onClick: () => { void checkForUpdates() } },
        { kind: 'item', label: 'Reinstall latest release', onClick: run(() => el?.forceUpdate?.()) },
        { kind: 'sep' },
        { kind: 'item', label: 'GitHub', onClick: run(() => openExternal('https://github.com/Juice-WRLD-API/Unreleased')) },
        { kind: 'item', label: 'Discord', onClick: run(() => openExternal('https://discord.gg/jwa')) },
        { kind: 'item', label: 'Juice WRLD API', onClick: run(() => openExternal('https://juicewrldapi.com')) },
        { kind: 'sep' },
        { kind: 'item', label: `Version ${APP_VERSION}`, onClick: run(() => openSettings('about')) },
      ],
    },
  ]

  const menus: MenuDef[] = developerMode ? expertMenus : [
    { id: 'app', label: 'App', entries: [
      { kind: 'item', label: 'Settings', hotkey: 'open-settings', onClick: hk('open-settings') },
      { kind: 'item', label: 'Keyboard shortcuts', onClick: run(() => openSettings('shortcuts')) },
      { kind: 'sep' },
      { kind: 'item', label: 'Downloads', onClick: run(() => setShowDownloadManager(true)) },
      { kind: 'item', label: 'File archive', onClick: run(() => setActiveView('api-files')) },
      { kind: 'sep' },
      { kind: 'item', label: 'Help & about', onClick: run(() => openSettings('about')) },
      { kind: 'item', label: 'Exit', onClick: run(() => el?.closeWindow?.()) },
    ] },
    { id: 'community', label: 'Around Juice', entries: [
      { kind: 'item', label: '999 FM', onClick: run(() => {
        const state = useStore.getState()
        if (!state.radioFmActive) {
          state.setIsPlaying(false)
          resumeEffectsContext()
          void getActiveRadioClient()?.startListening()?.catch(() => state.setRadioFmActive(false))
          state.setRadioFmActive(true)
        }
        state.setActiveView('wrld')
      }) },
      ...(hasChatAccess(account) ? [{ kind: 'item' as const, label: 'Staff chat', onClick: run(() => setActiveView('chat')) }] : []),
      { kind: 'item', label: 'News', onClick: run(() => setActiveView('news')) },
      { kind: 'item', label: 'Your listening', onClick: run(() => setActiveView('stats')) },
      { kind: 'sep' },
      { kind: 'item', label: 'Heardle', onClick: run(() => setActiveView('heardle')) },
      { kind: 'item', label: 'Wordle', onClick: run(() => setActiveView('wordle')) },
      { kind: 'item', label: 'Tier lists', onClick: run(() => setActiveView('tierlist')) },
      { kind: 'sep' },
      { kind: 'item', label: 'Discord community', onClick: run(() => openExternal('https://discord.gg/jwa')) },
    ] },
    { id: 'create', label: 'Create', entries: [
      { kind: 'item', label: 'Synced lyrics', onClick: run(() => openLyricsGen()) },
      { kind: 'item', label: 'Identify a song', onClick: run(() => useStore.getState().setShowRecognition(true)) },
      { kind: 'item', label: 'Submit a remix or edit', onClick: run(() => useStore.getState().openCommunityEditSubmit()) },
      { kind: 'item', label: 'Share Studio', onClick: openShareStudio, disabled: !currentTrack && !useStore.getState().radioFmActive },
      { kind: 'item', label: 'Convert current song', onClick: run(() => { if (canConvert && currentTrack) openConvert({ id: currentTrack.id, path: currentTrack.path, title: currentTrack.title }) }), disabled: !canConvert },
      { kind: 'item', label: 'Offline catalogue sync', onClick: run(() => useCatalogSync.getState().setOpen(true)) },
    ] },
  ]

  useExitGhost(panelRef, popOut)
  useEscapeToClose(close, open)

  useEffect(() => {
    if (!open) return
    setHoveredRowKey(null)
    const raf = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close()
    }
    const onScroll = (e: Event): void => {
      const target = e.target as Node | null
      if (target && panelRef.current?.contains(target)) return
      close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    setHoveredRowKey(null)
  }, [activeTab])

  const activeMenu = menus.find((m) => m.id === activeTab) ?? menus[0]

  type FlatEntry =
    | { kind: 'sep'; id: string }
    | { kind: 'header'; id: string; label: string; disabled?: boolean }
    | { kind: 'item'; id: string; entry: Extract<Entry, { kind: 'item' }> }

  const flatEntries = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = []
    let idx = 0
    const pushSep = (): void => {
      if (out.length === 0 || out[out.length - 1].kind === 'sep') return
      out.push({ kind: 'sep', id: `sep-${idx++}` })
    }
    const walk = (entries: Entry[]): void => {
      for (const entry of entries) {
        if (entry.kind === 'sep') {
          pushSep()
        } else if (entry.kind === 'submenu') {
          pushSep()
          out.push({ kind: 'header', id: `hdr-${idx++}`, label: entry.label, disabled: entry.disabled })
          walk(entry.entries)
        } else {
          out.push({ kind: 'item', id: `item-${idx++}`, entry })
        }
      }
    }
    walk(activeMenu.entries)
    while (out.length > 0 && out[out.length - 1].kind === 'sep') out.pop()
    return out
  }, [activeMenu])

  const { containerRef: tabsRef, indicatorRef: tabIndicatorRef } = useSlidingIndicator<HTMLDivElement>(activeMenu.id, String(open))
  const { containerRef: listRef, indicatorRef: rowIndicatorRef } = useSlidingIndicator<HTMLDivElement>(hoveredRowKey, `${open}:${activeMenu.id}`)

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const idx = menus.findIndex((m) => m.id === activeMenu.id)
      const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length
      setActiveTab(menus[next].id)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])
      if (items.length === 0) return
      e.preventDefault()
      const curIdx = items.indexOf(document.activeElement as HTMLButtonElement)
      const nextIdx = curIdx < 0
        ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
        : (curIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[nextIdx]?.focus()
      items[nextIdx]?.scrollIntoView({ block: 'nearest' })
    }
  }

  if (!el) return null

  // 'bar' and 'titlebar' share the compact-pill look.
  const isPill = variant === 'bar' || variant === 'titlebar'
  const active = open ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
  const btnClass = isPill
    ? `flex items-center gap-1.5 h-7 pl-2 pr-2 rounded text-xs font-medium transition-colors ${active}`
    : variant === 'sidebar-icon'
      ? `flex items-center justify-center w-8 h-8 rounded transition-colors shrink-0 ${active}`
      : `flex items-center w-full py-2 rounded text-sm font-medium transition-colors gap-3 pl-2 pr-3 ${active}`

  return (
    <div
      className={variant === 'bar' ? 'fixed top-0 left-0 z-[10000] flex items-center h-7'
        : variant === 'titlebar' ? 'flex items-center h-full'
        : variant === 'sidebar' ? 'w-full' : 'shrink-0'}
      style={isPill ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
    >
      <button
        ref={triggerRef}
        onClick={() => {
          const r = triggerRef.current?.getBoundingClientRect()
          if (r) setAnchorRect({ left: r.left, top: r.top, bottom: r.bottom })
          setOpen((o) => !o)
        }}
        title="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className={btnClass}
      >
        <span className={isPill ? 'shrink-0' : variant === 'sidebar-icon' ? 'flex items-center justify-center' : 'w-6 h-6 flex items-center justify-center shrink-0'}>
          <Menu size={isPill ? 14 : 18} />
        </span>
        {variant !== 'sidebar-icon' && (
          <>
            <span
              aria-hidden={collapsed}
              className={`whitespace-nowrap truncate transition-opacity duration-200 ${variant === 'sidebar' ? 'flex-1 text-left' : ''} ${collapsed ? 'w-0 flex-none opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              Menu
            </span>
            {!collapsed && <ChevronDown size={12} className={`shrink-0 transition-transform ${variant === 'sidebar' ? 'ml-auto' : ''} ${open ? 'rotate-180' : ''}`} />}
          </>
        )}
      </button>

      {open && anchorRect && createPortal(
        <ClampedMenu
          ref={panelRef}
          x={anchorRect.left}
          y={anchorRect.bottom + 2}
          anchor={anchorRect}
          zIndex={10000}
          glass
          role="menu"
          aria-label="Application menu"
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
          className="app-menu-glass animate-menu-pop origin-top-left !p-0 !min-w-0 !max-w-none w-[356px] max-w-[calc(100vw-16px)] flex flex-col !overflow-hidden outline-none"
        >
          {/* Category tabs with sliding liquid halo */}
          <div
            ref={tabsRef}
            role="tablist"
            aria-label="Menu categories"
            className="relative isolate flex items-center justify-between gap-0.5 px-2 py-1.5 border-b border-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] shrink-0"
          >
            {menus.map((m) => {
              const isSelected = m.id === activeMenu.id
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-indicator-key={m.id}
                  onMouseEnter={() => setActiveTab(m.id)}
                  onClick={() => setActiveTab(m.id)}
                  className={`flex-1 px-1.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isSelected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  {m.label}
                </button>
              )
            })}
            <div ref={tabIndicatorRef} className="nav-indicator rounded-lg bg-[var(--menu-glass-fill)]" aria-hidden="true" />
          </div>

          {/* Scrollable single-pane item list */}
          <div className="flex-1 min-h-0 max-h-[min(460px,calc(100vh-140px))] overflow-y-auto slim-scroll p-1.5">
            <div
              ref={listRef}
              onMouseLeave={() => setHoveredRowKey(null)}
              className="relative isolate flex flex-col gap-0.5"
            >
              {flatEntries.map((row) => {
                if (row.kind === 'sep') {
                  return <div key={row.id} role="separator" className="h-px mx-2 my-1 bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]" />
                }
                if (row.kind === 'header') {
                  return (
                    <div
                      key={row.id}
                      className={`px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted ${row.disabled ? 'opacity-40' : ''}`}
                    >
                      {row.label}
                    </div>
                  )
                }
                const { entry } = row
                const tokens = comboTokens(entry.combo ?? (entry.hotkey ? effectiveBinding(entry.hotkey, hotkeyBindings) : ''))
                return (
                  <button
                    key={row.id}
                    type="button"
                    role="menuitem"
                    aria-checked={entry.checked !== undefined ? entry.checked : undefined}
                    disabled={entry.disabled}
                    data-indicator-key={!entry.disabled ? row.id : undefined}
                    onMouseEnter={() => { if (!entry.disabled) setHoveredRowKey(row.id) }}
                    onFocus={() => { if (!entry.disabled) setHoveredRowKey(row.id) }}
                    onClick={() => {
                      if (entry.disabled) return
                      entry.onClick()
                      if (!entry.keepOpen) close()
                    }}
                    className={`app-menu-row w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-left transition-colors ${entry.disabled ? 'opacity-40 cursor-not-allowed text-text-muted' : 'text-text-primary cursor-pointer'}`}
                  >
                    <span className="w-4 shrink-0 flex items-center justify-center text-accent">
                      {entry.checked ? <Check size={13} strokeWidth={2.5} /> : null}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{entry.label}</span>
                    {entry.trailing ? (
                      <span className="shrink-0 flex items-center">{entry.trailing}</span>
                    ) : tokens.length > 0 ? (
                      <span className="shrink-0 flex items-center gap-0.5">
                        {tokens.map((t, i) => (
                          <kbd key={i} className="px-1.5 py-0.5 text-[10px] font-medium leading-none rounded bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] text-text-secondary">
                            {t}
                          </kbd>
                        ))}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              <div ref={rowIndicatorRef} className="nav-indicator rounded-[10px] bg-[var(--menu-glass-fill)]" aria-hidden="true" />
            </div>
          </div>
        </ClampedMenu>,
        document.body,
      )}
    </div>
  )
}
