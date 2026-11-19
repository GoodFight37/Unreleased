// Lightweight ReplayGain / perceived loudness normalizer for Unreleased Glass.
// Unreleased studio bounces, rough demos, and released masters routinely vary
// by 10–15 dB. This measures integrated RMS from the pre-EQ analysis tap,
// caches the track's linear gain adjustment (targeting -14 dBFS, safely clamped
// to -9 dB .. +5 dB), and applies it smoothly through audioEffects' masterGain.

import { getAnalysisTap, setNormalizationGain } from './audioEffects'

const CACHE_KEY = 'unreleased:loudnessCache:v1'
const MAX_CACHED_TRACKS = 1500
const TARGET_DBFS = -14.0
const MIN_GAIN_DB = -9.0
const MAX_GAIN_DB = 5.0

type GainCache = Record<string, number>

let cache: GainCache | null = null
let saveTimer: number | null = null

function loadCache(): GainCache {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    cache = {}
  }
  return cache!
}

function saveCacheDebounced(): void {
  if (saveTimer != null) return
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    if (!cache) return
    try {
      const keys = Object.keys(cache)
      if (keys.length > MAX_CACHED_TRACKS) {
        for (const k of keys.slice(0, keys.length - MAX_CACHED_TRACKS)) delete cache[k]
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch { /* ignore quota */ }
  }, 1500)
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

export function cachedLoudnessGain(trackId: string): number | null {
  const val = loadCache()[trackId]
  return typeof val === 'number' && Number.isFinite(val) ? val : null
}

let activeTrackId: string | null = null
let sampleTimer: number | null = null
let rmsSumSq = 0
let rmsCount = 0
let analyserNode: AnalyserNode | null = null
let analyserBuf: Float32Array<ArrayBuffer> | null = null

function stopSampling(): void {
  if (sampleTimer != null) {
    clearInterval(sampleTimer)
    sampleTimer = null
  }
  rmsSumSq = 0
  rmsCount = 0
}

function ensureMeterAnalyser(): AnalyserNode | null {
  const tap = getAnalysisTap()
  if (!tap) return null
  if (!analyserNode) {
    analyserNode = tap.ctx.createAnalyser()
    analyserNode.fftSize = 1024
    analyserBuf = new Float32Array(analyserNode.fftSize)
    tap.node.connect(analyserNode)
  }
  return analyserNode
}

/** Call whenever the active track, playing state, or loudness toggle changes. */
export function syncLoudnessNormalizer(
  trackId: string | null,
  enabled: boolean,
  isPlaying: boolean,
  elementVolume: number,
): void {
  if (!enabled || !trackId) {
    stopSampling()
    activeTrackId = null
    setNormalizationGain(1)
    return
  }

  if (trackId !== activeTrackId) {
    stopSampling()
    activeTrackId = trackId
    const cached = cachedLoudnessGain(trackId)
    setNormalizationGain(cached ?? 1)
  }

  if (!isPlaying || elementVolume < 0.05) {
    stopSampling()
    return
  }

  // Already measured for this track — keep cached gain applied.
  if (cachedLoudnessGain(trackId) != null) return
  if (sampleTimer != null) return

  sampleTimer = window.setInterval(() => {
    const node = ensureMeterAnalyser()
    if (!node || !analyserBuf || activeTrackId !== trackId) return
    node.getFloatTimeDomainData(analyserBuf)
    let sumSq = 0
    for (let i = 0; i < analyserBuf.length; i++) {
      const s = analyserBuf[i] / Math.max(0.05, elementVolume)
      sumSq += s * s
    }
    const frameRms = Math.sqrt(sumSq / analyserBuf.length)
    // Skip near-silent intros/gaps so silence never inflates gain.
    if (frameRms < 0.015) return
    rmsSumSq += frameRms * frameRms
    rmsCount++
    if (rmsCount >= 18) {
      const meanRms = Math.sqrt(rmsSumSq / rmsCount)
      const measuredDb = 20 * Math.log10(Math.max(1e-5, meanRms))
      const deltaDb = Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_DBFS - measuredDb))
      const gain = Math.round(dbToLinear(deltaDb) * 1000) / 1000
      loadCache()[trackId] = gain
      saveCacheDebounced()
      if (activeTrackId === trackId) setNormalizationGain(gain)
      stopSampling()
    }
  }, 250)
}
