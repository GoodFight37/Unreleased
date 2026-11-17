const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
const source = (name, next) => main.slice(main.indexOf(`function ${name}(`), main.indexOf(next, main.indexOf(`function ${name}(`)))

test('stable updater follows the packaged fork feed and ignores upstream beta codes', () => {
  const feeds = []
  const repo = vm.runInNewContext(`(${main.match(/const UPDATE_REPO = (.+)/)[1]})`)
  const disabled = vm.runInNewContext(main.match(/const UPSTREAM_BETA_DISABLED = .+/)[0] + '; UPSTREAM_BETA_DISABLED')
  assert.equal(disabled, true)
  const context = { UPSTREAM_BETA_DISABLED: disabled, UPDATE_REPO: repo, autoUpdater: { setFeedURL: feed => feeds.push(feed) } }
  vm.runInNewContext(`let activeBetaCode = null; ${source('applyUpdateFeed', '// Semver precedence')} applyUpdateFeed('old-upstream-code'); globalThis.active = activeBetaCode`, context)
  assert.equal(context.active, null)
  assert.equal(context.autoUpdater.allowPrerelease, false)
  assert.equal(feeds[0].owner, 'GoodFight37')
  assert.equal(feeds[0].repo, 'Unreleased')
  const pkg = require('../package.json')
  assert.equal(pkg.build.publish.owner, feeds[0].owner)
  assert.equal(pkg.build.publish.repo, feeds[0].repo)
})

test('upstream beta marker and network checks remain disabled', async () => {
  const context = { UPSTREAM_BETA_DISABLED: true, fs: { readFileSync: () => assert.fail('Must not read the upstream beta marker') } }
  vm.runInNewContext(`${source('readBetaCode', '// Stable releases')} globalThis.code = readBetaCode()`, context)
  assert.equal(context.code, null)
  const start = main.indexOf('async function checkBetaUpdate(')
  const end = main.indexOf('\nasync function ', start + 10)
  const body = main.slice(start, end)
  const checked = { UPSTREAM_BETA_DISABLED: true }
  vm.runInNewContext(`${body}; globalThis.check = checkBetaUpdate`, checked)
  assert.equal(await checked.check(), false)
})
