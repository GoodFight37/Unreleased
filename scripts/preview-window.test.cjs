const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/previewWindow.ts'), 'utf8')
const mod = {}
vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: mod })
const { windowFor, videoFrameShape, PREVIEW_LEN: LEN, PREVIEW_SKIP_MIN: SKIP_MIN, PREVIEW_TAIL: TAIL } = mod
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b)

test('measured durations from the real archive', () => {
  const cases = [
    [4, 0, 4, 'short'], [10, 0, 8, 'short'], [15, 0, 8, 'short'], [39, 5.85, 8, 'mid'], [59, 8.85, 8, 'mid'],
    [60, 20, 8, 'long'], [90, 27, 8, 'long'], [406, 121.8, 8, 'long'], [1792, 537.6, 8, 'long'], [2449, 734.7, 8, 'long'],
  ]
  for (const [D, start, len, source] of cases) {
    const w = windowFor(D)
    near(w.start, start)
    near(w.len, len)
    assert.equal(w.source, source, 'D=' + D)
  }
})

test('unknown or invalid duration falls back to the first 8 s', () => {
  for (const D of [NaN, Infinity, 0, -5, undefined]) {
    const w = windowFor(D)
    assert.deepEqual([w.start, w.len, w.source], [0, 8, 'unknown'])
  }
})

test('invariants hold for every whole duration from 1 s to 5 h', () => {
  for (let D = 1; D <= 18000; D++) {
    const w = windowFor(D)
    assert.ok(w.start >= 0 && w.len > 0, 'D=' + D)
    assert.ok(w.start + w.len <= D + 1e-9, 'inside the video, D=' + D)
    if (D >= 60) {
      assert.ok(w.start >= SKIP_MIN - 1e-9, 'floor, D=' + D)
      assert.ok(D - w.start >= TAIL - 1e-9, 'tail, D=' + D)
      assert.equal(w.len, LEN)
    }
  }
})

test('the jump at 60 s is documented, not hidden', () => {
  assert.ok(windowFor(59.99).start < 9 && windowFor(60).start === 20)
})

test('a curated passage is honoured but clamped inside the real duration', () => {
  assert.deepEqual({ ...windowFor(300, { start: 100 }) }, { start: 100, len: 8, source: 'curated' })
  assert.equal(windowFor(300, { start: 999 }).start, 292)
  assert.equal(windowFor(300, { start: -5 }).start, 0)
  assert.equal(windowFor(300, { start: 10, len: 99 }).len, 15)
  assert.equal(windowFor(300, { start: 10, len: 0.1 }).len, 2)
  assert.equal(windowFor(5, { start: 1, len: 10 }).len, 5)
  assert.equal(windowFor(300, {}).source, 'long')
})

test('videoFrameShape classifies wide, square/4:3, and vertical portrait frames', () => {
  assert.equal(videoFrameShape(1920, 1080), 'wide')
  assert.equal(videoFrameShape(720, 720), 'square')
  assert.equal(videoFrameShape(654, 480), 'square')
  assert.equal(videoFrameShape(406, 720), 'vertical')
  assert.equal(videoFrameShape(526, 1080), 'vertical')
})
