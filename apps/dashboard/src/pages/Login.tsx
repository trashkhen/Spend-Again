import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const BOT_NAME = import.meta.env['VITE_TELEGRAM_BOT_NAME'] ?? 'spend_again_bot'

export function Login() {
  const { authenticated, loading, error, loginAsTestUser } = useAuth()

  if (authenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="Spend Again?" className="login-logo-img" />
          <h1 className="login-title">Spend Again?</h1>
          <p className="login-subtitle">Your Singapore expense tracker</p>
        </div>

        <div className="login-widget-area">
          {loading ? (
            <p className="login-loading">Signing you in…</p>
          ) : (
            <>
              <p className="login-prompt">Sign in with your Telegram account to continue.</p>

              <a
                href={`https://t.me/${BOT_NAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="login-bot-link"
              >
                <svg className="login-bot-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                Chat with @{BOT_NAME}
              </a>

              <ol className="login-steps">
                <li className="login-step">
                  <span className="login-step-num">1</span>
                  <span className="login-step-text">Click the button above to open the Telegram bot</span>
                </li>
                <li className="login-step">
                  <span className="login-step-num">2</span>
                  <span className="login-step-text">Send <code className="login-step-code">/start</code> in the chat</span>
                </li>
                <li className="login-step">
                  <span className="login-step-num">3</span>
                  <span className="login-step-text">Press the <strong>🌐 Bring me to Site</strong> button — you'll be logged in automatically</span>
                </li>
              </ol>
            </>
          )}

          {import.meta.env.DEV && (
            <div className="login-dev-section">
              <p className="login-dev-label">Dev mode</p>
              <button
                className="login-dev-button"
                onClick={() => void loginAsTestUser()}
                disabled={loading}
                type="button"
              >
                Skip login (test user)
              </button>
            </div>
          )}

          {error && (
            <div className="login-error" role="alert">{error}</div>
          )}
        </div>
      </div>
    </div>
  )
}
