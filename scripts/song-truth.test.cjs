const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/songTruth.ts'), 'utf8')
const mod = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: mod })
const { songTruth } = mod
const s = (o) => ({ name: 'Song', track_titles: [], ...o })

test('released with audio', () => {
  const t = songTruth(s({ category: 'released', path: 'a.mp3' }), true)
  assert.equal(t.kindLabel, 'Released'); assert.equal(t.canPlay, true)
})
test('unreleased keeps the exact leak_type', () => {
  const t = songTruth(s({ category: 'unreleased', leak_type: ' CDQ ' }), true)
  assert.equal(t.kindLabel, 'Unreleased'); assert.equal(t.leakLabel, 'CDQ')
})
test('unreleased without leak_type invents nothing', () => {
  const t = songTruth(s({ category: 'unreleased' }), true)
  assert.equal(t.kind, 'unreleased'); assert.equal(t.leakLabel, null)
  assert.equal(songTruth(s({ category: 'unreleased', leak_type: '  ' }), true).leakLabel, null)
})
test('leak_type containing snippet is a Snippet, any case; play only if playable', () => {
  assert.equal(songTruth(s({ category: 'unreleased', leak_type: 'OG File Snippet' }), true).kind, 'snippet')
  assert.equal(songTruth(s({ category: 'unreleased', leak_type: 'SNIPPET' }), false).canPlay, false)
  assert.equal(songTruth(s({ category: 'unreleased', leak_type: 'snippet' }), true).leakLabel, null)
  assert.equal(songTruth(s({ category: 'unreleased', leak_type: 'LQ Snippet' }), true).leakLabel, 'LQ Snippet')
})
test('unsurfaced is labelled Unsurfaced and never playable, even a snippet-looking one', () => {
  const t = songTruth(s({ category: 'unsurfaced', leak_type: 'snippet' }), true)
  assert.equal(t.kindLabel, 'Unsurfaced'); assert.equal(t.canPlay, false)
})
test('session follows playable', () => {
  assert.deepEqual([songTruth(s({ category: 'recording_session' }), true).canPlay, songTruth(s({ category: 'recording_session' }), false).canPlay], [true, false])
  assert.equal(songTruth(s({ category: 'recording_session' }), false).kind, 'session')
})
test('also known as: other titles + original_key, deduped, max 3', () => {
  const t = songTruth(s({ name: 'Take No Chance', category: 'unreleased', track_titles: ['take no chance', 'Awful Times', 'Awful Times'], original_key: 'Old Name' }), true)
  assert.equal(t.alsoKnownAs, 'Awful Times, Old Name')
  const many = songTruth(s({ category: 'unreleased', track_titles: ['a', 'b', 'c', 'd'] }), true)
  assert.equal(many.alsoKnownAs, 'a, b, c')
  assert.equal(songTruth(s({ category: 'unreleased', track_titles: ['Song'] }), true).alsoKnownAs, null)
})
test('credit: producer, else location, else date', () => {
  assert.equal(songTruth(s({ category: 'released', producers: 'Nick Mira', recording_locations: 'LA' }), true).credit, 'Nick Mira')
  assert.equal(songTruth(s({ category: 'released', producers: '', recording_locations: 'LA' }), true).credit, 'LA')
  assert.equal(songTruth(s({ category: 'released', record_dates: '2018' }), true).credit, '2018')
  assert.equal(songTruth(s({ category: 'released' }), true).credit, null)
})
