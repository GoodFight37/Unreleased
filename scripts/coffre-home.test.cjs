const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/CoffreHome.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText

function render({ catalogue = [], recent = [], currentTrack = null } = {}) {
  const calls = []
  const action = (name) => (...args) => calls.push({ name, args })
  const state = { currentTrack, playTrack: action('play'), playNext: action('next'), setActiveView: action('view'), setApiTrackerCategory: action('category'), setApiTrackerEra: action('era'), setApiTrackerTab: action('tab') }
  const jsx = (type, props) => ({ type, props })
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react') return { useMemo: (fn) => fn(), useState: () => [null, () => {}] }
      if (name.endsWith('/useStore')) return { useStorePick: () => state, useStore: { getState: () => state } }
      if (name.endsWith('/useChannelRoles')) return { useCanEdit: () => false }
      if (name.endsWith('/juicewrldApi')) return { buildImageUrl: (url) => url, songToTrack: (song) => ({ id: `api-${song.id}`, title: song.name, path: song.path, era: song.era?.name }) }
      if (name.endsWith('/eraLook')) return { ERA_LOOK: {} }
      if (name.endsWith('/apiTrackerShared')) return { saveTrackerSearch: () => {} }
      if (name.endsWith('/eras')) return { eraLabel: (name) => name }
      if (name.endsWith('/lazyView')) return { lazyOverlay: () => () => null }
      return {}
    },
  })
  const tree = exports.default({ data: { catalogue, recent, albumRow: [] } })
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
