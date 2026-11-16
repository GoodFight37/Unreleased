import { useSyncExternalStore } from 'react'
import { getSkin } from '../skins'

/** Optical controls kept separate from CSS theme colors; callers can derive a
 * preset from a skin's light/dark mode without changing the skin schema. */
export type GlassBase = {
  refractionStrength: number
  blurRadius: number
  rimIntensity: number
  chromaticFringe: number
  tintOpacity: number
  springStiffness: number
}

export type GlassPreset = GlassBase & {
  /** 0 = verre pur, 1 = givre complet (mélange net/flou). */
  frost: number
  /** Intensité des caustiques animées du fond. */
  caustic: number
  /** Courbure du biseau (squircle) sur l'arête. */
  bevel: number
}

export const GLASS_PRESETS: Record<'dark' | 'light', GlassBase> = {
  dark: {
    refractionStrength: 0.048,
    blurRadius: 2.6,
    rimIntensity: 0.36,
    chromaticFringe: 0.004,
    tintOpacity: 0.56,
    springStiffness: 0.22,
  },
  light: {
    refractionStrength: 0.048,
    blurRadius: 2.6,
    rimIntensity: 0.34,
    chromaticFringe: 0.0038,
    tintOpacity: 0.62,
    springStiffness: 0.22,
  },
}

/** Per-skin optical overrides exposed cleanly so themes can tune refraction,
 * frost blur, specular edge, prism dispersion, tint density and spring feel. */
export const GLASS_SKIN_PRESETS: Record<string, GlassBase> = {
  'glass-dark': { refractionStrength: 0.052, blurRadius: 2.8, rimIntensity: 0.40, chromaticFringe: 0.0044, tintOpacity: 0.52, springStiffness: 0.23 },
  'glass-light': { refractionStrength: 0.050, blurRadius: 2.7, rimIntensity: 0.36, chromaticFringe: 0.0040, tintOpacity: 0.58, springStiffness: 0.23 },
  song: { refractionStrength: 0.048, blurRadius: 2.6, rimIntensity: 0.38, chromaticFringe: 0.0042, tintOpacity: 0.55, springStiffness: 0.22 },
  midnight: { refractionStrength: 0.044, blurRadius: 2.3, rimIntensity: 0.35, chromaticFringe: 0.0035, tintOpacity: 0.62, springStiffness: 0.22 },
  ocean: { refractionStrength: 0.054, blurRadius: 2.8, rimIntensity: 0.38, chromaticFringe: 0.0045, tintOpacity: 0.54, springStiffness: 0.20 },
  aurora: { refractionStrength: 0.050, blurRadius: 2.9, rimIntensity: 0.36, chromaticFringe: 0.0044, tintOpacity: 0.56, springStiffness: 0.20 },
  neon: { refractionStrength: 0.055, blurRadius: 2.5, rimIntensity: 0.42, chromaticFringe: 0.0052, tintOpacity: 0.56, springStiffness: 0.25 },
  '999': { refractionStrength: 0.046, blurRadius: 2.4, rimIntensity: 0.38, chromaticFringe: 0.0040, tintOpacity: 0.60, springStiffness: 0.24 },
  ember: { refractionStrength: 0.046, blurRadius: 2.5, rimIntensity: 0.34, chromaticFringe: 0.0038, tintOpacity: 0.58, springStiffness: 0.21 },
  forest: { refractionStrength: 0.045, blurRadius: 2.6, rimIntensity: 0.34, chromaticFringe: 0.0036, tintOpacity: 0.58, springStiffness: 0.20 },
  arctic: { refractionStrength: 0.052, blurRadius: 2.7, rimIntensity: 0.38, chromaticFringe: 0.0042, tintOpacity: 0.58, springStiffness: 0.22 },
  paper: { refractionStrength: 0.042, blurRadius: 2.8, rimIntensity: 0.30, chromaticFringe: 0.0030, tintOpacity: 0.66, springStiffness: 0.20 },
}

export type GlassLookId = 'clear' | 'crystal' | 'obsidian' | 'frost'
type Look = { label: string; refraction: number; rim: number; fringe: number; tint: number; frost: number; caustic: number; bevel: number }
export const GLASS_LOOKS: Record<GlassLookId, Look> = {
  clear: { label: 'Liquid Clear', refraction: 0.042, rim: 0.56, fringe: 0.0026, tint: 0.24, frost: 0.34, caustic: 0.30, bevel: 0.78 },
  frost: { label: 'Soft Frost', refraction: 0.028, rim: 0.34, fringe: 0.0018, tint: 0.34, frost: 0.72, caustic: 0.12, bevel: 0.45 },
  obsidian: { label: 'Obsidian Dark', refraction: 0.036, rim: 0.40, fringe: 0.0024, tint: 0.38, frost: 0.45, caustic: 0.22, bevel: 0.65 },
  crystal: { label: 'Crystal Ice', refraction: 0.048, rim: 0.46, fringe: 0.0036, tint: 0.22, frost: 0.22, caustic: 0.38, bevel: 0.85 },
}
const LOOK_KEY = 'unreleased.glass-look'
const observers = new Set<() => void>()
function readLook(): { id: GlassLookId; intensity: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}')
    const id: GlassLookId = v.id in GLASS_LOOKS ? v.id : 'clear'
    const n = Number(v.intensity)
    return { id, intensity: Number.isFinite(n) && n > 0 ? Math.min(1.5, Math.max(0.5, n)) : 1 }
  } catch { return { id: 'clear', intensity: 1 } }
}
let look = readLook()
let lookKey = `${look.id}:${look.intensity}`
export function getGlassLook() { return look }
export function setGlassLook(next: Partial<{ id: GlassLookId; intensity: number }>): void {
  const merged = { ...look, ...next }
  if (!(merged.id in GLASS_LOOKS)) return
  merged.intensity = Math.min(1.5, Math.max(0.5, Number(merged.intensity) || 1))
  look = merged; lookKey = `${look.id}:${look.intensity}`
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)) } catch { /* cette fenêtre seulement */ }
  observers.forEach(fn => fn())
}
/** À mettre dans les dépendances d'un effet React pour réagir au changement de preset. */
export function useGlassLookKey(): string {
  return useSyncExternalStore(fn => { observers.add(fn); return () => { observers.delete(fn) } }, () => lookKey, () => 'clear:1')
}

function baseFor(skinOrLight?: string | boolean | null): GlassBase {
  if (typeof skinOrLight === 'boolean') return GLASS_PRESETS[skinOrLight ? 'light' : 'dark']
  if (skinOrLight && skinOrLight in GLASS_SKIN_PRESETS) return GLASS_SKIN_PRESETS[skinOrLight]
  return GLASS_PRESETS[getSkin(skinOrLight).dark ? 'dark' : 'light']
}

/** Preset final = ressort/flou du thème + preset de verre choisi, mis à l'échelle par l'intensité. */
export function getGlassPreset(skinOrLight?: string | boolean | null): GlassPreset {
  const base = baseFor(skinOrLight), l = GLASS_LOOKS[look.id], k = look.intensity
  return {
    ...base,
    refractionStrength: l.refraction * k,
    rimIntensity: l.rim * Math.min(k, 1.3),
    chromaticFringe: l.fringe * k,
    tintOpacity: l.tint,
    frost: l.frost,
    caustic: l.caustic * k,
    bevel: Math.min(1.4, l.bevel * k),
  }
}
