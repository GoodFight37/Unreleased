// Pure maths behind the WRLD stage bouncer: the play field left free by the lyrics, the speeds that make the cover
// reach a corner at a chosen moment, and which lyric line to aim that corner at. No DOM, no React.

export interface Rect { left: number; top: number; right: number; bottom: number }
/** What a wall of the play field is: the stage edge, or the index of the obstacle it rests against. */
export type WallTag = 'edge' | number
export interface Field {
  /** Where the cover's top-left corner may go. */
  minX: number; maxX: number; minY: number; maxY: number
  tags: { l: WallTag; r: WallTag; t: WallTag; b: WallTag }
}

/** The biggest plain rectangle of the stage that no obstacle touches, so the cover bounces in a clean box and a corner
 *  can be worked out exactly. An obstacle that leaves no room for the cover is ignored. */
export function computeField(
  host: { w: number; h: number },
  insets: { t: number; r: number; b: number; l: number } | undefined,
  obstacles: ReadonlyArray<Rect | null>,
  size: number,
): Field {
  const ins = insets ?? { t: 0, r: 0, b: 0, l: 0 }
  const start: Rect = { left: ins.l * host.w, top: ins.t * host.h, right: host.w - ins.r * host.w, bottom: host.h - ins.b * host.h }
  const need = size + 12
  const area = (r: Rect): number => (r.right - r.left) * (r.bottom - r.top)
  // Every way of keeping each obstacle on one side of the box; the biggest box that survives them all wins.
  const cut = (R: Rect, tags: Field['tags'], i: number): { R: Rect; tags: Field['tags'] } => {
    const o = obstacles[i]
    if (i >= obstacles.length) return { R, tags }
    if (!o || !(o.left < R.right && o.right > R.left && o.top < R.bottom && o.bottom > R.top)) return cut(R, tags, i + 1)
    let best: { R: Rect; tags: Field['tags'] } | null = null
    const tryCut = (rect: Rect, wall: 'l' | 'r' | 't' | 'b'): void => {
      if (rect.right - rect.left < need || rect.bottom - rect.top < need) return
      const next = cut(rect, { ...tags, [wall]: i }, i + 1)
      if (!best || area(next.R) > area(best.R)) best = next
    }
    tryCut({ ...R, right: o.left }, 'r')
    tryCut({ ...R, left: o.right }, 'l')
    tryCut({ ...R, bottom: o.top }, 'b')
    tryCut({ ...R, top: o.bottom }, 't')
    return best ?? cut(R, tags, i + 1) // no room left for the cover: ignore this obstacle
  }
  const { R, tags } = cut(start, { l: 'edge', r: 'edge', t: 'edge', b: 'edge' }, 0)
  return { minX: R.left, maxX: Math.max(R.left, R.right - size), minY: R.top, maxY: Math.max(R.top, R.bottom - size), tags }
}

const fold = (p: number, len: number): number => {
  const u = ((p % (2 * len)) + 2 * len) % (2 * len)
  return u <= len ? u : 2 * len - u
}

export interface PlanInput {
  /** Travel range of the cover on each axis, and where it is in it (0..w, 0..h). */
  w: number; h: number; px: number; py: number
  dirX: 1 | -1; dirY: 1 | -1
  baseVx: number; baseVy: number
  /** Seconds until the corner. */
  T: number
  /** Distance from a wall that still counts as touching a corner / as a near miss. */
  tol: number; near: number
  /** Which walls are the real stage edge (a corner there reads as a true screen corner). */
  edge: { l: boolean; r: boolean; t: boolean; b: boolean }
}
export interface Plan {
  vx: number; vy: number
  /** Seconds to the corner; longer than asked when no speed near the cruise speed could make it. */
  T: number
  exact: boolean
  fx: 'l' | 'r'; fy: 't' | 'b'
  nearMisses: number
}

/** Speeds (kept near cruise speed) that bring both axes to a wall at the same instant, T seconds from now, preferring
 *  a true screen corner and a near miss or two on the way, never an accidental corner before. */
export function planCorner(p: PlanInput): Plan | null {
  if (p.w < 24 || p.h < 24) return null
  const ux = p.dirX > 0 ? p.px : 2 * p.w - p.px
  const uy = p.dirY > 0 ? p.py : 2 * p.h - p.py
  const nx0 = Math.floor(ux / p.w) + 1
  const ny0 = Math.floor(uy / p.h) + 1
  const d1x = nx0 * p.w - ux
  const d1y = ny0 * p.h - uy
  const asked = Math.max(1.2, p.T)
  for (let attempt = 0, T = asked; attempt < 8; attempt++, T += 2.5) {
    const kcx = Math.round((p.baseVx * T - d1x) / p.w)
    const kcy = Math.round((p.baseVy * T - d1y) / p.h)
    let best: (Plan & { score: number }) | null = null
    for (let kx = Math.max(0, kcx - 3); kx <= kcx + 3; kx++) {
      for (let ky = Math.max(0, kcy - 3); ky <= kcy + 3; ky++) {
        const vx = (d1x + kx * p.w) / T
        const vy = (d1y + ky * p.h) / T
        const rx = vx / p.baseVx
        const ry = vy / p.baseVy
        if (rx < 0.6 || rx > 1.7 || ry < 0.6 || ry > 1.7) continue
        let accidental = 0
        let nearMisses = 0
        // Walls hit before the corner (the corner hit itself is j === k): how close the other axis is to a wall then.
        const scan = (k: number, d1: number, len: number, v: number, otherU0: number, otherV: number, otherLen: number): void => {
          for (let j = 0; j < k; j++) {
            const t = (d1 + j * len) / v
            const f = fold(otherU0 + otherV * t, otherLen)
            const dist = Math.min(f, otherLen - f)
            if (dist <= p.tol) accidental++
            else if (dist <= p.near && t >= T - 8 && t <= T - 0.4) nearMisses++
          }
        }
        scan(kx, d1x, p.w, vx, uy, vy, p.h)
        scan(ky, d1y, p.h, vy, ux, vx, p.w)
        const fx: 'l' | 'r' = (nx0 + kx) % 2 === 1 ? 'r' : 'l'
        const fy: 't' | 'b' = (ny0 + ky) % 2 === 1 ? 'b' : 't'
        const real = (p.edge[fx] ? 1 : 0) + (p.edge[fy] ? 1 : 0)
        const score = 2 * (Math.abs(Math.log(rx)) + Math.abs(Math.log(ry))) + 10 * accidental - 1.2 * Math.min(2, nearMisses) - (real === 2 ? 1.5 : real === 1 ? 0.6 : 0)
        if (!best || score < best.score) best = { vx, vy, T, exact: attempt === 0, fx, fy, nearMisses, score }
      }
    }
    if (best) return best
  }
  return null
}

/** The lyric line to aim the corner at: a line that opens a section (after a quiet gap), at least `minLead` seconds
 *  away. With `target` it just says how long until that same line, or null once it has passed. Times are song seconds. */
export function pickCue(
  lines: ReadonlyArray<{ time: number }>,
  now: number,
  minLead: number,
  rate: number,
  target: number | null,
): { key: number; inSec: number } | null {
  const r = rate > 0 ? rate : 1
  if (target !== null) return target - now > -0.2 ? { key: target, inSec: Math.max(0, (target - now) / r) } : null
  const from = now + minLead * r
  let fallback: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time
    if (t < from) continue
    if (t > now + 45 * r) break
    const gap = i === 0 ? Infinity : t - lines[i - 1].time
    if (gap >= 4.5) return { key: t, inSec: (t - now) / r }
    if (fallback === null && t >= now + Math.max(minLead, 8) * r) fallback = t
  }
  return fallback === null ? null : { key: fallback, inSec: (fallback - now) / r }
}
