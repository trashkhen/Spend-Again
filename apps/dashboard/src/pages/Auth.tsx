import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { storeAuth } from '../lib/auth'

function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    return JSON.parse(atob(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
}

export function Auth() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')

    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    const payload = decodeTokenPayload(token)
    if (!payload) {
      setError('Invalid login link. Please try again from the Telegram bot.')
      return
    }

    const exp = payload['exp']
    if (typeof exp === 'number' && Date.now() / 1000 >= exp) {
      setError('This login link has expired. Press "📊 Dashboard" in the bot again to get a fresh one.')
      return
    }

    const userId = payload['userId']
    if (typeof userId !== 'string') {
      setError('Invalid login link. Please try again from the Telegram bot.')
      return
    }

    storeAuth({ token, userId })
    navigate('/welcome', { replace: true })
  }, [searchParams, navigate])

  if (error) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="auth-error-icon">⚠️</div>
          <h2 className="auth-error-title">Login link problem</h2>
          <p className="auth-error-body">{error}</p>
          <button
            type="button"
            className="auth-back-btn"
            onClick={() => navigate('/login', { replace: true })}
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ alignItems: 'center', gap: '16px' }}>
        <div className="spinner" />
        <p className="login-loading">Logging you in…</p>
      </div>
    </div>
  )
}
