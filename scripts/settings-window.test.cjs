const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const store = readFileSync(join(__dirname, '../src/renderer/src/store/useStore.ts'), 'utf8')
const settings = readFileSync(join(__dirname, '../src/renderer/src/components/Settings.tsx'), 'utf8')
const defaults = store.slice(store.indexOf('const POPOUT_WINDOW_DEFAULTS:'), store.indexOf('// --- Non-queue state'))
const actionsStart = store.indexOf('  setShowSettings: (showSettings) =>')
const actions = store.slice(actionsStart, store.indexOf('  openProfile:', actionsStart))
const popoutAction = store.slice(store.indexOf('  setPopoutWindow: (kind, enabled) =>'), store.indexOf('  setAccentColor: (color) =>'))

function boot(saved) {
  let persisted = saved
  let expanded = 0
  const state = { showSettings: false }
  const context = vm.createContext({
    ls: { get: () => saved, set: (_key, value) => { persisted = value } },
    get: () => state,
    set: (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch),
    useSandboxStore: { getState: () => ({ expand: () => { expanded++ } }) },
    window: { electron: {
      openFloatWindow: () => assert.fail('Settings must stay in the main window'),
      toggleFloatWindow: () => assert.fail('Settings must stay in the main window'),
    } },
  })
  vm.runInContext(ts.transpileModule(`${defaults}\nglobalThis.initial = initialPopoutWindows\nglobalThis.actions = {${actions}${popoutAction}}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  Object.assign(state, context.actions, { popoutWindows: context.initial })
  return { state, persisted: () => persisted, expanded: () => expanded }
}

test('fresh and existing installations keep Settings docked and preserve other preferences', () => {
  assert.equal(boot(null).state.popoutWindows.settings, false)
  const run = boot({ settings: true, songInfo: false, equalizer: true })
  assert.equal(run.state.popoutWindows.settings, false)
  assert.equal(run.persisted().settings, false)
  assert.equal(run.persisted().songInfo, false)
  assert.equal(run.persisted().equalizer, true)
  run.state.setPopoutWindow('settings', true)
  assert.equal(run.state.popoutWindows.settings, false)
  run.state.setPopoutWindow('profile', false)
  assert.equal(run.persisted().profile, false)
  assert.equal(run.persisted().equalizer, true)
})

test('every Settings action opens the expanded in-app overlay, including stale runtime preferences', () => {
  const run = boot({ settings: true })
  run.state.popoutWindows.settings = true
  run.state.openSettings('shortcuts')
  assert.equal(run.state.settingsTab, 'shortcuts')
  assert.equal(run.state.showSettings, true)
  assert.equal(run.expanded(), 1)
  run.state.toggleSettings()
  assert.equal(run.state.showSettings, false)
  run.state.toggleSettings()
  assert.equal(run.state.showSettings, true)
  assert.equal(run.expanded(), 2)
})

test('Settings has no detach button or pop-out preference and keeps its expanded overlay', () => {
  const kinds = settings.slice(settings.indexOf('const POPOUT_KINDS:'), settings.indexOf('type UpdateState'))
  assert.doesNotMatch(kinds, /key: 'settings'/)
  assert.doesNotMatch(settings, /openFloatWindow\('settings'\)/)
  assert.match(settings, /\bexpanded\s+expandedMaxWidth=\{1180\}/)
})
