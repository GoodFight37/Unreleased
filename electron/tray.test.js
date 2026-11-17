const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
const start = source.indexOf('function buildTrayMenu()')
const buildMenu = source.slice(start, source.indexOf('// The tray\'s Desktop menu:', start))

test('radio keeps play/pause in the tray and disables track-only actions', () => {
  for (const radioFmActive of [true, false]) {
    const ctx = vm.createContext({
      trayPlayback: { hasTrack: true, isPlaying: false, title: 'Song', artist: 'Artist', liked: false, radioFmActive },
      Menu: { buildFromTemplate: (items) => items }, desktopTrayItems: () => [],
    })
    const items = vm.runInContext(`${buildMenu}\nbuildTrayMenu()`, ctx)
    assert.equal(items.find((item) => item.label === 'Play').enabled, true)
    for (const label of ['Next track', 'Previous track', 'Like song']) {
      assert.equal(items.find((item) => item.label === label).enabled, !radioFmActive)
    }
  }
})
