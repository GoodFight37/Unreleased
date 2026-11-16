// Skin registry - the single source of truth for every selectable look.
// Each skin owns the full CSS-variable palette that index.css establishes for
// the classic light/dark themes; App.tsx writes `vars` onto <html> whenever
// the active skin changes (inline vars win over the :root/.dark fallbacks,
// which remain only for first paint before React mounts). Adding a skin here
// is all it takes for it to show up in Settings → Appearance.

// Built-in skin ids are a closed set; user-created skins get generated string
// ids (see newSkinId). The `(string & {})` arm keeps autocomplete for the
// built-ins while still accepting any custom id where a SkinId is expected.
export type BuiltinSkinId =
  | 'glass-dark'
  | 'glass-light'
  | '999'
  | 'gbgr'
  | 'drfl'
  | 'lnd'
  | 'fd'

// eslint-disable-next-line @typescript-eslint/ban-types
export type SkinId = BuiltinSkinId | (string & {})

export interface SkinVars {
  '--surface': string
  '--surface-raised': string
  '--surface-overlay': string
  '--surface-highest': string
  '--sidebar': string
  '--titlebar': string
  '--text-primary': string
  '--text-secondary': string
  '--text-muted': string
  '--border': string
  '--scrollbar': string
  // Optional overrides for the frameless-window title-bar cluster (minimize /
  // maximize / close). Absent on the built-in skins,
  // which inherit --text-muted (idle) / --text-primary (hover) via CSS var
  // fallback - see WindowControls. A custom skin can set these to make the
  // window controls legible on a title bar where muted text is too faint.
  '--titlebar-icon'?: string
  '--titlebar-icon-hover'?: string
}

export interface Skin {
  id: SkinId
  name: string
  // Whether the `.dark` class goes on <html> - drives Tailwind `dark:`
  // variants and the CSS `color-scheme` (native controls, scrollbars).
  dark: boolean
  // Signature accent applied via setAccentColor when the skin is picked.
  // The classic light/dark skins leave it unset so switching between them
  // keeps whatever accent the user already chose.
  accent?: string
  // Dynamic skins derive their palette at runtime (from the current song's
  // cover art - see useThemeEffects); `vars` is only the fallback shown while
  // nothing is playing or extraction fails.
  dynamic?: boolean
  // User-created (built in the in-app skin editor / imported). Custom skins
  // live in the store's `customSkins`, not this hardcoded registry, and are
  // editable, deletable, and exportable - see lib/skins helpers below.
  custom?: boolean
  /** Album themes: the album cover (API path, built with buildImageUrl) that
   *  stands in for the playing song's art behind the window and in the glass. */
  art?: string
  vars: SkinVars
}

// The palette variables in edit order, with UI labels/hints - the single
// source the skin editor iterates over and importer validates against, so a
// new variable only has to be added here (and to SkinVars) once.
export const SKIN_VAR_META: { key: keyof SkinVars; label: string; hint: string }[] = [
  { key: '--surface', label: 'Background', hint: 'Main app background' },
  { key: '--surface-raised', label: 'Raised surface', hint: 'Cards, rows, panels' },
  { key: '--surface-overlay', label: 'Overlay', hint: 'Hover / menus' },
  { key: '--surface-highest', label: 'Highest surface', hint: 'Active / pressed' },
  { key: '--sidebar', label: 'Sidebar', hint: 'Side navigation' },
  { key: '--titlebar', label: 'Title bar', hint: 'Window title strip' },
  { key: '--text-primary', label: 'Primary text', hint: 'Headings, main text' },
  { key: '--text-secondary', label: 'Secondary text', hint: 'Subtitles' },
  { key: '--text-muted', label: 'Muted text', hint: 'Hints, captions' },
  { key: '--border', label: 'Border', hint: 'Dividers, outlines' },
  { key: '--scrollbar', label: 'Scrollbar', hint: 'Scrollbar thumb' },
]

// Optional palette variables - editable in the skin editor but not required in
// a skin file (they fall back via CSS var() when unset). Kept apart from the
// core meta above so import validation only *requires* the core keys.
export const SKIN_OPTIONAL_VAR_META: { key: keyof SkinVars; label: string; hint: string }[] = [
  { key: '--titlebar-icon', label: 'Title-bar icons', hint: 'Min / max / close, downloads' },
  { key: '--titlebar-icon-hover', label: 'Title-bar icons (hover)', hint: 'Hover state of those icons' },
]

export const SKIN_OPTIONAL_VAR_KEYS = SKIN_OPTIONAL_VAR_META.map((m) => m.key)

export const SKINS: Skin[] = [
  {
    // iOS system colors: true black with the grouped grays for raised
    // surfaces, and the music-app red accent. The black lets the frosted
    // player and panels read most clearly.
    id: 'glass-dark',
    name: 'Dark',
    dark: true,
    accent: '#fb3a54',
    vars: {
      '--surface': '#000000',
      '--surface-raised': '#1c1c1e',
      '--surface-overlay': '#2c2c2e',
      '--surface-highest': '#3a3a3c',
      '--sidebar': '#000000',
      '--titlebar': '#000000',
      '--text-primary': '#ffffff',
      '--text-secondary': '#aeaeb2',
      '--text-muted': '#a8abb2',
      '--border': 'rgba(84, 84, 88, 0.6)',
      '--scrollbar': '#3a3a3c',
    },
  },
  {
    // Light counterpart. Muted text is calibrated to keep >= 4.5:1 even over
    // tinted/gradient surfaces, not only pure white.
    id: 'glass-light',
    name: 'Light',
    dark: false,
    accent: '#cf1a33',
    vars: {
      '--surface': '#ffffff',
      '--surface-raised': '#f2f2f7',
      '--surface-overlay': '#e9e9eb',
      '--surface-highest': '#d1d1d6',
      '--sidebar': '#f2f2f7',
      '--titlebar': '#f2f2f7',
      '--text-primary': '#000000',
      '--text-secondary': '#3c3c43',
      '--text-muted': '#575a61',
      '--border': 'rgba(60, 60, 67, 0.29)',
      '--scrollbar': '#c7c7cc',
    },
  },
  {
    // Near-black with red-tinted surfaces and a true red accent.
    id: '999',
    name: '999',
    dark: true,
    accent: '#f0404f',
    vars: {
      '--surface': '#0f0a0a',
      '--surface-raised': '#181010',
      '--surface-overlay': '#231616',
      '--surface-highest': '#2d1c1c',
      '--sidebar': '#090606',
      '--titlebar': '#090606',
      '--text-primary': '#fbeeee',
      '--text-secondary': '#c9a9a9',
      '--text-muted': '#a68888',
      '--border': 'rgba(255, 90, 90, 0.12)',
      '--scrollbar': '#3f2626',
    },
  },
  {
    // Goodbye & Good Riddance: paper white and ink grey of the cover, its blue car as accent (darkened for AA).
    id: 'gbgr',
    name: 'Goodbye & Good Riddance',
    dark: false,
    accent: '#1b6488',
    art: '/assets/gbgr.webp',
    vars: {
      '--surface': '#f8f7f2',
      '--surface-raised': '#f0ece0',
      '--surface-overlay': '#e6e0cf',
      '--surface-highest': '#d8d0bc',
      '--sidebar': '#f0ece0',
      '--titlebar': '#f0ece0',
      '--text-primary': '#1d1c22',
      '--text-secondary': '#45464d',
      '--text-muted': '#5d5862',
      '--border': 'rgba(69, 70, 77, 0.22)',
      '--scrollbar': '#c9c1ad',
    },
  },
  {
    // Death Race for Love: the cover's scorched browns and near-black, rust as accent.
    id: 'drfl',
    name: 'Death Race for Love',
    dark: true,
    accent: '#d4634a',
    art: '/assets/drfl.webp',
    vars: {
      '--surface': '#120b0a',
      '--surface-raised': '#1d1311',
      '--surface-overlay': '#291b18',
      '--surface-highest': '#362420',
      '--sidebar': '#0c0706',
      '--titlebar': '#0c0706',
      '--text-primary': '#f6ece8',
      '--text-secondary': '#cdb8af',
      '--text-muted': '#ab958b',
      '--border': 'rgba(156, 137, 126, 0.16)',
      '--scrollbar': '#4a3530',
    },
  },
  {
    // Legends Never Die: the cover's plum dusk and rose sky, coral pink as accent.
    id: 'lnd',
    name: 'Legends Never Die',
    dark: true,
    accent: '#f55d77',
    art: '/assets/lnd.webp',
    vars: {
      '--surface': '#170d13',
      '--surface-raised': '#22141d',
      '--surface-overlay': '#2e1c28',
      '--surface-highest': '#3c2534',
      '--sidebar': '#10090d',
      '--titlebar': '#10090d',
      '--text-primary': '#fff1f4',
      '--text-secondary': '#e8bcc3',
      '--text-muted': '#c99aa7',
      '--border': 'rgba(214, 106, 124, 0.16)',
      '--scrollbar': '#523448',
    },
  },
  {
    // Fighting Demons: the cover's moonlit greys and black, muted mauve as accent.
    id: 'fd',
    name: 'Fighting Demons',
    dark: true,
    accent: '#9a8387',
    art: '/assets/fd.webp',
    vars: {
      '--surface': '#0b0909',
      '--surface-raised': '#151112',
      '--surface-overlay': '#1f1a1b',
      '--surface-highest': '#2b2426',
      '--sidebar': '#070606',
      '--titlebar': '#070606',
      '--text-primary': '#f6efef',
      '--text-secondary': '#c5b3b3',
      '--text-muted': '#a3929a',
      '--border': 'rgba(197, 179, 179, 0.12)',
      '--scrollbar': '#3a2e31',
    },
  },
]

// ── Custom-skin cache ─────────────────────────────────────────────────────────
// User-created skins live in the Zustand store (persisted to localStorage), but
// getSkin() is a pure lookup called from places that can't reach the store -
// the store's own `theme` initializer, and songToTrack-style module code. So the
// store mirrors its `customSkins` array into this module cache on every write
// (setCustomSkinsCache), exactly like lib/songPrefs. Seed it before the store's
// `theme` initializer runs so a persisted custom skin resolves on first paint.
let _customSkins: Skin[] = []

export function setCustomSkinsCache(skins: Skin[]): void {
  _customSkins = skins
}

/** The full pick list: built-in skins only (custom skins retired from the UI on 2026-11-16). */
export function allSkins(): Skin[] {
  return SKINS
}

// The skin a new install starts on, and what unknown or deleted ids fall back to.
export const DEFAULT_SKIN_ID: BuiltinSkinId = 'glass-dark'

// Skins retired on 2026-11-16 (only Dark, Light and the album themes remain):
// the light ones land on Light, every other old id on Dark.
const RETIRED_LIGHT_SKINS = new Set(['light', 'blossom', 'paper', 'arctic', 'mint', 'lavender', 'solar', 'peach', 'sunshine', 'sage', 'mist'])

// Unknown, retired or custom ids (synced from the server or another build)
// resolve to Dark or Light; custom skins keep only their darkness.
export function getSkin(id: string | null | undefined): Skin {
  const builtin = SKINS.find((s) => s.id === id)
  if (builtin) return builtin
  const custom = _customSkins.find((s) => s.id === id)
  const light = custom ? !custom.dark : RETIRED_LIGHT_SKINS.has(id ?? '')
  return SKINS.find((s) => s.id === (light ? 'glass-light' : DEFAULT_SKIN_ID)) ?? SKINS[0]
}

// ── Custom-skin authoring / import-export ─────────────────────────────────────

const SKIN_FILE_FORMAT = 'unreleased-skin'
const SKIN_FILE_VERSION = 1

// Generated id for a user skin - the `custom-` prefix keeps it clear of every
// built-in id, and the random suffix avoids collisions across quick creates.
export function newSkinId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// Accepts the CSS color forms the palettes actually use - hex, rgb/rgba,
// hsl/hsla, and bare keywords - while rejecting anything long or structural, so
// an imported file can't smuggle arbitrary text into a style property.
export function isColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]*\)|hsla?\([\d.,\s%deg]*\)|[a-zA-Z]+)$/.test(value.trim())
  )
}

/** A fresh editable skin cloned from `base` (defaults to classic dark). */
export function createCustomSkin(base: Skin = SKINS[0], name?: string): Skin {
  return {
    id: newSkinId(),
    name: (name ?? `${base.name} copy`).slice(0, 40),
    dark: base.dark,
    custom: true,
    accent: base.accent,
    // Never carry `dynamic` onto a custom skin - its vars are the real palette.
    vars: { ...base.vars },
  }
}

/** Serializes a skin to the text written to an exported `.json` file. */
export function skinToFileText(skin: Skin): string {
  return JSON.stringify(
    {
      format: SKIN_FILE_FORMAT,
      version: SKIN_FILE_VERSION,
      skin: { name: skin.name, dark: skin.dark, accent: skin.accent, vars: skin.vars },
    },
    null,
    2,
  )
}

/** A filesystem-safe base name for the exported file. */
export function skinFileName(skin: Skin): string {
  const base = skin.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'skin'}.jwskin.json`
}

/**
 * Parses (and validates) an exported skin file back into a fresh Skin with a
 * new id. Accepts either the wrapped `{ format, version, skin }` envelope or a
 * bare skin object. Returns null on anything malformed - every palette variable
 * must be present and a plausible color, so a bad file can't half-apply.
 */
export function parseSkinFile(text: string): Skin | null {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const wrapped = obj as { skin?: unknown }
  const src = (wrapped.skin && typeof wrapped.skin === 'object' ? wrapped.skin : obj) as {
    name?: unknown
    dark?: unknown
    accent?: unknown
    vars?: Record<string, unknown>
  }
  const vars = {} as SkinVars
  for (const { key } of SKIN_VAR_META) {
    const v = src.vars?.[key]
    if (!isColor(v)) return null
    vars[key] = v
  }
  // Optional vars only carry over when present and valid; a missing one just
  // stays unset (and inherits at render time).
  for (const key of SKIN_OPTIONAL_VAR_KEYS) {
    const v = src.vars?.[key]
    if (isColor(v)) vars[key] = v
  }
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : 'Imported skin'
  return {
    id: newSkinId(),
    name,
    dark: !!src.dark,
    custom: true,
    accent: isColor(src.accent) ? src.accent : undefined,
    vars,
  }
}
