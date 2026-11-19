import { Moon, Sun } from 'lucide-react'
import { buildImageUrl } from '../lib/juicewrldApi'
import { getSkin } from '../lib/skins'
import { useStore } from '../store/useStore'
import { ProgressiveCover } from './ProgressiveCover'

const MINI_ALBUM_THEMES = [
  { id: '999', short: '999' },
  { id: 'gbgr', short: 'GB&GR' },
  { id: 'drfl', short: 'DRFL' },
  { id: 'lnd', short: 'LND' },
  { id: 'fd', short: 'FD' },
].map((entry) => {
  const skin = getSkin(entry.id)
  return {
    id: entry.id,
    short: entry.short,
    name: skin.name,
    accent: skin.accent ?? '#fb3a54',
    art: buildImageUrl(skin.art ?? `/assets/${entry.id}.webp`) ?? '',
  }
})

/** Compact 1-click album cover theme strip (5 miniature Juice WRLD album covers + Dark/Light toggle). */
export default function AlbumThemeStrip({
  compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}): JSX.Element {
  const theme = useStore((s) => s.theme)
  const adaptiveColors = useStore((s) => s.adaptiveColors)
  const setTheme = useStore((s) => s.setTheme)
  const isDark = getSkin(theme).dark
  const sizeCls = compact ? 'w-6 h-6 rounded-md' : 'w-7 h-7 rounded-lg'

  return (
    <div
      role="group"
      aria-label="Juice WRLD album themes"
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      {MINI_ALBUM_THEMES.map((item) => {
        const active = !adaptiveColors && theme === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setTheme(item.id)}
            aria-label={`Theme: ${item.name}`}
            aria-pressed={active}
            title={item.name}
            className={`relative ${sizeCls} overflow-hidden shrink-0 transition-transform duration-150 hover:scale-110 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              active
                ? 'ring-2 ring-[var(--accent)] scale-105 shadow-sm'
                : 'ring-1 ring-white/15 opacity-80 hover:opacity-100'
            }`}
          >
            <ProgressiveCover src={item.art} alt="" className="w-full h-full object-cover" />
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'glass-light' : 'glass-dark')}
        aria-label={isDark ? 'Switch to Light theme' : 'Switch to Dark theme'}
        title={isDark ? 'Light theme' : 'Dark theme'}
        className={`${sizeCls} shrink-0 flex items-center justify-center bg-[var(--fill)] hover:bg-[var(--fill-strong)] text-text-secondary hover:text-text-primary transition-colors`}
      >
        {isDark ? <Sun size={compact ? 12 : 13} /> : <Moon size={compact ? 12 : 13} />}
      </button>
    </div>
  )
}
