const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  WRLD_ATMOSPHERES,
  WRLD_CURATED_LYRICS,
  resolveWrldAtmosphere,
} = require('../src/renderer/src/lib/wrldAtmospheres.ts')

test('curated WRLD lists stay focused and non-bloated', () => {
  assert.equal(WRLD_ATMOSPHERES.length, 6)
  assert.equal(WRLD_CURATED_LYRICS.length, 4)
  assert.equal(WRLD_CURATED_LYRICS[0].id, 'classic')
})

test('999 Era Auto matches album and asset era atmospheres when animations are on', () => {
  const lnd = resolveWrldAtmosphere({
    atmosphere: 'auto',
    animationsOn: true,
    glSupported: true,
    album: 'Legends Never Die',
  })
  assert.equal(lnd.vizMode, 'nebula')
  assert.equal(lnd.eraLabel, 'LEGENDS NEVER DIE')
  assert.ok(lnd.auraRgb)

  const drfl = resolveWrldAtmosphere({
    atmosphere: 'auto',
    animationsOn: true,
    glSupported: true,
    artUrl: 'https://juicewrldapi.com/assets/drfl.png',
  })
  assert.equal(drfl.vizMode, 'embers')
  assert.equal(drfl.eraLabel, 'DEATH RACE FOR LOVE')

  const gbgr = resolveWrldAtmosphere({
    atmosphere: 'auto',
    animationsOn: true,
    glSupported: true,
    album: 'Goodbye & Good Riddance',
  })
  assert.equal(gbgr.vizMode, 'rain')
  assert.equal(gbgr.eraLabel, 'GOODBYE & GOOD RIDDANCE')
})

test('falls back to 2D aurora without WebGL and shuts off completely when calm/off', () => {
  const noGl = resolveWrldAtmosphere({
    atmosphere: 'lnd',
    animationsOn: true,
    glSupported: false,
  })
  assert.equal(noGl.vizMode, 'aurora')

  const calm = resolveWrldAtmosphere({
    atmosphere: 'auto',
    animationsOn: false,
    glSupported: true,
    album: 'Legends Never Die',
  })
  assert.equal(calm.vizMode, 'none')
  assert.equal(calm.eraLabel, 'LEGENDS NEVER DIE')

  const off = resolveWrldAtmosphere({
    atmosphere: 'off',
    animationsOn: true,
    glSupported: true,
  })
  assert.equal(off.vizMode, 'none')
})
