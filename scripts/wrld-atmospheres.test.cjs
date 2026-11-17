const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  WRLD_BACKDROPS,
  WRLD_CURATED_LYRICS,
  normalizeWrldBackdrop,
  resolveWrldEra,
} = require('../src/renderer/src/lib/wrldAtmospheres.ts')

test('curated WRLD lists stay focused and exclude legacy visualizer walls', () => {
  assert.deepEqual(WRLD_BACKDROPS.map((b) => b.id), ['mesh', 'glass', 'off'])
  assert.equal(WRLD_CURATED_LYRICS.length, 4)
  assert.equal(WRLD_CURATED_LYRICS[0].id, 'classic')
})

test('normalizes persisted backdrop ids cleanly to modern modes', () => {
  assert.equal(normalizeWrldBackdrop('mesh'), 'mesh')
  assert.equal(normalizeWrldBackdrop('glass'), 'glass')
  assert.equal(normalizeWrldBackdrop('off'), 'off')
  assert.equal(normalizeWrldBackdrop('auto'), 'mesh')
  assert.equal(normalizeWrldBackdrop('nebula'), 'mesh')
  assert.equal(normalizeWrldBackdrop(null), 'mesh')
})

test('resolves Juice WRLD era labels and baked asset keys accurately', () => {
  const lnd = resolveWrldEra(null, 'Legends Never Die')
  assert.equal(lnd.eraLabel, 'LEGENDS NEVER DIE')
  assert.equal(lnd.eraAsset, '/assets/lnd.jpg')

  const drfl = resolveWrldEra('https://juicewrldapi.com/assets/drfl.png', null)
  assert.equal(drfl.eraLabel, 'DEATH RACE FOR LOVE')
  assert.equal(drfl.eraAsset, '/assets/drfl.png')

  const gbgr = resolveWrldEra(null, 'Goodbye & Good Riddance')
  assert.equal(gbgr.eraLabel, 'GOODBYE & GOOD RIDDANCE')
  assert.equal(gbgr.eraAsset, '/assets/gbgr.jpg')
})
