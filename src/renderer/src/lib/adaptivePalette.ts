import { fetchImageBlob } from './coverImage'
import { ERA_PALETTES } from './eraPalettes'
import { JWAPI_HOST, smallCoverUrl } from './juicewrldApi'

export interface HSB {
  hue: number // 0..360
  saturation: number // 0..1
  brightness: number // 0..1
}

export interface CoverColor extends HSB {
  rgb: [number, number, number] // 0..255
  hex: string
}

export interface CoverPalette {
  dominant: CoverColor
  complementary: CoverColor
  tertiary: CoverColor
  accent: string
  accent2: string
  accent3: string
  isLight: boolean
  luma: number
}

interface RawCoverPalette {
  dominant: CoverColor
  complementary: CoverColor
  tertiary: CoverColor
  isLight: boolean
  luma: number
}

interface RawCoverStats {
  palette: RawCoverPalette | null
  luma: number
}

const SAMPLE_SIDE = 40
const CACHE_CAP = 200
const rawCache = new Map<string, Promise<RawCoverStats | null>>()

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function eraAssetPath(url: string): string | null {
  if (url.startsWith('/assets/')) return url
  try {
    const { hostname, pathname } = new URL(url)
    const apiHost = hostname === JWAPI_HOST || hostname.endsWith(`.${JWAPI_HOST}`)
    return apiHost && pathname.startsWith('/assets/') ? pathname : null
  } catch {
    return null
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16)
  if (!Number.isFinite(num)) return [224, 89, 47]
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360
  const sn = clamp(s, 0, 1)
  const ln = clamp(l, 0, 1)
  if (sn === 0) {
    const v = Math.round(ln * 255)
    return [v, v, v]
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const hue2rgb = (t: number): number => {
    const tn = ((t % 1) + 1) % 1
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }
  return [
    Math.round(hue2rgb(hh + 1 / 3) * 255),
    Math.round(hue2rgb(hh) * 255),
    Math.round(hue2rgb(hh - 1 / 3) * 255),
  ]
}

export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l)
  return rgbToHex(r, g, b)
}

export function hsbToRgb(hue: number, saturation: number, brightness: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60
  const s = clamp(saturation, 0, 1)
  const v = clamp(brightness, 0, 1)
  const c = v * s
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = v - c
  let rn = 0, gn = 0, bn = 0
  if (h < 1) { rn = c; gn = x }
  else if (h < 2) { rn = x; gn = c }
  else if (h < 3) { gn = c; bn = x }
  else if (h < 4) { gn = x; bn = c }
  else if (h < 5) { rn = x; bn = c }
  else { rn = c; bn = x }
  return [Math.round((rn + m) * 255), Math.round((gn + m) * 255), Math.round((bn + m) * 255)]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const s = max > 0 ? d / max : 0
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return [h, s, max]
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number): number => {
    const s = clamp(v, 0, 255) / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(rgbA: [number, number, number], rgbB: [number, number, number]): number {
  const la = relativeLuminance(...rgbA)
  const lb = relativeLuminance(...rgbB)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Hue-preserving AMLL / Aura tone-mapping curve.
 * Compresses extreme shadows (~0.14) and highlights (~0.86) while stretching
 * chroma up to 1.9x without brown mud or hue rotation.
 */
export function amllToneMapRgb(r: number, g: number, b: number): [number, number, number] {
  const luma = 0.30 * r + 0.59 * g + 0.11 * b
  const tone = luma * 0.72 + 0.14
  const dr = r - luma
  const dg = g - luma
  const db = b - luma
  let gain = 1.9
  if (dr > 1e-5) gain = Math.min(gain, (1 - tone) / dr)
  else if (dr < -1e-5) gain = Math.min(gain, -tone / dr)
  if (dg > 1e-5) gain = Math.min(gain, (1 - tone) / dg)
  else if (dg < -1e-5) gain = Math.min(gain, -tone / dg)
  if (db > 1e-5) gain = Math.min(gain, (1 - tone) / db)
  else if (db < -1e-5) gain = Math.min(gain, -tone / db)
  gain = Math.max(0, gain)
  return [
    clamp(tone + dr * gain, 0, 1),
    clamp(tone + dg * gain, 0, 1),
    clamp(tone + db * gain, 0, 1),
  ]
}

/** Adjusts HSL lightness so UI accent controls hit WCAG AA (>= 4.5:1) on dark or light surfaces. */
export function adaptAccentForSurface(hex: string, isLightSurface: boolean): string {
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  const sat = clamp(s, 0.55, 0.96)
  const refBg: [number, number, number] = isLightSurface ? [242, 242, 247] : [28, 28, 30]
  let curL = isLightSurface ? clamp(l, 0.24, 0.38) : clamp(l, 0.62, 0.74)

  for (let step = 0; step < 24; step++) {
    const rgb = hslToRgb(h, sat, curL)
    if (contrastRatio(rgb, refBg) >= 4.55) return rgbToHex(...rgb)
    curL = isLightSurface ? Math.max(0.18, curL - 0.02) : Math.min(0.84, curL + 0.02)
  }
  return hslToHex(h, sat, curL)
}

function makeCoverColor(hue: number, saturation: number, brightness: number): CoverColor {
  const h = ((hue % 360) + 360) % 360
  const s = clamp(saturation, 0.55, 1)
  const v = clamp(brightness, 0.75, 1)
  const rgb = hsbToRgb(h, s, v)
  return { hue: h, saturation: s, brightness: v, rgb, hex: rgbToHex(...rgb) }
}

/**
 * Pure pixel extraction: applies AMLL tone-mapping, votes into 36×10° buckets
 * weighted by s²·v·√pop with 50% Gaussian neighbor bleed, and picks dominant,
 * complementary (>= 60° apart) and tertiary (>= 25° apart) vibrant swatches.
 * Returns null for effectively monochrome/greyscale artwork.
 */
export function extractCoverPaletteFromPixels(
  data: ArrayLike<number>,
  isLightSurface = false,
): CoverPalette | null {
  const BUCKETS = 36
  const rawWeight = new Float64Array(BUCKETS)
  const pop = new Int32Array(BUCKETS)
  const hueX = new Float64Array(BUCKETS)
  const hueY = new Float64Array(BUCKETS)
  const satSum = new Float64Array(BUCKETS)
  const briSum = new Float64Array(BUCKETS)

  let totalPixels = 0
  let colorfulPixels = 0
  let toneLumaSum = 0

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    totalPixels++
    const [tr, tg, tb] = amllToneMapRgb(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)
    toneLumaSum += 0.2126 * tr + 0.7152 * tg + 0.0722 * tb

    const [h, s, v] = rgbToHsv(tr, tg, tb)
    if (s < 0.25 || v < 0.18) continue

    colorfulPixels++
    const w = s * s * v
    const bucket = Math.min(BUCKETS - 1, Math.floor(h / 10))
    const rad = (h * Math.PI) / 180
    rawWeight[bucket] += w
    pop[bucket] += 1
    hueX[bucket] += Math.cos(rad) * w
    hueY[bucket] += Math.sin(rad) * w
    satSum[bucket] += s * w
    briSum[bucket] += v * w
  }

  if (totalPixels === 0 || colorfulPixels < Math.max(8, totalPixels * 0.02)) {
    return null
  }

  // Bucket strength: mean(s²·v) * √pop = (rawWeight / pop) * √pop
  const base = new Float64Array(BUCKETS)
  for (let b = 0; b < BUCKETS; b++) {
    if (pop[b] > 0) base[b] = (rawWeight[b] / pop[b]) * Math.sqrt(pop[b])
  }

  const score = new Float64Array(BUCKETS)
  for (let b = 0; b < BUCKETS; b++) {
    const prev = base[(b + BUCKETS - 1) % BUCKETS]
    const next = base[(b + 1) % BUCKETS]
    score[b] = base[b] + 0.5 * (prev + next)
  }

  let best = -1
  for (let b = 0; b < BUCKETS; b++) {
    if (pop[b] > 0 && (best < 0 || score[b] > score[best])) best = b
  }
  if (best < 0 || score[best] <= 0) return null

  const bucketColor = (b: number): CoverColor => {
    const w = rawWeight[b] || 1
    const hue = (Math.atan2(hueY[b], hueX[b]) * 180) / Math.PI
    return makeCoverColor(hue, satSum[b] / w, briSum[b] / w)
  }

  const bucketDist = (a: number, b: number): number => {
    const d = Math.abs(a - b)
    return Math.min(d, BUCKETS - d)
  }

  const dominant = bucketColor(best)

  let compIdx = -1
  for (const minSep of [6, 4]) {
    for (let b = 0; b < BUCKETS; b++) {
      if (pop[b] === 0 || bucketDist(b, best) < minSep) continue
      if (score[b] < score[best] * 0.06) continue
      if (compIdx < 0 || score[b] > score[compIdx]) compIdx = b
    }
    if (compIdx >= 0) break
  }
  const complementary = compIdx >= 0
    ? bucketColor(compIdx)
    : makeCoverColor(dominant.hue + 42, dominant.saturation * 0.92, dominant.brightness * 0.96)

  let tertIdx = -1
  for (let b = 0; b < BUCKETS; b++) {
    if (pop[b] === 0 || b === compIdx) continue
    if (bucketDist(b, best) < 3) continue
    if (compIdx >= 0 && bucketDist(b, compIdx) < 2) continue
    if (score[b] < score[best] * 0.04) continue
    if (tertIdx < 0 || score[b] > score[tertIdx]) tertIdx = b
  }
  const tertiary = tertIdx >= 0
    ? bucketColor(tertIdx)
    : makeCoverColor(
        dominant.hue + (compIdx >= 0 ? -36 : -38),
        dominant.saturation * 0.88,
        dominant.brightness,
      )

  const luma = toneLumaSum / totalPixels
  const raw: RawCoverPalette = {
    dominant,
    complementary,
    tertiary,
    isLight: luma >= 0.55,
    luma,
  }
  return finalizePalette(raw, isLightSurface)
}

function finalizePalette(raw: RawCoverPalette, isLightSurface: boolean): CoverPalette {
  return {
    dominant: raw.dominant,
    complementary: raw.complementary,
    tertiary: raw.tertiary,
    accent: adaptAccentForSurface(raw.dominant.hex, isLightSurface),
    accent2: adaptAccentForSurface(raw.complementary.hex, isLightSurface),
    accent3: adaptAccentForSurface(raw.tertiary.hex, isLightSurface),
    isLight: raw.isLight,
    luma: raw.luma,
  }
}

export function measurePixelsToneLuma(data: ArrayLike<number>): number | null {
  let totalPixels = 0
  let toneLumaSum = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    totalPixels++
    const [tr, tg, tb] = amllToneMapRgb(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)
    toneLumaSum += 0.2126 * tr + 0.7152 * tg + 0.0722 * tb
  }
  return totalPixels > 0 ? toneLumaSum / totalPixels : null
}

function fromBakedEra(path: string): RawCoverStats | null {
  const baked = ERA_PALETTES[path]
  if (!baked?.length) return null
  const luma = baked.reduce((acc, c) => {
    const [tr, tg, tb] = amllToneMapRgb(c.r / 255, c.g / 255, c.b / 255)
    return acc + (0.2126 * tr + 0.7152 * tg + 0.0722 * tb)
  }, 0) / baked.length
  const colors = baked
    .map((c) => {
      const [h, s, v] = rgbToHsv(c.r / 255, c.g / 255, c.b / 255)
      return s > 0.18 ? makeCoverColor(h, s, v) : null
    })
    .filter((c): c is CoverColor => c !== null)
  if (!colors.length) return { palette: null, luma }
  const dominant = colors[0]
  const complementary = colors[1] ?? makeCoverColor(dominant.hue + 40, dominant.saturation * 0.9, dominant.brightness)
  const tertiary = colors[2] ?? makeCoverColor(dominant.hue - 36, dominant.saturation * 0.85, dominant.brightness)
  return {
    palette: { dominant, complementary, tertiary, isLight: luma >= 0.55, luma },
    luma,
  }
}

/** Fetches any remote/local cover safely without tainted-canvas CORS errors. */
export async function fetchCoverBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const blob = await fetchImageBlob(url)
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

async function sampleUrl(url: string): Promise<RawCoverStats | null> {
  const fetchSrc = smallCoverUrl(url) ?? url
  const bitmap = await fetchCoverBitmap(fetchSrc)
  if (bitmap) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = SAMPLE_SIDE
      canvas.height = SAMPLE_SIDE
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE)
      const data = ctx.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data
      const luma = measurePixelsToneLuma(data)
      if (luma === null) return null
      const full = extractCoverPaletteFromPixels(data, false)
      return {
        luma,
        palette: full
          ? {
              dominant: full.dominant,
              complementary: full.complementary,
              tertiary: full.tertiary,
              isLight: full.isLight,
              luma: full.luma,
            }
          : null,
      }
    } catch {
      // Fall through to era fallback below.
    } finally {
      bitmap.close()
    }
  }
  const era = eraAssetPath(url)
  return era ? fromBakedEra(era) : null
}

function getCachedStats(url: string): Promise<RawCoverStats | null> {
  let pending = rawCache.get(url)
  if (!pending) {
    pending = sampleUrl(url)
    rawCache.set(url, pending)
    if (rawCache.size > CACHE_CAP) {
      const oldest = rawCache.keys().next().value
      if (oldest !== undefined) rawCache.delete(oldest)
    }
  }
  return pending
}

/** Extracts 3 vibrant AMLL-toned colors from a cover URL (cached per URL). */
export async function extractCoverPalette(
  url: string | null | undefined,
  isLightSurface = false,
): Promise<CoverPalette | null> {
  if (!url) return null
  const stats = await getCachedStats(url)
  return stats?.palette ? finalizePalette(stats.palette, isLightSurface) : null
}

/** Measures mean AMLL tone-mapped luminance (0..1) for any cover, including greyscale. */
export async function measureCoverToneLuma(url: string | null | undefined): Promise<number | null> {
  if (!url) return null
  const stats = await getCachedStats(url)
  return stats ? stats.luma : null
}

export function clearAdaptivePaletteCache(): void {
  rawCache.clear()
}
