import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import ContextMenu from './ContextMenu'
import { loadVersionGroupEntries, type SongVersionEntry } from '../lib/songVersions'
import { songToTrack } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import { runPlayerCommand } from '../lib/windowSync'
import { showAppToast } from '../lib/appToast'

function shortVersionLabel(entry: SongVersionEntry): string {
  if (entry.meta.isSession || entry.song.category === 'recording_session') return 'Session'
  const raw = (entry.meta.version || entry.meta.versionTitle || entry.song.name || '').trim()
  const v = /\b(v\d+|og|stem|demo)\b/i.exec(raw)
  if (v) return v[1].toUpperCase()
  return raw.length > 10 ? raw.slice(0, 10) : raw || 'Alt'
}

function fullVersionLabel(entry: SongVersionEntry): string {
  const tag = entry.meta.isSession ? 'Session' : (entry.meta.version || entry.meta.versionTitle || '')
  return tag ? `${entry.song.name} (${tag})` : entry.song.name
}

/** Compact inline version switcher pill in the Player bar when the playing track
 *  belongs to a version group (OG / V2 / Session). Preserves playback timestamp
 *  when switching between compatible-duration versions. */
export default function PlayerVersionSwitcher({
  songId,
  disabled,
}: {
  songId: number | null
  disabled?: boolean
}): JSX.Element | null {
  const [entries, setEntries] = useState<SongVersionEntry[]>([])
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setOpen(false)
    if (disabled || songId == null) { setEntries([]); return }
    let cancelled = false
    void loadVersionGroupEntries(songId)
      .then(({ self, siblings }) => {
        if (cancelled) return
        const all = [self, ...siblings].filter((e): e is SongVersionEntry => !!e && e.playable)
        setEntries(all.length >= 2 ? all : [])
      })
      .catch(() => { if (!cancelled) setEntries([]) })
    return () => { cancelled = true }
  }, [songId, disabled])

  if (disabled || entries.length < 2) return null
  const active = entries.find((e) => e.song.id === songId) ?? entries[0]

  const switchTo = (entry: SongVersionEntry): void => {
    setOpen(false)
    if (entry.song.id === songId) return
    const st = useStore.getState()
    const resumeSec = st.currentTime
    const track = songToTrack(entry.song)
    const nextQueue = st.queue.map((t, idx) => (idx === st.queueIndex ? track : t))
    st.playTrack(track, nextQueue.length ? nextQueue : [track], st.queueFilter, st.queueSource)
    if (resumeSec > 1 && (!track.duration || resumeSec < track.duration - 2)) {
      window.setTimeout(() => runPlayerCommand('seek', resumeSec), 320)
    }
    showAppToast(`Switched to ${fullVersionLabel(entry)}`)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          setRect(btnRef.current?.getBoundingClientRect() ?? null)
          setOpen((v) => !v)
        }}
        title={`${entries.length} versions available — click to switch`}
        aria-label={`Switch version (${entries.length} available)`}
        className="inline-flex items-center gap-1 font-mono-ui text-[9px] font-semibold tracking-wide px-1.5 py-px rounded-md border border-[var(--border)] bg-[var(--fill)] text-text-secondary hover:text-text-primary hover:border-[var(--accent)] transition-colors shrink-0"
      >
        <Layers size={9} />
        <span>{shortVersionLabel(active)}</span>
        <span className="opacity-65">·{entries.length}</span>
      </button>

      {open && rect && (
        <ContextMenu
          x={rect.left}
          y={rect.top - 4}
          anchor={rect}
          ignoreRef={btnRef}
          title="Switch version"
          onClose={() => setOpen(false)}
          className="min-w-[230px]"
          checkColumn="auto"
          items={entries.map((entry) => ({
            label: fullVersionLabel(entry),
            checked: entry.song.id === songId,
            onSelect: () => switchTo(entry),
          }))}
        />
      )}
    </>
  )
}
