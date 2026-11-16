const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.join(__dirname, 'main.js'), 'utf8')
const start = source.indexOf("ipcMain.handle('get-app-settings'")
const handlers = source.slice(start, source.indexOf('// ── IPC: beta channel', start))

function boot({ platform = 'win32', packaged = true, initial = false, throws = false, ignores = false } = {}) {
  const callbacks = new Map()
  const writes = []
  let enabled = initial
  let saves = 0
  const appSettings = { startWithWindows: false, startupView: 'home' }
  vm.runInNewContext(handlers, {
    ipcMain: { handle: (key, callback) => callbacks.set(key, callback) },
    process: { platform }, appSettings,
    app: {
      isPackaged: packaged,
      getLoginItemSettings: () => ({ openAtLogin: enabled }),
      setLoginItemSettings: (options) => {
        writes.push(options)
        if (throws) throw new Error('Windows refused')
        if (!ignores) enabled = options.openAtLogin
      },
    },
    saveSettings: () => { saves++ },
    autoUpdater: {}, discordRpc: {}, updateMainWindowTitle: () => {},
  })
  return {
    read: () => callbacks.get('get-app-settings')(),
    set: (value) => callbacks.get('set-app-setting')(null, 'startWithWindows', value),
    writes, appSettings, saves: () => saves,
  }
}

test('startup reads Windows state and saves a confirmed change without modifying the startup page', () => {
  const run = boot({ initial: true })
  assert.equal(run.read().startupAvailable, true)
  assert.equal(run.read().startWithWindows, true)
  assert.equal(run.set(false), true)
  assert.equal(run.read().startWithWindows, false)
  assert.equal(run.appSettings.startWithWindows, false)
  assert.equal(run.appSettings.startupView, 'home')
  assert.equal(run.saves(), 1)
  assert.equal(run.set(true), true)
  assert.equal(run.writes[1].openAtLogin, true)
  assert.equal(run.saves(), 2)
})

test('startup cannot register a development executable, unsupported platform or non-boolean input', () => {
  for (const options of [{ packaged: false }, { platform: 'linux' }, { platform: 'darwin' }]) {
    const run = boot(options)
    assert.equal(run.read().startupAvailable, false)
    assert.equal(run.set(true), false)
    assert.equal(run.writes.length, 0)
    assert.equal(run.saves(), 0)
  }
  const run = boot()
  for (const value of ['true', 1, null, {}, []]) assert.equal(run.set(value), false)
  assert.equal(run.writes.length, 0)
})

test('Windows failure or an unconfirmed change leaves persisted startup preferences intact', () => {
  for (const options of [{ throws: true }, { ignores: true }]) {
    const run = boot(options)
    assert.equal(run.set(true), false)
    assert.equal(run.appSettings.startWithWindows, false)
    assert.equal(run.saves(), 0)
  }
})
