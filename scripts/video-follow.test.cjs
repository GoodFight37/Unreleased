const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const exportsValue = {}
const timers = new Map()
const code = ts.transpileModule(fs.readFileSync('src/renderer/src/lib/videoFollow.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
Function('exports', 'window', code)(exportsValue, { setInterval: fn => { timers.set(1, fn); return 1 }, clearInterval: id => timers.delete(id) })
const { videoTimeAt, followVideo } = exportsValue
test('video time follows offsets and skips scenes absent from the video', () => {
  const sync = { spans: [{ at: 0, lag: 2 }, { at: 10, lag: null }, { at: 20, lag: -3 }], covered: .8 }
  assert.equal(videoTimeAt(sync, 5), 7)
  assert.equal(videoTimeAt(sync, 15), null)
  assert.equal(videoTimeAt(sync, 22), 19)
})
test('following pauses and releases its timer and seek listener on cleanup', () => {
  const listeners = new Map()
  const video = { paused: true, currentTime: 3, duration: 100, seeking: false, readyState: 4, buffered: { length: 0 }, playbackRate: 1,
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event),
    pause() { this.paused = true }, play() { this.paused = false; return Promise.resolve() } }
  const stop = followVideo(video, { spans: [{ at: 0, lag: 0 }], covered: 1 }, () => ({ song: 3, playing: true, rate: 1 }), () => {})
  assert.equal(video.paused, false)
  stop()
  assert.equal(video.paused, true)
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
})
