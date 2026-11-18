const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createStore } = require('zustand/vanilla')

const root = path.join(__dirname, '..', 'src', 'renderer', 'src')

function loadQueueStore(saved = new Map()) {
  const sources = new Map()
  for (const file of ['lib/persist.ts', 'store/queuePersistence.ts', 'store/queueContext.ts', 'store/queueSlice.ts']) {
    sources.set(file, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)
  }
  const storage = new Map(saved)
  const localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  }
  const modules = new Map()
  const load = (file) => {
    if (modules.has(file)) return modules.get(file)
    const loaded = { exports: {} }
    const mockRequire = (name) => {
      const real = {
        '../lib/persist': 'lib/persist.ts',
        './queuePersistence': 'store/queuePersistence.ts',
        './queueContext': 'store/queueContext.ts',
      }[name]
      if (real) return load(real)
      if (name === '../lib/songPrefs') return { hasAnyDefaultVersion: () => false, hasAnyExcludedVersion: () => false }
      if (name === '../lib/compactGroups') return { groupPlaylistBySong: async () => [], pickSongVersions: async () => [] }
      if (name === '../lib/sessionEditLinksMirror') return { isSessionEditPlaceholder: (u) => !!u && u.startsWith('sessionedit://') }
      if (name === '../lib/userApi') return { trackIdToSongId: (id) => id.startsWith('jw-') ? Number(id.slice(3)) : null }
      if (name === '../lib/juicewrldApi') return { apiFetch: async () => ({ results: [] }), songToTrack: (s) => s }
      return {}
    }
    Function('require', 'module', 'exports', 'localStorage', 'window', 'document', 'queueMicrotask', 'console', sources.get(file))(
      mockRequire, loaded, loaded.exports, localStorage, Object.assign(new EventTarget(), { location: { search: '' } }), Object.assign(new EventTarget(), { visibilityState: 'visible' }), () => {}, console,
    )
    modules.set(file, loaded.exports)
    return loaded.exports
  }
  const { createQueueSlice } = load('store/queueSlice.ts')
  return createStore((set, get, api) => ({ ...createQueueSlice(set, get, api), preferOgVersion: false, currentTrackFull: null }))
}

function loadTrackerHandlePlay({ sortedSongs, isPlayableSong, songToTrack, playTrack, compactView = false, filteredCompactGroups = [] }) {
  const source = fs.readFileSync(path.join(root, 'components', 'ApiTrackerView.tsx'), 'utf8')
  const start = source.indexOf('  const playRequest = useRef(0)')
  const end = source.indexOf('  // Global infoSongId', start)
  const block = source.slice(start, end)
  const compiled = ts.transpileModule(`${block}\nglobalThis.handlePlay = handlePlay`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = vm.createContext({
    useRef: (v) => ({ current: v }),
    useCallback: (fn) => fn,
    playTrack,
    trackerTab: 'songs',
    sortedSongs,
    lyricsAll: [],
    selectedStudio: null,
    selectedDateKey: null,
    calendarByStudio: [],
    calendarByDate: new Map(),
    linkedCalendarSongs: [],
    selectedProducer: null,
    selectedEngineer: null,
    producersByName: [],
    engineersByName: [],
    compactView,
    filteredCompactGroups,
    isPlayableSong,
    songToTrack,
    isSessionEditPlaceholder: (u) => !!u && u.startsWith('sessionedit://'),
    showAppToast: () => {},
  })
  vm.runInContext(compiled, context)
  return context.handlePlay
}

test('catalogue list [A, B, C]: playing playable session B plays C next in normal order, never A', async () => {
  const store = loadQueueStore()
  const songA = { id: 1, name: 'Song A', category: 'unreleased', path: 'a.mp3' }
  const songB = { id: 2, name: 'Session B', category: 'recording_session', path: 'sessionedit://2' }
  const songC = { id: 3, name: 'Song C', category: 'unreleased', path: 'c.mp3' }

  const songToTrack = (s) => ({
    id: `jw-${s.id}`,
    title: s.name,
    artist: 'Juice WRLD',
    album: '',
    albumArtist: 'Juice WRLD',
    year: null,
    trackNumber: null,
    duration: 0,
    genre: s.category,
    hasAlbumArt: false,
    path: s.path,
    streamUrl: s.path,
  })

  // Even when songToTrack(B) still exposes sessionedit://2, B was verified playable by isPlayableSong
  // and must stay between A and C instead of being dropped and prepended by resolveQueueContext.
  const handlePlay = loadTrackerHandlePlay({
    sortedSongs: [songA, songB, songC],
    isPlayableSong: async (s) => s.id === 2 || !!s.path && !s.path.startsWith('sessionedit://'),
    songToTrack,
    playTrack: (...args) => store.getState().playTrack(...args),
  })

  await handlePlay(songB)

  assert.equal(store.getState().currentTrack?.id, 'jw-2')
  assert.deepEqual([...store.getState().queue.map((t) => t.id)], ['jw-2', 'jw-3'])

  const next = store.getState().nextTrack()
  assert.equal(next?.id, 'jw-3', 'Next after B must be C, never A')
  assert.equal(store.getState().nextTrack(), null)
})

test('catalogue list [A, B, C]: shuffle mode keeps A and C in the shuffle pool when playing B', async () => {
  const store = loadQueueStore(new Map([['unreleased:shuffle', 'true']]))
  const songA = { id: 1, name: 'Song A', category: 'unreleased', path: 'a.mp3' }
  const songB = { id: 2, name: 'Session B', category: 'recording_session', path: 'sessionedit://2' }
  const songC = { id: 3, name: 'Song C', category: 'unreleased', path: 'c.mp3' }
  const songToTrack = (s) => ({ id: `jw-${s.id}`, title: s.name, artist: 'Juice WRLD', album: '', albumArtist: '', year: null, trackNumber: null, duration: 0, genre: s.category, hasAlbumArt: false, path: s.path, streamUrl: s.path })

  const handlePlay = loadTrackerHandlePlay({
    sortedSongs: [songA, songB, songC],
    isPlayableSong: async () => true,
    songToTrack,
    playTrack: (...args) => store.getState().playTrack(...args),
  })

  await handlePlay(songB)

  const queuedIds = [...store.getState().queue.map((t) => t.id)]
  assert.equal(queuedIds[0], 'jw-2')
  assert.deepEqual(new Set(queuedIds), new Set(['jw-1', 'jw-2', 'jw-3']))
})

test('other queue callers (playlists/albums) preserve [A, B, C] order with next=C and prev=A', () => {
  const store = loadQueueStore()
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  store.getState().playTrack(tracks[1], tracks, null, 'playlist')
  assert.equal(store.getState().queueIndex, 1)
  assert.equal(store.getState().nextTrack()?.id, 'c')
  assert.equal(store.getState().prevTrack()?.id, 'b')
  assert.equal(store.getState().prevTrack()?.id, 'a')
})

test('unverified sessionedit:// markers on other songs are NOT treated as available in context or CompactGroupList', async () => {
  const store = loadQueueStore()
  const songA = { id: 1, name: 'Song A', category: 'unreleased', path: 'a.mp3' }
  const songB = { id: 2, name: 'Session B (unverified)', category: 'recording_session', path: 'sessionedit://2' }
  const songC = { id: 3, name: 'Song C', category: 'unreleased', path: 'c.mp3' }
  const songToTrack = (s) => ({ id: `jw-${s.id}`, title: s.name, artist: 'Juice WRLD', album: '', albumArtist: '', year: null, trackNumber: null, duration: 0, genre: s.category, hasAlbumArt: false, path: s.path, streamUrl: s.path })

  const handlePlay = loadTrackerHandlePlay({
    sortedSongs: [songA, songB, songC],
    isPlayableSong: async (s) => s.id === 1 || s.id === 3,
    songToTrack,
    playTrack: (...args) => store.getState().playTrack(...args),
  })

  await handlePlay(songA)
  // songB only had a bare sessionedit://2 marker without proven availability, so it is excluded from the queue
  assert.deepEqual([...store.getState().queue.map((t) => t.id)], ['jw-1', 'jw-3'])

  // CompactGroupList: if the presented lead member has no direct audio (empty or sessionedit://),
  // it must NOT silently substitute members[1].
  const source = fs.readFileSync(path.join(root, 'components', 'ApiTrackerView.tsx'), 'utf8')
  const cgStart = source.indexOf('function CompactGroupList(')
  const cgEnd = source.indexOf('\nfunction ', cgStart + 10)
  const cgSource = source.slice(cgStart, cgEnd)
  const compiled = ts.transpileModule(`${cgSource}\nglobalThis.CompactGroupList = CompactGroupList`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText

  const renderedProps = []
  const context = vm.createContext({
    exports: {},
    require: (id) => id === 'react/jsx-runtime'
      ? {
          jsx: (type, props) => { if (type === 'CompactGroupRow') renderedProps.push(props); return { type, props } },
          jsxs: (type, props) => ({ type, props }),
        }
      : {},
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useCascade: () => false,
    useScaledRowH: () => 52,
    useVirtualWindow: () => ({ start: 0, end: 3, totalHeight: 150 }),
    groupCategory: () => 'unreleased',
    hasDirectAudioPath: (s) => !!s.path && !s.path.startsWith('sessionedit://'),
    songTruth: () => ({ kindLabel: 'Unreleased' }),
    songToTrack,
    CompactGroupRow: 'CompactGroupRow',
    SongRow: 'SongRow',
    CATEGORY_LABELS: { unreleased: 'Unreleased' },
    CATEGORY_COLORS: { unreleased: '' },
  })
  vm.runInContext(compiled, context)

  const groups = [
    {
      groupId: 10,
      title: 'Unplayable lead + playable alt',
      members: [
        { item: { id: 101, name: 'Lead (no audio)', category: 'unsurfaced', path: '' }, meta: { version: 'v1' } },
        { item: { id: 102, name: 'Alt (has audio)', category: 'unreleased', path: 'alt.mp3' }, meta: { version: 'v2' } },
      ],
    },
    {
      groupId: 11,
      title: 'Session placeholder lead + playable alt',
      members: [
        { item: { id: 103, name: 'Session Lead', category: 'recording_session', path: 'sessionedit://103' }, meta: { version: 'Session' } },
        { item: { id: 104, name: 'Alt (has audio)', category: 'unreleased', path: 'alt2.mp3' }, meta: { version: 'v2' } },
      ],
    },
    {
      groupId: 12,
      title: 'Playable lead',
      members: [
        { item: { id: 105, name: 'Lead (playable)', category: 'unreleased', path: 'lead.mp3' }, meta: { version: 'v1' } },
        { item: { id: 106, name: 'Alt', category: 'unreleased', path: 'alt3.mp3' }, meta: { version: 'v2' } },
      ],
    },
  ]

  const played = []
  context.CompactGroupList({
    scrollRef: { current: null },
    groups,
    expanded: new Set(),
    onToggleGroup: () => {},
    onGroupContextMenu: () => {},
    onPlay: (s) => played.push(s.id),
    onCategoryClick: () => {},
    onEraClick: () => {},
    onInfo: () => {},
    onContextMenu: () => {},
    selectMode: false,
    selected: new Set(),
    onToggleSelect: () => {},
  })

  assert.equal(renderedProps.length, 3)
  // Group 10: lead has no audio -> coverTrack is lead, onPlay is undefined (never silently plays 102)
  assert.equal(renderedProps[0].coverTrack.id, 'jw-101')
  assert.equal(renderedProps[0].onPlay, undefined)
  // Group 11: lead only has sessionedit:// marker -> coverTrack is lead, onPlay is undefined
  assert.equal(renderedProps[1].coverTrack.id, 'jw-103')
  assert.equal(renderedProps[1].onPlay, undefined)
  // Group 12: lead has direct audio -> coverTrack is lead, onPlay plays 105
  assert.equal(renderedProps[2].coverTrack.id, 'jw-105')
  assert.equal(typeof renderedProps[2].onPlay, 'function')
  renderedProps[2].onPlay()
  assert.deepEqual(played, [105])
})
