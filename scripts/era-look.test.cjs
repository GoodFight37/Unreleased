// Chronological era order for the Tracker's era row (src/renderer/src/lib/eraLook.ts).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { eraStart, ERA_LOOK } = require('../src/renderer/src/lib/eraLook.ts')

test('reads the start of free-text time frames', () => {
  assert.equal(eraStart('January 2014 - January 30th 2016'), 20140100)
  assert.equal(eraStart('February 17th 2017- April 12th 2017'), 20170217)
  assert.equal(eraStart('July 10th 2020'), 20200710)
  assert.equal(eraStart('2018'), 20180000)
  assert.equal(eraStart('October 2018 – March 2019'), 20181000)
  assert.equal(eraStart(''), Infinity)
  assert.equal(eraStart(undefined), Infinity)
})

test('the real eras sort in release order', () => {
  const eras = [
    ['POST', 'December 8th 2019 - Present'],
    ['jute', 'January 2014 - January 30th 2016'],
    ['DRFL', 'October 19th 2018 - March 8th 2019'],
    ['afflictions', 'February 16th 2017 - April 12th 2017'],
    ['GB&GR', 'December 22nd 2017 - May 23rd 2018'],
  ]
  const sorted = [...eras].sort((a, b) => eraStart(a[1]) - eraStart(b[1])).map((e) => e[0])
  assert.deepEqual(sorted, ['jute', 'afflictions', 'GB&GR', 'DRFL', 'POST'])
})

test('every era look has an /assets/ image and a hex accent', () => {
  for (const [name, look] of Object.entries(ERA_LOOK)) {
    assert.match(look.art, /^\/assets\/[\w-]+\.webp$/, name)
    assert.match(look.accent, /^#[0-9a-f]{6}$/, name)
  }
})
