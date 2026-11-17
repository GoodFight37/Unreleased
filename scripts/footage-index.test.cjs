const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../src/renderer/src')
function load(file, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}
// Use the real normalization and duration helpers without bootstrapping the renderer's network stack.
const apiFile = ts.createSourceFile('juicewrldApi.ts', readFileSync(path.join(root, 'lib/juicewrldApi.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const helpers = apiFile.statements.filter(n => ts.isFunctionDeclaration(n) && ['normalizeForSearch', 'parseDuration'].includes(n.name?.text)).map(n => n.getText(apiFile)).join('\n')
const api = {}
Function('exports', ts.transpileModule(helpers, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(api)
let loadedIndex = null
let requestedChannel = null
const { matchFootage, loadSongFootage, footageBrowserOnly } = load('lib/footageIndex.ts', {
  './fileSearch': { loadFileIndex: async channel => { requestedChannel = channel; return loadedIndex } },
  './juicewrldApi': api,
  './lyricSearch': load('lib/lyricSearch.ts'),
})
const index = (...paths) => ({ items: paths.map(path => ({ kind: /\.mp4$/i.test(path) ? 'video' : 'audio', entry: { path, name: path.split('/').at(-1), type: 'file' } })) })

test('exact matches normalize punctuation, suffixes and video labels, only in footage roots', () => {
  const files = index('Footage/Lucid Dreams (Official).mp4', 'Snippets/Lucid-Dreams preview.mp4', 'Studio Sessions/Lucid Dreams studio session HD.mp4', 'Other/Lucid Dreams.mp4', 'Footage/Lucid Dreams.mp3', 'Compilation/Footage/Lucid Dreams.mp4')
  const matches = matchFootage(files, 'Lucid Dreams (OG)')
  assert.equal(matches.length, 3)
  assert.ok(matches.every(m => m.level === 'exact' && m.confidence === 100))
})

test('rejects isolated substrings, short titles and matches only in parent folders', () => {
  assert.equal(matchFootage(index('Footage/Already.mp4'), 'Red').length, 0)
  assert.equal(matchFootage(index('Footage/Go.mp4'), 'Go').length, 0)
  assert.equal(matchFootage(index('Footage/Lucid Dreams/Unrelated.mp4'), 'Lucid Dreams').length, 0)
  assert.equal(matchFootage(index('Footage/Lucid.mp4'), 'Lucid Dreams').length, 0)
})

test('L2 needs two distinct whole words and at least 70 percent coverage', () => {
  assert.equal(matchFootage(index('Snippets/Who Shot.mp4'), 'Who Shot Cupid').length, 0)
  const [match] = matchFootage(index('Snippets/The Light Is Bright Extra.mp4'), 'The Light Is Bright Today')
  assert.equal(match.level, 'shared')
  assert.equal(match.confidence, 80)
  assert.equal(matchFootage(index('Footage/Light light.mp4'), 'Light Light Today').length, 0)
})

test('typos are opt-in, labeled approximate and never use substring prefixes', () => {
  const files = index('Footage/Lucdi Dreams.mp4', 'Footage/Lucid Dreamscape.mp4')
  assert.equal(matchFootage(files, 'Lucid Dreams').length, 0)
  const matches = matchFootage(files, 'Lucid Dreams', true)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].level, 'approximate')
  assert.equal(matches[0].confidence, 70)
  assert.equal(matchFootage(index('Footage/Silver.mp4'), 'Silver Sliver', true).length, 0)
})

test('results rank exact before shared before approximate', () => {
  const matches = matchFootage(index('Footage/Who Shot Cupid.mp4', 'Snippets/Who Shot Cupid Extra.mp4', 'Studio Sessions/Who Shot Cupdi.mp4'), 'Who Shot Cupid', true)
  assert.deepEqual(matches.map(m => m.level), ['exact', 'shared', 'approximate'])
})

test('loader forwards channel and distinguishes unavailable from empty index', async () => {
  loadedIndex = null
  assert.equal(await loadSongFootage('Lucid Dreams', 'legacy'), null)
  assert.equal(requestedChannel, 'legacy')
  loadedIndex = index()
  assert.deepEqual(await loadSongFootage('Lucid Dreams', 'comp'), [])
  loadedIndex = index('Footage/Lucid Dreams.mp4')
  assert.equal((await loadSongFootage('Lucid Dreams', 'comp')).length, 1)
})

test('inline playback guards enforce size and duration boundaries', () => {
  assert.equal(footageBrowserOnly({ size: 800_000_000, duration: '1:00:00' }), false)
  assert.equal(footageBrowserOnly({ size: 800_000_001 }), true)
  assert.equal(footageBrowserOnly({ duration: '1:00:01' }), true)
  assert.equal(footageBrowserOnly({ duration: '61:00' }), true)
  assert.equal(footageBrowserOnly({}), false)
})

test('video disposal pauses before releasing its source and decoder', () => {
  const file = ts.createSourceFile('SongInfoModal.tsx', readFileSync(path.join(root, 'components/SongInfoModal.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const cleanup = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'releaseFootage').getText(file)
  const calls = []
  const video = { pause: () => calls.push('pause'), removeAttribute: attr => calls.push(`remove:${attr}`), load: () => calls.push('load') }
  Function('video', ts.transpileModule(`let activeFootageVideo = video; ${cleanup}; releaseFootage(video)`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(video)
  assert.deepEqual(calls, ['pause', 'remove:src', 'load'])
})

test('terminal forwards title, channel and explicit typo flag, and rejects missing titles', async () => {
  const calls = []
  const { FOOTAGE_COMMANDS: [command] } = load('lib/terminal/footage.ts', {
    '../footageIndex': { loadSongFootage: async (...args) => { calls.push(args); return [] }, footageBrowserOnly },
    '../../store/useStore': { useStore: { getState: () => ({ activeChannel: 'legacy' }) } },
  })
  const output = []
  const ctx = { print: (...args) => output.push(args) }
  await command.run('Lucid Dreams', ctx)
  await command.run('Lucid Dreams --approximate', ctx)
  assert.deepEqual(calls, [['Lucid Dreams', 'legacy', false], ['Lucid Dreams', 'legacy', true]])
  assert.deepEqual(output[0], ['No matching footage', 'dim'])
  await assert.rejects(command.run('--approximate', ctx), /usage: footage/)
  assert.equal(calls.length, 2)
})
