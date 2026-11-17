const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..', 'src', 'renderer', 'src')

function loadHotkeys() {
  const source = fs.readFileSync(path.join(root, 'lib', 'hotkeys.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(compiled, {
    module: loaded,
    exports: loaded.exports,
    navigator: { platform: 'Win32', userAgent: 'Electron' },
    require: (name) => {
      assert.equal(name, './viewLabels')
      const labels = { exports: {} }
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib', 'viewLabels.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText, { exports: labels.exports })
      return labels.exports
    },
  })
  return loaded.exports
}

test('navigation labels match listening pages without renaming saved shortcut actions', () => {
  const hk = loadHotkeys()
  for (const [id, label, expertLabel] of [['view-tracker', 'Catalogue', 'Tracker'], ['view-playlists', 'Collection', 'Playlists'], ['view-library', 'On this device', 'Library']]) {
    assert.equal(hk.hotkeyActionLabel(hk.getAction(id), false), `Go to ${label}`)
    assert.equal(hk.hotkeyActionLabel(hk.getAction(id), true), `Go to ${expertLabel}`)
    assert.equal(hk.resolveAction(hk.getAction(id).defaultBinding, {}), id)
  }
  assert.equal(hk.hotkeyActionLabel(hk.getAction('play-pause'), false), 'Play / pause')
})

test('terminal and devtools hotkeys preserve persisted IDs and custom bindings while requiring developerMode', () => {
  const hk = loadHotkeys()
  const terminal = hk.getAction('open-terminal')
  const devtools = hk.getAction('toggle-devtools')

  assert.ok(terminal, 'open-terminal must stay registered under its persisted id')
  assert.ok(devtools, 'toggle-devtools must stay registered under its persisted id')
  assert.equal(terminal.devModeOnly, true)
  assert.equal(devtools.devModeOnly, true)

  const customOverrides = {
    'open-terminal': 'Ctrl+Shift+T',
    'toggle-devtools': 'Ctrl+Shift+I',
  }

  // Persisted overrides keep resolving to their original IDs without mutating user settings
  assert.equal(hk.effectiveBinding('open-terminal', customOverrides), 'Ctrl+Shift+T')
  assert.equal(hk.effectiveBinding('toggle-devtools', customOverrides), 'Ctrl+Shift+I')
  assert.equal(hk.resolveAction('Ctrl+Shift+T', customOverrides), 'open-terminal')
  assert.equal(hk.resolveAction('Ctrl+Shift+I', customOverrides), 'toggle-devtools')

  // Execution permission is denied when developerMode is false, allowed when true
  assert.equal(hk.isHotkeyActionAllowed('open-terminal', false, true), false)
  assert.equal(hk.isHotkeyActionAllowed('toggle-devtools', false, true), false)
  assert.equal(hk.isHotkeyActionAllowed('open-terminal', true, true), true)
  assert.equal(hk.isHotkeyActionAllowed('toggle-devtools', true, true), true)
  assert.equal(hk.isHotkeyActionAllowed('toggle-devtools', true, false), false)
})

test('resolveInAppHotkey blocks terminal/devtools outside developerMode while preserving field typing and music controls', () => {
  const hk = loadHotkeys()
  const repeatable = new Set(['seek-forward', 'seek-backward', 'volume-up', 'volume-down', 'speed-up', 'speed-down'])
  const overrides = { 'open-terminal': 'Ctrl+Shift+T' }

  const check = (input, expected) => {
    const actual = hk.resolveInAppHotkey(input)
    assert.equal(actual.id, expected.id)
    assert.equal(actual.preventDefault, expected.preventDefault)
    assert.equal(actual.run, expected.run)
  }

  // Outside developerMode: default and custom terminal & devtools shortcuts must NOT run or preventDefault
  check({ combo: 'Ctrl+`', overrides: {}, developerMode: false, hasElectron: true, typing: false, clickable: false, repeat: false, repeatableIds: repeatable }, { id: null, preventDefault: false, run: false })
  check({ combo: 'Ctrl+Shift+T', overrides, developerMode: false, hasElectron: true, typing: true, clickable: false, repeat: false, repeatableIds: repeatable }, { id: null, preventDefault: false, run: false })
  check({ combo: 'F12', overrides: {}, developerMode: false, hasElectron: true, typing: false, clickable: false, repeat: false, repeatableIds: repeatable }, { id: null, preventDefault: false, run: false })
  check({ combo: 'F12', overrides: {}, developerMode: false, hasElectron: true, typing: true, clickable: false, repeat: false, repeatableIds: repeatable }, { id: null, preventDefault: false, run: false })

  // Music controls still work outside fields when developerMode is false
  check({ combo: 'Space', overrides: {}, developerMode: false, hasElectron: true, typing: false, clickable: false, repeat: false, repeatableIds: repeatable }, { id: 'play-pause', preventDefault: true, run: true })
  check({ combo: 'Ctrl+ArrowRight', overrides: {}, developerMode: false, hasElectron: true, typing: false, clickable: false, repeat: false, repeatableIds: repeatable }, { id: 'next', preventDefault: true, run: true })

  // Typing in inputs/textareas preserves Space / letters without intercepting
  check({ combo: 'Space', overrides: {}, developerMode: false, hasElectron: true, typing: true, clickable: false, repeat: false, repeatableIds: repeatable }, { id: null, preventDefault: false, run: false })
  check({ combo: 'M', overrides: {}, developerMode: false, hasElectron: true, typing: true, clickable: false, repeat: false, repeatableIds: repeatable }, { id: null, preventDefault: false, run: false })

  // Inside developerMode: terminal (including inside its own input) and devtools execute
  check({ combo: 'Ctrl+`', overrides: {}, developerMode: true, hasElectron: true, typing: true, clickable: false, repeat: false, repeatableIds: repeatable }, { id: 'open-terminal', preventDefault: true, run: true })
  check({ combo: 'F12', overrides: {}, developerMode: true, hasElectron: true, typing: false, clickable: false, repeat: false, repeatableIds: repeatable }, { id: 'toggle-devtools', preventDefault: true, run: true })
})

test('Player blocks programmatic dispatch, global shortcuts, and global registration for devModeOnly actions when developerMode is false', () => {
  const playerSource = fs.readFileSync(path.join(root, 'components', 'Player.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const hk = loadHotkeys()

  // Verify Player.tsx gates registerHotkeyDispatch, onGlobalShortcut, and registerGlobalShortcuts with isHotkeyActionAllowed
  assert.ok(playerSource.includes("registerHotkeyDispatch((id) => {\n    const s = useStore.getState()\n    if (!isHotkeyActionAllowed(id, s.developerMode, !!(window as any).electron)) return"))
  assert.ok(playerSource.includes("el.onGlobalShortcut((id: string) => {\n      const s = useStore.getState()\n      if (!isHotkeyActionAllowed(id, s.developerMode, true)) return"))
  assert.ok(playerSource.includes("if (!isHotkeyActionAllowed(action.id, developerMode, true)) continue"))
  assert.ok(playerSource.includes("[globalHotkeysEnabled, globalHotkeyBindings, developerMode]"))

  // Verify global registration filter omits toggle-devtools & open-terminal when developerMode=false, includes them when true
  const globalBindings = {
    'play-pause': 'MediaPlayPause',
    'toggle-devtools': 'Ctrl+Shift+F12',
    'open-terminal': 'Ctrl+Alt+T',
  }
  const collect = (developerMode) => {
    const entries = []
    for (const action of hk.HOTKEY_ACTIONS) {
      if (!hk.isHotkeyActionAllowed(action.id, developerMode, true)) continue
      const accel = hk.comboToAccelerator(hk.effectiveGlobalBinding(action.id, globalBindings))
      if (accel) entries.push({ id: action.id, accelerator: accel })
    }
    return entries
  }

  assert.deepEqual(collect(false).map((e) => e.id), ['play-pause'])
  assert.deepEqual(collect(true).map((e) => e.id), ['play-pause', 'toggle-devtools', 'open-terminal'])
})
