const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  validateVideoSpec,
  resolveAudioSource,
  buildFfmpegShareArgs,
  createShareVideoManager,
} = require('./shareVideo')

function buildWavBuffer(durationSec = 1, sampleRate = 22050) {
  const numSamples = Math.floor(durationSec * sampleRate)
  const dataBytes = numSamples * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM chunk size
  buf.writeUInt16LE(1, 20)  // PCM format
  buf.writeUInt16LE(1, 22)  // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 6000)
    buf.writeInt16LE(sample, 44 + i * 2)
  }
  return buf
}

test('validateVideoSpec accepts 9:16 and 16:9 even dimensions and rejects invalid values', () => {
  assert.deepEqual(
    validateVideoSpec({ width: 1080, height: 1920, fps: 30, durationSec: 10, startSec: 2.5 }),
    { width: 1080, height: 1920, fps: 30, durationSec: 10, startSec: 2.5 },
  )
  assert.deepEqual(
    validateVideoSpec({ width: 1920, height: 1080, fps: 30, durationSec: 15 }),
    { width: 1920, height: 1080, fps: 30, durationSec: 15, startSec: 0 },
  )
  assert.throws(() => validateVideoSpec({ width: 1081, height: 1920, fps: 30, durationSec: 10 }), /even integer/)
  assert.throws(() => validateVideoSpec({ width: 1080, height: 1920, fps: 0, durationSec: 10 }), /fps/)
  assert.throws(() => validateVideoSpec({ width: 1080, height: 1920, fps: 30, durationSec: 0.1 }), /duration/)
  assert.throws(() => validateVideoSpec({ width: 1080, height: 1920, fps: 30, durationSec: 10, startSec: -1 }), /start time/)
})

test('resolveAudioSource validates URLs and safely materializes bytes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-test-'))
  try {
    assert.equal(resolveAudioSource({ audioUrl: 'http://example.com/song.mp3', tmpDir }), null)
    assert.equal(resolveAudioSource({ audioUrl: 'https://127.0.0.1/song.mp3', tmpDir }), null)
    assert.equal(resolveAudioSource({ audioUrl: 'https://localhost/song.mp3', tmpDir }), null)
    assert.equal(resolveAudioSource({ audioUrl: 'https://192.168.1.5/song.mp3', tmpDir }), null)

    const remote = resolveAudioSource({ audioUrl: 'https://cdn.example.com/audio/song.mp3', tmpDir })
    assert.deepEqual(remote, { inputPath: 'https://cdn.example.com/audio/song.mp3', isRemote: true, isLocalTemp: false })

    const wavPath = path.join(tmpDir, 'sample.wav')
    fs.writeFileSync(wavPath, buildWavBuffer(0.5))
    const localMedia = resolveAudioSource({
      audioUrl: `local-media://media?p=${encodeURIComponent(wavPath)}`,
      tmpDir,
    })
    assert.equal(localMedia?.inputPath, wavPath)

    const fileUrl = resolveAudioSource({ audioUrl: pathToFileURL(wavPath).href, tmpDir })
    assert.equal(fileUrl?.inputPath, wavPath)

    const bytesRes = resolveAudioSource({ audioBytes: buildWavBuffer(0.5), tmpDir })
    assert.ok(bytesRes && fs.existsSync(bytesRes.inputPath))
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('buildFfmpegShareArgs produces deterministic x264 + optional aac arguments', () => {
  const withAudio = buildFfmpegShareArgs({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 10,
    startSec: 12.5,
    audioInput: { inputPath: '/tmp/song.flac', isRemote: false },
    outPath: '/tmp/out.mp4',
  })
  assert.ok(withAudio.includes('rawvideo'))
  assert.ok(withAudio.includes('1080x1920'))
  assert.ok(withAudio.includes('libx264'))
  assert.ok(withAudio.includes('aac'))
  assert.ok(withAudio.includes('yuv420p'))
  assert.equal(withAudio[withAudio.length - 1], '/tmp/out.mp4')

  const videoOnly = buildFfmpegShareArgs({
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 5,
    startSec: 0,
    audioInput: null,
    outPath: '/tmp/silent.mp4',
  })
  assert.ok(!videoOnly.includes('aac'))
  assert.ok(videoOnly.includes('1920x1080'))
})

test('createShareVideoManager encodes a real MP4 with audio using ffmpeg-static', async () => {
  let ffmpegPath = null
  try { ffmpegPath = /** @type {string | null} */ (/** @type {unknown} */ (require('ffmpeg-static'))) } catch {}
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-mp4-e2e-'))
  const outPath = path.join(tmpDir, 'export-9x16.mp4')
  const manager = createShareVideoManager({ getFfmpegPath: () => ffmpegPath })
  try {
    const width = 256
    const height = 256
    const fps = 10
    const durationSec = 1
    const started = await manager.start({
      width,
      height,
      fps,
      durationSec,
      startSec: 0,
      includeAudio: true,
      audioBytes: buildWavBuffer(1),
      outPath,
    })
    assert.equal(started.hasAudio, true)

    const frame = Buffer.alloc(width * height * 4)
    for (let f = 0; f < fps * durationSec; f++) {
      for (let i = 0; i < frame.length; i += 4) {
        frame[i] = (f * 20) & 255
        frame[i + 1] = 80
        frame[i + 2] = 190
        frame[i + 3] = 255
      }
      await manager.writeFrame(started.id, frame)
    }

    const finished = await manager.finish(started.id)
    assert.equal(finished.ok, true)
    assert.equal(finished.hasAudio, true)
    assert.ok(finished.sizeBytes > 1000)
    const head = fs.readFileSync(outPath).subarray(0, 16)
    assert.ok(head.includes(Buffer.from('ftyp')), 'expected valid MP4 ftyp box header')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
