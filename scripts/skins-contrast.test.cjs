// Every built-in theme (Dark, Light, 999 and the album themes) keeps its text
// and accent readable: WCAG AA >= 4.5:1 (text on background, raised and overlay
// surfaces; accent on background and raised).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const src = readFileSync(join(__dirname, '../src/renderer/src/lib/skins.ts'), 'utf8')
const list = src.slice(src.indexOf('export const SKINS: Skin[] = ['), src.indexOf('\n]\n', src.indexOf('export const SKINS')))
const skins = list.split(/\n  \{\n/).slice(1).map((block) => {
  const pick = (re) => block.match(re)?.[1]
  const v = (k) => pick(new RegExp(`'${k}': '(#[0-9a-fA-F]{6})'`))
  return {
    id: pick(/id: '([^']+)'/),
    accent: pick(/accent: '(#[0-9a-fA-F]{6})'/),
    surfaces: ['--surface', '--surface-raised', '--surface-overlay'].map(v),
    texts: ['--text-primary', '--text-secondary', '--text-muted'].map(v),
  }
})

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('only Dark, Light, 999 and the four album themes remain', () => {
  assert.deepEqual(skins.map((s) => s.id).sort(), ['999', 'drfl', 'fd', 'gbgr', 'glass-dark', 'glass-light', 'lnd'])
})

for (const skin of skins) {
  test(`${skin.id}: text and accent reach WCAG AA on every surface`, () => {
    // Text on all three surfaces; the accent (active tabs, links) on the background and raised rows.
    skin.surfaces.forEach((bg, i) => {
      assert.ok(bg, `${skin.id} surface missing`)
      for (const fg of [...skin.texts, i < 2 ? skin.accent : null].filter(Boolean)) {
        const r = ratio(fg, bg)
        assert.ok(r >= 4.5, `${skin.id}: ${fg} on ${bg} is ${r.toFixed(2)}:1`)
      }
    })
  })
}
