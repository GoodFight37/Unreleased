import { ChevronLeft, ExternalLink, BookOpen } from 'lucide-react'
import { useStorePick } from '../store/useStore'

export default function DocsPage(): JSX.Element {
  const { setActiveView, previousView } = useStorePick('setActiveView', 'previousView')
  const backView = previousView && previousView !== 'docs' ? previousView : 'home'

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView(backView)}
            title="Back"
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-text-primary text-xl font-bold">API Docs</h1>
          <span className="text-xs text-text-muted font-mono">juicewrldapi.com</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-player flex items-center justify-center">
        <div className="max-w-md w-full rounded-2xl border border-[var(--border)] bg-[var(--fill)] p-6 text-center space-y-4">
          <BookOpen size={28} className="mx-auto text-accent" />
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-text-primary">Juice WRLD API Documentation</h2>
            <p className="text-sm text-text-secondary">
              The live API reference is maintained online so endpoints, parameters and auth scopes stay up to date.
            </p>
          </div>
          <a
            href="https://juicewrldapi.com/api-docs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Open live API docs <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  )
}
