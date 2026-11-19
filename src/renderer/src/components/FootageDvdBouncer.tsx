import { useEffect, useRef, useState } from 'react'
import juicePixelSrc from '../assets/juice-pixel.png'

export type DvdLogoId = 'mix' | 'pixel' | 'carton' | '999' | 'heart' | 'butterfly'

export const DVD_LOGO_OPTIONS: ReadonlyArray<{ id: DvdLogoId; label: string }> = [
  { id: 'mix', label: 'Mix 999' },
  { id: 'pixel', label: 'Juice Pixel' },
  { id: 'carton', label: 'Juice Carton' },
  { id: '999', label: '999 Emblem' },
  { id: 'heart', label: 'GB&GR Heart' },
  { id: 'butterfly', label: 'LND Butterfly' },
]

const CYCLE_LOGOS: ReadonlyArray<Exclude<DvdLogoId, 'mix'>> = ['pixel', 'carton', '999', 'heart', 'butterfly']

const ALBUM_COLORS = [
  '#f0404f', // 999 crimson
  '#5ca8ff', // GB&GR sky blue
  '#ff8c38', // DRFL race orange
  '#f070b8', // LND rose magenta
  '#5ce1e6', // FD ice cyan
  '#facc15', // Lyrical Lemonade yellow
] as const

const BOX_W = 86
const BOX_H = 86
const CORNER_TOLERANCE = 12

function LogoGraphic({ kind, color }: { kind: Exclude<DvdLogoId, 'mix'>; color: string }): JSX.Element {
  if (kind === 'pixel') {
    return (
      <img
        src={juicePixelSrc}
        alt=""
        draggable={false}
        className="w-[78px] h-[78px] object-contain select-none"
        style={{
          imageRendering: 'pixelated',
          filter: `drop-shadow(0 0 12px ${color}aa) drop-shadow(0 6px 14px rgba(0,0,0,0.65))`,
        }}
      />
    )
  }

  if (kind === 'carton') {
    return (
      <svg viewBox="0 0 80 86" width="76" height="82" aria-hidden="true" style={{ filter: `drop-shadow(0 0 12px ${color}99)` }}>
        {/* Iconic Juice / Milk Carton homage */}
        <path d="M22 14 L58 14 L64 26 L16 26 Z" fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2.6" strokeLinejoin="round" />
        <rect x="22" y="7" width="36" height="7" rx="2" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="2.4" />
        <rect x="16" y="26" width="48" height="52" rx="6" fill="rgba(10,10,14,0.72)" stroke={color} strokeWidth="2.6" />
        <path d="M16 38 H64" stroke={color} strokeWidth="1.8" strokeOpacity="0.55" />
        <circle cx="40" cy="54" r="11" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" />
        <text x="40" y="58" textAnchor="middle" fill={color} fontSize="10.5" fontWeight="900" fontFamily="monospace" letterSpacing="0.8">999</text>
        <text x="40" y="34.5" textAnchor="middle" fill="#ffffff" fontSize="6.5" fontWeight="800" fontFamily="monospace" letterSpacing="1.3">JUICE</text>
      </svg>
    )
  }

  if (kind === 'heart') {
    return (
      <svg viewBox="0 0 84 78" width="76" height="72" aria-hidden="true" style={{ filter: `drop-shadow(0 0 12px ${color}99)` }}>
        <path
          d="M42 70 C20 55 8 42 8 26 C8 14 17 6 28 6 C35 6 39 10 42 15 C45 10 49 6 56 6 C67 6 76 14 76 26 C76 42 64 55 42 70 Z"
          fill={color}
          fillOpacity="0.22"
          stroke={color}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M43 16 L36 30 L47 39 L38 54 L43 66" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (kind === 'butterfly') {
    return (
      <svg viewBox="0 0 86 76" width="78" height="70" aria-hidden="true" style={{ filter: `drop-shadow(0 0 12px ${color}99)` }}>
        <path
          d="M43 34 C35 12 10 8 8 24 C6 36 20 42 32 42 C18 46 12 60 22 66 C32 72 41 58 43 46 C45 58 54 72 64 66 C74 60 68 46 54 42 C66 42 80 36 78 24 C76 8 51 12 43 34 Z"
          fill={color}
          fillOpacity="0.25"
          stroke={color}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <line x1="43" y1="22" x2="43" y2="56" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M43 24 C40 16 36 13 33 12 M43 24 C46 16 50 13 53 12" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  // '999' emblem
  return (
    <div
      className="flex flex-col items-center justify-center w-[84px] h-[54px] rounded-2xl border-2 bg-black/55 backdrop-blur-sm select-none"
      style={{
        borderColor: color,
        boxShadow: `0 0 18px ${color}88, inset 0 1px 0 rgba(255,255,255,0.28)`,
      }}
    >
      <span className="font-mono-ui text-[22px] font-black leading-none tracking-[0.12em]" style={{ color }}>999</span>
      <span className="font-mono-ui text-[8px] font-bold tracking-[0.26em] text-white/80 mt-0.5">WRLD</span>
    </div>
  )
}

/** DVD-style bouncing Juice WRLD screensaver running in the outer backdrop around windowed Footage. */
export default function FootageDvdBouncer({
  enabled,
  logo,
  reducedMotion,
  onCornerHit,
}: {
  enabled: boolean
  logo: DvdLogoId
  reducedMotion: boolean
  onCornerHit: () => void
}): JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const onCornerHitRef = useRef(onCornerHit)
  onCornerHitRef.current = onCornerHit

  const [colorIdx, setColorIdx] = useState(0)
  const [mixIdx, setMixIdx] = useState(0)
  const [cornerFlash, setCornerFlash] = useState(false)

  useEffect(() => {
    if (!enabled || reducedMotion) return
    const host = hostRef.current
    const item = itemRef.current
    if (!host || !item) return

    let x = 28 + Math.random() * Math.max(40, host.clientWidth * 0.25)
    let y = 28 + Math.random() * Math.max(40, host.clientHeight * 0.25)
    // Crisp DVD speed (~125 px/sec at 45deg)
    let vx = 112
    let vy = 96
    let last = performance.now()
    let raf = 0
    let flashTimer: ReturnType<typeof setTimeout> | null = null

    const step = (now: number): void => {
      raf = requestAnimationFrame(step)
      if (document.hidden) {
        last = now
        return
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
      last = now

      const maxX = Math.max(0, host.clientWidth - BOX_W)
      const maxY = Math.max(0, host.clientHeight - BOX_H)
      x += vx * dt
      y += vy * dt

      let hitX = false
      let hitY = false
      if (x <= 0) { x = 0; vx = Math.abs(vx); hitX = true }
      else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); hitX = true }

      if (y <= 0) { y = 0; vy = Math.abs(vy); hitY = true }
      else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); hitY = true }

      if (hitX || hitY) {
        setColorIdx((i) => (i + 1) % ALBUM_COLORS.length)
        setMixIdx((i) => (i + 1) % CYCLE_LOGOS.length)
        const nearCorner =
          (hitX && (y <= CORNER_TOLERANCE || y >= maxY - CORNER_TOLERANCE)) ||
          (hitY && (x <= CORNER_TOLERANCE || x >= maxX - CORNER_TOLERANCE))
        if (nearCorner) {
          onCornerHitRef.current()
          setCornerFlash(true)
          if (flashTimer) clearTimeout(flashTimer)
          flashTimer = setTimeout(() => setCornerFlash(false), 900)
        }
      }

      item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    }

    item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      if (flashTimer) clearTimeout(flashTimer)
    }
  }, [enabled, reducedMotion])

  if (!enabled || reducedMotion) return null

  const activeKind: Exclude<DvdLogoId, 'mix'> = logo === 'mix' ? CYCLE_LOGOS[mixIdx] : logo
  const activeColor = ALBUM_COLORS[colorIdx]

  return (
    <div ref={hostRef} className="fixed inset-0 z-0 pointer-events-none overflow-hidden select-none" aria-hidden="true">
      <div
        ref={itemRef}
        className="absolute top-0 left-0 flex items-center justify-center will-change-transform"
        style={{ width: BOX_W, height: BOX_H }}
      >
        <div className={`transition-transform duration-200 ${cornerFlash ? 'scale-125' : 'scale-100'}`}>
          <LogoGraphic kind={activeKind} color={activeColor} />
        </div>
      </div>
      {cornerFlash && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/75 border text-xs font-mono-ui font-bold tracking-[0.16em] uppercase backdrop-blur-md"
          style={{ borderColor: activeColor, color: activeColor, boxShadow: `0 0 24px ${activeColor}66` }}
        >
          CORNER HIT · 999
        </div>
      )}
    </div>
  )
}
