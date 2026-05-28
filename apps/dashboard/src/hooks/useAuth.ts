import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { storeAuth, clearAuth, isAuthenticated, getUserId, storeTelegramProfile } from '../lib/auth'

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001'

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

        const result = (await response.json()) as {
          token: string
          userId: string
          telegramFirstName?: string | null
          telegramUsername?: string | null
        }

        storeAuth({ token: result.token, userId: result.userId })
        storeTelegramProfile({
          firstName: result.telegramFirstName ?? null,
          username: result.telegramUsername ?? null,
        })

        setState({ authenticated: true, userId: result.userId, loading: false, error: null })

        navigate('/welcome')
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Dev login failed'
      setState((prev) => ({ ...prev, loading: false, error: message }))
    }
  }, [navigate])

  const logout = useCallback((): void => {
    clearAuth()
    setState({ authenticated: false, userId: null, loading: false, error: null })
    navigate('/login')
  }, [navigate])

  return { ...state, loginWithTelegram, loginAsTestUser, logout }
}
