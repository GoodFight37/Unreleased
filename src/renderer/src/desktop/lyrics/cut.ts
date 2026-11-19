// Cut: the lyrics as a typographic cut-up. Each phrase stands on the stage as faint ghosts of its words; every word
// lights up as it is sung (a short glow, no movement), the strong word of a repeated line comes in big, and the phrase
// leaves as the next one arrives. The picture is a pure function of the song's clock (no timers, no state to replay),
// so a pause, a jump or a change of song always shows the right frame.
import { faceCSS } from './looks'
import { width as textWidth } from './type'
import { hsbToRgb } from '../light/engine'
import { clockTime, type LyricRenderer, type StageClock, type StageLook, type StageSong } from './scene'
import { buildCut, type CutLine, type CutSong } from './cutEngine'
import './cut.css'

const LEAD = 0.12 // a word lights this much before it is sung, so it lands on the beat
const GHOST = 0.14 // a word still to come, as a faint shape
const UNSUNG = 0.62 // reduced motion: words still to come
const BASE_W = 900
const BASE_H = 520

const clamp = (x: number, low = 0, high = 1): number => Math.min(high, Math.max(low, x))
const easeOut = (x: number): number => 1 - Math.pow(1 - clamp(x), 3)
const exitOf = (line: CutLine): number => (line.kind === 'impact' ? 0.24 : 0.22)

interface Box { x: number; y: number; size: number; group: 'head' | 'hero' | 'tail' | 'body' }
interface Placed { boxes: Box[]; total: number; top: number }
interface Phrase { line: CutLine; el: HTMLDivElement; words: HTMLSpanElement[]; ad: HTMLDivElement | null; placed: Placed; mounted: boolean }
type Rows = { j: number; x: number; w: number }[][]

export class CutScene implements LyricRenderer {
  host: HTMLElement
  root: HTMLDivElement
  live: HTMLDivElement
  dots: HTMLDivElement
  watch: ResizeObserver
  song: StageSong | null = null
  cut: CutSong | null = null
  clock: StageClock | null = null
  face = 'Segoe'
  textSize = 1
  scale = 1
  light = false
  seen = true
  phrases = new Map<number, Phrase>()
  frame = 0
  seenSize = ''
  spoken = -2

  constructor(host: HTMLElement) {
    this.host = host
    host.innerHTML = ''
    this.root = document.createElement('div')
    this.root.className = 'cut-stage'
    this.live = document.createElement('div')
    this.live.className = 'cut-sr'
    this.live.setAttribute('aria-live', 'polite')
    this.dots = document.createElement('div')
    this.dots.className = 'cut-dots'
    this.dots.setAttribute('aria-hidden', 'true')
    this.dots.innerHTML = '<i></i><i></i><i></i>'
    this.root.append(this.live, this.dots)
    host.appendChild(this.root)
    this.watch = new ResizeObserver(() => {
      const size = `${host.clientWidth}x${host.clientHeight}`
      if (size === this.seenSize) return
      this.seenSize = size
      this.clear()
      this.render()
    })
    this.watch.observe(host)
    document.addEventListener('visibilitychange', this.onVisible)
  }

  get width(): number { return this.host.clientWidth }
  get height(): number { return this.host.clientHeight }
  /** The size of everything: stage ratio against the base design box, times user text size.
   *  Note: do NOT multiply by `this.scale` here — `width / BASE_W` and `height / BASE_H`
   *  already incorporate the viewport size, so multiplying by `scale` squared it on 1080p+. */
  get k(): number { return Math.min(this.width / BASE_W, this.height / BASE_H) * Math.min(Math.max(this.textSize, 0.7), 1.25) }
  get runs(): boolean { return this.seen && Boolean(this.clock?.running) && this.width > 0 && !document.hidden }

  onVisible = (): void => { this.render(); this.loop() }

  show(song: StageSong, look: StageLook): void {
    const light = Boolean(look.tune?.lightBg)
    const size = look.tune?.size || 1
    const restyle = look.face !== this.face || light !== this.light || size !== this.textSize || look.scale !== this.scale
    this.face = look.face
    this.light = light
    this.textSize = size
    this.scale = look.scale
    this.seen = look.isSeen
    this.clock = look.clock
    this.host.classList.toggle('is-light', light)
    this.root.classList.toggle('is-light', light)
    if (look.tune?.cutAccent === 'cover' && look.colors) {
      const rgb = hsbToRgb(look.colors.primary).map(value => Math.round(value * 255)).join(' ')
      this.root.style.setProperty('--cut-accent', `color-mix(in srgb, rgb(${rgb}) ${light ? 32 : 38}%, var(--cut-ink))`)
    } else this.root.style.removeProperty('--cut-accent')
    if (song.id !== this.song?.id || song.lyrics !== this.song?.lyrics) {
      this.song = song
      this.cut = buildCut(song.lyrics)
      this.clear()
    } else if (restyle) this.clear()
    this.render()
    this.loop()
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.clear()
    this.song = null
    this.cut = null
    this.live.textContent = ''
  }

  destroy(): void {
    this.stop()
    this.watch.disconnect()
    document.removeEventListener('visibilitychange', this.onVisible)
    this.root.remove()
  }

  private clear(): void {
    for (const p of this.phrases.values()) p.el.remove()
    this.phrases.clear()
    this.spoken = -2
  }

  private loop(): void {
    if (this.frame || !this.runs) return
    const tick = (): void => {
      this.frame = 0
      if (!this.runs) return
      this.render()
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  // ---- the page of a phrase ----

  private wd(text: string, size: number): number { return textWidth(text, faceCSS(this.face, size), -0.02 * size) }

  private wrap(texts: string[], size: number, limit: number): Rows {
    const space = size * 0.26
    const rows: Rows = [[]]
    let x = 0
    texts.forEach((t, j) => {
      const w = this.wd(t, size)
      if (x > 0 && x + w > limit) { rows.push([]); x = 0 }
      rows[rows.length - 1].push({ j, x, w })
      x += w + space
    })
    return rows
  }

  /** The same rows, the narrowest that still take as many: no word left alone on the last row. */
  private balanced(texts: string[], size: number, room: number): Rows {
    const n = this.wrap(texts, size, room).length
    if (n < 2) return this.wrap(texts, size, room)
    let low = room * 0.45, high = room
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2
      if (this.wrap(texts, size, mid).length <= n) high = mid; else low = mid
    }
    return this.wrap(texts, size, high)
  }

  private widest(texts: string[], size: number): number { return Math.max(...texts.map((t) => this.wd(t, size))) }

  private fit(texts: string[], most: number, big: number, small: number, room: number): { size: number; rows: Rows } {
    for (let s = big; s >= small; s -= 2) {
      if (this.widest(texts, s) > room) continue
      const rows = this.balanced(texts, s, room)
      if (rows.length <= most) return { size: s, rows }
    }
    // No size takes it in `most` rows (a very long word): the largest that fits across.
    let s = small
    while (this.widest(texts, s) > room && s > 14) s -= 2
    return { size: s, rows: this.balanced(texts, s, room) }
  }

  private place(line: CutLine): Placed {
    const k = this.k, H = this.height
    const room = Math.max(120, this.width - 48 * k), margin = (this.width - room) / 2
    const texts = line.words.map((w) => w.text)
    const boxes: Box[] = new Array(texts.length)
    const put = (ids: number[], set: { size: number; rows: Rows }, y0: number, group: Box['group']): void =>
      set.rows.forEach((row, ri) => row.forEach((c) => { boxes[ids[c.j]] = { x: margin + c.x, y: y0 + ri * set.size * 1.08, size: set.size, group } }))
    const hero = line.kind === 'impact' ? line.words.findIndex((w) => w.accent === 2) : -1
    let total: number
    if (hero >= 0) {
      const head = texts.slice(0, hero), tail = texts.slice(hero + 1)
      let hs = Math.min(230 * k, (230 * k * room) / this.wd(texts[hero], 230 * k))
      const hr = head.length ? this.fit(head, 2, 84 * k, 36 * k, room) : null
      const tr = tail.length ? this.fit(tail, 2, 56 * k, 30 * k, room) : null
      const high = (): number => (hr ? hr.rows.length * hr.size * 1.08 + 10 * k : 0) + hs + (tr ? tr.rows.length * tr.size * 1.08 + 26 * k : 0)
      while (high() > H * 0.74 && hs > 72 * k) hs -= 6 * k
      total = high()
      const minTop = H * 0.12
      let y = Math.max(minTop, (H * 0.88 - total) / 2)
      if (hr) { put(head.map((_, j) => j), hr, y, 'head'); y += hr.rows.length * hr.size * 1.08 + 10 * k }
      boxes[hero] = { x: margin, y: y - (hr ? hs * 0.08 : 0), size: hs, group: 'hero' }
      y += hs
      if (tr) put(tail.map((_, j) => hero + 1 + j), tr, y + 20 * k, 'tail')
    } else {
      const set = this.fit(texts, 3, 108 * k, 36 * k, room)
      total = set.rows.length * set.size * 1.08
      const y0 = Math.max(H * 0.12, (H * 0.88 - total) / 2)
      put(texts.map((_, j) => j), set, y0, 'body')
    }
    return { boxes, total, top: Math.max(H * 0.12, (H * 0.88 - total) / 2) }
  }

  private phrase(i: number): Phrase {
    const known = this.phrases.get(i)
    if (known) return known
    const line = this.cut!.lines[i], placed = this.place(line), k = this.k
    const el = document.createElement('div')
    el.className = 'cut-phrase'
    el.setAttribute('aria-hidden', 'true')
    const words = line.words.map((w, j) => {
      const s = document.createElement('span')
      const b = placed.boxes[j]
      s.className = `cut-w${b.group === 'hero' ? ' hero' : ''}${w.accent === 1 ? ' soft' : ''}`
      s.style.font = faceCSS(this.face, b.size)
      s.textContent = w.text
      el.append(s)
      return s
    })
    const left = `${(this.width - Math.max(120, this.width - 48 * k)) / 2}px`
    let ad: HTMLDivElement | null = null
    if (line.ad) {
      ad = document.createElement('div')
      ad.className = 'cut-ad'
      ad.textContent = line.ad
      ad.style.fontSize = `${26 * k}px`
      ad.style.left = left
      ad.style.top = `${Math.min(this.height * 0.9, placed.top + placed.total + 30 * k)}px`
      el.append(ad)
    }
    const made: Phrase = { line, el, words, ad, placed, mounted: false }
    this.phrases.set(i, made)
    return made
  }

  // ---- the picture at the song's time ----

  render(): void {
    const cut = this.cut, clock = this.clock
    if (!cut || !clock || this.width <= 0 || this.height <= 0) return
    const T = clockTime(clock)
    const still = document.documentElement.dataset.effectsMotion === 'reduce'
    const k = this.k
    const vis: number[] = []
    cut.lines.forEach((L, i) => {
      const nx = cut.lines[i + 1]
      const end = still ? (nx ? nx.time : L.until + 9) : L.until + exitOf(L)
      if (T >= L.time - 0.02 && T < end) vis.push(i)
    })
    for (const [i, p] of this.phrases) {
      if (vis.includes(i)) continue
      if (p.mounted) { p.el.remove(); p.mounted = false }
      if (Math.abs(i - (vis[0] ?? i)) > 6) this.phrases.delete(i)
    }
    const speaking = vis.filter((i) => T >= cut.lines[i].time && T < cut.lines[i].until).pop()
    const now = speaking ?? -1
    if (now !== this.spoken) {
      this.spoken = now
      this.live.textContent = speaking == null ? '' : cut.lines[speaking].words.map((w) => w.text).join(' ')
    }
    let active = false
    for (const i of still && vis.length > 1 ? [vis[vis.length - 1]] : vis) {
      const p = this.phrase(i), L = p.line
      if (!p.mounted) { this.root.insertBefore(p.el, this.dots); p.mounted = true }
      const starts = L.words.map((w) => Math.max(w.start, L.enterAt))
      const xr = still ? 0 : clamp((T - L.until) / exitOf(L))
      const exit = easeOut(xr), fade = easeOut(clamp(xr * 1.5))
      if (T < L.until) active = true
      const hero = L.words.findIndex((w) => w.accent === 2)
      const heroP = still ? (hero >= 0 ? 1 : 0) : hero >= 0 ? easeOut((T - starts[hero] + LEAD) / 0.36) : 0
      p.el.style.opacity = still ? easeOut((T - L.time) / 0.15).toFixed(3) : '1'
      p.words.forEach((s, j) => {
        const b = p.placed.boxes[j]
        let x = b.x, y = b.y, op = 1, glow = ''
        if (!still) {
          const sp = T - starts[j] + LEAD
          op = GHOST + (1 - GHOST) * easeOut(sp / 0.12)
          const g = sp < 0 ? 0 : Math.max(0, 1 - sp / 0.45)
          if (g > 0.01) glow = `0 0 ${(g * 30 * k).toFixed(1)}px var(--cut-c), var(--cut-shadow)`
          if (b.group === 'head' || b.group === 'tail') op *= 1 - heroP * 0.38
          if (L.kind === 'impact') x -= 130 * k * exit; else y -= 22 * k * exit
          op *= 1 - fade
        } else op = T >= starts[j] ? 1 : UNSUNG
        s.style.opacity = op.toFixed(3)
        s.style.textShadow = glow
        s.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      })
      if (p.ad) p.ad.style.opacity = (still ? 1 : easeOut((T - L.time - 0.12) / 0.25) * (1 - exit)).toFixed(3)
    }
    // A break in the singing: three dots breathe where the words were.
    const upcoming = cut.lines.find((L) => L.time > T)
    let breath = 0
    if (upcoming && !active && !vis.length && !still && upcoming.time - T > 0.45) {
      const ended = cut.lines.filter((L) => L.until <= T).pop()
      const since = ended ? T - ended.until : T
      breath = clamp((since - 0.2) / 0.4) * clamp((upcoming.time - T - 0.1) / 0.5)
    }
    this.dots.style.opacity = breath.toFixed(3)
    this.dots.style.left = `${24 * k}px`
    this.dots.style.top = `${this.height * 0.36}px`
    Array.from(this.dots.children).forEach((d, n) => {
      ;(d as HTMLElement).style.transform = `scale(${(0.6 + 0.4 * Math.abs(Math.sin(T * 3 + n * 0.7))).toFixed(3)})`
    })
  }
}
