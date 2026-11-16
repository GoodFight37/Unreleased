import { copyPngImage } from '../lib/clipboard'
import { ChangeEvent, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  X, Download, Share2, Copy, Loader2, ImagePlus, ChevronDown, Check,
  MessagesSquare, Video, Image as ImageIcon, Play, Pause, Volume2, VolumeX, Sparkles,
} from 'lucide-react'
import ThemedColorPicker from './ThemedColorPicker'
import { ModalOverlay } from './Modal'
import { getAudioCurrentTime, getAudioSourceUrl } from './Player'
import { useStore } from '../store/useStore'
import { hasChatAccess } from '../lib/chatAccess'
import { lazyOverlay } from '../lib/lazyView'
import { allFonts, getFont } from '../lib/fonts'
import { fetchImageDataUrl } from '../lib/coverImage'
import { getSkin } from '../lib/skins'
import {
  SHARE_FORMATS,
  ShareStudioRenderer,
  computeClipWindow,
  parseStudioLyrics,
  type ShareBgStyle,
  type ShareFormatKey,
  type ShareGlassMode,
  type ShareRenderOptions,
  type ShareTextColor,
  type ShareTextPos,
  type ShareTextSize,
} from '../lib/shareStudio'
import logo from '../assets/logo.png'

const ShareLyricsCardModal = lazyOverlay(() => import('./chat/ShareLyricsCardModal'))

interface Props {
  title: string
  artist: string
  imageUrl: string | null | undefined
  rawLyrics: string | null
  audioUrl?: string | null
  onClose: () => void
}

const MAX_LINES = 8
const EXPORT_FPS = 30
const VIDEO_DURATIONS = [5, 10, 15, 30] as const

const TEXT_COLOR_PRESETS: { key: Exclude<ShareTextColor, 'custom'>; value: string }[] = [
  { key: 'white', value: '#fff' },
  { key: 'accent', value: 'rgb(var(--accent-rgb))' },
  { key: 'gold', value: '#f5c451' },
]

function loadImg(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function readAccentRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()
  const parts = raw.split(/\s+/).map(Number)
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1], parts[2]]
  }
  return [139, 92, 246]
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div>
      <p className="text-text-muted text-[11px] mb-1.5">{label}</p>
      <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface-highest)]">
        {options.map((opt) => {
          const active = value === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              aria-pressed={active}
              className={`flex-1 min-w-0 h-7 rounded-md text-[11px] font-medium transition-colors ${
                active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function ShareLyricsModal({ title, artist, imageUrl, rawLyrics, audioUrl, onClose }: Props): JSX.Element {
  const { lines, isSynced } = useMemo(() => parseStudioLyrics(rawLyrics), [rawLyrics])
  const theme = useStore((s) => s.theme)
  const initialGlassMode: ShareGlassMode = getSkin(theme).dark ? 'dark' : 'light'

  const [mode, setMode] = useState<'png' | 'mp4'>('png')
  const [selected, setSelected] = useState<number[]>(() => lines.slice(0, 3).map((_, i) => i))
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const [format, setFormat] = useState<ShareFormatKey>('story')
  const [bgStyle, setBgStyle] = useState<ShareBgStyle>('blur')
  const [glassMode, setGlassMode] = useState<ShareGlassMode>(initialGlassMode)
  const [textSize, setTextSize] = useState<ShareTextSize>('M')
  const [textPos, setTextPos] = useState<ShareTextPos>('center')
  const [textColor, setTextColor] = useState<ShareTextColor>('white')
  const [customTextColor, setCustomTextColor] = useState('#ffffff')
  const [showInfoBar, setShowInfoBar] = useState(true)
  const [fontId, setFontId] = useState(() => useStore.getState().lyricsFont)
  const [customFont, setCustomFont] = useState('')
  const [fontMenuOpen, setFontMenuOpen] = useState(false)

  const initialWindow = useMemo(
    () => computeClipWindow(lines, lines.slice(0, 3).map((_, i) => i), getAudioCurrentTime()),
    // Only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [clipStartSec, setClipStartSec] = useState<number>(initialWindow.startSec)
  const [clipDurationSec, setClipDurationSec] = useState<number>(initialWindow.durationSec)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)

  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null)
  const [downloadingFfmpeg, setDownloadingFfmpeg] = useState(false)

  const [customBgUrl, setCustomBgUrl] = useState<string | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement>(null)
  const handleCustomBgPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCustomBgUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Default line selection to current synced playback position on open
  useEffect(() => {
    if (!isSynced || lines.length === 0) return
    const t = getAudioCurrentTime() - useStore.getState().lyricsOffset
    let idx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time !== null && (lines[i].time as number) <= t) idx = i
    }
    if (idx < 0) return
    const start = Math.max(0, idx - 1)
    const end = Math.min(lines.length - 1, idx + 1)
    const nextSel = Array.from({ length: end - start + 1 }, (_, k) => start + k)
    setSelected(nextSel)
    const win = computeClipWindow(lines, nextSel, t)
    setClipStartSec(win.startSec)
    setClipDurationSec(win.durationSec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check FFmpeg availability on mount
  useEffect(() => {
    const el = (window as any).electron
    if (!el?.shareStudioCapabilities) {
      setFfmpegReady(false)
      return
    }
    el.shareStudioCapabilities()
      .then((res: { ffmpeg?: boolean }) => setFfmpegReady(!!res?.ffmpeg))
      .catch(() => setFfmpegReady(false))
  }, [])

  // Load safe image elements (cover, custom bg, logo)
  const [artImage, setArtImage] = useState<HTMLImageElement | null>(null)
  const [customBgImage, setCustomBgImage] = useState<HTMLImageElement | null>(null)
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null)
  const artFetchRef = useRef<Promise<HTMLImageElement | null>>(Promise.resolve(null))

  useEffect(() => {
    void loadImg(logo).then(setLogoImage)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!customBgUrl) { setCustomBgImage(null); return }
    void loadImg(customBgUrl).then((img) => { if (!cancelled) setCustomBgImage(img) })
    return () => { cancelled = true }
  }, [customBgUrl])

  useEffect(() => {
    let cancelled = false
    setArtImage(null)
    if (!imageUrl) {
      artFetchRef.current = Promise.resolve(null)
      return
    }
    const p = (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')
      ? Promise.resolve(imageUrl)
      : fetchImageDataUrl(imageUrl).catch(() => imageUrl)
    ).then((safeUrl) => loadImg(safeUrl)).then((img) => {
      if (!cancelled) setArtImage(img)
      return img
    })
    artFetchRef.current = p
    return () => { cancelled = true }
  }, [imageUrl])

  const formatSpec = SHARE_FORMATS.find((f) => f.key === format) ?? SHARE_FORMATS[0]
  const fontFamily = fontId === 'custom' && customFont.trim()
    ? `'${customFont.trim().replace(/'/g, "\\'")}', ${getFont(undefined).stack}`
    : getFont(fontId).stack

  const resolvedAudioUrl = audioUrl ?? getAudioSourceUrl()
  const hasAudioSource = !!resolvedAudioUrl

  const rendererRef = useRef<ShareStudioRenderer | null>(null)
  if (!rendererRef.current) rendererRef.current = new ShareStudioRenderer()
  useEffect(() => () => { rendererRef.current?.destroy() }, [])

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState<'download' | 'copy' | 'share' | 'chat' | 'mp4' | null>(null)
  const [mp4Progress, setMp4Progress] = useState<number | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exportAbortRef = useRef(false)
  const activeVideoSessionRef = useRef<string | null>(null)

  const canShareToChat = hasChatAccess(useStore((s) => s.account))
  const [chatShareFile, setChatShareFile] = useState<File | null>(null)

  const buildRenderOptions = useCallback((width: number, height: number, resolvedArt?: HTMLImageElement | null): ShareRenderOptions => ({
    width,
    height,
    title,
    artist,
    lines,
    selectedIndices: selected,
    format,
    bgStyle,
    glassMode,
    textSize,
    textPos,
    textColor,
    customTextColor,
    accentRgb: readAccentRgb(),
    fontId,
    customFont,
    showInfoBar,
    artImage: resolvedArt !== undefined ? resolvedArt : artImage,
    customBgImage,
    logoImage,
    isVideo: mode === 'mp4',
    isSynced,
    clipStartSec,
    clipDurationSec,
  }), [
    title, artist, lines, selected, format, bgStyle, glassMode, textSize, textPos,
    textColor, customTextColor, fontId, customFont, showInfoBar, artImage,
    customBgImage, logoImage, mode, isSynced, clipStartSec, clipDurationSec,
  ])

  // Render preview frame whenever options or previewTime change
  useEffect(() => {
    const canvas = previewCanvasRef.current
    const renderer = rendererRef.current
    if (!canvas || !renderer) return
    let cancelled = false
    const opts = buildRenderOptions(formatSpec.previewW * 2, formatSpec.previewH * 2)
    void renderer.renderFrame(canvas, opts, previewTime).catch(() => {
      if (!cancelled) setError('Could not render preview frame.')
    })
    return () => { cancelled = true }
  }, [buildRenderOptions, formatSpec, previewTime])

  // Deterministic time-stepped preview playback loop
  useEffect(() => {
    if (!previewPlaying || mode !== 'mp4') return
    let raf = 0
    let lastTs = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000))
      lastTs = now
      setPreviewTime((prev) => {
        const next = prev + dt
        return next >= clipDurationSec ? 0 : next
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [previewPlaying, mode, clipDurationSec])

  useEffect(() => {
    if (mode === 'png') setPreviewPlaying(false)
  }, [mode])

  useEffect(() => {
    setPreviewTime((t) => Math.min(t, Math.max(0, clipDurationSec - 0.05)))
  }, [clipDurationSec])

  const lastLineClickRef = useRef<{ i: number; at: number } | null>(null)
  const handleLineClick = (i: number): void => {
    const now = performance.now()
    const last = lastLineClickRef.current
    if (last && last.i === i && now - last.at < 350) {
      lastLineClickRef.current = null
      setSelected([i])
      return
    }
    lastLineClickRef.current = { i, at: now }
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i)
      if (prev.length >= MAX_LINES) return prev
      return [...prev, i].sort((a, b) => a - b)
    })
  }

  const syncClipToSelection = (): void => {
    const win = computeClipWindow(lines, selected, getAudioCurrentTime())
    setClipStartSec(win.startSec)
    setClipDurationSec(win.durationSec)
    setPreviewTime(0)
  }

  const fileName = `${title} - ${artist}`.replace(/[/\\?%*:|"<>]/g, '').trim() || 'lyrics'
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const canCopyImage = !!(window as any).electron?.copyImageToClipboard
    || (typeof navigator !== 'undefined' && !!navigator.clipboard?.write && typeof window.ClipboardItem === 'function')

  const renderFullPngBlob = async (): Promise<{ blob: Blob; dataUrl: string }> => {
    const resolvedArt = await artFetchRef.current
    if (!resolvedArt && imageUrl) setError('Cover art could not be embedded — exporting without cover.')
    const exportCanvas = document.createElement('canvas')
    const opts = buildRenderOptions(formatSpec.exportW, formatSpec.exportH, resolvedArt)
    await rendererRef.current!.renderFrame(exportCanvas, opts, mode === 'mp4' ? previewTime : 0)
    const dataUrl = exportCanvas.toDataURL('image/png')
    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty blob'))), 'image/png')
    })
    return { blob, dataUrl }
  }

  const handleDownloadPng = async (): Promise<void> => {
    setError(null)
    setStatusMsg(null)
    setBusy('download')
    try {
      const { dataUrl } = await renderFullPngBlob()
      const suffix = formatSpec.ratioLabel.replace(':', 'x')
      const outName = `${fileName}-${suffix}.png`
      const el = (window as any).electron
      if (el?.saveImageFile) {
        const res = await el.saveImageFile({ defaultName: outName, dataUrl })
        if (res?.canceled) return
        if (res?.error) throw new Error(res.error)
        setStatusMsg(`Saved PNG (${formatSpec.exportW}×${formatSpec.exportH})`)
      } else {
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = outName
        document.body.appendChild(a)
        a.click()
        a.remove()
        setStatusMsg(`Saved PNG (${formatSpec.exportW}×${formatSpec.exportH})`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate PNG image.')
    } finally {
      setBusy(null)
    }
  }

  const handleCopy = async (): Promise<void> => {
    setError(null)
    setStatusMsg(null)
    setBusy('copy')
    try {
      const { blob } = await renderFullPngBlob()
      await copyPngImage(blob)
      setStatusMsg('Copied PNG to clipboard')
    } catch {
      setError('Could not copy the image.')
    } finally {
      setBusy(null)
    }
  }

  const handleShare = async (): Promise<void> => {
    setError(null)
    setStatusMsg(null)
    setBusy('share')
    try {
      const { blob } = await renderFullPngBlob()
      const file = new File([blob], `${fileName}.png`, { type: 'image/png' })
      if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('unsupported')
      await navigator.share({ files: [file], title, text: `${title} - ${artist}` })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError('Could not share the image.')
    } finally {
      setBusy(null)
    }
  }

  const handleShareToChat = async (): Promise<void> => {
    setError(null)
    setStatusMsg(null)
    setBusy('chat')
    try {
      const { blob } = await renderFullPngBlob()
      setChatShareFile(new File([blob], `${fileName}.png`, { type: 'image/png' }))
    } catch {
      setError('Could not generate the image.')
    } finally {
      setBusy(null)
    }
  }

  const handleDownloadFfmpeg = async (): Promise<void> => {
    const el = (window as any).electron
    if (!el?.toolsDownload) return
    setError(null)
    setDownloadingFfmpeg(true)
    try {
      const res = await el.toolsDownload({ tools: ['ffmpeg'] })
      if (res?.error) throw new Error(res.error)
      setFfmpegReady(true)
      setStatusMsg('FFmpeg ready — you can export MP4 now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download FFmpeg.')
    } finally {
      setDownloadingFfmpeg(false)
    }
  }

  const handleCancelMp4 = async (): Promise<void> => {
    exportAbortRef.current = true
    const el = (window as any).electron
    if (activeVideoSessionRef.current && el?.shareVideoAbort) {
      await el.shareVideoAbort({ id: activeVideoSessionRef.current }).catch(() => {})
      activeVideoSessionRef.current = null
    }
  }

  const handleExportMp4 = async (): Promise<void> => {
    const el = (window as any).electron
    if (!el?.shareVideoStart) {
      setError('MP4 export requires the desktop app.')
      return
    }
    setError(null)
    setStatusMsg(null)
    setBusy('mp4')
    setMp4Progress(0)
    exportAbortRef.current = false
    setPreviewPlaying(false)

    try {
      const resolvedArt = await artFetchRef.current
      const w = formatSpec.exportW
      const h = formatSpec.exportH
      const fps = EXPORT_FPS
      const totalFrames = Math.max(1, Math.round(clipDurationSec * fps))

      let audioBytes: Uint8Array | null = null
      let safeAudioUrl: string | null = null
      if (includeAudio && resolvedAudioUrl) {
        if (resolvedAudioUrl.startsWith('blob:')) {
          const buf = await (await fetch(resolvedAudioUrl)).arrayBuffer()
          audioBytes = new Uint8Array(buf)
        } else {
          safeAudioUrl = resolvedAudioUrl
        }
      }

      const suffix = formatSpec.ratioLabel.replace(':', 'x')
      const started = await el.shareVideoStart({
        width: w,
        height: h,
        fps,
        durationSec: clipDurationSec,
        startSec: clipStartSec,
        includeAudio: includeAudio && !!(safeAudioUrl || audioBytes),
        audioUrl: safeAudioUrl,
        audioBytes,
        defaultName: `${fileName}-${suffix}.mp4`,
      })
      if (started?.canceled) return
      if (!started?.ok || !started.id) throw new Error(started?.error || 'Could not start MP4 encoder.')
      activeVideoSessionRef.current = started.id

      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = w
      exportCanvas.height = h
      const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true })!
      const opts: ShareRenderOptions = {
        ...buildRenderOptions(w, h, resolvedArt),
        isVideo: true,
      }

      for (let frame = 0; frame < totalFrames; frame++) {
        if (exportAbortRef.current) {
          throw new Error('Export canceled')
        }
        // Strictly deterministic time-stepped rendering (`frame / fps`), never wall clock
        const t = frame / fps
        await rendererRef.current!.renderFrame(exportCanvas, opts, t)
        const imgData = exportCtx.getImageData(0, 0, w, h)
        const res = await el.shareVideoFrame({
          id: started.id,
          frame: new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
        })
        if (res?.error) throw new Error(res.error)
        setMp4Progress(Math.round(((frame + 1) / totalFrames) * 95))
      }

      const finished = await el.shareVideoFinish({ id: started.id })
      activeVideoSessionRef.current = null
      if (!finished?.ok) throw new Error(finished?.error || 'MP4 encoding failed.')
      setMp4Progress(100)
      setStatusMsg(`Saved MP4 (${w}×${h}${finished.hasAudio ? ', with audio' : ', silent'})`)
    } catch (e) {
      if (activeVideoSessionRef.current && el?.shareVideoAbort) {
        await el.shareVideoAbort({ id: activeVideoSessionRef.current }).catch(() => {})
        activeVideoSessionRef.current = null
      }
      if (!exportAbortRef.current) {
        setError(e instanceof Error ? e.message : 'MP4 export failed.')
      } else {
        setStatusMsg('MP4 export canceled.')
      }
    } finally {
      setBusy(null)
      setMp4Progress(null)
    }
  }

  return (
    <>
      <ModalOverlay
        onClose={() => { if (busy === 'mp4') void handleCancelMp4(); onClose() }}
        standalone
        zIndexClassName="z-[170]"
        panelClassName="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-5xl h-[680px] max-h-[90vh]"
        minWidth={560}
        minHeight={440}
      >
        {() => (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] shrink-0 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <h2 className="text-text-primary text-sm font-semibold flex items-center gap-2 shrink-0">
                  <Sparkles size={15} className="text-accent" />
                  Share Studio
                </h2>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface-highest)]">
                  <button
                    type="button"
                    onClick={() => setMode('png')}
                    aria-pressed={mode === 'png'}
                    className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                      mode === 'png' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
                    }`}
                  >
                    <ImageIcon size={13} /> Image (PNG)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('mp4')}
                    aria-pressed={mode === 'mp4'}
                    className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                      mode === 'mp4' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
                    }`}
                  >
                    <Video size={13} /> Video (MP4)
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { if (busy === 'mp4') void handleCancelMp4(); onClose() }}
                title="Close"
                aria-label="Close"
                className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
              {/* Left column: Lyric line picker */}
              <div className="md:flex-1 min-w-0 md:min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-[var(--border)]">
                <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
                  <p className="text-xs text-text-muted">
                    {lines.length > 0
                      ? `Select up to ${MAX_LINES} lines (double-tap for one).`
                      : 'No lyrics on this track — export a Liquid Glass song card.'}
                  </p>
                  {mode === 'mp4' && isSynced && selected.length > 0 && (
                    <button
                      type="button"
                      onClick={syncClipToSelection}
                      className="text-[11px] font-medium text-accent hover:underline shrink-0"
                    >
                      Sync clip time
                    </button>
                  )}
                </div>
                <div className="max-h-48 md:max-h-none md:flex-1 md:min-h-0 overflow-y-auto px-2 pb-3">
                  {lines.map((line, i) => {
                    const isSelected = selectedSet.has(i)
                    const prevSelected = selectedSet.has(i - 1)
                    const nextSelected = selectedSet.has(i + 1)
                    const rounding = !isSelected
                      ? 'rounded-lg'
                      : prevSelected && nextSelected
                      ? 'rounded-none'
                      : prevSelected
                      ? 'rounded-b-lg rounded-t-none'
                      : nextSelected
                      ? 'rounded-t-lg rounded-b-none'
                      : 'rounded-lg'
                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => handleLineClick(i)}
                        className={`w-full text-left px-2.5 py-1.5 text-sm transition-colors flex items-baseline gap-2 ${rounding} ${
                          isSelected ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                        }`}
                      >
                        {line.time !== null && (
                          <span className="text-[10px] font-mono text-text-muted shrink-0">{formatClock(line.time)}</span>
                        )}
                        <span className="min-w-0 flex-1">{line.text}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Middle column: Studio options */}
              <div className="w-full md:w-[216px] shrink-0 min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r border-[var(--border)] p-3.5 flex flex-col gap-3.5">
                <div>
                  <p className="text-text-muted text-[11px] mb-1.5">Format</p>
                  <div className="flex flex-col gap-1">
                    {SHARE_FORMATS.map((f) => {
                      const active = format === f.key
                      const ratio = f.previewW / f.previewH
                      const boxH = 14
                      const boxW = Math.max(8, Math.min(24, Math.round(boxH * ratio)))
                      return (
                        <button
                          type="button"
                          key={f.key}
                          onClick={() => setFormat(f.key)}
                          aria-pressed={active}
                          className={`flex items-center justify-between gap-2 px-2 h-7 rounded-md text-[11px] font-medium transition-colors ${
                            active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className={`shrink-0 rounded-[2px] border ${active ? 'border-white/75' : 'border-current opacity-60'}`}
                              style={{ width: boxW, height: boxH }}
                            />
                            <span className="truncate">{f.label}</span>
                          </span>
                          <span className={`text-[9px] shrink-0 ${active ? 'text-white/80' : 'text-text-muted'}`}>
                            {f.exportW}×{f.exportH}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <SegmentedControl
                  label="Glass tone"
                  value={glassMode}
                  onChange={setGlassMode}
                  options={[{ key: 'dark', label: 'Dark Glass' }, { key: 'light', label: 'Light Glass' }]}
                />

                <div>
                  <p className="text-text-muted text-[11px] mb-1.5">Backdrop</p>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--surface-highest)]">
                    {([
                      { key: 'blur', label: 'Blur' }, { key: 'solid', label: 'Solid' },
                      { key: 'gradient', label: 'Gradient' }, { key: 'custom', label: 'Custom' },
                    ] as const).map((opt) => {
                      const active = bgStyle === opt.key
                      return (
                        <button
                          type="button"
                          key={opt.key}
                          onClick={() => setBgStyle(opt.key)}
                          aria-pressed={active}
                          className={`h-7 rounded-md text-[11px] font-medium transition-colors ${
                            active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
                          }`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  {bgStyle === 'custom' && (
                    <>
                      <input ref={bgFileInputRef} type="file" accept="image/*" onChange={handleCustomBgPick} className="hidden" />
                      <button
                        type="button"
                        onClick={() => bgFileInputRef.current?.click()}
                        className="mt-1.5 w-full h-7 rounded-md bg-[var(--surface-highest)] text-text-secondary text-[11px] font-medium flex items-center justify-center gap-1.5 hover:bg-surface-overlay transition-colors"
                      >
                        <ImagePlus size={12} /> {customBgUrl ? 'Change picture' : 'Choose picture'}
                      </button>
                    </>
                  )}
                </div>

                {mode === 'mp4' && (
                  <div className="rounded-xl bg-[var(--surface-highest)]/60 border border-[var(--border)] p-2.5 flex flex-col gap-2.5">
                    <div>
                      <p className="text-text-muted text-[11px] mb-1">Clip duration</p>
                      <div className="grid grid-cols-4 gap-1">
                        {VIDEO_DURATIONS.map((d) => (
                          <button
                            type="button"
                            key={d}
                            onClick={() => setClipDurationSec(d)}
                            aria-pressed={clipDurationSec === d}
                            className={`h-6 rounded text-[11px] font-medium transition-colors ${
                              clipDurationSec === d ? 'bg-accent text-white' : 'bg-[var(--surface-highest)] text-text-secondary hover:bg-surface-overlay'
                            }`}
                          >
                            {d}s
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-text-muted">Audio start</span>
                        <button
                          type="button"
                          onClick={() => setClipStartSec(Math.max(0, Math.floor(getAudioCurrentTime())))}
                          className="text-accent hover:underline"
                        >
                          Now ({formatClock(getAudioCurrentTime())})
                        </button>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={3600}
                        step={0.5}
                        value={clipStartSec}
                        onChange={(e) => setClipStartSec(Math.max(0, Number(e.target.value) || 0))}
                        aria-label="Audio start seconds"
                        className="w-full h-7 rounded-md bg-[var(--surface-highest)] text-text-primary text-[11px] px-2 outline-none focus:ring-1 focus:ring-accent/50"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-primary text-[11px] flex items-center gap-1.5">
                        {includeAudio && hasAudioSource ? <Volume2 size={12} /> : <VolumeX size={12} className="text-text-muted" />}
                        Track audio
                      </span>
                      <button
                        type="button"
                        onClick={() => setIncludeAudio((v) => !v)}
                        aria-pressed={includeAudio}
                        disabled={!hasAudioSource}
                        className={`flex items-center shrink-0 w-9 h-5 p-0.5 rounded-full transition-colors disabled:opacity-40 ${
                          includeAudio && hasAudioSource ? 'bg-accent justify-end' : 'bg-[var(--surface-highest)] justify-start'
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-white" />
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-text-muted text-[11px] mb-1.5">Font</p>
                  <button
                    type="button"
                    onClick={() => setFontMenuOpen((o) => !o)}
                    aria-expanded={fontMenuOpen}
                    className="w-full h-7 rounded-md bg-[var(--surface-highest)] hover:bg-surface-overlay transition-colors text-text-primary text-[11px] px-2 flex items-center justify-between gap-1"
                  >
                    <span className="truncate" style={{ fontFamily }}>
                      {fontId === 'custom' ? (customFont.trim() || 'Custom…') : getFont(fontId).name}
                    </span>
                    <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${fontMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {fontMenuOpen && (
                    <div className="mt-1 rounded-lg bg-[var(--surface-highest)] p-1 flex flex-col gap-0.5">
                      {allFonts().map((f) => (
                        <button
                          type="button"
                          key={f.id}
                          onClick={() => { setFontId(f.id); setFontMenuOpen(false) }}
                          className={`flex items-center justify-between gap-2 px-2 h-7 rounded-md text-xs transition-colors ${
                            fontId === f.id ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                          }`}
                          style={{ fontFamily: f.stack }}
                        >
                          <span className="truncate">{f.name}</span>
                          {fontId === f.id && <Check size={12} className="shrink-0" />}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFontId('custom')}
                        className={`flex items-center justify-between gap-2 px-2 h-7 rounded-md text-[11px] font-medium transition-colors ${
                          fontId === 'custom' ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                        }`}
                      >
                        Custom…
                        {fontId === 'custom' && <Check size={12} className="shrink-0" />}
                      </button>
                    </div>
                  )}
                  {fontId === 'custom' && (
                    <input
                      type="text"
                      value={customFont}
                      onChange={(e) => setCustomFont(e.target.value)}
                      placeholder="Font family name"
                      style={{ fontFamily }}
                      className="mt-1.5 w-full h-7 rounded-md bg-[var(--surface-highest)] text-text-primary text-[11px] px-2 outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-text-muted"
                    />
                  )}
                </div>

                <SegmentedControl
                  label="Text size"
                  value={textSize}
                  onChange={setTextSize}
                  options={[{ key: 'S', label: 'S' }, { key: 'M', label: 'M' }, { key: 'L', label: 'L' }]}
                />
                <SegmentedControl
                  label="Position"
                  value={textPos}
                  onChange={setTextPos}
                  options={[{ key: 'top', label: 'Top' }, { key: 'center', label: 'Mid' }, { key: 'bottom', label: 'Bottom' }]}
                />

                <div>
                  <p className="text-text-muted text-[11px] mb-1.5">Color</p>
                  <div className="flex items-center gap-2 px-0.5">
                    {TEXT_COLOR_PRESETS.map(({ key: c, value }) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setTextColor(c)}
                        aria-pressed={textColor === c}
                        title={c}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${
                          textColor === c ? 'scale-110 border-text-primary' : 'border-transparent hover:scale-105'
                        }`}
                        style={{ background: value, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}
                      />
                    ))}
                    <ThemedColorPicker
                      value={customTextColor}
                      onChange={(hex) => { setCustomTextColor(hex); setTextColor('custom') }}
                      title="Custom color"
                      pipette
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        textColor === 'custom' ? 'scale-110 border-text-primary' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-text-primary text-xs">Show song info</p>
                  <button
                    type="button"
                    onClick={() => setShowInfoBar((v) => !v)}
                    aria-pressed={showInfoBar}
                    className={`flex items-center shrink-0 w-9 h-5 p-0.5 rounded-full transition-colors ${
                      showInfoBar ? 'bg-accent justify-end' : 'bg-[var(--surface-highest)] justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white" />
                  </button>
                </div>
              </div>

              {/* Right column: Deterministic preview canvas + export controls */}
              <div className="min-w-0 md:w-[390px] shrink-0 md:min-h-0 flex flex-col items-center justify-between gap-3 p-4">
                <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                  <canvas
                    ref={previewCanvasRef}
                    data-share-preview-canvas="1"
                    className="rounded-2xl shadow-2xl border border-[var(--border)] max-w-full max-h-full object-contain"
                    style={{
                      aspectRatio: `${formatSpec.previewW} / ${formatSpec.previewH}`,
                      width: formatSpec.previewW,
                      height: 'auto',
                    }}
                  />
                </div>

                {mode === 'mp4' && (
                  <div className="w-full max-w-[344px] flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewPlaying((p) => !p)}
                      aria-label={previewPlaying ? 'Pause preview' : 'Play preview'}
                      className="w-8 h-8 rounded-full bg-[var(--surface-highest)] hover:bg-surface-overlay text-text-primary flex items-center justify-center shrink-0 transition-colors"
                    >
                      {previewPlaying ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={clipDurationSec}
                      step={0.05}
                      value={previewTime}
                      onChange={(e) => { setPreviewPlaying(false); setPreviewTime(Number(e.target.value)) }}
                      aria-label="Preview time"
                      className="flex-1 min-w-0 accent-[rgb(var(--accent-rgb))]"
                    />
                    <span className="text-[11px] font-mono text-text-muted shrink-0">
                      {previewTime.toFixed(1)}s / {clipDurationSec}s
                    </span>
                  </div>
                )}

                <div className="shrink-0 flex flex-col gap-2 w-full max-w-[344px]">
                  {mode === 'png' ? (
                    <div className="flex gap-2 w-full">
                      <button
                        type="button"
                        onClick={handleDownloadPng}
                        disabled={busy !== null}
                        data-share-export-png="1"
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 h-10 px-3 whitespace-nowrap rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                      >
                        {busy === 'download' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        Save PNG
                      </button>
                      {canCopyImage && (
                        <button
                          type="button"
                          onClick={handleCopy}
                          disabled={busy !== null}
                          title="Copy image"
                          aria-label="Copy image"
                          className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl bg-surface-overlay hover:bg-surface-highest disabled:opacity-50 text-text-primary transition-colors"
                        >
                          {busy === 'copy' ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                        </button>
                      )}
                      {canNativeShare && (
                        <button
                          type="button"
                          onClick={handleShare}
                          disabled={busy !== null}
                          className="flex-1 min-w-0 flex items-center justify-center gap-2 h-10 px-3 whitespace-nowrap rounded-xl bg-surface-overlay hover:bg-surface-highest disabled:opacity-50 text-text-primary text-sm font-semibold transition-colors"
                        >
                          {busy === 'share' ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />} Share
                        </button>
                      )}
                      {canShareToChat && (
                        <button
                          type="button"
                          onClick={handleShareToChat}
                          disabled={busy !== null}
                          title="Share to chat"
                          aria-label="Share to chat"
                          className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl bg-surface-overlay hover:bg-surface-highest disabled:opacity-50 text-text-primary transition-colors"
                        >
                          {busy === 'chat' ? <Loader2 size={15} className="animate-spin" /> : <MessagesSquare size={15} />}
                        </button>
                      )}
                    </div>
                  ) : ffmpegReady === false ? (
                    <button
                      type="button"
                      onClick={handleDownloadFfmpeg}
                      disabled={downloadingFfmpeg}
                      className="w-full flex items-center justify-center gap-2 h-10 px-3 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                    >
                      {downloadingFfmpeg ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                      {downloadingFfmpeg ? 'Downloading FFmpeg…' : 'Download FFmpeg for MP4'}
                    </button>
                  ) : (
                    <div className="flex gap-2 w-full">
                      <button
                        type="button"
                        onClick={handleExportMp4}
                        disabled={busy !== null || ffmpegReady === null}
                        data-share-export-mp4="1"
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 h-10 px-3 whitespace-nowrap rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                      >
                        {busy === 'mp4'
                          ? <><Loader2 size={15} className="animate-spin" /> Exporting {mp4Progress ?? 0}%</>
                          : <><Video size={15} /> Export MP4 ({formatSpec.ratioLabel})</>}
                      </button>
                      {busy === 'mp4' && (
                        <button
                          type="button"
                          onClick={() => void handleCancelMp4()}
                          className="px-3 h-10 shrink-0 rounded-xl bg-surface-overlay hover:bg-surface-highest text-text-primary text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}

                  {busy === 'mp4' && mp4Progress !== null && (
                    <div className="w-full h-1.5 rounded-full bg-[var(--surface-highest)] overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-150"
                        style={{ width: `${mp4Progress}%` }}
                      />
                    </div>
                  )}
                  {statusMsg && !error && <p className="text-emerald-400 text-xs text-center">{statusMsg}</p>}
                  {error && <p className="text-red-400 text-xs text-center">{error}</p>}
                </div>
              </div>
            </div>
          </div>
        )}
      </ModalOverlay>

      {chatShareFile && (
        <ShareLyricsCardModal
          file={chatShareFile}
          title={title}
          artist={artist}
          onClose={() => setChatShareFile(null)}
        />
      )}
    </>
  )
}
