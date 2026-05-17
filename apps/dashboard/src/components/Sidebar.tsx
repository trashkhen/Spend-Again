import { useLocation, Link } from 'react-router-dom'

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
      <rect x="17" y="2" width="1" height="16" rx="0.5" opacity="0.3"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M10 13a3 3 0 100-6 3 3 0 000 6zm0-1.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M10 2a1 1 0 00-1 1v.28a7.1 7.1 0 00-1.47.61l-.2-.2a1 1 0 00-1.41 0L4.5 5.1a1 1 0 000 1.42l.2.2A7.1 7.1 0 004.09 8.2 7.1 7.1 0 004 9H3a1 1 0 000 2h1.09a7.1 7.1 0 00.61 1.47l-.2.2a1 1 0 000 1.42l1.42 1.41a1 1 0 001.41 0l.2-.2c.46.25.95.45 1.47.61V17a1 1 0 002 0v-1.09a7.1 7.1 0 001.47-.61l.2.2a1 1 0 001.41 0l1.42-1.41a1 1 0 000-1.42l-.2-.2c.25-.46.45-.95.61-1.47H17a1 1 0 000-2h-1.09a7.1 7.1 0 00-.61-1.47l.2-.2a1 1 0 000-1.42l-1.42-1.41a1 1 0 00-1.41 0l-.2.2A7.1 7.1 0 0011 3.28V3a1 1 0 00-1-1z"/>
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { path: '/analytics', label: 'Analytics', icon: <IconAnalytics /> },
  { path: '/settings',  label: 'Settings',  icon: <IconSettings /> },
]

type Props = {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: Props) {
  const { pathname } = useLocation()

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`layout-sidebar-overlay${isOpen ? ' layout-sidebar-overlay--visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar${isOpen ? ' sidebar--open' : ''}`} aria-label="Sidebar navigation">
        {/* Logo */}
        <div className="sidebar-logo">
          <img src="/logo.png" alt="Spend Again?" className="sidebar-logo-img" />
          <span className="sidebar-logo-name">Spend Again?</span>
          <span className="sidebar-logo-sub">AI Finance Tracker</span>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                onClick={onClose}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <p className="sidebar-copyright">© {new Date().getFullYear()} Spend Again</p>
        </div>
      </aside>
    </>
  )
}
