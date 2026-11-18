const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  getEffectsQuality,
  setEffectsQuality,
  isGameEffectsMode,
  liveVisualsAllowed,
  setEffectsMode,
} = require('../src/renderer/src/lib/effectsPreference.ts')

test('effectsQuality switches cleanly between full and game without altering accessibility axes', () => {
  setEffectsMode('on')
  setEffectsQuality('full')
  assert.equal(getEffectsQuality(), 'full')
  assert.equal(isGameEffectsMode(), false)
  assert.equal(liveVisualsAllowed(), true)

  setEffectsQuality('game')
  assert.equal(getEffectsQuality(), 'game')
  assert.equal(isGameEffectsMode(), true)
  assert.equal(liveVisualsAllowed(), false)

  setEffectsQuality('full')
  assert.equal(liveVisualsAllowed(), true)
})

test('quick ambience picker offers the 5 Juice WRLD themes, Cover colors switch, and Settings shortcut', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/AmbiencePicker.tsx'), 'utf8')
  const code = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const calls = []
  const state = {
    theme: 'drfl',
    adaptiveColors: false,
    setAdaptiveColors: (v) => calls.push(['adaptive', v]),
    setTheme: (v) => calls.push(['theme', v]),
    openSettings: (tab) => calls.push(['settings', tab]),
  }
  const jsx = (type, props) => ({ type, props })
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    document: { body: {} },
    require: (id) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
      if (id === 'react-dom') return { createPortal: (el) => el }
      if (id === 'react') return {
        useState: (init) => [init === false ? true : init === null ? { left: 0, bottom: 0 } : init, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useRef: (v) => ({ current: v }),
      }
      if (id.endsWith('/useStore')) return { useStore: (fn) => fn(state) }
      if (id.endsWith('/skins')) return require('../src/renderer/src/lib/skins.ts')
      if (id.endsWith('/juicewrldApi')) return { buildImageUrl: (u) => u }
      return {}
    },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(exports.JUICE_THEME_IDS)), ['999', 'gbgr', 'drfl', 'lnd', 'fd'])
  const tree = exports.default()
  const nodes = []
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n?.props) return
    nodes.push(n)
    walk(n.props.children)
  }
  walk(tree)
  const sw = nodes.find((n) => n.props?.role === 'switch')
  sw.props.onClick()
  const gbgrBtn = nodes.find((n) => n.props?.className === 'coffre-tp-tile' && n.props['aria-pressed'] === false)
  gbgrBtn.props.onClick()
  const allBtn = nodes.find((n) => n.type === 'button' && n.props.children === 'All themes in Settings →')
  allBtn.props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['adaptive', true], ['theme', '999'], ['settings', 'appearance']])
})
