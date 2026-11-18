import { useSongAvailability } from '../hooks/useSongAvailability'
import { songTruth } from '../lib/songTruth'
import { CATEGORY_COLORS, type JWApiSong } from '../lib/juicewrldApi'

type Props = {
  song: Partial<JWApiSong>
  /** Already computed by isPlayableSong / useSongAvailability (hasDirectAudioPath when sync is all there is). */
  playable: boolean
  showCredit?: boolean
  className?: string
}

const NEUTRAL = 'text-text-secondary bg-white/5 border-[var(--border)]'
const BADGE = 'text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0'

/** One line of API-backed facts: what the song is, the raw leak_type, no-audio, aliases, one credit. */
export function SongTruthLine({ song, playable, showCredit, className }: Props) {
  const t = songTruth(song, playable)
  const color = (song.category && CATEGORY_COLORS[song.category]) || NEUTRAL
  return (
    <span className={`flex items-center gap-1.5 flex-wrap min-w-0 ${className ?? ''}`}>
      <span className={`${BADGE} ${color}`}>{t.kindLabel}</span>
      {t.leakLabel && <span className={`${BADGE} font-normal max-w-[14rem] truncate ${NEUTRAL}`} title={t.leakLabel}>{t.leakLabel}</span>}
      {!t.canPlay && t.kind !== 'name-only' && t.kind !== 'no-audio' && (
        <span className={`${BADGE} font-normal ${NEUTRAL}`}>No audio</span>
      )}
      {t.alsoKnownAs && (
        <span className="text-[10px] text-text-muted italic truncate min-w-0" title={t.alsoKnownAs}>Also known as {t.alsoKnownAs}</span>
      )}
      {showCredit && t.credit && <span className="text-[10px] text-text-muted truncate min-w-0" title={t.credit}>{t.credit}</span>}
    </span>
  )
}

/** Same line, playable resolved with the cached availability hook (session edits included). */
export function SongTruthLineLive({ song, ...rest }: { song: JWApiSong; showCredit?: boolean; className?: string }) {
  const { canPlay, checkingAudio } = useSongAvailability(song)
  // while a session-edit lookup is pending, do not flash "No audio"
  return <SongTruthLine song={song} playable={canPlay || checkingAudio} {...rest} />
}
