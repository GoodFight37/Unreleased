// Share Studio MP4 encoder manager: receives deterministic RGBA video frames
// from the renderer over IPC and muxes them with an optional audio excerpt via
// the app's resolved FFmpeg binary.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { once } = require('events')
const { fileURLToPath } = require('url')

const ALLOWED_AUDIO_EXTS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.opus', '.wma', '.aiff', '.aif', '.caf', '.alac', '.mp4', '.webm',
])

const PRIVATE_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i

/**
 * Validate video export parameters. Dimensions must be even (required by H.264 yuv420p).
 * @param {{ width: number, height: number, fps: number, durationSec: number, startSec?: number }} opts
 */
function validateVideoSpec(opts) {
  const width = Number(opts?.width)
  const height = Number(opts?.height)
  const fps = Number(opts?.fps)
  const durationSec = Number(opts?.durationSec)
  const startSec = opts?.startSec == null ? 0 : Number(opts.startSec)

  if (!Number.isInteger(width) || width < 256 || width > 2160 || width % 2 !== 0) {
    throw new Error('Video width must be an even integer between 256 and 2160')
  }
  if (!Number.isInteger(height) || height < 256 || height > 2160 || height % 2 !== 0) {
    throw new Error('Video height must be an even integer between 256 and 2160')
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new Error('Video fps must be an integer between 1 and 60')
  }
  if (!Number.isFinite(durationSec) || durationSec < 0.5 || durationSec > 60) {
    throw new Error('Video duration must be between 0.5 and 60 seconds')
  }
  if (!Number.isFinite(startSec) || startSec < 0) {
    throw new Error('Audio start time must be >= 0')
  }
  return { width, height, fps, durationSec, startSec }
}

/**
 * Resolve an audio excerpt source (renderer bytes, local-media:, file:, or https:).
 * @param {{ audioUrl?: string | null, audioBytes?: Uint8Array | Buffer | null, tmpDir: string }} opts
 * @returns {{ inputPath: string, isRemote: boolean, isLocalTemp: boolean } | null}
 */
function resolveAudioSource({ audioUrl, audioBytes, tmpDir }) {
  if (audioBytes && audioBytes.byteLength > 0) {
    if (audioBytes.byteLength > 128 * 1024 * 1024) {
      throw new Error('Audio excerpt buffer exceeds 128 MB limit')
    }
    const buf = Buffer.isBuffer(audioBytes)
      ? audioBytes
      : Buffer.from(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength)
    const inputPath = path.join(tmpDir, 'audio-input.bin')
    fs.writeFileSync(inputPath, buf)
    return { inputPath, isRemote: false, isLocalTemp: true }
  }

  if (typeof audioUrl !== 'string' || !audioUrl.trim()) return null
  const raw = audioUrl.trim()

  if (raw.startsWith('local-media:')) {
    let target = null
    try { target = new URL(raw).searchParams.get('p') } catch { return null }
    if (!target || !path.isAbsolute(target)) return null
    if (!ALLOWED_AUDIO_EXTS.has(path.extname(target).toLowerCase())) return null
    if (!fs.existsSync(target)) return null
    return { inputPath: target, isRemote: false, isLocalTemp: false }
  }

  if (raw.startsWith('file:')) {
    let target
    try { target = fileURLToPath(raw) } catch { return null }
    if (!ALLOWED_AUDIO_EXTS.has(path.extname(target).toLowerCase())) return null
    if (!fs.existsSync(target)) return null
    return { inputPath: target, isRemote: false, isLocalTemp: false }
  }

  if (raw.startsWith('https://')) {
    let u
    try { u = new URL(raw) } catch { return null }
    if (u.protocol !== 'https:' || PRIVATE_HOST_RE.test(u.hostname.replace(/^\[|\]$/g, ''))) {
      return null
    }
    return { inputPath: u.toString(), isRemote: true, isLocalTemp: false }
  }

  return null
}

/**
 * Build deterministic FFmpeg arguments for raw RGBA frames + optional audio excerpt -> MP4.
 * @param {{
 *   width: number,
 *   height: number,
 *   fps: number,
 *   durationSec: number,
 *   startSec: number,
 *   audioInput: { inputPath: string, isRemote: boolean } | null,
 *   outPath: string,
 * }} opts
 * @returns {string[]}
 */
function buildFfmpegShareArgs({ width, height, fps, durationSec, startSec, audioInput, outPath }) {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
  ]

  if (audioInput) {
    if (audioInput.isRemote) {
      args.push('-user_agent', 'Unreleased-App')
    }
    args.push('-ss', startSec.toFixed(3), '-t', durationSec.toFixed(3), '-i', audioInput.inputPath)
    args.push('-map', '0:v:0', '-map', '1:a:0?')
    const fadeIn = Math.min(0.25, durationSec * 0.15)
    const fadeOut = Math.min(0.45, durationSec * 0.25)
    const fadeOutStart = Math.max(0, durationSec - fadeOut)
    args.push(
      '-af',
      `apad,afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}`,
      '-c:a', 'aac',
      '-b:a', '192k',
    )
  } else {
    args.push('-map', '0:v:0')
  }

  args.push(
    '-t', durationSec.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath,
  )
  return args
}

/**
 * Create a manager for active FFmpeg Share Studio encoding sessions.
 * @param {{ getFfmpegPath: () => string | null, parseDuration?: (filePath: string) => Promise<number> }} deps
 */
function createShareVideoManager({ getFfmpegPath, parseDuration }) {
  /** @type {Map<string, {
   *   id: string,
   *   width: number,
   *   height: number,
   *   frameBytes: number,
   *   outPath: string,
   *   tmpDir: string,
   *   hasAudio: boolean,
   *   ff: import('child_process').ChildProcessWithoutNullStreams,
   *   done: Promise<void>,
   *   stderr: string,
   *   aborted: boolean,
   * }>} */
  const sessions = new Map()

  const cleanupSession = (session, removeOutput = false) => {
    sessions.delete(session.id)
    try { fs.rmSync(session.tmpDir, { recursive: true, force: true }) } catch {}
    if (removeOutput) {
      try { fs.unlinkSync(session.outPath) } catch {}
    }
  }

  /**
   * @param {{
   *   width: number,
   *   height: number,
   *   fps: number,
   *   durationSec: number,
   *   startSec?: number,
   *   includeAudio?: boolean,
   *   audioUrl?: string | null,
   *   audioBytes?: Uint8Array | Buffer | null,
   *   outPath: string,
   * }} opts
   */
  async function start(opts) {
    const ffmpegPath = getFfmpegPath()
    if (!ffmpegPath) {
      throw new Error('FFmpeg is not installed yet — click Download FFmpeg to enable MP4 export.')
    }
    const spec = validateVideoSpec(opts)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-studio-'))
    let audioInput = null
    try {
      if (opts.includeAudio !== false) {
        audioInput = resolveAudioSource({
          audioUrl: opts.audioUrl,
          audioBytes: opts.audioBytes,
          tmpDir,
        })
      }
      let startSec = spec.startSec
      if (audioInput && !audioInput.isRemote && parseDuration) {
        try {
          const trackDur = await parseDuration(audioInput.inputPath)
          if (Number.isFinite(trackDur) && trackDur > 0 && startSec >= trackDur - 0.3) {
            startSec = Math.max(0, trackDur - Math.min(spec.durationSec, trackDur))
          }
        } catch {}
      }

      const args = buildFfmpegShareArgs({
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
        durationSec: spec.durationSec,
        startSec,
        audioInput,
        outPath: opts.outPath,
      })

      const id = crypto.randomUUID()
      const ff = spawn(ffmpegPath, args, { windowsHide: true })
      const session = {
        id,
        width: spec.width,
        height: spec.height,
        frameBytes: spec.width * spec.height * 4,
        outPath: opts.outPath,
        tmpDir,
        hasAudio: !!audioInput,
        ff,
        stderr: '',
        aborted: false,
        done: /** @type {Promise<void>} */ (/** @type {unknown} */ (null)),
      }
      session.done = new Promise((resolve, reject) => {
        ff.on('error', reject)
        ff.stderr.on('data', (chunk) => {
          session.stderr += chunk.toString()
          if (session.stderr.length > 8000) session.stderr = session.stderr.slice(-8000)
        })
        ff.on('close', (code) => {
          if (session.aborted) return resolve()
          if (code === 0) return resolve()
          const tail = session.stderr.split('\n').map(l => l.trim()).filter(Boolean).slice(-3).join(' ')
          reject(new Error(tail || `FFmpeg exited with code ${code}`))
        })
      })
      ff.stdin.on('error', () => { /* handled by ff close/error */ })
      sessions.set(id, session)
      return { id, hasAudio: !!audioInput }
    } catch (err) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      throw err
    }
  }

  /**
   * @param {string} id
   * @param {Uint8Array | Buffer} frame
   */
  async function writeFrame(id, frame) {
    const session = sessions.get(id)
    if (!session) throw new Error('Share Studio video session not found')
    if (!frame || frame.byteLength !== session.frameBytes) {
      throw new Error(`Invalid frame size: expected ${session.frameBytes} bytes, got ${frame?.byteLength ?? 0}`)
    }
    const buf = Buffer.isBuffer(frame)
      ? frame
      : Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
    if (!session.ff.stdin.write(buf)) {
      await once(session.ff.stdin, 'drain')
    }
  }

  /**
   * @param {string} id
   */
  async function finish(id) {
    const session = sessions.get(id)
    if (!session) throw new Error('Share Studio video session not found')
    try {
      session.ff.stdin.end()
      await session.done
      const stat = fs.statSync(session.outPath)
      if (!stat.size) throw new Error('Produced MP4 file is empty')
      cleanupSession(session, false)
      return { ok: true, path: session.outPath, sizeBytes: stat.size, hasAudio: session.hasAudio }
    } catch (err) {
      cleanupSession(session, true)
      throw err
    }
  }

  /**
   * @param {string} id
   */
  async function abort(id) {
    const session = sessions.get(id)
    if (!session) return { ok: true }
    session.aborted = true
    try { session.ff.kill('SIGKILL') } catch {}
    await session.done.catch(() => {})
    cleanupSession(session, true)
    return { ok: true }
  }

  function abortAll() {
    for (const id of [...sessions.keys()]) {
      void abort(id)
    }
  }

  return { start, writeFrame, finish, abort, abortAll }
}

module.exports = {
  ALLOWED_AUDIO_EXTS,
  validateVideoSpec,
  resolveAudioSource,
  buildFfmpegShareArgs,
  createShareVideoManager,
}
