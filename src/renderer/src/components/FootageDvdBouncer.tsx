import { useEffect, useRef, useState } from 'react'
import { getSkin, type SkinId } from '../lib/skins'
import { buildImageUrl } from '../lib/juicewrldApi'
import { listenToMeter } from '../desktop/meter'

export type DvdLogoId = 'albums' | 'cover' | 'butterfly'

export const DVD_LOGO_OPTIONS: ReadonlyArray<{ id: DvdLogoId; label: string }> = [
  { id: 'albums', label: 'Album Covers' },
  { id: 'cover', label: 'Playing Cover' },
  { id: 'butterfly', label: 'LND Butterfly' },
]

export function normalizeDvdLogo(value: unknown): DvdLogoId {
  return value === 'albums' || value === 'cover' || value === 'butterfly' ? value : 'albums'
}

interface AlbumBounceItem {
  id: SkinId
  name: string
  color: string
  art: string
}

const ALBUM_BOUNCE_SPECS: ReadonlyArray<{ id: SkinId; color: string }> = [
  { id: '999', color: '#f0404f' },
  { id: 'gbgr', color: '#4da6ff' },
  { id: 'drfl', color: '#ff8426' },
  { id: 'lnd', color: '#e864c0' },
  { id: 'fd', color: '#4ce4eb' },
]

const ALBUM_ITEMS: ReadonlyArray<AlbumBounceItem> = ALBUM_BOUNCE_SPECS.map(({ id, color }) => {
  const skin = getSkin(id)
  return {
    id,
    name: skin.name,
    color,
    art: buildImageUrl(skin.art ?? `/assets/${id}.webp`) ?? '',
  }
})

const ALBUM_BOX = 108
const BUTTERFLY_BOX = 94
const CORNER_TOLERANCE = 32
const TRAIL_COUNT = 6
const SPARK_COUNT = 8

type EdgeSide = 'left' | 'right' | 'top' | 'bottom'

interface ImpactWave {
  id: number
  x: number
  y: number
  color: string
  corner: boolean
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

/** Kinetic 60-120fps Album Covers, Playing Cover & LND Butterfly bouncer with 2nd-order elastic spring physics,
 *  3D flip/banking, bass-reactive pulse, motion trail, spark bursts, and optional live Ambience theme sync. */
export default function FootageDvdBouncer({
  enabled,
  logo,
  reducedMotion,
  playingCoverUrl,
  themeSync = false,
  onCornerHit,
  onBounceAlbumChange,
  className = 'fixed inset-0 z-0 pointer-events-none overflow-hidden select-none',
}: {
  enabled: boolean
  logo: DvdLogoId
  reducedMotion: boolean
  /** Current track cover art, used in 'cover' mode (falls back to album covers if absent). */
  playingCoverUrl?: string | null
  /** When true in Album Covers mode, every wall hit immediately updates the Ambience theme. */
  themeSync?: boolean
  onCornerHit?: () => void
  /** Fires on every wall bounce in Album Covers mode when themeSync is enabled. */
  onBounceAlbumChange?: (albumId: SkinId, albumName: string, isCorner: boolean) => void
  className?: string
}): JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const trailRefs = useRef<Array<HTMLDivElement | null>>([])
  const sparkRefs = useRef<Array<HTMLDivElement | null>>([])
  const onCornerHitRef = useRef(onCornerHit)
  onCornerHitRef.current = onCornerHit
  const onBounceAlbumChangeRef = useRef(onBounceAlbumChange)
  onBounceAlbumChangeRef.current = onBounceAlbumChange
  const themeSyncRef = useRef(themeSync)
  themeSyncRef.current = themeSync
  const safeLogo = normalizeDvdLogo(logo)
  const logoRef = useRef<DvdLogoId>(safeLogo)
  logoRef.current = safeLogo

  const [albumIdx, setAlbumIdx] = useState(0)
  const [swapCount, setSwapCount] = useState(0)
  const [edgeWash, setEdgeWash] = useState<{ color: string; xPct: number; yPct: number; side: EdgeSide; active: boolean }>({
    color: ALBUM_ITEMS[0].color,
    xPct: 50,
    yPct: 50,
    side: 'left',
    active: false,
  })
  const [waves, setWaves] = useState<ImpactWave[]>([])
  const [cornerToast, setCornerToast] = useState<{ label: string; color: string; art?: string } | null>(null)
  const albumIdxRef = useRef(0)
  albumIdxRef.current = albumIdx

  const boxSize = safeLogo === 'butterfly' ? BUTTERFLY_BOX : ALBUM_BOX
  const boxSizeRef = useRef(boxSize)
  boxSizeRef.current = boxSize

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

    let x = 48 + Math.random() * Math.max(40, host.clientWidth * 0.35)
    let y = 48 + Math.random() * Math.max(40, host.clientHeight * 0.3)
    // Lively 120fps kinetic cruise speed (~260 px/s diagonal) with post-bounce speed burst
    const baseVx = 215
    const baseVy = 172
    let dirX = Math.random() < 0.5 ? 1 : -1
    let dirY = Math.random() < 0.5 ? 1 : -1
    let speedBoost = 1

    // 2nd-order spring oscillator for elastic squash & stretch
    let sx = 1
    let sy = 1
    let vsx = 0
    let vsy = 0

    // Continuous lively 3D tilt, spin, and flip momentum
    let rotZ = 0
    let rotZVel = 18 * dirX
    let flipY = 0
    let flipYVel = 0
    let elapsed = 0

    // Ring buffer for smooth 6-node luminous motion trail
    const trailHistory: Array<{ x: number; y: number }> = Array.from({ length: TRAIL_COUNT * 4 }, () => ({ x, y }))
    let trailHead = 0

    // Pooled GPU impact sparks (zero React state updates)
    const sparks: SparkState[] = Array.from({ length: SPARK_COUNT }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0.45, size: 6, color: ALBUM_ITEMS[0].color,
    }))

    let last = performance.now()
    let raf = 0
    let waveSeq = 1
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    let washTimer: ReturnType<typeof setTimeout> | null = null

    const spawnWave = (wx: number, wy: number, color: string, corner: boolean): void => {
      const id = waveSeq++
      setWaves((prev) => [...prev.slice(-4), { id, x: wx, y: wy, color, corner }])
      window.setTimeout(() => {
        setWaves((prev) => prev.filter((w) => w.id !== id))
      }, corner ? 900 : 580)
    }

    const burstSparks = (cx: number, cy: number, nx: number, ny: number, color: string, corner: boolean): void => {
      const count = corner ? SPARK_COUNT : Math.min(6, SPARK_COUNT)
      for (let i = 0; i < count; i++) {
        const spread = ((i / Math.max(1, count - 1)) - 0.5) * 2.1
        const baseAngle = Math.atan2(ny, nx)
        const ang = baseAngle + spread + (Math.random() - 0.5) * 0.28
        const spd = (corner ? 260 : 190) + Math.random() * 190
        sparks[i] = {
          active: true,
          x: cx,
          y: cy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0,
          maxLife: (corner ? 0.58 : 0.42) + Math.random() * 0.16,
          size: corner ? 8 + Math.random() * 5 : 5 + Math.random() * 4,
          color,
        }
      }
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
      audioBeat *= Math.exp(-8 * dt)
      speedBoost += (1 - speedBoost) * (1 - Math.exp(-4.5 * dt))

      const size = boxSizeRef.current
      const maxX = Math.max(0, host.clientWidth - size)
      const maxY = Math.max(0, host.clientHeight - size)

      x += dirX * baseVx * speedBoost * dt
      y += dirY * baseVy * speedBoost * dt

      let hitX = false
      let hitY = false
      let hitLeft = false
      let hitTop = false
      if (x <= 0) { x = 0; dirX = 1; hitX = true; hitLeft = true }
      else if (x >= maxX) { x = maxX; dirX = -1; hitX = true }

      if (y <= 0) { y = 0; dirY = 1; hitY = true; hitTop = true }
      else if (y >= maxY) { y = maxY; dirY = -1; hitY = true }

      if (hitX || hitY) {
        // Post-impact kinetic speed kick
        speedBoost = 1.42

        // Real 2nd-order elastic squash & stretch impact impulse
        if (hitX) {
          sx = 0.68
          sy = 1.32
          vsx = 2.6
          vsy = -2.4
          rotZVel = (dirY > 0 ? 1 : -1) * (hitLeft ? 155 : -155)
        }
        if (hitY) {
          sx = 1.32
          sy = 0.68
          vsx = -2.4
          vsy = 2.6
          rotZVel = (dirX > 0 ? 1 : -1) * (hitTop ? -155 : 155)
        }
        // Crisp 3D sleeve flip burst on every wall hit
        flipYVel = (hitLeft || hitTop ? 1 : -1) * 920

        const nearCorner =
          (hitX && (y <= CORNER_TOLERANCE || y >= maxY - CORNER_TOLERANCE)) ||
          (hitY && (x <= CORNER_TOLERANCE || x >= maxX - CORNER_TOLERANCE))

        const mode = logoRef.current
        const nextAlbumIdx = (albumIdxRef.current + 1) % ALBUM_ITEMS.length
        albumIdxRef.current = nextAlbumIdx
        const nextAlbum = ALBUM_ITEMS[nextAlbumIdx]

        setAlbumIdx(nextAlbumIdx)
        if (mode === 'albums') setSwapCount((c) => c + 1)

        const cx = hitX ? (hitLeft ? 6 : host.clientWidth - 6) : x + size * 0.5
        const cy = hitY ? (hitTop ? 6 : host.clientHeight - 6) : y + size * 0.5
        const nx = hitX ? (hitLeft ? 1 : -1) : 0
        const ny = hitY ? (hitTop ? 1 : -1) : 0
        const side: EdgeSide = hitX ? (hitLeft ? 'left' : 'right') : (hitTop ? 'top' : 'bottom')

        spawnWave(cx, cy, nextAlbum.color, nearCorner)
        burstSparks(cx, cy, nx || dirX * 0.4, ny || dirY * 0.4, nextAlbum.color, nearCorner)

        const xPct = host.clientWidth > 0 ? Math.round((cx / host.clientWidth) * 100) : 50
        const yPct = host.clientHeight > 0 ? Math.round((cy / host.clientHeight) * 100) : 50
        setEdgeWash({ color: nextAlbum.color, xPct, yPct, side, active: true })
        if (washTimer) clearTimeout(washTimer)
        washTimer = setTimeout(() => {
          setEdgeWash((w) => ({ ...w, active: false }))
        }, nearCorner ? 1900 : 1200)

        // Immediately switch the Ambience theme on EVERY wall bounce when Theme Sync is enabled
        if (mode === 'albums' && themeSyncRef.current) {
          onBounceAlbumChangeRef.current?.(nextAlbum.id, nextAlbum.name, nearCorner)
        }

        if (nearCorner) {
          onCornerHitRef.current?.()
          setCornerToast(
            mode === 'albums'
              ? { label: `CORNER HIT · ${nextAlbum.name.toUpperCase()}`, color: nextAlbum.color, art: nextAlbum.art }
              : { label: 'CORNER HIT · 999', color: nextAlbum.color },
          )
          if (toastTimer) clearTimeout(toastTimer)
          toastTimer = setTimeout(() => setCornerToast(null), 1700)
        }
      }

      // Integrate 2nd-order damped harmonic spring for lively bouncy recovery (k=260, d=14)
      const k = 260
      const d = 14
      const ax = (1 - sx) * k - vsx * d
      const ay = (1 - sy) * k - vsy * d
      vsx += ax * dt
      vsy += ay * dt
      sx += vsx * dt
      sy += vsy * dt

      // Continuous lively flight tilt + damped post-bounce spin + 3D Y flip settling back to 0°
      rotZVel *= Math.exp(-3.4 * dt)
      rotZ += rotZVel * dt
      // Gentle organic cruise sway so the cover NEVER feels frozen in mid-air
      const cruiseSway = Math.sin(elapsed * 2.6) * 9 + dirX * 6
      rotZ += (cruiseSway - rotZ) * (1 - Math.exp(-2.8 * dt))

      flipYVel *= Math.exp(-6.2 * dt)
      flipY += flipYVel * dt
      // Settle flipY smoothly onto the nearest full 360° so the cover always faces forward after flipping
      const nearest360 = Math.round(flipY / 360) * 360
      flipY += (nearest360 - flipY) * (1 - Math.exp(-5.5 * dt))

      // Subtle 3D banking into movement vector + audio beat breathing
      const tiltX = -dirY * 11 + Math.cos(elapsed * 2.1) * 5
      const tiltY = dirX * 12 + flipY
      const beatScale = 1 + audioBeat * 0.085

      item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) perspective(720px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg) scale3d(${(sx * beatScale).toFixed(3)}, ${(sy * beatScale).toFixed(3)}, 1)`

      // Update 6-node luminous motion trail directly in DOM (0 React renders)
      trailHistory[trailHead] = { x: x + size * 0.5, y: y + size * 0.5 }
      trailHead = (trailHead + 1) % trailHistory.length
      const activeCol = ALBUM_ITEMS[albumIdxRef.current % ALBUM_ITEMS.length].color
      for (let i = 0; i < TRAIL_COUNT; i++) {
        const el = trailRefs.current[i]
        if (!el) continue
        const backIdx = (trailHead - 1 - (i + 1) * 3 + trailHistory.length) % trailHistory.length
        const pt = trailHistory[backIdx]
        const frac = 1 - i / TRAIL_COUNT
        const s = 0.25 + frac * 0.65
        el.style.transform = `translate3d(${(pt.x - 28).toFixed(1)}px, ${(pt.y - 28).toFixed(1)}px, 0) scale(${s.toFixed(3)})`
        el.style.opacity = (frac * 0.28).toFixed(3)
        el.style.background = `radial-gradient(circle, ${activeCol}cc 0%, ${activeCol}22 60%, transparent 75%)`
      }

      // Update pooled GPU spark particles
      for (let i = 0; i < SPARK_COUNT; i++) {
        const sp = sparks[i]
        const el = sparkRefs.current[i]
        if (!el) continue
        if (!sp.active) {
          el.style.opacity = '0'
          continue
        }
        sp.life += dt
        if (sp.life >= sp.maxLife) {
          sp.active = false
          el.style.opacity = '0'
          continue
        }
        sp.vx *= Math.exp(-3.2 * dt)
        sp.vy *= Math.exp(-3.2 * dt)
        sp.x += sp.vx * dt
        sp.y += sp.vy * dt
        const p = sp.life / sp.maxLife
        const sc = 1 - p * 0.7
        el.style.width = `${sp.size}px`
        el.style.height = `${sp.size}px`
        el.style.backgroundColor = sp.color
        el.style.boxShadow = `0 0 12px ${sp.color}`
        el.style.opacity = ((1 - p) * 0.92).toFixed(3)
        el.style.transform = `translate3d(${(sp.x - sp.size * 0.5).toFixed(1)}px, ${(sp.y - sp.size * 0.5).toFixed(1)}px, 0) scale(${sc.toFixed(3)})`
      }
    }

    item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      offMeter()
      if (toastTimer) clearTimeout(toastTimer)
      if (washTimer) clearTimeout(washTimer)
    }
  }, [enabled, reducedMotion])

  if (!enabled || reducedMotion) return null

  const activeAlbum = ALBUM_ITEMS[albumIdx % ALBUM_ITEMS.length]
  const sleeveArt = safeLogo === 'cover' && playingCoverUrl ? playingCoverUrl : activeAlbum.art

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      {/* Directional edge-impact color bloom sweeping across the stage */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out"
        style={{
          opacity: edgeWash.active ? (safeLogo === 'albums' ? 0.46 : 0.28) : 0,
          background: `radial-gradient(circle 760px at ${edgeWash.xPct}% ${edgeWash.yPct}%, ${edgeWash.color}a6 0%, ${edgeWash.color}30 46%, transparent 76%)`,
        }}
      />

      {/* Crisp luminous edge flare bar along the impacted border */}
      <div
        className="pointer-events-none absolute transition-opacity duration-300 ease-out"
        style={{
          opacity: edgeWash.active ? 0.85 : 0,
          ...(edgeWash.side === 'left'
            ? { top: 0, bottom: 0, left: 0, width: 4, background: `linear-gradient(to bottom, transparent, ${edgeWash.color}, transparent)`, boxShadow: `0 0 26px ${edgeWash.color}` }
            : edgeWash.side === 'right'
              ? { top: 0, bottom: 0, right: 0, width: 4, background: `linear-gradient(to bottom, transparent, ${edgeWash.color}, transparent)`, boxShadow: `0 0 26px ${edgeWash.color}` }
              : edgeWash.side === 'top'
                ? { left: 0, right: 0, top: 0, height: 4, background: `linear-gradient(to right, transparent, ${edgeWash.color}, transparent)`, boxShadow: `0 0 26px ${edgeWash.color}` }
                : { left: 0, right: 0, bottom: 0, height: 4, background: `linear-gradient(to right, transparent, ${edgeWash.color}, transparent)`, boxShadow: `0 0 26px ${edgeWash.color}` }),
        }}
      />

      {/* 6-node luminous motion trail behind the bouncing cover */}
      {Array.from({ length: TRAIL_COUNT }).map((_, i) => (
        <div
          key={`trail-${i}`}
          ref={(el) => { trailRefs.current[i] = el }}
          className="pointer-events-none absolute top-0 left-0 w-14 h-14 rounded-full will-change-transform"
          style={{ opacity: 0, filter: 'blur(6px)' }}
        />
      ))}

      {/* Pooled GPU wall-impact light sparks */}
      {Array.from({ length: SPARK_COUNT }).map((_, i) => (
        <div
          key={`spark-${i}`}
          ref={(el) => { sparkRefs.current[i] = el }}
          className="pointer-events-none absolute top-0 left-0 rounded-full will-change-transform"
          style={{ opacity: 0 }}
        />
      ))}

      {/* Double concentric wall impact ripples & full-screen corner supernova */}
      {waves.map((w) => (
        <div
          key={w.id}
          className={`pointer-events-none absolute rounded-full ${w.corner ? 'dvd-corner-wave' : 'dvd-edge-ripple'}`}
          style={{
            left: w.x,
            top: w.y,
            width: w.corner ? 320 : 140,
            height: w.corner ? 320 : 140,
            border: w.corner ? `2.5px solid ${w.color}` : `2px solid ${w.color}dd`,
            background: w.corner
              ? `radial-gradient(circle, ${w.color}78 0%, ${w.color}28 55%, transparent 76%)`
              : `radial-gradient(circle, ${w.color}50 0%, transparent 72%)`,
            boxShadow: `0 0 ${w.corner ? 60 : 28}px ${w.color}99`,
          }}
        />
      ))}

      {/* Kinetic 120fps bouncing album cover sleeve or LND butterfly */}
      <div
        ref={itemRef}
        className="absolute top-0 left-0 flex items-center justify-center will-change-transform"
        style={{ width: boxSize, height: boxSize, transformStyle: 'preserve-3d' }}
      >
        {safeLogo === 'butterfly' ? (
          <LndButterflyGraphic color={activeAlbum.color} />
        ) : (
          <GlassCoverSleeve art={sleeveArt} color={activeAlbum.color} swapKey={safeLogo === 'albums' ? swapCount : 0} />
        )}
      </div>

      {/* Frosted Liquid Glass Corner Hit banner */}
      {cornerToast && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-black/72 border text-xs font-mono-ui font-bold tracking-[0.14em] uppercase backdrop-blur-xl shadow-2xl"
          style={{ borderColor: cornerToast.color, color: cornerToast.color, boxShadow: `0 12px 34px ${cornerToast.color}55` }}
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
