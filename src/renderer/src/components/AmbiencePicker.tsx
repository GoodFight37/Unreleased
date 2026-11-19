import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Palette } from 'lucide-react'
import { SKINS, getSkin } from '../lib/skins'
import { buildImageUrl } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import { ProgressiveCover } from './ProgressiveCover'

export const JUICE_THEME_IDS = ['999', 'gbgr', 'drfl', 'lnd', 'fd'] as const
const JUICE_THEMES = JUICE_THEME_IDS.map((id) => ({
  id,
  name: getSkin(id).name,
  art: buildImageUrl(getSkin(id).art ?? `/assets/${id}.webp`) ?? '',
}))

export default function AmbiencePicker({
  buttonClassName,
  onOpenChange,
}: {
  buttonClassName?: string
  onOpenChange?: (open: boolean) => void
} = {}): JSX.Element {
  const theme = useStore((s) => s.theme)
  const adaptiveColors = useStore((s) => s.adaptiveColors)
  const setAdaptiveColors = useStore((s) => s.setAdaptiveColors)
  const setTheme = useStore((s) => s.setTheme)
  const interfaceStyle = useStore((s) => s.interfaceStyle)
  const setInterfaceStyle = useStore((s) => s.setInterfaceStyle)
  const openSettings = useStore((s) => s.openSettings)

  const [open, setOpen] = useState(false)
  useEffect(() => { onOpenChange?.(open) }, [open, onOpenChange])
  useEffect(() => () => { onOpenChange?.(false) }, [onOpenChange])
  const [pos, setPos] = useState<{ left: number; bottom?: number; top?: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const width = 440
    const left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))
    setPos(r.top < window.innerHeight / 2 ? { left, top: r.bottom + 12 } : { left, bottom: window.innerHeight - r.top + 12 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null
      const path = typeof e.composedPath === 'function' ? e.composedPath() : []
      if (
        (btnRef.current && (btnRef.current.contains(target) || path.includes(btnRef.current)))
        || (popRef.current && (popRef.current.contains(target) || path.includes(popRef.current)))
      ) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const activeName = SKINS.find((s) => s.id === theme)?.name ?? getSkin(theme).name

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label="Ambience"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={adaptiveColors ? 'Ambience · Cover colors on' : `Ambience · ${activeName}`}
        className={`${buttonClassName ?? 'transition-colors'} ${adaptiveColors || open ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
      >
        <Palette size={16} />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Ambience"
          className="coffre-amb-pop floating-panel-glass glass-thick"
          style={{ ...pos, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <strong className="text-sm font-bold text-text-primary">Ambience</strong>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-full p-0.5 bg-[var(--fill)] border border-[var(--border)] text-[11px]" role="group" aria-label="Interface style">
                <button
                  type="button"
                  aria-pressed={interfaceStyle === 'spatial'}
                  onClick={() => setInterfaceStyle('spatial')}
                  className={`px-2.5 py-0.5 rounded-full font-medium transition-colors ${interfaceStyle === 'spatial' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  Spatial
                </button>
                <button
                  type="button"
                  aria-pressed={interfaceStyle === 'editorial'}
                  onClick={() => setInterfaceStyle('editorial')}
                  className={`px-2.5 py-0.5 rounded-full font-medium transition-colors ${interfaceStyle === 'editorial' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  Editorial
                </button>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={adaptiveColors}
                onClick={() => setAdaptiveColors(!adaptiveColors)}
                className="coffre-tp-switch text-text-primary"
              >
                <i aria-hidden="true" />
                <span>Cover colors</span>
              </button>
            </div>
          </div>

          <div className="coffre-tp-grid" role="group" aria-label="Juice WRLD themes">
            {JUICE_THEMES.map((item) => {
              const pressed = !adaptiveColors && theme === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className="coffre-tp-tile"
                  aria-pressed={pressed}
                  onClick={() => setTheme(item.id)}
                >
                  <span className="coffre-tp-thumb">
                    <ProgressiveCover src={item.art} alt="" className="w-full h-full object-cover" />
                  </span>
                  <span>{item.name}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 mt-3 text-xs text-text-secondary">
            <span className="truncate">
              {adaptiveColors ? 'Following the cover of the playing song' : `Theme: ${activeName}`}
            </span>
            <button
              type="button"
              className="shrink-0 font-semibold text-text-primary hover:underline"
              onClick={() => {
                setOpen(false)
                openSettings('appearance')
              }}
            >
              All themes in Settings →
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
