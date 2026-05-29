import { useLocation, Link } from 'react-router-dom'
import { getTelegramDisplayName } from '../lib/auth'

type NavItem = {
  path: string
  label: string
  icon: React.ReactNode
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <rect x="2" y="2" width="7" height="7" rx="1.5"/>
      <rect x="11" y="2" width="7" height="7" rx="1.5"/>
      <rect x="2" y="11" width="7" height="7" rx="1.5"/>
      <rect x="11" y="11" width="7" height="7" rx="1.5"/>
    </svg>
  )
}

function IconAnalytics() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <rect x="2" y="12" width="3" height="6" rx="1"/>
      <rect x="7" y="8" width="3" height="10" rx="1"/>
      <rect x="12" y="5" width="3" height="13" rx="1"/>
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { path: '/analytics', label: 'Analytics', icon: <IconAnalytics /> },
]

type Props = {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: Props) {
  const { pathname } = useLocation()
  const displayName = getTelegramDisplayName()
  const avatarInitial = displayName[0]?.toUpperCase() ?? 'U'

  return (
    <>
      <div
        className={`layout-sidebar-overlay${isOpen ? ' layout-sidebar-overlay--visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar${isOpen ? ' sidebar--open' : ''}`} aria-label="Sidebar navigation">
        <img src="/logo_v2.png" alt="Spend Again?" className="sidebar-logo-img" />

        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                onClick={onClose}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              </Link>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-avatar" aria-hidden="true">{avatarInitial}</div>
        </div>
      </aside>
    </>
  )
}
