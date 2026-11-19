const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createAudioStreamCache } = require('./audioStreamCache')

test('audioStreamCache stores, hits, and evicts oldest entries beyond maxBytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unreleased-stream-cache-'))
  try {
    // 1 MiB minimum budget enforced by createAudioStreamCache
    const cache = createAudioStreamCache({ dir, maxBytes: 1024 * 1024 })
    const chunkA = Buffer.alloc(600 * 1024, 0x41)
    const chunkB = Buffer.alloc(600 * 1024, 0x42)

    const pA = await cache.put('https://example.com/a.mp3', chunkA, '.mp3')
    // Backdate entry A so entry B is strictly newer
    const past = new Date(Date.now() - 60_000)
    await fs.utimes(pA, past, past)

    await cache.put('https://example.com/b.mp3', chunkB, '.mp3')
    const pruned = await cache.prune()

    assert.equal(pruned.evicted, 1)
    assert.equal(await cache.get('https://example.com/a.mp3', '.mp3'), null)
    assert.ok(await cache.get('https://example.com/b.mp3', '.mp3'))

    await cache.clear()
    assert.equal(await cache.get('https://example.com/b.mp3', '.mp3'), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
