import { useState, useEffect, useCallback, useMemo } from 'react'
import { Layout } from '../components/Layout'
import { MonthlySpendChart } from '../components/charts/MonthlySpendChart'
import { CategoryBreakdown } from '../components/charts/CategoryBreakdown'
import { DailyTrend } from '../components/charts/DailyTrend'
import { listTransactions, getBudget, getMonthlyAnalytics } from '../lib/api'
import { getUserId } from '../lib/auth'
import { computeSummary } from '../lib/analytics'
import type { ApiTransaction, BudgetSettings, MonthlyAnalyticsItem } from '../lib/api'
import type { MonthlySpend } from '../lib/analytics'

function fmtSGD(amount: number): string {
  return `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function Analytics() {
  const userId = getUserId()
  const now = new Date()

  const [transactions, setTransactions] = useState<ApiTransaction[]>([])
  const [monthlyData, setMonthlyData] = useState<MonthlyAnalyticsItem[]>([])
  const [budget, setBudget] = useState<BudgetSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })

  const fetchTransactions = useCallback(async (month: number, year: number) => {
    const data = await listTransactions({
      userId: userId ?? undefined,
      month: String(month).padStart(2, '0'),
      year: String(year),
    })
    setTransactions(data)
  }, [userId])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([
        getMonthlyAnalytics(6).then(setMonthlyData),
        fetchTransactions(selectedMonth.month, selectedMonth.year),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [userId, selectedMonth.month, selectedMonth.year, fetchTransactions])

  useEffect(() => { void fetchAll() }, [fetchAll])

  useEffect(() => {
    void (async () => {
      try {
        const b = await getBudget()
        setBudget(b)
      } catch {
        // budget is optional
      }
    })()
  }, [])

  const handleMonthChange = useCallback((month: number, year: number) => {
    setSelectedMonth({ month, year })
    void fetchTransactions(month, year)
  }, [fetchTransactions])

  const summary = useMemo(
    () => computeSummary(transactions, selectedMonth.month, selectedMonth.year),
    [transactions, selectedMonth],
  )

  const monthly: MonthlySpend[] = useMemo(
    () => monthlyData.map((item) => ({ label: item.label, total: item.totalCents / 100 })),
    [monthlyData],
  )

  const summaryMonthLabel = new Date(selectedMonth.year, selectedMonth.month - 1, 1)
    .toLocaleString('en-SG', { month: 'long', year: 'numeric' })

  return (
    <Layout>
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
          <button type="button" className="error-retry-btn" onClick={() => void fetchAll()}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Top row: Category Breakdown + Summary */}
          <section className="dashboard-section">
            <div className="analytics-top-grid">
              <CategoryBreakdown
                transactions={transactions}
                month={selectedMonth.month}
                year={selectedMonth.year}
                onMonthChange={handleMonthChange}
              />

              <div className="chart-wrapper analytics-summary-card">
                <h3 className="chart-title">{summaryMonthLabel} Summary</h3>
                <div className="analytics-summary-rows">
                  <div className="analytics-summary-row">
                    <span className="analytics-summary-label">Total this month</span>
                    <span className="analytics-summary-value">
                      {fmtSGD(summary.totalThisMonth)}
                      {budget?.monthlyBudget != null && (
                        <span className="budget-kpi-sub"> / {fmtSGD(budget.monthlyBudget / 100)}</span>
                      )}
                    </span>
                  </div>
                  <div className="analytics-summary-row">
                    <span className="analytics-summary-label">Daily average</span>
                    <span className="analytics-summary-value">{fmtSGD(summary.averageDaily)}</span>
                  </div>
                  <div className="analytics-summary-row">
                    <span className="analytics-summary-label">Top category</span>
                    <span className="analytics-summary-value">{summary.topCategory ?? '—'}</span>
                  </div>
                  <div className="analytics-summary-row">
                    <span className="analytics-summary-label">Transactions</span>
                    <span className="analytics-summary-value">{summary.transactionCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Daily Spend */}
          <section className="dashboard-section">
            <DailyTrend
              transactions={transactions}
              month={selectedMonth.month}
              year={selectedMonth.year}
              onMonthChange={handleMonthChange}
            />
          </section>

          {/* Monthly Spend */}
          <section className="dashboard-section">
            <MonthlySpendChart
              data={monthly}
              {...(budget?.monthlyBudget != null ? { budget: budget.monthlyBudget / 100 } : {})}
            />
          </section>
        </>
      )}
    </Layout>
  )
}
