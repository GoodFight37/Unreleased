const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { configureForkProfile } = require('./forkProfile')

function fixture(t, locked = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-profile-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'unreleased')
  const target = path.join(root, 'unreleased-glass')
  fs.mkdirSync(path.join(source, 'Local Storage', 'leveldb'), { recursive: true })
  fs.writeFileSync(path.join(source, 'app-settings.json'), '{"rememberWindowSizes":true}')
  fs.writeFileSync(path.join(source, 'Local Storage', 'leveldb', 'CURRENT'), 'preferences fixture')
  fs.writeFileSync(path.join(source, 'Local Storage', 'leveldb', 'LOCK'), '')
  let current = source
  const app = {
    getPath: (name) => name === 'appData' ? root : current,
    setPath: (name, value) => { assert.ok(['userData', 'sessionData'].includes(name)); assert.equal(value, target); current = value },
    requestSingleInstanceLock: () => { assert.equal(current, target); return !locked },
  }
  return { source, target, app }
}

test('fork imports preferences and native data without modifying the old profile or overwriting its own data', (t) => {
  const { app, source, target } = fixture(t)
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'app-settings.json'), '{"ownSetting":true}')
  assert.equal(configureForkProfile(app), true)
  assert.equal(fs.readFileSync(path.join(target, 'app-settings.json'), 'utf8'), '{"ownSetting":true}')
  assert.equal(fs.readFileSync(path.join(source, 'app-settings.json'), 'utf8'), '{"rememberWindowSizes":true}')
  assert.equal(fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', 'CURRENT'), 'utf8'), 'preferences fixture')
  assert.equal(fs.readFileSync(path.join(source, 'Local Storage', 'leveldb', 'CURRENT'), 'utf8'), 'preferences fixture')
  assert.ok(fs.existsSync(path.join(target, '.profile-import-v2')))
  fs.writeFileSync(path.join(target, 'Local Storage', 'leveldb', 'CURRENT'), 'own preferences')
  assert.equal(configureForkProfile(app), true)
  assert.equal(fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', 'CURRENT'), 'utf8'), 'own preferences')
})

test('an already running fork acquires no migration files', (t) => {
  const { app, target } = fixture(t, true)
  assert.equal(configureForkProfile(app), false)
  assert.deepEqual(fs.readdirSync(target), [])
})

function offlineFixture(t) {
  const run = fixture(t)
  const audioDir = path.join(path.dirname(run.source), 'original-downloads')
  const coverDir = path.join(run.source, 'offline-covers')
  fs.mkdirSync(audioDir)
  fs.mkdirSync(coverDir)
  const audio = path.join(audioDir, 'jw-42.flac')
  const cover = path.join(coverDir, 'jw-42.jpg')
  fs.writeFileSync(audio, 'original audio')
  fs.writeFileSync(cover, 'original cover')
  fs.writeFileSync(path.join(run.source, 'app-settings.json'), JSON.stringify({ offlineLibraryPath: audioDir, volume: 0.7 }))
  fs.writeFileSync(path.join(run.source, 'offline-library.json'), JSON.stringify({
    tracks: { 'jw-42': { localPath: audio, localImagePath: cover, title: 'Track' } }, playlists: { collection: ['jw-42'] },
  }))
  return { ...run, audio, cover }
}

test('imported offline media can be overwritten and removed without touching original-player files', (t) => {
  const { app, source, target, audio, cover } = offlineFixture(t)
  const originalIndex = fs.readFileSync(path.join(source, 'offline-library.json'), 'utf8')
  configureForkProfile(app)
  const settings = JSON.parse(fs.readFileSync(path.join(target, 'app-settings.json'), 'utf8'))
  assert.equal(settings.offlineLibraryPath, path.join(target, 'offline-audio'))
  assert.equal(settings.volume, 0.7)
  const imported = JSON.parse(fs.readFileSync(path.join(target, 'offline-library.json'), 'utf8'))
  const track = imported.tracks['jw-42']
  assert.equal(fs.readFileSync(track.localPath, 'utf8'), 'original audio')
  assert.equal(fs.readFileSync(track.localImagePath, 'utf8'), 'original cover')
  assert.notEqual(track.localPath, audio)
  assert.notEqual(track.localImagePath, cover)
  fs.writeFileSync(track.localPath, 'fork audio')
  fs.writeFileSync(track.localImagePath, 'fork cover')
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const start = main.indexOf('function deleteOfflineTrackFiles(')
  const deletion = main.slice(start, main.indexOf('\n}', start) + 2)
  vm.runInNewContext(`${deletion}\ndeleteOfflineTrackFiles(entry)`, { fs, entry: track })
  assert.equal(fs.existsSync(track.localPath), false)
  assert.equal(fs.existsSync(track.localImagePath), false)
  assert.equal(fs.readFileSync(audio, 'utf8'), 'original audio')
  assert.equal(fs.readFileSync(cover, 'utf8'), 'original cover')
  assert.equal(fs.readFileSync(path.join(source, 'offline-library.json'), 'utf8'), originalIndex)
  assert.deepEqual(imported.playlists.collection, ['jw-42'])
})

test('a failed offline copy publishes no index and can be retried from the intact original', (t) => {
  const { app, source, target, audio } = offlineFixture(t)
  const copy = fs.copyFileSync
  fs.copyFileSync = (src, ...args) => {
    if (src === audio) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    return copy(src, ...args)
  }
  try { assert.throws(() => configureForkProfile(app), /disk full/) }
  finally { fs.copyFileSync = copy }
  assert.deepEqual(fs.readdirSync(target), [])
  const retryApp = { ...app, getPath: (name) => name === 'appData' ? path.dirname(target) : source }
  configureForkProfile(retryApp)
  const imported = JSON.parse(fs.readFileSync(path.join(target, 'offline-library.json'), 'utf8'))
  assert.equal(fs.readFileSync(imported.tracks['jw-42'].localPath, 'utf8'), 'original audio')
  assert.equal(fs.readFileSync(audio, 'utf8'), 'original audio')
})

test('missing offline originals are remapped too, so reappearing files cannot become shared', (t) => {
  const { app, target, audio } = offlineFixture(t)
  fs.unlinkSync(audio)
  configureForkProfile(app)
  const imported = JSON.parse(fs.readFileSync(path.join(target, 'offline-library.json'), 'utf8'))
  assert.notEqual(imported.tracks['jw-42'].localPath, audio)
  assert.equal(fs.existsSync(imported.tracks['jw-42'].localPath), false)
})

test('busy legacy storage fails closed, cleans staging, and can retry without losing preferences', { skip: process.platform !== 'win32' }, (t) => {
  const { app, source, target } = fixture(t)
  const handle = fs.openSync(path.join(source, 'Local Storage', 'leveldb', 'LOCK'), 'r+')
  try { assert.throws(() => configureForkProfile(app), /Close Unreleased/) }
  finally { fs.closeSync(handle) }
  assert.deepEqual(fs.readdirSync(target), [])
  const retryApp = { ...app, getPath: (name) => name === 'appData' ? path.dirname(target) : source }
  assert.equal(configureForkProfile(retryApp), true)
  assert.equal(fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', 'CURRENT'), 'utf8'), 'preferences fixture')
})

test('compiled and packaged launches isolate before locking; UI verification keeps its temporary profile', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const block = main.slice(main.indexOf('const isSmokeTest ='), main.indexOf('// Must run before ready:'))
  const cases = [
    { args: ['--load-dist'], packaged: false, isolated: true },
    { args: [], packaged: true, isolated: true },
    { args: [], packaged: false, isolated: false },
    { args: ['--smoke-test'], packaged: false, isolated: false },
    { args: ['--ui-verify', '--load-dist'], packaged: false, isolated: false },
  ]
  for (const { args, packaged, isolated } of cases) {
    const calls = []
    vm.runInNewContext(block, {
      process: { argv: args, env: { UNRELEASED_UI_VERIFY_DIR: 'temporary-profile' } }, path,
      app: { isPackaged: packaged, setPath: (...values) => calls.push(values) },
      configureForkProfile: () => { calls.push('isolate'); return true },
    })
    assert.equal(calls.includes('isolate'), isolated)
    if (args.includes('--ui-verify')) assert.equal(calls[0][1], 'temporary-profile')
  }
})
