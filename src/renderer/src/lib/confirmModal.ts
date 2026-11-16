import { showAppToast } from './appToast'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface PendingConfirm extends Required<ConfirmOptions> {
  id: number
  resolve: (accepted: boolean) => void
}

let nextId = 1
let queue: PendingConfirm[] = []
const listeners = new Set<(current: PendingConfirm | null) => void>()

function notify(): void {
  const current = queue[0] ?? null
  listeners.forEach((fn) => fn(current))
}

/** Accessible Liquid Glass replacement for native window.confirm(). */
export function confirmGlass(input: string | ConfirmOptions): Promise<boolean> {
  const opts: ConfirmOptions = typeof input === 'string' ? { message: input } : input
  const msg = opts.message
  const looksDestructive = opts.destructive ?? /\b(delete|remove|revoke|discard|clear|reset|replace|reverse)\b/i.test(msg)
  const title = opts.title ?? (looksDestructive ? 'Confirm action' : 'Please confirm')
  const confirmLabel = opts.confirmLabel ?? (looksDestructive ? 'Confirm' : 'Continue')
  const cancelLabel = opts.cancelLabel ?? 'Cancel'

  return new Promise<boolean>((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        title,
        message: msg,
        confirmLabel,
        cancelLabel,
        destructive: looksDestructive,
        resolve,
      },
    ]
    notify()
  })
}

export function resolvePendingConfirm(id: number, accepted: boolean): void {
  const idx = queue.findIndex((item) => item.id === id)
  if (idx < 0) return
  const [item] = queue.splice(idx, 1)
  item.resolve(accepted)
  notify()
}

export function subscribeConfirmModal(fn: (current: PendingConfirm | null) => void): () => void {
  listeners.add(fn)
  fn(queue[0] ?? null)
  return () => { listeners.delete(fn) }
}

/** Show a brief confirmation toast with an optional one-click Undo action. */
export function showUndoToast(text: string, onUndo: () => void): void {
  showAppToast(text, {
    tone: 'info',
    action: { label: 'Undo', onClick: onUndo },
  })
}
