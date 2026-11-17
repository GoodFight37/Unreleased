const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('node:vm')
const { Readable } = require('node:stream')
const { createHash } = require('node:crypto')

// main.js can't be required outside Electron, so read the pinned table as text.
// Every entry was once a character or two short, which failed every ffmpeg
// download with "Checksum mismatch" (and with it ALAC playback).
test('pinned ffmpeg checksums are full SHA-256 digests', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const table = /const FFMPEG_SHA256 = \{([\s\S]*?)\}/.exec(src)
  assert.ok(table, 'FFMPEG_SHA256 table not found')
  const entries = [...table[1].matchAll(/'([\w-]+)':\s*'([^']*)'/g)]
  assert.ok(entries.length >= 5)
  for (const [, key, hash] of entries) {
    assert.match(hash, /^[0-9a-f]{64}$/, `${key} checksum is not 64 hex characters`)
  }
})

function downloader({ platform = 'win32', tag = '2026.10.26', checksumStatus = 200, checksumMissing = false, mismatch = false, releaseStatus = 200 } = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const specs = source.slice(source.indexOf('const FFMPEG_SHA256 ='), source.indexOf('function toolsDir()'))
  const start = source.indexOf('const toolDownloadsInFlight =')
  const downloads = source.slice(start, source.indexOf('// { ffmpeg: bool, ytdlp: bool }', start))
  const ipcStart = source.indexOf("ipcMain.handle('tools-download'")
  const ipc = source.slice(ipcStart, source.indexOf('// Target format', ipcStart))
  const binary = Buffer.from('new verified tool fixture')
  const old = Buffer.from('previous verified tool fixture')
  const name = platform === 'win32' ? 'yt-dlp.exe' : platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
  const dest = path.join('tools-fixture', platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  const files = new Map([[dest, old]])
  const requests = []
  const assetDownloads = []
  const digest = createHash('sha256').update(binary).digest('hex')
  const handlers = new Map()
  const context = vm.createContext({
    require, path, AbortSignal, process: { platform, arch: 'x64' },
    toolsDir: () => 'tools-fixture',
    resolveYtDlpPath: () => files.has(dest) ? dest : null,
    resolveFfmpegPath: () => null,
    ipcMain: { handle: (id, fn) => handlers.set(id, fn) },
    fs: {
      mkdirSync: () => {}, chmodSync: () => {},
      createReadStream: (file) => Readable.from([files.get(file)]),
      unlinkSync: (file) => files.delete(file),
      renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from) },
    },
    fetch: async (url) => {
      requests.push(url)
      if (url === 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest') {
        return { ok: releaseStatus === 200, status: releaseStatus, json: async () => ({ tag_name: tag }) }
      }
      assert.equal(url, `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/SHA2-256SUMS`)
      return { ok: checksumStatus === 200, text: async () => `${'f'.repeat(64)}  other-${name}\n${checksumMissing ? '' : `${mismatch ? '0'.repeat(64) : digest} *${name}\n`}` }
    },
    downloadAnyUrl: async (url, file) => { assetDownloads.push(url); files.set(file, binary) },
  })
  vm.runInContext(`${specs}\n${downloads}\n${ipc}\nglobalThis.run = downloadTool`, context)
  return { run: context.run, files, dest, old, binary, requests, assetDownloads, handlers, name }
}

test('yt-dlp resolves latest once and fetches its checksum and binary from the same tagged release', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const d = downloader({ platform })
    const first = d.run('ytdlp', () => {})
    assert.strictEqual(d.run('ytdlp', () => {}), first)
    await first
    assert.deepEqual(d.requests, [
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
      'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/SHA2-256SUMS',
    ])
    assert.deepEqual(d.assetDownloads, [`https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/${d.name}`])
    assert.deepEqual(d.files.get(d.dest), d.binary)
  }
})

test('an invalid or unavailable yt-dlp tag stops before requesting release assets', async () => {
  for (const options of [{ tag: 'latest' }, { tag: '../other' }, { tag: null }, { releaseStatus: 503 }]) {
    const d = downloader(options)
    await assert.rejects(d.run('ytdlp', () => {}), /Invalid yt-dlp release tag|Could not resolve yt-dlp release/)
    assert.equal(d.requests.length, 1)
    assert.equal(d.assetDownloads.length, 0)
    assert.deepEqual(d.files.get(d.dest), d.old)
  }
})

test('yt-dlp refuses missing or mismatched checksums and preserves the installed executable', async () => {
  for (const options of [{ checksumMissing: true }, { checksumStatus: 404 }, { mismatch: true }]) {
    const d = downloader(options)
    await assert.rejects(d.run('ytdlp', () => {}), /release checksum|Checksum mismatch/)
    assert.deepEqual(d.files.get(d.dest), d.old)
    assert.equal(d.files.has(d.dest + '.part'), false)
    if (!options.mismatch) assert.equal(d.assetDownloads.length, 0)
  }
})

test('tool IPC reuses an installed downloader unless an explicit force update is requested', async () => {
  const d = downloader()
  const event = { sender: { isDestroyed: () => false, send: () => {} } }
  await d.handlers.get('tools-download')(event, { tools: ['ytdlp'] })
  assert.equal(d.requests.length, 0)
  assert.deepEqual(d.files.get(d.dest), d.old)
  await d.handlers.get('tools-download')(event, { tools: ['ytdlp'], force: true })
  assert.equal(d.requests.length, 2)
  assert.equal(d.assetDownloads.length, 1)
  assert.deepEqual(d.files.get(d.dest), d.binary)
})
