const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  WRLD_BACKDROPS,
  WRLD_CURATED_LYRICS,
  WRLD_FAN_LYRICS,
  ERA_TIME_FRAMES,
  normalizeWrldBackdrop,
  resolveEraAtmosphere,
  resolveWrldEra,
} = require('../src/renderer/src/lib/wrldAtmospheres.ts')
const { eraStart } = require('../src/renderer/src/lib/eraLook.ts')

test('curated WRLD lists stay focused and exclude legacy visualizer walls', () => {
  assert.deepEqual(WRLD_BACKDROPS.map((b) => b.id), ['mesh', 'glass', 'off'])
  assert.equal(WRLD_CURATED_LYRICS.length, 5)
  assert.equal(WRLD_CURATED_LYRICS[0].id, 'classic')
  assert.deepEqual(WRLD_FAN_LYRICS.map((l) => l.id), ['classic', 'cinema', 'fisheye', 'cut'])
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

test('assigns distinct era atmosphere behaviors and enables butterflies only on LND', () => {
  const ep999 = resolveEraAtmosphere('999 EP')
  const gbgr = resolveEraAtmosphere('GB&GR')
  const drfl = resolveEraAtmosphere('DRFL')
  const lnd = resolveEraAtmosphere('LND')
  const tpne = resolveEraAtmosphere('TPNE')

  assert.equal(ep999.id, '999')
  assert.ok(ep999.grain > gbgr.grain)
  assert.ok(gbgr.calmness > drfl.calmness)
  assert.ok(drfl.energyPush > gbgr.energyPush)
  assert.equal(lnd.butterflies, true)
  assert.equal(tpne.butterflies, false)
  assert.equal(drfl.butterflies, false)
  assert.equal(gbgr.butterflies, false)
  assert.equal(ep999.butterflies, false)
  assert.ok(eraStart(ERA_TIME_FRAMES['GB&GR']) < eraStart(ERA_TIME_FRAMES['DRFL']))
  assert.ok(eraStart(ERA_TIME_FRAMES['DRFL']) < eraStart(ERA_TIME_FRAMES['LND']))
})
