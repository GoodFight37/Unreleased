import { useSyncExternalStore } from 'react'

export type EffectsMode = 'on' | 'system' | 'reduced'
const KEY = 'unreleased.effects-mode'
const observers = new Set<() => void>()
const hasWindow = typeof window !== 'undefined'
const motion = hasWindow ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
const transparency = hasWindow ? window.matchMedia('(prefers-reduced-transparency: reduce)') : null
let mode: EffectsMode = readMode()
function readMode(): EffectsMode {
  try { const value = localStorage.getItem(KEY); return value === 'system' || value === 'reduced' ? value : 'on' } catch { return 'on' }
}
export function getEffectsMode(): EffectsMode { return mode }
export function isReducedMotion(): boolean { return mode === 'reduced' || (mode === 'system' && !!motion?.matches) }
export function isReducedTransparency(): boolean { return mode === 'reduced' || (mode === 'system' && !!transparency?.matches) }
function refresh() {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.effectsMotion = isReducedMotion() ? 'reduce' : 'full'
    document.documentElement.dataset.effectsTransparency = isReducedTransparency() ? 'reduce' : 'full'
  }
  observers.forEach(fn => fn())
}
export function setEffectsMode(value: EffectsMode): void {
  if (!['on','system','reduced'].includes(value)) return
  mode = value
  try { localStorage.setItem(KEY, value) } catch { /* available for this window only */ }
  refresh()
}
function subscribe(fn: () => void): () => void { observers.add(fn); return () => { observers.delete(fn) } }
export function useEffectsMode(): EffectsMode { return useSyncExternalStore(subscribe, getEffectsMode, () => 'on') }
export function useEffectsState() {
  const snapshot = useSyncExternalStore(subscribe, () => `${mode}:${+isReducedMotion()}:${+isReducedTransparency()}`, () => 'on:0:0')
  const [value, reducedMotion, reducedTransparency] = snapshot.split(':')
  return { mode: value as EffectsMode, reducedMotion: reducedMotion === '1', reducedTransparency: reducedTransparency === '1' }
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
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) { mode = readMode(); refresh() } })
  refresh()
}
