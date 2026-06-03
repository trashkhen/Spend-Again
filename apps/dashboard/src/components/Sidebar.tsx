import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { applyTheme, getInitialTheme, getNextTheme, persistTheme } from '../lib/theme'
import type { ReactNode } from 'react'

type NavItem = {
  path: string
  label: string
  icon: ReactNode
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

function IconRecurring() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10a6 6 0 0 1 10.5-4"/>
      <path d="M16 10a6 6 0 0 1-10.5 4"/>
      <polyline points="14 6 17 6 17 3"/>
      <polyline points="6 14 3 14 3 17"/>
    </svg>
  )
}

function IconSpaces() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a8 8 0 1 0 0 16A8 8 0 0 0 10 2zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 10c-2.67 0-5.01-1.28-6.46-3.26C4.82 10.47 7.27 9.5 10 9.5s5.18.97 6.46 2.24C14.01 13.72 11.67 15 10 15z"/>
    </svg>
  )
}

function IconIOUs() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 1a9 9 0 1 0 0 18A9 9 0 0 0 10 1zm.75 13.5h-1.5v-5.25H7.75v-1.5h3v6.75zm-.75-8.25a1.125 1.125 0 1 1 0-2.25 1.125 1.125 0 0 1 0 2.25z"/>
    </svg>
  )
}

function IconSun() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 1.8v2" />
      <path d="M10 16.2v2" />
      <path d="m4.2 4.2 1.4 1.4" />
      <path d="m14.4 14.4 1.4 1.4" />
      <path d="M1.8 10h2" />
      <path d="M16.2 10h2" />
      <path d="m4.2 15.8 1.4-1.4" />
      <path d="m14.4 5.6 1.4-1.4" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path d="M15.8 12.72A6.78 6.78 0 0 1 7.28 4.2 6.86 6.86 0 1 0 15.8 12.72Z" />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Home', icon: <IconDashboard /> },
  { path: '/analytics', label: 'Analytics', icon: <IconAnalytics /> },
  { path: '/recurring', label: 'Recurring', icon: <IconRecurring /> },
  { path: '/spaces', label: 'Spaces', icon: <IconSpaces /> },
  { path: '/people', label: 'IOUs', icon: <IconIOUs /> },
]

type Props = {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: Props) {
  const { pathname } = useLocation()
  const [theme, setTheme] = useState(getInitialTheme)
  const isDark = theme === 'dark'

  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
  }, [theme])

  function handleThemeToggle() {
    setTheme((currentTheme) => getNextTheme(currentTheme))
  }

  return (
    <>
      <div
        className={`layout-sidebar-overlay${isOpen ? ' layout-sidebar-overlay--visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar${isOpen ? ' sidebar--open' : ''}`} aria-label="Sidebar navigation">
        <div className="sidebar-logo-row">
          <img src="/logo_v2.png" alt="Spend Again?" className="sidebar-logo-img" />
          <span className="sidebar-logo-name">Spend Again?</span>
        </div>

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
                <span className="nav-label">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="theme-toggle"
            onClick={handleThemeToggle}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDark}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="theme-toggle-icon" aria-hidden="true">
              {isDark ? <IconSun /> : <IconMoon />}
            </span>
          </button>
        </div>
      </aside>
    </>
  )
}
