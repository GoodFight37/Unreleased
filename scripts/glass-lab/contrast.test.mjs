import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
const linear = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }
const luminance = rgb => rgb.reduce((sum, c, i) => sum + linear(c) * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => { const [hi, lo] = [luminance(a),luminance(b)].sort((x,y)=>y-x); return (hi+.05)/(lo+.05) }
const overWhite = (rgb, alpha) => rgb.map(c => c * alpha + 255 * (1-alpha))
test('laboratory text against bounded shader colors and scene labels meets AA', () => {
  const wgsl = readFileSync('src/renderer/src/lib/glass/glass.wgsl','utf8')
  assert.match(wgsl, /vec3f\(0\.29\)/)
  assert.match(wgsl, /vec3f\(0\.22\)/)
  assert.match(wgsl, /vec3f\(0\.18\)/)
  const cases = [
    { text: [238,238,238], bg: [0.29*255,0.29*255,0.29*255] },
    { text: [16,18,26], bg: [0.78*255,0.78*255,0.78*255] },
    { text: [198,200,225], bg: overWhite([21,25,35],232/255) },
    { text: [163,163,163], bg: [42,42,42] },
  ]
  for (const c of cases) { const ratio=contrast(c.text,c.bg); console.log(`contrast ${ratio.toFixed(2)}:1`); assert.ok(ratio >= 4.5) }
})

test('compositor body text meets AA over worst-case scrolling content', () => {
  const wgsl = readFileSync('src/renderer/src/lib/glass/glass.wgsl', 'utf8')
  const compositor = wgsl.slice(wgsl.indexOf('@fragment fn fsCompositor'))
  const darkCap = Number(compositor.match(/let darkBody = vec3f\(([\d.]+)\)/)?.[1])
  const lightDrop = Number(compositor.match(/let lightBody = vec3f\(1\.\) - vec3f\(([\d.]+)\)/)?.[1])
  const alpha = Number(compositor.match(/let baseAlpha = select\(select\(([\d.]+),/)?.[1])
  for (const value of [darkCap, lightDrop, alpha]) assert.ok(value > 0 && value < 1, 'shader body bounds must be readable')
  const css = readFileSync('src/renderer/src/index.css', 'utf8')
  const textColor = selector => {
    const hex = css.match(new RegExp(`${selector} \\{\\s*--text-muted: #([a-f0-9]{6})`, 'i'))?.[1]
    assert.ok(hex, 'player text color must be readable')
    return hex.match(/../g).map(c => parseInt(c, 16))
  }
  const cases = [
    { text: textColor('\\.dark \\.app-player\\.gpu'), bg: overWhite(Array(3).fill(darkCap * 255), alpha) },
    { text: textColor('\\.app-player\\.gpu'), bg: Array(3).fill((1 - lightDrop) * 255 * alpha) },
  ]
  for (const c of cases) {
    const ratio = contrast(c.text, c.bg)
    console.log(`compositor worst-case contrast ${ratio.toFixed(2)}:1`)
    assert.ok(ratio >= 4.5)
  }
})
