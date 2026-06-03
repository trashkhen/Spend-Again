import { useNavigate } from 'react-router-dom'
import { clearAuth, getTelegramDisplayName } from '../lib/auth'

type Props = {
  onMenuToggle: () => void
  searchValue?: string | undefined
  onSearchChange?: ((value: string) => void) | undefined
}

export function Header({ onMenuToggle, searchValue, onSearchChange }: Props) {
  const navigate = useNavigate()

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  const displayName = getTelegramDisplayName()
  const avatarInitial = displayName[0]?.toUpperCase() ?? 'U'

  return (
    <header className="app-header">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onMenuToggle}
          aria-label="Toggle navigation menu"
        >
          ☰
        </button>

        <div className="header-search">
          <span className="header-search-icon">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="9" cy="9" r="6"/>
              <path d="m15 15 3 3"/>
            </svg>
          </span>
          <input
            type="text"
            className="header-search-input"
            placeholder="Search transactions..."
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            aria-label="Search transactions"
          />
        </div>

        <div className="header-actions">
          <div className="header-user">
            <div className="header-avatar" aria-hidden="true">{avatarInitial}</div>
            <span className="header-username">Hi, {displayName}!</span>
            <button type="button" className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
    </header>
  )
}
