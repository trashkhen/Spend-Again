import { Navigate, useNavigate } from 'react-router-dom'
import { isAuthenticated } from '../lib/auth'

const BOT_NAME = import.meta.env['VITE_TELEGRAM_BOT_NAME'] ?? 'spend_again_bot'

export function Welcome() {
  const navigate = useNavigate()

  // Render-time navigation via the imperative navigate() is illegal in React
  // (sets parent state during a child's render). Use <Navigate> instead.
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="welcome-page">
      <div className="welcome-card">
        <div className="welcome-header">
          <div className="welcome-check">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h1 className="welcome-title">You're all set!</h1>
          <p className="welcome-subtitle">
            Your Telegram account is verified. What would you like to do?
          </p>
        </div>

        <div className="welcome-options">
          <button
            type="button"
            className="welcome-option welcome-option--primary"
            onClick={() => navigate('/dashboard')}
          >
            <span className="welcome-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </span>
            <span className="welcome-option-text">
              <strong>Open Dashboard</strong>
              <span>View your spending on the web</span>
            </span>
            <svg className="welcome-option-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <a
            href={`https://t.me/${BOT_NAME}?start=add`}
            target="_blank"
            rel="noopener noreferrer"
            className="welcome-option"
          >
            <span className="welcome-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </span>
            <span className="welcome-option-text">
              <strong>Add Transactions</strong>
              <span>Log expenses via Telegram bot</span>
            </span>
            <svg className="welcome-option-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>

          <a
            href={`https://t.me/${BOT_NAME}?start=pull`}
            target="_blank"
            rel="noopener noreferrer"
            className="welcome-option"
          >
            <span className="welcome-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
            <span className="welcome-option-text">
              <strong>Pull Data</strong>
              <span>Get your spending summary via bot</span>
            </span>
            <svg className="welcome-option-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>
        </div>

        <p className="welcome-footer-note">
          You can always switch between the web app and the bot anytime.
        </p>
      </div>
    </div>
  )
}
