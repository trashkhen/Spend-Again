import { useEffect, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { TelegramAuthData } from '../hooks/useAuth'

const BOT_NAME = import.meta.env['VITE_TELEGRAM_BOT_NAME'] ?? 'SpendAgainBot'

/**
 * Telegram Login Widget injects a global callback.
 * We extend Window to avoid TypeScript errors.
 */
declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthData) => void
  }
}

export function Login() {
  const { authenticated, loading, error, loginWithTelegram } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Register the global callback the Telegram widget will call after login
    window.onTelegramAuth = (user: TelegramAuthData) => {
      void loginWithTelegram(user)
    }

    // Inject the Telegram Login Widget script
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', BOT_NAME)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true

    if (containerRef.current) {
      containerRef.current.appendChild(script)
    }

    return () => {
      delete window.onTelegramAuth
      if (containerRef.current && script.parentNode === containerRef.current) {
        containerRef.current.removeChild(script)
      }
    }
  }, [loginWithTelegram])

  // Already authenticated — redirect to dashboard
  if (authenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-icon">S$</span>
          <h1 className="login-title">Spend Again?</h1>
          <p className="login-subtitle">Your Singapore expense tracker</p>
        </div>

        <div className="login-widget-area">
          {loading ? (
            <p className="login-loading">Signing you in...</p>
          ) : (
            <>
              <p className="login-prompt">Sign in with your Telegram account to continue.</p>
              <div ref={containerRef} className="login-widget-container" />
            </>
          )}

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
