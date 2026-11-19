// Motion audit: launches the built app (isolated, like ui-verify), plays the
// common gestures one by one and records every animation that actually runs
// (CSS animations, CSS transitions, Element.animate) with its real duration,
// delay, easing and target. Writes .ui-verify/motion-audit.json and prints a
// table. Run: node scripts/motion-audit.mjs  (needs dist/, see npm run build)
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.ui-verify', 'motion-audit.json')

// Runs in the page: polls document.getAnimations() every frame while a step is
// recording, so even 100 ms animations are caught, each one once.
function installRecorder() {
  const seen = new WeakSet()
  let step = null
  let rows = []
  const describe = (el) => {
    if (!(el instanceof Element)) return String(el)
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || ''
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${label ? ` [${label.slice(0, 30)}]` : ''}`
  }
  const frame = () => {
    if (!step) return
    for (const a of document.getAnimations()) {
      if (seen.has(a)) continue
      seen.add(a)
      const effect = a.effect
      const t = effect?.getTiming?.() ?? {}
      let frames = []
      try { frames = effect?.getKeyframes?.() ?? [] } catch {}
      const pick = (f) => (f ? ['transform', 'opacity', 'scale', 'translate', 'filter'].filter((k) => f[k] != null).map((k) => `${k}:${f[k]}`).join(' ') : '')
      rows.push({
        step,
        kind: a.constructor.name,
        name: a.animationName || a.transitionProperty || '(animate)',
        duration: typeof t.duration === 'number' ? Math.round(t.duration) : t.duration,
        delay: Math.round(t.delay ?? 0),
        // CSS animations carry their curve on the keyframes; the effect timing then says 'linear'.
        easing: [...frames.map((f) => f.easing), t.easing].find((e) => e && e !== 'linear') ?? 'linear',
        iterations: t.iterations,
        from: pick(frames[0]),
        to: pick(frames[frames.length - 1]),
        target: describe(effect?.target),
      })
    }
    requestAnimationFrame(frame)
  }
  window.__motion = {
    start(name) { step = name; requestAnimationFrame(frame) },
    stop() { step = null; const out = rows; rows = []; return out },
  }
}

const main = async () => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ missing: run npm run build first')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'unreleased-motion-audit-'))
  const app = await electron.launch({
    args: ['.', '--load-dist', '--ui-verify', '--no-sandbox', '--mute-audio', '--window-position=-1920,-57', '--window-size=1920,1080'],
    cwd: ROOT,
    env: { ...process.env, UNRELEASED_UI_VERIFY_DIR: userData },
    timeout: 20_000,
  })
  const all = []
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.setPosition(-1920, -57)
    })
    const win = await app.firstWindow({ timeout: 15_000 })
    await win.setViewportSize({ width: 1280, height: 800 })
    await win.waitForFunction(() => Boolean(window.__store), { timeout: 15_000 })
    await win.evaluate(installRecorder)
    // A playing local track so the player, queue and WRLD have something to show.
    await win.evaluate(() => {
      const track = { id: 'local-C:\\Music\\a.flac', path: 'C:\\Music\\a.flac', title: 'Lucid Liquid', artist: 'Juice WRLD', album: 'Legends Never Die', duration: 185, imageUrl: null }
      window.__store.getState().setTheme('glass-dark')
      window.__store.setState({ currentTrack: track, currentTrackFull: { ...track, ext: 'flac', lyrics: null, syncedLyrics: null }, queue: [track], queueIndex: 0, isPlaying: false, activeView: 'home' })
    })
    await win.waitForTimeout(1200)

    const record = async (name, act, settleMs = 900) => {
      await win.evaluate((n) => window.__motion.start(n), name)
      try { await act() } catch (err) { all.push({ step: name, error: String(err?.message ?? err).slice(0, 120) }) }
      await win.waitForTimeout(settleMs)
      all.push(...await win.evaluate(() => window.__motion.stop()))
    }
    const store = (fn) => win.evaluate(fn)

    await record('tab: Home -> Tracker', () => store(() => window.__store.getState().setActiveView('api-tracker')), 1400)
    await record('tab: Tracker -> Files', () => store(() => window.__store.getState().setActiveView('api-files')))
    await record('tab: Files -> Playlists', () => store(() => window.__store.getState().setActiveView('playlists')))
    await record('nav: hover + press Discover', async () => {
      const btn = win.locator('.app-sidebar button[aria-label="Discover"]').first()
      await btn.hover(); await win.mouse.down(); await win.waitForTimeout(150); await win.mouse.up()
    })
    await record('play/pause toggle', async () => {
      await store(() => window.__store.setState({ isPlaying: true })); await win.waitForTimeout(400)
      await store(() => window.__store.setState({ isPlaying: false }))
    })
    await record('palette: Ctrl+K open', () => win.keyboard.press('Control+K'))
    await record('palette: Escape close', () => win.keyboard.press('Escape'))
    await record('menu ≡ open', () => win.locator('button[title="Menu"] >> visible=true').first().click())
    await record('menu ≡ close', () => win.keyboard.press('Escape'))
    await record('settings open', () => store(() => window.__store.setState({ showSettings: true })), 1200)
    await record('settings tab switch', () => win.locator('button:has-text("Playback & sound") >> visible=true').first().click({ force: true }))
    await record('settings close', () => store(() => window.__store.setState({ showSettings: false })))
    await record('queue panel toggle', async () => {
      await store(() => window.__store.setState({ showQueue: true })); await win.waitForTimeout(700)
      await store(() => window.__store.setState({ showQueue: false }))
    }, 1000)
    await record('catalogue era filter', async () => {
      await store(() => window.__store.getState().setActiveView('api-tracker')); await win.waitForTimeout(900)
      await win.locator('button[title="Filters"]').click()
      const allEras = win.getByRole('button', { name: 'All eras', exact: true })
      await allEras.waitFor({ timeout: 10_000 })
      await allEras.locator('..').getByRole('button').nth(1).click()
      await win.keyboard.press('Escape')
    })
    await record('theme Dark -> Light', () => store(() => window.__store.getState().setTheme('glass-light')), 1200)
    await record('adaptive cover playing + WRLD', async () => {
      await store(() => {
        const c = document.createElement('canvas')
        c.width = 64; c.height = 64
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#f2b13c'; ctx.fillRect(0, 0, 64, 38)
        ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 38, 64, 26)
        const goldBlue = c.toDataURL('image/png')
        const trk = { ...window.__store.getState().currentTrack, imageUrl: goldBlue }
        window.__store.getState().setTheme('glass-dark')
        window.__store.getState().setAdaptiveColors(true)
        window.__store.setState({ currentTrack: trk, currentTrackFull: { ...window.__store.getState().currentTrackFull, albumArt: goldBlue }, isPlaying: true })
        window.__store.getState().setActiveView('wrld')
      })
    }, 1500)
    await record('game mode pauses continuous loops', async () => {
      await store(() => {
        localStorage.setItem('unreleased.effects-quality', 'game')
        window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.effects-quality', newValue: 'game', storageArea: localStorage }))
      })
      await win.waitForTimeout(350)
      await store(() => {
        localStorage.setItem('unreleased.effects-quality', 'full')
        window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.effects-quality', newValue: 'full', storageArea: localStorage }))
      })
    }, 700)
  } finally {
    await app.close().catch(() => {})
    fs.rmSync(userData, { recursive: true, force: true })
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2))
  const flag = (r) => [
    typeof r.duration === 'number' && r.iterations === 1 && r.duration + r.delay > 300 ? '>300ms' : '',
    /ease-in(?!-out)|cubic-bezier\(0\.[3-9]\d*, 0, 1, 1\)/.test(r.easing ?? '') ? 'ease-in' : '',
    /scale\(0\)|scale:0\b/.test(r.from ?? '') ? 'scale(0)' : '',
  ].filter(Boolean).join(' ')
  for (const r of all) {
    if (r.error) { console.log(`${r.step} | ERROR ${r.error}`); continue }
    console.log(`${r.step} | ${r.kind} ${r.name} | ${r.duration}ms+${r.delay} x${r.iterations} | ${r.easing} | ${r.from} -> ${r.to} | ${r.target} | ${flag(r)}`)
  }
  console.log(`\n${all.length} rows -> ${path.relative(ROOT, OUT)}`)
  if (all.some((row) => row.error)) throw new Error('Motion audit has failed scenarios; see motion-audit.json')
}

main().catch((err) => { console.error('[motion-audit]', err); process.exitCode = 1 })
