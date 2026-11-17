const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateRelease } = require('./check-release.cjs')
const pkg = require('../package.json')
const lock = require('../package-lock.json')

test('packaging configuration matches the installed electron-builder schema on every target', () => {
  const { validateSchema } = require('app-builder-lib/out/util/config/schemaValidator')
  const schema = require('app-builder-lib/scheme.json')
  assert.doesNotThrow(() => validateSchema(schema, pkg.build))
  assert.throws(() => validateSchema(schema, { ...pkg.build, linux: { ...pkg.build.linux, desktopName: 'misplaced.desktop' } }))
})
test('Glass releases match the version, fork feed and installed identity', () => {
  assert.doesNotThrow(() => validateRelease(pkg, lock, `v${pkg.version}`))
  assert.throws(() => validateRelease(pkg, lock, 'v99.0.0'), /tag/)
  assert.throws(() => validateRelease(pkg, lock, `v${pkg.version}-beta.1`), /tag/)
  assert.throws(() => validateRelease(pkg, { ...lock, version: '0.0.0' }, `v${pkg.version}`), /lock/)
  assert.throws(() => validateRelease({ ...pkg, build: { ...pkg.build, publish: { provider: 'github', owner: 'Juice-WRLD-API', repo: 'Unreleased' } } }, lock, `v${pkg.version}`), /GoodFight37/)
})
test('releases follow one validated path: no auto-release, every release-triggered build checks identity', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const dir = path.join(__dirname, '..', '.github', 'workflows')
  assert.equal(fs.existsSync(path.join(dir, 'auto-release.yml')), false)
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    if (!/^\s*release:\s*$/m.test(text)) continue
    assert.match(text, /scripts\/check-release\.cjs/, `${name} must validate the release`)
    assert.match(text, /github\.repository == 'GoodFight37\/Unreleased'/, `${name} must stay on the fork`)
  }
})
