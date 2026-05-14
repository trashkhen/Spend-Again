import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SpendingSummary } from '../components/charts/SpendingSummary'
import { MonthlySpendChart } from '../components/charts/MonthlySpendChart'
import { CategoryBreakdown } from '../components/charts/CategoryBreakdown'
import { DailyTrend } from '../components/charts/DailyTrend'
import { listTransactions } from '../lib/api'
import { getUserId, clearAuth } from '../lib/auth'
import {
  computeSummary,
  computeMonthlySpend,
  computeCategoryBreakdown,
  computeDailyTrend,
} from '../lib/analytics'
import type { ApiTransaction } from '../lib/api'

export function Analytics() {
  const navigate = useNavigate()
  const userId = getUserId()

  const [transactions, setTransactions] = useState<ApiTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch last 6 months of data for the charts
      const now = new Date()
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const startYear = String(sixMonthsAgo.getFullYear())

      // We fetch without month/year filter so we get all data for computation.
      // For larger datasets a dedicated analytics endpoint would be preferable.
      const data = await listTransactions({ userId: userId ?? undefined })
      // Filter client-side to last 6 months
      const filtered = data.filter((tx) => {
        const parts = tx.date.split('/')
        const txYear = parseInt(parts[2] ?? '0', 10)
        const txMonth = parseInt(parts[1] ?? '0', 10)
        const txDate = new Date(txYear, txMonth - 1, 1)
        return txDate >= sixMonthsAgo
      })

      // Suppress unused variable warning — startYear used for documentation only
      void startYear
      setTransactions(filtered)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  const summary = computeSummary(transactions)
  const monthly = computeMonthlySpend(transactions)
  const categories = computeCategoryBreakdown(transactions)
  const daily = computeDailyTrend(transactions)

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-header-left">
          <span className="dashboard-logo-mark">S$</span>
          <h1 className="dashboard-title">Spend Again?</h1>
        </div>
        <nav className="dashboard-nav">
          <a href="/dashboard" className="nav-link">Transactions</a>
          <a href="/analytics" className="nav-link nav-link--active">Analytics</a>
        </nav>
        <button type="button" className="logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <main className="dashboard-main">
        {loading && (
          <div className="table-state table-state--loading">
            <span className="spinner" aria-label="Loading analytics..." />
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button type="button" className="error-retry-btn" onClick={() => void fetchAll()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* KPI cards */}
            <section className="dashboard-section">
              <h2 className="section-heading">This Month at a Glance</h2>
              <SpendingSummary summary={summary} />
            </section>

            {/* Charts grid */}
            <section className="dashboard-section">
              <div className="charts-grid">
                <MonthlySpendChart data={monthly} />
                <CategoryBreakdown data={categories} />
              </div>
            </section>

            <section className="dashboard-section">
              <DailyTrend data={daily} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
