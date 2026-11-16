const assert = require('node:assert/strict')
const test = require('node:test')
const { pathToFileURL } = require('url')
const { resolveTypedPath } = require('./localPaths')

const win = { platform: 'win32', home: 'C:\\Users\\me', from: 'D:\\Music\\Juice', env: { USERPROFILE: 'C:\\Users\\me', OneDrive: 'C:\\Users\\me\\OneDrive' } }
const posix = { platform: 'linux', home: '/home/me', from: '/mnt/music', env: { HOME: '/home/me', XDG_MUSIC_DIR: '/home/me/Music' } }

test('takes an absolute Windows path as pasted, slashes either way', () => {
  assert.equal(resolveTypedPath('C:\\Users\\me\\Music', win), 'C:\\Users\\me\\Music')
  assert.equal(resolveTypedPath('C:/Users/me/Music/', win), 'C:\\Users\\me\\Music')
  assert.equal(resolveTypedPath('\\\\nas\\share\\Leaks', win), '\\\\nas\\share\\Leaks')
})

test('drops the quotes "Copy as path" adds', () => {
  assert.equal(resolveTypedPath('  "C:\\Users\\me\\My Music"  ', win), 'C:\\Users\\me\\My Music')
  assert.equal(resolveTypedPath("'/home/me/My Music'", posix), '/home/me/My Music')
})

test('a bare drive letter means its root', () => {
  assert.equal(resolveTypedPath('d:', win), 'd:\\')
})

test('expands ~ and environment variables', () => {
  assert.equal(resolveTypedPath('~', win), 'C:\\Users\\me')
  assert.equal(resolveTypedPath('~\\Downloads', win), 'C:\\Users\\me\\Downloads')
  assert.equal(resolveTypedPath('%userprofile%\\Music', win), 'C:\\Users\\me\\Music')
  assert.equal(resolveTypedPath('%OneDrive%\\Leaks', win), 'C:\\Users\\me\\OneDrive\\Leaks')
  assert.equal(resolveTypedPath('~/Music', posix), '/home/me/Music')
  assert.equal(resolveTypedPath('$XDG_MUSIC_DIR/jute', posix), '/home/me/Music/jute')
  assert.equal(resolveTypedPath('${HOME}/x', posix), '/home/me/x')
})

test('leaves unset variables as typed', () => {
  assert.equal(resolveTypedPath('C:\\%NOPE%\\x', win), 'C:\\%NOPE%\\x')
  assert.equal(resolveTypedPath('/srv/$NOPE', posix), '/srv/$NOPE')
})

test('resolves relative paths against the open folder, home when none', () => {
  assert.equal(resolveTypedPath('..\\Covers', win), 'D:\\Music\\Covers')
  assert.equal(resolveTypedPath('2018', win), 'D:\\Music\\Juice\\2018')
  assert.equal(resolveTypedPath('\\Temp', win), 'D:\\Temp')
  assert.equal(resolveTypedPath('Music', { ...posix, from: '' }), '/home/me/Music')
})

test('blank input resolves to nothing', () => {
  assert.equal(resolveTypedPath('   ', win), '')
  assert.equal(resolveTypedPath('""', win), '')
})

test('reads file:// URLs for this platform', () => {
  const here = process.platform === 'win32' ? 'C:\\Users\\me\\Music' : '/home/me/Music'
  const ctx = process.platform === 'win32' ? win : posix
  assert.equal(resolveTypedPath(pathToFileURL(here).href, ctx), here)
})

test('copyFileToClipboard passes Windows paths (including curly apostrophe \u2019) via env instead of string interpolation', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const vm = require('node:vm')
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const start = main.indexOf('async function copyFileToClipboard(filePath)')
  const end = main.indexOf('ipcMain.handle(\'copy-file-to-clipboard\'', start)
  assert.ok(start >= 0 && end > start)
  const calls = []
  const ctx = {
    process: { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } },
    fs: { existsSync: () => true },
    winPowerShellPath: () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    require: (id) => {
      assert.equal(id, 'child_process')
      return {
        execFile: (cmd, args, opts, cb) => {
          calls.push({ cmd, args, opts })
          cb(null)
        },
      }
    },
  }
  vm.runInNewContext(`${main.slice(start, end)}\nglobalThis.copy = copyFileToClipboard`, ctx)
  const trickyPath = 'C:\\Music\\Don\u2019t\'; Start-Process calc; \'.mp3'
  const res = await ctx.copy(trickyPath)
  assert.equal(res.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(calls[0].args.at(-1), 'Set-Clipboard -LiteralPath $env:UNRELEASED_CLIP_PATH')
  assert.ok(!calls[0].args.some((a) => a.includes('Don\u2019t') || a.includes('calc')))
  assert.equal(calls[0].opts.env.UNRELEASED_CLIP_PATH, trickyPath)
})
