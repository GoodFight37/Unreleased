const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/CoffreHome.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText

function render({ catalogue = [], catalogueState = 'ready', recent = [], currentTrack = null } = {}) {
  const calls = []
  const action = (name) => (...args) => calls.push({ name, args })
  const state = { currentTrack, playTrack: action('play'), playNext: action('next'), setActiveView: action('view'), setInfoSongId: action('info'), setApiTrackerCategory: action('category'), setApiTrackerEra: action('era'), setApiTrackerTab: action('tab') }
  const jsx = (type, props) => ({ type, props })
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react') return { useMemo: (fn) => fn(), useState: () => [null, () => {}] }
      if (name.endsWith('/useStore')) return { useStorePick: () => state, useStore: { getState: () => state } }
      if (name.endsWith('/useChannelRoles')) return { useCanEdit: () => false }
      if (name.endsWith('/juicewrldApi')) return { buildImageUrl: (url) => url, songToTrack: (song) => ({ id: `jw-${song.id}`, title: song.name, path: song.path, era: song.era?.name }) }
      if (name.endsWith('/eraLook')) return { ERA_LOOK: {} }
      if (name.endsWith('/apiTrackerShared')) return { saveTrackerSearch: () => {} }
      if (name.endsWith('/eras')) return { eraLabel: (name) => name }
      if (name.endsWith('/userApi')) return { trackIdToSongId: (id) => /^jw-\d+$/.test(id) ? Number(id.slice(3)) : null }
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

test('vault discovery includes playable unreleased tracks and counts only those tracks per era', () => {
  const result = render({ catalogue: [song(1, 'unreleased', 'one.mp3'), song(2, 'unreleased', ''), song(3, 'released', 'three.mp3'), song(4, 'recording_session', 'four.mp3'), song(5, 'unreleased', 'five.mp3', 'GB&GR')] })
  const cards = result.find('coffre-cover-card')
  assert.equal(cards.length, 2)
  assert.deepEqual(cards.map((card) => card.props['aria-label']), ['Play Song 1', 'Play Song 5'])
  assert.equal(result.find('coffre-era').length, 2)
  result.find('coffre-era')[1].props.onClick()
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

test('the feature follows the selected song and shows only its catalogue credits and notes', () => {
  const catalogue = [
    { ...song(1, 'unreleased', 'a.mp3'), producers: 'Producer A', additional_information: 'A documented session.' },
    { ...song(2, 'released', 'b.mp3'), producers: 'Producer B', record_dates: 'File Exported\nJune 24, 2021.' },
  ]
  const result = render({ catalogue, currentTrack: { id: 'jw-2', title: 'Song 2', path: 'b.mp3' } })
  const text = result.nodes.flatMap((node) => Array.isArray(node.props.children) ? node.props.children.filter((v) => typeof v === 'string') : [node.props.children]).filter((v) => typeof v === 'string')
  assert.ok(text.includes('Producer B'))
  assert.ok(text.includes('File Exported\nJune 24, 2021.'))
  assert.ok(!text.includes('Producer A'))
  assert.ok(!text.includes('A documented session.'))
  const details = result.nodes.find((node) => node.type === 'button' && node.props.children?.[0] === 'Full song details ')
  details.props.onClick()
  assert.deepEqual(result.calls, [{ name: 'info', args: [2] }])
})

test('local and missing catalogue tracks do not invent trivia or show unrelated song credits', () => {
  const result = render({ catalogue: [{ ...song(1, 'unreleased', 'a.mp3'), producers: 'Unrelated' }], currentTrack: { id: 'local-one', title: 'Local', path: 'local.mp3' } })
  assert.equal(result.nodes.some((node) => node.props.children === 'Unrelated'), false)
  assert.equal(result.nodes.some((node) => node.props.children?.[0] === 'Full song details '), false)
  assert.equal(result.find('coffre-track-note')[0].props.children, 'Choose a catalogue track to explore its story and credits.')
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
