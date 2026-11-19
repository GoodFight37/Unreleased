// Bounded LRU disk cache for streamed remote audio tracks.
// Stores completed audio files keyed by deterministic SHA-256 hash of source URL,
// touching mtime on hit and evicting least-recently-used entries when total size
// exceeds maxBytes (default 1 GiB). All I/O is asynchronous via fs.promises.

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024 // 1 GiB

/**
 * @param {string} url
 * @param {string} [ext]
 */
function keyForUrl(url, ext = '') {
  const hash = crypto.createHash('sha256').update(String(url)).digest('hex')
  const safeExt = typeof ext === 'string' && /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '.bin'
  return `${hash}${safeExt}`
}

/**
 * @param {{ dir: string, maxBytes?: number }} opts
 */
function createAudioStreamCache(opts) {
  const dir = opts.dir
  const maxBytes = Math.max(1024 * 1024, Number(opts.maxBytes) || DEFAULT_MAX_BYTES)
  let dirReady = false
  /** @type {Promise<{ totalBytes: number, evicted: number }> | null} */
  let pruneInFlight = null

  async function ensureDir() {
    if (dirReady) return
    await fsp.mkdir(dir, { recursive: true })
    dirReady = true
  }

  /**
   * Look up a cached audio file by URL. Updates mtime on hit for LRU ordering.
   * @param {string} url
   * @param {string} [ext]
   * @returns {Promise<string | null>}
   */
  async function get(url, ext) {
    const filePath = path.join(dir, keyForUrl(url, ext))
    try {
      const st = await fsp.stat(filePath)
      if (!st.isFile() || st.size === 0) return null
      const now = new Date()
      fsp.utimes(filePath, now, now).catch(() => {})
      return filePath
    } catch {
      return null
    }
  }

  /**
   * Atomically store a completed audio buffer into the LRU cache and prune if over budget.
   * @param {string} url
   * @param {Buffer | Uint8Array} data
   * @param {string} [ext]
   * @returns {Promise<string>}
   */
  async function put(url, data, ext) {
    await ensureDir()
    const filePath = path.join(dir, keyForUrl(url, ext))
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(tmp, data)
    try {
      await fsp.rename(tmp, filePath)
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {})
      throw err
    }
    void prune().catch(() => {})
    return filePath
  }

  /**
   * Evict oldest-accessed entries until total cache size <= maxBytes.
   * Serialized so concurrent puts/prunes never double-evict.
   * @returns {Promise<{ totalBytes: number, evicted: number }>}
   */
  async function prune() {
    if (pruneInFlight) return pruneInFlight
    pruneInFlight = (async () => {
      await ensureDir()
      const names = await fsp.readdir(dir)
      /** @type {Array<{ file: string, size: number, mtimeMs: number }>} */
      const entries = []
      let totalBytes = 0
      for (const name of names) {
        if (name.endsWith('.tmp')) continue
        const full = path.join(dir, name)
        try {
          const st = await fsp.stat(full)
          if (!st.isFile()) continue
          entries.push({ file: full, size: st.size, mtimeMs: st.mtimeMs })
          totalBytes += st.size
        } catch { /* raced unlink */ }
      }
      if (totalBytes <= maxBytes) return { totalBytes, evicted: 0 }
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
      let evicted = 0
      for (const entry of entries) {
        if (totalBytes <= maxBytes) break
        try {
          await fsp.unlink(entry.file)
          totalBytes -= entry.size
          evicted++
        } catch { /* ignore */ }
      }
      return { totalBytes, evicted }
    })().finally(() => { pruneInFlight = null })
    return pruneInFlight
  }

  async function clear() {
    try {
      const names = await fsp.readdir(dir)
      await Promise.all(names.map((n) => fsp.unlink(path.join(dir, n)).catch(() => {})))
    } catch { /* missing dir */ }
  }

  return { dir, maxBytes, get, put, prune, clear, keyForUrl }
}

module.exports = { createAudioStreamCache, keyForUrl, DEFAULT_MAX_BYTES }
