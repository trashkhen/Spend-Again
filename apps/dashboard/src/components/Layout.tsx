import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/**
 * Main app shell — sidebar + header + content area.
 * The sidebar collapses to a hamburger menu on mobile.
 */
export function Layout({ children }: Props) {
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
        <Header onMenuToggle={toggleSidebar} />
        <main className="app-main page-enter">
          {children}
        </main>
      </div>
    </div>
  )
}
