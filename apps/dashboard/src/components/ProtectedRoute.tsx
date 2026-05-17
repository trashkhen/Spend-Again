import { Navigate } from 'react-router-dom'
import { isAuthenticated } from '../lib/auth'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/**
 * Wraps a route and redirects to /login if the user is not authenticated.
 */
export function ProtectedRoute({ children }: Props) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
