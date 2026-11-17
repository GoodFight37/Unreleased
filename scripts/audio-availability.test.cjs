const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/songVersions.ts'), 'utf8')
function availability(editAvailable) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: (name) => name.endsWith('sessionEditsApi') ? { hasPlayableSessionEdit: async () => editAvailable }
      : name.endsWith('sessionEditLinksMirror') ? { isSessionEditPlaceholder: (value) => value?.startsWith('sessionedit://') }
      : {},
  })
  return exports
}
test('missing audio is unavailable regardless of the version name or category', async () => {
  const api = availability(false)
  for (const category of ['unreleased', 'released', 'unsurfaced', 'recording_session']) {
    assert.equal(await api.isPlayableSong({ id: 1, category, path: '' }), false)
  }
  assert.equal(await api.isPlayableSong({ id: 1, category: 'recording_session', path: 'sessionedit://1' }), false)
  assert.equal(api.hasDirectAudioPath({ path: 'sessionedit://1' }), false)
})
test('real audio and successfully resolved session edits remain playable', async () => {
  const api = availability(true)
  assert.equal(await api.isPlayableSong({ id: 1, category: 'unreleased', path: 'Music/v3.mp3' }), true)
  assert.equal(await api.isPlayableSong({ id: 1, category: 'recording_session', path: '' }), true)
})

const player = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/Player.tsx'), 'utf8')
test('radio play/pause controls the live source and leaves the previous song paused', async () => {
  const start = player.indexOf('  const setPlayback = useCallback(')
  const code = player.slice(start, player.indexOf('  const { eqEnabled', start))
  const state = { currentTrack: { id: 'previous' }, isPlaying: false, radioFmActive: true, radioFmPaused: false }
  state.setIsPlaying = (value) => { state.isPlaying = value }
  let paused = 0
  let resumed = 0
  const context = vm.createContext({
    useCallback: (fn) => fn, useStore: { getState: () => state }, showAppToast: () => {},
    getActiveRadioClient: () => ({ stopListening: () => { paused++; state.radioFmPaused = true }, startListening: async () => { resumed++; state.radioFmPaused = false } }),
  })
  vm.runInContext(ts.transpileModule(`${code}\nglobalThis.toggle = togglePlayback`, {}).outputText, context)
  context.toggle()
  assert.equal(paused, 1)
  assert.equal(state.radioFmPaused, true)
  assert.equal(state.radioFmActive, true)
  context.toggle()
  assert.equal(resumed, 1)
  assert.equal(state.isPlaying, false)
  assert.equal(state.currentTrack.id, 'previous')
  state.radioFmActive = false
  context.toggle()
  assert.equal(state.isPlaying, true)
})
test('an unavailable catalogue choice stops instead of advancing to unrelated music', () => {
  const start = player.indexOf('  const skipUnplayableTrack = ')
  const code = player.slice(start, player.indexOf('  // A downloaded copy', start))
  const state = { currentTrack: { id: 'wanted', title: 'Wanted version' }, queueSource: 'tracker', isPlaying: true }
  let advanced = 0
  const context = vm.createContext({
    useStore: { getState: () => state }, lastProgressTime: { current: 0 }, consecutiveSkips: { current: 0 }, MAX_CONSECUTIVE_SKIPS: 3,
    runLog: () => {}, showAppToast: () => {}, setIsPlaying: (value) => { state.isPlaying = value }, nextTrack: () => { advanced++; return true },
  })
  vm.runInContext(ts.transpileModule(`${code}\nglobalThis.fail = skipUnplayableTrack`, {}).outputText, context)
  context.fail('missing file', '404')
  assert.equal(advanced, 0)
  assert.equal(state.isPlaying, false)
  assert.equal(state.currentTrack.id, 'wanted')
})
