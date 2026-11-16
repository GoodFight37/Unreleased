import { Suspense, createContext, lazy, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ChatUserBrief } from '../../lib/chatApi'

export interface UserCardState {
  user: ChatUserBrief
  x: number
  y: number
}

const LazyOtherUserCard = lazy(() => import('./UserCard').then((m) => ({ default: m.OtherUserCard })))

const UserCardContext = createContext<(user: ChatUserBrief, e: { clientX: number; clientY: number }) => void>(() => {})

export function useOpenUserCard(): (user: ChatUserBrief, e: { clientX: number; clientY: number }) => void {
  return useContext(UserCardContext)
}

export function UserCardHost({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<UserCardState | null>(null)
  const open = useCallback((user: ChatUserBrief, e: { clientX: number; clientY: number }) => {
    setState({ user, x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setState(null), [])
  return (
    <UserCardContext.Provider value={open}>
      {children}
      {state && (
        <Suspense fallback={null}>
          <LazyOtherUserCard key={state.user.id} user={state.user} x={state.x} y={state.y} onClose={close} />
        </Suspense>
      )}
    </UserCardContext.Provider>
  )
}
