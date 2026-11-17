const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')

test('open-path refuses shortcuts and handlers that launch other programs', () => {
  const start = main.indexOf('const EXECUTABLE_EXTENSIONS = ')
  assert.notEqual(start, -1, 'EXECUTABLE_EXTENSIONS not found in main.js')
  const set = vm.runInNewContext(`${main.slice(start, main.indexOf('])', start) + 2)}; EXECUTABLE_EXTENSIONS`)
  for (const ext of ['.exe', '.lnk', '.url', '.appref-ms', '.scf', '.xll', '.diagcab']) assert.ok(set.has(ext), ext)
  for (const ext of ['.mp3', '.flac', '.png', '.txt']) assert.equal(set.has(ext), false, ext)
})

test('show-item-in-folder ignores non-string paths', () => {
  const start = main.indexOf("ipcMain.handle('show-item-in-folder'")
  assert.notEqual(start, -1)
  const body = main.slice(start, main.indexOf('\n})', start) + 3).replace("ipcMain.handle('show-item-in-folder', ", 'globalThis.handler = ')
  const calls = []
  const context = { shell: { showItemInFolder: (p) => calls.push(p) } }
  vm.runInNewContext(body.replace(/\)$/, ''), context)
  context.handler(null, { evil: true })
  context.handler(null, '   ')
  context.handler(null, 'C:\music\a.mp3')
  assert.deepEqual(calls, ['C:\music\a.mp3'])
})

test('a full disk gives a clear download message and other errors keep theirs', () => {
  const start = main.indexOf('function downloadFailureMessage(')
  assert.notEqual(start, -1, 'downloadFailureMessage not found in main.js')
  const context = {}
  const end = main.indexOf(String.fromCharCode(10) + '}', start) + 2
  vm.runInNewContext(`${main.slice(start, end)}; globalThis.msg = downloadFailureMessage`, context)
  assert.match(context.msg(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })), /not enough free disk space/)
  assert.match(context.msg(Object.assign(new Error('quota'), { code: 'EDQUOT' })), /not enough free disk space/)
  assert.equal(context.msg(new Error('HTTP 404')), 'Download failed: HTTP 404')
  assert.equal(context.msg(null), 'Download failed: null')
})
