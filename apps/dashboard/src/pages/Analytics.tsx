import { useState, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { SpendingSummary } from '../components/charts/SpendingSummary'
import { MonthlySpendChart } from '../components/charts/MonthlySpendChart'
import { CategoryBreakdown } from '../components/charts/CategoryBreakdown'
import { DailyTrend } from '../components/charts/DailyTrend'
import { listTransactions } from '../lib/api'
import { getUserId } from '../lib/auth'
import {
  computeSummary,
  computeMonthlySpend,
  computeCategoryBreakdown,
  computeDailyTrend,
} from '../lib/analytics'
import type { ApiTransaction } from '../lib/api'

export function Analytics() {
  const userId = getUserId()

  const [transactions, setTransactions] = useState<ApiTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
      sixMonthsAgo.setDate(1)

      const data = await listTransactions({ userId: userId ?? undefined })

      const filtered = data.filter((tx) => {
        const parts = tx.date.split('/')
        const txYear = parseInt(parts[2] ?? '0', 10)
        const txMonth = parseInt(parts[1] ?? '0', 10)
        const txDate = new Date(txYear, txMonth - 1, 1)
        return txDate >= sixMonthsAgo
      })

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

  const summary = computeSummary(transactions)
  const monthly = computeMonthlySpend(transactions)
  const categories = computeCategoryBreakdown(transactions)
  const daily = computeDailyTrend(transactions)

  return (
    <Layout>
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Detailed insights into your spending patterns.</p>
      </div>

      {loading && (
        <div className="table-state">
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
    </Layout>
  )
}
