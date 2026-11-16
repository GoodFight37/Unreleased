const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function harness(initial = null) {
  const storage = new Map(initial ? [['unreleased.effects-mode', initial]] : [])
  const media = (matches) => ({ matches, listeners: new Set(), addEventListener(_, fn) { this.listeners.add(fn) }, change(value) { this.matches = value; this.listeners.forEach(fn => fn()) } })
  const motion = media(true), transparency = media(true), listeners = new Map()
  const window = { matchMedia: q => q.includes('motion') ? motion : transparency, addEventListener: (type, cb) => listeners.set(type, cb) }
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val) }
  const document = { documentElement: { dataset: {} } }
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/effectsPreference.ts'), 'utf8')
  const compiled = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  Function('require', 'module', 'exports', 'window', 'document', 'localStorage', compiled)(require, module, module.exports, window, document, localStorage)
  return { api: module.exports, motion, transparency, document, storage, listeners }
}

test('effects default on despite system reduction, follow system live and persist reduced', () => {
  const h = harness()
  assert.equal(h.api.getEffectsMode(), 'on')
  assert.equal(h.api.isReducedMotion(), false)
  assert.equal(h.api.isReducedTransparency(), false)
  assert.equal(h.document.documentElement.dataset.effectsMotion, 'full')
  const media = h.api.effectsMotionMedia(); let changes = 0; const changed = () => changes++
  media.addEventListener('change', changed)
  h.api.setEffectsMode('system')
  assert.equal(h.api.isReducedMotion(), true)
  assert.equal(h.api.isReducedTransparency(), true)
  h.motion.change(false); assert.equal(media.matches, false)
  h.transparency.change(false); assert.equal(h.document.documentElement.dataset.effectsTransparency, 'full')
  h.api.setEffectsMode('reduced')
  assert.equal(h.api.isReducedMotion(), true)
  assert.equal(h.api.isReducedTransparency(), true)
  assert.equal(h.storage.get('unreleased.effects-mode'), 'reduced')
  assert.equal(harness('reduced').api.isReducedMotion(), true)
  assert.ok(changes >= 4)
  media.removeEventListener('change', changed)
})

test('other window storage events update preferences', () => {
  const h = harness(); h.storage.set('unreleased.effects-mode', 'system')
  h.listeners.get('storage')({ key: 'unreleased.effects-mode' })
  assert.equal(h.api.getEffectsMode(), 'system')
  assert.equal(h.document.documentElement.dataset.effectsMotion, 'reduce')
})
