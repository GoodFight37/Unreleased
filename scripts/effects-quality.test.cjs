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
