import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from 'lucide-react'
import {
  ARCHIVE_PHOTO_MONTHS,
  getMonthPhotos,
  getUnsortedPhotos,
  type ArchivePhoto,
} from '../lib/archivePhotos'

type PhotoBucket = '2018' | '2019' | 'unsorted'

/** Real Juice WRLD Photo Archive browser (Others/Photos/2018 Photos, 2019 Photos & Unsorted). */
export default function ArchivePhotosGallery(): JSX.Element {
  const [bucket, setBucket] = useState<PhotoBucket>('2019')
  const [month, setMonth] = useState<number>(7) // July 2019 — iconic JW3 studio summer
  const [photos, setPhotos] = useState<ArchivePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(36)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setVisibleCount(36)
    const req = bucket === 'unsorted'
      ? getUnsortedPhotos(96)
      : getMonthPhotos(bucket === '2018' ? 2018 : 2019, month)
    void req.then((list) => {
      if (!cancelled) {
        setPhotos(list)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [bucket, month])

  useEffect(() => {
    if (lightboxIdx === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLightboxIdx(null)
      else if (e.key === 'ArrowRight') setLightboxIdx((i) => (i === null ? null : (i + 1) % photos.length))
      else if (e.key === 'ArrowLeft') setLightboxIdx((i) => (i === null ? null : (i - 1 + photos.length) % photos.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, photos.length])

  const activePhoto = lightboxIdx !== null ? photos[lightboxIdx] : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([
          { id: '2018' as const, label: '2018 Archive' },
          { id: '2019' as const, label: '2019 Archive' },
          { id: 'unsorted' as const, label: 'Curated Vault (3,400+)' },
        ]).map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBucket(b.id)}
            aria-pressed={bucket === b.id}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              bucket === b.id
                ? 'bg-accent/15 text-accent border-[var(--accent)]'
                : 'bg-[var(--fill)] text-text-secondary border-transparent hover:text-text-primary hover:bg-[var(--fill-strong)]'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {bucket !== 'unsorted' && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Archive month">
          {ARCHIVE_PHOTO_MONTHS.map((name, i) => {
            const m = i + 1
            const active = month === m
            return (
              <button
                key={name}
                type="button"
                onClick={() => setMonth(m)}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? 'bg-text-primary text-[var(--surface)]'
                    : 'bg-[var(--fill)] text-text-secondary hover:text-text-primary hover:bg-[var(--fill-strong)]'
                }`}
              >
                {name.slice(0, 3)}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-text-muted text-sm">
          <Loader2 size={16} className="animate-spin" />
          <span>Loading archive photos…</span>
        </div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2 text-sm">
          <Camera size={24} className="opacity-40" />
          <span>No photos in this folder yet.</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {photos.slice(0, visibleCount).map((photo, i) => (
              <button
                key={photo.path}
                type="button"
                onClick={() => setLightboxIdx(i)}
                className="group relative aspect-square rounded-xl overflow-hidden bg-[var(--fill)] border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <img
                  src={photo.thumbUrl}
                  alt={photo.name}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                  onError={(e) => {
                    if (e.currentTarget.src !== photo.fullUrl) e.currentTarget.src = photo.fullUrl
                  }}
                />
                <span className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/75 to-transparent text-[10px] font-mono-ui text-white/85 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                  {photo.caption}
                </span>
              </button>
            ))}
          </div>
          {photos.length > visibleCount && (
            <div className="coffre-more">
              <button
                type="button"
                className="coffre-secondary"
                onClick={() => setVisibleCount((c) => c + 36)}
              >
                Show more photos · {(photos.length - visibleCount).toLocaleString()} left
              </button>
            </div>
          )}
        </>
      )}

      {activePhoto && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Archive photo viewer"
          className="fixed inset-0 z-[240] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6"
          onClick={() => setLightboxIdx(null)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <a
              href={activePhoto.fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white transition-colors"
            >
              Original <ExternalLink size={12} />
            </a>
            <button
              type="button"
              onClick={() => setLightboxIdx(null)}
              aria-label="Close photo"
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="relative max-w-5xl max-h-[82vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {photos.length > 1 && (
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => setLightboxIdx((i) => (i === null ? null : (i - 1 + photos.length) % photos.length))}
                className="mr-3 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <img
              src={activePhoto.fullUrl}
              alt={activePhoto.name}
              className="max-h-[80vh] max-w-[82vw] object-contain rounded-xl shadow-2xl"
            />
            {photos.length > 1 && (
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => setLightboxIdx((i) => (i === null ? null : (i + 1) % photos.length))}
                className="ml-3 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>
          <p className="mt-3 font-mono-ui text-xs text-white/75 tracking-wider">
            {activePhoto.caption} · {(lightboxIdx ?? 0) + 1} / {photos.length}
          </p>
        </div>,
        document.body,
      )}
    </div>
  )
}
