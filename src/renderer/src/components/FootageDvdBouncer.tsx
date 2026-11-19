import { useEffect, useRef, useState } from 'react'
import { getSkin, type SkinId } from '../lib/skins'
import { buildImageUrl } from '../lib/juicewrldApi'

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

const ALBUM_BOX = 104
const BUTTERFLY_BOX = 92
const CORNER_TOLERANCE = 30

interface ImpactWave {
  id: number
  x: number
  y: number
  color: string
  corner: boolean
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
      className="dvd-cover-swap relative w-[96px] h-[96px] rounded-[22px] overflow-hidden select-none"
      style={{
        boxShadow: `0 16px 40px ${color}66, 0 0 0 1.5px ${color}b0, inset 0 1px 0 rgba(255,255,255,0.48)`,
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
      {/* Specular Liquid Glass sheen & inner edge refraction */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.36) 0%, rgba(255,255,255,0.06) 36%, transparent 54%, rgba(0,0,0,0.24) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[22px]"
        style={{ boxShadow: `inset 0 0 20px ${color}40` }}
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
      {/* Upper wings */}
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
      {/* Lower wings */}
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
      {/* Delicate wing accent cells */}
      <ellipse cx="30" cy="31" rx="9" ry="5.5" transform="rotate(-24 30 31)" fill="#ffffff" fillOpacity="0.28" />
      <ellipse cx="90" cy="31" rx="9" ry="5.5" transform="rotate(24 90 31)" fill="#ffffff" fillOpacity="0.28" />
      <circle cx="38" cy="74" r="4" fill="#ffffff" fillOpacity="0.3" />
      <circle cx="82" cy="74" r="4" fill="#ffffff" fillOpacity="0.3" />
      {/* Body & subtle antennae */}
      <path d="M60 32 L60 76" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeOpacity="0.92" />
      <path d="M60 35 C55 24 49 18 44 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M60 35 C65 24 71 18 76 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="44" cy="16" r="2" fill="#ffffff" fillOpacity="0.85" />
      <circle cx="76" cy="16" r="2" fill="#ffffff" fillOpacity="0.85" />
    </svg>
  )
}

/** Kinetic 60-120fps Album Covers, Playing Cover & LND Butterfly bouncer with wall ripples and corner theme shifts. */
export default function FootageDvdBouncer({
  enabled,
  logo,
  reducedMotion,
  playingCoverUrl,
  onCornerHit,
  onCornerAlbumHit,
  className = 'fixed inset-0 z-0 pointer-events-none overflow-hidden select-none',
}: {
  enabled: boolean
  logo: DvdLogoId
  reducedMotion: boolean
  /** Current track cover art, used in 'cover' mode (falls back to album covers if absent). */
  playingCoverUrl?: string | null
  onCornerHit?: () => void
  /** Fires on a corner hit in Album Covers mode so WRLD can smoothly switch the active album theme. */
  onCornerAlbumHit?: (albumId: SkinId, albumName: string) => void
  className?: string
}): JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const onCornerHitRef = useRef(onCornerHit)
  onCornerHitRef.current = onCornerHit
  const onCornerAlbumHitRef = useRef(onCornerAlbumHit)
  onCornerAlbumHitRef.current = onCornerAlbumHit
  const safeLogo = normalizeDvdLogo(logo)
  const logoRef = useRef<DvdLogoId>(safeLogo)
  logoRef.current = safeLogo

  const [albumIdx, setAlbumIdx] = useState(0)
  const [swapCount, setSwapCount] = useState(0)
  const [edgeWash, setEdgeWash] = useState<{ color: string; xPct: number; yPct: number; active: boolean }>({
    color: ALBUM_ITEMS[0].color,
    xPct: 50,
    yPct: 50,
    active: false,
  })
  const [waves, setWaves] = useState<ImpactWave[]>([])
  const [cornerTint, setCornerTint] = useState<string | null>(null)
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

    let x = 36 + Math.random() * Math.max(40, host.clientWidth * 0.35)
    let y = 36 + Math.random() * Math.max(40, host.clientHeight * 0.3)
    // Smooth 60-120fps kinetic glide speed (~148 px/s diagonal)
    let vx = 132
    let vy = 106
    let angle = 0
    let angularVel = 6
    let squashX = 1
    let squashY = 1
    let last = performance.now()
    let raf = 0
    let waveSeq = 1
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    let washTimer: ReturnType<typeof setTimeout> | null = null

    const spawnWave = (wx: number, wy: number, color: string, corner: boolean): void => {
      const id = waveSeq++
      setWaves((prev) => [...prev.slice(-3), { id, x: wx, y: wy, color, corner }])
      window.setTimeout(() => {
        setWaves((prev) => prev.filter((w) => w.id !== id))
      }, corner ? 900 : 560)
    }

    const step = (now: number): void => {
      raf = requestAnimationFrame(step)
      if (document.hidden) {
        last = now
        return
      }
      const dt = Math.min(0.04, Math.max(0.001, (now - last) / 1000))
      last = now

      const size = boxSizeRef.current
      const maxX = Math.max(0, host.clientWidth - size)
      const maxY = Math.max(0, host.clientHeight - size)
      x += vx * dt
      y += vy * dt

      let hitX = false
      let hitY = false
      let hitLeft = false
      let hitTop = false
      if (x <= 0) { x = 0; vx = Math.abs(vx); hitX = true; hitLeft = true }
      else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); hitX = true }

      if (y <= 0) { y = 0; vy = Math.abs(vy); hitY = true; hitTop = true }
      else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); hitY = true }

      // Spring-damp elastic squash-stretch back to 1.0 cleanly at 60-120+ fps
      const spring = 1 - Math.exp(-15 * dt)
      squashX += (1 - squashX) * spring
      squashY += (1 - squashY) * spring

      // Gentle buoyant tilt with soft angular damping
      angle += angularVel * dt
      if (angle > 9) { angle = 9; angularVel = -Math.abs(angularVel) * 0.45 }
      else if (angle < -9) { angle = -9; angularVel = Math.abs(angularVel) * 0.45 }
      angularVel *= Math.exp(-1.7 * dt)

      if (hitX || hitY) {
        if (hitX) {
          squashX = 0.83
          squashY = 1.15
          angularVel = (vy > 0 ? 1 : -1) * (hitLeft ? 28 : -28)
        }
        if (hitY) {
          squashX = 1.15
          squashY = 0.83
          angularVel = (vx > 0 ? 1 : -1) * (hitTop ? -28 : 28)
        }

        const nearCorner =
          (hitX && (y <= CORNER_TOLERANCE || y >= maxY - CORNER_TOLERANCE)) ||
          (hitY && (x <= CORNER_TOLERANCE || x >= maxX - CORNER_TOLERANCE))

        const mode = logoRef.current
        const nextAlbumIdx = (albumIdxRef.current + 1) % ALBUM_ITEMS.length
        albumIdxRef.current = nextAlbumIdx
        const nextAlbum = ALBUM_ITEMS[nextAlbumIdx]

        setAlbumIdx(nextAlbumIdx)
        if (mode === 'albums') setSwapCount((c) => c + 1)

        const cx = hitX ? (hitLeft ? 4 : host.clientWidth - 4) : x + size * 0.5
        const cy = hitY ? (hitTop ? 4 : host.clientHeight - 4) : y + size * 0.5
        spawnWave(cx, cy, nextAlbum.color, nearCorner)

        const xPct = host.clientWidth > 0 ? Math.round((cx / host.clientWidth) * 100) : 50
        const yPct = host.clientHeight > 0 ? Math.round((cy / host.clientHeight) * 100) : 50
        setEdgeWash({ color: nextAlbum.color, xPct, yPct, active: true })
        if (washTimer) clearTimeout(washTimer)
        washTimer = setTimeout(() => {
          setEdgeWash((w) => ({ ...w, active: false }))
        }, nearCorner ? 2000 : 1400)

        if (nearCorner) {
          onCornerHitRef.current?.()
          if (mode === 'albums') {
            setCornerTint(nextAlbum.color)
            onCornerAlbumHitRef.current?.(nextAlbum.id, nextAlbum.name)
            setCornerToast({ label: `CORNER HIT · ${nextAlbum.name.toUpperCase()}`, color: nextAlbum.color, art: nextAlbum.art })
          } else {
            setCornerToast({ label: 'CORNER HIT · 999', color: nextAlbum.color })
          }
          if (toastTimer) clearTimeout(toastTimer)
          toastTimer = setTimeout(() => setCornerToast(null), 1700)
        }
      }

      item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${angle.toFixed(2)}deg) scale3d(${squashX.toFixed(3)}, ${squashY.toFixed(3)}, 1)`
    }

    item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      if (toastTimer) clearTimeout(toastTimer)
      if (washTimer) clearTimeout(washTimer)
    }
  }, [enabled, reducedMotion])

  if (!enabled || reducedMotion) return null

  const activeAlbum = ALBUM_ITEMS[albumIdx % ALBUM_ITEMS.length]
  const sleeveArt = safeLogo === 'cover' && playingCoverUrl ? playingCoverUrl : activeAlbum.art

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      {/* Persistent soft album atmosphere wash after a corner hit in Album Covers mode */}
      {safeLogo === 'albums' && cornerTint && (
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-700 ease-out"
          style={{
            opacity: 0.28,
            background: `radial-gradient(120% 90% at 20% 15%, ${cornerTint}88 0%, transparent 58%), radial-gradient(110% 85% at 85% 85%, ${cornerTint}66 0%, transparent 62%)`,
          }}
        />
      )}

      {/* Smooth directional ambient edge-impact color aura */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out"
        style={{
          opacity: edgeWash.active ? (safeLogo === 'albums' ? 0.42 : 0.26) : 0,
          background: `radial-gradient(circle 620px at ${edgeWash.xPct}% ${edgeWash.yPct}%, ${edgeWash.color}99 0%, ${edgeWash.color}28 46%, transparent 74%)`,
        }}
      />

      {/* Wall impact ripples & full-screen corner theme expansion waves */}
      {waves.map((w) => (
        <div
          key={w.id}
          className={`pointer-events-none absolute rounded-full ${w.corner ? 'dvd-corner-wave' : 'dvd-edge-ripple'}`}
          style={{
            left: w.x,
            top: w.y,
            width: w.corner ? 300 : 128,
            height: w.corner ? 300 : 128,
            border: w.corner ? `2px solid ${w.color}` : `1.5px solid ${w.color}cc`,
            background: w.corner
              ? `radial-gradient(circle, ${w.color}70 0%, ${w.color}24 55%, transparent 76%)`
              : `radial-gradient(circle, ${w.color}48 0%, transparent 70%)`,
            boxShadow: `0 0 ${w.corner ? 56 : 24}px ${w.color}88`,
          }}
        />
      ))}

      {/* Kinetic 60-120fps bouncing album cover sleeve or LND butterfly */}
      <div
        ref={itemRef}
        className="absolute top-0 left-0 flex items-center justify-center will-change-transform"
        style={{ width: boxSize, height: boxSize }}
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
