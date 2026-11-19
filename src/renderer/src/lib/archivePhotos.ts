// Real Juice WRLD archive photography from the primary Comp channel:
//   Others/Photos/2018 Photos/<Month>
//   Others/Photos/2019 Photos/<Month>
//   Others/Photos/Unsorted
// Uses apiFetch + buildStreamUrl + smallCoverUrl fallback (never image-thumbnail alone).

import {
  apiFetch,
  buildStreamUrl,
  smallCoverUrl,
  type JWApiFileEntry,
  type JWApiSong,
} from './juicewrldApi'
import { songDates } from './onThisDay'

export interface ArchivePhoto {
  path: string
  name: string
  thumbUrl: string
  fullUrl: string
  year: number | null
  month: string | null
  caption: string
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const folderCache = new Map<string, Promise<ArchivePhoto[]>>()

function entryToPhoto(entry: JWApiFileEntry, year: number | null, month: string | null): ArchivePhoto | null {
  if (entry.type && entry.type !== 'file') return null
  if (!IMAGE_EXT_RE.test(entry.path)) return null
  // Primary comp channel always omits `&channel=...`
  const fullUrl = buildStreamUrl(entry.path)
  const thumbUrl = smallCoverUrl(fullUrl) ?? fullUrl
  const caption = year && month
    ? `${month.toUpperCase()} ${year} · ARCHIVE PHOTO`
    : year
      ? `${year} · ARCHIVE PHOTO`
      : 'JUICE WRLD · ARCHIVE PHOTO'
  return {
    path: entry.path,
    name: entry.name,
    thumbUrl,
    fullUrl,
    year,
    month,
    caption,
  }
}

export function listArchivePhotoFolder(
  folder: string,
  year: number | null = null,
  month: string | null = null,
): Promise<ArchivePhoto[]> {
  const cached = folderCache.get(folder)
  if (cached) return cached
  const req = apiFetch<{ items?: JWApiFileEntry[] }>('/files/browse/', { path: folder })
    .then((res) => {
      const items = Array.isArray(res?.items) ? res.items : []
      const photos: ArchivePhoto[] = []
      for (const item of items) {
        const photo = entryToPhoto(item, year, month)
        if (photo) photos.push(photo)
      }
      return photos
    })
    .catch(() => {
      folderCache.delete(folder)
      return []
    })
  folderCache.set(folder, req)
  return req
}

export function getMonthPhotos(year: 2018 | 2019, monthIndex1Based: number): Promise<ArchivePhoto[]> {
  const monthName = MONTHS[monthIndex1Based - 1]
  if (!monthName) return Promise.resolve([])
  return listArchivePhotoFolder(`Others/Photos/${year} Photos/${monthName}`, year, monthName)
}

export function getUnsortedPhotos(limit = 60): Promise<ArchivePhoto[]> {
  return listArchivePhotoFolder('Others/Photos/Unsorted', null, null).then((all) => {
    if (all.length <= limit) return all
    // Deterministic spread across the 3,400+ archive so every view gets variety.
    const step = Math.max(1, Math.floor(all.length / limit))
    const picked: ArchivePhoto[] = []
    for (let i = 0; i < all.length && picked.length < limit; i += step) picked.push(all[i])
    return picked
  })
}

let featuredPromise: Promise<ArchivePhoto[]> | null = null

/** Curated real photography spanning Juice WRLD's iconic 2018–2019 studio & tour eras. */
export function getFeaturedArchivePhotos(): Promise<ArchivePhoto[]> {
  if (!featuredPromise) {
    const iconicMonths: [2018 | 2019, number][] = [
      [2018, 5],  // May 2018 — GB&GR release
      [2018, 8],  // Aug 2018 — WOD / summer tour
      [2019, 3],  // Mar 2019 — DRFL release
      [2019, 7],  // Jul 2019 — JW3 peak studio summer
      [2019, 10], // Oct 2019 — Late JW3 / tour
    ]
    featuredPromise = Promise.all(iconicMonths.map(([y, m]) => getMonthPhotos(y, m)))
      .then((groups) => {
        const out: ArchivePhoto[] = []
        // Interleave up to 6 photos from each era month for rich variety.
        for (let slot = 0; slot < 6; slot++) {
          for (const g of groups) {
            if (g[slot]) out.push(g[slot])
          }
        }
        return out
      })
      .catch(() => {
        featuredPromise = null
        return []
      })
  }
  return featuredPromise
}

/** Resolves real Juice WRLD photos taken in the exact month & year a song was recorded. */
export async function photosForSong(song: JWApiSong | null | undefined): Promise<ArchivePhoto[]> {
  if (!song) return getFeaturedArchivePhotos()
  const dates = songDates(song)
  const rec = dates.find((d) => d.kind === 'recorded' && (d.year === 2018 || d.year === 2019))
    ?? dates.find((d) => d.year === 2018 || d.year === 2019)
  if (rec && (rec.year === 2018 || rec.year === 2019) && rec.month >= 1 && rec.month <= 12) {
    const exact = await getMonthPhotos(rec.year, rec.month)
    if (exact.length > 0) return exact
  }
  return getFeaturedArchivePhotos()
}

export const ARCHIVE_PHOTO_MONTHS = MONTHS
