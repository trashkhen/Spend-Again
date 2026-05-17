import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  searchValue?: string
  onSearchChange?: (value: string) => void
}

/**
 * Main app shell — sidebar + header + content area.
 * The sidebar collapses to a hamburger menu on mobile.
 * Optional searchValue / onSearchChange are threaded to the Header search bar.
 */
export function Layout({ children, searchValue, onSearchChange }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function closeSidebar() {
    setSidebarOpen(false)
  }

  function toggleSidebar() {
    setSidebarOpen((prev) => !prev)
  }

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      <div className="app-content">
        <Header
          onMenuToggle={toggleSidebar}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
        />
        <main className="app-main page-enter">
          {children}
        </main>
      </div>
    </div>
  )
}
