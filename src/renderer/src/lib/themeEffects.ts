import { effectsMotionMedia } from './effectsPreference'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { buildImageUrl } from './juicewrldApi'
import { getFont } from './fonts'
import { useCustomFonts } from '../hooks/useCustomFonts'
import { getSkin, SKIN_OPTIONAL_VAR_KEYS, type Skin } from './skins'
import { GLASS_PRESETS } from './glass/presets'
import { extractCoverPalette, hexToRgb } from './adaptivePalette'

function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `#${Math.min(255, r + amount).toString(16).padStart(2, '0')}${Math.min(255, g + amount).toString(16).padStart(2, '0')}${Math.min(255, b + amount).toString(16).padStart(2, '0')}`
}

// Keeps the phone status bar / Safari toolbar tinted to match the app
// instead of the static dark gray baked into index.html. Reads --surface
// off <html> rather than taking a parameter so every effect that can change
// it (skin, the per-track dynamic palette) can just call this.
//
// Regular Safari tab mode only supports a single flat theme-color - no real
// gradient is possible there, since that pixel is Safari chrome, not our
// page content. With Gradient Surfaces on, --surface alone would read as a
// flat patch next to the glow the rest of the shell has, so this blends in
// a chunk of accent approximating the top-right radial's peak (9% alpha,
// same as .app-shell's in index.css) to get closer to what's actually
// painted just below it. Standalone/PWA mode (black-translucent) doesn't
// need this - there the status bar is translucent over real page content,
// which now carries its own matching gradient (see html.gradients rule in
// index.css).
//
// Note: iOS Safari only picks up a theme-color change on the next full
// navigation/reload - it does not live-retint an already-open tab, even
// though this correctly updates the DOM immediately. Nothing to fix there;
// it's a WebKit limitation, not a bug in this code.
// Exported so full-screen overlays that paint their own fixed black backdrop
// (MediaLightbox) can restore the app's real theme color when they close -
// see the meta[name="theme-color"] override there and the QueuePanel comment
// about Safari's Liquid Glass toolbar sampling a fixed inset-0 element's
// background directly.
export function syncThemeColorMeta(): void {
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (!themeColor) return
  const root = document.documentElement
  const surface = getComputedStyle(root).getPropertyValue('--surface').trim()
  if (!surface) return
  if (!root.classList.contains('gradients') || !surface.startsWith('#')) {
    themeColor.setAttribute('content', surface)
    return
  }
  const accentRgb = getComputedStyle(root).getPropertyValue('--accent-rgb').trim().split(/\s+/).map(Number)
  if (accentRgb.length !== 3 || accentRgb.some(Number.isNaN)) {
    themeColor.setAttribute('content', surface)
    return
  }
  themeColor.setAttribute('content', blendHex(surface, accentRgb, 0.09))
}

// Same Safari-samples-the-actual-pixels issue as MediaLightbox's fixed black
// backdrop, but for the translucent black scrim every mobile bottom sheet
// (mobile/Sheet.tsx) and modal backdrop paints behind it - that darkens
// whatever's currently in the meta tag by the same amount the scrim itself
// darkens the page, so the toolbar dims in step with the sheet instead of
// snapping to black. Call `syncThemeColorMeta()` on close to undo it (it
// recomputes from the real skin vars rather than trying to "undim").
export function dimThemeColorMeta(amount: number): void {
  const themeColor = document.querySelector('meta[name="theme-color"]')
  const current = themeColor?.getAttribute('content')
  if (!themeColor || !current || !current.startsWith('#')) return
  themeColor.setAttribute('content', blendHex(current, [0, 0, 0], amount))
}

function blendHex(hex: string, rgb: number[], amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (base: number, tint: number): number =>
    Math.round(base * (1 - amount) + tint * amount)
  return `#${mix(r, rgb[0]).toString(16).padStart(2, '0')}${mix(g, rgb[1]).toString(16).padStart(2, '0')}${mix(b, rgb[2]).toString(16).padStart(2, '0')}`
}

function applyVars(vars: Skin['vars']): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  // Optional vars must be actively cleared when a skin omits them - unlike the
  // core keys (which every skin sets), a leftover value from a previously
  // active skin would otherwise persist and override the CSS var() fallback.
  for (const key of SKIN_OPTIONAL_VAR_KEYS) {
    if (vars[key] == null) root.style.removeProperty(key)
  }
  syncThemeColorMeta()
}

// Accent currently written to <html>, so an effect rerun with the same value
// doesn't start a cross-fade with nothing to fade.
let appliedAccent: string | null = null

function applyAccentVars(accent: string): void {
  appliedAccent = accent
  const [r, g, b] = hexToRgb(accent)
  const hover = lightenHex(accent, 20)
  const [hr, hg, hb] = hexToRgb(hover)
  const root = document.documentElement
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`)
  root.style.setProperty('--accent-hover', hover)
  root.style.setProperty('--accent-hover-rgb', `${hr} ${hg} ${hb}`)
  syncThemeColorMeta()
}

// ── Palette cross-fade ───────────────────────────────────────────────────────
// Skin and accent changes run through a view transition: Chromium snapshots
// the old frame and cross-fades it into the live new one on the compositor
// (index.css styles the 'palette' type), so the app restyles once. Animating
// the palette vars on <html> instead restyled every element on every frame of
// the fade, which is what made switching skins stutter.

// Set after the persisted skin has painted once, so launch doesn't fade in
// from the first-paint fallback palette.
let fadeReady = false
// Writes waiting for the pending transition's old-frame snapshot. Everything
// painted in the same commit (skin vars, then the accent effect) joins it.
let fadeQueue: Array<() => void> | null = null
// While a fade is playing, further writes land straight in its live new
// frame - that keeps an accent-picker drag from re-snapshotting the window on
// every step.
let fadeRunning = false

const reducedMotion = (): boolean => effectsMotionMedia().matches

function paintPalette(write: () => void, fade = true): void {
  if (fadeQueue) { fadeQueue.push(write); return }
  if (!fade || fadeRunning || !fadeReady || !document.startViewTransition
    || document.visibilityState === 'hidden' || reducedMotion()) {
    write()
    return
  }
  const queue = [write]
  fadeQueue = queue
  fadeRunning = true
  const done = (): void => { fadeRunning = false }
  document.startViewTransition({
    update: () => {
      fadeQueue = null
      for (const w of queue) w()
    },
    types: ['palette'],
  }).finished.then(done, done)
}

// True while the accent vars on <html> came from adaptive cover art rather than
// the user's accentColor - tells useThemeEffects' accent effect to keep its hands off.
let songAccentActive = false

function setSecondaryAccentVars(accent2: string, accent3: string, isLight: boolean): void {
  const root = document.documentElement
  const [r2, g2, b2] = hexToRgb(accent2)
  const [r3, g3, b3] = hexToRgb(accent3)
  root.style.setProperty('--accent-2', accent2)
  root.style.setProperty('--accent-2-rgb', `${r2} ${g2} ${b2}`)
  root.style.setProperty('--accent-3', accent3)
  root.style.setProperty('--accent-3-rgb', `${r3} ${g3} ${b3}`)
  root.style.setProperty('--adaptive-is-light', isLight ? '1' : '0')
}

function clearSecondaryAccentVars(): void {
  const root = document.documentElement
  root.style.removeProperty('--accent-2')
  root.style.removeProperty('--accent-2-rgb')
  root.style.removeProperty('--accent-3')
  root.style.removeProperty('--accent-3-rgb')
  root.style.removeProperty('--adaptive-is-light')
}

// Applies the active skin's CSS variables and the accent-color variables to
// <html>.
export function useThemeEffects(): void {
  const { theme, customSkins, accentColor, appTextScale, appFont, lyricsFont, gradientsEnabled, surfaceGradientsEnabled } = useStorePick(
    'theme', 'customSkins', 'accentColor', 'appTextScale', 'appFont', 'lyricsFont', 'gradientsEnabled', 'surfaceGradientsEnabled',
  )
  // `customSkins` is picked so that editing the active custom skin's palette
  // (which mutates the array, not the theme id) still reruns the effect below
  // and repaints - this is what gives the skin editor its live preview.
  const skin = getSkin(theme)

  // Editing the active custom skin reruns the effect below with the same theme
  // id; those repaints snap so the editor preview follows the picker.
  const paintedTheme = useRef(theme)
  const rememberPalette = (): void => {
    const root = document.documentElement
    const userAccent = useStore.getState().accentColor
    const [r, g, b] = hexToRgb(userAccent)
    const hover = lightenHex(userAccent, 20)
    const [hr, hg, hb] = hexToRgb(hover)
    const vars = {
      ...skin.vars,
      '--accent': songAccentActive ? userAccent : (root.style.getPropertyValue('--accent') || userAccent),
      '--accent-rgb': songAccentActive ? `${r} ${g} ${b}` : (root.style.getPropertyValue('--accent-rgb') || `${r} ${g} ${b}`),
      '--accent-hover': songAccentActive ? hover : (root.style.getPropertyValue('--accent-hover') || hover),
      '--accent-hover-rgb': songAccentActive ? `${hr} ${hg} ${hb}` : (root.style.getPropertyValue('--accent-hover-rgb') || `${hr} ${hg} ${hb}`),
    }
    try { localStorage.setItem('unreleased:startupTheme', JSON.stringify({ id: theme, dark: skin.dark, vars })) } catch { /* storage may be full */ }
  }

  useLayoutEffect(() => {
    const root = document.documentElement
    const preset = GLASS_PRESETS[skin.dark ? 'dark' : 'light']
    for (const [key, value] of Object.entries(preset)) root.style.setProperty(`--glass-${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, String(value))
    const fade = paintedTheme.current !== theme
    paintedTheme.current = theme
    // `.dark` still drives Tailwind dark: variants and color-scheme; the
    // palette itself comes from the skin's vars (inline styles override the
    // :root/.dark fallback blocks in index.css). Every skin sets the same
    // set of keys, so switching skins never leaves stale values behind.
    paintPalette(() => {
      root.classList.toggle('dark', skin.dark)
      applyVars(skin.vars)
      rememberPalette()
    }, fade)
  }, [theme, customSkins])

  useLayoutEffect(() => {
    if (songAccentActive || appliedAccent === accentColor) return
    paintPalette(() => { applyAccentVars(accentColor); rememberPalette() }, appliedAccent !== null)
  }, [accentColor, theme])

  // App-wide text size. Tailwind's type scale (and rem-based spacing) keys
  // off the root font-size, so one declaration scales text everywhere -
  // cleared back to the stylesheet default at 1 so nothing is overridden.
  useEffect(() => {
    document.documentElement.style.fontSize =
      appTextScale === 1 ? '' : `${appTextScale * 100}%`
  }, [appTextScale])

  // Font stacks. --font-app backs Tailwind's font-sans (so it reaches every
  // screen through preflight's <html> rule); --font-lyrics is read by the
  // lyric panels only.
  // customFonts: a choice can resolve to System until its list entry exists
  // (another window just added it), so rerun when the list changes.
  const customFonts = useCustomFonts()
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-app', getFont(appFont).stack)
    root.style.setProperty('--font-lyrics', getFont(lyricsFont).stack)
  }, [appFont, lyricsFont, customFonts])

  // Gradient surfaces - index.css keys the accent-tinted washes and the
  // accent-button sheen off this class. Purely cosmetic overlays on top of
  // the flat palette, so toggling never changes any skin's base colors.
  useEffect(() => {
    document.documentElement.classList.toggle('gradients', gradientsEnabled)
    syncThemeColorMeta()
  }, [gradientsEnabled])

  // Same idea, split into its own class so bg-surface-overlay boxes (toggle
  // groups, search bars, badges, menus) can be turned on/off independently
  // of the shell/sidebar/player/accent gradients above.
  useEffect(() => {
    document.documentElement.classList.toggle('surface-gradients', surfaceGradientsEnabled)
  }, [surfaceGradientsEnabled])

  // Palette cross-fades switch on only after the persisted skin has painted
  // once - two rAFs so the browser has committed a frame with the final
  // startup values, otherwise launch would visibly fade from the first-paint
  // fallback palette.
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => { fadeReady = true })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])
}

/**
 * Reversible additive cover-color override ("Couleurs de la pochette").
 * Active by default on non-album skins (Dark, Light, 999, custom); fixed album
 * themes keep their own baked art/accent, and picking a manual accent pauses
 * the override until the next track or re-enabling the toggle.
 */
export function useAdaptiveAccent(): void {
  const {
    theme,
    customSkins,
    accentColor,
    adaptiveColors,
    adaptiveManualHold,
    currentTrack,
    currentTrackFull,
    radioFmActive,
    radioFmMatchedSong,
    radioFmNowPlaying,
    libraryArt,
  } = useStorePick(
    'theme',
    'customSkins',
    'accentColor',
    'adaptiveColors',
    'adaptiveManualHold',
    'currentTrack',
    'currentTrackFull',
    'radioFmActive',
    'radioFmMatchedSong',
    'radioFmNowPlaying',
    'libraryArt',
  )

  const skin = getSkin(theme)
  const isAlbumTheme = Boolean(skin.art)
  const rawArt = radioFmActive
    ? (radioFmMatchedSong?.imageUrl ?? radioFmNowPlaying?.image_url ?? null)
    : (currentTrackFull?.albumArt ?? currentTrack?.imageUrl ?? (currentTrack ? libraryArt[currentTrack.id] : null) ?? null)
  const artUrl = buildImageUrl(rawArt) || null
  const trackKey = radioFmActive
    ? `fm:${radioFmMatchedSong?.songId ?? radioFmNowPlaying?.title ?? artUrl ?? ''}`
    : `trk:${currentTrack?.id ?? ''}`
  const prevTrackKeyRef = useRef(trackKey)

  useLayoutEffect(() => {
    if (prevTrackKeyRef.current !== trackKey) {
      prevTrackKeyRef.current = trackKey
      if (adaptiveManualHold) {
        useStore.setState({ adaptiveManualHold: false })
        return
      }
    }

    const restore = (): void => {
      clearSecondaryAccentVars()
      if (songAccentActive) {
        songAccentActive = false
        applyAccentVars(useStore.getState().accentColor)
      }
    }

    if (!adaptiveColors || isAlbumTheme || adaptiveManualHold || !artUrl) {
      if (songAccentActive) paintPalette(restore, fadeReady)
      else clearSecondaryAccentVars()
      return
    }

    let cancelled = false
    void extractCoverPalette(artUrl, !skin.dark).then((palette) => {
      if (cancelled) return
      if (!palette) {
        if (songAccentActive) paintPalette(restore, fadeReady)
        else clearSecondaryAccentVars()
        return
      }
      paintPalette(() => {
        applyAccentVars(palette.accent)
        setSecondaryAccentVars(palette.accent2, palette.accent3, palette.isLight)
        songAccentActive = true
      }, fadeReady)
    })

    return () => { cancelled = true }
  }, [theme, customSkins, accentColor, adaptiveColors, adaptiveManualHold, isAlbumTheme, artUrl, trackKey, skin.dark])
}
