import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { buildImageUrl } from '../lib/juicewrldApi'
import { listenToMeter } from '../desktop/meter'
import { computeField, planCorner, type Field, type Rect } from '../lib/bouncerPlan'

export type BounceSpriteId = 'albums' | 'cover' | 'butterfly'
export type DvdLogoId = BounceSpriteId
export type BounceAlbumCatalog = 'all' | 'core'

export type BounceAlbumId =
  | '999'
  | 'gbgr'
  | 'drfl'
  | 'lnd'
  | 'fd'
  | 'lnd_5yae'
  | 'wod'
  | 'tpne'
  | 'tpp'
  | 'tpp_ee'
  | 'gbgr_ae'
  | 'gbgr_5yae'
  | 'nd'
  | 'bdm'
  | 'hih_999'
  | 'aff'
  | 'jute'

export const BOUNCE_SPRITE_OPTIONS: ReadonlyArray<{ id: BounceSpriteId; label: string }> = [
  { id: 'albums', label: 'Album Covers' },
  { id: 'cover', label: 'Playing Cover' },
  { id: 'butterfly', label: 'LND Butterfly' },
]

export const DVD_LOGO_OPTIONS = BOUNCE_SPRITE_OPTIONS

export function normalizeBounceSprite(value: unknown): BounceSpriteId {
  return value === 'albums' || value === 'cover' || value === 'butterfly' ? value : 'albums'
}

export const normalizeDvdLogo = normalizeBounceSprite

export interface AlbumBounceItem {
  id: BounceAlbumId
  name: string
  color: string
  art: string
  core?: boolean
}

const ALBUM_BOUNCE_SPECS: ReadonlyArray<{
  id: BounceAlbumId
  name: string
  color: string
  asset: string
  core?: boolean
}> = [
  { id: '999', name: 'JuiceWRLD 9 9 9', color: '#f0404f', asset: '/assets/999.webp', core: true },
  { id: 'gbgr', name: 'Goodbye & Good Riddance', color: '#4da6ff', asset: '/assets/gbgr.webp', core: true },
  { id: 'drfl', name: 'Death Race for Love', color: '#ff8426', asset: '/assets/drfl.webp', core: true },
  { id: 'lnd', name: 'Legends Never Die', color: '#e864c0', asset: '/assets/lnd.webp', core: true },
  { id: 'fd', name: 'Fighting Demons', color: '#4ce4eb', asset: '/assets/fd.webp', core: true },
  { id: 'lnd_5yae', name: 'Legends Never Die (5 Year Anniversary)', color: '#ff9330', asset: '/assets/lnd_5yae.webp' },
  { id: 'wod', name: 'WRLD ON DRUGS', color: '#a8e048', asset: '/assets/wod.webp' },
  { id: 'tpne', name: 'The Party Never Ends', color: '#f2b949', asset: '/assets/tpne.webp' },
  { id: 'tpp', name: 'The Pre-Party', color: '#ff5c8a', asset: '/assets/tpp.webp' },
  { id: 'tpp_ee', name: 'The Pre-Party (Extended)', color: '#ff7a59', asset: '/assets/tpp_ee.webp' },
  { id: 'gbgr_ae', name: 'GB&GR (Anniversary)', color: '#5bb8ff', asset: '/assets/gbgr_ae.webp' },
  { id: 'gbgr_5yae', name: 'GB&GR (5 Year Anniversary)', color: '#3b8ef3', asset: '/assets/gbgr_5yae.webp' },
  { id: 'nd', name: "NOTHING'S DIFFERENT </3", color: '#e04868', asset: '/assets/nd.webp' },
  { id: 'bdm', name: 'BINGEDRINKINGMUSIC', color: '#9c6bff', asset: '/assets/bdm.webp' },
  { id: 'hih_999', name: 'Heartbroken In Hollywood 9 9 9', color: '#ff4d6d', asset: '/assets/hih_999.webp' },
  { id: 'aff', name: 'Affliction', color: '#c084fc', asset: '/assets/aff.webp' },
  { id: 'jute', name: 'JUICED UP THE EP', color: '#f59e0b', asset: '/assets/jute.webp' },
]

export const ALL_BOUNCE_ALBUMS: ReadonlyArray<AlbumBounceItem> = ALBUM_BOUNCE_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  color: spec.color,
  art: buildImageUrl(spec.asset) ?? '',
  core: spec.core,
}))

export const CORE_BOUNCE_ALBUMS: ReadonlyArray<AlbumBounceItem> = ALL_BOUNCE_ALBUMS.filter((a) => a.core)

export const BOUNCE_ALBUM_MAP: Readonly<Record<BounceAlbumId, AlbumBounceItem>> = Object.fromEntries(
  ALL_BOUNCE_ALBUMS.map((item) => [item.id, item]),
) as Record<BounceAlbumId, AlbumBounceItem>

const ALBUM_BOX = 108
const BUTTERFLY_BOX = 94
const CORNER_TOLERANCE = 26
const NEAR_MISS = 130
const OBSTACLE_PAD = 8
const TRAIL_COUNT = 6
const SPARK_COUNT = 14
/** A real corner freezes the cover for a beat: scenic hit-stop, not a UI transition. */
const HIT_STOP_S = 0.08
/** Fewest seconds between one scheduled corner and the next. */
const MIN_LEAD_S = 6
const WALLS = ['l', 'r', 't', 'b'] as const
export type BounceWall = (typeof WALLS)[number]

interface ImpactWave {
  id: number
  x: number
  y: number
  color: string
}

interface SparkState {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
}

export interface BounceCue {
  /** Song time of the lyric line the corner is aimed at. */
  key: number
  /** Seconds from now until that line. */
  inSec: number
}

function GlassCoverSleeve({
  art,
  color,
  swapKey,
}: {
  art: string
  color: string
  swapKey: number
}): JSX.Element {
  return (
    <div
      key={swapKey}
      className="dvd-cover-swap relative w-[98px] h-[98px] rounded-[22px] overflow-hidden select-none"
      style={{
        boxShadow: `0 18px 44px ${color}77, 0 0 0 1.75px ${color}cc, inset 0 1px 0 rgba(255,255,255,0.52)`,
      }}
    >
      {art ? (
        <img
          src={art}
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center bg-black/75 font-mono-ui text-lg font-black"
          style={{ color }}
        >
          999
        </div>
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 36%, transparent 54%, rgba(0,0,0,0.24) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[22px]"
        style={{ boxShadow: `inset 0 0 22px ${color}4d` }}
      />
    </div>
  )
}

/** Multi-layered iridescent Legends Never Die butterfly emblem. */
function LndButterflyGraphic({ color }: { color: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 120 104"
      width="88"
      height="76"
      aria-hidden="true"
      style={{ filter: `drop-shadow(0 0 18px ${color}99) drop-shadow(0 8px 18px rgba(0,0,0,0.55))` }}
    >
      <defs>
        <linearGradient id="lnd-wing-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="35%" stopColor={color} stopOpacity="0.58" />
          <stop offset="100%" stopColor={color} stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id="lnd-inner-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.72" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path
        d="M60 48 C48 18 16 6 10 26 C5 42 22 54 44 55 C51 55 56 52 60 48 Z"
        fill="url(#lnd-wing-grad)"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M60 48 C72 18 104 6 110 26 C115 42 98 54 76 55 C69 55 64 52 60 48 Z"
        fill="url(#lnd-wing-grad)"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M58 53 C38 56 18 68 24 84 C30 96 48 90 56 72 C58 66 59 59 58 53 Z"
        fill="url(#lnd-inner-grad)"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M62 53 C82 56 102 68 96 84 C90 96 72 90 64 72 C62 66 61 59 62 53 Z"
        fill="url(#lnd-inner-grad)"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <ellipse cx="30" cy="31" rx="9" ry="5.5" transform="rotate(-24 30 31)" fill="#ffffff" fillOpacity="0.28" />
      <ellipse cx="90" cy="31" rx="9" ry="5.5" transform="rotate(24 90 31)" fill="#ffffff" fillOpacity="0.28" />
      <circle cx="38" cy="74" r="4" fill="#ffffff" fillOpacity="0.3" />
      <circle cx="82" cy="74" r="4" fill="#ffffff" fillOpacity="0.3" />
      <path d="M60 32 L60 76" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeOpacity="0.92" />
      <path d="M60 35 C55 24 49 18 44 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M60 35 C65 24 71 18 76 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="44" cy="16" r="2" fill="#ffffff" fillOpacity="0.85" />
      <circle cx="76" cy="16" r="2" fill="#ffffff" fillOpacity="0.85" />
    </svg>
  )
}

function measureObstacle(host: HTMLElement, obstacle: HTMLElement | null | undefined): Rect | null {
  if (!obstacle) return null
  const hr = host.getBoundingClientRect()
  const or = obstacle.getBoundingClientRect()
  if (or.width < 8 || or.height < 8 || hr.width <= 0 || hr.height <= 0) return null
  return {
    left: or.left - hr.left - OBSTACLE_PAD,
    top: or.top - hr.top - OBSTACLE_PAD,
    right: or.right - hr.left + OBSTACLE_PAD,
    bottom: or.bottom - hr.top + OBSTACLE_PAD,
  }
}

type Ref<T> = RefObject<T | null>

/** Album Covers, Playing Cover & LND Butterfly bouncer. It flies in the largest box the lyrics leave free; wall hits are a
 *  thin light, and with `scheduleCorners` its speed is worked out so a real corner hit lands on a chosen lyric line, with
 *  a glow building toward it. A corner freezes the cover for ~80 ms, then bursts and swaps album (and local WRLD theme). */
export default function StageBouncer({
  enabled,
  logo,
  catalog = 'all',
  reducedMotion,
  playingCoverUrl,
  themeSync = false,
  obstacleRef,
  obstacleRefs,
  underRefs,
  safeInsets,
  sizeRatio,
  scheduleCorners = false,
  cornerCue,
  onCornerHit,
  onBounceAlbumChange,
  onObstacleHit,
  className = 'fixed inset-0 z-0 pointer-events-none overflow-hidden select-none',
}: {
  enabled: boolean
  logo: BounceSpriteId
  /** Which album cover set to cycle through: 'core' (5 studio albums) or 'all' (full discography & Deluxe). */
  catalog?: BounceAlbumCatalog
  reducedMotion: boolean
  /** Current track cover art, used in 'cover' mode (falls back to album covers if absent). */
  playingCoverUrl?: string | null
  /** When true in Album Covers mode, every corner hit updates the local WRLD stage theme. */
  themeSync?: boolean
  /** Elements (a video card, the lyrics, the progress bar) the cover never flies over. */
  obstacleRef?: Ref<HTMLElement>
  obstacleRefs?: ReadonlyArray<Ref<HTMLElement>>
  /** Elements the cover flies under, not around: over them it fades back so the text on top stays crisp. The first
   *  one that the cover enters calls `onObstacleHit`. No walls. */
  underRefs?: ReadonlyArray<Ref<HTMLElement>>
  /** Fractions of the stage kept clear on each side (platform safe zones). */
  safeInsets?: { t: number; r: number; b: number; l: number }
  /** Cover width as a fraction of the stage width, instead of the fixed size. */
  sizeRatio?: number
  /** Work out the speed so a corner hit lands on the cue. Without it the cover just cruises. */
  scheduleCorners?: boolean
  /** Next lyric line to aim at (target null), or how long until a line already aimed at. */
  cornerCue?: (target: number | null, minLead: number) => BounceCue | null
  onCornerHit?: () => void
  /** Fires on every corner hit in Album Covers mode when themeSync is enabled. */
  onBounceAlbumChange?: (albumId: BounceAlbumId, albumName: string, isCorner: boolean) => void
  /** The cover hit the wall that rests on obstacle `index` (the lyrics push back). */
  onObstacleHit?: (index: number, wall: BounceWall) => void
  className?: string
}): JSX.Element | null {
  const albumItems = useMemo(
    () => (catalog === 'core' ? CORE_BOUNCE_ALBUMS : ALL_BOUNCE_ALBUMS),
    [catalog],
  )
  const albumItemsRef = useRef<ReadonlyArray<AlbumBounceItem>>(albumItems)
  albumItemsRef.current = albumItems

  const hostRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const washRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const wallRefs = useRef<Array<HTMLDivElement | null>>([])
  const trailRefs = useRef<Array<HTMLDivElement | null>>([])
  const sparkRefs = useRef<Array<HTMLDivElement | null>>([])
  const latest = useRef({ onCornerHit, onBounceAlbumChange, onObstacleHit, themeSync, obstacleRef, obstacleRefs, underRefs, safeInsets, sizeRatio, scheduleCorners, cornerCue })
  latest.current = { onCornerHit, onBounceAlbumChange, onObstacleHit, themeSync, obstacleRef, obstacleRefs, underRefs, safeInsets, sizeRatio, scheduleCorners, cornerCue }
  const safeLogo = normalizeBounceSprite(logo)
  const logoRef = useRef<BounceSpriteId>(safeLogo)
  logoRef.current = safeLogo

  const [albumIdx, setAlbumIdx] = useState(0)
  const [swapCount, setSwapCount] = useState(0)
  const [waves, setWaves] = useState<ImpactWave[]>([])
  const [cornerToast, setCornerToast] = useState<{ id: number; label: string; color: string; art?: string } | null>(null)
  const albumIdxRef = useRef(0)
  albumIdxRef.current = albumIdx

  const baseBox = safeLogo === 'butterfly' ? BUTTERFLY_BOX : ALBUM_BOX
  const [boxPx, setBoxPx] = useState(baseBox)
  const boxRef = useRef(boxPx)
  boxRef.current = boxPx

  useEffect(() => {
    if (!enabled || reducedMotion) return
    const host = hostRef.current
    const item = itemRef.current
    if (!host || !item) return

    // Live audio punch (0..1) fed from the audio meter without React re-renders
    let audioBeat = 0
    const offMeter = listenToMeter((m) => {
      const punch = Math.min(1, Math.max(0, m.punch > 1 ? (m.punch - 1) * 1.4 : m.punch * 0.25))
      audioBeat = Math.max(audioBeat, punch)
    })

    const wantedSize = (): number => {
      const ratio = latest.current.sizeRatio
      const base = logoRef.current === 'butterfly' ? BUTTERFLY_BOX : ALBUM_BOX
      return ratio ? Math.round(Math.min(260, Math.max(64, host.clientWidth * ratio))) : base
    }
    const measureField = (size: number): Field => {
      const { obstacleRefs: many, obstacleRef: one } = latest.current
      const els = many ? many.map((r) => r.current) : [one?.current]
      return computeField({ w: host.clientWidth, h: host.clientHeight }, latest.current.safeInsets, els.map((el) => measureObstacle(host, el)), size)
    }

    let size = wantedSize()
    if (size !== boxRef.current) setBoxPx(size)
    let field = measureField(size)
    let fieldCheck = 0
    const measureUnder = (): Array<Rect | null> => (latest.current.underRefs ?? []).map((r) => measureObstacle(host, r.current))
    let under = measureUnder()
    let dim = 1
    let wasUnder = -1
    let lastNudge = -10

    // Cruise speed follows the size of the box it flies in, so a narrow story frame isn't a blur.
    const cruise = (): { vx: number; vy: number } => {
      if (!latest.current.scheduleCorners) return { vx: 215, vy: 172 }
      const k = Math.min(1.4, Math.max(0.7, Math.sqrt((field.maxX - field.minX + size) * (field.maxY - field.minY + size)) / 560))
      return { vx: 215 * k, vy: 172 * k }
    }

    let x = field.minX + Math.random() * (field.maxX - field.minX)
    let y = field.minY + Math.random() * (field.maxY - field.minY)
    let dirX = Math.random() < 0.5 ? 1 : -1
    let dirY = Math.random() < 0.5 ? 1 : -1
    let { vx, vy } = cruise()

    // 2nd-order spring for the squash & stretch of an impact
    let sx = 1
    let sy = 1
    let vsx = 0
    let vsy = 0
    let rotZ = 0
    let rotZVel = 0
    let elapsed = 0

    // Sim clock in seconds. It runs through the hit-stop, so it keeps pace with the song.
    let simT = 0
    let freezeUntil = 0
    let lastCornerAt = -10
    let glowBoost = 0
    let needsPlan = true
    let nextDriftCheck = 1
    let plan: { at: number; key: number | null; fromCue: boolean } | null = null

    const trailHistory: Array<{ x: number; y: number }> = Array.from({ length: TRAIL_COUNT * 4 }, () => ({ x, y }))
    let trailHead = 0
    let trailColor = ''

    const sparks: SparkState[] = Array.from({ length: SPARK_COUNT }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0.45, size: 1, color: ALL_BOUNCE_ALBUMS[0].color,
    }))

    let last = performance.now()
    let raf = 0
    let waveSeq = 1
    const timers = new Set<number>()
    const later = (fn: () => void, ms: number): void => {
      const id = window.setTimeout(() => { timers.delete(id); fn() }, ms)
      timers.add(id)
    }

    const currentColor = (): string => {
      const items = albumItemsRef.current
      return items[albumIdxRef.current % items.length].color
    }

    // A short thin light where the cover touched a wall; brighter against the lyrics. WAAPI, one tiny element per wall.
    const wallFlash = (wall: BounceWall, cx: number, cy: number, color: string, strong: boolean): void => {
      const el = wallRefs.current[WALLS.indexOf(wall)]
      if (!el) return
      const vertical = wall === 'l' || wall === 'r'
      const len = strong ? 240 : 130
      const th = strong ? 5 : 3
      el.style.width = `${vertical ? th : len}px`
      el.style.height = `${vertical ? len : th}px`
      el.style.background = `linear-gradient(${vertical ? 'to bottom' : 'to right'}, transparent, ${color}, transparent)`
      el.style.boxShadow = `0 0 ${strong ? 30 : 16}px ${color}`
      el.style.transform = vertical
        ? `translate3d(${(cx - (wall === 'l' ? 0 : th)).toFixed(1)}px, ${(cy - len / 2).toFixed(1)}px, 0)`
        : `translate3d(${(cx - len / 2).toFixed(1)}px, ${(cy - (wall === 't' ? 0 : th)).toFixed(1)}px, 0)`
      el.animate(
        [{ opacity: 0 }, { opacity: strong ? 1 : 0.7, offset: 0.18 }, { opacity: 0 }],
        { duration: strong ? 180 : 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    }

    const burstSparks = (cx: number, cy: number, nx: number, ny: number, color: string): void => {
      for (let i = 0; i < SPARK_COUNT; i++) {
        const spread = (i / (SPARK_COUNT - 1) - 0.5) * 2.3
        const ang = Math.atan2(ny, nx) + spread + (Math.random() - 0.5) * 0.3
        const spd = 240 + Math.random() * 220
        const el = sparkRefs.current[i]
        if (el) { el.style.backgroundColor = color; el.style.boxShadow = `0 0 10px ${color}` }
        sparks[i] = {
          active: true, x: cx, y: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0,
          maxLife: 0.55 + Math.random() * 0.2, size: 0.7 + Math.random() * 0.8, color,
        }
      }
    }

    const cornerWash = (cx: number, cy: number, color: string): void => {
      const el = washRef.current
      if (!el) return
      el.style.background = `radial-gradient(circle 720px at ${cx.toFixed(0)}px ${cy.toFixed(0)}px, ${color}a6 0%, ${color}30 46%, transparent 76%)`
      el.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.12 }, { opacity: 0 }], { duration: 950, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }

    // Speeds so both axes reach a wall together at the cue (or at a random moment when there is no cue).
    const makePlan = (): void => {
      needsPlan = false
      plan = null
      if (!latest.current.scheduleCorners) return
      const cue = latest.current.cornerCue?.(null, MIN_LEAD_S) ?? null
      const frozen = Math.max(0, freezeUntil - simT)
      const base = cruise()
      const p = planCorner({
        w: field.maxX - field.minX, h: field.maxY - field.minY,
        px: x - field.minX, py: y - field.minY,
        dirX: dirX as 1 | -1, dirY: dirY as 1 | -1,
        baseVx: base.vx, baseVy: base.vy,
        T: (cue ? cue.inSec : 7 + Math.random() * 4) - frozen,
        tol: CORNER_TOLERANCE, near: NEAR_MISS,
        edge: { l: field.tags.l === 'edge', r: field.tags.r === 'edge', t: field.tags.t === 'edge', b: field.tags.b === 'edge' },
      })
      if (!p) { vx = base.vx; vy = base.vy; return }
      vx = p.vx
      vy = p.vy
      plan = { at: simT + frozen + p.T, key: cue && p.exact ? cue.key : null, fromCue: cue !== null }
      const glow = glowRef.current
      if (glow) {
        const items = albumItemsRef.current
        const nextColor = items[(albumIdxRef.current + 1) % items.length].color
        const gx = p.fx === 'l' ? field.minX : field.maxX + size
        const gy = p.fy === 't' ? field.minY : field.maxY + size
        glow.style.background = `radial-gradient(circle, ${nextColor}cc 0%, ${nextColor}44 38%, transparent 70%)`
        glow.style.transform = `translate3d(${(gx - 260).toFixed(0)}px, ${(gy - 260).toFixed(0)}px, 0)`
      }
    }

    const onCorner = (cx: number, cy: number, nx: number, ny: number): void => {
      lastCornerAt = simT
      freezeUntil = simT + HIT_STOP_S
      sx = 0.64; sy = 1.36; vsx = 3.4; vsy = -3.2
      rotZVel = (nx * ny >= 0 ? 1 : -1) * 150

      const items = albumItemsRef.current
      const nextIdx = (albumIdxRef.current + 1) % items.length
      albumIdxRef.current = nextIdx
      const next = items[nextIdx]
      const mode = logoRef.current
      setAlbumIdx(nextIdx)
      if (mode === 'albums') setSwapCount((c) => c + 1)

      const id = waveSeq++
      setWaves((prev) => [...prev.slice(-2), { id, x: cx, y: cy, color: next.color }])
      later(() => setWaves((prev) => prev.filter((w) => w.id !== id)), 900)
      burstSparks(cx, cy, nx, ny, next.color)
      cornerWash(cx, cy, next.color)

      if (mode === 'albums' && latest.current.themeSync) latest.current.onBounceAlbumChange?.(next.id, next.name, true)
      latest.current.onCornerHit?.()
      setCornerToast(
        mode === 'albums'
          ? { id, label: `CORNER HIT · ${next.name.toUpperCase()}`, color: next.color, art: next.art }
          : { id, label: 'CORNER HIT · 999', color: next.color },
      )
      later(() => setCornerToast((t) => (t && t.id === id ? null : t)), 1700)
      glowBoost = 0
      makePlan()
    }

    const step = (now: number): void => {
      raf = requestAnimationFrame(step)
      if (document.hidden) {
        last = now
        return
      }
      const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000))
      last = now
      elapsed += dt
      simT += dt
      audioBeat *= Math.exp(-8 * dt)
      glowBoost *= Math.exp(-3 * dt)

      // Re-measure every ~250ms (modal open, video metadata, window resize, lyrics panel sliding in)
      fieldCheck += dt
      if (fieldCheck >= 0.25) {
        fieldCheck = 0
        const nextSize = wantedSize()
        if (nextSize !== size) { size = nextSize; setBoxPx(size) }
        under = measureUnder()
        const nf = measureField(size)
        const moved = Math.abs(nf.minX - field.minX) + Math.abs(nf.maxX - field.maxX) + Math.abs(nf.minY - field.minY) + Math.abs(nf.maxY - field.maxY)
        if (moved > 3) {
          field = nf
          x = Math.min(field.maxX, Math.max(field.minX, x))
          y = Math.min(field.maxY, Math.max(field.minY, y))
          if (latest.current.scheduleCorners) needsPlan = true
        }
      }

      // The song moved (seek, pause, another song): aim again, at the next wall hit so the speed change is hidden.
      if (latest.current.scheduleCorners && simT >= nextDriftCheck) {
        nextDriftCheck = simT + 1
        const remaining = plan ? plan.at - simT : -1
        if (!plan || remaining < -0.5) needsPlan = true
        else if (plan.key !== null) {
          const c = latest.current.cornerCue?.(plan.key, 0) ?? null
          if ((!c || Math.abs(c.inSec - remaining) > 1.2) && remaining > 1.8) needsPlan = true
        } else if (!plan.fromCue && latest.current.cornerCue?.(null, MIN_LEAD_S)) needsPlan = true
      }

      // First plan (and any plan with no corner pending) is made at once; later ones wait for a wall hit.
      if (needsPlan && plan === null) makePlan()

      if (simT >= freezeUntil) {
        x += dirX * vx * dt
        y += dirY * vy * dt
      }

      const hitL = x <= field.minX
      const hitR = x >= field.maxX
      const hitT = y <= field.minY
      const hitB = y >= field.maxY
      if (hitL || hitR || hitT || hitB) {
        if (hitL) { x = field.minX; dirX = 1 } else if (hitR) { x = field.maxX; dirX = -1 }
        if (hitT) { y = field.minY; dirY = 1 } else if (hitB) { y = field.maxY; dirY = -1 }
        const hitX = hitL || hitR
        const hitY = hitT || hitB
        const gapX = Math.min(x - field.minX, field.maxX - x) // how far x is from a side wall
        const gapY = Math.min(y - field.minY, field.maxY - y)
        const gap = Math.min(hitX ? gapY : Infinity, hitY ? gapX : Infinity)
        const color = currentColor()
        const wallOf = (w: BounceWall): void => {
          const tag = field.tags[w]
          const cx = w === 'l' ? field.minX : w === 'r' ? field.maxX + size : x + size / 2
          const cy = w === 't' ? field.minY : w === 'b' ? field.maxY + size : y + size / 2
          wallFlash(w, cx, cy, color, tag !== 'edge')
          if (tag !== 'edge') latest.current.onObstacleHit?.(tag, w)
        }
        if (hitL) wallOf('l'); else if (hitR) wallOf('r')
        if (hitT) wallOf('t'); else if (hitB) wallOf('b')

        if (gap <= CORNER_TOLERANCE && simT - lastCornerAt > 1.5) {
          const cornerX = x - field.minX < field.maxX - x ? field.minX : field.maxX + size
          const cornerY = y - field.minY < field.maxY - y ? field.minY : field.maxY + size
          onCorner(cornerX, cornerY, cornerX < host.clientWidth / 2 ? 1 : -1, cornerY < host.clientHeight / 2 ? 1 : -1)
        } else {
          if (gap > CORNER_TOLERANCE && gap <= NEAR_MISS) glowBoost = Math.max(glowBoost, 0.85 * (1 - gap / NEAR_MISS) + 0.25)
          if (hitX) { sx = 0.86; sy = 1.14; vsx = 1.7; vsy = -1.5; rotZVel = (dirY > 0 ? 1 : -1) * (hitL ? 70 : -70) }
          if (hitY) { sx = 1.14; sy = 0.86; vsx = -1.5; vsy = 1.7; rotZVel = (dirX > 0 ? 1 : -1) * (hitT ? -70 : 70) }
          if (needsPlan) makePlan()
        }
      }

      // Damped spring back to rest (k=260, d=14), then a gentle sway
      const ax = (1 - sx) * 260 - vsx * 14
      const ay = (1 - sy) * 260 - vsy * 14
      vsx += ax * dt
      vsy += ay * dt
      sx += vsx * dt
      sy += vsy * dt
      rotZVel *= Math.exp(-3.4 * dt)
      rotZ += rotZVel * dt
      rotZ += (Math.sin(elapsed * 2.6) * 7 + dirX * 5 - rotZ) * (1 - Math.exp(-2.8 * dt))

      // Under the lyrics the cover fades back (opacity only) and the lyrics get one small push as it arrives.
      const ccx = x + size / 2
      const ccy = y + size / 2
      let inside = -1
      for (let i = 0; i < under.length; i++) {
        const u = under[i]
        if (u && ccx > u.left && ccx < u.right && ccy > u.top && ccy < u.bottom) { inside = i; break }
      }
      dim += ((inside >= 0 ? 0.38 : 1) - dim) * (1 - Math.exp(-9 * dt))
      item.style.opacity = dim.toFixed(3)
      if (inside >= 0 && wasUnder < 0 && simT - lastNudge > 0.5) {
        lastNudge = simT
        const u = under[inside] as Rect
        latest.current.onObstacleHit?.(inside, ccx < (u.left + u.right) / 2 ? 'r' : 'l')
      }
      wasUnder = inside

      const beatScale = 1 + audioBeat * 0.085
      item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rotZ.toFixed(2)}deg) scale(${(sx * beatScale).toFixed(3)}, ${(sy * beatScale).toFixed(3)})`

      // Glow building toward the planned corner: opacity only.
      const glow = glowRef.current
      if (glow) {
        const toCorner = plan ? Math.min(1, Math.max(0, 1 - (plan.at - simT) / 4.5)) : 0
        glow.style.opacity = Math.min(0.85, toCorner * toCorner * 0.6 + (plan ? glowBoost * 0.5 : 0)).toFixed(3)
      }

      // Luminous trail (transform/opacity per frame; the colour is written only when the album changes)
      trailHistory[trailHead] = { x: x + size * 0.5, y: y + size * 0.5 }
      trailHead = (trailHead + 1) % trailHistory.length
      const activeCol = currentColor()
      const recolor = activeCol !== trailColor
      trailColor = activeCol
      for (let i = 0; i < TRAIL_COUNT; i++) {
        const el = trailRefs.current[i]
        if (!el) continue
        const pt = trailHistory[(trailHead - 1 - (i + 1) * 3 + trailHistory.length) % trailHistory.length]
        const frac = 1 - i / TRAIL_COUNT
        el.style.transform = `translate3d(${(pt.x - 28).toFixed(1)}px, ${(pt.y - 28).toFixed(1)}px, 0) scale(${(0.25 + frac * 0.65).toFixed(3)})`
        el.style.opacity = (frac * 0.28).toFixed(3)
        if (recolor) el.style.background = `radial-gradient(circle, ${activeCol}cc 0%, ${activeCol}22 60%, transparent 75%)`
      }

      // Corner sparks: fixed-size dots, moved and faded with transform/opacity only
      for (let i = 0; i < SPARK_COUNT; i++) {
        const sp = sparks[i]
        const el = sparkRefs.current[i]
        if (!el) continue
        if (!sp.active) {
          if (el.style.opacity !== '0') el.style.opacity = '0'
          continue
        }
        sp.life += dt
        if (sp.life >= sp.maxLife) { sp.active = false; el.style.opacity = '0'; continue }
        const damp = Math.exp(-3.2 * dt)
        sp.vx *= damp
        sp.vy *= damp
        sp.x += sp.vx * dt
        sp.y += sp.vy * dt
        const p = sp.life / sp.maxLife
        el.style.opacity = ((1 - p) * 0.95).toFixed(3)
        el.style.transform = `translate3d(${(sp.x - 6).toFixed(1)}px, ${(sp.y - 6).toFixed(1)}px, 0) scale(${(sp.size * (1 - p * 0.6)).toFixed(3)})`
      }
    }

    item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      offMeter()
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [enabled, reducedMotion])

  if (!enabled || reducedMotion) return null

  const activeAlbum = albumItems[albumIdx % albumItems.length]
  const sleeveArt = safeLogo === 'cover' && playingCoverUrl ? playingCoverUrl : activeAlbum.art
  const k = boxPx / baseBox

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      {/* Corner color bloom: painted once per corner, then only its opacity moves */}
      <div ref={washRef} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />

      {/* Glow at the corner the cover is heading for, growing as the cue nears */}
      <div ref={glowRef} className="pointer-events-none absolute top-0 left-0 w-[520px] h-[520px] rounded-full will-change-transform" style={{ opacity: 0 }} />

      {/* Thin light where the cover touches a wall (one per wall, reused) */}
      {WALLS.map((w, i) => (
        <div
          key={`wall-${w}`}
          ref={(el) => { wallRefs.current[i] = el }}
          className="pointer-events-none absolute top-0 left-0 rounded-full will-change-transform"
          style={{ opacity: 0 }}
        />
      ))}

      {/* 6-node luminous motion trail behind the bouncing cover */}
      {Array.from({ length: TRAIL_COUNT }).map((_, i) => (
        <div
          key={`trail-${i}`}
          ref={(el) => { trailRefs.current[i] = el }}
          className="pointer-events-none absolute top-0 left-0 w-14 h-14 rounded-full will-change-transform"
          style={{ opacity: 0, filter: 'blur(6px)' }}
        />
      ))}

      {/* Pooled corner sparks */}
      {Array.from({ length: SPARK_COUNT }).map((_, i) => (
        <div
          key={`spark-${i}`}
          ref={(el) => { sparkRefs.current[i] = el }}
          className="pointer-events-none absolute top-0 left-0 w-3 h-3 rounded-full will-change-transform"
          style={{ opacity: 0 }}
        />
      ))}

      {/* Corner supernova */}
      {waves.map((w) => (
        <div
          key={w.id}
          className="pointer-events-none absolute rounded-full dvd-corner-wave"
          style={{
            left: w.x,
            top: w.y,
            width: 320,
            height: 320,
            border: `2.5px solid ${w.color}`,
            background: `radial-gradient(circle, ${w.color}78 0%, ${w.color}28 55%, transparent 76%)`,
            boxShadow: `0 0 60px ${w.color}99`,
          }}
        />
      ))}

      {/* Album cover sleeve or LND butterfly */}
      <div
        ref={itemRef}
        className="absolute top-0 left-0 flex items-center justify-center will-change-transform"
        style={{ width: boxPx, height: boxPx }}
      >
        <div className="flex items-center justify-center shrink-0" style={{ width: baseBox, height: baseBox, transform: k === 1 ? undefined : `scale(${k.toFixed(3)})` }}>
          {safeLogo === 'butterfly' ? (
            <LndButterflyGraphic color={activeAlbum.color} />
          ) : (
            <GlassCoverSleeve art={sleeveArt} color={activeAlbum.color} swapKey={safeLogo === 'albums' ? swapCount : 0} />
          )}
        </div>
      </div>

      {/* Liquid Glass corner banner: translucent, blurred, light text with a soft shadow, below the platform's top bar */}
      {cornerToast && (
        <div
          key={cornerToast.id}
          className={`dvd-corner-toast absolute left-1/2 ${safeInsets ? 'top-[10%]' : 'top-[18%]'} z-40 inline-flex items-center gap-2.5 px-4 py-2 rounded-full border text-xs font-mono-ui font-bold tracking-[0.14em] uppercase text-white backdrop-blur-xl`}
          style={{
            borderColor: `${cornerToast.color}cc`,
            // Tinted glass over a deep, translucent base so the white text keeps >= 4.5:1 even on a pale stage.
            background: `linear-gradient(135deg, ${cornerToast.color}66, rgba(255,255,255,0.06)), rgba(10, 14, 28, 0.58)`,
            textShadow: '0 1px 10px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.5)',
            boxShadow: `0 10px 30px ${cornerToast.color}44, inset 0 1px 0 rgba(255,255,255,0.4)`,
          }}
        >
          {cornerToast.art && (
            <img src={cornerToast.art} alt="" className="w-5 h-5 rounded-md object-cover border border-white/25" />
          )}
          <span>{cornerToast.label}</span>
        </div>
      )}
    </div>
  )
}
