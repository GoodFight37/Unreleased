// Each era's official image (the API site's /assets/, built with buildImageUrl)
// and an accent measured from it (dominant vivid hue, lifted to a readable
// lightness), for the Tracker's era row. Measured 2026-11-16 from /eras/ and
// the most common song cover per era; an era missing here falls back to its
// first song's cover and the app accent.
export const ERA_LOOK: Record<string, { art: string; accent: string }> = {
  'jute':         { art: '/assets/jute.webp', accent: '#dbb362' },
  'LND':          { art: '/assets/lnd.webp', accent: '#f44866' },
  'afflictions':  { art: '/assets/aff.webp', accent: '#e66c56' },
  'HIH 999':      { art: '/assets/hih_999.webp', accent: '#d7666e' },
  'jw 999':       { art: '/assets/999.webp', accent: '#ef5f4e' },
  'bdm':          { art: '/assets/bdm.webp', accent: '#9e9e9e' },
  'ND':           { art: '/assets/nd.webp', accent: '#d2776a' },
  'GB&GR':        { art: '/assets/gbgr.webp', accent: '#eed24f' },
  'WOD':          { art: '/assets/wod.webp', accent: '#d7b365' },
  'DRFL':         { art: '/assets/drfl.webp', accent: '#d37b6a' },
  'OUT':          { art: '/assets/outsiderz.webp', accent: '#caaa72' },
  'POST':         { art: '/assets/posthumous.webp', accent: '#6397d9' },
  'TPP':          { art: '/assets/tpp.webp', accent: '#fff13d' },
  'TPP (EE)':     { art: '/assets/tpp_ee.webp', accent: '#fff13d' },
  'FD':           { art: '/assets/fd.webp', accent: '#ec8b51' },
  'FD (DDE)':     { art: '/assets/fd.webp', accent: '#ec8b51' },
  'TPNE':         { art: '/assets/tpne.webp', accent: '#d16bbe' },
  'TPNE 2.0':     { art: '/assets/tpne.webp', accent: '#d16bbe' },
  'LND (5YAE)':   { art: '/assets/lnd.webp', accent: '#f44866' },
  'Mainstream':   { art: '/assets/mainstream.webp', accent: '#f44f48' },
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Sort key for an era's start, from its free-text time frame ("February 17th
 *  2017- April 12th 2017", "October 2024", "2018"): yyyymmdd of the first date,
 *  Infinity when there is none, so undated eras go last. */
export function eraStart(timeFrame: string | null | undefined): number {
  const first = (timeFrame ?? '').split(/[-–—]/)[0].toLowerCase()
  const year = first.match(/\b(19|20)\d{2}\b/)
  if (!year) return Infinity
  const month = MONTHS.findIndex((m) => first.includes(m)) + 1
  const day = Number(first.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/)?.[1] ?? 0)
  return Number(year[0]) * 10000 + month * 100 + day
}
