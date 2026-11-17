const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')

const source = readFileSync(join(__dirname, '../src/renderer/public/startup-theme.js'), 'utf8')
function boot(values = {}, blocked = false) {
  const vars = new Map()
  const classes = new Set()
  const root = {
    style: { setProperty: (key, value) => vars.set(key, value) },
    classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key) },
  }
  vm.runInNewContext(source, {
    document: { documentElement: root },
    localStorage: { getItem: (key) => { if (blocked) throw Error('blocked'); return values[key] ?? null } },
  })
  return { vars, dark: classes.has('dark'), background: root.style.backgroundColor }
}

test('startup paints the saved album palette before any renderer modules run', () => {
  const saved = { id: 'lnd', dark: true, vars: { '--surface': '#170d13', '--text-primary': '#fff' } }
  const result = boot({ 'unreleased:theme': '"lnd"', 'unreleased:startupTheme': JSON.stringify(saved) })
  assert.equal(result.vars.get('--surface'), '#170d13')
  assert.equal(result.vars.get('--text-primary'), '#fff')
  assert.equal(result.dark, true)
  assert.equal(result.background, 'var(--surface)')
})

test('first launches and mismatched caches honor light and dark preferences', () => {
  for (const id of ['glass-light', 'gbgr']) {
    const result = boot({ 'unreleased:theme': JSON.stringify(id), 'unreleased:startupTheme': '{"id":"lnd","dark":true,"vars":{"--surface":"#170d13"}}' })
    assert.equal(result.dark, false)
    assert.equal(result.vars.get('--surface'), '#ffffff')
  }
  assert.equal(boot().dark, true)
  assert.equal(boot({ 'unreleased:theme': '"glass-dark"' }).vars.get('--surface'), '#000000')
})

test('malformed or blocked storage cannot prevent a dark startup', () => {
  assert.equal(boot({}, true).dark, true)
  assert.equal(boot({ 'unreleased:theme': '{' }).vars.get('--surface'), '#000000')
  assert.equal(boot({ 'unreleased:theme': '"glass-light"', 'unreleased:startupTheme': '{' }).vars.get('--surface'), '#ffffff')
  const result = boot({ 'unreleased:theme': '"glass-light"', 'unreleased:startupTheme': '{"id":"glass-light","dark":false,"vars":{"color":"red","--surface":99}}' })
  assert.equal(result.vars.has('color'), false)
  assert.equal(result.vars.get('--surface'), '#ffffff')
})

test('retired and custom light preferences use the same fallback as the skin registry', () => {
  const registry = readFileSync(join(__dirname, '../src/renderer/src/lib/skins.ts'), 'utf8')
  const ids = [...registry.match(/RETIRED_LIGHT_SKINS = new Set\(\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  for (const id of ids) assert.equal(boot({ 'unreleased:theme': JSON.stringify(id) }).dark, false, id)
  const custom = [{ id: 'custom-light', dark: false, vars: { '--surface': '#fff' } }]
  const result = boot({ 'unreleased:theme': '"custom-light"', 'unreleased:customSkins': JSON.stringify(custom), 'unreleased:startupTheme': '{"id":"glass-light","dark":false,"vars":{"--surface":"#eeeeee"}}' })
  assert.equal(result.dark, false)
  assert.equal(result.vars.get('--surface'), '#eeeeee')
})
