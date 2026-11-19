const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../src/renderer/src')

function load(file, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}

const apiFile = ts.createSourceFile('juicewrldApi.ts', readFileSync(path.join(root, 'lib/juicewrldApi.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const helpers = apiFile.statements
  .filter((n) => ts.isFunctionDeclaration(n) && ['normalizeForSearch', 'parseDuration'].includes(n.name?.text))
  .map((n) => n.getText(apiFile))
  .join('\n')
const api = {}
Function('exports', ts.transpileModule(helpers, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(api)

const musicVideos = load('lib/musicVideos.ts', {
  './juicewrldApi': api,
  './apiClient': { isAbortError: () => false },
  './userApi': { trackIdToSongId: () => null },
  './videoSync': { alignMusicVideo: () => null },
  './musicVideoDefaultsApi': { getMusicVideoDefaults: async () => new Map() },
})

const onThisDay = load('lib/onThisDay.ts', {
  './juicewrldApi': api,
  './apiTrackerShared': { MIN_PLAUSIBLE_RECORD_YEAR: 2014 },
})

const {
  classifyFootageEntry,
  excludedFootageReason,
  parseFreestyleName,
  buildFootageSongIndex,
  linkFootageToCatalogue,
  scoreStudioFootage,
  formatFootageMenuLabel,
  createAudibleVideoGate,
  buildVideoTitleKeySet,
  songHasVideoMatch,
  videoHasNoSound,
  footageSourceOf,
} = load('lib/footageCatalog.ts', {
  './juicewrldApi': api,
  './musicVideos': musicVideos,
  './onThisDay': onThisDay,
})

test('classifyFootageEntry separates studio, freestyle, official clips and snippets, excluding audio uploads and sessions', () => {
  assert.equal(classifyFootageEntry({ path: 'Footage/Condone It (Studio Session) [Part 1].mp4', name: 'Condone It (Studio Session) [Part 1].mp4', type: 'file' }), 'studio')
  assert.equal(classifyFootageEntry({ path: 'Footage/Freestyles/2018-12-19 3 Condone It Freestyle - Chris Long.mp4', name: '2018-12-19 3 Condone It Freestyle - Chris Long.mp4', type: 'file' }), 'freestyle')
  assert.equal(classifyFootageEntry({ path: 'Footage/Youtube/2024/2024-12-02/Juice WRLD - Cuffed (Official Music Video).mp4', name: 'Juice WRLD - Cuffed (Official Music Video).mp4', type: 'file' }), 'official')
  assert.equal(classifyFootageEntry({ path: 'Snippets/9. Death Race For Love/Condone It/clip1.mp4', name: 'clip1.mp4', type: 'file' }), 'snippet')

  // Static YouTube uploads and session archives are NOT footage
  assert.equal(classifyFootageEntry({ path: 'Footage/Youtube/2024/2024-11-29/Juice WRLD - Condone It (Official Audio).mp4', name: 'Juice WRLD - Condone It (Official Audio).mp4', type: 'file' }), null)
  assert.equal(classifyFootageEntry({ path: 'Footage/Youtube/2021/2021-12-10/Juice WRLD - Burn (Official Visualizer).mp4', name: 'Juice WRLD - Burn (Official Visualizer).mp4', type: 'file' }), null)
  assert.equal(classifyFootageEntry({ path: 'Footage/Youtube/2020/2020-07-10/Juice WRLD - Wishing Well (Lyric Video).mp4', name: 'Juice WRLD - Wishing Well (Lyric Video).mp4', type: 'file' }), null)
  assert.equal(classifyFootageEntry({ path: 'Studio Sessions/Condone It.zip', name: 'Condone It.zip', type: 'file' }), null)
})

test('excludedFootageReason blocks rights-unclarified films and heavy files', () => {
  assert.equal(excludedFootageReason({ path: 'Footage/Music Box Juice WRLD Into the Abyss.mp4', name: 'Music Box Juice WRLD Into the Abyss.mp4', size: 100_000 }), 'rights')
  assert.equal(excludedFootageReason({ path: 'Footage/Extra (Full Session Recording).mp4', name: 'Extra (Full Session Recording).mp4', size: 900_000_000 }), 'size')
  assert.equal(excludedFootageReason({ path: 'Footage/Long.mp4', name: 'Long.mp4', duration: '1:05:00' }), 'size')
  assert.equal(excludedFootageReason({ path: 'Footage/Condone It (Studio Session) [Part 1].mp4', name: 'Condone It (Studio Session) [Part 1].mp4', size: 428_000_000, duration: '29:52' }), null)
})

test('parseFreestyleName extracts file date, title and participant names without claiming who filmed', () => {
  assert.deepEqual(
    { ...parseFreestyleName('2018-12-19 3 Condone It Freestyle - Make Believe - Chris Long.mp4') },
    { title: 'Condone It Freestyle', date: '2018-12-19', with: ['Make Believe', 'Chris Long'] },
  )
  assert.deepEqual(
    { ...parseFreestyleName('2018-07-16 14 Ski Mask the Slump God - DJ Scheme - Freestyle.mp4') },
    { title: 'Ski Mask the Slump God', date: '2018-07-16', with: ['DJ Scheme'] },
  )
})

test('linkFootageToCatalogue enforces 3-level certainty and rejects conflicting dates', () => {
  const songs = [
    {
      id: 96368,
      name: 'Condone It',
      track_titles: [],
      record_dates: 'Recorded\nDecember 19, 2018.',
      era: { name: 'DRFL' },
    },
    {
      id: 95090,
      name: 'Condone It (v1)',
      track_titles: [],
      record_dates: 'Recorded\nDecember 19, 2018.',
      era: { name: 'DRFL' },
    },
    {
      id: 95407,
      name: 'Keep Save',
      track_titles: ['Murder Rate'],
      record_dates: null,
      era: { name: 'OUT' },
    },
    {
      id: 95214,
      name: 'Rental (Cha Ching) [v1]',
      track_titles: [],
      record_dates: null,
      era: { name: 'DRFL' },
    },
    {
      id: 94210,
      name: 'Run',
      track_titles: [],
      record_dates: null,
      era: { name: 'DRFL' },
    },
  ]
  const idx = buildFootageSongIndex(songs)

  // 1. Title + matching recording date -> 'title+date'
  const m1 = linkFootageToCatalogue({
    path: 'Footage/Freestyles/2018-12-19 3 Condone It Freestyle - Make Believe - Chris Long.mp4',
    name: '2018-12-19 3 Condone It Freestyle - Make Believe - Chris Long.mp4',
  }, idx)
  assert.deepEqual({ ...m1 }, {
    level: 'title+date', via: 'name', name: 'Condone It', entries: 2, id: 96368, era: 'DRFL',
  })

  // 2. Title with a CONFLICTING file date -> rejected (null)
  const conflict = linkFootageToCatalogue({
    path: 'Footage/Freestyles/2019-05-10 1 Condone It Freestyle.mp4',
    name: '2019-05-10 1 Condone It Freestyle.mp4',
  }, idx)
  assert.equal(conflict, null)

  // 3. Declared catalogue alias -> 'title' with via: 'alias'
  const aliasMatch = linkFootageToCatalogue({
    path: 'Footage/Murder Rate (Studio Session) [Part 1].mp4',
    name: 'Murder Rate (Studio Session) [Part 1].mp4',
  }, idx)
  assert.deepEqual({ ...aliasMatch }, {
    level: 'title', via: 'alias', name: 'Keep Save', entries: 1, id: 95407, era: 'OUT',
  })

  // 4. Base title only -> 'possible'
  const possible = linkFootageToCatalogue({
    path: 'Footage/Freestyles/2018-11-10 15 Rental Freestyle.mp4',
    name: '2018-11-10 15 Rental Freestyle.mp4',
  }, idx)
  assert.equal(possible.level, 'possible')
  assert.equal(possible.via, 'base')

  // 5. Short generic title (< 5 chars) rejected on ambiguous freestyle, allowed on explicit Studio Session
  assert.equal(linkFootageToCatalogue({
    path: 'Footage/Freestyles/2019-02-01 1 Run Freestyle.mp4',
    name: '2019-02-01 1 Run Freestyle.mp4',
  }, idx), null)
  assert.equal(linkFootageToCatalogue({
    path: 'Footage/RUN (Studio Session).mp4',
    name: 'RUN (Studio Session).mp4',
  }, idx)?.level, 'title')
})

test('createAudibleVideoGate enforces one audible source at a time without resuming manually paused music', () => {
  let playing = true
  let videoPaused = 0
  const gate = createAudibleVideoGate({
    isMusicPlaying: () => playing,
    setMusicPlaying: (next) => { playing = next },
    pauseActiveVideo: () => { videoPaused++ },
  })

  // 1. Opening a video while music plays pauses the music and resumes it on close
  gate.videoWillPlay()
  assert.equal(playing, false)
  assert.equal(gate.isMusicPausedByVideo(), true)
  gate.videoDidClose()
  assert.equal(playing, true)

  // 2. If user presses play on the music while the video is open, the video pauses and closing the video does not override the user's choice
  gate.videoWillPlay()
  assert.equal(playing, false)
  playing = true
  gate.musicTouched()
  assert.equal(videoPaused, 1)
  playing = false // user then pauses music manually
  gate.videoDidClose()
  assert.equal(playing, false)

  // 3. If music was already paused before the video opened, closing the video leaves music paused
  playing = false
  gate.videoWillPlay()
  gate.videoDidClose()
  assert.equal(playing, false)
})

test('createAudibleVideoGate pauses and resumes 999 FM radio without touching music', () => {
  let musicPlaying = false
  let radioPlaying = true
  let radioStarts = 0
  let radioStops = 0
  const gate = createAudibleVideoGate({
    isMusicPlaying: () => musicPlaying,
    setMusicPlaying: (next) => { musicPlaying = next },
    isRadioPlaying: () => radioPlaying,
    setRadioPlaying: (next) => {
      radioPlaying = next
      if (next) radioStarts++
      else radioStops++
    },
  })

  // Radio -> video -> close -> radio resumes live, music stays off
  gate.videoWillPlay()
  assert.equal(radioPlaying, false)
  assert.equal(radioStops, 1)
  assert.equal(musicPlaying, false)
  assert.equal(gate.isMusicPausedByVideo(), true)

  gate.videoDidClose()
  assert.equal(radioPlaying, true)
  assert.equal(radioStarts, 1)
  assert.equal(musicPlaying, false)
  assert.equal(gate.isMusicPausedByVideo(), false)
})

test('createAudibleVideoGate Watch flow pauses music and resumes on close, cancelling on manual touch', () => {
  let musicPlaying = true
  let radioPlaying = false
  let videoPaused = 0
  const gate = createAudibleVideoGate({
    isMusicPlaying: () => musicPlaying,
    setMusicPlaying: (next) => { musicPlaying = next },
    isRadioPlaying: () => radioPlaying,
    setRadioPlaying: (next) => { radioPlaying = next },
    pauseActiveVideo: () => { videoPaused++ },
  })

  // Music -> Watch -> music paused then resumed
  gate.videoWillPlay()
  assert.equal(musicPlaying, false)
  assert.equal(radioPlaying, false)
  assert.equal(gate.isMusicPausedByVideo(), true)

  gate.videoDidClose()
  assert.equal(musicPlaying, true)
  assert.equal(radioPlaying, false)

  // Manual radio or music action during video -> no auto-resume on close
  radioPlaying = true
  musicPlaying = false
  gate.videoWillPlay()
  assert.equal(radioPlaying, false)
  assert.equal(gate.isMusicPausedByVideo(), true)

  radioPlaying = true
  gate.musicTouched()
  assert.equal(videoPaused, 1)
  assert.equal(gate.isMusicPausedByVideo(), false)

  radioPlaying = false
  gate.videoDidClose()
  assert.equal(radioPlaying, false)
  assert.equal(musicPlaying, false)
})

test('formatFootageMenuLabel separates studio footage from snippets and omits rights-blocked items', () => {
  assert.equal(formatFootageMenuLabel([
    { entry: { path: 'Footage/Music Box Juice WRLD Into the Abyss.mp4', name: 'Music Box Juice WRLD Into the Abyss.mp4' } },
  ]), null)
  assert.equal(formatFootageMenuLabel([
    { entry: { path: 'Footage/Condone It (Studio Session) [Part 1].mp4', name: 'Condone It (Studio Session) [Part 1].mp4' } },
    { entry: { path: 'Footage/Freestyles/2018-12-19 3 Condone It Freestyle.mp4', name: '2018-12-19 3 Condone It Freestyle.mp4' } },
  ]), 'Watch footage (2)')
  assert.equal(formatFootageMenuLabel([
    { entry: { path: 'Snippets/9. Death Race For Love/Condone It/clip1.mp4', name: 'clip1.mp4' } },
  ]), 'Watch snippets (1)')
  assert.equal(formatFootageMenuLabel([
    { entry: { path: 'Footage/Condone It (Studio Session) [Part 1].mp4', name: 'Condone It (Studio Session) [Part 1].mp4' } },
    { entry: { path: 'Snippets/9. Death Race For Love/Condone It/clip1.mp4', name: 'clip1.mp4' } },
    { entry: { path: 'Snippets/9. Death Race For Love/Condone It/clip2.mp4', name: 'clip2.mp4' } },
  ]), 'Watch footage (1 studio · 2 snippets)')
})

test('sameDateAndStudio finds other songs sharing a recorded date and studio without claiming same session', () => {
  const target = {
    id: 1,
    name: 'Condone It (v1)',
    category: 'unreleased',
    path: 'a.mp3',
    record_dates: 'Recorded\nDecember 19, 2018.',
    recording_locations: 'Blue Room West\nLos Angeles, CA',
  }
  const all = [
    target,
    { id: 2, name: 'Condone It (v2)', category: 'unreleased', path: 'b.mp3', record_dates: 'Recorded\nDecember 19, 2018.', recording_locations: 'Blue Room West' },
    { id: 3, name: 'Syphilis', category: 'released', path: 'c.mp3', record_dates: 'Recorded\nDecember 19, 2018.', recording_locations: 'Blue Room West' },
    { id: 4, name: 'Other Day', category: 'unreleased', path: 'd.mp3', record_dates: 'Recorded\nDecember 20, 2018.', recording_locations: 'Blue Room West' },
    { id: 5, name: 'Other Studio', category: 'unreleased', path: 'e.mp3', record_dates: 'Recorded\nDecember 19, 2018.', recording_locations: 'Home Studio Encino' },
    { id: 6, name: 'Export Only', category: 'unreleased', path: 'f.mp3', record_dates: 'File Exported\nDecember 19, 2018.', recording_locations: 'Blue Room West' },
  ]
  const matches = onThisDay.sameDateAndStudio(target, all)
  assert.deepEqual(matches.map((s) => s.id), [3])
})

test('buildVideoTitleKeySet and songHasVideoMatch exclude rights-blocked videos and YouTube audio uploads', () => {
  const keys = buildVideoTitleKeySet([
    { path: 'Footage/Music Box Juice WRLD Into the Abyss.mp4', name: 'Music Box Juice WRLD Into the Abyss.mp4', type: 'file' },
    { path: 'Footage/Youtube/2020/2020-07-10/Juice WRLD - Wishing Well (Official Audio).mp4', name: 'Juice WRLD - Wishing Well (Official Audio).mp4', type: 'file' },
    { path: 'Snippets/9. Death Race For Love/Condone It/clip.mp4', name: 'clip.mp4', type: 'file' },
  ])
  assert.equal(songHasVideoMatch({ name: 'Condone It (v1)' }, keys), true)
  assert.equal(songHasVideoMatch({ name: 'Wishing Well' }, keys), false)
  assert.equal(songHasVideoMatch({ name: 'Music Box Juice WRLD Into the Abyss' }, keys), false)
})

test('videoHasNoSound only flags a playing, unmuted video that decoded no audio', () => {
  const base = { muted: false, paused: false, currentTime: 3, webkitAudioDecodedByteCount: 0 }
  assert.equal(videoHasNoSound(base), true)
  assert.equal(videoHasNoSound({ ...base, webkitAudioDecodedByteCount: 4096 }), false)
  assert.equal(videoHasNoSound({ ...base, muted: true }), false)
  assert.equal(videoHasNoSound({ ...base, paused: true }), false)
  assert.equal(videoHasNoSound({ ...base, currentTime: 0.5 }), false)
  assert.equal(videoHasNoSound({ muted: false, paused: false, currentTime: 3 }), false)
})

test('footageSourceOf preserves original files and channels so server corrections are not masked', () => {
  for (const path of [
    'Footage/Flex (with Polo G).mp4',
    'Footage/No Laces.mp4',
    'Footage/Prime Time.mp4',
    'Footage/Doubting Me.mp4',
    'Footage/Doubting Me (Studio Session).mp4',
    'Footage/Doubting Me [Part 1].mp4',
    'Footage/Doubting Me [Part 2].mp4',
  ]) {
    assert.deepEqual(footageSourceOf(path), { path, channel: undefined })
    assert.deepEqual(footageSourceOf(path, 'comp'), { path, channel: 'comp' })
  }
  assert.deepEqual(footageSourceOf('Snippets/No Laces/No Laces (1).mov', 'legacy'), { path: 'Snippets/No Laces/No Laces (1).mov', channel: 'legacy' })
})
