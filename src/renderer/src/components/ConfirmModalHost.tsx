import { useEffect, useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { ModalOverlay } from './Modal'
import {
  resolvePendingConfirm,
  subscribeConfirmModal,
  type PendingConfirm,
} from '../lib/confirmModal'

export default function ConfirmModalHost(): JSX.Element | null {
  const [current, setCurrent] = useState<PendingConfirm | null>(null)
  useEffect(() => subscribeConfirmModal(setCurrent), [])

  if (!current) return null

  return (
    <ModalOverlay
      key={current.id}
      standalone
      onClose={() => resolvePendingConfirm(current.id, false)}
      zIndexClassName="z-[220]"
      panelClassName="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-sm"
      minWidth={300}
      minHeight={160}
    >
      {() => (
        <div className="p-5 flex flex-col gap-4" data-confirm-modal="1">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                current.destructive ? 'bg-red-500/15 text-red-400' : 'bg-accent/15 text-accent'
              }`}
            >
              {current.destructive ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-text-primary">{current.title}</h2>
              <p className="mt-1 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                {current.message}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              data-confirm-cancel="1"
              onClick={() => resolvePendingConfirm(current.id, false)}
              className="px-3.5 h-9 rounded-xl bg-surface-overlay hover:bg-surface-highest text-text-primary text-xs font-medium transition-colors"
            >
              {current.cancelLabel}
            </button>
            <button
              type="button"
              data-confirm-accept="1"
              onClick={() => resolvePendingConfirm(current.id, true)}
              className={`px-4 h-9 rounded-xl text-white text-xs font-semibold transition-colors ${
                current.destructive
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-accent hover:bg-accent-hover'
              }`}
            >
              {current.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
