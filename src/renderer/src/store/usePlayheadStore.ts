import { create } from 'zustand'

/** High-frequency playback clock & buffer state, isolated from the main
 *  useStore so seekbars/clocks can read buffered ranges without waking
 *  unrelated global store subscribers on every timeupdate tick. */
export interface PlayheadState {
  currentTime: number
  duration: number
  progress: number
  bufferedRatio: number
  setPlayhead: (currentTime: number, duration: number, bufferedEnd: number) => void
  resetPlayhead: () => void
}

export const usePlayheadStore = create<PlayheadState>((set) => ({
  currentTime: 0,
  duration: 0,
  progress: 0,
  bufferedRatio: 0,
  setPlayhead: (currentTime, duration, bufferedEnd) => {
    const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 0
    const progress = safeDur > 0 ? Math.min(1, Math.max(0, currentTime / safeDur)) : 0
    const bufferedRatio = safeDur > 0 ? Math.min(1, Math.max(0, bufferedEnd / safeDur)) : 0
    set({ currentTime, duration: safeDur, progress, bufferedRatio })
  },
  resetPlayhead: () => set({ currentTime: 0, duration: 0, progress: 0, bufferedRatio: 0 }),
}))
