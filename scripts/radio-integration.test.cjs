const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '../src/renderer/src')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
function load(file, mocks, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, { exports, require: (id) => mocks[id] ?? {}, ...globals })
  return exports
}

test('desktop radio clock freezes on pause and resumes from current live metadata without counting the pause', () => {
  let now = 0
  let state = { radioFmActive: true, radioFmPaused: false, radioFmNowPlaying: { elapsed_ms: 10000 } }
  const listeners = new Set()
  const timers = new Map()
  const store = { getState: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) } }
  const change = (patch) => { const old = state; state = { ...state, ...patch }; for (const fn of listeners) fn(state, old) }
  const clock = load('desktop/playClock.ts', {
    '../store/useStore': { useStore: store },
    '../components/Player': { getAudioCurrentTime: () => 0 },
    './lyrics/scene': { epochNow: () => now / 1000 },
  }, {
    Date: { now: () => now },
    window: { setInterval: (fn) => { timers.set(1, fn); return 1 }, clearInterval: (id) => timers.delete(id) },
  })
  const updates = []
  const stop = clock.watchPlayClock((value) => updates.push(value))
  assert.equal(updates.at(-1).running, true)
  now = 2000
  assert.equal(clock.radioFmSeconds(), 12)
  change({ radioFmPaused: true })
  assert.equal(updates.at(-1).running, false)
  assert.equal(updates.at(-1).seconds, 12)
  now = 12000
  assert.equal(clock.radioFmSeconds(), 12)
  change({ radioFmNowPlaying: { elapsed_ms: 25000 } })
  assert.equal(clock.radioFmSeconds(), 25)
  assert.equal(updates.at(-1).running, false)
  change({ radioFmPaused: false })
  assert.equal(updates.at(-1).running, true)
  now = 13000
  assert.equal(clock.radioFmSeconds(), 26)
  change({ radioFmActive: false })
  now = 23000
  change({ radioFmActive: true })
  assert.equal(clock.radioFmSeconds(), 25)
  stop()
  assert.equal(timers.size, 0)
})

test('Discord clears paused FM presence and sends the current live track again on resume', () => {
  let state = { currentTrack: null, isPlaying: false, radioFmActive: true, radioFmPaused: false, radioFmNowPlaying: { title: 'First', artist: 'Juice WRLD', elapsed_ms: 1000 } }
  const sent = []
  let clears = 0
  let cursor = 0
  const refs = []
  const effects = []
  const component = load('components/DiscordRpcSync.tsx', {
    'react': {
      useEffect: (fn) => effects.push(fn), useState: (value) => [value, () => {}],
      useRef: (value) => { const index = cursor++; return refs[index] ?? (refs[index] = { current: value }) },
    },
    'zustand/react/shallow': { useShallow: (fn) => fn },
    '../store/useStore': { useStore: Object.assign((fn) => fn(state), { getState: () => state }) },
    '../lib/juicewrldApi': { discordCoverUrl: () => null, PLAYER_SITE: 'https://player.example' },
    '../lib/eras': { eraFullName: () => null, loadEraFullNames: () => Promise.resolve() },
  }, {
    Date, window: { electron: { discordRpcSetActivity: (value) => sent.push(value), discordRpcClearActivity: () => clears++ } },
  }).default
  const render = () => { cursor = 0; effects.length = 0; component(); effects.forEach((fn) => fn()) }
  render()
  assert.equal(sent.length, 1)
  state = { ...state, radioFmPaused: true }
  render()
  assert.equal(clears, 1)
  state = { ...state, radioFmNowPlaying: { title: 'Second', artist: 'Juice WRLD', elapsed_ms: 2000 } }
  render()
  assert.equal(sent.length, 1)
  state = { ...state, radioFmPaused: false }
  render()
  assert.equal(sent.length, 2)
  assert.equal(sent[1].title, 'Second')
})

test('terminal transport supports FM without a queued track and rejects live skips and seeks', async () => {
  const state = { radioFmActive: true, radioFmPaused: true, isPlaying: false, currentTrack: null, queue: [] }
  const commands = []
  const logs = []
  const fail = (message) => { throw new Error(message) }
  const store = { getState: () => state, setState: (patch) => Object.assign(state, patch) }
  const player = load('lib/terminal/player.ts', {
    '../../store/useStore': { useStore: store },
    '../types': {},
    './types': { fail },
    '../hotkeys': { runHotkeyAction: () => assert.fail('transport must not use the hotkey permission registry') },
    '../windowSync': { runPlayerCommand: (command) => {
      commands.push(command)
      if (command === 'play') state.radioFmPaused = false
      if (command === 'pause') state.radioFmPaused = true
      if (command === 'play-pause') state.radioFmPaused = !state.radioFmPaused
    } },
  })
  const run = (name, args = '') => player.PLAYER_COMMANDS.find((command) => command.name === name).run(args, { print: (message) => logs.push(message) })
  await run('play')
  assert.equal(state.radioFmPaused, false)
  run('pause')
  assert.equal(state.radioFmPaused, true)
  run('toggle')
  assert.equal(state.radioFmPaused, false)
  assert.equal(logs.at(-1), '▶ playing')
  for (const name of ['next', 'prev', 'seek']) assert.throws(() => run(name, '+10'), /999 FM is live/)
  run('stop')
  assert.equal(commands.at(-1), 'pause')
  assert.equal(state.radioFmActive, false)
  assert.equal(state.radioFmPaused, false)
  await assert.rejects(() => run('play'), /nothing is playing/)
})

test('expert menu offers FM play/pause without a previous song and disables track-only controls', () => {
  const source = read('components/AppMenu.tsx')
  const start = source.indexOf('entries: [', source.indexOf("id: 'controls'")) + 'entries: ['.length
  const end = source.indexOf("        { kind: 'submenu', label: 'Volume & speed'", start)
  const fragment = source.slice(start, end)
  for (const radioFmPaused of [true, false]) {
    const entries = vm.runInNewContext(`[${fragment}]`, {
      radioFmActive: true, radioFmPaused, isPlaying: false, currentTrack: null, shuffle: false, repeat: 'none', hk: () => () => {},
    })
    assert.equal(entries[0].label, radioFmPaused ? 'Play' : 'Pause')
    assert.equal(entries[0].disabled, false)
    for (const index of [1, 2, 5, 6]) assert.equal(entries[index].disabled, true)
    for (const entry of entries[3].entries) assert.equal(entry.disabled, true)
  }
})

test('actual Player tray payload declares FM so the main process can disable track actions', () => {
  const source = read('components/Player.tsx')
  const start = source.indexOf('el.setTrayPlayback({')
  const fragment = source.slice(start, source.indexOf('\n    })', start) + '\n    })'.length)
  let payload
  vm.runInNewContext(fragment, {
    el: { setTrayPlayback: (value) => { payload = value } },
    currentTrack: null, radioFmActive: true, playbackActive: false, title: 'Radio', artist: 'Juice WRLD', likedTrackIds: [],
  })
  assert.equal(payload.radioFmActive, true)
  assert.equal(payload.hasTrack, true)
  assert.equal(payload.isPlaying, false)
  assert.equal(payload.liked, false)
})
