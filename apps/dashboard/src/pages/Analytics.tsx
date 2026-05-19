import { useState, useEffect, useCallback, useMemo } from 'react'
import { Layout } from '../components/Layout'
import { MonthlySpendChart } from '../components/charts/MonthlySpendChart'
import { CategoryBreakdown } from '../components/charts/CategoryBreakdown'
import { DailyTrend } from '../components/charts/DailyTrend'
import { listTransactions, getBudget } from '../lib/api'
import { getUserId } from '../lib/auth'
import { computeSummary, computeMonthlySpend } from '../lib/analytics'
import type { ApiTransaction, BudgetSettings } from '../lib/api'

function fmtSGD(amount: number): string {
  return `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function Analytics() {
  const userId = getUserId()
  const now = new Date()

  const [transactions, setTransactions] = useState<ApiTransaction[]>([])
  const [budget, setBudget] = useState<BudgetSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryMonth, setCategoryMonth] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [dailyMonth, setDailyMonth] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })

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

  const summary = useMemo(
    () => computeSummary(transactions, categoryMonth.month, categoryMonth.year),
    [transactions, categoryMonth],
  )
  const monthly = useMemo(() => computeMonthlySpend(transactions), [transactions])

  const summaryMonthLabel = new Date(categoryMonth.year, categoryMonth.month - 1, 1)
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
                month={categoryMonth.month}
                year={categoryMonth.year}
                onMonthChange={(month, year) => setCategoryMonth({ month, year })}
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
              month={dailyMonth.month}
              year={dailyMonth.year}
              onMonthChange={(month, year) => setDailyMonth({ month, year })}
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
