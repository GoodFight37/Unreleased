import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { hasDirectAudioPath, isPlayableSong } from '../lib/songVersions'
import type { JWApiSong } from '../lib/juicewrldApi'

export function useSongAvailability(song: JWApiSong): { canPlay: boolean; checkingAudio: boolean } {
  const channel = useStore((s) => s.activeChannel)
  const direct = hasDirectAudioPath(song)
  const lookup = !direct && song.category === 'recording_session'
  const key = `${channel}:${song.id}:${song.path}`
  const [checked, setChecked] = useState<{ key: string; playable: boolean } | null>(null)
  useEffect(() => {
    if (!lookup) return
    let cancelled = false
    void isPlayableSong(song).then((playable) => { if (!cancelled) setChecked({ key, playable }) }, () => { if (!cancelled) setChecked({ key, playable: false }) })
    return () => { cancelled = true }
  }, [key, lookup])
  return { canPlay: direct || (lookup && checked?.key === key && checked.playable), checkingAudio: lookup && checked?.key !== key }
}
