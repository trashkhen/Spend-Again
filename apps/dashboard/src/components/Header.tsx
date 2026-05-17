import { useNavigate } from 'react-router-dom'
import { clearAuth } from '../lib/auth'

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

  // Always show "U" — UUID-based IDs don't produce meaningful initials
  const avatarInitial = 'U'

  return (
    <>
      {/* Mobile hamburger toggle */}
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onMenuToggle}
        aria-label="Toggle navigation menu"
      >
        ☰
      </button>

      <header className="app-header">
        {/* Search bar */}
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

        {/* Right actions */}
        <div className="header-actions">
          {/* Notification bell */}
          <div className="header-bell" role="button" aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span className="header-bell-dot" aria-hidden="true" />
          </div>

          {/* User */}
          <div className="header-user">
            <div className="header-avatar" aria-hidden="true">{avatarInitial}</div>
            <span className="header-username">User</span>
            <button
              type="button"
              className="logout-btn"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>
      </header>
    </>
  )
}
