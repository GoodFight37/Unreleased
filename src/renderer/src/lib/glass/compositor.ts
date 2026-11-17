import { createElement, useEffect, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { createGlassCompositor, type CompositorSurface } from './engine'
import { getGlassPreset, getGlassLook, useGlassLookKey } from './presets'
import { backdropArt, getSkin } from '../skins'
import { buildImageUrl } from '../juicewrldApi'
import { extractCoverPalette, fetchCoverBitmap } from '../adaptivePalette'
import { useEffectsState } from '../effectsPreference'
import { listenToMeter } from '../../desktop/meter'
import { useStore } from '../../store/useStore'

export type GlassSurfaceKind = 'panel' | 'pill' | 'field' | 'player' | 'segthumb'
export interface GlassSurfaceOptions {
  kind?: GlassSurfaceKind
  layer?: 0 | 1 | 2
  radius?: number
  playFusion?: boolean
}

const entries = new Map<HTMLElement, GlassSurfaceOptions>()
const readyListeners = new Set<() => void>()
let compositorReady = false
let scheduleFn: () => void = () => {}
let uploadFn: () => void = () => {}
let layoutDirty = true
let overflowWarned = false
const overflowedElements = new Set<HTMLElement>()
let cachedGeometry: Array<{ el: HTMLElement; opts: GlassSurfaceOptions; r: DOMRect; radius: number }> = []
let cachedPlayRect: DOMRect | null = null
let cachedModalVisible = false
let cachedSliderInputs: HTMLInputElement[] = []
const cachedSliderRects = new Map<HTMLInputElement, DOMRect | null>()
let lastInteractionMs = 0

const KIND_MAP: Record<GlassSurfaceKind, number> = { panel: 0, pill: 1, field: 2, player: 3, segthumb: 4 }

type SpringVal = { val: number; target: number; vel: number }
const surfaceSprings = new WeakMap<HTMLElement, SpringVal>()
const sliderSprings = new Map<string, { hover: SpringVal; press: SpringVal }>()
let hoveredSurface: HTMLElement | null = null
let pressedSurface: HTMLElement | null = null

function stepSpring(s: SpringVal, dt: number, instant: boolean): boolean {
  if (instant) {
    const moved = s.val !== s.target
    s.val = s.target
    s.vel = 0
    return moved
  }
  const omega = 24
  const zeta = 0.92 // critically damped, 180-240ms settle without decorative bounce
  const disp = s.val - s.target
  if (Math.abs(disp) < 0.0015 && Math.abs(s.vel) < 0.004) {
    s.val = s.target
    s.vel = 0
    return false
  }
  const accel = -omega * omega * disp - 2 * zeta * omega * s.vel
  s.vel += accel * dt
  s.val += s.vel * dt
  return true
}

export function setCompositorSlider(id: string, hover: number, press: number): void {
  let st = sliderSprings.get(id)
  if (!st) {
    st = {
      hover: { val: 0, target: 0, vel: 0 },
      press: { val: 0, target: 0, vel: 0 },
    }
    sliderSprings.set(id, st)
  }
  lastInteractionMs = performance.now()
  st.hover.target = hover
  st.press.target = press
  scheduleFn()
}

const playerExtras: {
  playEl: HTMLElement | null
  lens: [number, number, number]
  targetLens: number
  merge: number
  targetMerge: number
} = {
  playEl: null,
  lens: [0.5, 0.5, 0],
  targetLens: 0,
  merge: 0,
  targetMerge: 0,
}

const backdropState: {
  light: boolean
  source: 'ambient' | 'cover'
  tint: [number, number, number]
  tint2: [number, number, number]
  tint3: [number, number, number]
  pointer: [number, number]
  artUrl: string | null
  coverCanvas: HTMLCanvasElement | null
} = {
  light: false,
  source: 'ambient',
  tint: [0.42, 0.32, 0.8],
  tint2: [0.5, 0.35, 0.56],
  tint3: [0.42, 0.52, 0.89],
  pointer: [0.5, 0.25],
  artUrl: null,
  coverCanvas: null,
}

/** E3 capability check: HTML-in-Canvas (drawElement / layoutsubtree). */
export const HTML_IN_CANVAS_SUPPORTED =
  typeof HTMLCanvasElement !== 'undefined' &&
  'layoutsubtree' in HTMLCanvasElement.prototype &&
  typeof (CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>).drawElement === 'function'

function setReady(next: boolean): void {
  if (compositorReady === next) return
  compositorReady = next
  document.documentElement.classList.toggle('glass-gpu-active', next)
  if (!next) {
    for (const input of cachedSliderInputs) input.removeAttribute('data-glass-slider-ready')
  }
  readyListeners.forEach((fn) => fn())
}

export function useGlassCompositorReady(): boolean {
  return useSyncExternalStore(
    (fn) => { readyListeners.add(fn); return () => { readyListeners.delete(fn) } },
    () => compositorReady,
    () => false,
  )
}

let animSyncFn: (ms: number) => void = () => {}

export function scheduleGlassCompositor(): void {
  scheduleFn()
}

/** Re-measure glass shapes every frame for `ms`: for moves the compositor can't
 *  observe itself (inline-style resize, Element.animate() lifts). */
export function syncGlassLayout(ms: number): void {
  animSyncFn(ms)
}

export function registerGlassSurface(el: HTMLElement, opts: GlassSurfaceOptions = {}): () => void {
  entries.set(el, opts)
  layoutDirty = true
  lastInteractionMs = performance.now()
  scheduleFn()
  return () => {
    entries.delete(el)
    el.removeAttribute('data-glass-overflow')
    overflowedElements.delete(el)
    layoutDirty = true
    lastInteractionMs = performance.now()
    scheduleFn()
  }
}

export function useGlassSurface(ref: RefObject<HTMLElement | null>, opts: GlassSurfaceOptions = {}, active = true): void {
  const kind = opts.kind ?? 'panel'
  const layer = opts.layer ?? 1
  const radius = opts.radius
  const playFusion = opts.playFusion ?? false
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    return registerGlassSurface(el, { kind, layer, radius, playFusion })
  }, [ref, active, kind, layer, radius, playFusion])
}

export function setCompositorPlayEl(el: HTMLElement | null): void {
  playerExtras.playEl = el
  layoutDirty = true
  lastInteractionMs = performance.now()
  scheduleFn()
}

export function setCompositorLens(x: number | null, y: number | null, active: number | null, merge?: number): void {
  if (x !== null) playerExtras.lens[0] = x
  if (y !== null) playerExtras.lens[1] = y
  if (active !== null) playerExtras.targetLens = active
  if (merge !== undefined) playerExtras.targetMerge = merge
  lastInteractionMs = performance.now()
  scheduleFn()
}

function readRgbVar(name: string): [number, number, number] | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return null
  const parts = raw.split(/[\s,]+/).map(Number)
  if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
  }
  return null
}

function applyAmbientTints(): void {
  const t1 = readRgbVar('--accent-rgb') ?? [0.42, 0.32, 0.8]
  const t2 = readRgbVar('--accent-2-rgb') ?? [t1[1] * 0.55 + 0.32, t1[2] * 0.45 + 0.14, t1[0] * 0.65 + 0.28]
  const t3 = readRgbVar('--accent-3-rgb') ?? [t1[0] * 0.45 + 0.23, t1[1] * 0.45 + 0.37, t1[2] * 0.45 + 0.53]
  backdropState.tint = t1
  backdropState.tint2 = t2
  backdropState.tint3 = t3
}

let frameStyles = new WeakMap<Element, CSSStyleDeclaration>()
let frameRects = new WeakMap<Element, DOMRect>()

function getCachedStyle(el: Element): CSSStyleDeclaration {
  let cs = frameStyles.get(el)
  if (!cs) {
    cs = getComputedStyle(el)
    frameStyles.set(el, cs)
  }
  return cs
}

function getCachedRect(el: Element): DOMRect {
  let r = frameRects.get(el)
  if (!r) {
    r = el.getBoundingClientRect()
    frameRects.set(el, r)
  }
  return r
}

function isVisibleRect(el: HTMLElement): DOMRect | null {
  const cs = getCachedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null
  const r = getCachedRect(el)
  if (r.width < 4 || r.height < 4) return null
  let left = Math.max(0, r.left)
  let top = Math.max(0, r.top)
  let right = Math.min(window.innerWidth, r.right)
  let bottom = Math.min(window.innerHeight, r.bottom)
  let p = el.parentElement
  while (p && p !== document.body) {
    const pcs = getCachedStyle(p)
    if (pcs.display === 'none' || pcs.visibility === 'hidden' || Number(pcs.opacity) < 0.05) return null
    if (pcs.overflowX === 'hidden' || pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'clip' ||
        pcs.overflowY === 'hidden' || pcs.overflowY === 'auto' || pcs.overflowY === 'scroll' || pcs.overflowY === 'clip') {
      const pr = getCachedRect(p)
      left = Math.max(left, pr.left)
      top = Math.max(top, pr.top)
      right = Math.min(right, pr.right)
      bottom = Math.min(bottom, pr.bottom)
      if (right - left < 4 || bottom - top < 4) return null
    }
    p = p.parentElement
  }
  if (right - left < 4 || bottom - top < 4) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

function parseBorderRadius(el: HTMLElement, r: DOMRect): number {
  const raw = parseFloat(getCachedStyle(el).borderTopLeftRadius)
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, Math.min(r.width, r.height) * 0.5)
  return 12
}

const AUTO_SELECTORS: Array<[string, GlassSurfaceOptions]> = [
  ['.app-menu-glass[role="menu"], .menu-glass, .glass-popover', { kind: 'panel', layer: 2 }],
  ['.modal-glass', { kind: 'panel', layer: 2 }],
  ['.app-sidebar', { kind: 'pill', layer: 1 }],
  ['.glass-button, .glass-bar, .glass-chip', { kind: 'pill', layer: 1 }],
  ['.glass-seg:not(.glass-seg-quiet)', { kind: 'pill', layer: 0 }],
  ['.glass-seg-thumb.is-ready', { kind: 'segthumb', layer: 1 }],
  ['.glass-field:not(.catalog-tool)', { kind: 'field', layer: 0 }],
  ['.glass-pane', { kind: 'panel', layer: 1 }],
]
const FLAT_PAGES = '[data-view]:not([data-view="wrld"])'
const FLAT_IN_PAGES = new Set(['.glass-seg:not(.glass-seg-quiet)', '.glass-seg-thumb.is-ready', '.glass-field:not(.catalog-tool)', '.glass-pane'])

function rebuildGeometryCache(): void {
  frameStyles = new WeakMap<Element, CSSStyleDeclaration>()
  frameRects = new WeakMap<Element, DOMRect>()
  const seen = new Set<HTMLElement>()
  const collected: Array<{ el: HTMLElement; opts: GlassSurfaceOptions }> = []

  const add = (el: HTMLElement, opts: GlassSurfaceOptions): void => {
    if (seen.has(el)) return
    seen.add(el)
    collected.push({ el, opts })
  }

  for (const [el, opts] of entries) add(el, opts)

  for (const [sel, opts] of AUTO_SELECTORS) {
    const flatInPages = FLAT_IN_PAGES.has(sel)
    for (const node of document.querySelectorAll<HTMLElement>(sel)) {
      if (node.closest('.glab-overlay')) continue
      // Glass only on what floats: inside a page (WRLD aside) these are plain fills (index.css).
      if (flatInPages && node.closest(FLAT_PAGES)) continue
      if (node.closest('.modal-glass') && !node.classList.contains('modal-glass')) continue
      if (sel !== '.glass-pane' && sel !== '.glass-seg-thumb.is-ready' && node.closest('.glass-pane') && !node.classList.contains('glass-pane')) continue
      if (sel === '.glass-pane' && node.parentElement?.closest('.glass-pane')) continue
      add(node, opts)
    }
  }

  for (const prev of overflowedElements) {
    prev.removeAttribute('data-glass-overflow')
  }
  overflowedElements.clear()

  const nextGeometry: Array<{ el: HTMLElement; opts: GlassSurfaceOptions; r: DOMRect; radius: number }> = []
  let overflowCount = 0
  for (const { el, opts } of collected) {
    const r = isVisibleRect(el)
    if (!r) continue
    if (nextGeometry.length >= 28) {
      el.setAttribute('data-glass-overflow', '')
      overflowedElements.add(el)
      overflowCount++
      continue
    }
    const radius = opts.radius ?? parseBorderRadius(el, r)
    nextGeometry.push({ el, opts, r, radius })
  }
  if (overflowCount > 0 && !overflowWarned) {
    overflowWarned = true
    console.warn(`[glass-compositor] Surface cap (28) exceeded by ${overflowCount}; overflowed elements keep CSS glass fallback.`)
  }
  cachedGeometry = nextGeometry
  cachedPlayRect = playerExtras.playEl ? isVisibleRect(playerExtras.playEl) : null
  const modals = Array.from(document.querySelectorAll<HTMLElement>('.modal-glass, .glab-overlay'))
  cachedModalVisible = modals.some((el) => isVisibleRect(el) !== null)
  cachedSliderInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-glass-slider]'))
  cachedSliderRects.clear()
  for (const input of cachedSliderInputs) {
    cachedSliderRects.set(input, isVisibleRect(input))
  }
  frameStyles = new WeakMap<Element, CSSStyleDeclaration>()
  frameRects = new WeakMap<Element, DOMRect>()
  layoutDirty = false
}

function collectSurfaces(dt: number, reducedMotion: boolean, beatBoost = 0): { surfaces: CompositorSurface[]; play: [number, number, number, number]; animating: boolean } {
  if (layoutDirty) {
    rebuildGeometryCache()
  }

  const surfaces: CompositorSurface[] = []
  let play: [number, number, number, number] = [0.5, 0.5, 0.03, 0]
  let animating = false
  const vw = Math.max(1, window.innerWidth)
  const vh = Math.max(1, window.innerHeight)
  const modalOpen = cachedModalVisible

  for (const { el, opts, r, radius } of cachedGeometry) {
    const kind = opts.kind ?? 'panel'
    const layer = opts.layer ?? 1
    const isHovered = hoveredSurface !== null && (el === hoveredSurface || el.contains(hoveredSurface))
    const isPressed = pressedSurface !== null && (el === pressedSurface || el.contains(pressedSurface))
    let sp = surfaceSprings.get(el)
    if (!sp && (isHovered || isPressed)) {
      sp = { val: 0, target: 0, vel: 0 }
      surfaceSprings.set(el, sp)
    }
    let interact = 0
    if (sp) {
      sp.target = isPressed ? 0.45 : isHovered ? 0.22 : 0
      if (stepSpring(sp, dt, reducedMotion)) animating = true
      interact = Math.max(0, Math.min(0.48, sp.val))
    }
    const playFusion = opts.playFusion ? 1 + interact : interact
    surfaces.push({
      cx: r.left + r.width * 0.5,
      cy: r.top + r.height * 0.5,
      hw: r.width * 0.5,
      hh: r.height * 0.5,
      radius,
      kind: KIND_MAP[kind],
      layer,
      playFusion,
    })
    if (opts.playFusion && cachedPlayRect) {
      play = [
        (cachedPlayRect.left + cachedPlayRect.width * 0.5) / vw,
        (cachedPlayRect.top + cachedPlayRect.height * 0.5) / vh,
        (cachedPlayRect.width * 0.5) / vh,
        0,
      ]
    }
  }

  // Register player seek & volume liquid-glass capsule thumbs when no modal or Glass Lab covers them.
  for (const input of cachedSliderInputs) {
    const id = input.dataset.glassSlider
    const ir = cachedSliderRects.get(input) ?? null
    // Each slider needs both a capsule and its rail lens in the 32-surface buffer.
    const drawable = !modalOpen && Boolean(id) && Boolean(ir && ir.width >= 24) && surfaces.length + 2 <= 32
    if (input.hasAttribute('data-glass-slider-ready') !== drawable) {
      input.toggleAttribute('data-glass-slider-ready', drawable)
    }
    if (!drawable || !id || !ir) continue
    const min = Number(input.min || 0)
    const max = Number(input.max || 1)
    const val = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : min
    const ratio = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0
    let st = sliderSprings.get(id)
    if (!st) {
      st = { hover: { val: 0, target: 0, vel: 0 }, press: { val: 0, target: 0, vel: 0 } }
      sliderSprings.set(id, st)
    }
    if (stepSpring(st.hover, dt, reducedMotion)) animating = true
    if (stepSpring(st.press, dt, reducedMotion)) animating = true
    const hoverVal = Math.max(0, Math.min(1, st.hover.val))
    const pressVal = Math.max(0, Math.min(1, st.press.val))
    const scale = reducedMotion ? 1 : 1 + Math.max(hoverVal * 0.06, pressVal * 0.18)
    const baseHw = 13
    const baseHh = 7
    const thumbCx = ir.left + baseHw + ratio * Math.max(0, ir.width - baseHw * 2)
    const thumbCy = ir.top + ir.height * 0.5
    const seekPulse = id === 'seek' ? beatBoost * 0.35 : 0
    const lensStrength = Math.max(0, Math.min(1, hoverVal * 0.35 + pressVal + seekPulse))
    surfaces.push({
      cx: thumbCx,
      cy: thumbCy,
      hw: baseHw * scale,
      hh: baseHh * scale,
      radius: baseHh * scale,
      kind: 5,
      layer: 2,
      playFusion: 0,
    })
    surfaces.push({
      cx: ir.left,
      cy: ir.right,
      hw: thumbCy,
      hh: ratio,
      radius: baseHh,
      kind: 6,
      layer: 2,
      playFusion: lensStrength,
    })
  }

  return { surfaces, play, animating }
}

/** Global WebGPU glass compositor mount (placed once in App.tsx). */
export function GlassCompositorLayer(): JSX.Element | null {
  const { reducedMotion, reducedTransparency, gameMode } = useEffectsState()
  const theme = useStore((s) => s.theme)
  const adaptiveColors = useStore((s) => s.adaptiveColors)
  const adaptiveManualHold = useStore((s) => s.adaptiveManualHold)
  const activeView = useStore((s) => s.activeView)
  const currentTrack = useStore((s) => s.currentTrack)
  const currentTrackFull = useStore((s) => s.currentTrackFull)
  const radioFmActive = useStore((s) => s.radioFmActive)
  const radioFmMatchedSong = useStore((s) => s.radioFmMatchedSong)
  const libraryArt = useStore((s) => s.libraryArt)
  const glassLookKey = useGlassLookKey()

  const themeArt = buildImageUrl(getSkin(theme).art)
  const playingArt = radioFmActive ? radioFmMatchedSong?.imageUrl : currentTrackFull?.albumArt || currentTrack?.imageUrl || currentTrack?.apiImageUrl || (currentTrack ? libraryArt[currentTrack.id] : undefined)
  const effectiveArt = buildImageUrl(backdropArt(theme, adaptiveColors, buildImageUrl(playingArt)))

  useEffect(() => {
    if (reducedTransparency) {
      setReady(false)
      return
    }
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.glass-compositor-canvas')
    const overlayCanvas = document.querySelector<HTMLCanvasElement>('canvas.glass-compositor-overlay')
    if (!canvas) return

    let stopped = false
    let raf = 0
    let audioTimer: ReturnType<typeof setTimeout> | 0 = 0
    let running = false
    let lastTime = performance.now()
    let lastAudioDrawMs = 0
    let engine: Awaited<ReturnType<typeof createGlassCompositor>> | null = null
    let rawPunch = 0
    let rawRms = 0
    let smoothPunch = 0
    let smoothRms = 0
    const liveFlow = !reducedMotion && !gameMode
    const isPlaybackActive = (): boolean => {
      const st = useStore.getState()
      return st.radioFmActive ? !st.radioFmPaused : st.isPlaying
    }

    const unlistenMeter = liveFlow
      ? listenToMeter((m) => {
          rawPunch = Math.min(1.2, Math.max(0, m.punch > 1 ? (m.punch - 1) * 1.4 : m.punch * 0.25))
          rawRms = Math.min(1, Math.max(0, (m.decibels + 52) / 52))
        })
      : () => {}

    const uploadTintOrCover = (): void => {
      if (!engine) return
      if (backdropState.coverCanvas && backdropState.source === 'cover') {
        engine.upload(backdropState.coverCanvas)
        return
      }
      const c = document.createElement('canvas')
      c.width = 512; c.height = 512
      const ctx = c.getContext('2d')!
      const [r, g, b] = backdropState.tint
      ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
      ctx.fillRect(0, 0, 512, 512)
      engine.upload(c)
    }

    const run = (): void => {
      if (audioTimer) {
        clearTimeout(audioTimer)
        audioTimer = 0
      }
      if (stopped || document.hidden || running || !engine) return
      running = true
      raf = requestAnimationFrame(async (now) => {
        running = false
        if (stopped || document.hidden || !engine) return
        const dt = Math.min(0.032, Math.max(0.004, (now - lastTime) / 1000))
        lastTime = now
        const preset = getGlassPreset(useStore.getState().theme)
        const factor = reducedMotion ? 1 : preset.springStiffness
        playerExtras.lens[2] += (playerExtras.targetLens - playerExtras.lens[2]) * factor
        playerExtras.merge += (playerExtras.targetMerge - playerExtras.merge) * factor
        const playing = liveFlow && isPlaybackActive()
        if (playing) {
          const punchRate = rawPunch > smoothPunch ? 24 : 7
          smoothPunch += (rawPunch - smoothPunch) * Math.min(1, dt * punchRate)
          smoothRms += (rawRms - smoothRms) * Math.min(1, dt * 10)
        } else {
          smoothPunch = 0
          smoothRms = 0
        }
        const { surfaces, play, animating } = collectSurfaces(dt, reducedMotion, playing ? smoothPunch : 0)
        const tNow = performance.now()
        const needsFullRate =
          animating ||
          tNow < animUntil ||
          tNow - lastInteractionMs < 180 ||
          Math.abs(playerExtras.lens[2] - playerExtras.targetLens) > 0.005 ||
          Math.abs(playerExtras.merge - playerExtras.targetMerge) > 0.005

        if (needsFullRate || !playing || tNow - lastAudioDrawMs >= 32) {
          lastAudioDrawMs = tNow
          await engine.draw({
            light: backdropState.light,
            source: backdropState.source,
            pointer: backdropState.pointer,
            lens: [...playerExtras.lens] as [number, number, number],
            merge: playerExtras.merge,
            tint: backdropState.tint,
            tint2: backdropState.tint2,
            tint3: backdropState.tint3,
            play,
            preset,
            surfaces,
            audio: [smoothPunch, smoothRms, 0, playing ? 1 : 0],
          })
        }

        const after = performance.now()
        if (
          animating ||
          after < animUntil ||
          after - lastInteractionMs < 180 ||
          Math.abs(playerExtras.lens[2] - playerExtras.targetLens) > 0.005 ||
          Math.abs(playerExtras.merge - playerExtras.targetMerge) > 0.005
        ) {
          run()
        } else if (playing) {
          audioTimer = setTimeout(run, 32)
        }
      })
    }

    scheduleFn = run
    uploadFn = uploadTintOrCover

    createGlassCompositor(canvas, overlayCanvas).then((inst) => {
      if (stopped) { inst.destroy(); return }
      engine = inst
      backdropState.light = !getSkin(useStore.getState().theme).dark
      applyAmbientTints()
      uploadTintOrCover()
      setReady(true)
      inst.lost.then(() => {
        if (!stopped) {
          engine = null
          setReady(false)
        }
      })
      run()
    }).catch(() => {
      if (!stopped) setReady(false)
    })

    // The top bar is left out: pressing one of its buttons must not swell the whole bar.
    const surfaceSelector = '.app-player, .glass-seg, .glass-field, .glass-pane:not(.app-sidebar), .glass-button, .glass-bar, .glass-chip, .app-menu-glass, .menu-glass, .glass-popover, .modal-glass'
    const LAYOUT_PROPS = new Set(['transform', 'translate', 'scale', 'width', 'height', 'left', 'right', 'top', 'bottom', 'inset', 'max-width', 'max-height', 'margin', 'padding'])
    const onPointerMove = (e: PointerEvent): void => {
      backdropState.pointer = [
        e.clientX / Math.max(1, window.innerWidth),
        e.clientY / Math.max(1, window.innerHeight),
      ]
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(surfaceSelector) : null
      hoveredSurface = target
      lastInteractionMs = performance.now()
      run()
    }
    const onPointerDown = (e: PointerEvent): void => {
      pressedSurface = e.target instanceof Element ? e.target.closest<HTMLElement>(surfaceSelector) : null
      lastInteractionMs = performance.now()
      run()
    }
    const onPointerUp = (): void => {
      if (pressedSurface) {
        pressedSurface = null
        lastInteractionMs = performance.now()
        run()
      }
    }
    const onScrollOrResize = (): void => { layoutDirty = true; lastInteractionMs = performance.now(); run() }
    const onVisibility = (): void => { if (!document.hidden) { layoutDirty = true; lastInteractionMs = performance.now(); run() } }
    let animUntil = 0
    let animRaf = 0
    const pumpAnim = (): void => {
      layoutDirty = true
      run()
      if (!stopped && performance.now() < animUntil) {
        animRaf = requestAnimationFrame(pumpAnim)
      }
    }
    const startAnimSync = (ms = 560): void => {
      layoutDirty = true
      const now = performance.now()
      lastInteractionMs = now
      const next = now + ms
      const wasActive = now < animUntil
      animUntil = Math.max(animUntil, next)
      if (!wasActive) animRaf = requestAnimationFrame(pumpAnim)
    }
    const onAnimOrTransition = (e: Event): void => {
      if (e instanceof TransitionEvent && e.propertyName && !LAYOUT_PROPS.has(e.propertyName)) return
      if (e instanceof AnimationEvent && (e.animationName === 'img-fade-in' || e.animationName === 'pulse' || e.animationName === 'spin' || e.animationName === 'ambient-drift' || e.animationName === 'ambient-art-drift' || e.animationName === 'view-skeleton-in')) return
      const target = e.target instanceof Element ? e.target : null
      if (!target || (!target.matches(surfaceSelector) && !target.classList.contains('glass-seg-thumb') && !target.closest('.modal-glass, .app-menu-glass, .menu-glass, .glass-popover'))) return
      startAnimSync(420)
    }
    animSyncFn = startAnimSync

    const mo = new MutationObserver((records) => {
      let hasOverlayMut = false
      let hasElementMut = false
      for (const rec of records) {
        for (let i = 0; i < rec.addedNodes.length; i++) {
          const n = rec.addedNodes[i]
          if (n.nodeType === 1) {
            hasElementMut = true
            const el = n as Element
            if (el.matches?.('.modal-glass, .app-menu-glass, .menu-glass, .glass-popover') || el.querySelector?.('.modal-glass, .app-menu-glass, .menu-glass, .glass-popover')) {
              hasOverlayMut = true
              break
            }
          }
        }
        if (hasOverlayMut) break
        for (let i = 0; i < rec.removedNodes.length; i++) {
          if (rec.removedNodes[i].nodeType === 1) { hasElementMut = true; break }
        }
      }
      if (hasOverlayMut) {
        startAnimSync(320)
      } else if (hasElementMut) {
        layoutDirty = true
        run()
      }
    })
    const unsubscribePlay = useStore.subscribe((st, prev) => {
      if (st.isPlaying !== prev.isPlaying || st.radioFmActive !== prev.radioFmActive || st.radioFmPaused !== prev.radioFmPaused) {
        run()
      }
    })
    const rootEl = document.getElementById('root') ?? document.body
    mo.observe(rootEl, { childList: true, subtree: true })
    if (rootEl !== document.body) {
      mo.observe(document.body, { childList: true })
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true })
    window.addEventListener('animationstart', onAnimOrTransition, { capture: true, passive: true })
    window.addEventListener('transitionstart', onAnimOrTransition, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopped = true
      if (audioTimer) clearTimeout(audioTimer)
      unlistenMeter()
      unsubscribePlay()
      document.documentElement.classList.remove('beat-live')
      cancelAnimationFrame(raf)
      cancelAnimationFrame(animRaf)
      mo.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, { capture: true })
      window.removeEventListener('animationstart', onAnimOrTransition, { capture: true })
      window.removeEventListener('transitionstart', onAnimOrTransition, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      for (const prev of overflowedElements) {
        prev.removeAttribute('data-glass-overflow')
      }
      overflowedElements.clear()
      scheduleFn = () => {}
      animSyncFn = () => {}
      uploadFn = () => {}
      engine?.destroy()
      setReady(false)
    }
  }, [reducedTransparency, reducedMotion, gameMode])

  useEffect(() => {
    backdropState.light = !getSkin(theme).dark
    layoutDirty = true
    const raf = requestAnimationFrame(() => {
      if (backdropState.source === 'ambient' || !adaptiveColors || adaptiveManualHold) {
        applyAmbientTints()
        uploadFn()
      }
      scheduleFn()
    })
    return () => cancelAnimationFrame(raf)
  }, [theme, glassLookKey, activeView, adaptiveColors, adaptiveManualHold])

  useEffect(() => {
    if (reducedTransparency) return
    if (!effectiveArt) {
      backdropState.source = 'ambient'
      backdropState.coverCanvas = null
      backdropState.artUrl = null
      applyAmbientTints()
      uploadFn()
      scheduleFn()
      return
    }
    if (backdropState.artUrl === effectiveArt && backdropState.coverCanvas) {
      backdropState.source = 'cover'
      uploadFn()
      scheduleFn()
      return
    }
    let cancelled = false
    const toAmbient = (): void => {
      if (cancelled) return
      backdropState.source = 'ambient'
      backdropState.coverCanvas = null
      backdropState.artUrl = null
      applyAmbientTints()
      uploadFn()
      scheduleFn()
    }

    void (async () => {
      const [bitmap, palette] = await Promise.all([
        fetchCoverBitmap(effectiveArt),
        extractCoverPalette(effectiveArt, backdropState.light),
      ])
      if (cancelled) {
        bitmap?.close()
        return
      }
      if (!bitmap) {
        toAmbient()
        return
      }
      try {
        const c = document.createElement('canvas')
        c.width = 512; c.height = 512
        const ctx = c.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0, 512, 512)
        if (palette && adaptiveColors && !adaptiveManualHold) {
          backdropState.tint = [palette.dominant.rgb[0] / 255, palette.dominant.rgb[1] / 255, palette.dominant.rgb[2] / 255]
          backdropState.tint2 = [palette.complementary.rgb[0] / 255, palette.complementary.rgb[1] / 255, palette.complementary.rgb[2] / 255]
          backdropState.tint3 = [palette.tertiary.rgb[0] / 255, palette.tertiary.rgb[1] / 255, palette.tertiary.rgb[2] / 255]
        } else if (!adaptiveColors || adaptiveManualHold) {
          applyAmbientTints()
        } else {
          const d = ctx.getImageData(0, 0, 64, 64).data
          let r = 0, g = 0, b = 0, n = 0
          for (let i = 0; i < d.length; i += 16) {
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
          }
          if (n > 0) {
            const avg: [number, number, number] = [r / n / 255, g / n / 255, b / n / 255]
            backdropState.tint = avg
            backdropState.tint2 = avg
            backdropState.tint3 = avg
          }
        }
        backdropState.coverCanvas = c
        backdropState.artUrl = effectiveArt
        backdropState.source = 'cover'
        uploadFn()
        scheduleFn()
      } catch {
        toAmbient()
      } finally {
        bitmap.close()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [effectiveArt, themeArt, adaptiveColors, adaptiveManualHold, reducedTransparency])

  // Keep touch of getGlassLook so bundle keeps presets tree-shaken cleanly
  void getGlassLook

  if (reducedTransparency) return null
  return createPortal(
    createElement('div', { className: 'glass-compositor-stack', 'aria-hidden': true }, [
      createElement('canvas', { key: 'base', className: 'glass-compositor-canvas' }),
      createElement('canvas', { key: 'overlay', className: 'glass-compositor-overlay' }),
    ]),
    document.body,
  )
}
