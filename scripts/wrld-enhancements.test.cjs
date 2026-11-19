const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(filePath, stubs = {}) {
  const code = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  const req = (id) => {
    if (id in stubs) return stubs[id]
    throw new Error(`Unexpected require(${id}) from ${filePath}`)
  }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: req })
  return mod.exports
}

const memStore = new Map()
const persistStub = {
  ls: {
    get: (k) => (memStore.has(k) ? memStore.get(k) : null),
    set: (k, v) => { memStore.set(k, v) },
    remove: (k) => { memStore.delete(k) },
  },
}

const { splitColorWords, wordRuns, LYRIC_COLOR_WORDS } = loadTs('src/renderer/src/lib/lyrics.ts', {
  react: { useEffect: () => {}, useState: (v) => [v, () => {}] },
})

const {
  stableHash,
  normalizeEraKey,
  normalizeCoverTitle,
  setFanCoversIndex,
  peekFanCoverForSong,
} = loadTs('src/renderer/src/lib/fanCovers.ts', {
  './persist': persistStub,
})

test('splitColorWords respects word boundaries and dark/light WCAG AA palettes', () => {
  // "tired" contains "red" and "nice" contains "ice" — neither should be highlighted.
  const noFalsePositives = splitColorWords('I am tired of being nice today')
  assert.equal(noFalsePositives.every((seg) => !seg.color), true)

  const dark = splitColorWords('999 Juice WRLD pouring lean in the cold fire')
  const coloredDark = dark.filter((seg) => seg.color)
  assert.deepEqual(
    Array.from(coloredDark, (seg) => seg.text),
    ['999', 'Juice WRLD', 'lean', 'cold', 'fire'],
  )

  const light = splitColorWords('999 cold fire', LYRIC_COLOR_WORDS, { light: true })
  const coloredLight = light.filter((seg) => seg.color)
  assert.equal(coloredLight[0].color, '#9a5b00')
  assert.equal(coloredLight[1].color, '#0369a1')
  assert.equal(coloredLight[2].color, '#be123c')

  const disabled = splitColorWords('999 cold fire', LYRIC_COLOR_WORDS, { enabled: false })
  assert.equal(disabled.length, 1)
  assert.equal(disabled[0].text, '999 cold fire')
  assert.equal(disabled[0].color, undefined)
})

test('wordRuns honors enabled flag and light palette for enhanced LRC words', () => {
  const words = [
    { text: 'Cold', start: 1.0, end: 1.3 },
    { text: 'heart', start: 1.4, end: 1.8 },
    { text: '(999)', start: 1.9, end: 2.2 },
  ]
  const darkRuns = wordRuns(words, LYRIC_COLOR_WORDS, { light: false, enabled: true })
  assert.equal(darkRuns[0].color, '#7dd3fc')
  assert.equal(darkRuns[1].color, '#f9a8d4')
  assert.equal(darkRuns[2].adLib, true)

  const offRuns = wordRuns(words, LYRIC_COLOR_WORDS, { enabled: false })
  assert.equal(offRuns.every((r) => !r.color), true)
})

test('fanCovers assigns deterministic era covers by songId with title priority', () => {
  assert.equal(stableHash(94316), stableHash(94316))
  assert.notEqual(stableHash(94316), stableHash(94317))

  assert.equal(normalizeEraKey('Goodbye & Good Riddance (Era)'), 'gbgr')
  assert.equal(normalizeEraKey('Death Race for Love'), 'drfl')
  assert.equal(normalizeEraKey('WRLD ON DRUGS'), 'wod')
  assert.equal(normalizeEraKey('JuiceWRLD 9 9 9'), '999')
  assert.equal(normalizeCoverTitle('Timid Half (v2).png'), 'timid half')

  setFanCoversIndex({
    updatedAt: Date.now(),
    byEra: {
      gbgr: ['https://example.com/gbgr-1.jpg', 'https://example.com/gbgr-2.jpg', 'https://example.com/gbgr-3.jpg'],
    },
    byTitle: {
      'timid half': 'https://example.com/timid-half.jpg',
    },
    all: ['https://example.com/gbgr-1.jpg', 'https://example.com/gbgr-2.jpg', 'https://example.com/gbgr-3.jpg'],
  })

  // Exact title match wins over era hash
  assert.equal(
    peekFanCoverForSong(94316, 'Goodbye & Good Riddance', 'Timid Half'),
    'https://example.com/timid-half.jpg',
  )

  // Deterministic across repeated calls for the same songId
  const pickA = peekFanCoverForSong(12345, 'GB&GR', 'Unknown Unreleased')
  const pickB = peekFanCoverForSong(12345, 'Goodbye & Good Riddance', 'Unknown Unreleased')
  assert.ok(pickA && pickA.startsWith('https://example.com/gbgr-'))
  assert.equal(pickA, pickB)
})
