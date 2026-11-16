// Player quality tag (src/renderer/src/lib/audioQuality.ts), loaded through
// Node's built-in TypeScript type stripping.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { audioQualityLabel } = require('../src/renderer/src/lib/audioQuality.ts')

test('lossless files show bit depth and sample rate', () => {
  assert.equal(audioQualityLabel({ ext: 'flac', bitsPerSample: 24, sampleRate: 96000 }), 'FLAC 24/96')
  assert.equal(audioQualityLabel({ ext: '.wav', bitsPerSample: 16, sampleRate: 44100 }), 'WAV 16/44.1')
  assert.equal(audioQualityLabel({ ext: 'flac' }), 'FLAC')
})

test('lossy files show their bitrate in kbps', () => {
  assert.equal(audioQualityLabel({ ext: 'mp3', bitrate: 320 }), 'MP3 320')
  assert.equal(audioQualityLabel({ ext: 'm4a', bitrate: 256000 }), 'AAC 256')
  assert.equal(audioQualityLabel({ ext: 'm4a', bitsPerSample: 16, sampleRate: 44100, bitrate: 900 }), 'ALAC 16/44.1')
  assert.equal(audioQualityLabel({ ext: 'ogg' }), 'OGG')
})

test('nothing to show without a format', () => {
  assert.equal(audioQualityLabel(null), null)
  assert.equal(audioQualityLabel({ ext: '' }), null)
})
