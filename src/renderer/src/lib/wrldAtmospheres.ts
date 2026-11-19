export type WrldBackdropMode = 'mesh' | 'glass' | 'off'
export type WrldCuratedLyricId = 'classic' | 'focus' | 'karaoke' | 'cinema' | 'fisheye' | 'cut'
export type WrldFanLyricId = 'classic' | 'focus' | 'cinema' | 'fisheye' | 'cut'
export type EraAtmosphereId = '999' | 'gbgr' | 'drfl' | 'lnd'

export interface WrldBackdropPreset {
  id: WrldBackdropMode
  label: string
  subtitle: string
}

export const WRLD_BACKDROPS: readonly WrldBackdropPreset[] = [
  {
    id: 'mesh',
    label: 'Liquid Mesh',
    subtitle: 'Fluid shader blended from the cover',
  },
  {
    id: 'glass',
    label: 'Quiet Glass',
    subtitle: 'Soft breathing cover backdrop',
  },
  {
    id: 'off',
    label: 'Off (Game)',
    subtitle: 'Static stage, zero motion loop',
  },
]

export interface WrldCuratedLyricStyle {
  id: WrldCuratedLyricId
  label: string
  subtitle: string
}

export const WRLD_CURATED_LYRICS: readonly WrldCuratedLyricStyle[] = [
  { id: 'classic', label: 'Classic', subtitle: 'Scrolling editorial column' },
  { id: 'focus', label: 'Focus', subtitle: 'Current line only, past lyrics hidden' },
  { id: 'karaoke', label: 'Karaoke', subtitle: 'Word-lit sing-along' },
  { id: 'cinema', label: 'Cinema', subtitle: 'Widescreen centered lines' },
  { id: 'fisheye', label: '999 Edit', subtitle: '3D lyric-edit lens' },
  { id: 'cut', label: 'Cut', subtitle: 'Cut-up type, each word lights as it is sung' },
]

/** Fan-facing lyric presentations (Developer mode keeps all extra looks). */
export const WRLD_FAN_LYRICS: readonly { id: WrldFanLyricId; label: string; subtitle: string }[] = [
  { id: 'classic', label: 'Classic', subtitle: 'Scrolling editorial column' },
  { id: 'focus', label: 'Focus', subtitle: 'Current line only, no past lyrics' },
  { id: 'cinema', label: 'Cinema', subtitle: 'Widescreen centered lines' },
  { id: 'fisheye', label: '999', subtitle: '3D lyric-edit lens' },
  { id: 'cut', label: 'Cut', subtitle: 'Cut-up type, each word lights as it is sung' },
]

/** Post frames: how WRLD's lyrics are laid out once Post hides the player. */
export type WrldFrameId = 'classic' | 'word' | 'quiet' | '999'
export const WRLD_FRAMES: readonly { id: WrldFrameId; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'word', label: 'Word' },
  { id: 'quiet', label: 'Quiet' },
  { id: '999', label: '999' },
]
export const normalizeWrldFrame = (v: unknown): WrldFrameId => WRLD_FRAMES.find((f) => f.id === v)?.id ?? 'classic'

/** The words' color in Post: white unless the user turns on one of the two others. */
export type WrldInk = 'white' | 'accent' | 'yellow'
export const normalizeWrldInk = (v: unknown): WrldInk => (v === 'accent' || v === 'yellow' ? v : 'white')

/** Classic frame: a word-timed line cut into pieces of at most `max` words, evenly, so no 1-2 word tail is left. */
export function chunkWords<T>(words: readonly T[], max = 6): T[][] {
  const count = Math.ceil(words.length / max)
  const out: T[][] = []
  let at = 0
  for (let i = 0; i < count; i++) {
    const size = Math.ceil((words.length - at) / (count - i))
    out.push(words.slice(at, at + size))
    at += size
  }
  return out
}

export function normalizeWrldBackdrop(v: unknown): WrldBackdropMode {
  if (v === 'off' || v === 'glass' || v === 'mesh') return v
  return 'mesh'
}

export function isWrldCuratedLyricId(v: unknown): v is WrldCuratedLyricId {
  return WRLD_CURATED_LYRICS.some((p) => p.id === v)
}

export function isWrldFanLyricId(v: unknown): v is WrldFanLyricId {
  return WRLD_FAN_LYRICS.some((p) => p.id === v)
}

function extractAssetPath(url: string): string | null {
  if (url.startsWith('/assets/')) return url
  try {
    const { pathname } = new URL(url)
    return pathname.startsWith('/assets/') ? pathname : null
  } catch {
    return null
  }
}

export interface EraAtmosphereProfile {
  id: EraAtmosphereId
  /** Base drift speed multiplier for the mesh control lattice. */
  speed: number
  /** Audio-reactive u_energy displacement & chroma lift multiplier. */
  energyPush: number
  /** Film grain intensity added in fragment shader (0..0.05). */
  grain: number
  /** 0 = dynamic turbulent displacement, 1 = calm/flatter flow. */
  calmness: number
  /** Subtle warm/cool color temperature bias (-0.15..0.25). */
  warmth: number
  /** True ONLY for Legends Never Die (2-3 slow floating butterflies). */
  butterflies: boolean
}

const ATMOSPHERE_PROFILES: Record<EraAtmosphereId, Omit<EraAtmosphereProfile, 'butterflies'>> = {
  '999': {
    id: '999',
    speed: 1.24,
    energyPush: 0.26,
    grain: 0.032,
    calmness: 0.16,
    warmth: 0.18,
  },
  gbgr: {
    id: 'gbgr',
    speed: 0.72,
    energyPush: 0.15,
    grain: 0.012,
    calmness: 0.68,
    warmth: -0.06,
  },
  drfl: {
    id: 'drfl',
    speed: 1.38,
    energyPush: 0.44,
    grain: 0.022,
    calmness: 0.0,
    warmth: 0.14,
  },
  lnd: {
    id: 'lnd',
    speed: 0.66,
    energyPush: 0.20,
    grain: 0.014,
    calmness: 0.48,
    warmth: 0.04,
  },
}

/** Resolves a distinct mesh atmosphere behavior for any Juice WRLD era or asset. */
export function resolveEraAtmosphere(albumOrEra?: string | null, eraAsset?: string | null): EraAtmosphereProfile {
  const text = `${albumOrEra ?? ''} ${eraAsset ?? ''}`.toLowerCase()
  if (text.includes('/lnd') || text.includes('lnd') || text.includes('legends never die')) {
    return { ...ATMOSPHERE_PROFILES.lnd, butterflies: true }
  }
  if (text.includes('/tpne') || text.includes('tpne') || text.includes('party never ends') || text.includes('/post') || text.includes('posthumous')) {
    return { ...ATMOSPHERE_PROFILES.lnd, speed: 0.88, energyPush: 0.30, calmness: 0.28, butterflies: false }
  }
  if (text.includes('/drfl') || text.includes('drfl') || text.includes('death race') || text.includes('/fd') || text.includes('fighting demons') || text.includes('/out') || text.includes('outsiderz')) {
    const isFd = text.includes('/fd') || text.includes('fighting demons')
    return { ...ATMOSPHERE_PROFILES.drfl, speed: isFd ? 1.12 : 1.38, energyPush: isFd ? 0.34 : 0.44, warmth: isFd ? 0.16 : 0.14, butterflies: false }
  }
  if (text.includes('/gbgr') || text.includes('gb&gr') || text.includes('gbgr') || text.includes('goodbye') || text.includes('good riddance') || text.includes('/wod') || text.includes('wrld on drugs')) {
    return { ...ATMOSPHERE_PROFILES.gbgr, butterflies: false }
  }
  if (text.includes('/999') || text.includes('/hih_999') || text.includes('999') || text.includes('jute') || text.includes('affliction')) {
    return { ...ATMOSPHERE_PROFILES['999'], butterflies: false }
  }
  return { ...ATMOSPHERE_PROFILES['999'], speed: 1.0, energyPush: 0.24, grain: 0.018, butterflies: false }
}

/** Canonical Juice WRLD era start dates for chronological sorting when full /eras/ metadata is absent. */
export const ERA_TIME_FRAMES: Readonly<Record<string, string>> = {
  'jute': 'February 2015',
  'afflictions': 'November 2016',
  'HIH 999': 'February 2017',
  'jw 999': 'May 2017',
  'bdm': 'July 2017',
  'ND': 'November 2017',
  'GB&GR': 'May 2018',
  'WOD': 'October 2018',
  'DRFL': 'March 2019',
  'OUT': 'September 2019',
  'POST': 'December 2019',
  'LND': 'July 2020',
  'FD': 'December 2021',
  'FD (DDE)': 'March 2022',
  'TPP': 'November 2024',
  'TPNE': 'November 2024',
  'TPNE 2.0': 'December 2024',
  'LND (5YAE)': 'July 2025',
}

export interface WrldEraMeta {
  eraLabel: string | null
  eraAsset: string | null
  atmosphere: EraAtmosphereProfile
}

/** Resolves Juice WRLD era metadata, baked asset key & mesh atmosphere from album/era or art URL. */
export function resolveWrldEra(artUrl?: string | null, album?: string | null): WrldEraMeta {
  const eraAsset = artUrl ? extractAssetPath(artUrl) : null
  const text = `${album ?? ''} ${eraAsset ?? ''}`.toLowerCase()
  if (!text.trim()) return { eraLabel: null, eraAsset, atmosphere: resolveEraAtmosphere(null, null) }

  if (text.includes('/lnd') || text.includes('legends never die') || text.includes('lnd')) {
    const asset = eraAsset ?? '/assets/lnd.jpg'
    return { eraLabel: 'LEGENDS NEVER DIE', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  if (text.includes('/drfl') || text.includes('death race') || text.includes('drfl')) {
    const asset = eraAsset ?? '/assets/drfl.png'
    return { eraLabel: 'DEATH RACE FOR LOVE', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  if (text.includes('/gbgr') || text.includes('goodbye') || text.includes('good riddance') || text.includes('gb&gr')) {
    const asset = eraAsset ?? '/assets/gbgr.jpg'
    return { eraLabel: 'GOODBYE & GOOD RIDDANCE', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  if (text.includes('/fd') || text.includes('fighting demons')) {
    const asset = eraAsset ?? '/assets/fd.webp'
    return { eraLabel: 'FIGHTING DEMONS', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  if (text.includes('/tpne') || text.includes('party never ends') || text.includes('tpne')) {
    const asset = eraAsset ?? '/assets/tpne.webp'
    return { eraLabel: 'THE PARTY NEVER ENDS', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  if (text.includes('/wod') || text.includes('wrld on drugs') || text.includes('wod')) {
    const asset = eraAsset ?? '/assets/wod.jpg'
    return { eraLabel: 'WRLD ON DRUGS', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  if (text.includes('/999') || text.includes('/hih_999') || text.includes('999')) {
    const asset = eraAsset ?? '/assets/999.jpg'
    return { eraLabel: '999 EP', eraAsset: asset, atmosphere: resolveEraAtmosphere(album, asset) }
  }
  return { eraLabel: null, eraAsset, atmosphere: resolveEraAtmosphere(album, eraAsset) }
}
