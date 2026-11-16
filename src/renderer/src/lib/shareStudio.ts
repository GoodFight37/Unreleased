import { createOffscreenGlassRenderer, type CompositorSurface } from './glass/engine'
import { getGlassPreset } from './glass/presets'
import { getFont } from './fonts'
import {
  isLrcFormat,
  parseLrc,
  splitAdLibs,
  splitColorWords,
} from './lyrics'
import type { SyncedLyricWord } from '../types'

export type ShareFormatKey = 'story' | 'landscape' | 'post' | 'square' | 'portrait' | 'widescreen'
export type ShareBgStyle = 'blur' | 'solid' | 'gradient' | 'custom'
export type ShareTextSize = 'S' | 'M' | 'L'
export type ShareTextPos = 'top' | 'center' | 'bottom'
export type ShareTextColor = 'white' | 'accent' | 'gold' | 'custom'
export type ShareGlassMode = 'dark' | 'light'

export interface ShareFormatSpec {
  key: ShareFormatKey
  label: string
  ratioLabel: string
  previewW: number
  previewH: number
  exportW: number
  exportH: number
}

export const SHARE_FORMATS: ShareFormatSpec[] = [
  { key: 'story', label: 'Story · 9:16', ratioLabel: '9:16', previewW: 242, previewH: 430, exportW: 1080, exportH: 1920 },
  { key: 'landscape', label: 'Landscape · 16:9', ratioLabel: '16:9', previewW: 344, previewH: 194, exportW: 1920, exportH: 1080 },
  { key: 'post', label: 'Post · 4:5', ratioLabel: '4:5', previewW: 280, previewH: 350, exportW: 1080, exportH: 1350 },
  { key: 'square', label: 'Square · 1:1', ratioLabel: '1:1', previewW: 310, previewH: 310, exportW: 1080, exportH: 1080 },
  { key: 'portrait', label: 'Portrait · 2:3', ratioLabel: '2:3', previewW: 264, previewH: 396, exportW: 1080, exportH: 1620 },
  { key: 'widescreen', label: 'Widescreen · 21:9', ratioLabel: '21:9', previewW: 344, previewH: 148, exportW: 1920, exportH: 822 },
]

export interface StudioLyricLine {
  text: string
  time: number | null
  endTime: number | null
  words?: SyncedLyricWord[]
}

export function parseStudioLyrics(rawLyrics: string | null): { lines: StudioLyricLine[]; isSynced: boolean } {
  if (!rawLyrics) return { lines: [], isSynced: false }
  if (isLrcFormat(rawLyrics)) {
    const parsed = parseLrc(rawLyrics).filter((l) => l.text.trim().length > 0)
    const lines: StudioLyricLine[] = parsed.map((l, idx) => ({
      text: l.text,
      time: l.time,
      endTime: parsed[idx + 1]?.time ?? (l.words?.length ? l.words[l.words.length - 1].end : l.time + 3.5),
      words: l.words,
    }))
    return { lines, isSynced: lines.length > 0 }
  }
  const lines = rawLyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ text, time: null, endTime: null }))
  return { lines, isSynced: false }
}

export function computeClipWindow(
  lines: StudioLyricLine[],
  selectedIndices: number[],
  fallbackStartSec = 0,
): { startSec: number; durationSec: number } {
  const chosen = selectedIndices.map((i) => lines[i]).filter((l): l is StudioLyricLine => !!l)
  const timed = chosen.filter((l) => l.time !== null)
  if (timed.length > 0) {
    const first = timed[0].time ?? 0
    const last = timed[timed.length - 1]
    const lastEnd = last.endTime ?? ((last.time ?? 0) + 3.5)
    const startSec = Math.max(0, Math.round((first - 0.35) * 10) / 10)
    const rawDur = Math.ceil(Math.max(5, lastEnd + 0.7 - startSec))
    return { startSec, durationSec: Math.max(5, Math.min(30, rawDur)) }
  }
  return { startSec: Math.max(0, Math.floor(fallbackStartSec)), durationSec: 10 }
}

export interface ShareRenderOptions {
  width: number
  height: number
  title: string
  artist: string
  lines: StudioLyricLine[]
  selectedIndices: number[]
  format: ShareFormatKey
  bgStyle: ShareBgStyle
  glassMode: ShareGlassMode
  textSize: ShareTextSize
  textPos: ShareTextPos
  textColor: ShareTextColor
  customTextColor: string
  accentRgb: [number, number, number]
  fontId: string
  customFont: string
  showInfoBar: boolean
  artImage: HTMLImageElement | null
  customBgImage: HTMLImageElement | null
  logoImage: HTMLImageElement | null
  isVideo: boolean
  isSynced: boolean
  clipStartSec: number
  clipDurationSec: number
}

const TEXT_SIZE_MULT: Record<ShareTextSize, number> = { S: 0.82, M: 1.0, L: 1.22 }

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: CanvasImageElementLike, x: number, y: number, w: number, h: number): void {
  const iw = img.width || 1
  const ih = img.height || 1
  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img as CanvasImageSource, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

type CanvasImageElementLike = { width: number; height: number }

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function resolveFontFamily(fontId: string, customFont: string): string {
  if (fontId === 'custom' && customFont.trim()) {
    return `'${customFont.trim().replace(/'/g, "\\'")}', ${getFont(undefined).stack}`
  }
  return getFont(fontId).stack
}

function resolveLineTextColor(
  textColor: ShareTextColor,
  customTextColor: string,
  accentRgb: [number, number, number],
  glassMode: ShareGlassMode,
): string {
  if (textColor === 'gold') return glassMode === 'light' ? '#8a5d00' : '#f7cf66'
  if (textColor === 'accent') {
    const [r, g, b] = accentRgb
    if (glassMode === 'dark') {
      // Lift dark accents slightly so WCAG AA >= 4.5:1 holds on dark glass (lum <= 0.04)
      return `rgb(${Math.round(r + (255 - r) * 0.42)}, ${Math.round(g + (255 - g) * 0.42)}, ${Math.round(b + (255 - b) * 0.42)})`
    }
    return `rgb(${Math.round(r * 0.45)}, ${Math.round(g * 0.45)}, ${Math.round(b * 0.45)})`
  }
  if (textColor === 'custom') return customTextColor || (glassMode === 'light' ? '#141822' : '#ffffff')
  return glassMode === 'light' ? '#141822' : '#ffffff'
}

interface TextSegment {
  text: string
  color?: string
  adLib: boolean
  activeWord?: boolean
}

function buildLineSegments(
  line: StudioLyricLine,
  baseColor: string,
  isActiveLine: boolean,
  audioTime: number,
  isVideoSynced: boolean,
): TextSegment[] {
  if (isVideoSynced && isActiveLine && line.words?.length) {
    return line.words.map((w, idx) => ({
      text: idx < line.words!.length - 1 ? `${w.text} ` : w.text,
      color: baseColor,
      adLib: /^\(.*\)$/.test(w.text),
      activeWord: audioTime >= w.start,
    }))
  }
  const out: TextSegment[] = []
  for (const adPart of splitAdLibs(line.text)) {
    for (const colPart of splitColorWords(adPart.text)) {
      out.push({
        text: colPart.text,
        color: colPart.color ?? baseColor,
        adLib: adPart.adLib,
        activeWord: true,
      })
    }
  }
  return out
}

interface WrappedRow {
  segments: TextSegment[]
  width: number
}

function wrapLineSegments(
  ctx: CanvasRenderingContext2D,
  segments: TextSegment[],
  maxW: number,
): WrappedRow[] {
  // Flatten into word tokens preserving styling per token
  const tokens: TextSegment[] = []
  for (const seg of segments) {
    const parts = seg.text.split(/(\s+)/)
    for (const part of parts) {
      if (!part) continue
      tokens.push({ ...seg, text: part })
    }
  }
  const rows: WrappedRow[] = []
  let current: TextSegment[] = []
  let currentW = 0

  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok.text)
    const tokW = ctx.measureText(tok.text).width
    if (current.length > 0 && currentW + tokW > maxW && !isSpace) {
      // Trim trailing whitespace on wrapped row
      while (current.length && /^\s+$/.test(current[current.length - 1].text)) {
        currentW -= ctx.measureText(current.pop()!.text).width
      }
      rows.push({ segments: current, width: currentW })
      current = []
      currentW = 0
      if (isSpace) continue
    }
    if (current.length === 0 && isSpace) continue
    current.push(tok)
    currentW += tokW
  }
  if (current.length > 0) {
    rows.push({ segments: current, width: currentW })
  }
  return rows.length > 0 ? rows : [{ segments: [], width: 0 }]
}

function extractDominantTint(img: HTMLImageElement | null, fallbackRgb: [number, number, number]): [number, number, number] {
  if (!img) return [fallbackRgb[0] / 255, fallbackRgb[1] / 255, fallbackRgb[2] / 255]
  try {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')
    if (!ctx) return [fallbackRgb[0] / 255, fallbackRgb[1] / 255, fallbackRgb[2] / 255]
    ctx.drawImage(img, 0, 0, 64, 64)
    const d = ctx.getImageData(0, 0, 64, 64).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 16) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
    }
    if (n > 0) return [r / n / 255, g / n / 255, b / n / 255]
  } catch { /* tainted fallback */ }
  return [fallbackRgb[0] / 255, fallbackRgb[1] / 255, fallbackRgb[2] / 255]
}

export class ShareStudioRenderer {
  private gpuRenderer: Awaited<ReturnType<typeof createOffscreenGlassRenderer>> | null = null
  private gpuInitPromise: Promise<void> | null = null
  private gpuUnavailable = false
  private backdropCanvas = document.createElement('canvas')
  private uploadCanvas = document.createElement('canvas')
  private glassLayerCanvas = document.createElement('canvas')
  private lastBackdropKey = ''
  private lastUploadKey = ''
  private cachedTint: [number, number, number] = [0.42, 0.32, 0.8]

  constructor() {
    this.uploadCanvas.width = 512
    this.uploadCanvas.height = 512
  }

  private async ensureGpu(): Promise<void> {
    if (this.gpuRenderer || this.gpuUnavailable) return
    if (!this.gpuInitPromise) {
      this.gpuInitPromise = createOffscreenGlassRenderer()
        .then((r) => { this.gpuRenderer = r })
        .catch(() => { this.gpuUnavailable = true })
    }
    await this.gpuInitPromise
  }

  private ensureBackdropAndUpload(opts: ShareRenderOptions): void {
    const { width: w, height: h, bgStyle, glassMode, accentRgb, artImage, customBgImage } = opts
    const artKey = artImage?.src?.slice(0, 64) ?? 'none'
    const customKey = customBgImage?.src?.slice(0, 64) ?? 'none'
    const backdropKey = `${w}:${h}:${bgStyle}:${glassMode}:${accentRgb.join(',')}:${artKey}:${customKey}`
    if (backdropKey === this.lastBackdropKey) return
    this.lastBackdropKey = backdropKey

    this.cachedTint = extractDominantTint(artImage, accentRgb)
    this.backdropCanvas.width = w
    this.backdropCanvas.height = h
    const bctx = this.backdropCanvas.getContext('2d')!
    bctx.clearRect(0, 0, w, h)

    const isLight = glassMode === 'light'
    bctx.fillStyle = isLight ? '#e8ecf4' : '#0f1016'
    bctx.fillRect(0, 0, w, h)

    if (bgStyle === 'blur') {
      if (artImage) {
        bctx.save()
        const blurPx = Math.max(18, Math.round(Math.min(w, h) * 0.05))
        bctx.filter = `blur(${blurPx}px) brightness(${isLight ? 0.84 : 0.54}) saturate(1.22)`
        drawCoverImage(bctx, artImage, -blurPx, -blurPx, w + blurPx * 2, h + blurPx * 2)
        bctx.restore()
      } else {
        const [r, g, b] = accentRgb
        const gr = bctx.createRadialGradient(w * 0.8, h * 0.16, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.95)
        gr.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${isLight ? 0.34 : 0.52})`)
        gr.addColorStop(0.55, `rgba(${Math.round(r * 0.5)}, ${Math.round(g * 0.7)}, 210, ${isLight ? 0.16 : 0.24})`)
        gr.addColorStop(1, isLight ? '#dfe5f0' : '#0b0c12')
        bctx.fillStyle = gr
        bctx.fillRect(0, 0, w, h)
      }
    } else if (bgStyle === 'gradient') {
      const [r, g, b] = accentRgb
      const grad = bctx.createLinearGradient(0, 0, w * 0.35, h)
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${isLight ? 0.55 : 0.86})`)
      grad.addColorStop(0.75, isLight ? '#dce2ee' : '#0b0b0f')
      grad.addColorStop(1, isLight ? '#d3dae8' : '#09090d')
      bctx.fillStyle = grad
      bctx.fillRect(0, 0, w, h)
    } else if (bgStyle === 'custom' && customBgImage) {
      drawCoverImage(bctx, customBgImage, 0, 0, w, h)
      const overlay = bctx.createLinearGradient(0, 0, 0, h)
      overlay.addColorStop(0, isLight ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.18)')
      overlay.addColorStop(1, isLight ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.52)')
      bctx.fillStyle = overlay
      bctx.fillRect(0, 0, w, h)
    }

    // Soft readability vignette across every non-solid mode
    if (bgStyle !== 'solid') {
      const vig = bctx.createLinearGradient(0, 0, 0, h)
      vig.addColorStop(0, isLight ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)')
      vig.addColorStop(1, isLight ? 'rgba(220,226,238,0.28)' : 'rgba(0,0,0,0.44)')
      bctx.fillStyle = vig
      bctx.fillRect(0, 0, w, h)
    }

    // Snapshot 512x512 texture for WebGPU refraction sampling
    const uploadKey = backdropKey
    if (uploadKey !== this.lastUploadKey) {
      this.lastUploadKey = uploadKey
      const uctx = this.uploadCanvas.getContext('2d')!
      uctx.clearRect(0, 0, 512, 512)
      if (bgStyle === 'blur' && artImage) {
        drawCoverImage(uctx, artImage, 0, 0, 512, 512)
      } else {
        uctx.drawImage(this.backdropCanvas, 0, 0, 512, 512)
      }
      if (this.gpuRenderer) {
        this.gpuRenderer.upload(this.uploadCanvas)
      }
    }
  }

  async renderFrame(targetCanvas: HTMLCanvasElement, opts: ShareRenderOptions, timeSec: number): Promise<void> {
    await this.ensureGpu()
    const { width: w, height: h } = opts
    if (targetCanvas.width !== w || targetCanvas.height !== h) {
      targetCanvas.width = w
      targetCanvas.height = h
    }
    this.ensureBackdropAndUpload(opts)
    if (this.gpuRenderer && this.lastUploadKey) {
      // Ensure texture uploaded even if GPU init completed after backdrop cached
      this.gpuRenderer.upload(this.uploadCanvas)
    }

    const ctx = targetCanvas.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(this.backdropCanvas, 0, 0)

    const isWide = w > h * 1.15
    const marginX = Math.round(w * (isWide ? 0.055 : 0.072))
    const marginY = Math.round(h * (isWide ? 0.075 : 0.068))
    const infoH = opts.showInfoBar
      ? Math.round(clamp(h * (isWide ? 0.145 : 0.088), Math.round(h * 0.075), Math.round(h * 0.22)))
      : 0
    const pillGap = opts.showInfoBar ? Math.round(h * 0.022) : 0
    const cardW = w - marginX * 2
    const cardH = h - marginY * 2 - infoH - pillGap
    const cardX = marginX
    const cardY = marginY
    const cardRadius = Math.round(clamp(Math.min(cardW, cardH) * 0.055, 14, 52))
    const infoY = cardY + cardH + pillGap
    const infoRadius = Math.round(clamp(infoH * 0.34, 12, 42))

    const isLight = opts.glassMode === 'light'
    const surfaces: CompositorSurface[] = [
      {
        cx: cardX + cardW / 2,
        cy: cardY + cardH / 2,
        hw: cardW / 2,
        hh: cardH / 2,
        radius: cardRadius,
        kind: 0,
        layer: 1,
        playFusion: 0,
      },
    ]
    if (opts.showInfoBar && infoH > 0) {
      surfaces.push({
        cx: cardX + cardW / 2,
        cy: infoY + infoH / 2,
        hw: cardW / 2,
        hh: infoH / 2,
        radius: infoRadius,
        kind: 1,
        layer: 1,
        playFusion: 0,
      })
    }

    // Deterministic pointer specular sweep driven solely by `timeSec`
    const pointer: [number, number] = [
      0.5 + 0.36 * Math.cos(timeSec * 0.55),
      0.26 + 0.18 * Math.sin(timeSec * 0.42),
    ]

    let drewGpuGlass = false
    if (this.gpuRenderer) {
      try {
        const preset = getGlassPreset(isLight)
        const rgba = await this.gpuRenderer.render({
          width: w,
          height: h,
          timeSec,
          light: isLight,
          source: opts.bgStyle === 'solid' && !opts.artImage ? 'ambient' : 'cover',
          pointer,
          lens: [0.5, 0.5, 0],
          merge: 0,
          tint: this.cachedTint,
          play: [0.5, 0.5, 0, 0],
          preset,
          surfaces,
        })
        if (this.glassLayerCanvas.width !== w || this.glassLayerCanvas.height !== h) {
          this.glassLayerCanvas.width = w
          this.glassLayerCanvas.height = h
        }
        const gctx = this.glassLayerCanvas.getContext('2d')!
        gctx.putImageData(new ImageData(rgba, w, h), 0, 0)
        ctx.drawImage(this.glassLayerCanvas, 0, 0)
        drewGpuGlass = true
      } catch {
        drewGpuGlass = false
      }
    }

    if (!drewGpuGlass) {
      // Deterministic 2D Liquid Glass fallback (WCAG AA bounded + specular bevel)
      const drawFallbackGlass = (x: number, y: number, bw: number, bh: number, r: number) => {
        ctx.save()
        roundedRectPath(ctx, x, y, bw, bh, r)
        ctx.fillStyle = isLight ? 'rgba(235, 240, 248, 0.84)' : 'rgba(18, 22, 32, 0.80)'
        ctx.fill()
        const gx = x + bw * pointer[0]
        const gy = y + bh * pointer[1]
        const spec = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(bw, bh) * 0.75)
        spec.addColorStop(0, isLight ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.16)')
        spec.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = spec
        ctx.fill()
        ctx.lineWidth = Math.max(1.25, Math.min(w, h) * 0.0022)
        ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.28)'
        ctx.stroke()
        ctx.restore()
      }
      drawFallbackGlass(cardX, cardY, cardW, cardH, cardRadius)
      if (opts.showInfoBar && infoH > 0) {
        drawFallbackGlass(cardX, infoY, cardW, infoH, infoRadius)
      }
    }

    // ── Lyrics typography ───────────────────────────────────────────────────
    const selectedLines = opts.selectedIndices.map((i) => opts.lines[i]).filter((l): l is StudioLyricLine => !!l)
    const padX = Math.round(cardW * 0.082)
    const padY = Math.round(cardH * 0.088)
    const textAreaW = Math.max(40, cardW - padX * 2)
    const textAreaH = Math.max(40, cardH - padY * 2)
    const fontFamily = resolveFontFamily(opts.fontId, opts.customFont)
    const baseColor = resolveLineTextColor(opts.textColor, opts.customTextColor, opts.accentRgb, opts.glassMode)

    if (selectedLines.length === 0) {
      const emptySize = Math.round(clamp(Math.min(w, h) * 0.036, 14, 42))
      ctx.save()
      ctx.font = `600 ${emptySize}px ${fontFamily}`
      ctx.fillStyle = isLight ? 'rgba(20,24,34,0.68)' : 'rgba(255,255,255,0.72)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Select lines to preview', cardX + cardW / 2, cardY + cardH / 2)
      ctx.restore()
    } else {
      const audioTime = opts.clipStartSec + timeSec
      const isVideoSynced = opts.isVideo && opts.isSynced
      let activeSelectedIdx = -1
      if (isVideoSynced) {
        for (let i = 0; i < selectedLines.length; i++) {
          const t0 = selectedLines[i].time
          if (t0 !== null && t0 <= audioTime) activeSelectedIdx = i
        }
        if (activeSelectedIdx < 0) activeSelectedIdx = 0
      }

      const scaleBase = Math.min(cardW, cardH)
      const countScale = selectedLines.length <= 2 ? 0.095 : selectedLines.length <= 4 ? 0.078 : selectedLines.length <= 6 ? 0.064 : 0.052
      let fontSize = Math.round(clamp(scaleBase * countScale * TEXT_SIZE_MULT[opts.textSize], 12, 84))
      const lineHeightMul = 1.32
      let lineGap = Math.round(fontSize * 0.36)

      // Shrink font size until all wrapped lines fit cleanly inside textAreaH
      type MeasuredLine = { rows: WrappedRow[]; isActive: boolean }
      let measured: MeasuredLine[] = []
      let totalBlockH = 0
      while (fontSize >= 10) {
        lineGap = Math.round(fontSize * 0.34)
        ctx.font = `700 ${fontSize}px ${fontFamily}`
        measured = selectedLines.map((line, idx) => {
          const isActive = !isVideoSynced || idx === activeSelectedIdx
          const segs = buildLineSegments(line, baseColor, isActive, audioTime, isVideoSynced)
          return { rows: wrapLineSegments(ctx, segs, textAreaW), isActive }
        })
        const rowH = fontSize * lineHeightMul
        totalBlockH = measured.reduce((acc, m, idx) => {
          const hLines = m.rows.length * rowH
          return acc + hLines + (idx < measured.length - 1 ? lineGap : 0)
        }, 0)
        if (totalBlockH <= textAreaH) break
        fontSize = Math.max(9, Math.floor(fontSize * 0.92))
        if (fontSize <= 10) break
      }

      const startY = opts.textPos === 'top'
        ? cardY + padY
        : opts.textPos === 'bottom'
          ? cardY + cardH - padY - totalBlockH
          : cardY + padY + Math.max(0, (textAreaH - totalBlockH) / 2)

      ctx.save()
      ctx.font = `700 ${fontSize}px ${fontFamily}`
      ctx.textBaseline = 'top'
      const rowH = fontSize * lineHeightMul
      let y = startY
      for (let li = 0; li < measured.length; li++) {
        const m = measured[li]
        const lineOpacity = m.isActive ? 1.0 : 0.66
        if (isVideoSynced && m.isActive) {
          // Subtle glass focus pill behind the active sung line
          const pillPadX = Math.round(fontSize * 0.38)
          const pillPadY = Math.round(fontSize * 0.14)
          const pillH = m.rows.length * rowH + pillPadY * 2
          const maxRowW = Math.max(...m.rows.map((r) => r.width), 0)
          const pillW = Math.min(textAreaW + pillPadX * 2, maxRowW + pillPadX * 2)
          if (pillW > 0) {
            ctx.save()
            roundedRectPath(ctx, cardX + padX - pillPadX * 0.65, y - pillPadY, pillW, pillH, Math.round(fontSize * 0.42))
            ctx.fillStyle = isLight ? 'rgba(20, 24, 34, 0.08)' : 'rgba(255, 255, 255, 0.10)'
            ctx.fill()
            ctx.restore()
          }
        }
        for (const row of m.rows) {
          let x = cardX + padX
          for (const seg of row.segments) {
            const alpha = lineOpacity * (seg.adLib ? 0.78 : 1.0) * (seg.activeWord === false ? 0.72 : 1.0)
            ctx.globalAlpha = alpha
            ctx.fillStyle = seg.color ?? baseColor
            ctx.shadowColor = isLight ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'
            ctx.shadowBlur = Math.round(fontSize * 0.25)
            ctx.shadowOffsetY = Math.round(fontSize * 0.04)
            ctx.fillText(seg.text, x, y)
            x += ctx.measureText(seg.text).width
          }
          y += rowH
        }
        if (li < measured.length - 1) y += lineGap
      }
      ctx.restore()
    }

    // ── Bottom Song Info Glass Pill ─────────────────────────────────────────
    if (opts.showInfoBar && infoH > 0) {
      const padH = Math.round(infoH * 0.16)
      const artSize = infoH - padH * 2
      const artX = cardX + padH
      const artY = infoY + padH
      const artR = Math.round(clamp(artSize * 0.2, 6, 18))

      ctx.save()
      roundedRectPath(ctx, artX, artY, artSize, artSize, artR)
      ctx.clip()
      if (opts.artImage) {
        drawCoverImage(ctx, opts.artImage, artX, artY, artSize, artSize)
      } else {
        ctx.fillStyle = isLight ? 'rgba(20,24,34,0.12)' : 'rgba(255,255,255,0.14)'
        ctx.fillRect(artX, artY, artSize, artSize)
      }
      ctx.restore()

      // Hairline glass edge on thumbnail
      ctx.save()
      roundedRectPath(ctx, artX, artY, artSize, artSize, artR)
      ctx.lineWidth = Math.max(1, infoH * 0.014)
      ctx.strokeStyle = isLight ? 'rgba(20,24,34,0.16)' : 'rgba(255,255,255,0.28)'
      ctx.stroke()
      ctx.restore()

      const logoH = Math.round(artSize * 0.78)
      const logoW = opts.logoImage && opts.logoImage.height > 0
        ? Math.round((opts.logoImage.width / opts.logoImage.height) * logoH)
        : 0
      const textX = artX + artSize + Math.round(padH * 0.9)
      const textMaxW = Math.max(40, cardX + cardW - padH - logoW - Math.round(padH * 0.8) - textX)
      const titleSize = Math.round(clamp(infoH * 0.24, 11, 36))
      const artistSize = Math.round(clamp(infoH * 0.19, 10, 28))

      ctx.save()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.font = `700 ${titleSize}px ${fontFamily}`
      ctx.fillStyle = isLight ? '#141822' : '#ffffff'
      const titleY = opts.isVideo ? artY + Math.round(artSize * 0.06) : artY + Math.round(artSize * 0.14)
      ctx.fillText(truncateText(ctx, opts.title, textMaxW), textX, titleY)

      ctx.font = `500 ${artistSize}px ${fontFamily}`
      ctx.fillStyle = isLight ? 'rgba(20,24,34,0.78)' : 'rgba(232,236,245,0.84)'
      ctx.fillText(truncateText(ctx, opts.artist, textMaxW), textX, titleY + Math.round(titleSize * 1.24))

      if (opts.isVideo && opts.clipDurationSec > 0) {
        const barW = Math.min(textMaxW, Math.round(cardW * 0.45))
        const barH = Math.max(3, Math.round(infoH * 0.045))
        const barY = artY + artSize - barH - Math.round(artSize * 0.06)
        const progress = clamp(timeSec / opts.clipDurationSec, 0, 1)
        roundedRectPath(ctx, textX, barY, barW, barH, barH / 2)
        ctx.fillStyle = isLight ? 'rgba(20,24,34,0.16)' : 'rgba(255,255,255,0.22)'
        ctx.fill()
        if (progress > 0) {
          roundedRectPath(ctx, textX, barY, Math.max(barH, barW * progress), barH, barH / 2)
          const [r, g, b] = opts.accentRgb
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
          ctx.fill()
        }
      }
      ctx.restore()

      if (opts.logoImage && logoW > 0) {
        ctx.save()
        ctx.globalAlpha = isLight ? 0.85 : 0.92
        ctx.drawImage(opts.logoImage, cardX + cardW - padH - logoW, infoY + (infoH - logoH) / 2, logoW, logoH)
        ctx.restore()
      }
    }
  }

  destroy(): void {
    this.gpuRenderer?.destroy()
    this.gpuRenderer = null
  }
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (!text) return ''
  if (ctx.measureText(text).width <= maxW) return text
  let end = text.length
  while (end > 1 && ctx.measureText(text.slice(0, end) + '…').width > maxW) {
    end--
  }
  return text.slice(0, end) + '…'
}
