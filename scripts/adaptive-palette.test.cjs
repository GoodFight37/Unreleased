const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

function loadAdaptivePalette() {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/src/lib/adaptivePalette.ts'), 'utf8')
  const compiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id === './coverImage') return { fetchImageBlob: async () => { throw new Error('stub') } }
      if (id === './eraPalettes') return { ERA_PALETTES: {} }
      if (id === './juicewrldApi') return { JWAPI_HOST: 'juicewrldapi.com', smallCoverUrl: (u) => u }
      throw new Error(`Unexpected require: ${id}`)
    },
  }
  vm.runInNewContext(compiled, sandbox)
  return mod.exports
}

const ap = loadAdaptivePalette()

function makeFixturePixels(stops, side = 40) {
  const buf = new Uint8ClampedArray(side * side * 4)
  const total = side * side
  for (let i = 0; i < total; i++) {
    const frac = i / total
    let chosen = stops[stops.length - 1].rgb
    let acc = 0
    for (const st of stops) {
      acc += st.share
      if (frac <= acc) { chosen = st.rgb; break }
    }
    const o = i * 4
    buf[o] = chosen[0]
    buf[o + 1] = chosen[1]
    buf[o + 2] = chosen[2]
    buf[o + 3] = 255
  }
  return buf
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

test('amllToneMapRgb preserves hue and dynamic floor/ceiling without brown mud', () => {
  const [r, g, b] = ap.amllToneMapRgb(242 / 255, 177 / 255, 60 / 255) // The Way gold
  const goldLuma = 0.30 * r + 0.59 * g + 0.11 * b
  assert.ok(r > g && g > b, 'gold channel order must stay warm yellow-gold')
  assert.ok(goldLuma >= 0.14 && goldLuma <= 0.86, `expected compressed luma in [0.14, 0.86], got ${goldLuma}`)

  const [wr, wg, wb] = ap.amllToneMapRgb(1, 1, 1)
  assert.ok(Math.abs(wr - 0.86) < 0.01 && Math.abs(wg - 0.86) < 0.01 && Math.abs(wb - 0.86) < 0.01)

  const [dr, dg, db] = ap.amllToneMapRgb(12 / 255, 10 / 255, 14 / 255)
  const darkLuma = 0.30 * dr + 0.59 * dg + 0.11 * db
  assert.ok(darkLuma >= 0.13 && darkLuma <= 0.22, `expected dark floor ~0.14, got ${darkLuma}`)
})

test('extractCoverPaletteFromPixels extracts separated swatches and WCAG AA accents across 4 cover fixtures', () => {
  const darkBg = [28, 28, 30]
  const lightBg = [242, 242, 247]

  // 1. The Way: gold sky + royal blue butterflies
  const theWay = makeFixturePixels([
    { share: 0.60, rgb: [242, 177, 60] },
    { share: 0.40, rgb: [45, 96, 242] },
  ])
  const pWayDark = ap.extractCoverPaletteFromPixels(theWay, false)
  const pWayLight = ap.extractCoverPaletteFromPixels(theWay, true)
  assert.ok(pWayDark && pWayLight)
  assert.ok(hueDist(pWayDark.dominant.hue, pWayDark.complementary.hue) >= 60, 'dominant and complementary must separate >= 60 deg')
  assert.ok(ap.contrastRatio(ap.hexToRgb(pWayDark.accent), darkBg) >= 4.5, 'The Way dark accent AA')
  assert.ok(ap.contrastRatio(ap.hexToRgb(pWayLight.accent), lightBg) >= 4.5, 'The Way light accent AA')

  // 2. GB&GR: paper white + blue car -> light cover detected (> 0.62 luma)
  const gbgr = makeFixturePixels([
    { share: 0.84, rgb: [248, 247, 242] },
    { share: 0.16, rgb: [27, 100, 180] },
  ])
  const pGbgr = ap.extractCoverPaletteFromPixels(gbgr, true)
  assert.ok(pGbgr)
  assert.equal(pGbgr.isLight, true)
  assert.ok(pGbgr.luma > 0.62, `expected GB&GR luma > 0.62, got ${pGbgr.luma}`)
  assert.ok(ap.contrastRatio(ap.hexToRgb(pGbgr.accent), lightBg) >= 4.5, 'GBGR light accent AA')

  // 3. DRFL: dark espresso + fiery orange-red
  const drfl = makeFixturePixels([
    { share: 0.70, rgb: [24, 14, 12] },
    { share: 0.30, rgb: [212, 72, 42] },
  ])
  const pDrfl = ap.extractCoverPaletteFromPixels(drfl, false)
  assert.ok(pDrfl)
  assert.equal(pDrfl.isLight, false)
  assert.ok(ap.contrastRatio(ap.hexToRgb(pDrfl.accent), darkBg) >= 4.5, 'DRFL dark accent AA')

  // 4. LND: plum dusk + coral pink
  const lnd = makeFixturePixels([
    { share: 0.55, rgb: [128, 40, 110] },
    { share: 0.45, rgb: [245, 93, 119] },
  ])
  const pLnd = ap.extractCoverPaletteFromPixels(lnd, false)
  assert.ok(pLnd)
  assert.equal(pLnd.isLight, false)
  assert.ok(ap.contrastRatio(ap.hexToRgb(pLnd.accent), darkBg) >= 4.5, 'LND dark accent AA')
})

test('greyscale covers return null palette while still reporting tone-mapped luma', () => {
  const bw = makeFixturePixels([
    { share: 0.5, rgb: [30, 30, 30] },
    { share: 0.5, rgb: [235, 235, 235] },
  ])
  assert.equal(ap.extractCoverPaletteFromPixels(bw, false), null)
  const luma = ap.measurePixelsToneLuma(bw)
  assert.ok(luma !== null && luma > 0.4 && luma < 0.6)
})

test('cover samplers route through fetchImageBlob/fetchCoverBitmap without crossOrigin canvas tainting, and WGSL Params stays 160B', () => {
  const files = [
    'src/renderer/src/components/LiquidMeshBackdrop.tsx',
    'src/renderer/src/hooks/useWrldCore.ts',
    'src/renderer/src/desktop/artColors.ts',
    'src/renderer/src/lib/viz/palette.ts',
    'src/renderer/src/lib/glass/compositor.ts',
  ]
  for (const rel of files) {
    const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    assert.doesNotMatch(txt, /crossOrigin\s*=\s*['"]anonymous['"]/, `${rel} must use fetchCoverBitmap/fetchImageBlob instead of Image.crossOrigin`)
  }

  const wrld = fs.readFileSync(path.join(ROOT, 'src/renderer/src/components/WrldView.tsx'), 'utf8')
  assert.doesNotMatch(wrld, /dark:from-black\/40\s+dark:via-transparent\s+dark:to-black\/70/, 'WrldView must not re-apply the full-screen dark double veil')

  const wgsl = fs.readFileSync(path.join(ROOT, 'src/renderer/src/lib/glass/glass.wgsl'), 'utf8')
  assert.match(wgsl, /tint2:\s*vec4f[\s\S]*tint3:\s*vec4f/)
  const engine = fs.readFileSync(path.join(ROOT, 'src/renderer/src/lib/glass/engine.ts'), 'utf8')
  assert.match(engine, /createBuffer\(\{\s*size:\s*160\b/)
})

test('WRLD light-cover threshold (>0.74), 40/60 desktop split, and all lyric styles invert ink cleanly under lightBg', () => {
  const gbgr = makeFixturePixels([
    { share: 0.84, rgb: [248, 247, 242] },
    { share: 0.16, rgb: [27, 100, 180] },
  ])
  const lndBright = makeFixturePixels([
    { share: 0.55, rgb: [245, 93, 119] },
    { share: 0.45, rgb: [188, 66, 134] },
  ])
  assert.ok(ap.measurePixelsToneLuma(gbgr) > 0.74, 'GB&GR near-paper cover should exceed 0.74')
  assert.ok(ap.measurePixelsToneLuma(lndBright) <= 0.74, 'vivid LND cover must stay below 0.74 light-cover cutoff')

  const wrldCore = fs.readFileSync(path.join(ROOT, 'src/renderer/src/hooks/useWrldCore.ts'), 'utf8')
  assert.match(wrldCore, /luma > 0\.74/)

  const wrld = fs.readFileSync(path.join(ROOT, 'src/renderer/src/components/WrldView.tsx'), 'utf8')
  assert.match(wrld, /showLyricsColumn \? '40%' : '100%'/)
  assert.match(wrld, /lightBg=\{textIsDark\}/)
  assert.match(wrld, /lightBg=\{isLightLyrics\}/)

  const stageView = fs.readFileSync(path.join(ROOT, 'src/renderer/src/components/LyricStageView.tsx'), 'utf8')
  assert.match(stageView, /lightBg:\s*Boolean\(lightBg\)/)

  const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/src/desktop/lyrics/scene.ts'), 'utf8')
  assert.match(sceneSrc, /this\.host\.classList\.toggle\('is-light',\s*this\.isLightBg\)/)
  assert.match(sceneSrc, /color:\s*this\.warmInk/)
  assert.match(sceneSrc, /if \(this\.frozen\) \{ el\.remove\(\); return \}/)
  assert.match(sceneSrc, /if \(this\.shown == null \|\| this\.frozen\) \{ this\.rebuild\(\); return \}/)

  const stylesSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/src/desktop/lyrics/styles.ts'), 'utf8')
  assert.doesNotMatch(stylesSrc, /'#fff'/)
  assert.doesNotMatch(stylesSrc, /'rgb\(250,242,230\)'/)
  assert.doesNotMatch(stylesSrc, /'rgb\(245,245,245\)'/)
  assert.doesNotMatch(stylesSrc, /'rgba\(255,255,255,0\.6\)'/)
  assert.doesNotMatch(stylesSrc, /'rgba\(255,255,255,0\.09\)'/)

  const wbSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/src/desktop/lyrics/wordblock.ts'), 'utf8')
  assert.match(wbSrc, /lightBg !== this\.lightBg/)
  assert.match(wbSrc, /function paletteOf\(colors: AlbumColors \| null, lightBg = false\)/)
})

test('compositor, engine, AmbientBackdrop, Player, and WrldView avoid unbounded per-frame memory and style thrash', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'src/renderer/src/lib/glass/engine.ts'), 'utf8')
  assert.match(engine, /targetViews\s*=\s*targets\.map/)
  assert.match(engine, /inFlight\s*>=\s*3/)
  assert.match(engine, /overlayCleared/)

  const comp = fs.readFileSync(path.join(ROOT, 'src/renderer/src/lib/glass/compositor.ts'), 'utf8')
  assert.doesNotMatch(comp, /setProperty\('--beat-1'/)
  assert.match(comp, /cachedSliderRects/)
  assert.match(comp, /cachedModalVisible/)

  const amb = fs.readFileSync(path.join(ROOT, 'src/renderer/src/components/AmbientBackdrop.tsx'), 'utf8')
  assert.doesNotMatch(amb, /setProperty\('--ambient-beat'/)

  const wrld = fs.readFileSync(path.join(ROOT, 'src/renderer/src/components/WrldView.tsx'), 'utf8')
  assert.doesNotMatch(wrld, /setProperty\('--wrld-beat-track'/)
  assert.doesNotMatch(wrld, /setProperty\('--wrld-beat-shadow'/)
})
