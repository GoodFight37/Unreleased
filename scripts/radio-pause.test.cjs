const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..', 'src', 'renderer', 'src')

function loadTs(relPath, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const loaded = { exports: {} }
  const ctx = vm.createContext({
    require: (id) => {
      if (id in mocks) return mocks[id]
      return {}
    },
    module: loaded,
    exports: loaded.exports,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    URL: class FakeURL {
      constructor(u) { this.href = u; this.protocol = 'https:'; this.host = 'juicewrldapi.com'; this.pathname = '/juicewrld' }
    },
    ...globals,
  })
  vm.runInContext(compiled, ctx)
  return loaded.exports
}

test('RadioStreamClient.stopListening detaches audio src before revoking objectUrl and closing MediaSource', () => {
  const events = []
  let listeningStates = []
  let sentFrames = []

  class FakeMediaSource {
    constructor() {
      this.readyState = 'open'
      this.listeners = {}
    }
    static isTypeSupported() { return true }
    addEventListener(type, fn) { this.listeners[type] = fn }
    addSourceBuffer() {
      return {
        mode: '',
        updating: false,
        buffered: { length: 0 },
        addEventListener() {},
        appendBuffer() {},
      }
    }
    endOfStream() {
      events.push('endOfStream')
      this.readyState = 'ended'
    }
  }

  const fakeWindow = {
    MediaSource: FakeMediaSource,
  }
  const fakeUrl = {
    createObjectURL: () => { events.push('createObjectURL'); return 'blob:fm-live' },
    revokeObjectURL: (u) => { events.push(`revoke:${u}`) },
  }
  const fakeAudio = {
    src: '',
    paused: false,
    pause() { events.push('audio.pause'); this.paused = true },
    removeAttribute(attr) { events.push(`audio.removeAttribute:${attr}`); if (attr === 'src') this.src = '' },
    load() { events.push('audio.load') },
    play() { events.push('audio.play'); return Promise.resolve() },
  }

  const { RadioStreamClient } = loadTs(
    'lib/radioSocketService.ts',
    {
      './apiServers': { RADIO_API_BASE: 'https://juicewrldapi.com/juicewrld' },
      './audioEffects': { resumeEffectsContext: () => {} },
      './userApi': { getToken: () => null },
    },
    {
      window: fakeWindow,
      URL: Object.assign(function FakeURL(u) { return new URL(u) }, fakeUrl),
      localStorage: { getItem: () => 'cid-1', setItem: () => {} },
      WebSocket: { OPEN: 1, CLOSED: 3 },
    },
  )

  const client = new RadioStreamClient({
    onListening: (v) => listeningStates.push(v),
  })
  client.ws = { readyState: 1, send: (raw) => sentFrames.push(JSON.parse(raw)) }
  client.attach(fakeAudio)

  // Start then voluntarily pause
  client.startListening()
  assert.equal(client.isListening(), true)
  events.length = 0

  client.stopListening()
  assert.equal(client.isListening(), false)
  assert.deepEqual(listeningStates, [true, false])
  assert.equal(sentFrames.at(-1).value, false)

  // audio.removeAttribute('src') & audio.load() MUST happen BEFORE endOfStream() and revokeObjectURL()
  const removeIdx = events.indexOf('audio.removeAttribute:src')
  const loadIdx = events.indexOf('audio.load')
  const endIdx = events.indexOf('endOfStream')
  const revokeIdx = events.indexOf('revoke:blob:fm-live')
  assert.ok(removeIdx >= 0 && loadIdx > removeIdx, 'audio src must be cleared and loaded')
  assert.ok(loadIdx < endIdx && loadIdx < revokeIdx, 'audio must detach before MediaSource endOfStream and revokeObjectURL')

  // Resuming creates a fresh live stream (new objectUrl) and marks listening true again
  client.startListening()
  assert.equal(client.isListening(), true)
  assert.deepEqual(listeningStates, [true, false, true])
  assert.equal(sentFrames.at(-1).value, true)
})

test('RadioStreamClient.startListening reverts listening state if HTTP audio.play() fails on resume', async () => {
  const listeningStates = []
  const fakeAudio = {
    src: '',
    pause() {},
    removeAttribute() { this.src = '' },
    load() {},
    play() { return Promise.reject(new Error('network down')) },
  }
  const { RadioStreamClient } = loadTs(
    'lib/radioSocketService.ts',
    {
      './apiServers': { RADIO_API_BASE: 'https://juicewrldapi.com/juicewrld' },
      './audioEffects': { resumeEffectsContext: () => {} },
      './userApi': { getToken: () => null },
    },
    {
      window: {},
      localStorage: { getItem: () => 'cid-1', setItem: () => {} },
      WebSocket: { OPEN: 1, CLOSED: 3 },
    },
  )
  const client = new RadioStreamClient({ onListening: (v) => listeningStates.push(v) })
  client.attach(fakeAudio)
  await assert.rejects(() => client.startListening(), /network down/)
  assert.equal(client.isListening(), false)
  assert.deepEqual(listeningStates, [true, false])
})

test('RadioFmPlayer onError preserves radioFmActive when paused or detached', () => {
  const source = fs.readFileSync(path.join(root, 'components', 'RadioFmPlayer.tsx'), 'utf8')
  const onErrorStart = source.indexOf('onError={(e) => {')
  assert.ok(onErrorStart >= 0, 'RadioFmPlayer must pass event to onError')
  const onErrorEnd = source.indexOf('/>', onErrorStart)
  const snippet = source.slice(onErrorStart, onErrorEnd)

  let active = true
  const state = { radioFmActive: true, radioFmPaused: true }
  let isListening = false
  const setRadioFmActive = (v) => { active = v; state.radioFmActive = v }
  const useStore = { getState: () => state }
  const clientRef = { current: { isListening: () => isListening } }

  const fnMatch = snippet.match(/onError=\{(\(e\) => \{[\s\S]*?\})\}/)
  assert.ok(fnMatch)
  const handler = vm.runInNewContext(
    `(${fnMatch[1]})`,
    {
      useStore,
      clientRef,
      setRadioFmActive,
      MediaError: { MEDIA_ERR_ABORTED: 1 },
    },
  )

  // Case 1: Spurious error while voluntarily paused -> stays on 999 FM
  handler({ currentTarget: { error: { code: 4 }, getAttribute: () => 'blob:x', currentSrc: 'blob:x' } })
  assert.equal(active, true)

  // Case 2: Error after src cleared -> stays on 999 FM
  state.radioFmPaused = false
  isListening = true
  handler({ currentTarget: { error: { code: 4 }, getAttribute: () => null, currentSrc: '' } })
  assert.equal(active, true)

  // Case 3: MEDIA_ERR_ABORTED -> stays on 999 FM
  handler({ currentTarget: { error: { code: 1 }, getAttribute: () => 'blob:x', currentSrc: 'blob:x' } })
  assert.equal(active, true)

  // Case 4: Real stream error while actively listening -> turns off FM
  handler({ currentTarget: { error: { code: 2 }, getAttribute: () => 'blob:x', currentSrc: 'blob:x' } })
  assert.equal(active, false)
})

test('LastfmScrobbler stops counting listen time when 999 FM is paused and resumes cleanly', () => {
  const source = fs.readFileSync(path.join(root, 'components', 'LastfmScrobbler.tsx'), 'utf8')
  const updates = []
  const scrobbles = []
  let state = {
    currentTrack: { id: 'jw-1', title: 'Old Song', artist: 'Juice WRLD', duration: 180 },
    isPlaying: false,
    radioFmActive: true,
    radioFmPaused: false,
    radioFmNowPlaying: { title: 'Live FM Track', artist: 'Juice WRLD', album: '999', duration_ms: 120000 },
    lastfmUser: { name: 'tester' },
    lastfmEnabled: true,
    currentTime: 0,
    setLastfmUser: () => {},
  }

  let effects = []
  let cleanups = []
  let intervalCb = null
  const refs = []
  let refCursor = 0

  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText

  const mod = { exports: {} }
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id === 'react') {
        return {
          useEffect: (fn, deps) => effects.push({ fn, deps }),
          useRef: (init) => {
            const idx = refCursor++
            if (!(idx in refs)) refs[idx] = { current: init }
            return refs[idx]
          },
        }
      }
      if (id === '../store/useStore') return { useStore: Object.assign((sel) => sel(state), { getState: () => state }) }
      if (id === 'zustand/react/shallow') return { useShallow: (fn) => fn }
      if (id === '../lib/lastfm') {
        return {
          lastfmConfigured: () => true,
          lastfmUpdateNowPlaying: (info) => { updates.push(info); return Promise.resolve() },
          lastfmEnqueueScrobble: (s) => scrobbles.push(s),
          lastfmFlushQueue: () => Promise.resolve(),
          lastfmQueueSize: () => scrobbles.length,
          setLastfmSessionInvalidHandler: () => {},
        }
      }
      if (id === '../lib/juicewrldApi') return { apiFileIdToRef: () => null }
      return {}
    },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    setInterval: (fn, ms) => { if (ms === 1000) intervalCb = fn; return 1 },
    clearInterval: () => { intervalCb = null },
    Date,
    Math,
  })

  const render = () => {
    refCursor = 0
    effects = []
    mod.exports.default()
  }

  // Initial render: playing on 999 FM
  render()
  // Run listen lifecycle + ticker effects
  effects[1].fn()
  const tickerCleanup = effects[2].fn()
  assert.equal(updates.length, 1)
  assert.equal(updates[0].track, 'Live FM Track')
  assert.ok(intervalCb, 'ticker runs while FM is playing')

  // Simulate 5 seconds listened while playing
  for (let i = 0; i < 5; i++) intervalCb()
  const candidateRef = refs[0]
  assert.equal(candidateRef.current.listened, 5)

  // Pause 999 FM -> playing becomes false, ticker stops
  state = { ...state, radioFmPaused: true }
  tickerCleanup()
  render()
  effects[1].fn()
  const pausedCleanup = effects[2].fn()
  assert.equal(pausedCleanup, undefined, 'ticker must NOT run while 999 FM is paused')
  assert.equal(updates.length, 1, 'no new nowPlaying sent while paused')

  // Server moves to a new song while user is paused -> must NOT start counting new song while paused
  state = { ...state, radioFmNowPlaying: { title: 'Next Live Song', artist: 'Juice WRLD', album: '999', duration_ms: 120000 } }
  render()
  effects[1].fn()
  assert.equal(candidateRef.current, null, 'must not create listen candidate while paused')
  assert.equal(updates.length, 1)

  // User resumes -> joins live track and sends nowPlaying
  state = { ...state, radioFmPaused: false }
  render()
  effects[1].fn()
  effects[2].fn()
  assert.equal(updates.length, 2)
  assert.equal(updates[1].track, 'Next Live Song')
  assert.ok(intervalCb)
})

test('desktopBridge propagates radioFmPaused to widget state and guards FM seek/jump', async () => {
  let state = {
    radioFmActive: true,
    radioFmPaused: false,
    radioFmIsLive: true,
    radioFmNowPlaying: { title: 'Air Track', artist: 'Juice WRLD', album: '999', duration_ms: 100000, elapsed_ms: 10000 },
    radioFmMatchedSong: null,
    currentTrack: { id: 'jw-1', title: 'Old Track', artist: 'Juice WRLD', album: '', duration: 100, path: 'a.mp3' },
    currentTrackFull: null,
    isPlaying: false,
    queue: [{ id: 'jw-1', title: 'Old Track', artist: 'Juice WRLD', album: '', duration: 100, path: 'a.mp3' }],
    queueIndex: 0,
    likedTrackIds: [],
    volume: 0.8,
    repeat: 'none',
    shuffle: false,
    lyricsOffset: 0,
    eqEnabled: false,
    playbackSpeed: 1,
    eqBalance: 0,
    eqMono: false,
    eqBoost: 1,
    skipSilence: false,
    reverbEnabled: false,
    audioFx: {},
    lyricsScale: 1,
    lyricsColorActive: null,
    lyricsColorInactive: null,
    playlists: [],
    playHistory: [],
    songPrefs: {},
    currentTime: 0,
    jumpToTrack: () => { jumped++ },
  }

  let jumped = 0
  let seeked = 0
  let hotkeyRuns = []
  const subscribers = new Set()
  const patches = []

  const bridge = loadTs(
    'lib/desktopBridge.ts',
    {
      '../store/useStore': {
        useStore: {
          getState: () => state,
          subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
        },
      },
      '../desktop/api': { desktopApi: () => null, desktopWindowsSupported: () => false },
      '../desktop/playClock': { watchPlayClock: () => () => {} },
      '../desktop/meter': { listenToMeter: () => () => {} },
      '../desktop/deskViz': { followDeskViz: () => {} },
      '../desktop/artColors': { albumColorsFor: async () => null },
      '../desktop/lyrics/timing': { timedFromLines: () => ({ lines: [] }), pacedFromText: () => ({ lines: [] }) },
      './lyrics': { downloadSyncedLyrics: () => {}, isLrcFormat: () => false, parseLrc: () => [] },
      './hotkeys': { runHotkeyAction: (id) => hotkeyRuns.push(id) },
      '../components/Player': { seekAudio: () => { seeked++ }, getAudioDuration: () => 100 },
      './juicewrldApi': {
        apiFetch: async () => ({ results: [] }),
        apiFileIdToRef: () => null,
        apiFileRefToTrack: () => null,
        buildImageUrl: (u) => u,
        getSongById: async () => null,
        playlistCoverUrl: () => null,
        searchSongs: async () => [],
        sizedCoverUrl: (u) => u,
        smallCoverUrl: (u) => u,
        songToTrack: (s) => s,
      },
      './userApi': { trackIdToSongId: () => 1, isChannelEditor: () => false },
      './playlistItems': { isPrivateEntry: () => false, playlistItemsToTracks: () => [], trackToPlaylistEntry: () => null },
      './eras': { listEras: () => [] },
      './fileTypes': { libraryTrackToTrack: (t) => t },
      './audioEffects': { fxInUse: () => false },
      './songVersions': { loadVersionGroupEntries: async () => ({ self: null, siblings: [] }) },
      './versionPrefs': { memberVersionPrefs: () => ({ preferred: new Set(), excluded: new Set() }), prefLabel: () => null, versionPrefToggles: () => ({}) },
      './appToast': { showAppToast: () => {} },
      './clipboard': { copyText: async () => {} },
      './platform': { trackShareUrl: () => '' },
      './optimisticPlaylist': { addSongsInBackground: async () => [], addTracksInBackground: async () => [] },
      '../hooks/useWrldCore': { toggleRadioFm: () => {} },
      '../components/SongContextMenu': { downloadTrack: () => {}, filesLocation: () => null, openInFiles: () => {} },
      '../desktop/widgetMenu': { widgetMenu: () => ({}) },
      '../store/vizStore': { useVizStore: {
        getState: () => ({ wrldVideoNow: null, wrldVideoPicks: {} }),
        subscribe: () => () => {},
      } },
    },
    {
      window: { dispatchEvent: () => {} },
      queueMicrotask: (fn) => fn(),
      setTimeout,
      clearTimeout,
    },
  )

  const stop = bridge.watchDesktopState((p) => patches.push(p))
  assert.equal(patches[0].playing, true)

  const prev = state
  state = { ...state, radioFmPaused: true }
  for (const fn of subscribers) fn(state, prev)
  assert.equal(patches.at(-1).playing, false)

  await bridge.runDesktopCommand('seek', 0.5)
  await bridge.runDesktopCommand('seek-to', 40)
  assert.equal(seeked, 0, 'seek must be ignored while 999 FM is active')

  // Even if queueIndex is non-zero from a prior session, jump(0) on FM toggles play-pause instead of jumping normal queue
  state = { ...state, queueIndex: 2 }
  await bridge.runDesktopCommand('jump', 0)
  assert.equal(jumped, 0)
  assert.deepEqual(hotkeyRuns, ['play-pause'])

  stop()
})

test('WrldView exposes FM play/pause while keeping previous/next disabled and pausing lyric/progress tickers', () => {
  const wrldSource = fs.readFileSync(path.join(root, 'components', 'WrldView.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(wrldSource.includes('radioFmPaused: s.radioFmPaused'), 'WrldView must subscribe to radioFmPaused')
  assert.ok(wrldSource.includes('playbackActive = radioFmActive ? !radioFmPaused : isPlaying'), 'WrldView must derive playbackActive from radioFmPaused')
  assert.ok(wrldSource.includes('disabled={noTrack || radioFmActive}'), 'Previous/Next must remain disabled during 999 FM')
  assert.ok(wrldSource.includes('if (radioFmPaused) {\n      if (tickRef.current)'), 'FmProgressBar must stop local tick while paused')
  assert.ok(wrldSource.includes('if (!inSight || lyricsPaused) return'), 'LyricsPanel must pause rAF scrolling when 999 FM is paused')
})
