import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { storeAuth, clearAuth, isAuthenticated, getUserId } from '../lib/auth'

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001'

/**
 * Generates a mock JWT that passes the client-side expiry check.
 * Used as a fallback when the API dev-login endpoint is unreachable.
 * The token is NOT cryptographically valid — only suitable for UI testing.
 */
function createMockDevToken(userId: string): string {
  const toBase64Url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const header = toBase64Url({ alg: 'HS256', typ: 'JWT' })
  const payload = toBase64Url({
    userId,
    telegramId: '__dev_test__',
    iss: 'spend-again',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  })
  return `${header}.${payload}.dev-mock-signature`
}

export type TelegramAuthData = {
  id: string
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export type AuthState = {
  authenticated: boolean
  userId: string | null
  loading: boolean
  error: string | null
}

export type UseAuthReturn = AuthState & {
  loginWithTelegram: (data: TelegramAuthData) => Promise<void>
  loginAsTestUser: () => Promise<void>
  logout: () => void
}

export function useAuth(): UseAuthReturn {
  const navigate = useNavigate()

  const [state, setState] = useState<AuthState>(() => ({
    authenticated: isAuthenticated(),
    userId: getUserId(),
    loading: false,
    error: null,
  }))

  const loginWithTelegram = useCallback(
    async (data: TelegramAuthData): Promise<void> => {
      setState((prev) => ({ ...prev, loading: true, error: null }))

      try {
        const response = await fetch(`${API_BASE}/api/auth/telegram-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const body = (await response.json()) as { error?: string }
          throw new Error(body.error ?? `HTTP ${response.status}`)
        }

        const result = (await response.json()) as { token: string; userId: string }

        storeAuth({ token: result.token, userId: result.userId })

        setState({ authenticated: true, userId: result.userId, loading: false, error: null })

        navigate('/dashboard')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed'
        setState((prev) => ({ ...prev, loading: false, error: message }))
      }
    },
    [navigate],
  )

  const loginAsTestUser = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`${API_BASE}/api/auth/dev-login`, { method: 'POST' })

      if (!response.ok) {
        throw new Error(`Dev login failed: HTTP ${response.status}`)
      }

      const result = (await response.json()) as { token: string; userId: string }

      storeAuth({ token: result.token, userId: result.userId })
      setState({ authenticated: true, userId: result.userId, loading: false, error: null })
      navigate('/dashboard')
    } catch {
      // API unreachable in dev — use a locally-generated mock token so the UI is
      // still testable without a running backend.
      console.warn('[dev] API unreachable — using offline mock token')
      const mockUserId = 'dev-offline-user'
      const mockToken = createMockDevToken(mockUserId)
      storeAuth({ token: mockToken, userId: mockUserId })
      setState({ authenticated: true, userId: mockUserId, loading: false, error: null })
      navigate('/dashboard')
    }
  }, [navigate])

  const logout = useCallback((): void => {
    clearAuth()
    setState({ authenticated: false, userId: null, loading: false, error: null })
    navigate('/login')
  }, [navigate])

  return { ...state, loginWithTelegram, loginAsTestUser, logout }
}
