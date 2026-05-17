import { useState, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { FilterBar } from '../components/FilterBar'
import { TransactionTable } from '../components/TransactionTable'
import { listTransactions } from '../lib/api'
import { getUserId } from '../lib/auth'
import { computeSummary } from '../lib/analytics'
import type { ApiTransaction } from '../lib/api'
import type { Filters } from '../components/FilterBar'

const DEFAULT_FILTERS: Filters = {
  category: '',
  search: '',
  month: String(new Date().getMonth() + 1).padStart(2, '0'),
  year: String(new Date().getFullYear()),
  page: 1,
}

function fmtSGD(amount: number): string {
  return `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function Dashboard() {
  const userId = getUserId()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [allTransactions, setAllTransactions] = useState<ApiTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await listTransactions({
        category: filters.category || undefined,
        month: filters.month || undefined,
        year: filters.year || undefined,
        userId: userId ?? undefined,
      })
      setAllTransactions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }, [filters.category, filters.month, filters.year, userId])

  useEffect(() => {
    void fetchTransactions()
  }, [fetchTransactions])

  // Client-side text search — driven by both FilterBar and Header search
  const filtered = filters.search
    ? allTransactions.filter((tx) =>
        tx.item.toLowerCase().includes(filters.search.toLowerCase()),
      )
    : allTransactions

  const summary = computeSummary(allTransactions)

  return (
    <Layout
      searchValue={filters.search}
      onSearchChange={(val) => setFilters((prev) => ({ ...prev, search: val, page: 1 }))}
    >
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Welcome back! Here's your financial overview.</p>
      </div>

      {/* KPI summary cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--blue">💳</div>
            <span className="kpi-trend kpi-trend--up">↑ this month</span>
          </div>
          <span className="kpi-label">Monthly Spending</span>
          <span className="kpi-value">{fmtSGD(summary.totalThisMonth)}</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--green">📈</div>
            <span className="kpi-trend kpi-trend--up">avg / day</span>
          </div>
          <span className="kpi-label">Daily Average</span>
          <span className="kpi-value">{fmtSGD(summary.averageDaily)}</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--orange">🏆</div>
            <span className="kpi-trend" style={{ color: 'var(--color-warning)' }}>top spend</span>
          </div>
          <span className="kpi-label">Top Category</span>
          <span className="kpi-value" style={{ fontSize: '17px' }}>{summary.topCategory ?? '—'}</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--blue">🧾</div>
            <span className="kpi-trend kpi-trend--up">this month</span>
          </div>
          <span className="kpi-label">Transactions</span>
          <span className="kpi-value">{summary.transactionCount}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="dashboard-section">
        <FilterBar filters={filters} onChange={setFilters} />

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button type="button" className="error-retry-btn" onClick={() => void fetchTransactions()}>
              Retry
            </button>
          </div>
        )}

        <TransactionTable
          transactions={filtered}
          loading={loading}
          page={filters.page}
          onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
        />
      </div>
    </Layout>
  )
}
