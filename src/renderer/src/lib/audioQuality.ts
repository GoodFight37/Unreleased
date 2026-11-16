// A short, plain quality tag for the player (e.g. "FLAC 24/96", "MP3 320"),
// from what the file itself reports. Null when there's nothing worth showing.
const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv'])

export interface AudioQualityInput {
  ext?: string | null
  bitrate?: number | null        // kbps (electron/main.js divides by 1000)
  sampleRate?: number | null     // Hz
  bitsPerSample?: number | null
}

export function audioQualityLabel(info: AudioQualityInput | null | undefined): string | null {
  const ext = (info?.ext ?? '').replace(/^\./, '').toLowerCase()
  if (!ext) return null
  // .m4a holds AAC or Apple Lossless; only lossless decodes report a bit depth.
  const alac = ext === 'm4a' && !!info?.bitsPerSample
  const name = ext === 'm4a' ? (alac ? 'ALAC' : 'AAC') : ext.toUpperCase()
  if (LOSSLESS.has(ext) || alac) {
    const bits = info?.bitsPerSample
    const rate = info?.sampleRate
    if (!bits || !rate) return name
    const khz = Math.round(rate / 100) / 10
    return `${name} ${bits}/${Number.isInteger(khz) ? khz : khz.toFixed(1)}`
  }
  const kbps = info?.bitrate && info.bitrate > 4000 ? Math.round(info.bitrate / 1000) : info?.bitrate
  return kbps ? `${name} ${Math.round(kbps)}` : name
}
