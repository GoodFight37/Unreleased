import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html')
const OUT_DIR = path.join(ROOT, '.ui-verify')
const REPORT_PATH = path.join(OUT_DIR, 'report.json')
const HARD_TIMEOUT_MS = 120_000

const IGNORED_CONSOLE_RE = /(?:ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|Failed to load resource|Failed to fetch|NetworkError|api2?\.juicewrldapi\.com|discord\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|status of 4\d\d|status of 5\d\d)/i

function newestMtime(dir) {
  let latest = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) latest = Math.max(latest, newestMtime(full))
    else latest = Math.max(latest, fs.statSync(full).mtimeMs)
  }
  return latest
}

function ensureDistBuilt() {
  const forceBuild = process.argv.includes('--build')
  const distTime = fs.existsSync(DIST_INDEX) ? fs.statSync(DIST_INDEX).mtimeMs : 0
  const srcTime = Math.max(
    newestMtime(path.join(ROOT, 'src')),
    newestMtime(path.join(ROOT, 'electron')),
    fs.statSync(path.join(ROOT, 'package.json')).mtimeMs,
  )
  if (!forceBuild && distTime > 0 && distTime >= srcTime) {
    return { rebuilt: false }
  }
  console.log('[ui:verify] Compilation de dist/ via npm run build...')
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
  return { rebuilt: true }
}

async function dismissNotices(page) {
  const consent = page.getByRole('button', { name: 'Got it', exact: true })
  if (await consent.isVisible().catch(() => false)) {
    await consent.click()
    await page.waitForTimeout(250)
  }
  const donation = page.locator('.fixed.bottom-0 button[title="Dismiss"]')
  if (await donation.isVisible().catch(() => false)) {
    await donation.click()
    await page.waitForTimeout(200)
  }
}

async function runLayoutSensors(page, scenario) {
  return page.evaluate((scenarioName) => {
    const parseColor = (str) => {
      if (!str || str === 'transparent') return [0, 0, 0, 0]
      const srgb = str.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/i)
      if (srgb) {
        const alpha = srgb[4] === undefined ? 1 : Number(srgb[4]) / (srgb[5] ? 100 : 1)
        return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, alpha]
      }
      const m = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%)?)?\s*\)/i)
      if (!m) return null
      const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1)
      return [Number(m[1]), Number(m[2]), Number(m[3]), alpha]
    }
    const over = (fg, bg) => {
      const a = fg[3] ?? 1
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
    }
    const lin = (c) => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luma = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const contrast = (c1, c2) => {
      const l1 = luma(c1)
      const l2 = luma(c2)
      const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
      return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
    }
    const rectOf = (el) => {
      if (!el) return null
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const intersect = (a, b) => {
      if (!a || !b) return 0
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      return x * y
    }

    const firstVisible = (selector) => Array.from(document.querySelectorAll(selector)).find((el) => rectOf(el) !== null) ?? null

    const darkTheme = document.documentElement.classList.contains('dark')
    const overlaps = []
    const textOverflows = []
    const contrasts = []

    const sidebar = firstVisible('.app-sidebar')
    const player = firstVisible('.app-player')
    const searchInputs = Array.from(document.querySelectorAll('input[type="search"], input[placeholder*="Search" i], input[placeholder*="Recherch" i], input[placeholder*="Filter" i]'))
    const rSidebar = rectOf(sidebar)
    const rPlayer = rectOf(player)

    if (rSidebar && rPlayer && intersect(rSidebar, rPlayer) > 2) {
      overlaps.push({ pair: 'sidebar vs player', area: Math.round(intersect(rSidebar, rPlayer)) })
    }
    for (const inp of searchInputs) {
      const rInp = rectOf(inp)
      if (!rInp) continue
      if (rSidebar && intersect(rSidebar, rInp) > 2) {
        overlaps.push({ pair: 'sidebar vs searchInput', area: Math.round(intersect(rSidebar, rInp)) })
      }
      if (rPlayer && intersect(rPlayer, rInp) > 2) {
        overlaps.push({ pair: 'player vs searchInput', area: Math.round(intersect(rPlayer, rInp)) })
      }
    }

    // Glass surface pairwise overlap check inside <main> (catches stale/overlapping view transitions)
    const mainEl = document.querySelector('main')
    if (mainEl) {
      const viewPanes = Array.from(mainEl.querySelectorAll('.glass-pane:not(.glass-pane .glass-pane)'))
        .filter((el) => !el.classList.contains('app-sidebar') && !el.closest('.glab-overlay'))
        .map((el) => ({ el, r: rectOf(el) }))
        .filter((x) => x.r)
      for (let i = 0; i < viewPanes.length; i++) {
        for (let j = i + 1; j < viewPanes.length; j++) {
          const area = intersect(viewPanes[i].r, viewPanes[j].r)
          if (area > 4) {
            overlaps.push({ pair: `view glass-pane ${i} vs ${j}`, area: Math.round(area) })
          }
        }
      }
      const viewControls = Array.from(mainEl.querySelectorAll('.glass-seg:not(.glass-pane .glass-seg), .glass-field:not(.glass-pane .glass-field)'))
        .filter((el) => !el.closest('.glab-overlay'))
        .map((el) => ({ el, r: rectOf(el) }))
        .filter((x) => x.r)
      for (let i = 0; i < viewControls.length; i++) {
        for (let j = i + 1; j < viewControls.length; j++) {
          const area = intersect(viewControls[i].r, viewControls[j].r)
          if (area > 4) {
            overlaps.push({ pair: `view glass-control ${i} vs ${j}`, area: Math.round(area) })
          }
        }
      }
    }

    let playerDockCss = null
    if (rPlayer && player) {
      playerDockCss = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-dock')) || 0
      if (playerDockCss < 88) {
        overlaps.push({ pair: '--player-dock css var', value: playerDockCss, expectedMin: 88 })
      }
      const cols = Array.from(player.children)
        .filter((el) => el.tagName !== 'CANVAS')
        .map((el) => ({ el, r: rectOf(el) }))
        .filter((c) => c.r)
      for (let i = 0; i < cols.length; i++) {
        for (let j = i + 1; j < cols.length; j++) {
          const area = intersect(cols[i].r, cols[j].r)
          if (area > 4) {
            overlaps.push({ pair: `player col ${i} vs ${j}`, area: Math.round(area) })
          }
        }
      }
    }

    const menu = document.querySelector('.app-menu-glass[role="menu"]')
    const rMenu = rectOf(menu)
    if (rMenu && menu) {
      if (rMenu.left < 2 || rMenu.top < 2 || rMenu.right > window.innerWidth - 2 || rMenu.bottom > window.innerHeight - 2) {
        overlaps.push({ pair: 'app-menu out of viewport', rect: rMenu, viewport: { w: window.innerWidth, h: window.innerHeight } })
      }
      const tabs = Array.from(menu.querySelectorAll('[role="tab"]'))
      for (let i = 0; i < tabs.length; i++) {
        const ra = rectOf(tabs[i])
        const rb = rectOf(tabs[i + 1])
        if (ra && rb && intersect(ra, rb) > 2) {
          overlaps.push({ pair: `menu tab ${i} vs ${i + 1}`, area: Math.round(intersect(ra, rb)) })
        }
        if (tabs[i].scrollWidth > tabs[i].clientWidth + 2) {
          textOverflows.push({ scope: 'app-menu tab', text: tabs[i].textContent?.trim(), scrollWidth: tabs[i].scrollWidth, clientWidth: tabs[i].clientWidth })
        }
      }
    }

    const checkOverflowScope = (targetEl, scope) => {
      const root = typeof targetEl === 'string' ? firstVisible(targetEl) : targetEl
      if (!root || !rectOf(root)) return
      for (const el of root.querySelectorAll('button, a, p, span, strong, small, label, h1')) {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        if (el.clientWidth === 0 || el.clientHeight === 0) continue
        if (el.getAttribute('aria-hidden') === 'true' || cs.textOverflow === 'ellipsis') continue
        if (el.childElementCount > 0 && el.tagName !== 'BUTTON') continue
        if (el.scrollWidth > el.clientWidth + 3 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
          textOverflows.push({ scope, tag: el.tagName, text: el.textContent?.trim()?.slice(0, 50), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
        }
      }
    }
    checkOverflowScope(player, 'player')
    checkOverflowScope(menu, 'app-menu')
    checkOverflowScope('.glab-overlay', 'glass-lab')

    // Contrast checks (fail explicitly if an expected element is missing or hidden)
    const measureElContrast = (name, el, bgCandidates, minRatio) => {
      if (!el || !rectOf(el)) {
        contrasts.push({
          name,
          ratio: 0,
          min: minRatio,
          pass: false,
          fg: 'missing',
          sample: 'expected element not found',
        })
        return
      }
      const cs = getComputedStyle(el)
      const fg = parseColor(cs.color)
      if (!fg) {
        contrasts.push({
          name,
          ratio: 0,
          min: minRatio,
          pass: false,
          fg: cs.color || 'unparseable',
          sample: el.textContent?.trim()?.slice(0, 32),
        })
        return
      }
      const worst = Math.min(...bgCandidates.map((bg) => contrast(over(fg, bg), bg)))
      contrasts.push({
        name,
        ratio: worst,
        min: minRatio,
        pass: worst >= minRatio,
        fg: cs.color,
        sample: el.textContent?.trim()?.slice(0, 32),
      })
    }

    // Real fsCompositor bounds (darkBody=0.17 -> 43/255, lightBody=0.82 -> 209/255, baseAlpha=0.80)
    // composited over forced black [0,0,0] and forced white [255,255,255] scrolling backdrops.
    const forcedBackdrops = [[0, 0, 0], [255, 255, 255]]
    const compositorGlassBgs = forcedBackdrops.map((bd) =>
      over(darkTheme ? [43, 43, 43, 0.80] : [209, 209, 209, 0.80], bd),
    )

    if (rPlayer && player) {
      const glassBgs = player.classList.contains('gpu')
        ? compositorGlassBgs
        : [darkTheme ? [28, 30, 42] : [235, 238, 245]]
      const titleEl = player.querySelector('p.text-text-primary')
      const subEl = player.querySelector('p.text-text-muted') || player.querySelector('span.text-text-muted')
      measureElContrast('player-title', titleEl, glassBgs, 4.5)
      measureElContrast('player-muted', subEl, glassBgs, 4.5)
    }

    if (rMenu && menu) {
      const gpuActive = document.documentElement.classList.contains('glass-gpu-active')
      const modalOpen = Boolean(document.querySelector('.modal-glass'))
      const rawBg = parseColor(getComputedStyle(menu).backgroundColor)
      const menuBg = (gpuActive && !modalOpen && (!rawBg || rawBg[3] < 0.05))
        ? (darkTheme ? [43, 43, 43, 0.80] : [209, 209, 209, 0.80])
        : (rawBg || [24, 24, 32, 0.9])
      const compositedBgs = forcedBackdrops.map((bd) => over(menuBg, bd))
      const row = Array.from(menu.querySelectorAll('.app-menu-row')).find((r) => !r.hasAttribute('disabled') && rectOf(r))
      const tab = menu.querySelector('[role="tab"][aria-selected="true"]')
      measureElContrast('menu-row-over-any-cover', row, compositedBgs, 4.5)
      measureElContrast('menu-active-tab-over-any-cover', tab, compositedBgs, 4.5)
    }

    const modal = document.querySelector('.modal-glass')
    if (modal && rectOf(modal)) {
      const modalBgs = document.documentElement.classList.contains('glass-gpu-active')
        ? compositorGlassBgs
        : [darkTheme ? [28, 30, 42] : [235, 238, 245]]
      const mTitle = modal.querySelector('h1, h2')
      const mMuted = Array.from(modal.querySelectorAll('p.text-text-muted, span.text-text-muted')).find((el) => el.textContent?.trim() && rectOf(el))
      const soundPanelLink = Array.from(modal.querySelectorAll('button')).find((el) => el.textContent?.trim() === 'Open sound panel')
      if (soundPanelLink) measureElContrast('settings-sound-panel', soundPanelLink, modalBgs, 4.5)
      measureElContrast('modal-title', mTitle, modalBgs, 4.5)
      measureElContrast('modal-muted', mMuted, modalBgs, 4.5)
    }

    const glab = document.querySelector('.glab-overlay')
    let glassLabInfo = null
    if (glab && rectOf(glab)) {
      const scene = glab.querySelector('.glab-scene')
      const sceneLabel = glab.querySelector('.glab-scene-label')
      const sceneBg = sceneLabel ? getComputedStyle(sceneLabel).backgroundColor : null
      const glabDark = scene ? !scene.classList.contains('light') : darkTheme
      const sceneApproxBg = glabDark ? [24, 28, 46] : [205, 214, 228]
      const barBgs = [glabDark ? [74, 74, 74] : [199, 199, 199]]
      measureElContrast('glasslab-hero-title', sceneLabel?.querySelector('strong'), [sceneApproxBg], 3.0)
      measureElContrast('glasslab-hero-sub', sceneLabel?.querySelector('p'), [sceneApproxBg], 4.5)
      measureElContrast('glasslab-bar-title', glab.querySelector('.glab-title b'), barBgs, 4.5)
      measureElContrast('glasslab-bar-artist', glab.querySelector('.glab-title span'), barBgs, 4.5)
      glassLabInfo = {
        gpuClass: Boolean(scene?.classList.contains('gpu')),
        light: Boolean(scene?.classList.contains('light')),
        labelBg: sceneBg,
        status: glab.querySelector('.glab-status')?.textContent?.trim() ?? '',
      }
    }

    if (scenarioName === 'tracker-dark') {
      const trackerBgs = [[24, 18, 32], [68, 28, 46]] // surface sombre + dégradé ambiant
      const colHeader =
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim()?.toUpperCase() === 'TITLE' && rectOf(b)) ||
        document.querySelector('.glass-seg [data-seg-on="true"], .glass-seg [role="tab"][aria-selected="true"]')
      const rowSub = Array.from(document.querySelectorAll('p.text-text-muted, span.text-text-muted, div.text-text-muted')).find((el) => el.textContent?.trim() && rectOf(el) && !el.closest('.app-player'))
      measureElContrast('tracker-col-header', colHeader, trackerBgs, 4.5)
      measureElContrast('tracker-row-muted', rowSub, trackerBgs, 4.5)
    }

    const playerCanvas = document.querySelector('canvas.glass-compositor-canvas') || player?.querySelector('canvas.player-glass-canvas')
    return {
      scenario: scenarioName,
      darkTheme,
      compositorActive: document.documentElement.classList.contains('glass-gpu-active'),
      htmlInCanvasSupported: 'layoutsubtree' in HTMLCanvasElement.prototype && typeof CanvasRenderingContext2D.prototype.drawElement === 'function',
      playerGpuClass: Boolean(player?.classList.contains('gpu')),
      playerCanvasSize: playerCanvas ? { width: playerCanvas.width, height: playerCanvas.height } : null,
      playerDockCss,
      menuOpen: Boolean(rMenu),
      glassLabInfo,
      overlaps,
      textOverflows,
      contrasts,
    }
  }, scenario)
}

async function measureWrldPixelContrasts(page) {
  const targets = await page.evaluate(async () => {
    const rectOf = (el) => {
      if (!el) return null
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      return r
    }
    const wrldTitle =
      document.querySelector('.dp-title') ||
      Array.from(document.querySelectorAll('h1, h2, p, div')).find((el) => el.textContent?.trim() === 'Lucid Liquid' && rectOf(el) && !el.closest('.app-player'))
    const wrldArtist =
      document.querySelector('.dp-artist') ||
      Array.from(document.querySelectorAll('p, span, div')).find((el) => el.textContent?.trim() === 'Juice WRLD' && rectOf(el) && !el.closest('.app-player'))
    const entries = [
      ['wrld-title', wrldTitle],
      ['wrld-artist', wrldArtist],
      ...Array.from(document.querySelectorAll('.wrld-lyric-line[aria-current="true"]')).filter((el) => rectOf(el)).slice(0, 1).map((el) => ['wrld-active-lyric', el]),
    ].map(([name, el]) => {
      const r = rectOf(el)
      if (!el || !r) return { name, found: false }
      const fg = getComputedStyle(el).color
      const sample = el.textContent?.trim()?.slice(0, 32) ?? ''
      el.setAttribute('data-wrld-verify-target', name)
      el.style.visibility = 'hidden'
      return {
        name,
        found: true,
        fg,
        sample,
        clip: {
          x: Math.max(0, Math.floor(r.left)),
          y: Math.max(0, Math.floor(r.top)),
          width: Math.max(6, Math.min(window.innerWidth - Math.max(0, Math.floor(r.left)), Math.ceil(r.width))),
          height: Math.max(4, Math.min(window.innerHeight - Math.max(0, Math.floor(r.top)), Math.ceil(r.height))),
        },
      }
    })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return entries
  })

  for (const item of targets) {
    if (item.found && item.clip) {
      item.shotB64 = (await page.screenshot({ clip: item.clip })).toString('base64')
    }
  }

  return page.evaluate(async (items) => {
    for (const el of document.querySelectorAll('[data-wrld-verify-target]')) {
      el.style.visibility = ''
      el.removeAttribute('data-wrld-verify-target')
    }
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const parseColor = (str) => {
      if (!str || str === 'transparent') return [0, 0, 0, 0]
      const srgb = str.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/i)
      if (srgb) {
        const alpha = srgb[4] === undefined ? 1 : Number(srgb[4]) / (srgb[5] ? 100 : 1)
        return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, alpha]
      }
      const m = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%)?)?\s*\)/i)
      if (!m) return null
      const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1)
      return [Number(m[1]), Number(m[2]), Number(m[3]), alpha]
    }
    const over = (fg, bg) => {
      const a = fg[3] ?? 1
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
    }
    const lin = (c) => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luma = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const contrast = (c1, c2) => {
      const l1 = luma(c1)
      const l2 = luma(c2)
      const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
      return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
    }

    const out = []
    for (const item of items) {
      if (!item.found || !item.shotB64) {
        out.push({ name: item.name, ratio: 0, min: 4.5, pass: false, fg: 'missing', sample: 'expected element not found' })
        continue
      }
      const fg = parseColor(item.fg)
      if (!fg) {
        out.push({ name: item.name, ratio: 0, min: 4.5, pass: false, fg: item.fg || 'unparseable', sample: item.sample })
        continue
      }
      const img = new Image()
      img.src = 'data:image/png;base64,' + item.shotB64
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, img.width, img.height).data
      const slices = [0, 1, 2].map((s) => {
        const x0 = Math.floor((img.width * s) / 3)
        const x1 = Math.max(x0 + 1, Math.floor((img.width * (s + 1)) / 3))
        let r = 0, g = 0, b = 0, n = 0
        for (let y = 0; y < img.height; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * img.width + x) * 4
            r += d[idx]; g += d[idx + 1]; b += d[idx + 2]; n++
          }
        }
        return n > 0 ? [r / n, g / n, b / n] : [0, 0, 0]
      })
      let worst = Infinity
      let worstBg = slices[0]
      for (const bg of slices) {
        const ratio = contrast(over(fg, bg), bg)
        if (ratio < worst) {
          worst = ratio
          worstBg = bg
        }
      }
      out.push({
        name: item.name,
        ratio: worst,
        min: 4.5,
        pass: worst >= 4.5,
        fg: item.fg,
        bgRgb: worstBg.map((v) => Math.round(v)),
        sample: item.sample,
      })
    }
    return out
  }, targets)
}

async function main() {
  const buildInfo = ensureDistBuilt()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'unreleased-ui-verify-'))
  let electronApp = null
  let timedOut = false

  const timer = setTimeout(async () => {
    timedOut = true
    console.error(`[ui:verify] TIMEOUT après ${HARD_TIMEOUT_MS}ms — arrêt forcé d'Electron`)
    try { electronApp?.process()?.kill('SIGKILL') } catch {}
    try { fs.rmSync(tempUserData, { recursive: true, force: true }) } catch {}
    process.exit(1)
  }, HARD_TIMEOUT_MS)

  const pageErrors = []
  const consoleErrors = []

  try {
    electronApp = await electron.launch({
      args: ['.', '--load-dist', '--ui-verify', '--no-sandbox', '--mute-audio'],
      cwd: ROOT,
      env: { ...process.env, UNRELEASED_UI_VERIFY_DIR: tempUserData },
      timeout: 20_000,
    })

    const win = await electronApp.firstWindow({ timeout: 15_000 })
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true)
    })
    win.on('pageerror', (err) => pageErrors.push(err.message || String(err)))
    win.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (!IGNORED_CONSOLE_RE.test(text)) consoleErrors.push(text)
      }
    })

    await win.setViewportSize({ width: 1280, height: 800 })
    await win.waitForSelector('#root > *', { timeout: 15_000 })
    await win.waitForFunction(() => Boolean(window.__store), { timeout: 10_000 })
    const initialDesktopView = await win.evaluate(() => window.__store.getState().activeView)

    // Seed procedural vibrant album art and sample library/player state offline
    await win.evaluate(async () => {
      const c = document.createElement('canvas')
      c.width = 512
      c.height = 512
      const ctx = c.getContext('2d')
      const grad = ctx.createLinearGradient(0, 0, 512, 512)
      grad.addColorStop(0, '#5b21b6')
      grad.addColorStop(0.5, '#db2777')
      grad.addColorStop(1, '#0284c7')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 512, 512)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
      ctx.beginPath()
      ctx.arc(256, 256, 150, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 54px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('999 GLASS', 256, 272)
      const cover = c.toDataURL('image/png')

      const sampleTracks = Array.from({ length: 6 }, (_, i) => ({
        id: `local-C:\\Music\\track-${i + 1}.flac`,
        filePath: `C:\\Music\\track-${i + 1}.flac`,
        ext: 'flac',
        title: ['Lucid Liquid', 'Starlight Glass', 'Crystal 999', 'Blue Dusk', 'Chrome Heart', 'Velvet Ice'][i],
        artist: 'Juice WRLD',
        album: ['Legends Never Die', 'Fighting Demons', 'Death Race for Love'][i % 3],
        albumArtist: 'Juice WRLD',
        year: 2020,
        trackNumber: i + 1,
        discNumber: 1,
        composer: '',
        genre: 'Hip-Hop',
        duration: 185 + i * 11,
        bitrate: 1411,
        sampleRate: 44100,
        fileSize: 32_000_000,
        lastModified: Date.now(),
        hasAlbumArt: true,
        addedAt: Date.now(),
      }))

      // Generate a valid 2s 8kHz silent WAV blob URL (CSP media-src allows blob:, not data:)
      const wavSamples = 16000
      const wavBuf = new ArrayBuffer(44 + wavSamples * 2)
      const dv = new DataView(wavBuf)
      const writeStr = (o, s) => { for (let k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)) }
      writeStr(0, 'RIFF'); dv.setUint32(4, 36 + wavSamples * 2, true); writeStr(8, 'WAVE')
      writeStr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
      dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
      writeStr(36, 'data'); dv.setUint32(40, wavSamples * 2, true)
      const silentWav = URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }))

      const libraryArt = Object.fromEntries(sampleTracks.map((t) => [t.id, cover]))
      const currentTrack = {
        id: sampleTracks[0].id,
        path: sampleTracks[0].filePath,
        streamUrl: silentWav,
        title: sampleTracks[0].title,
        artist: sampleTracks[0].artist,
        album: sampleTracks[0].album,
        albumArtist: 'Juice WRLD',
        year: 2020,
        trackNumber: 1,
        duration: sampleTracks[0].duration,
        genre: 'Hip-Hop',
        hasAlbumArt: true,
        imageUrl: cover,
      }
      const currentTrackFull = {
        ...currentTrack,
        albumArt: cover,
        lyrics: null,
        syncedLyrics: null,
        producer: 'Nick Mira',
        notes: null,
        ext: 'flac',
      }

      const store = window.__store.getState()
      store.setTheme('glass-dark')
      store.setActiveView('home')
      window.__store.setState({
        libraryTracks: sampleTracks,
        libraryArt,
        libraryLoaded: true,
        currentTrack,
        currentTrackFull,
        queue: [currentTrack],
        queueIndex: 0,
        isPlaying: false,
      })
    })

    await win.waitForTimeout(450)
    await dismissNotices(win)
    const darkHomeReport = await runLayoutSensors(win, 'home-dark')

    // Rapid tab-switch mid-transition overlap check (home -> library -> tracker)
    await win.evaluate(() => window.__store.getState().setActiveView('library'))
    await win.waitForTimeout(80)
    const midSwitchLib = await runLayoutSensors(win, 'mid-switch-library')
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    await win.waitForTimeout(80)
    const midSwitchTracker = await runLayoutSensors(win, 'mid-switch-tracker')

    // Switch to Library (Albums view if available) so covers sit directly under ≡ Menu and Player
    await win.evaluate(() => window.__store.getState().setActiveView('library'))
    await win.waitForTimeout(400)
    const albumsTab = win.locator('button', { hasText: /^Albums$/ }).first()
    if (await albumsTab.count()) {
      await albumsTab.click().catch(() => {})
      await win.waitForTimeout(300)
    }

    // Hover the progress slider and Play button to exercise WebGPU lens/droplet spring
    const seek = win.locator('.app-player >> visible=true').locator('input[type="range"]').first()
    if (await seek.count()) {
      const box = await seek.boundingBox()
      if (box) await win.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2)
    }
    await win.waitForTimeout(350)
    const darkLibraryReport = await runLayoutSensors(win, 'library-player-dark')

    // Open ≡ unified menu over covers & verify tabs
    const menuBtn = win.locator('button[title="Menu"] >> visible=true').first()
    await menuBtn.click()
    await win.waitForSelector('.app-menu-glass[role="menu"]', { timeout: 5_000 })
    for (const tabName of ['Around Juice', 'Create', 'App']) {
      await win.locator(`.app-menu-glass [role="tab"]:has-text("${tabName}")`).click()
    }
    await win.waitForTimeout(200)
    const darkMenuReport = await runLayoutSensors(win, 'menu-open-dark')

    // Switch to Light Mode while Library + Player + Menu are visible
    await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
    await win.waitForTimeout(350)
    const lightMenuReport = await runLayoutSensors(win, 'library-menu-light')

    // Switch back to Dark Mode before opening Glass Lab so Glass Lab starts in Dark Mode
    await win.evaluate(() => window.__store.getState().setTheme('glass-dark'))
    await win.waitForTimeout(250)

    // Open Glass Lab from Tools; the application menu header stays quiet.
    // Glass Lab is a developer tool: it only shows in Tools with Developer mode on.
    await win.evaluate(() => window.__store.getState().setDeveloperMode(true))
    await win.locator('.app-menu-glass [role="tab"]:has-text("Tools")').click()
    await win.locator('.app-menu-glass button:has-text("Glass Lab")').click()
    await win.waitForSelector('.glab-overlay .glab-scene', { timeout: 6_000 })
    await win.evaluate(() => window.__store.getState().setDeveloperMode(false))
    await win.waitForTimeout(450)
    const glassLabDarkReport = await runLayoutSensors(win, 'glass-lab-dark')
    console.log('[ui:verify] compositorActive:', darkLibraryReport.compositorActive, 'htmlInCanvas:', darkLibraryReport.htmlInCanvasSupported, 'glassLabInfo:', glassLabDarkReport.glassLabInfo)

    // Run Measure 4 s benchmark in Glass Lab
    await win.locator('.glab-toolbar button:has-text("Measure 4 s")').click()
    await win.waitForSelector('.glab-report', { timeout: 7_500 })
    const rawMeasureText = await win.locator('.glab-report').inputValue()

    // Parse metrics
    const mFrames = rawMeasureText.match(/images\s*:\s*(\d+)/i)
    const mDuration = rawMeasureText.match(/Durée\s*:\s*(\d+)\s*ms/i)
    const mCpu = rawMeasureText.match(/CPU soumission p50\/p95\s*:\s*([\d.]+)\s*ms\s*\/\s*([\d.]+)\s*ms/i)
    const mGpu = rawMeasureText.match(/GPU scène \+ flou \+ verre p50\/p95\s*:\s*([^/\n]+?)\s*\/\s*([^\n]+)/i)
    const mAdapter = rawMeasureText.match(/GPU\s*:\s*([^\n]+)/i)
    const frames = mFrames ? Number(mFrames[1]) : 0
    const durationMs = mDuration ? Number(mDuration[1]) : 0
    const fps = frames > 0 && durationMs > 0 ? Number(((frames * 1000) / durationMs).toFixed(1)) : 0
    const benchmark = {
      adapter: mAdapter ? mAdapter[1].trim() : 'inconnu',
      frames,
      durationMs,
      fps,
      cpuP50Ms: mCpu ? Number(mCpu[1]) : null,
      cpuP95Ms: mCpu ? Number(mCpu[2]) : null,
      gpuP50: mGpu ? mGpu[1].trim() : null,
      gpuP95: mGpu ? mGpu[2].trim() : null,
      rawReport: rawMeasureText,
    }

    // Check Light mode in Glass Lab too
    await win.locator('.glab-toolbar button:has-text("Thème :")').click()
    await win.waitForTimeout(250)
    const glassLabLightReport = await runLayoutSensors(win, 'glass-lab-light')

    // Close Glass Lab and inspect Tracker page (check for large opaque overlay & muted text contrast)
    await win.locator('.glab-header button').click()
    await win.waitForTimeout(250)
    await win.evaluate(() => window.__store.getState().setTheme('glass-dark'))
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    await win.waitForTimeout(600)
    const trackerDarkReport = await runLayoutSensors(win, 'tracker-dark')
    const trackerInspect = await win.evaluate(() => {
      const largeOverlays = []
      for (const el of document.querySelectorAll('div, section, aside, main')) {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
        const r = el.getBoundingClientRect()
        if (r.width >= 700 && r.height >= 500 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
          const rVal = parseFloat(cs.borderTopLeftRadius) || 0
          if (rVal >= 8 || cs.position === 'fixed' || cs.position === 'absolute') {
            largeOverlays.push({
              tag: el.tagName,
              cls: String(el.className).slice(0, 100),
              w: Math.round(r.width),
              h: Math.round(r.height),
              bg: cs.backgroundColor,
              radius: cs.borderRadius,
              pos: cs.position,
              z: cs.zIndex,
            })
          }
        }
      }
      return { largeOverlays }
    })

    // Verify WRLD view at 120+ fps (dark and light, artwork and theme backgrounds) with classic WRLD player/lyrics layout visible
    await win.evaluate(() => {
      localStorage.setItem('unreleased:wrldWidgets', 'false')
      window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased:wrldWidgets', newValue: 'false', storageArea: localStorage }))
      window.__store.setState({ wrldThemeBackground: false })
      window.__store.getState().setActiveView('wrld')
    })
    await win.waitForTimeout(1100)
    const wrldDarkReport = await runLayoutSensors(win, 'wrld-dark')
    wrldDarkReport.contrasts.push(...(await measureWrldPixelContrasts(win)))
    const wrldPerf = await win.evaluate(() => new Promise((resolve) => {
      const deltas = []
      let last = performance.now()
      const start = last
      const step = (now) => {
        deltas.push(now - last)
        last = now
        if (now - start >= 2000) {
          const sorted = [...deltas].sort((a, b) => a - b)
          const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0
          const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
          const fps = Number(((deltas.length * 1000) / (now - start)).toFixed(1))
          const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => ({
            w: c.width,
            h: c.height,
            display: getComputedStyle(c).display,
          }))
          resolve({ frames: deltas.length, fps, p50Ms: Number(p50.toFixed(2)), p95Ms: Number(p95.toFixed(2)), canvases })
        } else {
          requestAnimationFrame(step)
        }
      }
      requestAnimationFrame(step)
    }))
    await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
    await win.waitForTimeout(300)
    const wrldLightReport = await runLayoutSensors(win, 'wrld-light')
    wrldLightReport.contrasts.push(...(await measureWrldPixelContrasts(win)))

    await win.evaluate(() => {
      window.__store.setState({ wrldThemeBackground: true })
      window.__store.getState().setTheme('glass-dark')
    })
    await win.waitForTimeout(250)
    const wrldThemeDarkReport = await runLayoutSensors(win, 'wrld-theme-dark')
    wrldThemeDarkReport.contrasts.push(...(await measureWrldPixelContrasts(win)))

    await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
    await win.waitForTimeout(250)
    const wrldThemeLightReport = await runLayoutSensors(win, 'wrld-theme-light')
    wrldThemeLightReport.contrasts.push(...(await measureWrldPixelContrasts(win)))
    await win.evaluate(() => window.__store.setState({ wrldThemeBackground: false }))

    const scenes = [darkHomeReport, midSwitchLib, midSwitchTracker, darkLibraryReport, darkMenuReport, lightMenuReport, glassLabDarkReport, glassLabLightReport, trackerDarkReport, wrldDarkReport, wrldLightReport, wrldThemeDarkReport, wrldThemeLightReport]

    // Settings dark & light contrast verification
    await win.evaluate(() => {
      window.__store.getState().setTheme('glass-dark')
      window.__store.setState({ showSettings: true })
    })
    await win.waitForTimeout(350)
    const settingsDarkReport = await runLayoutSensors(win, 'settings-dark')
    await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
    await win.waitForTimeout(300)
    const settingsLightReport = await runLayoutSensors(win, 'settings-light')
    scenes.push(settingsDarkReport, settingsLightReport)
    const coffreChecks = []
    coffreChecks.push({ name: 'desktop-starts-on-discover', view: initialDesktopView, pass: initialDesktopView === 'home' })
    await win.evaluate(() => window.__store.getState().setShowSettings(false))
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    const navLabels = await win.locator('.app-sidebar [data-indicator-key]').allTextContents()
    coffreChecks.push({ name: 'four-primary-destinations', labels: navLabels, pass: navLabels.length === 4 && ['Discover', 'Catalogue', 'Collection', 'Footage'].every((name) => navLabels.some((label) => label.includes(name))) })
    coffreChecks.push({ name: 'navigation-is-only-controls', pass: await win.locator('.coffre-brand').count() === 0 })
    const catalogueBackground = await win.locator('.coffre-catalogue').evaluate((el) => getComputedStyle(el).backgroundColor)
    await win.locator('.app-sidebar').getByRole('button', { name: 'Discover', exact: true }).click()
    const discoverBackground = await win.locator('.coffre-home').evaluate((el) => getComputedStyle(el).backgroundColor)
    coffreChecks.push({ name: 'discover-and-catalogue-share-ambient-backdrop', catalogueBackground, discoverBackground, pass: [catalogueBackground, discoverBackground].every((color) => color === 'rgba(0, 0, 0, 0)') })
    coffreChecks.push({ name: 'discover-has-track-context', pass: await win.getByRole('article', { name: 'Behind the track', exact: true }).isVisible() })
    await win.evaluate(() => window.dispatchEvent(new Event('open-command-palette')))
    const commandSearch = win.getByRole('textbox', { name: 'Command palette search', exact: true })
    await commandSearch.fill('Catalogue')
    coffreChecks.push({ name: 'palette-finds-catalogue', pass: await win.getByRole('option', { name: /^Go to Catalogue View/ }).count() > 0 })
    await commandSearch.fill('Tracker')
    coffreChecks.push({ name: 'palette-keeps-original-name-alias', pass: await win.getByRole('option', { name: /^Go to Catalogue View/ }).count() > 0 })
    await commandSearch.press('Escape')
    await win.locator('.app-sidebar').getByRole('button', { name: 'Collection', exact: true }).click()
    const collectionNav = win.getByRole('navigation', { name: 'Your collection', exact: true })
    await collectionNav.getByRole('button', { name: 'Playlists', exact: true }).waitFor()
    coffreChecks.push({ name: 'collection-opens-playlists', pass: await win.evaluate(() => window.__store.getState().activeView === 'playlists') })
    await collectionNav.getByRole('button', { name: 'On this device', exact: true }).click()
    await win.waitForFunction(() => window.__store.getState().activeView === 'library')
    coffreChecks.push({ name: 'local-files-stay-in-collection', pass: await win.locator('.app-sidebar').getByRole('button', { name: 'Collection', exact: true }).getAttribute('aria-current') === 'page' })
    const savedLikes = await win.evaluate(() => {
      const state = window.__store.getState()
      window.__store.setState({ likedTrackIds: [state.libraryTracks[0].id] })
      return state.likedTrackIds
    })
    await collectionNav.getByRole('button', { name: 'Liked songs', exact: true }).click()
    await win.evaluate(() => window.__store.setState({ previousView: 'wrld' }))
    await win.locator('.collection-page').getByRole('button', { name: 'Back', exact: true }).click()
    coffreChecks.push({ name: 'liked-back-stays-in-collection', pass: await win.evaluate(() => window.__store.getState().activeView === 'playlists') })
    await win.evaluate((likedTrackIds) => window.__store.setState({ likedTrackIds }), savedLikes)
    await collectionNav.getByRole('button', { name: 'Albums', exact: true }).click()
    await win.evaluate(() => window.__store.setState({ previousView: 'wrld', albumsSelectedId: null }))
    await win.locator('.collection-page').getByRole('button', { name: 'Back', exact: true }).click()
    coffreChecks.push({ name: 'albums-back-stays-in-collection', pass: await win.evaluate(() => window.__store.getState().activeView === 'playlists') })
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    await win.evaluate(() => window.__store.getState().openSettings('appearance'))
    await win.waitForTimeout(300)
    const appearanceText = await win.locator('.settings-content').innerText()
    coffreChecks.push({ name: 'simple-appearance', pass: ['Theme', 'Liquid Glass & animations', 'App text size'].every((name) => appearanceText.includes(name)) && !['Accent color', 'App font', 'Custom fonts', 'App gradients', 'Navigation style'].some((name) => appearanceText.includes(name)) })
    await win.locator('.settings-shell').getByRole('button', { name: 'Advanced', exact: true }).click()
    await win.waitForTimeout(250)
    const advanced = await win.locator('.settings-content').evaluate((el) => ({ text: el.textContent, scroll: el.scrollHeight, height: el.clientHeight }))
    coffreChecks.push({ name: 'advanced-one-screen', ...advanced, pass: advanced.scroll <= advanced.height + 2 && ['Start with Windows', 'Global shortcuts', 'Keyboard shortcuts', 'Developer options'].every((name) => advanced.text.includes(name)) && !['Pop-out windows', 'Diagnostic logs', 'API servers', 'Screen-edge light'].some((name) => advanced.text.includes(name)) })
    const developerSwitch = win.getByRole('switch', { name: 'Developer options', exact: true })
    const developerPosition = await developerSwitch.boundingBox()
    const readAppearance = () => win.evaluate(() => ({ theme: window.__store.getState().theme, accent: window.__store.getState().accentColor, surface: getComputedStyle(document.documentElement).getPropertyValue('--surface'), catalogue: getComputedStyle(document.querySelector('.coffre-catalogue')).backgroundColor }))
    const appearanceBeforeDeveloper = await readAppearance()
    await developerSwitch.click()
    await win.waitForTimeout(350)
    const developerPositionOn = await developerSwitch.boundingBox()
    const appearanceAfterDeveloper = await readAppearance()
    coffreChecks.push({ name: 'developer-switch-stays-visible-and-preserves-appearance', before: appearanceBeforeDeveloper, after: appearanceAfterDeveloper, pass: await developerSwitch.count() === 1 && await developerSwitch.isVisible() && developerPosition && developerPositionOn && Math.abs(developerPosition.y - developerPositionOn.y) < 2 && JSON.stringify(appearanceBeforeDeveloper) === JSON.stringify(appearanceAfterDeveloper) })
    await developerSwitch.click()
    await win.waitForTimeout(250)
    await win.evaluate(() => window.__store.setState({ showSettings: false }))
    const menuTrigger = win.locator('.app-sidebar button[title="Menu"]').first()
    await menuTrigger.hover()
    const hoverColor = await menuTrigger.evaluate((el) => getComputedStyle(el).backgroundColor)
    coffreChecks.push({ name: 'menu-hover-is-translucent', color: hoverColor, pass: /rgba\([^)]*,\s*0(?:\.[0-9]+)?\)/.test(hoverColor) || /color\([^)]*\/\s*0(?:\.[0-9]+)?\)/.test(hoverColor) })
    await win.evaluate(() => window.__store.getState().openSettings('app'))
    await win.waitForTimeout(250)
    const settingsSearch = win.locator('.settings-shell input[placeholder="Search settings"]')
    await settingsSearch.fill('cache')
    await win.locator('.settings-content h3').filter({ hasText: 'No results' }).waitFor({ timeout: 3000 })
    const cacheSearch = await win.locator('.settings-content').innerText()
    coffreChecks.push({ name: 'technical-settings-not-searchable', text: cacheSearch, pass: cacheSearch.includes('No results') && !cacheSearch.includes('Clear cache') })
    await settingsSearch.fill('Lyrics alignment')
    await win.waitForTimeout(100)
    await win.locator('.settings-content button').filter({ hasText: 'Lyrics alignment' }).first().click()
    await win.waitForTimeout(200)
    const lyricsText = await win.locator('.settings-content').innerText()
    coffreChecks.push({ name: 'search-opens-visible-setting', pass: lyricsText.includes('Lyrics alignment') && !lyricsText.includes('Lyrics font') && !lyricsText.includes('Lyric colors') })
    await settingsSearch.fill('Global shortcuts')
    await win.locator('.settings-content button').filter({ hasText: 'Global shortcuts' }).first().click()
    await win.waitForTimeout(250)
    coffreChecks.push({ name: 'global-shortcuts-search-opens-switch', pass: await win.getByRole('switch', { name: 'Global shortcuts', exact: true }).isVisible() && await win.getByRole('switch', { name: 'Start with Windows', exact: true }).isVisible() && await win.getByRole('switch', { name: 'Developer options', exact: true }).isVisible() })
    await settingsSearch.fill('Audio quality')
    await win.locator('.settings-content button').filter({ hasText: 'Audio quality' }).first().click()
    await win.waitForTimeout(250)
    const audioText = await win.locator('.settings-content').innerText()
    coffreChecks.push({ name: 'audio-quality-search-opens-visible-row', pass: audioText.includes('Audio quality') && audioText.includes('Equalizer') })
    for (const theme of ['glass-dark', 'glass-light']) {
      await win.evaluate((value) => window.__store.getState().setTheme(value), theme)
      await win.waitForTimeout(350)
      const scenario = `settings-playback-${theme === 'glass-dark' ? 'dark' : 'light'}`
      scenes.push(await runLayoutSensors(win, scenario))
    }
    await settingsSearch.fill('Equalizer')
    await win.locator('.settings-content button').filter({ hasText: 'Equalizer' }).first().click()
    await win.getByRole('button', { name: 'Open sound panel', exact: true }).click()
    await win.waitForTimeout(400)
    const soundPanelOpen = await win.evaluate(() => window.__store.getState().showEqPanel && !window.__store.getState().showSettings)
    coffreChecks.push({ name: 'equalizer-search-opens-sound-panel', pass: soundPanelOpen && await win.getByText('Equalizer', { exact: true }).first().isVisible() })
    await win.evaluate(() => window.__store.getState().setShowEqPanel(false))
    await win.evaluate(() => window.__store.getState().setActiveView('wrld'))
    await win.waitForTimeout(400)
    coffreChecks.push({ name: 'wrld-hides-technical-controls', pass: await win.getByRole('button', { name: 'Show widgets', exact: true }).count() === 0 && await win.getByRole('button', { name: 'Focus on music', exact: true }).count() === 0 && await win.getByRole('button', { name: 'Visualizer settings', exact: true }).count() === 0 && await win.getByRole('button', { name: /Turn (on|off) 999 FM/ }).count() > 0 })
    const savedLyrics = await win.evaluate(() => {
      const state = window.__store.getState()
      window.__store.setState({ currentTrackFull: { ...state.currentTrackFull, lyrics: null, syncedLyrics: '[00:00.00] First verification line\n[00:01.00] Second verification line' }, lyricsColorActive: '#ffffff', lyricsColorInactive: '#ffffff', wrldThemeBackground: true })
      return { currentTrackFull: state.currentTrackFull, lyricsColorActive: state.lyricsColorActive, lyricsColorInactive: state.lyricsColorInactive, wrldThemeBackground: state.wrldThemeBackground }
    })
    await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
    await win.waitForTimeout(400)
    const activeLyric = win.locator('.wrld-lyric-line[aria-current="true"]').filter({ visible: true }).first()
    const lyricColor = await activeLyric.evaluate((el) => getComputedStyle(el).color)
    coffreChecks.push({ name: 'light-lyrics-ignore-hidden-white-customization', color: lyricColor, pass: lyricColor !== 'rgb(255, 255, 255)' && await activeLyric.isVisible() })
    const lightLyricsReport = await runLayoutSensors(win, 'wrld-legacy-white-lyrics-light')
    lightLyricsReport.contrasts.push(...await measureWrldPixelContrasts(win))
    scenes.push(lightLyricsReport)
    await win.keyboard.press('Escape')
    coffreChecks.push({ name: 'escape-closes-listening-view', pass: await win.evaluate(() => window.__store.getState().activeView === 'api-tracker') })
    await win.evaluate(() => window.__store.getState().setActiveView('wrld'))
    await win.getByRole('button', { name: 'Close listening view', exact: true }).click()
    coffreChecks.push({ name: 'back-button-closes-listening-view', pass: await win.evaluate(() => window.__store.getState().activeView === 'api-tracker') })
    await win.evaluate((saved) => window.__store.setState(saved), savedLyrics)
    await win.evaluate(() => window.__store.getState().setShowNotifications(true))
    const notifications = win.getByRole('dialog', { name: 'Notifications', exact: true })
    await notifications.waitFor()
    const notificationMaterial = await notifications.evaluate((el) => ({ color: getComputedStyle(el).backgroundColor, filter: getComputedStyle(el).backdropFilter }))
    coffreChecks.push({ name: 'notifications-use-translucent-native-glass', ...notificationMaterial, pass: /blur\(/.test(notificationMaterial.filter) && (/rgba\([^)]*,\s*0\.[0-9]+\)/.test(notificationMaterial.color) || /color\([^)]*\/\s*0\.[0-9]+\)/.test(notificationMaterial.color)) })
    const oldTransparency = await win.evaluate(() => { const root = document.documentElement; const old = root.getAttribute('data-effects-transparency'); root.setAttribute('data-effects-transparency', 'reduce'); return old })
    const reducedNotificationFilter = await notifications.evaluate((el) => getComputedStyle(el).backdropFilter)
    coffreChecks.push({ name: 'notifications-respect-reduced-transparency', pass: reducedNotificationFilter === 'none' })
    await win.evaluate((old) => { if (old === null) document.documentElement.removeAttribute('data-effects-transparency'); else document.documentElement.setAttribute('data-effects-transparency', old) }, oldTransparency)
    await notifications.getByRole('button', { name: 'Browse news', exact: true }).click()
    coffreChecks.push({ name: 'notifications-open-news-and-close-alerts', pass: await win.evaluate(() => window.__store.getState().activeView === 'news' && !window.__store.getState().showNotifications) })
    await win.evaluate(() => window.__store.getState().setShowDownloadManager(true))
    const downloadsPanel = win.getByRole('dialog', { name: 'Downloads', exact: true })
    await downloadsPanel.waitFor()
    const downloadsMaterial = await downloadsPanel.evaluate((el) => ({ color: getComputedStyle(el).backgroundColor, filter: getComputedStyle(el).backdropFilter }))
    coffreChecks.push({ name: 'downloads-share-notification-glass', ...downloadsMaterial, pass: downloadsMaterial.color === notificationMaterial.color && downloadsMaterial.filter === notificationMaterial.filter })
    await downloadsPanel.getByRole('button', { name: 'Close downloads', exact: true }).click()
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    await win.evaluate(() => window.__store.getState().openSettings('appearance'))
    await win.waitForTimeout(150)

    await win.evaluate(() => window.__store.setState({ showSettings: false, theme: 'glass-dark' }))
    await win.waitForTimeout(200)

    // Top-nav pill clickable-element overlap matrix across views, themes, and viewports
    const navPillOverlaps = []
    await win.evaluate(() => {
      window.__store.setState({ sidebarPosition: 'top', navStyle: 'pill', showSettings: false })
    })
    const matrixViewports = [
      { width: 960, height: 600 },
      { width: 1100, height: 650 },
      { width: 1280, height: 720 },
      { width: 1600, height: 900 },
      { width: 1920, height: 1080 },
    ]
    const matrixThemes = ['glass-dark', 'glass-light']
    const matrixViews = ['home', 'api-tracker', 'api-files', 'footage', 'library', 'playlists', 'wrld', 'settings']
    for (const vp of matrixViewports) {
      await win.setViewportSize(vp)
      for (const th of matrixThemes) {
        await win.evaluate((theme) => window.__store.getState().setTheme(theme), th)
        for (const v of matrixViews) {
          await win.evaluate((viewName) => {
            if (viewName === 'settings') {
              window.__store.setState({ showSettings: true })
            } else {
              window.__store.setState({ showSettings: false })
              window.__store.getState().setActiveView(viewName)
            }
          }, v)
          await win.waitForTimeout(160)
          const checkPillOverlap = async (label) => {
            const hits = await win.evaluate(() => {
              const pill = document.querySelector('.app-sidebar')
              if (!pill) return []
              const pr = pill.getBoundingClientRect()
              if (pr.width <= 0 || pr.height <= 0) return []
              const out = []
              for (const el of document.querySelectorAll('button, a, input, [role="tab"], [role="button"]')) {
                if (pill.contains(el) || el.closest('.modal-glass') || el.closest('.glab-overlay') || el.closest('.app-menu-glass')) continue
                const cs = getComputedStyle(el)
                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue
                const r = el.getBoundingClientRect()
                if (r.width <= 0 || r.height <= 0) continue
                const ix = Math.max(0, Math.min(pr.right, r.right) - Math.max(pr.left, r.left))
                const iy = Math.max(0, Math.min(pr.bottom, r.bottom) - Math.max(pr.top, r.top))
                if (ix > 1 && iy > 1) {
                  out.push({
                    text: (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName).trim().slice(0, 40),
                    ix: Math.round(ix),
                    iy: Math.round(iy),
                    pillBottom: Math.round(pr.bottom),
                    elTop: Math.round(r.top),
                  })
                }
              }
              return out
            })
            if (hits.length) navPillOverlaps.push({ viewport: `${vp.width}x${vp.height}`, theme: th, view: label, hits })
          }
          await checkPillOverlap(v)
          if (v === 'api-tracker' && vp.width === 1280) {
            for (const tabLabel of ['Lyrics', 'Overview', 'Producers', 'Statistics', 'Files']) {
              const tabBtn = win.locator(`.glass-seg [role="tab"]:has-text("${tabLabel}")`).first()
              if (await tabBtn.isVisible().catch(() => false)) {
                await tabBtn.click()
                await win.waitForTimeout(140)
                await checkPillOverlap(`api-tracker:${tabLabel}`)
              }
            }
            const songsBtn = win.locator('.glass-seg [role="tab"]:has-text("Songs")').first()
            if (await songsBtn.isVisible().catch(() => false)) await songsBtn.click()
          }
        }
      }
    }

    // Measure Liquid Clear (On) vs Reduced (Off) pixel delta at 1280x720 dark mode
    await win.setViewportSize({ width: 1280, height: 720 })
    await win.evaluate(() => {
      window.__store.setState({ sidebarPosition: 'top', navStyle: 'pill', showSettings: false, isPlaying: true, progress: 0.42, volume: 0.68 })
      window.__store.getState().setTheme('glass-dark')
      localStorage.setItem('unreleased.glass-look', JSON.stringify({ id: 'clear', intensity: 1 }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.glass-look' }))
    })
    const offOnDiffs = {}
    for (const targetView of ['library', 'api-tracker', 'api-files', 'settings']) {
      await win.evaluate((v) => {
        if (v === 'settings') {
          window.__store.setState({ showSettings: true })
        } else {
          window.__store.setState({ showSettings: false })
          window.__store.getState().setActiveView(v)
        }
      }, targetView)
      await win.waitForTimeout(350)
      const boxes = await win.evaluate(() => {
        const out = {}
        const pick = (name, sel) => {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect()
            if (r.width > 10 && r.height > 10 && getComputedStyle(el).display !== 'none') {
              out[name] = { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(r.width), height: Math.ceil(r.height) }
              break
            }
          }
        }
        pick('player', '.app-player')
        pick('nav', '.app-sidebar')
        pick('seg', '.glass-seg')
        pick('search', '.glass-field')
        pick('settings', '.modal-glass')
        return out
      })
      const onShots = {}
      for (const [k, clip] of Object.entries(boxes)) onShots[k] = (await win.screenshot({ clip })).toString('base64')
      await win.evaluate(() => {
        localStorage.setItem('unreleased.effects-mode', 'reduced')
        window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.effects-mode', newValue: 'reduced' }))
      })
      await win.waitForTimeout(300)
      const reducedAttrs = await win.evaluate(() => ({
        motion: document.documentElement.dataset.effectsMotion,
        transparency: document.documentElement.dataset.effectsTransparency,
        gpuClass: document.documentElement.classList.contains('glass-gpu-active'),
      }))
      const offShots = {}
      for (const [k, clip] of Object.entries(boxes)) offShots[k] = (await win.screenshot({ clip })).toString('base64')
      await win.evaluate(() => {
        localStorage.setItem('unreleased.effects-mode', 'on')
        window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.effects-mode', newValue: 'on' }))
      })
      await win.waitForTimeout(300)
      const delta = await win.evaluate(async ([onMap, offMap]) => {
        async function load(b64) {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width; c.height = img.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          return ctx.getImageData(0, 0, img.width, img.height).data
        }
        const res = {}
        for (const k of Object.keys(onMap)) {
          const a = await load(onMap[k]), b = await load(offMap[k])
          const n = Math.min(a.length, b.length), total = n / 4
          let sum = 0, changed = 0
          for (let i = 0; i < n; i += 4) {
            const dr = Math.abs(a[i] - b[i]), dg = Math.abs(a[i + 1] - b[i + 1]), db = Math.abs(a[i + 2] - b[i + 2])
            sum += (dr + dg + db) / 3
            if (Math.max(dr, dg, db) > 4) changed++
          }
          res[k] = { meanRgbDelta: Number((sum / total).toFixed(2)), pctChangedPx: Number(((changed / total) * 100).toFixed(1)) }
        }
        return res
      }, [onShots, offShots])
      offOnDiffs[targetView] = { reducedAttrs, delta }
    }
    // Measure real pixel contrast under player & modal text over forced #000000 and #ffffff backdrops
    const pixelContrastReport = {}
    for (const forcedBg of ['#000000', '#ffffff']) {
      await win.evaluate((bg) => {
        window.__store.getState().setTheme('glass-dark')
        window.__store.setState({ showSettings: true })
        document.documentElement.style.setProperty('--forced-verify-bg', bg)
        document.body.style.background = bg
      }, forcedBg)
      await win.waitForTimeout(220)
      const sampleRect = await win.evaluate(() => {
        const modal = document.querySelector('.modal-glass')
        const muted = modal && Array.from(modal.querySelectorAll('p.text-text-muted, span.text-text-muted')).find((el) => el.textContent?.trim())
        if (!muted) return null
        const fg = getComputedStyle(muted).color
        const r = muted.getBoundingClientRect()
        muted.style.visibility = 'hidden'
        return { fg, clip: { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.max(4, Math.ceil(r.width)), height: Math.max(4, Math.ceil(r.height)) } }
      })
      if (sampleRect) {
        const shotB64 = (await win.screenshot({ clip: sampleRect.clip })).toString('base64')
        const ratio = await win.evaluate(async ([b64, fgStr]) => {
          const modal = document.querySelector('.modal-glass')
          const muted = modal && Array.from(modal.querySelectorAll('p.text-text-muted, span.text-text-muted')).find((el) => el.textContent?.trim())
          if (muted) muted.style.visibility = ''
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width; c.height = img.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const d = ctx.getImageData(0, 0, img.width, img.height).data
          let r = 0, g = 0, b = 0, n = 0
          for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ }
          const bg = [r / n, g / n, b / n]
          const m = fgStr.match(/[\d.]+/g)?.map(Number) || [222, 226, 236]
          const lum = (rgb) => {
            const [lr, lg, lb] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
            return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
          }
          const l1 = lum(m), l2 = lum(bg)
          return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2))
        }, [shotB64, sampleRect.fg])
        pixelContrastReport[forcedBg] = ratio
      }
    }
    await win.evaluate(() => {
      document.body.style.background = ''
      window.__store.setState({ showSettings: false, sidebarPosition: 'top', isPlaying: false })
    })

    // Measure production compositor frame pacing during active pointer movement + scroll
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    await win.waitForTimeout(250)
    const compositorPerf = await win.evaluate(() => new Promise((resolve) => {
      const deltas = []
      let last = performance.now()
      const start = last
      const step = (now) => {
        deltas.push(now - last)
        last = now
        const t = (now - start) / 1200
        window.dispatchEvent(new PointerEvent('pointermove', {
          clientX: 200 + Math.sin(t * Math.PI * 4) * 400,
          clientY: 660 + Math.cos(t * Math.PI * 2) * 30,
          bubbles: true,
        }))
        if (now - start >= 1200) {
          const sorted = [...deltas].sort((a, b) => a - b)
          const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0
          const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
          const fps = Number(((deltas.length * 1000) / (now - start)).toFixed(1))
          resolve({ frames: deltas.length, fps, p50Ms: Number(p50.toFixed(2)), p95Ms: Number(p95.toFixed(2)) })
        } else {
          requestAnimationFrame(step)
        }
      }
      requestAnimationFrame(step)
    }))

    const sliderChecks = []
    const checkSliders = async (scenario, expectedReady) => {
      await win.waitForTimeout(350)
      const result = await win.evaluate(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight }
        const overlay = document.querySelector('.glass-compositor-overlay')
        const previousPointerEvents = overlay?.style.pointerEvents ?? ''
        if (overlay) overlay.style.pointerEvents = 'auto'
        const controls = Array.from(document.querySelectorAll('.app-player input[data-glass-slider]'))
          .filter(visible)
          .map((el) => {
            const r = el.getBoundingClientRect()
            const layers = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            const overlayIndex = overlay ? layers.indexOf(overlay) : -1
            return {
              id: el.dataset.glassSlider,
              ready: el.hasAttribute('data-glass-slider-ready'),
              nativeOpacity: getComputedStyle(el, '::-webkit-slider-thumb').opacity,
              overlayAboveControl: overlayIndex >= 0 && overlayIndex < layers.indexOf(el),
            }
          })
        if (overlay) overlay.style.pointerEvents = previousPointerEvents
        const visibleBudgetFixtures = Array.from(document.querySelectorAll('#verify-surface-budget > div')).filter(visible).length
        return { controls, visibleBudgetFixtures }
      })
      const pass = result.controls.length === 2 && result.controls.every((el) => el.ready === expectedReady && (expectedReady ? el.overlayAboveControl : el.nativeOpacity !== '0'))
        && (scenario !== 'full-surface-budget' || result.visibleBudgetFixtures === 28)
      sliderChecks.push({ scenario, expectedReady, ...result, pass })
    }
    await win.evaluate(() => {
      window.__store.setState({ activeView: 'library', showSettings: false, isPlaying: false })
    })
    await win.waitForFunction(() => document.documentElement.classList.contains('glass-gpu-active'), { timeout: 5000 })
    await checkSliders('library-rest', true)
    const interactionChecks = []
    const volumeInput = win.locator('.app-player input[data-glass-slider="volume"]:visible')
    const savedVolume = await volumeInput.inputValue()
    await volumeInput.press('Home')
    const minVolume = await volumeInput.inputValue()
    await volumeInput.press('End')
    const maxVolume = await volumeInput.inputValue()
    await win.evaluate((value) => window.__store.getState().setVolume(Number(value)), savedVolume)
    interactionChecks.push({ scenario: 'volume-keyboard', minVolume, maxVolume, pass: minVolume === '0' && maxVolume === '1' })
    const folders = win.locator('details.library-folders')
    const foldersInitiallyOpen = await folders.evaluate((el) => el.open)
    await folders.locator('summary').press('Space')
    const foldersToggled = (await folders.evaluate((el) => el.open)) !== foldersInitiallyOpen
    await folders.locator('summary').press('Space')
    const foldersRestored = (await folders.evaluate((el) => el.open)) === foldersInitiallyOpen
    interactionChecks.push({ scenario: 'music-folders-keyboard', pass: foldersToggled && foldersRestored })
    await win.evaluate(() => {
      const hiddenModal = document.createElement('div')
      hiddenModal.id = 'verify-hidden-modal'
      hiddenModal.className = 'modal-glass hidden'
      document.body.append(hiddenModal)
    })
    await checkSliders('hidden-modal', true)
    await win.evaluate(() => document.getElementById('verify-hidden-modal')?.remove())
    await win.evaluate(() => {
      const fixtures = document.createElement('div')
      fixtures.id = 'verify-surface-budget'
      for (let i = 0; i < 28; i++) {
        const panel = document.createElement('div')
        panel.className = 'glass-pane'
        Object.assign(panel.style, { position: 'fixed', top: '16px', left: '16px', width: '32px', height: '32px' })
        fixtures.append(panel)
      }
      document.body.append(fixtures)
    })
    await checkSliders('full-surface-budget', true)
    await win.evaluate(() => {
      document.getElementById('verify-surface-budget')?.remove()
      window.__store.setState({ showSettings: true })
    })
    await checkSliders('visible-modal-native-fallback', false)
    await win.evaluate(() => {
      window.__store.setState({ showSettings: false })
      localStorage.setItem('unreleased.effects-mode', 'reduced')
      window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.effects-mode', newValue: 'reduced' }))
    })
    await checkSliders('reduced-native-fallback', false)
    await win.evaluate(() => {
      localStorage.setItem('unreleased.effects-mode', 'on')
      window.dispatchEvent(new StorageEvent('storage', { key: 'unreleased.effects-mode', newValue: 'on' }))
    })
    await win.waitForFunction(() => document.documentElement.classList.contains('glass-gpu-active'), { timeout: 5000 })
    await checkSliders('effects-restored', true)

    // Share Studio sensor: verify deterministic PNG (9:16) and MP4 with audio (9:16) export
    await win.evaluate(() => {
      const s = window.__store.getState()
      if (s.currentTrackFull) {
        window.__store.setState({
          currentTrackFull: {
            ...s.currentTrackFull,
            syncedLyrics: '[00:00.20] Still see your shadows in my room\n[00:01.20] Can\'t take back the love that I gave you\n[00:02.40] It\'s to the point where I love and I hate you',
          },
        })
      }
      window.dispatchEvent(new Event('open-share-studio'))
    })
    await win.waitForSelector('[data-share-preview-canvas="1"]', { timeout: 6000 })
    await win.waitForTimeout(300)
    await win.locator('[data-share-export-png="1"]').click()
    await win.waitForFunction(
      () => document.body.innerText.includes('Saved PNG (1080×1920)'),
      { timeout: 10000 },
    )
    const pngFile = fs.readdirSync(tempUserData).find((f) => f.endsWith('-9x16.png'))
    const pngPath = pngFile ? path.join(tempUserData, pngFile) : null
    const pngBytes = pngPath && fs.existsSync(pngPath) ? fs.statSync(pngPath).size : 0
    const pngOk = !!(pngPath && pngBytes > 5000 && fs.readFileSync(pngPath).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))

    await win.getByRole('button', { name: 'Video (MP4)' }).click()
    await win.waitForTimeout(200)
    await win.getByRole('button', { name: '5s', exact: true }).click()
    await win.locator('[data-share-export-mp4="1"]').click()
    await win.waitForFunction(
      () => document.body.innerText.includes('Saved MP4 (1080×1920, with audio)'),
      { timeout: 45000 },
    )
    const mp4File = fs.readdirSync(tempUserData).find((f) => f.endsWith('-9x16.mp4'))
    const mp4Path = mp4File ? path.join(tempUserData, mp4File) : null
    const mp4Bytes = mp4Path && fs.existsSync(mp4Path) ? fs.statSync(mp4Path).size : 0
    const mp4Head = mp4Path && fs.existsSync(mp4Path) ? fs.readFileSync(mp4Path).subarray(0, 16) : Buffer.alloc(0)
    const mp4Ok = !!(mp4Path && mp4Bytes > 10000 && mp4Head.includes(Buffer.from('ftyp')))
    const shareStudioCheck = { pngOk, pngBytes, mp4Ok, mp4Bytes, pass: pngOk && mp4Ok }
    await win.locator('button[aria-label="Close"]').first().click()
    await win.waitForTimeout(400)

    // Stage E sensor: Ctrl+K Command Palette search, keyboard navigation, and accessible dialog attributes
    await win.keyboard.press('Control+KeyK')
    await win.waitForSelector('[data-command-palette="1"]', { timeout: 5000 })
    const paletteDialogOk = await win.evaluate(() => {
      const cp = document.querySelector('[data-command-palette="1"]')
      return !!cp && !!cp.closest('[role="dialog"][aria-modal="true"]')
    })
    await win.locator('[data-command-palette="1"] input').fill('Go to Wrapped')
    await win.waitForTimeout(150)
    await win.keyboard.press('Enter')
    await win.waitForTimeout(250)
    const paletteNavigated = await win.evaluate(() => window.__store.getState().activeView === 'stats')
    const commandPaletteCheck = {
      dialogOk: paletteDialogOk,
      navigated: paletteNavigated,
      pass: paletteDialogOk && paletteNavigated,
    }
    // Lot 1 sensors (2026-11-16): fixed bar, clean Home -> Tracker, stable toolbar, Settings never dark.
    const lot1Checks = []
    await win.evaluate(() => window.__store.setState({ showSettings: false, theme: 'glass-dark' }))
    await win.evaluate(() => window.__store.getState().setActiveView('home'))
    await win.waitForTimeout(600)
    await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
    await win.waitForTimeout(50)
    const cloneLayers = await win.evaluate(() => document.querySelectorAll('[inert][aria-hidden="true"].pointer-events-none').length)
    lot1Checks.push({ name: 'home-to-tracker-no-page-copy', cloneLayers, pass: cloneLayers === 0 })
    const barDrag = await win.evaluate(() => ({
      draggable: document.querySelectorAll('.app-sidebar [draggable="true"]').length,
      grab: document.querySelectorAll('.app-sidebar .cursor-grab').length,
      position: window.__store.getState().sidebarPosition,
    }))
    lot1Checks.push({ name: 'top-bar-fixed', ...barDrag, pass: barDrag.draggable === 0 && barDrag.grab === 0 && barDrag.position === 'top' })
    await win.waitForTimeout(500)
    const toolbarRect = async (mode) => {
      await win.locator(`.catalog-toolbar [title="${mode}"]`).first().click()
      await win.waitForTimeout(350)
      return win.evaluate(() => {
        const r = document.querySelector('.catalog-toolbar')?.getBoundingClientRect()
        return r ? { left: Math.round(r.left), width: Math.round(r.width) } : null
      })
    }
    await win.evaluate(() => window.__store.getState().setDeveloperMode(true))
    await win.waitForTimeout(200)
    const inDetail = await toolbarRect('Detailed view')
    const inList = await toolbarRect('List view')
    await win.evaluate(() => window.__store.getState().setDeveloperMode(false))
    lot1Checks.push({ name: 'tracker-toolbar-stable', inDetail, inList, pass: !!inDetail && !!inList && inDetail.left === inList.left && inDetail.width === inList.width })
    await win.evaluate(() => window.__store.setState({ showSettings: true }))
    await win.waitForTimeout(60)
    const earlyPanel = await win.evaluate(() => {
      const r = document.querySelector('.modal-glass')?.getBoundingClientRect()
      return r ? { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.6), w: Math.round(r.width) } : null
    })
    let earlyLuma = null
    if (earlyPanel) {
      const px = await win.screenshot({ clip: { x: earlyPanel.x - 20, y: earlyPanel.y - 20, width: 40, height: 40 } })
      earlyLuma = await win.evaluate(async (b64) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        return Math.round(sum / (d.length / 4))
      }, px.toString('base64'))
    }
    // Pure black (≈0) means the panel showed through before the glass was drawn.
    lot1Checks.push({ name: 'settings-not-black-at-60ms', earlyPanel, earlyLuma, pass: !!earlyPanel && earlyLuma !== null && earlyLuma > 12 })
    await win.evaluate(() => window.__store.setState({ showSettings: false }))
    await win.evaluate(() => window.__store.getState().setActiveView('library'))
    await win.waitForTimeout(200)

    const blockingFailures = []
    for (const check of coffreChecks) if (!check.pass) blockingFailures.push({ kind: 'coffre', ...check })
    for (const check of lot1Checks) {
      if (!check.pass) blockingFailures.push({ type: 'lot1-regression', ...check })
    }
    if (!commandPaletteCheck.pass) {
      blockingFailures.push({ type: 'command-palette-failed', ...commandPaletteCheck })
    }
    if (!shareStudioCheck.pass) {
      blockingFailures.push({ type: 'share-studio-export-failed', ...shareStudioCheck })
    }
    for (const check of interactionChecks) {
      if (!check.pass) blockingFailures.push({ type: 'interaction-regression', ...check })
    }
    for (const check of sliderChecks) {
      if (!check.pass) blockingFailures.push({ type: 'slider-rendering-or-fallback', ...check })
    }
    if (navPillOverlaps.length) blockingFailures.push({ type: 'nav-pill-overlap', overlaps: navPillOverlaps })
    for (const [bg, ratio] of Object.entries(pixelContrastReport)) {
      if (ratio < 4.5) blockingFailures.push({ type: 'pixel-contrast-below-aa', forcedBg: bg, ratio })
    }
    // Cible 60–100 fps : sur un écran 60 Hz le rAF oscille autour de 16,7 ms, d'où la marge 58 fps / 18 ms.
    const MIN_FPS = 58
    const MAX_P95_MS = 18
    if (compositorPerf.fps < MIN_FPS || compositorPerf.p95Ms > MAX_P95_MS) {
      blockingFailures.push({ type: 'compositor-perf-regression', compositorPerf })
    }
    if (wrldPerf.fps < MIN_FPS || wrldPerf.p95Ms > MAX_P95_MS) {
      blockingFailures.push({ type: 'wrld-perf-regression', wrldPerf })
    }
    if (benchmark.fps < MIN_FPS || (benchmark.cpuP95Ms !== null && benchmark.cpuP95Ms > 8)) {
      blockingFailures.push({ type: 'glasslab-perf-regression', benchmark })
    }
    for (const [v, info] of Object.entries(offOnDiffs)) {
      if (info.reducedAttrs.motion !== 'reduce' || info.reducedAttrs.transparency !== 'reduce' || info.reducedAttrs.gpuClass) {
        blockingFailures.push({ type: 'reduced-effects-ignored', view: v, reducedAttrs: info.reducedAttrs })
      }
    }
    if (pageErrors.length) blockingFailures.push({ type: 'pageerror', errors: pageErrors })
    if (consoleErrors.length) blockingFailures.push({ type: 'console.error', errors: consoleErrors })
    if (!darkLibraryReport.playerCanvasSize || darkLibraryReport.playerCanvasSize.width <= 0) {
      blockingFailures.push({ type: 'player-canvas-missing', detail: darkLibraryReport.playerCanvasSize })
    }
    for (const s of scenes) {
      if (s.overlaps.length) blockingFailures.push({ type: 'overlap', scenario: s.scenario, items: s.overlaps })
      if (s.textOverflows.length) blockingFailures.push({ type: 'text-overflow', scenario: s.scenario, items: s.textOverflows })
      for (const c of s.contrasts) {
        if (!c.pass) blockingFailures.push({ type: 'contrast', scenario: s.scenario, ...c })
      }
      if (s.glassLabInfo) {
        if (s.glassLabInfo.labelBg && s.glassLabInfo.labelBg !== 'rgba(0, 0, 0, 0)') {
          blockingFailures.push({ type: 'glasslab-opaque-label-box', scenario: s.scenario, bg: s.glassLabInfo.labelBg })
        }
      }
    }
    if (frames <= 0) blockingFailures.push({ type: 'benchmark-no-frames', benchmark })

    const screenshots = []
    if (blockingFailures.length === 0) {
      // Capture final screenshots now that sensors are green
      const shot = async (name) => {
        const p = path.join(OUT_DIR, name)
        await win.screenshot({ path: p })
        screenshots.push(path.relative(ROOT, p).replace(/\\/g, '/'))
      }

      await dismissNotices(win)

      await win.evaluate(() => {
        window.__store.setState({ wrldThemeBackground: false })
        window.__store.getState().setTheme('glass-dark')
        window.__store.getState().setActiveView('wrld')
      })
      await win.waitForTimeout(600)
      await shot('wrld-dark.png')

      await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
      await win.waitForTimeout(350)
      await shot('wrld-light.png')

      // Adaptive gold+blue cover A/B check & reversible toggle verification
      const adaptiveCheck = await win.evaluate(async () => {
        const c = document.createElement('canvas')
        c.width = 96; c.height = 96
        const ctx = c.getContext('2d')
        const grad = ctx.createLinearGradient(0, 0, 0, 96)
        grad.addColorStop(0, '#f2b13c')
        grad.addColorStop(0.62, '#e69b28')
        grad.addColorStop(0.63, '#2563eb')
        grad.addColorStop(1, '#1d4ed8')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 96, 96)
        const goldBlue = c.toDataURL('image/png')
        const st = window.__store.getState()
        const prevTrack = st.currentTrack
        const prevFull = st.currentTrackFull
        st.setTheme('glass-dark')
        st.setAdaptiveColors(false)
        await new Promise((r) => setTimeout(r, 150))
        const offAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
        const offAccent2 = document.documentElement.style.getPropertyValue('--accent-2').trim()

        window.__store.setState({
          currentTrack: { ...prevTrack, imageUrl: goldBlue },
          currentTrackFull: { ...prevFull, albumArt: goldBlue },
        })
        st.setAdaptiveColors(true)
        await new Promise((r) => setTimeout(r, 450))
        const onAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
        const onAccent2 = document.documentElement.style.getPropertyValue('--accent-2').trim()
        return { offAccent, offAccent2, onAccent, onAccent2, prevTrack, prevFull }
      })
      if (!adaptiveCheck.onAccent2 || adaptiveCheck.offAccent2) {
        blockingFailures.push(`Adaptive cover toggle failed reversibility check: ${JSON.stringify({ offAccent: adaptiveCheck.offAccent, offAccent2: adaptiveCheck.offAccent2, onAccent: adaptiveCheck.onAccent, onAccent2: adaptiveCheck.onAccent2 })}`)
      }
      await win.waitForTimeout(350)
      const adaptiveContrast = await measureWrldPixelContrasts(win)
      for (const c of adaptiveContrast) {
        if (c.ratio != null && c.ratio < 4.5) {
          blockingFailures.push(`Adaptive gold+blue WRLD contrast below 4.5:1 on ${c.name}: ${c.ratio}:1`)
        }
      }
      await shot('wrld-adaptive-theway.png')
      await win.evaluate(({ prevTrack, prevFull }) => {
        window.__store.setState({ currentTrack: prevTrack, currentTrackFull: prevFull })
      }, { prevTrack: adaptiveCheck.prevTrack, prevFull: adaptiveCheck.prevFull })
      await win.waitForTimeout(350)

      await win.evaluate(() => window.__store.setState({ wrldThemeBackground: true }))
      await win.waitForTimeout(300)
      await shot('wrld-theme-light.png')

      await win.setViewportSize({ width: 540, height: 960 })
      await win.evaluate(() => {
        window.__store.setState({ wrldThemeBackground: false })
        window.__store.getState().setTheme('glass-dark')
      })
      await win.waitForTimeout(350)
      await shot('wrld-portrait-dark.png')
      await win.setViewportSize({ width: 1280, height: 720 })
      await win.waitForTimeout(250)

      await win.evaluate(() => window.__store.getState().setActiveView('api-tracker'))
      await win.waitForTimeout(400)
      await shot('tracker-dark.png')
      // Album themes, for eye inspection (their palettes are AA-checked by scripts/skins-contrast.test.cjs).
      for (const albumTheme of ['gbgr', 'lnd']) {
        await win.evaluate((t) => window.__store.getState().setTheme(t), albumTheme)
        await win.waitForTimeout(500)
        await shot(`tracker-${albumTheme}.png`)
      }
      await win.evaluate(() => window.__store.getState().setTheme('glass-dark'))
      await win.waitForTimeout(300)

      // Playlist header art: an open local playlist with the toggle on, then off,
      // must look visibly different in its header (the blurred cover behind it).
      const heroPlaylistId = await win.evaluate(() => {
        const st = window.__store.getState()
        st.createLocalPlaylist('Header art check')
        const id = window.__store.getState().activeLocalPlaylistId
        for (const t of st.libraryTracks.slice(0, 3)) window.__store.getState().addToLocalPlaylist(id, t.id)
        window.__store.setState({ playlistsSelectedLocalId: id, playlistHeroEnabledDark: true, activeView: 'playlists' })
        return id
      })
      try {
      await win.waitForTimeout(900)
      const headerClip = { x: 0, y: 60, width: 1280, height: 200 }
      const heroOn = await win.screenshot({ clip: headerClip })
      await shot('playlist-hero-on-dark.png')
      await win.evaluate(() => window.__store.setState({ playlistHeroEnabledDark: false }))
      await win.waitForTimeout(600)
      const heroOff = await win.screenshot({ clip: headerClip })
      await shot('playlist-hero-off-dark.png')
      const heroDelta = await win.evaluate(async ([a, b]) => {
        const read = async (b64) => {
          const img = new Image()
          img.src = `data:image/png;base64,${b64}`
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width; c.height = img.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          return ctx.getImageData(0, 0, c.width, c.height).data
        }
        const [da, db] = [await read(a), await read(b)]
        let sum = 0
        for (let i = 0; i < da.length; i += 4) sum += (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3
        return Number((sum / (da.length / 4)).toFixed(2))
      }, [heroOn.toString('base64'), heroOff.toString('base64')])
      const heroCheck = { name: 'playlist-header-art-visible', meanRgbDelta: heroDelta, pass: heroDelta >= 6 }
      if (!heroCheck.pass) blockingFailures.push({ type: 'playlist-header-art-invisible', ...heroCheck })
      lot1Checks.push(heroCheck)
      } finally {
      await win.evaluate((id) => {
        window.__store.setState({ playlistsSelectedLocalId: null, playlistHeroEnabledDark: true, activeView: 'library' })
        window.__store.getState().deleteLocalPlaylist(id)
      }, heroPlaylistId)
      }
      await win.waitForTimeout(300)

      await win.evaluate(() => window.__store.setState({ sidebarPosition: 'top', navStyle: 'pill', isPlaying: true, progress: 0.44, volume: 0.72 }))
      await win.evaluate(() => window.__store.getState().setActiveView('api-files'))
      await win.waitForTimeout(400)
      await shot('api-files-top-pill-dark.png')

      // Capture close-up player bar with active seek loupe & volume loupe while playing
      await win.evaluate(() => window.__store.getState().setActiveView('library'))
      await win.waitForTimeout(300)
      const seekBox = await win.locator('.app-player.gpu input[data-glass-slider="seek"]:visible').boundingBox()
      if (seekBox) {
        await win.mouse.move(seekBox.x + seekBox.width * 0.44, seekBox.y + seekBox.height * 0.5)
        await win.mouse.down()
        await win.waitForTimeout(260)
        await shot('player-loupe-seek-dark.png')
        await win.mouse.up()
      }
      const volBox = await win.locator('.app-player.gpu input[data-glass-slider="volume"]:visible').boundingBox()
      if (volBox) {
        await win.mouse.move(volBox.x + volBox.width * 0.72, volBox.y + volBox.height * 0.5)
        await win.mouse.down()
        await win.waitForTimeout(260)
        await shot('player-loupe-vol-dark.png')
        await win.mouse.up()
      }

      await win.evaluate(() => window.__store.setState({ showSettings: true }))
      await win.waitForTimeout(350)
      await shot('settings-dark.png')
      await win.locator('.settings-shell').getByRole('button', { name: 'Advanced', exact: true }).click()
      await win.waitForTimeout(250)
      await shot('settings-advanced-dark.png')
      await win.evaluate(() => window.__store.getState().openSettings('appearance'))
      await win.waitForTimeout(200)
      await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
      await win.waitForTimeout(350)
      await shot('settings-light.png')
      await win.evaluate(() => window.__store.getState().openSettings('playback'))
      await win.waitForTimeout(250)
      await shot('settings-playback-light.png')
      await win.evaluate(() => window.__store.getState().setTheme('glass-dark'))
      await win.waitForTimeout(350)
      await shot('settings-playback-dark.png')
      await win.evaluate(() => window.__store.setState({ showSettings: false, sidebarPosition: 'top', isPlaying: false, theme: 'glass-dark' }))
      await win.waitForTimeout(250)

      await win.evaluate(() => window.__store.getState().setActiveView('library'))
      await win.waitForTimeout(300)
      await win.evaluate(() => window.__store.getState().setActiveView('home'))
      await win.waitForTimeout(400)
      await shot('home-dark.png')
      await win.evaluate(() => window.__store.getState().setShowNotifications(true))
      await win.getByRole('dialog', { name: 'Notifications', exact: true }).waitFor()
      await win.waitForTimeout(250)
      await shot('notifications-dark.png')
      await win.evaluate(() => window.__store.getState().setShowNotifications(false))
      await win.evaluate(() => window.__store.getState().setShowDownloadManager(true))
      await win.getByRole('dialog', { name: 'Downloads', exact: true }).waitFor()
      await win.waitForTimeout(250)
      await shot('downloads-dark.png')
      await win.evaluate(() => window.__store.getState().setShowDownloadManager(false))
      await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
      await win.waitForTimeout(300)
      await shot('home-light.png')
      await win.evaluate(() => { window.__store.getState().setTheme('glass-dark'); window.__store.getState().setActiveView('library') })
      await win.waitForTimeout(250)
      await shot('library-player-dark.png')

      await win.locator('button[title="Menu"] >> visible=true').first().click()
      await win.waitForSelector('.app-menu-glass[role="menu"]', { timeout: 4_000 })
      await win.waitForTimeout(220)
      await shot('menu-open-dark.png')

      await win.evaluate(() => window.__store.getState().setTheme('glass-light'))
      await win.waitForTimeout(300)
      await shot('library-menu-light.png')

      await win.evaluate(() => window.__store.getState().setTheme('glass-dark'))
      await win.waitForTimeout(200)
      await win.evaluate(() => window.__store.getState().setDeveloperMode(true))
      await win.locator('.app-menu-glass [role="tab"]:has-text("Tools")').click()
      await win.locator('.app-menu-glass button:has-text("Glass Lab")').click()
      await win.waitForSelector('.glab-overlay .glab-scene', { timeout: 5_000 })
      await win.evaluate(() => window.__store.getState().setDeveloperMode(false))
      await win.waitForTimeout(350)
      await shot('glass-lab-dark.png')

      await win.locator('.glab-overlay button:has-text("Fermer"), .glab-overlay button[aria-label="Fermer"], .glab-overlay button:has-text("Close")').first().click().catch(() => {})
      await win.keyboard.press('Escape')
      await win.waitForTimeout(200)
      await win.evaluate(() => window.dispatchEvent(new Event('open-share-studio')))
      await win.waitForSelector('[data-share-preview-canvas="1"]', { timeout: 5_000 })
      await win.waitForTimeout(350)
      await shot('share-studio-dark.png')
      await win.locator('button[aria-label="Close"]').first().click()
      await win.waitForTimeout(200)

      await win.keyboard.press('Control+KeyK')
      await win.waitForSelector('[data-command-palette="1"]', { timeout: 4_000 })
      await win.waitForTimeout(250)
      await shot('command-palette-dark.png')
      await win.keyboard.press('Escape')
    }

    const summary = {
      ok: blockingFailures.length === 0,
      timestamp: new Date().toISOString(),
      build: buildInfo,
      pageErrors,
      consoleErrors,
      benchmark,
      wrldPerf,
      compositorPerf,
      sliderChecks,
      interactionChecks,
      shareStudioCheck,
      commandPaletteCheck,
      pixelContrastReport,
      lot1Checks,
      coffreChecks,
      trackerInspect,
      navPillOverlaps,
      offOnDiffs,
      scenes,
      blockingFailures,
      screenshots,
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary, null, 2))
    if (blockingFailures.length > 0) process.exitCode = 1
  } finally {
    clearTimeout(timer)
    if (electronApp && !timedOut) {
      const pid = electronApp.process()?.pid
      await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {})
      await electronApp.close().catch(() => {})
      if (pid) {
        try { process.kill(pid) } catch {}
      }
    }
    try { fs.rmSync(tempUserData, { recursive: true, force: true }) } catch {}
  }
}

main().catch((err) => {
  console.error('[ui:verify] Fatal:', err)
  process.exit(1)
})
