import { useSyncExternalStore } from 'react'

export type EffectsMode = 'on' | 'system' | 'reduced'
export type EffectsQuality = 'full' | 'game'

const KEY = 'unreleased.effects-mode'
const QKEY = 'unreleased.effects-quality'
const observers = new Set<() => void>()
const hasWindow = typeof window !== 'undefined'
const motion = hasWindow ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
const transparency = hasWindow ? window.matchMedia('(prefers-reduced-transparency: reduce)') : null
let mode: EffectsMode = readMode()
let quality: EffectsQuality = readQuality()

function readMode(): EffectsMode {
  try { const value = localStorage.getItem(KEY); return value === 'system' || value === 'reduced' ? value : 'on' } catch { return 'on' }
}
function readQuality(): EffectsQuality {
  try { const value = localStorage.getItem(QKEY); return value === 'game' ? 'game' : 'full' } catch { return 'full' }
}

export function getEffectsMode(): EffectsMode { return mode }
export function getEffectsQuality(): EffectsQuality { return quality }
export function isGameEffectsMode(): boolean { return quality === 'game' }
export function isReducedMotion(): boolean { return mode === 'reduced' || (mode === 'system' && !!motion?.matches) }
export function isReducedTransparency(): boolean { return mode === 'reduced' || (mode === 'system' && !!transparency?.matches) }
/** True when continuous/ambient visuals should animate (not reduced-motion and not Game/economy mode). */
export function liveVisualsAllowed(): boolean { return !isReducedMotion() && quality === 'full' }

function refresh() {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.effectsMotion = isReducedMotion() ? 'reduce' : 'full'
    document.documentElement.dataset.effectsTransparency = isReducedTransparency() ? 'reduce' : 'full'
    document.documentElement.dataset.effectsQuality = quality
  }
  observers.forEach(fn => fn())
}

export function setEffectsMode(value: EffectsMode): void {
  if (!['on', 'system', 'reduced'].includes(value)) return
  mode = value
  try { localStorage.setItem(KEY, value) } catch { /* available for this window only */ }
  refresh()
}

export function setEffectsQuality(value: EffectsQuality): void {
  if (value !== 'full' && value !== 'game') return
  quality = value
  try { localStorage.setItem(QKEY, value) } catch { /* available for this window only */ }
  refresh()
}

function subscribe(fn: () => void): () => void { observers.add(fn); return () => { observers.delete(fn) } }
export function useEffectsMode(): EffectsMode { return useSyncExternalStore(subscribe, getEffectsMode, () => 'on') }
export function useEffectsQuality(): EffectsQuality { return useSyncExternalStore(subscribe, getEffectsQuality, () => 'full') }
export function useEffectsState() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${mode}:${quality}:${+isReducedMotion()}:${+isReducedTransparency()}`,
    () => 'on:full:0:0',
  )
  const [value, q, reducedMotion, reducedTransparency] = snapshot.split(':')
  return {
    mode: value as EffectsMode,
    quality: q as EffectsQuality,
    gameMode: q === 'game',
    reducedMotion: reducedMotion === '1',
    reducedTransparency: reducedTransparency === '1',
  }
}

// Small matchMedia-like adapter for existing animation code, with live updates
// for both OS changes and the app setting, without altering window.matchMedia.
export function effectsMotionMedia() {
  return {
    get matches() { return isReducedMotion() },
    addEventListener: (_type: 'change', fn: () => void) => { observers.add(fn) },
    removeEventListener: (_type: 'change', fn: () => void) => { observers.delete(fn) },
  }
}

if (hasWindow) {
  motion?.addEventListener('change', refresh)
  transparency?.addEventListener('change', refresh)
  window.addEventListener('storage', e => {
    if (e.key === KEY || e.key === null) mode = readMode()
    if (e.key === QKEY || e.key === null) quality = readQuality()
    if (e.key === KEY || e.key === QKEY || e.key === null) refresh()
  })
  refresh()
}
