const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function mount(effects = {}, gpu = true) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/hooks/useLiquidLens.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const attrs = new Set()
  let built = 0, removed = 0, cleanup, onClass
  const node = {
    offsetWidth: 400, offsetHeight: 80,
    setAttribute: key => attrs.add(key), removeAttribute: key => attrs.delete(key),
    style: { setProperty() {}, removeProperty() {} },
  }
  const exports = {}
  vm.runInNewContext(code, {
    exports, document: { documentElement: { classList: { contains: () => gpu } } },
    getComputedStyle: () => ({ borderTopLeftRadius: '20px' }),
    clearTimeout() {}, window: { setTimeout: fn => { fn(); return 1 } },
    ResizeObserver: class { constructor(fn) { this.fn = fn } observe() { this.fn() } disconnect() {} },
    MutationObserver: class { constructor(fn) { onClass = fn } observe() {} disconnect() {} },
    require: id => {
      if (id === 'react') return { useEffect: fn => { cleanup = fn() } }
      if (id.endsWith('/effectsPreference')) return { useEffectsState: () => effects }
      if (id.endsWith('/useStore')) return { useStore: fn => fn({ glassRefraction: true }) }
      if (id.endsWith('/liquidLens')) return { LENS_SUPPORTED: true, setLens: () => built++, removeLens: () => removed++ }
      throw new Error(id)
    },
  })
  exports.useLiquidLens({ current: node }, 'test-lens', { bezel: 20, strength: 1, coreBlur: 12, rimBlur: 2 })
  return { attrs, counts: () => ({ built, removed }), gpu: value => { gpu = value; onClass?.() }, cleanup: () => cleanup?.() }
}

test('SVG refraction takes over only when GPU glass stops and releases the lens when GPU returns', () => {
  const lens = mount()
  assert.equal(lens.counts().built, 0)
  assert.equal(lens.attrs.has('data-lens'), false)
  lens.gpu(false)
  assert.equal(lens.counts().built, 1)
  assert.equal(lens.attrs.has('data-lens'), true)
  lens.gpu(true)
  assert.equal(lens.attrs.has('data-lens'), false)
  lens.cleanup()
  assert.ok(lens.counts().removed >= 2)
})

test('Game mode, reduced motion and reduced transparency never build a fallback lens', () => {
  for (const flag of ['gameMode', 'reducedMotion', 'reducedTransparency']) {
    const lens = mount({ [flag]: true }, false)
    assert.equal(lens.counts().built, 0, flag)
    assert.equal(lens.attrs.size, 0, flag)
    lens.cleanup()
  }
})
