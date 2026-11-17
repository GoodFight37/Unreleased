const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/CoffreHome.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText

function render({ catalogue = [], catalogueState = 'ready', recent = [], currentTrack = null, theme = 'glass-dark', adaptiveColors = false, effects = { reducedMotion: false, gameMode: false } } = {}) {
  const calls = []
  const action = (name) => (...args) => calls.push({ name, args })
  const state = { theme, adaptiveColors, currentTrack, playTrack: action('play'), playNext: action('next'), setActiveView: action('view'), setInfoSongId: action('info'), setApiTrackerCategory: action('category'), setApiTrackerEra: action('era'), setApiTrackerTab: action('tab') }
  const jsx = (type, props) => ({ type, props })
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react') return { useMemo: (fn) => fn(), useState: () => [null, () => {}], useEffect: () => {} }
      if (name.endsWith('/useStore')) return { useStorePick: () => state, useStore: { getState: () => state } }
      if (name.endsWith('/useChannelRoles')) return { useCanEdit: () => false }
      if (name.endsWith('/juicewrldApi')) return { buildImageUrl: (url) => url, songToTrack: (song) => ({ id: `jw-${song.id}`, title: song.name, path: song.path, era: song.era?.name }) }
      if (name.endsWith('/eraLook')) return require('../src/renderer/src/lib/eraLook.ts')
      if (name.endsWith('/apiTrackerShared')) return { saveTrackerSearch: () => {} }
      if (name.endsWith('/eras')) return { eraLabel: (name) => name }
      if (name.endsWith('/userApi')) return { trackIdToSongId: (id) => /^jw-\d+$/.test(id) ? Number(id.slice(3)) : null }
      if (name.endsWith('/skins')) return require('../src/renderer/src/lib/skins.ts')
      if (name.endsWith('/effectsPreference')) return { useEffectsState: () => effects }
      if (name.endsWith('/wrldAtmospheres')) return require('../src/renderer/src/lib/wrldAtmospheres.ts')
      if (name.endsWith('/lazyView')) return { lazyOverlay: () => () => null }
      return {}
    },
  })
  const tree = exports.default({ data: { catalogue, catalogueState, recent, albumRow: [] } })
  const all = []
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node?.props) return
    all.push(node)
    walk(node.props.children)
  }
  walk(tree)
  return { calls, nodes: all, find: (className) => all.filter((node) => node.props.className === className) }
}

const song = (id, category, file, era = 'DRFL') => ({ id, name: `Song ${id}`, category, path: file, era: { name: era }, image_url: `cover-${id}` })

test('Discover shows theme artwork until cover colors are explicitly enabled, including in reduced motion', () => {
  const { SKINS } = require('../src/renderer/src/lib/skins.ts')
  for (const skin of SKINS) {
    const options = { theme: skin.id, catalogue: [song(1, 'unreleased', 'one.mp3')] }
    assert.equal(render(options).find('coffre-stage-backdrop').length, skin.art ? 1 : 0, skin.id)
    for (const effects of [{ reducedMotion: true, gameMode: false }, { reducedMotion: false, gameMode: true }]) {
      const result = render({ ...options, adaptiveColors: true, effects })
      const mesh = result.nodes.find(n => n.props.audioReactive === false)
      assert.equal(mesh.props.artUrl, 'cover-1', skin.id)
      assert.equal(mesh.props.animated, false, skin.id)
    }
  }
})

test('vault discovery includes playable unreleased tracks and sorts eras chronologically', () => {
  const result = render({ catalogue: [song(1, 'unreleased', 'one.mp3'), song(2, 'unreleased', ''), song(3, 'released', 'three.mp3'), song(4, 'recording_session', 'four.mp3'), song(5, 'unreleased', 'five.mp3', 'GB&GR')] })
  const cards = result.find('coffre-cover-card')
  assert.equal(cards.length, 2)
  assert.deepEqual(cards.map((card) => card.props['aria-label']), ['Play Song 1', 'Play Song 5'])
  assert.equal(result.find('coffre-era').length, 2)
  result.find('coffre-era')[0].props.onClick()
  assert.deepEqual(result.calls.map((call) => [call.name, ...call.args]), [['category', 'unreleased'], ['era', 'GB&GR'], ['tab', 'songs'], ['view', 'api-tracker']])
})

test('history drops unplayable metadata and the hero does not create a queue missing its current track', () => {
  const track = { id: 'local-one', title: 'One', path: 'one.mp3' }
  const hero = { id: 'local-two', title: 'Two', path: 'two.mp3' }
  const result = render({ recent: [track, { id: 'missing', title: 'Metadata only', path: '' }], currentTrack: hero })
  assert.equal(result.find('coffre-cover-card').length, 1)
  result.find('coffre-hero-art')[0].props.onClick()
  assert.equal(result.calls[0].name, 'play')
  assert.equal(result.calls[0].args.length, 1)
  assert.equal(result.calls[0].args[0], hero)
})

test('an empty vault still opens the complete catalogue without pretending a track can play', () => {
  const result = render()
  assert.equal(result.find('coffre-cover-card').length, 0)
  assert.equal(result.find('coffre-hero-art')[0].props['aria-label'], 'Explore the catalogue')
  result.find('coffre-primary')[0].props.onClick()
  assert.equal(result.calls.at(-1).name, 'view')
  assert.equal(result.calls.at(-1).args[0], 'api-tracker')
  assert.equal(result.calls.some((call) => call.name === 'play'), false)
})

test('the discovery collection shortcut opens playlists without a detour through device folders', () => {
  const result = render()
  const link = result.nodes.find((node) => node.type === 'button' && node.props.children?.[0] === 'Your collection ')
  assert.ok(link)
  link.props.onClick()
  assert.deepEqual(result.calls, [{ name: 'view', args: ['playlists'] }])
})

test('the feature follows the selected song and shows a single human line from its catalogue metadata', () => {
  const catalogue = [
    { ...song(1, 'unreleased', 'a.mp3'), producers: 'Producer A', additional_information: 'A documented session.' },
    { ...song(2, 'released', 'b.mp3'), producers: 'Producer B', additional_information: "Vocals from this Track were used for 'The Way'." },
  ]
  const result = render({ catalogue, currentTrack: { id: 'jw-2', title: 'Song 2', path: 'b.mp3' } })
  const note = result.find('coffre-track-note')[0].props.children
  assert.equal(note, "Vocals from this Track were used for 'The Way'.")
  assert.ok(!note.includes('Producer A'))
  assert.ok(!note.includes('A documented session.'))
  const details = result.nodes.find((node) => node.type === 'button' && node.props.children?.[0] === 'Full song details ')
  details.props.onClick()
  assert.deepEqual(result.calls, [{ name: 'info', args: [2] }])
})

test('local and missing catalogue tracks do not invent trivia or show unrelated song credits', () => {
  const result = render({ catalogue: [{ ...song(1, 'unreleased', 'a.mp3'), producers: 'Unrelated' }], currentTrack: { id: 'local-one', title: 'Local', path: 'local.mp3' } })
  assert.equal(result.nodes.some((node) => node.props.children === 'Unrelated'), false)
  assert.equal(result.nodes.some((node) => node.props.children?.[0] === 'Full song details '), false)
  assert.equal(result.find('coffre-track-note').length, 0)
})

test('missing notes stay absent even with recording dates and producers', () => {
  for (const value of [undefined, null, '', '  ', 'null']) {
    const result = render({ catalogue: [{ ...song(1, 'unreleased', 'a.mp3'), additional_information: value, notes: value, producers: 'Producer', record_dates: 'Recorded June 17, 2018' }], currentTrack: { id: 'jw-1', title: 'One', path: 'a.mp3' } })
    assert.equal(result.find('coffre-track-note').length, 0)
  }
})

test('loading and failed catalogues have explicit feedback and a safe catalogue action', () => {
  for (const [catalogueState, role, text] of [['loading', 'status', 'Loading the catalogue…'], ['error', 'alert', 'The catalogue could not be loaded. Open Catalogue to try again.']]) {
    const result = render({ catalogueState })
    assert.ok(result.nodes.some((node) => node.props.role === role && node.props.children === text))
    const open = result.nodes.find((node) => node.type === 'button' && node.props.children?.[0] === 'Open catalogue ')
    open.props.onClick()
    assert.equal(result.calls.at(-1).args[0], 'api-tracker')
  }
})
