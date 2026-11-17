const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SKINS, backdropArt } = require('../src/renderer/src/lib/skins.ts')

test('every theme restores its own background with cover colors off and follows the song only when enabled', () => {
  for (const skin of SKINS) {
    assert.equal(backdropArt(skin.id, false, 'playing-cover.png'), skin.art ?? null, skin.id)
    assert.equal(backdropArt(skin.id, true, 'playing-cover.png'), 'playing-cover.png', skin.id)
    assert.equal(backdropArt(skin.id, true, null), skin.art ?? null, skin.id)
  }
})
