// Which passage a silent hover preview (or the Discover hero) plays.
// Pure function, no DOM: tested in scripts/preview-window.test.cjs.
// Rule (the app cannot know the "best" moment without content analysis, so this is a rule):
//   unknown duration  -> start 0, 8 s
//   under 20 s        -> start 0, the whole clip up to 8 s
//   20 s to under 60  -> start at 15 % of the duration, 8 s
//   60 s and longer   -> start at 30 %, but never earlier than 20 s (skips the setup talk)
//                        and never later than 12 s before the end; 8 s
// Known jump: at 60 s the start goes from 15 % (9 s) to the 20 s floor.
// Hand-picked moments can be added in CURATED_PREVIEW_WINDOWS[path] = { start, len? }.

export const PREVIEW_LEN = 8
export const PREVIEW_SKIP_MIN = 20
export const PREVIEW_TAIL = 12

export interface CuratedPreviewWindow {
  start: number
  len?: number
}

export interface PreviewWindowResult {
  start: number
  len: number
  source: 'unknown' | 'curated' | 'short' | 'mid' | 'long'
}

export const CURATED_PREVIEW_WINDOWS: Record<string, CuratedPreviewWindow> = {}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

export function windowFor(duration: number, curated?: CuratedPreviewWindow | null): PreviewWindowResult {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { start: 0, len: PREVIEW_LEN, source: 'unknown' }
  }
  if (curated && Number.isFinite(curated.start)) {
    const cl = Math.min(clamp(Number.isFinite(curated.len) ? (curated.len as number) : PREVIEW_LEN, 2, 15), duration)
    return { start: clamp(curated.start, 0, Math.max(duration - cl, 0)), len: cl, source: 'curated' }
  }
  if (duration < 20) {
    return { start: 0, len: Math.min(PREVIEW_LEN, duration), source: 'short' }
  }
  if (duration < 60) {
    const s = duration * 0.15
    return { start: s, len: Math.min(PREVIEW_LEN, duration - s), source: 'mid' }
  }
  return {
    start: clamp(duration * 0.30, PREVIEW_SKIP_MIN, Math.max(duration - PREVIEW_TAIL, 0)),
    len: PREVIEW_LEN,
    source: 'long',
  }
}

export function windowForPath(duration: number, path?: string | null): PreviewWindowResult {
  return windowFor(duration, path ? CURATED_PREVIEW_WINDOWS[path] : undefined)
}

export type VideoFrameShape = 'wide' | 'square' | 'vertical'

export function videoFrameShape(width: number, height: number): VideoFrameShape {
  if (!width || !height) return 'wide'
  const r = width / height
  return r >= 1.6 ? 'wide' : r >= 0.8 ? 'square' : 'vertical'
}
