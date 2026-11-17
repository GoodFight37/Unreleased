const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = readFileSync(require('node:path').join(__dirname, '../src/renderer/src/components/ApiTrackerView.tsx'), 'utf8')
const start = source.indexOf('  const handleGroupContextMenu = useCallback(')
const handler = source.slice(start, source.indexOf('  const selectedSongs', start))
function run(expanded) {
  const opened = []
  let prevented = 0
  let stopped = 0
  const group = { groupId: 42, title: 'Example', members: [{ item: { id: 1 } }, { item: { id: 2 } }] }
  const context = vm.createContext({
    useCallback: (fn) => fn, expandedGroups: new Set(expanded ? [42] : []),
    handleToggleGroup: (value) => opened.push(value),
    setSelected: () => assert.fail('Right-click must not select the group'),
    setSelectMode: () => assert.fail('Right-click must not enter bulk mode'),
    setBulkContextMenu: () => assert.fail('Right-click must not offer an implicit bulk download'),
  })
  vm.runInContext(ts.transpileModule(`${handler}\nglobalThis.open = handleGroupContextMenu`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  context.open(group, { preventDefault: () => prevented++, stopPropagation: () => stopped++ })
  return { group, opened, prevented, stopped }
}

test('right-click reveals the concrete versions without selecting or downloading any of them', () => {
  const result = run(false)
  assert.equal(result.opened.length, 1)
  assert.equal(result.opened[0], result.group)
  assert.equal(result.prevented, 1)
  assert.equal(result.stopped, 1)
})

test('right-click leaves an expanded group open and never enters selection mode', () => {
  assert.equal(run(true).opened.length, 0)
})

test('group playback refreshes when filters change and disclosure stays independent', () => {
  const exports = {}
  let compare
  const rowSource = readFileSync(require('node:path').join(__dirname, '../src/renderer/src/components/CompactGroupRow.tsx'), 'utf8')
  vm.runInNewContext(ts.transpileModule(rowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: (name) => name === 'react' ? { memo: (component, comparator) => { compare = comparator; return component } }
      : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      : name.endsWith('/a11y') ? { clickable: (onClick) => ({ onClick }) } : {},
  })
  let current = ''
  let expanded = 0
  const first = { coverTrack: { id: 'same-song' }, title: 'Same group', count: 2, expanded: false, onToggle: () => expanded++, onPlay: () => { current = 'old-filter' } }
  const next = { ...first, onPlay: () => { current = 'new-filter' } }
  assert.equal(compare(first, next), false)
  const row = exports.CompactGroupRow(next)
  row.props.onClick()
  assert.equal(current, 'new-filter')
  assert.equal(expanded, 0)
  row.props.children.at(-1).props.onClick({ stopPropagation() {} })
  assert.equal(expanded, 1)
  assert.equal(current, 'new-filter')
})
