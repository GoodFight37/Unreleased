const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'renderer', 'src')

function walkTs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkTs(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

test('zero native window.confirm or window.alert calls remain in renderer source', () => {
  const files = walkTs(SRC)
  const violations = []
  for (const file of files) {
    if (file.endsWith('confirmModal.ts')) continue
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, idx) => {
      if (/\b(?:window\.)?(?:confirm|alert)\(\s*[^)]/.test(line)) {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
        violations.push(`${path.relative(ROOT, file)}:${idx + 1}: ${trimmed}`)
      }
    })
  }
  assert.deepEqual(violations, [])
})

test('App.tsx routes all internal paths cleanly without falling back to not-found', () => {
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8')
  for (const route of ['/home', '/settings', '/editor-profile', '/contributor-profile', '/albums-admin', '/download', '/local-editor']) {
    assert.ok(app.includes(`'${route}'`), `expected route ${route} in getViewFromPath`)
  }
  assert.match(app, /pathname in ADMIN_PATH_TABS/)
})

test('chatStore bounds rooms, items per room, decrypted cache, and threads', () => {
  const chatStore = fs.readFileSync(path.join(SRC, 'store', 'chatStore.ts'), 'utf8')
  assert.match(chatStore, /MAX_ROOM_ITEMS\s*=\s*\d+/)
  assert.match(chatStore, /MAX_CACHED_ROOMS\s*=\s*\d+/)
  assert.match(chatStore, /MAX_PLAIN_CACHE\s*=\s*\d+/)
  assert.match(chatStore, /MAX_THREADS_CACHED\s*=\s*\d+/)
})

test('ApiFilesBrowser and LogsTab use virtualized windows', () => {
  const filesBrowser = fs.readFileSync(path.join(SRC, 'components', 'ApiFilesBrowser.tsx'), 'utf8')
  const logsTab = fs.readFileSync(path.join(SRC, 'components', 'LogsTab.tsx'), 'utf8')
  assert.match(filesBrowser, /useVirtualWindow\(/)
  assert.match(logsTab, /useVariableVirtualWindow\(/)
})
