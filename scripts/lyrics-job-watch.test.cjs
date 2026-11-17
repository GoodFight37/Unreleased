const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync('src/renderer/src/lib/lyricsJobWatch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture(saved = []) {
  const storage = new Map([['unreleased:lyricsJobWatch', JSON.stringify(saved)]])
  const banners = [], records = [], requests = [], timers = new Map()
  let timerId = 0
  const window = Object.assign(new EventTarget(), { setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id) })
  const exports = {}
  Function('require', 'exports', 'localStorage', 'window', code)(name => ({
    '../store/useStore': { IS_FLOAT_WINDOW: false },
    './chatNotifications': { showNotificationBanner: value => banners.push(value) },
    './notificationHistory': { recordNotification: value => records.push(value) },
    './openNotification': { openNotificationTarget() {} },
    './lyricsGenApi': { jobTitle: job => job.filename, isFinished: job => ['completed', 'cancelled', 'failed'].includes(job.status), getLyricsJob: async id => { requests.push(id); return { id, mode: 'synced', status: 'completed', filename: 'Traveling' } } },
  }[name] ?? {}), exports, { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }, window)
  return { ...exports, storage, banners, records, requests, timers }
}
const watched = { id: 'job-one', title: 'Traveling', mode: 'synced', at: Date.now() }

test('a completed job survives reopening, notifies once and opens that result', async () => {
  const f = fixture([watched])
  const stop = f.startLyricsJobWatch()
  await flush()
  assert.equal(f.banners.length, 1)
  assert.deepEqual(f.banners[0].target, { view: 'lyrics', jobId: watched.id })
  assert.equal(f.storage.has('unreleased:lyricsJobWatch'), false)
  stop()
  const stopAgain = f.startLyricsJobWatch()
  await flush()
  assert.equal(f.banners.length, 1)
  stopAgain()
  assert.equal(f.timers.size, 0)
})

test('an on-screen job is recorded as read without an extra banner', async () => {
  const f = fixture([watched]), hide = f.showingLyricsJob(watched.id)
  const stop = f.startLyricsJobWatch()
  await flush()
  assert.equal(f.banners.length, 0)
  assert.equal(f.records[0].read, true)
  hide(); stop()
})

test('expired and malformed watched entries never request a job', async () => {
  const f = fixture([{ ...watched, at: Date.now() - 25 * 3600000 }, { id: 'missing-fields' }, { ...watched, mode: 'toString' }, null])
  const stop = f.startLyricsJobWatch()
  await flush()
  assert.deepEqual(f.requests, [])
  stop()
})
