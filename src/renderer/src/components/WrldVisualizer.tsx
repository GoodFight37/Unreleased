import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Monitor, Minimize2, Maximize2, Radio, Settings2, PictureInPicture2, Dices, MessagesSquare, Music2, LayoutGrid, ChevronLeft, Sparkles, Eye, EyeOff, Palette } from 'lucide-react'
import { getSkin } from '../lib/skins'
import { Visualizer, VISUALIZERS, needsWebGL, type VizLayout } from '../lib/viz'
import { WRLD_BACKDROPS, WRLD_CURATED_LYRICS, resolveWrldEra } from '../lib/wrldAtmospheres'
import { useEffectsState } from '../lib/effectsPreference'
import { getAnalysisTap, resumeEffectsContext } from '../lib/audioEffects'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { eventToCombo } from '../lib/hotkeys'
import { hasEscapeLayer, useEscapeToClose } from '../hooks/useEscapeToClose'
import { useStore } from '../store/useStore'
import { useVizStore, useWrldEdgeLook } from '../store/vizStore'
import VizControls, { Toggle } from './VizControls'
import WrldEdgeLight from './WrldEdgeLight'
import LyricsControls from './LyricsControls'
import DesktopSettings from './DesktopSettings'
import { ls } from '../lib/persist'
import { desktopWindowsSupported } from '../desktop/api'
import { eraAssetPath } from '../desktop/artColors'

const DESKTOP_WIDGETS = ['player', 'playlist', 'clock'] as const
type DesktopWidget = (typeof DESKTOP_WIDGETS)[number]
import { NAV_PILL_EVENT } from './AutoHideNav'

// Audio-reactive backdrop for the WRLD tab, plus its toolbar and keys. WRLD
// only mounts while its tab is open, so the engine never renders off-screen.

const IDLE_MS = 2600
// Settings > Desktop is desktop-app only, so its tab in the settings popup is too.
const IS_ELECTRON = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')
const OSD_MS = 1400

const vizName = (id: string): string => VISUALIZERS.find((v) => v.id === id)?.name ?? id

function rectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

// First match that's actually laid out. WRLD mounts a phone layout and a desktop
// layout side by side and hides one with CSS, so a plain querySelector can land
// on the hidden copy and report no rect at all.
function visibleRect(root: ParentNode, selector: string): DOMRect | null {
  for (const el of root.querySelectorAll(selector)) {
    const r = rectOf(el)
    if (r) return r
  }
  return null
}

const toRect = (r: DOMRect, strength: number): VizLayout['protect'][number] =>
  ({ x: r.left, y: r.top, w: r.width, h: r.height, strength })

// Polled by the engine ~10x/s. Circular modes orbit the cover, and every mode
// backs off around text, hardest on the lyric being sung. Elements opt in with
// data-viz attributes inside the fullscreen root, so the layout is described
// where it's rendered instead of being threaded through as refs.
function readLayout(root: HTMLElement | null): VizLayout {
  if (!root) return { focus: null, protect: [], intensity: 1 }

  const cover = visibleRect(root, '[data-viz="cover"]')
  const focus = cover
    // Half the diagonal, so orbiting modes clear the cover's corners.
    ? { x: cover.left + cover.width / 2, y: cover.top + cover.height / 2, r: Math.hypot(cover.width, cover.height) / 2 }
    : null

  const protect: VizLayout['protect'] = []
  const meta = Array.from(root.querySelectorAll('[data-viz="meta"]'), rectOf).filter((r): r is DOMRect => r !== null)
  if (meta.length) {
    const x0 = Math.min(...meta.map((r) => r.left))
    const y0 = Math.min(...meta.map((r) => r.top))
    const x1 = Math.max(...meta.map((r) => r.right))
    const y1 = Math.max(...meta.map((r) => r.bottom))
    protect.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, strength: 0.7 })
  }
  const panel = visibleRect(root, '[data-viz="panel"]')
  if (panel) protect.push(toRect(panel, 0.4))
  const line = panel ? visibleRect(root, '[data-viz-active]') : null
  if (line) protect.push(toRect(line, 0.9))

  return { focus, protect, intensity: panel ? 0.85 : 0.95 }
}

interface Props {
  /** WRLD's page root: scopes layout lookups and carries the idle state. */
  rootRef: React.RefObject<HTMLDivElement>
  /** Cursor hiding, the chrome fade, the hotkeys and exit exist only in fullscreen. */
  fullscreen: boolean
  artUrl: string | null
  /** Display album or era name, used by 999 Era Auto to pick a matching atmosphere. */
  albumName?: string | null
  /** Changes once per track; drives auto-switch. */
  trackKey: string | null
  albumKey: string | null
  /** Whether the current track has lyrics at all - words the lyrics-toggle label. */
  hasLyrics: boolean
  /** 999 FM toggle, shown in the toolbar. */
  fm: { active: boolean; live: boolean; label: string; disabled: boolean; toggle: () => void
    /** Which panel the FM column shows. */
    tab: 'radio' | 'chat' | 'lyrics'; setTab: (t: 'radio' | 'chat' | 'lyrics') => void }
  onEnter: () => void
  onExit: () => void
  onClose: () => void
  /** Desktop app only: pops the compact always-on-top mini player window. */
  onPopOutMini?: () => void
}

export default function WrldVisualizer({
  rootRef, fullscreen, artUrl, albumName, trackKey, albumKey, hasLyrics, fm, onEnter, onExit, onClose, onPopOutMini,
}: Props): JSX.Element {
  // 999 FM plays with isPlaying off; the visualizer stops listening when this is false.
  const isPlaying = useStore((s) => s.isPlaying || (s.radioFmActive && !s.radioFmPaused))
  const developerMode = useStore((s) => s.developerMode)
  const lyricsOverride = useStore((s) => s.lyricsOverride)
  const theme = useStore((s) => s.theme)
  const adaptiveColors = useStore((s) => s.adaptiveColors)
  const setAdaptiveColors = useStore((s) => s.setAdaptiveColors)
  const isAlbumTheme = Boolean(getSkin(theme).art)
  // Random: the queue's own radio (random songs after this one), not 999 FM.
  const randomOn = useStore((s) => s.radioMode && !s.radioFmActive)
  const randomDisabled = useStore((s) => !s.currentTrack && !s.radioMode)
  const setRandomMode = useStore((s) => s.setRandomMode)
  const startRandomRadio = useStore((s) => s.startRandomRadio)
  // The screen light's look, while WRLD's Edge light is on.
  const vizEdgeOverlay = useWrldEdgeLook()
  const { reducedMotion, gameMode } = useEffectsState()
  const {
    activeMode, vizQuality, vizUseArtwork, vizBoost, covered,
    wrldAtmosphere, wrldAnimations, wrldLyricLook, wrldCleanView,
    setWrldAtmosphere, setWrldAnimations, setWrldLyricLook, setWrldCleanView,
  } = useVizStore(useShallow((s) => ({
    activeMode: s.activeMode,
    vizQuality: s.vizQuality,
    vizUseArtwork: s.vizUseArtwork,
    vizBoost: s.vizBoost,
    covered: s.vizCovered > 0,
    wrldAtmosphere: s.wrldAtmosphere,
    wrldAnimations: s.wrldAnimations,
    wrldLyricLook: s.wrldLyricLook,
    wrldCleanView: s.wrldCleanView,
    setWrldAtmosphere: s.setWrldAtmosphere,
    setWrldAnimations: s.setWrldAnimations,
    setWrldLyricLook: s.setWrldLyricLook,
    setWrldCleanView: s.setWrldCleanView,
  })))

  const hostRef = useRef<HTMLDivElement>(null)
  const vizRef = useRef<Visualizer | null>(null)
  const [glSupported, setGlSupported] = useState(true)
  // The Edge light round the edges (WrldEdgeLight): over the visualizer, or on its own with it Off. Without WebGL2 it
  // just doesn't show.
  const [overlayFailed, setOverlayFailed] = useState(false)
  const shownEdge = overlayFailed ? null : vizEdgeOverlay
  const animationsActive = wrldAnimations && !reducedMotion && !gameMode
  const resolvedEra = resolveWrldEra(artUrl, albumName ?? albumKey)
  // Legacy 2D/WebGL visualizer presets run only when Developer Mode explicitly selects one;
  // normal WRLD playback uses the integrated LiquidMeshBackdrop shader instead.
  const engineMode = !animationsActive || !developerMode ? 'none' : activeMode
  // "Off" tears the engine down entirely - no canvases, audio tap or frame loop.
  const off = engineMode === 'none'
  const [showSettings, setShowSettings] = useState(false)
  const [showAmbiance, setShowAmbiance] = useState(false)
  const [cleanPeek, setCleanPeek] = useState(false)
  useEscapeToClose(() => setShowSettings(false), showSettings)
  useEscapeToClose(() => setShowAmbiance(false), showAmbiance)
  // The settings popup's tab, the same one next time.
  const [settingsTab, setSettingsTab] = useState<'viz' | 'desktop'>(() => (ls.get('wrldSettingsTab') === 'desktop' ? 'desktop' : 'viz'))
  const pickSettingsTab = (tab: 'viz' | 'desktop'): void => { setSettingsTab(tab); ls.set('wrldSettingsTab', tab) }

  // ── Engine lifetime ────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host || off) return
    // React owns only the host div. If a lost GL context never comes back the
    // engine swaps its canvas for a fresh clone, and doing that to a
    // React-managed node would pull it out from under the reconciler.
    const canvas = (): HTMLCanvasElement => {
      const c = document.createElement('canvas')
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
      host.appendChild(c)
      return c
    }
    const viz = new Visualizer(canvas(), canvas())
    viz.setLayoutProvider(() => readLayout(rootRef.current))
    vizRef.current = viz
    setGlSupported(viz.glSupported)
    // A saved shader mode can't run without WebGL: the engine would quietly draw
    // Aurora while the saved mode still named the shader. Show what's actually
    // drawn - unsaved, so the same choice still works where WebGL does.
    if (!viz.glSupported) {
      const { activeMode: cur, selectMode } = useVizStore.getState()
      if (needsWebGL(VISUALIZERS.find((v) => v.id === cur))) selectMode('aurora', false)
    }
    // Entering fullscreen is a click, which is the one moment a suspended
    // context is allowed to resume.
    resumeEffectsContext()
    const tap = getAnalysisTap()
    if (tap) viz.enableAudioNode(tap.ctx, tap.node)
    return () => {
      viz.dispose()
      vizRef.current = null
      host.replaceChildren()
    }
  }, [rootRef, off])

  // Still under a picker: its own screens draw instead.
  useEffect(() => { vizRef.current?.setHeld(covered) }, [covered, off])
  useEffect(() => { vizRef.current?.setQuality(vizQuality) }, [vizQuality, off])
  useEffect(() => { vizRef.current?.setBoost(vizBoost) }, [vizBoost, off])
  useEffect(() => { vizRef.current?.setUsePalette(vizUseArtwork) }, [vizUseArtwork, off])
  useEffect(() => {
    const viz = vizRef.current
    if (!viz) return
    // The API site's era images (every tracker song without art of its own) are
    // served with no CORS header, so sampling one can only fail; their palettes
    // are baked ahead of time instead, in eraPalettes.ts.
    const era = artUrl ? eraAssetPath(artUrl) : null
    // An era image the bake hasn't seen yet gets the accent colours.
    if (era) viz.setArtworkPalette(ERA_PALETTES[era] ?? null)
    // Sampled at 48px, so the degraded cover is all it needs.
    else void viz.setArtwork(artUrl ? (smallCoverUrl(artUrl) ?? artUrl) : '')
  }, [artUrl, off])

  useEffect(() => {
    const viz = vizRef.current
    if (!viz) return
    viz.setPlaying(isPlaying)
    // The graph is built on the first play (on mobile, once an effect is on);
    // pick it up here in case this mounted before that happened.
    if (!viz.audioActive) {
      const tap = getAnalysisTap()
      if (tap) viz.enableAudioNode(tap.ctx, tap.node)
    }
  }, [isPlaying, off])

  useEffect(() => {
    const viz = vizRef.current
    if (!viz) return
    viz.setMode(engineMode)
    if (engineMode === 'none') {
      viz.stop()
      return
    }
    viz.syncAccent()
    viz.start()
  }, [engineMode, off])

  // --accent is written to <html>'s inline style by several paths (accent
  // picker, skins, the chat /theme command), so follow the style itself rather
  // than guessing which store fields feed it.
  useEffect(() => {
    const mo = new MutationObserver(() => vizRef.current?.syncAccent())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => mo.disconnect()
  }, [])

  // ── On-screen label ────────────────────────────────────────────────────────
  const [osd, setOsd] = useState({ text: '', show: false })
  const osdTimer = useRef(0)
  const announce = useCallback((text: string): void => {
    setOsd({ text, show: true })
    window.clearTimeout(osdTimer.current)
    osdTimer.current = window.setTimeout(() => setOsd((o) => ({ ...o, show: false })), OSD_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(osdTimer.current), [])

  // ── Idle: toolbar and cursor fade when the mouse rests ─────────────────────
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [idle, setIdle] = useState(false)
  const overToolbar = useRef(false)
  const idleTimer = useRef(0)
  const wake = useCallback((): void => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      if (!overToolbar.current && !toolbarRef.current?.contains(document.activeElement)) setIdle(true)
    }, IDLE_MS)
  }, [])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.addEventListener('pointermove', wake)
    root.addEventListener('pointerdown', wake)
    root.addEventListener('keydown', wake)
    root.addEventListener('focusin', wake)
    root.addEventListener('focusout', wake)
    wake()
    return () => {
      root.removeEventListener('pointermove', wake)
      root.removeEventListener('pointerdown', wake)
      root.removeEventListener('keydown', wake)
      root.removeEventListener('focusin', wake)
      root.removeEventListener('focusout', wake)
      window.clearTimeout(idleTimer.current)
      root.removeAttribute('data-viz-idle')
    }
  }, [rootRef, wake])
  // On the root rather than in state here, so the cursor and WRLD's own
  // chrome can fade with the toolbar without WRLD re-rendering.
  // Cursor hiding and the chrome fade are fullscreen-only; on the tab only the toolbar fades.
  useEffect(() => { rootRef.current?.toggleAttribute('data-viz-idle', idle && fullscreen) }, [rootRef, idle, fullscreen])

  // ── Clear of a top nav pill, only when the two would actually overlap ──────
  // The toolbar is right-anchored, so its horizontal span doesn't depend on
  // its top - compare it to the pill's published edges.
  const [underPill, setUnderPill] = useState(false)
  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const GAP = 8
    const update = (): void => {
      const cs = getComputedStyle(document.documentElement)
      const left = parseFloat(cs.getPropertyValue('--nav-pill-left'))
      const right = parseFloat(cs.getPropertyValue('--nav-pill-right'))
      const r = el.getBoundingClientRect()
      setUnderPill(Number.isFinite(left) && Number.isFinite(right) && r.left < right + GAP && r.right > left - GAP)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener(NAV_PILL_EVENT, update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener(NAV_PILL_EVENT, update)
    }
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────
  // Everything the keys can reach reads the stores fresh, since the key
  // listener is registered once.
  const glRef = useRef(glSupported)
  glRef.current = glSupported
  const usableModes = (): string[] =>
    VISUALIZERS.filter((v) => v.id !== 'none' && (!needsWebGL(v) || glRef.current)).map((v) => v.id)

  const cycle = useCallback((dir: 1 | -1): void => {
    // Unlike auto-switch, the arrows also stop on "Off".
    const ids = VISUALIZERS.filter((v) => !needsWebGL(v) || glRef.current).map((v) => v.id)
    const { activeMode: cur, selectMode } = useVizStore.getState()
    let i = ids.indexOf(cur)
    if (i < 0) i = dir > 0 ? -1 : 0
    const next = ids[(i + dir + ids.length) % ids.length]
    selectMode(next, true)
    announce(vizName(next))
  }, [announce])

  // The real widgets out on the desktop (Windows). Off puts away whichever are out and remembers them; on brings
  // that same set back, or all three the first time.
  const desktopWidgetsSupported = desktopWindowsSupported()
  const desktopWidgetsOn = useStore((s) => s.desktop.player.isOn || s.desktop.playlist.isOn || s.desktop.clock.isOn)
  const toggleDesktopWidgets = (): void => {
    const { desktop, setDesktop } = useStore.getState()
    if (desktopWidgetsOn) {
      ls.set('desktopWidgetsOut', DESKTOP_WIDGETS.filter((w) => desktop[w].isOn))
      setDesktop({ player: { isOn: false }, playlist: { isOn: false }, clock: { isOn: false } })
      announce('Desktop widgets off')
    } else {
      const out = ls.get<DesktopWidget[]>('desktopWidgetsOut') ?? DESKTOP_WIDGETS
      setDesktop({ player: { isOn: out.includes('player') }, playlist: { isOn: out.includes('playlist') }, clock: { isOn: out.includes('clock') } })
      announce('Desktop widgets on')
    }
  }

  // The side panel is driven by the page's own queue/lyrics toggle and the
  // app's "Toggle lyrics" hotkey; this only follows the stores to announce it.
  const showQueue = useStore((s) => s.showQueue)
  const lyricsVisible = fm.active ? !lyricsOverride : hasLyrics !== lyricsOverride
  const panel: 'off' | 'lyrics' | 'queue' | 'radio' | 'chat' = fm.active
    ? (lyricsVisible ? fm.tab : 'off')
    : showQueue ? 'queue' : lyricsVisible ? 'lyrics' : 'off'

  const seenPanel = useRef(panel)
  useEffect(() => {
    if (seenPanel.current === panel) return
    seenPanel.current = panel
    announce(panel === 'queue' ? 'Queue' : panel === 'radio' ? 'Radio' : panel === 'chat' ? 'Chat' : panel === 'lyrics' ? 'Lyrics' : 'Panel off')
  }, [panel, announce])
  // Reset clean capture overlay when leaving WRLD so controls are never stuck hidden on next visit.
  useEffect(() => () => { setWrldCleanView(false) }, [setWrldCleanView])

  // ←/→ in fullscreen and C for Clean stage. Capture phase so these run before
  // the Player's document-level hotkeys; anything else (Space, L, Escape) falls through.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // A dialog or menu open over the fullscreen view owns the keyboard.
      if (hasEscapeLayer()) return
      const combo = eventToCombo(e)
      if (combo === 'KeyC') {
        const next = !useVizStore.getState().wrldCleanView
        useVizStore.getState().setWrldCleanView(next)
        announce(next ? 'Clean stage' : 'Controls shown')
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!fullscreen) return
      if (combo === 'ArrowLeft') cycle(-1)
      else if (combo === 'ArrowRight') cycle(1)
      else return
      e.preventDefault()
      e.stopPropagation()
      wake()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cycle, wake, fullscreen, announce])

  // ── Auto-switch: a random mode per track or album, never saved ─────────────
  const prevTrack = useRef<string | null>(null)
  const prevAlbum = useRef<string | null>(null)
  useEffect(() => {
    const first = prevTrack.current === null
    const trackChanged = trackKey !== prevTrack.current
    const albumChanged = albumKey !== prevAlbum.current
    prevTrack.current = trackKey
    prevAlbum.current = albumKey
    if (first || !trackChanged || !trackKey) return
    const { vizCycle, activeMode: cur, selectMode } = useVizStore.getState()
    if (vizCycle === 'off' || cur === 'none') return
    if (vizCycle === 'album' && !albumChanged) return
    const ids = usableModes().filter((id) => id !== cur)
    if (!ids.length) return
    const next = ids[Math.floor(Math.random() * ids.length)]
    selectMode(next, false)
    announce(vizName(next))
  }, [trackKey, albumKey, announce])

  // The 999 FM card of the Widgets layout (WrldFmWidget); open on its own or while 999 FM is on.
  const wrldWidgets = useVizStore((s) => s.wrldWidgets)
  const setWrldWidgets = useVizStore((s) => s.setWrldWidgets)
  const fmCardAvailable = useVizStore((s) => s.wrldWidgets && s.wrldFm)
  const fmCardShown = useVizStore((s) => fm.active ? !s.wrldFmCollapsed : s.wrldFmOpen)
  const tool = 'w-9 h-9 flex items-center justify-center rounded-[10px] transition-colors disabled:opacity-30 disabled:pointer-events-none'
  const toolIdle = 'text-text-primary hover:bg-[var(--fill-strong)]'
  const toolOn = 'text-text-primary bg-[rgb(var(--accent-rgb)/0.16)]'

  return (
    <>
      {/* Above WRLD's blurred-art background, beneath its content. */}
      <div ref={hostRef} className="absolute inset-0 pointer-events-none" aria-hidden />
      {shownEdge !== null && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {/* One light whatever the look: a new one per look meant a new WebGL context and its programs built again. */}
          <WrldEdgeLight
            look={shownEdge}
            held={covered}
            onUnsupported={() => setOverlayFailed(true)}
          />
        </div>
      )}

      {/* Subtle top-right hover target when Clean stage hides the toolbar for screen recordings */}
      {wrldCleanView && !cleanPeek && (
        <div
          className="absolute top-0 right-0 w-44 h-20 z-30"
          onMouseEnter={() => setCleanPeek(true)}
          aria-hidden
        />
      )}

      <div
        ref={toolbarRef}
        // Clear of the Electron title bar outside fullscreen, and of a top-docked floating nav
        // pill only when they'd overlap.
        style={{ top: `max(${underPill ? 'calc(var(--nav-pill-top, 0px) + 1rem)' : '1rem'}, ${IS_ELECTRON && !fullscreen ? '2.5rem' : '1rem'})` }}
        className={`wrld-toolbar glass-bar absolute right-4 z-40 flex items-center gap-0.5 p-[5px] rounded-[14px] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur-xl border border-[var(--border)] transition-[opacity,transform] duration-200 ${
          ((idle || (wrldCleanView && !cleanPeek)) && !showSettings && !showAmbiance) ? 'opacity-0 -translate-y-1.5 pointer-events-none' : ''
        }`}
        onMouseEnter={() => { overToolbar.current = true }}
        onMouseLeave={() => { overToolbar.current = false; setCleanPeek(false); wake() }}
      >
        <button className="h-9 px-2 flex items-center gap-1 rounded-[10px] text-xs text-text-primary hover:bg-white/10"
          onClick={onClose} title="Back to music (Esc)" aria-label="Close listening view">
          <ChevronLeft size={17} /><span className="hidden sm:inline">Back</span>
        </button>
        <button
          className={`h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-[11px] font-bold tracking-[0.1em] uppercase transition-colors disabled:opacity-30 disabled:pointer-events-none ${fm.active ? (fm.live ? 'text-text-primary bg-red-500/15' : toolOn) : toolIdle}`}
          onClick={fm.toggle}
          disabled={fm.disabled}
          title={fm.active ? 'Turn off 999 FM' : 'Turn on 999 FM'}
          aria-label={fm.active ? 'Turn off 999 FM' : 'Turn on 999 FM'}
          aria-pressed={fm.active}
        >
          <Radio size={15} className={fm.active && fm.live ? 'animate-pulse' : ''} />
          <span>{fm.label}</span>
        </button>
        {developerMode && fmCardAvailable && (
          <button
            className={`${tool} ${fmCardShown ? toolOn : toolIdle}`}
            onClick={() => {
              const viz = useVizStore.getState()
              // While 999 FM is on the card is always up, so the button folds it instead.
              if (fm.active) viz.setWrldFmCollapsed(!viz.wrldFmCollapsed)
              else viz.setWrldFmOpen(!viz.wrldFmOpen)
            }}
            title={fmCardShown ? (fm.active ? 'Fold the 999 FM card' : 'Close the 999 FM card') : 'Open the 999 FM card: chat, votes and up next, without tuning in'}
            aria-label="999 FM card"
            aria-pressed={fmCardShown}
          >
            <MessagesSquare size={17} />
          </button>
        )}
        <button
          className={`h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-[11px] font-bold tracking-[0.1em] uppercase transition-colors disabled:opacity-30 disabled:pointer-events-none ${randomOn ? toolOn : toolIdle}`}
          onClick={() => randomOn ? setRandomMode(false) : startRandomRadio()}
          disabled={randomDisabled}
          title={randomOn ? 'Turn off Random' : 'Play a random song and keep discovering'}
          aria-label={randomOn ? 'Turn off Random' : 'Turn on Random'}
          aria-pressed={randomOn}
        >
          <Dices size={15} />
          <span>Random</span>
        </button>
        <span className="w-px h-5 mx-1 bg-[var(--border)]" />
        <button
          className={`h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-[11px] font-semibold tracking-[0.06em] transition-colors ${showAmbiance ? toolOn : toolIdle}`}
          onClick={() => { setShowSettings(false); setShowAmbiance((v) => !v) }}
          title="Stage ambiance & lyric style"
          aria-label="Stage ambiance"
          aria-expanded={showAmbiance}
        >
          <Sparkles size={15} />
          <span className="hidden lg:inline">999 Stage</span>
        </button>
        <button
          className={`${tool} ${adaptiveColors && !isAlbumTheme ? toolOn : toolIdle} disabled:opacity-35 disabled:pointer-events-none`}
          onClick={() => {
            if (isAlbumTheme) return
            const next = !adaptiveColors
            setAdaptiveColors(next)
            announce(next ? 'Cover colors on' : 'Cover colors off')
          }}
          disabled={isAlbumTheme}
          title={isAlbumTheme ? 'Cover colors follow the active album theme' : adaptiveColors ? 'Cover colors: on' : 'Cover colors: off'}
          aria-label="Cover colors"
          aria-pressed={adaptiveColors && !isAlbumTheme}
        >
          <Palette size={16} />
        </button>
        <button
          className={`${tool} ${wrldCleanView ? toolOn : toolIdle}`}
          onClick={() => {
            const next = !wrldCleanView
            setWrldCleanView(next)
            setShowAmbiance(false)
            setShowSettings(false)
            announce(next ? 'Clean stage' : 'Controls shown')
          }}
          title={wrldCleanView ? 'Show controls (C)' : 'Clean stage for recording (C)'}
          aria-label="Clean stage"
          aria-pressed={wrldCleanView}
        >
          {wrldCleanView ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        {developerMode && <>
        <span className="w-px h-5 mx-1 bg-[var(--border)]" />
        <button
          className={`h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-xs font-medium transition-colors ${toolIdle}`}
          onClick={() => setWrldWidgets(!wrldWidgets)}
          title={wrldWidgets ? 'Focus on music' : 'Show widgets'}
          aria-label={wrldWidgets ? 'Focus on music' : 'Show widgets'}
        >
          {wrldWidgets ? <Music2 size={17} /> : <LayoutGrid size={17} />}
          <span>{wrldWidgets ? 'Music' : 'Widgets'}</span>
        </button>
        <button
          className={`${tool} ${showSettings ? toolOn : toolIdle}`}
          onClick={() => { setShowAmbiance(false); setShowSettings((v) => !v) }}
          title="Visualizer settings"
          aria-label="Visualizer settings"
          aria-expanded={showSettings}
        >
          <Settings2 size={17} />
        </button>
        </>}
        {fullscreen && (
          <>
            <span className="w-px h-5 mx-1 bg-[var(--border)]" />
            <button className={`${tool} ${toolIdle}`} onClick={onExit} title="Exit fullscreen (Esc)" aria-label="Exit fullscreen">
              <Minimize2 size={17} />
            </button>
          </>
        )}
        {!fullscreen && (
          <>
            <span className="w-px h-5 mx-1 bg-[var(--border)]" />
            <button className={`${tool} ${toolIdle}`} onClick={onEnter} title="Fullscreen" aria-label="Fullscreen">
              <Maximize2 size={16} />
            </button>
            {developerMode && onPopOutMini && (
              <button className={`${tool} ${toolIdle}`} onClick={onPopOutMini} title="Pop out mini player" aria-label="Pop out mini player">
                <PictureInPicture2 size={15} />
              </button>
            )}
          </>
        )}
        {showAmbiance && (
          <div className="absolute top-full right-0 mt-2 w-[340px] max-w-[calc(100vw-2rem)] max-h-[75vh] overflow-y-auto p-4 rounded-[16px] bg-[var(--surface)] border border-[var(--border)] shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-text-primary text-xs font-semibold">Stage animations</p>
                <p className="text-text-muted text-[11px]">
                  {!reducedMotion && wrldAnimations ? 'Active visuals & cover aura' : 'Calm mode (zero stage motion)'}
                </p>
              </div>
              <Toggle
                on={wrldAnimations}
                onClick={() => {
                  const next = !wrldAnimations
                  setWrldAnimations(next)
                  announce(next ? 'Stage animations on' : 'Calm mode')
                }}
              />
            </div>

            <div className="pt-3 border-t border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-text-secondary text-xs font-semibold">Backdrop</p>
                {resolvedEra.eraLabel && (
                  <span className="text-[10px] font-semibold tracking-wider uppercase text-accent">
                    {resolvedEra.eraLabel}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {WRLD_BACKDROPS.map((preset) => {
                  const selected = wrldAtmosphere === preset.id
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setWrldAtmosphere(preset.id)
                        announce(preset.label)
                      }}
                      className={`text-left px-3 py-2 rounded-xl border transition-colors ${
                        selected
                          ? 'bg-accent/15 border-[var(--accent)] text-text-primary'
                          : 'border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                      }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight">{preset.label}</div>
                      <div className="text-[10px] opacity-75 leading-tight mt-0.5">{preset.subtitle}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--border)]">
              <p className="text-text-secondary text-xs font-semibold mb-2">Lyric presentation</p>
              <div className="grid grid-cols-2 gap-1.5">
                {WRLD_CURATED_LYRICS.map((style) => {
                  const selected = wrldLyricLook === style.id
                  return (
                    <button
                      key={style.id}
                      onClick={() => {
                        setWrldLyricLook(style.id)
                        announce(`${style.label} lyrics`)
                      }}
                      className={`text-left px-2.5 py-2 rounded-xl border transition-colors ${
                        selected
                          ? 'bg-accent/15 border-[var(--accent)] text-text-primary'
                          : 'border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                      }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight">{style.label}</div>
                      <div className="text-[10px] opacity-75 leading-tight mt-0.5 truncate">{style.subtitle}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        {developerMode && showSettings && (
          <div
            className={`absolute top-full right-0 mt-2 ${IS_ELECTRON && settingsTab === 'desktop' ? 'w-[460px]' : 'w-[400px]'} max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto p-4 rounded-[14px] bg-[var(--surface)] border border-[var(--border)] shadow-2xl`}
          >
            {desktopWidgetsSupported && (
              <button
                className="mb-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary bg-[var(--surface-overlay)] transition-colors hover:bg-[var(--fill-strong)]"
                onClick={toggleDesktopWidgets}
                title="Show the player, playlist and clock on your desktop"
                aria-label="Desktop widgets"
                aria-pressed={desktopWidgetsOn}
              >
                <Monitor size={17} />
                <span className="flex-1 text-left">Desktop widgets</span>
                <span className="text-xs text-text-muted">{desktopWidgetsOn ? 'On' : 'Off'}</span>
              </button>
            )}
            {IS_ELECTRON && (
              <div role="tablist" aria-label="Settings" className="flex rounded-lg border border-[var(--border)] overflow-hidden mb-4">
                {([['viz', 'Visualizer'], ['desktop', 'Desktop']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={settingsTab === id}
                    onClick={() => pickSettingsTab(id)}
                    className={`flex-1 py-1.5 text-[12px] font-medium transition-colors ${
                      settingsTab === id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {IS_ELECTRON && settingsTab === 'desktop' ? <DesktopSettings heading={false} /> : (
              <>
                <VizControls modes={false} wrldStyle />
                <p className="mt-4 mb-3 pt-4 border-t border-[var(--border)] text-text-secondary text-xs font-semibold">Lyrics</p>
                <LyricsControls />
              </>
            )}
          </div>
        )}
      </div>

      <div
        className={`absolute left-1/2 bottom-[7vh] z-40 px-[18px] py-[9px] rounded-[20px] bg-black/45 backdrop-blur-lg text-white text-xs font-bold tracking-[0.12em] uppercase pointer-events-none transition-[opacity,transform] duration-300 ${
          osd.show ? 'opacity-100 -translate-x-1/2 translate-y-0' : 'opacity-0 -translate-x-1/2 translate-y-2'
        }`}
        role="status"
      >
        {osd.text}
      </div>
    </>
  )
}
