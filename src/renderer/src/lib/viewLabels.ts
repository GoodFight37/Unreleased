import type { ViewType } from '../types'

const LISTENING_LABELS: Partial<Record<ViewType, string>> = {
  home: 'Discover',
  'api-tracker': 'Catalogue',
  footage: 'Footage',
  'api-files': 'Catalogue files',
  playlists: 'Collection',
  library: 'On this device',
}

export function viewLabel(view: ViewType, fallback: string, developerMode: boolean): string {
  return developerMode ? fallback : LISTENING_LABELS[view] ?? fallback
}
