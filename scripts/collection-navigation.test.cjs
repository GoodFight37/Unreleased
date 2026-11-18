const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function render(name, state) {
  const source = fs.readFileSync(path.join(__dirname, `../src/renderer/src/components/${name}.tsx`), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  const jsx = (type, props) => ({ type, props })
  vm.runInNewContext(code, {
    exports, navigator: { userAgent: 'Electron' }, window: {},
    localStorage: { getItem: () => null },
    require: (id) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === 'react') return { useState: (value) => [typeof value === 'function' ? value() : value, () => {}], useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn() }
      if (id.endsWith('/useStore')) return { useStorePick: () => state, useStore: Object.assign((fn) => fn(state), { getState: () => state }) }
      if (id.endsWith('/platform')) return { IS_ELECTRON: true }
      if (id.endsWith('/useSlidingIndicator')) return { useSlidingIndicator: () => ({}) }
      if (id.endsWith('/useLiquidLens')) return { useLiquidLens: () => {} }
      if (id.endsWith('/useNotificationHistory')) return { useUnreadNotificationCount: () => 0 }
      if (id.endsWith('/chatAccess')) return { hasChatAccess: () => false }
      if (id.endsWith('/userApi')) return { showStaffProfile: () => false }
      if (id.endsWith('/lazyView')) return { lazyOverlay: () => () => null }
      if (id.endsWith('/viewLabels')) {
        const labels = {}
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/viewLabels.ts'), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText, { exports: labels })
        return labels
      }
      if (id.endsWith('/navItems')) return {
        NAV_ITEMS: ['home', 'api-tracker', 'library', 'playlists'].map((view) => ({ view })),
        orderedNavControls: () => [], navTabFor: (view) => view, tabEntryView: (view) => view,
      }
      return {}
    },
  })
  const nodes = []
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node?.props) return
    nodes.push(node)
    walk(node.props.children)
  }
  const tree = exports.default()
  walk(tree)
  return { nodes, tree }
}

test('Collection opens playlists and stays highlighted on every collection page', () => {
  const calls = []
  for (const activeView of ['home', 'playlists', 'library', 'liked', 'albums', 'shared-playlist']) {
    const { nodes } = render('Sidebar', { activeView, developerMode: false, sidebarPosition: 'top', downloads: [], setActiveView: (view) => calls.push(view) })
    const collection = nodes.find((node) => node.props['aria-label'] === 'Collection')
    assert.ok(collection)
    assert.equal(collection.props['aria-current'], activeView === 'home' ? undefined : 'page')
    if (activeView === 'home') collection.props.onClick()
  }
  assert.deepEqual(calls, ['playlists'])
})

test('collection subnavigation starts with playlists, keeps local files reachable and hides behind expert navigation', () => {
  const calls = []
  const state = { activeView: 'liked', developerMode: false, setActiveView: (view) => calls.push(view) }
  const buttons = render('CollectionNavigation', state).nodes.filter((node) => node.type === 'button')
  assert.deepEqual(buttons.map((node) => node.props.children[1].props.children), ['Playlists', 'Liked songs', 'Albums', 'On this device'])
  assert.equal(buttons[1].props['aria-current'], 'page')
  buttons[3].props.onClick()
  assert.deepEqual(calls, ['library'])
  assert.equal(render('CollectionNavigation', { ...state, developerMode: true }).tree, null)
})

test('album back stays in Collection while retaining the expert return behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/AlbumsView.tsx'), 'utf8')
  const start = source.indexOf('  const back = (): void => {')
  const back = source.slice(start, source.indexOf('\n  }', start) + 4)
  for (const [album, developerMode, expected] of [[{}, false, null], [null, false, 'playlists'], [null, true, 'home']]) {
    const calls = []
    vm.runInNewContext(ts.transpileModule(`${back}\nback()`, {}).outputText, {
      album, previousView: 'home', useStore: { getState: () => ({ developerMode }) },
      setSelectedId: (value) => calls.push(value), setActiveView: (view) => calls.push(view),
    })
    assert.deepEqual(calls, [expected])
  }
})

test('pickLeadPlaylist prioritises explicit pins, then recent synced playlists, then non-empty playlists', () => {
  const store = new Map()
  const mod = {}
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/recentPlaylists.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: mod,
    require: (id) => {
      if (id.endsWith('/persist')) return {
        ls: {
          get: (k) => store.get(k) ?? null,
          set: (k, v) => store.set(k, v),
          remove: (k) => store.delete(k),
        },
      }
      return {}
    },
  })

  const api = [{ id: 10, name: 'Empty API', track_count: 0 }, { id: 20, name: 'Studio Nights', track_count: 14 }]
  const local = [{ id: 'loc-1', name: 'Road Trip', trackIds: ['a', 'b', 'c'] }]

  // 1. Pinned local playlist wins over everything
  mod.savePinnedPlaylistKey('local:loc-1')
  assert.equal(mod.loadPinnedPlaylistKey(), 'local:loc-1')
  assert.deepEqual({ ...mod.pickLeadPlaylist(api, local, mod.loadPinnedPlaylistKey(), [20]) }, {
    kind: 'local', key: 'local:loc-1', id: 'loc-1', name: 'Road Trip', trackCount: 3, pinned: true,
  })

  // 2. Stale pin falls back to most-recently-opened synced playlist
  mod.savePinnedPlaylistKey('api:999')
  assert.deepEqual({ ...mod.pickLeadPlaylist(api, local, mod.loadPinnedPlaylistKey(), [20]) }, {
    kind: 'api', key: 'api:20', id: 20, name: 'Studio Nights', trackCount: 14, pinned: false,
  })

  // 3. No pin and no recent history falls back to first non-empty playlist
  mod.savePinnedPlaylistKey(null)
  assert.equal(mod.loadPinnedPlaylistKey(), null)
  assert.deepEqual({ ...mod.pickLeadPlaylist(api, local, null, []) }, {
    kind: 'api', key: 'api:20', id: 20, name: 'Studio Nights', trackCount: 14, pinned: false,
  })

  // 4. Empty collections return null without inventing content
  assert.equal(mod.pickLeadPlaylist([], [], null, []), null)
})
