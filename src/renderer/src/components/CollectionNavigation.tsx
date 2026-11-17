import { FolderOpen, Heart, ListMusic, Disc3 } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { IS_ELECTRON } from '../lib/platform'
import type { ViewType } from '../types'

export default function CollectionNavigation(): JSX.Element | null {
  const { activeView, setActiveView, developerMode } = useStorePick('activeView', 'setActiveView', 'developerMode')
  if (developerMode) return null
  const pages = [
    { view: 'playlists', label: 'Playlists', icon: ListMusic },
    { view: 'liked', label: 'Liked songs', icon: Heart },
    { view: 'albums', label: 'Albums', icon: Disc3 },
    { view: 'library', label: 'On this device', icon: FolderOpen },
  ].filter((page) => page.view !== 'library' || IS_ELECTRON)
  return <nav className="collection-navigation" aria-label="Your collection">
    {pages.map(({ view, label, icon: Icon }) => <button key={view} type="button"
      onClick={() => setActiveView(view as ViewType)} aria-current={activeView === view ? 'page' : undefined}>
      <Icon size={15} aria-hidden /><span>{label}</span>
    </button>)}
  </nav>
}
