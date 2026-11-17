export type WrldBackdropMode = 'mesh' | 'glass' | 'off'
export type WrldCuratedLyricId = 'classic' | 'karaoke' | 'cinema' | 'fisheye'

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
  { id: 'karaoke', label: 'Karaoke', subtitle: 'Word-lit sing-along' },
  { id: 'cinema', label: 'Cinema', subtitle: 'Widescreen centered lines' },
  { id: 'fisheye', label: '999 Edit', subtitle: '3D lyric-edit lens' },
]

export function normalizeWrldBackdrop(v: unknown): WrldBackdropMode {
  if (v === 'off' || v === 'glass' || v === 'mesh') return v
  return 'mesh'
}

export function isWrldCuratedLyricId(v: unknown): v is WrldCuratedLyricId {
  return WRLD_CURATED_LYRICS.some((p) => p.id === v)
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

export interface WrldEraMeta {
  eraLabel: string | null
  eraAsset: string | null
}

/** Resolves Juice WRLD era metadata & baked asset key from album name or art URL. */
export function resolveWrldEra(artUrl?: string | null, album?: string | null): WrldEraMeta {
  const eraAsset = artUrl ? extractAssetPath(artUrl) : null
  const text = `${album ?? ''} ${eraAsset ?? ''}`.toLowerCase()
  if (!text.trim()) return { eraLabel: null, eraAsset }

  if (text.includes('/lnd') || text.includes('legends never die')) {
    return { eraLabel: 'LEGENDS NEVER DIE', eraAsset: eraAsset ?? '/assets/lnd.jpg' }
  }
  if (text.includes('/drfl') || text.includes('death race')) {
    return { eraLabel: 'DEATH RACE FOR LOVE', eraAsset: eraAsset ?? '/assets/drfl.png' }
  }
  if (text.includes('/gbgr') || text.includes('goodbye') || text.includes('good riddance')) {
    return { eraLabel: 'GOODBYE & GOOD RIDDANCE', eraAsset: eraAsset ?? '/assets/gbgr.jpg' }
  }
  if (text.includes('/fd') || text.includes('fighting demons')) {
    return { eraLabel: 'FIGHTING DEMONS', eraAsset: eraAsset ?? '/assets/fd.webp' }
  }
  if (text.includes('/tpne') || text.includes('party never ends')) {
    return { eraLabel: 'THE PARTY NEVER ENDS', eraAsset: eraAsset ?? '/assets/tpne.webp' }
  }
  if (text.includes('/wod') || text.includes('wrld on drugs')) {
    return { eraLabel: 'WRLD ON DRUGS', eraAsset: eraAsset ?? '/assets/wod.jpg' }
  }
  if (text.includes('/999') || text.includes('/hih_999') || text.includes('999 ep')) {
    return { eraLabel: '999 EP', eraAsset: eraAsset ?? '/assets/999.jpg' }
  }
  return { eraLabel: null, eraAsset }
}
