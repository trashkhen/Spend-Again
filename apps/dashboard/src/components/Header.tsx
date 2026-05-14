import { useNavigate } from 'react-router-dom'
import { clearAuth, getUserId } from '../lib/auth'

type Props = {
  onMenuToggle: () => void
}

export function Header({ onMenuToggle }: Props) {
  const navigate = useNavigate()
  const userId = getUserId()

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

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
        <span className="header-title">Spend Again?</span>

        <div className="header-user">
          {userId && (
            <span className="header-username">
              User {userId.slice(0, 8)}…
            </span>
          )}
          <button
            type="button"
            className="logout-btn"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>
    </>
  )
}
