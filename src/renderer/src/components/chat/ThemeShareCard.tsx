import { Palette } from 'lucide-react'
import type { SharedThemePayload } from '../../lib/chatShare'
import { useStore } from '../../store/useStore'
import { clickable } from '../../lib/a11y'

// Custom skins were retired (2026-11-16): a shared theme now applies as Dark
// or Light, following its darkness, with its accent color.
export default function ThemeShareCard({ theme }: { theme: SharedThemePayload }): JSX.Element {
  const applyTheme = (): void => {
    const store = useStore.getState()
    store.setTheme(theme.dark ? 'glass-dark' : 'glass-light')
    if (theme.accent) store.setAccentColor(theme.accent)
  }
  return (
    <div
      {...clickable(applyTheme)}
      className="flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 cursor-pointer hover:border-text-muted transition-colors"
    >
      <span
        className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 grid grid-cols-2 grid-rows-2 border border-[var(--border)]"
        style={{ background: theme.vars['--surface'] }}
      >
        <span style={{ background: theme.vars['--surface-raised'] }} />
        <span style={{ background: theme.vars['--surface-overlay'] }} />
        <span style={{ background: theme.vars['--surface-highest'] }} />
        <span style={{ background: theme.accent ?? theme.vars['--text-primary'] }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate flex items-center gap-1.5">
          <Palette size={13} className="text-text-muted shrink-0" />
          {theme.name}
        </p>
        <p className="text-xs text-text-muted">Click to use its look (Dark or Light) and accent</p>
      </div>
    </div>
  )
}
