export type WrldAtmosphereId = 'auto' | 'lnd' | 'drfl' | 'gbgr' | 'abyss' | 'off'
export type WrldCuratedLyricId = 'classic' | 'karaoke' | 'cinema' | 'fisheye'

function extractAssetPath(url: string): string | null {
  if (url.startsWith('/assets/')) return url
  try {
    const { pathname } = new URL(url)
    return pathname.startsWith('/assets/') ? pathname : null
  } catch {
    return null
  }
}

export interface WrldAtmospherePreset {
  id: WrldAtmosphereId
  label: string
  subtitle: string
  /** Underlying engine mode when gl is available; 'aurora' is the universal 2D fallback. */
  mode: string
  eraLabel: string | null
  /** RGB triplet for the behind-cover ambient aura when not relying solely on --accent-rgb. */
  auraRgb: string | null
}

export const WRLD_ATMOSPHERES: readonly WrldAtmospherePreset[] = [
  {
    id: 'auto',
    label: '999 Era Auto',
    subtitle: 'Adapts to track era & cover',
    mode: 'aurora',
    eraLabel: null,
    auraRgb: null,
  },
  {
    id: 'lnd',
    label: 'Legends Never Die',
    subtitle: 'Celestial rose & violet sky',
    mode: 'nebula',
    eraLabel: 'LEGENDS NEVER DIE',
    auraRgb: '244, 72, 102',
  },
  {
    id: 'drfl',
    label: 'Death Race',
    subtitle: 'Crimson heat & drifting embers',
    mode: 'embers',
    eraLabel: 'DEATH RACE FOR LOVE',
    auraRgb: '224, 96, 72',
  },
  {
    id: 'gbgr',
    label: 'GB&GR',
    subtitle: 'Late-night cobalt rain',
    mode: 'rain',
    eraLabel: 'GOODBYE & GOOD RIDDANCE',
    auraRgb: '96, 165, 250',
  },
  {
    id: 'abyss',
    label: '999 Abyss',
    subtitle: 'Liquid chrome & prism silk',
    mode: 'silk',
    eraLabel: '999 ABYSS',
    auraRgb: '167, 139, 250',
  },
  {
    id: 'off',
    label: 'Off (Game)',
    subtitle: 'Zero canvas motion',
    mode: 'none',
    eraLabel: null,
    auraRgb: null,
  },
]

export interface WrldCuratedLyricStyle {
  id: WrldCuratedLyricId
  label: string
  subtitle: string
}

export const WRLD_CURATED_LYRICS: readonly WrldCuratedLyricStyle[] = [
  { id: 'classic', label: 'Classic', subtitle: 'Scrolling editorial column' },
  { id: 'karaoke', label: 'Karaoke', subtitle: 'Word-lit sing-along' },
  { id: 'cinema', label: 'Cinema', subtitle: 'Widescreen centered lines' },
  { id: 'fisheye', label: '999 Edit', subtitle: '3D lyric-edit lens' },
]

export function isWrldAtmosphereId(v: unknown): v is WrldAtmosphereId {
  return WRLD_ATMOSPHERES.some((p) => p.id === v)
}

export function isWrldCuratedLyricId(v: unknown): v is WrldCuratedLyricId {
  return WRLD_CURATED_LYRICS.some((p) => p.id === v)
}

function inferEraPreset(artUrl?: string | null, album?: string | null): WrldAtmospherePreset | null {
  const eraPath = artUrl ? extractAssetPath(artUrl) : null
  const text = `${album ?? ''} ${eraPath ?? ''}`.toLowerCase()
  if (!text.trim()) return null
  if (text.includes('/lnd') || text.includes('legends never die')) {
    return WRLD_ATMOSPHERES.find((p) => p.id === 'lnd') ?? null
  }
  if (text.includes('/drfl') || text.includes('death race')) {
    return WRLD_ATMOSPHERES.find((p) => p.id === 'drfl') ?? null
  }
  if (text.includes('/gbgr') || text.includes('goodbye') || text.includes('good riddance')) {
    return WRLD_ATMOSPHERES.find((p) => p.id === 'gbgr') ?? null
  }
  if (text.includes('/fd') || text.includes('fighting demons')) {
    return {
      id: 'abyss',
      label: 'Fighting Demons',
      subtitle: 'Storm violet corona',
      mode: 'lightning',
      eraLabel: 'FIGHTING DEMONS',
      auraRgb: '217, 102, 134',
    }
  }
  if (
    text.includes('/tpne') ||
    text.includes('party never ends') ||
    text.includes('/999') ||
    text.includes('/hih_999') ||
    text.includes('/wod') ||
    text.includes('wrld on drugs')
  ) {
    return WRLD_ATMOSPHERES.find((p) => p.id === 'abyss') ?? null
  }
  return null
}

export interface ResolvedWrldAtmosphere {
  vizMode: string
  eraLabel: string | null
  auraRgb: string | null
}

/**
 * Resolves the effective visualizer mode, era tag, and cover aura color from a
 * curated atmosphere choice while honoring WebGL availability and the calm/game toggle.
 */
export function resolveWrldAtmosphere({
  atmosphere,
  animationsOn,
  glSupported,
  artUrl,
  album,
}: {
  atmosphere: WrldAtmosphereId
  animationsOn: boolean
  glSupported: boolean
  artUrl?: string | null
  album?: string | null
}): ResolvedWrldAtmosphere {
  if (!animationsOn || atmosphere === 'off') {
    const inferred = atmosphere === 'auto' ? inferEraPreset(artUrl, album) : WRLD_ATMOSPHERES.find((p) => p.id === atmosphere) ?? null
    return {
      vizMode: 'none',
      eraLabel: inferred?.eraLabel ?? null,
      auraRgb: inferred?.auraRgb ?? null,
    }
  }

  if (atmosphere === 'auto') {
    const matched = inferEraPreset(artUrl, album)
    if (!matched) {
      return { vizMode: glSupported ? 'silk' : 'aurora', eraLabel: null, auraRgb: null }
    }
    return {
      vizMode: glSupported ? matched.mode : 'aurora',
      eraLabel: matched.eraLabel,
      auraRgb: matched.auraRgb,
    }
  }

  const preset = WRLD_ATMOSPHERES.find((p) => p.id === atmosphere) ?? WRLD_ATMOSPHERES[0]
  return {
    vizMode: preset.mode === 'none' ? 'none' : glSupported ? preset.mode : 'aurora',
    eraLabel: preset.eraLabel,
    auraRgb: preset.auraRgb,
  }
}
