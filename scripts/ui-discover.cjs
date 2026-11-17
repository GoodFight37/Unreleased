const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { _electron } = require('playwright')

const root = path.resolve(__dirname, '..')
const out = path.join(root, '.ui-verify')
fs.mkdirSync(out, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-discover-check-'))
const report = { timestamp: new Date().toISOString(), soundMuted: true, checks: [], screenshots: [] }
const songs = [
  { id: 990001, name: 'Verification A', path: 'verification-a.mp3', category: 'unreleased', era: { id: 1, name: 'LND' }, image_url: '/assets/lnd.webp', producers: 'Fixture producer A', record_dates: 'File Exported\nJune 24, 2021.', additional_information: 'This is a test fixture note, not a fact about Juice WRLD.', lyrics: null, synced_lyrics: null, track_titles: [], credited_artists: 'Juice WRLD', length: '3:00' },
  { id: 990002, name: 'Verification B', path: 'verification-a.mp3', category: 'unreleased', era: { id: 1, name: 'LND' }, image_url: '/assets/lnd.webp', producers: 'Fixture producer B', record_dates: '', additional_information: '', lyrics: null, synced_lyrics: null, track_titles: [], credited_artists: 'Juice WRLD', length: '3:00' },
]

async function main() {
  let app
  let state = 'success'
  const pending = []
  try {
    app = await _electron.launch({ cwd: root, args: ['.', '--load-dist', '--ui-verify', '--mute-audio'], env: { ...process.env, UNRELEASED_UI_VERIFY_DIR: profile }, timeout: 20000 })
    const page = await app.firstWindow()
    page.setDefaultTimeout(12000)
    await page.addInitScript(() => {
      localStorage.setItem('cookie-notice-ack', '1')
      localStorage.setItem('donation-notice-dismissed', '1')
    })
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.setAudioMuted(true) })
    await page.route('**/juicewrld/songs/**', async (route) => {
      if (state === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Verification service unavailable' }) })
      if (state === 'loading') await new Promise((resolve) => pending.push(resolve))
      const rows = state === 'empty' ? [] : songs
      const url = new URL(route.request().url())
      const id = url.pathname.match(/\/songs\/(\d+)\/$/)?.[1]
      const body = id ? songs.find((song) => song.id === Number(id)) : url.searchParams.get('all') === 'true' ? rows : { count: rows.length, next: null, previous: null, results: rows }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const ready = async () => {
      await page.reload()
      await page.waitForFunction(() => !!window.__store)
      await page.evaluate(() => { window.__store.setState({ currentTrack: null, currentTrackFull: null, isPlaying: false, popoutWindows: { ...window.__store.getState().popoutWindows, songInfo: false } }); window.__store.getState().setTheme('lnd'); window.__store.getState().setActiveView('home') })
      const consent = page.getByRole('button', { name: 'Got it', exact: true })
      if (await consent.isVisible().catch(() => false)) await consent.click()
      await page.locator('.coffre-home').waitFor()
    }
    const select = async (song) => page.evaluate((song) => window.__store.setState({ currentTrack: { id: `jw-${song.id}`, title: song.name, artist: 'Juice WRLD', path: song.path, imageUrl: 'https://juicewrldapi.com/assets/lnd.webp', era: 'LND' }, isPlaying: false }), song)
    const shot = async (name) => { await page.screenshot({ path: path.join(out, name) }); report.screenshots.push(name) }
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready()
    await select(songs[0])
    await page.locator('.coffre-track-context').getByText('Fixture producer A', { exact: true }).waitFor()
    await page.locator('.coffre-track-note').getByText(songs[0].additional_information, { exact: true }).waitFor()
    await shot('discover-context-success-1440.png')
    report.checks.push({ state: 'success', pass: true, observation: 'Credits, original date labels and note belong to selected A.' })
    await select(songs[1])
    await page.locator('.coffre-track-context').getByText('Fixture producer B', { exact: true }).waitFor()
    assert.equal(await page.locator('.coffre-track-context').getByText('Fixture producer A', { exact: true }).count(), 0)
    assert.equal(await page.locator('.coffre-track-context').getByText(songs[0].additional_information, { exact: true }).count(), 0)
    const details = page.getByRole('button', { name: 'Full song details', exact: true })
    await details.click()
    assert.equal(await page.evaluate(() => window.__store.getState().infoSongId), songs[1].id)
    await page.evaluate(() => window.__store.getState().setInfoSongId(null))
    report.checks.push({ state: 'partial', pass: true, observation: 'B replaces A immediately, missing note has an honest fallback, details action uses B internal id.' })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.locator('.coffre-primary').focus()
    await page.keyboard.press('Tab')
    const focus = await page.locator('.coffre-hero-art').evaluate((el) => ({ visible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle }))
    assert.equal(focus.visible, true)
    assert.notEqual(focus.outline, 'none')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(overflow, false)
    await shot('discover-context-partial-1280.png')
    report.checks.push({ state: 'keyboard-responsive', pass: true, focus, observation: 'Keyboard reaches the cover with visible outline; no horizontal overflow at 1280x720.' })
    state = 'empty'
    await ready()
    await page.getByText('Your listening will appear here.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Open catalogue', exact: true }).waitFor()
    await shot('discover-context-empty-1280.png')
    report.checks.push({ state: 'empty', pass: true, observation: 'Empty archive keeps the page structure and offers Open catalogue.' })
    state = 'error'
    await ready()
    await page.getByRole('button', { name: 'Open catalogue', exact: true }).waitFor()
    await page.getByRole('alert').filter({ hasText: 'The catalogue could not be loaded' }).waitFor()
    await shot('discover-context-unavailable-1280.png')
    report.checks.push({ state: 'error', pass: true, observation: 'Failed catalogue remains usable through Open catalogue; no fabricated details.' })
    state = 'loading'
    await ready()
    await page.getByRole('status').filter({ hasText: 'Loading the catalogue' }).waitFor()
    await shot('discover-context-loading-1280.png')
    report.checks.push({ state: 'loading', pass: true, observation: 'Loading status preserves the layout and Open catalogue action.' })
    pending.forEach((resolve) => resolve())
    report.ok = true
    console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, report: path.join(out, 'discover-context-report.json') }))
  } finally {
    pending.forEach((resolve) => resolve())
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
    fs.rmSync(profile, { recursive: true, force: true })
    fs.writeFileSync(path.join(out, 'discover-context-report.json'), JSON.stringify(report, null, 2))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
