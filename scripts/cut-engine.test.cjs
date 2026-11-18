const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(relative, globals = {}) {
  const src = fs.readFileSync(path.join(__dirname, relative), 'utf8')
  const mod = {}
  const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, { exports: mod, ...globals })
  return mod
}

const { buildCut, cutAt } = load('../src/renderer/src/desktop/lyrics/cutEngine.ts')
const { timedFromLines } = load('../src/renderer/src/desktop/lyrics/timing.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const nearly = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const word = (text, start, end = start + 0.3) => ({ text, start, end })
const lyrics = (...lines) => ({ lines, isSynced: true })

function row(time, text, options = {}) {
  const words = options.words ?? text.split(/\s+/).filter(Boolean).map((text, i) => word(text, time + i * 0.3))
  const adlibs = options.adlibs ?? []
  return { time, text, words, adlibs, all: [...words, ...adlibs].sort((a, b) => a.start - b.start), ...options }
}

function invariant(song) {
  assert.deepEqual(Object.keys(song).sort(), ['duration', 'lines'])
  assert.ok(Number.isFinite(song.duration) && song.duration >= 3)
  song.lines.forEach((line, i) => {
    assert.equal(line.index, i)
    for (const key of ['time', 'until', 'enterAt', 'gapBefore', 'gapAfter']) assert.ok(Number.isFinite(line[key]), key)
    assert.ok(line.until >= line.time)
    assert.ok(line.enterAt >= line.time && line.enterAt <= line.time + 0.1 + 1e-9)
    if (i + 1 < song.lines.length) assert.ok(line.until <= song.lines[i + 1].time)
    assert.ok(line.words.every(w => typeof w.text === 'string' && Number.isFinite(w.start) && [0, 1, 2].includes(w.accent)))
    if (line.kind === 'impact') {
      assert.equal(line.words.filter(w => w.accent === 2).length, 1)
      assert.equal(line.words.filter(w => w.accent === 1).length, 0)
      if (i) assert.notEqual(song.lines[i - 1].kind, 'impact')
    } else {
      assert.equal(line.kind, 'retained')
      assert.equal(line.words.filter(w => w.accent === 2).length, 0)
      assert.ok(line.words.filter(w => w.accent === 1).length <= 1)
    }
    assert.ok(['data', 'groups', 'syllables'].includes(line.timingSource))
    assert.equal(line.breathAfter, line.gapAfter > 2)
  })
}

test('line-timed input is sorted and defaults to graphic groups', () => {
  const song = buildCut(lyrics(row(5, 'Le ciel attend encore'), row(1, 'Je retrouve la lumière')))
  assert.deepEqual(plain(song.lines.map(l => l.time)), [1, 5])
  assert.ok(song.lines.every(l => l.timingSource === 'groups'))
  assert.deepEqual(plain(song.lines[0].words.map(w => w.text)), ['Je', 'retrouve', 'la', 'lumière'])
  invariant(song)
})

test('wordTimed input preserves exact starts and its supplied final end', () => {
  const words = [word('Je', 1.1, 1.32), word('retrouve', 1.32, 2.83), word('la', 2.83, 3.12), word('lumière', 3.12, 4.21)]
  const song = buildCut(lyrics(row(1, 'Je retrouve la lumière', { words, wordTimed: true })))
  assert.equal(song.lines[0].timingSource, 'data')
  assert.deepEqual(plain(song.lines[0].words.map(w => w.start)), [1.1, 1.32, 2.83, 3.12])
  assert.equal(song.lines[0].until, 4.21)
  nearly(song.duration, 7.21)
})

test('estimated starts never become data when wordTimed is false or absent', () => {
  for (const flag of [false, undefined]) {
    const input = lyrics(row(1, 'Je retrouve la lumière', { wordTimed: flag }))
    input.isSynced = false
    for (const timing of ['word', 'a', 'b']) {
      const song = buildCut(input, timing)
      assert.equal(song.lines[0].timingSource, timing === 'b' ? 'syllables' : 'groups')
      invariant(song)
    }
  }
})

test('shared data anchors stay shared and do not imply an individual held word', () => {
  const words = [word('phare', 1, 3), word('lueur', 1, 3), word('horizon', 3, 3.3)]
  const song = buildCut(lyrics(row(1, 'phare lueur horizon', { words, wordTimed: true })))
  assert.equal(song.lines[0].timingSource, 'data')
  assert.deepEqual(plain(song.lines[0].words.map(w => w.start)), [1, 1, 3])
  assert.equal(song.lines[0].words.findIndex(w => w.accent === 1), 2)
})

test('a and b deliberately replace data timing with their own labelled cadence', () => {
  const input = lyrics(row(1, 'Je retrouve la lumière', { wordTimed: true }))
  const a = buildCut(input, 'a').lines[0], b = buildCut(input, 'b').lines[0]
  assert.equal(a.timingSource, 'groups')
  assert.equal(b.timingSource, 'syllables')
  assert.equal(a.words[0].start, a.words[1].start)
  assert.ok(b.words[1].start > b.words[0].start)
  assert.notDeepEqual(plain(a.words.map(w => w.start)), plain(b.words.map(w => w.start)))
})

test('each supplied ad-lib is parenthesized and stays outside the main words', () => {
  const adlibs = [word('un écho (lointain)', 1.2, 1.5), word('une voix', 2, 2.5)]
  const line = buildCut(lyrics(row(1, 'Je retrouve le calme', { adlibs })), 'a').lines[0]
  assert.deepEqual(plain(line.words.map(w => w.text)), ['Je', 'retrouve', 'le', 'calme'])
  assert.equal(line.ad, '(un écho (lointain)) (une voix)')
  assert.equal(line.adOnly, false)
})

test('ad-lib-only input exposes its adlibs as words without strong accents', () => {
  const adlibs = [word('une voix lointaine', 1, 2), word('un écho', 2, 3)]
  const line = buildCut(lyrics(row(1, '', { words: [], adlibs, wordTimed: true }))).lines[0]
  assert.equal(line.adOnly, true)
  assert.equal(line.ad, '(une voix lointaine) (un écho)')
  assert.deepEqual(plain(line.words.map(w => w.text)), ['une voix lointaine', 'un écho'])
  assert.deepEqual(plain(line.words.map(w => w.start)), [1, 2])
  assert.ok(line.words.every(w => w.accent === 0))
  assert.equal(line.kind, 'retained')
})

test('text and all are not reparsed to replace the already separated main words', () => {
  const line = row(1, 'Texte différent (un écho)', { words: [word('Conservé', 1, 2)], adlibs: [word('un écho', 2, 4)], wordTimed: true })
  const out = buildCut(lyrics(line)).lines[0]
  assert.deepEqual(plain(out.words.map(w => w.text)), ['Conservé'])
  assert.equal(out.ad, '(un écho)')
  assert.equal(out.until, 4)
})

test('normalized repeated lines alternate impact and retained arrivals', () => {
  const song = buildCut(lyrics(row(1, 'Je retrouve la lumière'), row(5, 'JE RETROUVE LA LUMIÈRE!'), row(9, 'Je retrouve la lumière'), row(13, 'Je retrouve la lumière')), 'a')
  assert.deepEqual(plain(song.lines.map(l => l.kind)), ['impact', 'retained', 'impact', 'retained'])
  invariant(song)
})

test('different repeated phrases cannot cause adjacent impact lines', () => {
  const song = buildCut(lyrics(row(1, 'Les étoiles restent'), row(5, 'Les horizons respirent'), row(9, 'Les étoiles restent'), row(13, 'Les horizons respirent')), 'a')
  assert.ok(song.lines.some(l => l.kind === 'impact'))
  invariant(song)
})

test('the supplied held duration can select an interior word instead of the longest final word', () => {
  const words = [word('lueur', 1, 1.1), word('mer', 1.5, 3.3), word('horizon', 3.5, 3.6)]
  const input = lyrics(row(1, 'lueur mer horizon', { words, wordTimed: true }))
  assert.equal(buildCut(input).lines[0].words.findIndex(w => w.accent === 1), 1)
  assert.equal(buildCut(input, 'a').lines[0].words.findIndex(w => w.accent === 1), 2)
})

test('repetition does not promote filler words or adlibs to impact', () => {
  const song = buildCut(lyrics(row(1, 'I am'), row(5, 'I am'), row(9, '', { adlibs: [word('yeah', 9)] })), 'a')
  assert.ok(song.lines.every(l => l.kind === 'retained' && l.words.every(w => w.accent === 0)))
})

test('the 100 ms visual gate never rewrites a real start', () => {
  const song = buildCut(lyrics(
    row(1, '', { words: [word('Une', 1, 2), word('lumière', 2, 3)], wordTimed: true }),
    row(3, '', { words: [word('Un', 3, 3.5), word('horizon', 3.5, 4.5)], wordTimed: true }),
  ))
  const line = song.lines[1]
  assert.equal(line.words[0].start, 3)
  assert.equal(line.timingSource, 'data')
  nearly(line.enterAt, song.lines[0].until + 0.1)
  nearly(line.enterAt - line.time, 0.1)
  invariant(song)
})

test('a long gap is reported as breathing and does not add a late gate', () => {
  const song = buildCut(lyrics(row(1, '', { words: [word('lumière', 1, 2)], wordTimed: true }), row(7, 'Un horizon')))
  assert.equal(song.lines[0].gapAfter, 5)
  assert.equal(song.lines[0].breathAfter, true)
  assert.equal(song.lines[1].gapBefore, 5)
  assert.equal(song.lines[1].enterAt, 7)
})

test('cutAt exposes all six phases and is unchanged by forward and backward queries', () => {
  const song = buildCut(lyrics(row(1, '', { words: [word('Une', 1, 2), word('lumière', 2, 8)], wordTimed: true })))
  assert.deepEqual([0, 1.1, 3, 7.9, 8.1, 8.5].map(t => cutAt(song, t).phase), ['before', 'enter', 'sing', 'hold', 'exit', 'breath'])
  const before = JSON.stringify(song), expected = cutAt(song, 3)
  for (const t of [9, 1.1, 8, -10, 200, 0, 4]) cutAt(song, t)
  assert.deepEqual(cutAt(song, 3), expected)
  assert.equal(JSON.stringify(song), before)
  assert.equal(expected.prevIndex, null)
})

test('cutAt reports the chronological previous line during the next arrival', () => {
  const song = buildCut(lyrics(row(1, 'Une lumière'), row(5, 'Un horizon')), 'a')
  assert.deepEqual(plain(cutAt(song, 5.01)), { lineIndex: 1, prevIndex: 0, phase: 'enter' })
})

test('empty lines and non-finite input times or word ends cannot create infinite duration', () => {
  for (const input of [lyrics(), lyrics(row(1, '')), lyrics(row(NaN, 'Une lumière')), lyrics(row(Infinity, 'Une lumière'))]) {
    const song = buildCut(input)
    assert.equal(song.duration, 3)
    assert.deepEqual(plain(song.lines), [])
    assert.equal(cutAt(song, 5).phase, 'before')
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    invariant(buildCut(lyrics(row(1, '', { words: [word('horizon', 1, invalid)], wordTimed: true }))))
    const song = buildCut(lyrics(row(1, '', { words: [word('horizon', invalid, invalid)], wordTimed: true })))
    invariant(song)
    assert.equal(song.lines[0].timingSource, 'groups')
  }
  invariant(buildCut(lyrics(row(-100, 'Un horizon'))))
})

test('optional all may be absent without losing adlibs or their final end', () => {
  const line = row(1, '', { words: [word('lumière', 1, 2)], adlibs: [word('un écho', 2, 4)], wordTimed: true })
  const expected = buildCut(lyrics(line))
  delete line.all
  assert.deepEqual(buildCut(lyrics(line)), expected)
  assert.equal(expected.lines[0].until, 4)
})

test('coincident and closely spaced lines keep finite graphic starts inside their windows', () => {
  const input = lyrics(row(1, 'Une phrase très rapprochée'), row(1.03, 'Un autre mouvement'), row(1.03, 'Un horizon'), row(1.05, 'La lumière'))
  for (const timing of ['a', 'b']) {
    const song = buildCut(input, timing)
    invariant(song)
    assert.ok(song.lines.every(l => l.words.every(w => w.start >= l.time && w.start <= l.until)))
  }
})

test('buildCut leaves deeply frozen input untouched and rejects unknown timing values', () => {
  const input = lyrics(row(1, 'Une lumière', { adlibs: [word('un écho', 2, 3)] }))
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } }
  freeze(input)
  const before = JSON.stringify(input)
  const first = buildCut(input), second = buildCut(input)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(input), before)
  assert.throws(() => buildCut(input, 'unknown'), /timing must be word, a or b/)
})

test('the transpiled TypeScript module needs no runtime import, DOM or clock', () => {
  const unavailable = () => { throw Error('Unexpected runtime dependency') }
  const mod = load('../src/renderer/src/desktop/lyrics/cutEngine.ts', { require: unavailable, Date: { now: unavailable }, performance: { now: unavailable } })
  const input = lyrics(row(1, 'Une lumière'))
  assert.deepEqual(plain(mod.buildCut(input)), plain(buildCut(input)))
  assert.equal(mod.cutAt(mod.buildCut(input), 2).lineIndex, 0)
})

test('the app TimedLyrics adapter preserves flags and a single offset across five input shapes', () => {
  const shapes = [
    [{ time: 1, text: 'Une lumière', words: [word('Une', 1, 1.4), word('lumière', 1.4, 2)] }],
    [{ time: 1, text: 'Le calme (un écho)', words: [word('Le', 1, 1.3), word('calme', 1.3, 2), word('(un', 2, 2.2), word('écho)', 2.2, 3)] }],
    [{ time: 1, text: 'Un horizon' }],
    [{ time: 1, text: Array.from({ length: 24 }, (_, i) => `lueur${i}`).join(' ') }],
    [{ time: 1, text: 'Le calme (un écho) revient (une voix)' }],
  ]
  for (const [i, lines] of shapes.entries()) for (const timing of ['word', 'a', 'b']) {
    const input = timedFromLines(lines, 0.75), before = JSON.stringify(input), song = buildCut(input, timing)
    invariant(song)
    assert.equal(song.lines[0].time, 1.75)
    assert.equal(song.lines[0].timingSource, timing === 'word' && i < 2 ? 'data' : timing === 'b' ? 'syllables' : 'groups')
    if (timing === 'word' && i < 2) assert.equal(song.lines[0].words[0].start, 1.75)
    assert.equal(JSON.stringify(input), before)
  }
})
