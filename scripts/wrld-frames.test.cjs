const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/wrldAtmospheres.ts'), 'utf8')
const mod = {}
vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: mod })
const { chunkWords, normalizeWrldFrame, normalizeWrldInk } = mod

// Array.from: the module runs in its own vm realm, whose arrays fail deepStrictEqual against this one's.
const sizes = (n) => Array.from(chunkWords(Array.from({ length: n }, (_, i) => i)), (c) => c.length)

test('Classic cuts a line into pieces of at most six words, evenly', () => {
  assert.deepEqual(sizes(0), [])
  assert.deepEqual(sizes(3), [3])
  assert.deepEqual(sizes(6), [6])
  assert.deepEqual(sizes(7), [4, 3])
  assert.deepEqual(sizes(13), [5, 4, 4])
  for (let n = 1; n <= 40; n++) {
    const s = sizes(n)
    assert.equal(s.reduce((a, b) => a + b, 0), n)
    assert.ok(s.every((k) => k <= 6), `n=${n} ${s}`)
    if (n >= 3) assert.ok(s.every((k) => k >= 3), `no short tail for n=${n}: ${s}`)
  }
})

test('defaults: Classic frame, white words', () => {
  assert.equal(normalizeWrldFrame(undefined), 'classic')
  assert.equal(normalizeWrldFrame('quiet'), 'quiet')
  assert.equal(normalizeWrldFrame('karaoke'), 'classic')
  assert.equal(normalizeWrldInk(null), 'white')
  assert.equal(normalizeWrldInk('yellow'), 'yellow')
})
