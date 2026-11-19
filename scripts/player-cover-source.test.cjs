const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/Player.tsx'), 'utf8')
const tree = ts.createSourceFile('Player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect, cover
const helpers = []
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('const synthetic: FullTrack')) effect = node.arguments[0].getText(tree)
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'coverArt') cover = node.initializer.getText(tree)
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'initialCoverArt') helpers.push(node.getText(tree))
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(effect && cover)
const compiled = ts.transpileModule(helpers.join('\n') + '\nexports.effect = ' + effect + ';\nexports.cover = () => (' + cover + ');', { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText

function mount({ selected = 'selected.jpg', offline, cached, donor = false } = {}) {
  const track = { id: donor ? 'donor-123' : 'jw-123', path: 'track.mp3', title: 'Test', imageUrl: selected }
  const state = { currentTrack: track, currentTrackFull: null, offlineTracks: offline ? { [track.id]: offline } : {} }
  let resolve, reject, resolveDonor, requests = 0
  const response = new Promise((yes, no) => { resolve = yes; reject = no })
  const history = [], mod = {}, cache = new Map(cached ? [[123, { ...cached, ts: Date.now() }]] : [])
  const context = {
    exports: mod, window: {}, currentTrack: track, currentTrackFull: null,
    useStore: { getState: () => state }, toFileUrl: path => 'local-media:' + path,
    donorFileIdFromTrackId: () => donor ? 123 : null, trackIdToSongId: () => donor ? null : 123,
    ensureDonorCover: () => new Promise(resolve => { resolveDonor = resolve }),
    lyricsCache: cache, LYRICS_CACHE_TTL_MS: 100000,
    apiFetch: () => { requests++; return response }, updateLibraryTrack: () => {},
    setCurrentTrackFull(value) {
      state.currentTrackFull = typeof value === 'function' ? value(state.currentTrackFull) : value
      context.currentTrackFull = state.currentTrackFull
      record()
    },
  }
  const record = () => { const value = mod.cover(); if (!history.length || history.at(-1) !== value) history.push(value) }
  vm.runInNewContext(compiled, context)
  record()
  mod.effect()
  const settle = async action => { action(); await response.catch(() => {}); await new Promise(resolve => setImmediate(resolve)) }
  return {
    state, history, requests: () => requests,
    resolve: data => settle(() => resolve(data)), fail: () => settle(() => reject(new Error('offline'))),
    edit(value) { context.setCurrentTrackFull(previous => ({ ...previous, albumArt: value })) },
    switchTrack() { state.currentTrack = { id: 'jw-456' }; state.currentTrackFull = { id: 'jw-456', albumArt: 'next.jpg' }; context.currentTrackFull = state.currentTrackFull },
    async donor(value) { resolveDonor(value); await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('stale offline art never replaces the selected cover while lyrics are refreshed', async () => {
  const player = mount({ offline: { imageUrl: 'old.jpg', coverSourceUrl: 'old.jpg', lyrics: 'Offline sample' } })
  await player.resolve({ lyrics: 'Fresh sample', synced_lyrics: null })
  assert.deepEqual(player.history, ['selected.jpg'])
  assert.equal(player.state.currentTrackFull.lyrics, 'Fresh sample')
})

test('a matching local cover is used from the initial render, without a URL handover', async () => {
  const player = mount({ offline: { imageUrl: 'selected.jpg', coverSourceUrl: 'selected.jpg', localImagePath: 'cover.png' } })
  await player.resolve({ lyrics: 'Fresh sample' })
  assert.deepEqual(player.history, ['local-media:cover.png'])
})

test('an offline cover remains available when the track has no selected image', async () => {
  const player = mount({ selected: null, offline: { imageUrl: 'offline.jpg' } })
  await player.resolve({ lyrics: 'Fresh sample' })
  assert.deepEqual(player.history, ['offline.jpg'])
})

test('a chosen cover is preserved when a pending lyrics request succeeds', async () => {
  const player = mount()
  player.edit('chosen.jpg')
  await player.resolve({ lyrics: 'Fresh sample' })
  assert.equal(player.state.currentTrackFull.albumArt, 'chosen.jpg')
  assert.equal(player.state.currentTrackFull.lyricsPending, false)
})

test('a chosen cover is preserved when the lyrics request fails', async () => {
  const player = mount()
  player.edit('chosen.jpg')
  await player.fail()
  assert.equal(player.state.currentTrackFull.albumArt, 'chosen.jpg')
  assert.equal(player.state.currentTrackFull.lyricsPending, false)
})

test('late metadata for the previous track cannot overwrite the new one', async () => {
  const player = mount()
  player.switchTrack()
  await player.resolve({ lyrics: 'Previous sample' })
  assert.equal(player.state.currentTrackFull.id, 'jw-456')
  assert.equal(player.state.currentTrackFull.albumArt, 'next.jpg')
})

test('session-cached lyrics keep the same matching local cover and avoid a request', () => {
  const player = mount({ cached: { lyrics: 'Cached sample', syncedLyrics: null }, offline: { coverSourceUrl: 'selected.jpg', localImagePath: 'cover.png' } })
  assert.equal(player.requests(), 0)
  assert.deepEqual(player.history, ['local-media:cover.png'])
  assert.equal(player.state.currentTrackFull.lyrics, 'Cached sample')
})

test('a delayed donor tag cannot overwrite an intervening cover choice', async () => {
  const player = mount({ selected: null, donor: true })
  player.edit('chosen.jpg')
  await player.donor('embedded.jpg')
  assert.equal(player.state.currentTrackFull.albumArt, 'chosen.jpg')
})
