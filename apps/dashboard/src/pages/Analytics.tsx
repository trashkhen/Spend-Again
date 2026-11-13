import { useState, useEffect, useCallback, useMemo } from 'react'
import { emojiFor } from '@spend-again/shared'
import { Layout } from '../components/Layout'
import { CategoryDonut } from '../components/ui/CategoryDonut'
import {
  MonthHistoryChart,
  MonthTrendChart,
  WeekdayChart,
  YearTrendChart,
} from '../components/charts/AnalyticsCharts'
import { listAllTransactions, getBudget, getMonthlyAnalytics } from '../lib/api'
import { getUserId } from '../lib/auth'
import {
  computePeriodCategoryBreakdown,
  computePeriodComparison,
  computePeriodSummary,
  periodLabel,
  periodShortLabel,
  previousPeriodOf,
  topTransactions,
} from '../lib/analytics'
import { fmtSGD, fmtShortDate } from '../lib/format'
import type { ApiTransaction, BudgetSettings, MonthlyAnalyticsItem } from '../lib/api'
import type { Period } from '../lib/analytics'

type Mode = 'month' | 'year'

function periodQuery(period: Period): { month?: string; year?: string } {
  const q: { month?: string; year?: string } = {}
  if (period.year !== null) q.year = String(period.year)
  if (period.month !== null) q.month = String(period.month).padStart(2, '0')
  return q
}

function IconChevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <path d="M12.5 4.5 7 10l5.5 5.5" /> : <path d="M7.5 4.5 13 10l-5.5 5.5" />}
    </svg>
  )
}

export function Analytics() {
  const userId = getUserId()
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const [mode, setMode] = useState<Mode>('month')
  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(currentYear)

  const [transactions, setTransactions] = useState<ApiTransaction[]>([])
  const [previousTotal, setPreviousTotal] = useState(0)
  const [history, setHistory] = useState<MonthlyAnalyticsItem[]>([])
  const [budget, setBudget] = useState<BudgetSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const period: Period = useMemo(
    () => (mode === 'month' ? { month, year } : { month: null, year }),
    [mode, month, year],
  )
  const previousPeriod = useMemo(() => previousPeriodOf(period), [period])

  const fetchPeriod = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const uid = userId ?? undefined
      const [data, prev] = await Promise.all([
        listAllTransactions({ ...periodQuery(period), userId: uid }),
        previousPeriod
          ? listAllTransactions({ ...periodQuery(previousPeriod), userId: uid })
          : Promise.resolve<ApiTransaction[]>([]),
      ])
      setTransactions(data)
      setPreviousTotal(previousPeriod ? computePeriodSummary(prev, previousPeriod).total : 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [period, previousPeriod, userId])

  useEffect(() => { void fetchPeriod() }, [fetchPeriod])

  useEffect(() => {
    getMonthlyAnalytics(12).then(setHistory).catch(() => {})
    getBudget().then(setBudget).catch(() => {})
  }, [])

  // ── Navigation ──────────────────────────────────────────────────────────────
  const isCurrent = mode === 'month' ? month === currentMonth && year === currentYear : year === currentYear
  const canGoNext = mode === 'month'
    ? year < currentYear || (year === currentYear && month < currentMonth)
    : year < currentYear

  function step(delta: -1 | 1) {
    if (delta === 1 && !canGoNext) return
    if (mode === 'year') { setYear((y) => y + delta); return }
    const d = new Date(year, month - 1 + delta, 1)
    setMonth(d.getMonth() + 1)
    setYear(d.getFullYear())
  }

  function goToMonth(m: number, y: number) {
    setMode('month')
    setMonth(m)
    setYear(y)
  }

  function resetToCurrent() {
    setMonth(currentMonth)
    setYear(currentYear)
  }

  // ── Derived numbers ─────────────────────────────────────────────────────────
  const summary = useMemo(() => computePeriodSummary(transactions, period), [transactions, period])
  const breakdown = useMemo(() => computePeriodCategoryBreakdown(transactions, period), [transactions, period])
  const biggest = useMemo(() => topTransactions(transactions, 6), [transactions])
  const comparison = previousPeriod
    ? computePeriodComparison(summary.total, previousTotal, periodShortLabel(previousPeriod))
    : null

  const monthlyBudget = budget?.monthlyBudget != null ? budget.monthlyBudget / 100 : null
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysLeft = mode === 'month' && isCurrent ? daysInMonth - now.getDate() : 0
  const budgetPct = mode === 'month' && monthlyBudget ? Math.round((summary.total / monthlyBudget) * 100) : null
  const budgetLeft = monthlyBudget != null ? monthlyBudget - summary.total : 0
  const projected = mode === 'month' && isCurrent ? summary.averageDaily * daysInMonth : null
  const monthsElapsed = mode === 'year' ? (year === currentYear ? currentMonth : 12) : 1
  const avgPerTx = summary.transactionCount > 0 ? summary.total / summary.transactionCount : 0
  const biggestTx = biggest[0]

  const label = periodLabel(period)

  return (
    <Layout>
      {/* ── Header with period controls ── */}
      <div className="an-header">
        <div className="an-header-text">
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Where your money went, and how it's trending.</p>
        </div>

        <div className="an-controls">
          <div className="ui-seg" role="tablist" aria-label="Period type">
            {(['month', 'year'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`ui-seg-btn${mode === m ? ' is-active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
          </div>

          <div className="an-stepper">
            <button type="button" className="an-step-btn" onClick={() => step(-1)} aria-label={`Previous ${mode}`}>
              <IconChevron dir="left" />
            </button>
            <button
              type="button"
              className="an-step-label"
              onClick={resetToCurrent}
              disabled={isCurrent}
              title={isCurrent ? undefined : `Back to this ${mode}`}
            >
              {label}
            </button>
            <button type="button" className="an-step-btn" onClick={() => step(1)} disabled={!canGoNext} aria-label={`Next ${mode}`}>
              <IconChevron dir="right" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button type="button" className="error-retry-btn" onClick={() => void fetchPeriod()}>Retry</button>
        </div>
      )}

      {/* ── Stat tiles ── */}
      <div className={`an-stats${loading ? ' is-loading' : ''}`}>
        <div className="an-stat an-stat--hero">
          <div className="an-stat-top">
            <span className="an-stat-label">Total spent</span>
            {comparison && (
              <span className={`ui-chip ui-chip--${comparison.tone === 'up' ? 'bad' : comparison.tone === 'down' ? 'good' : 'neutral'}`}>
                {comparison.label}
              </span>
            )}
          </div>
          <span className="an-stat-value an-stat-value--xl">{fmtSGD(summary.total)}</span>

          {budgetPct != null && monthlyBudget != null ? (
            <div className="an-budget">
              <div className="ui-progress" aria-label={`${budgetPct}% of budget used`}>
                <div
                  className={`ui-progress-fill${budgetPct > 100 ? ' is-over' : budgetPct >= (budget?.budgetAlertPct ?? 100) * 0.8 ? ' is-warn' : ''}`}
                  style={{ width: `${Math.min(100, budgetPct)}%` }}
                />
              </div>
              <div className="an-budget-meta">
                <span>{budgetPct}% of {fmtSGD(monthlyBudget)}</span>
                <span className={budgetLeft < 0 ? 'is-over' : ''}>
                  {budgetLeft >= 0 ? `${fmtSGD(budgetLeft)} left` : `${fmtSGD(-budgetLeft)} over`}
                  {isCurrent && daysLeft > 0 ? ` · ${daysLeft}d to go` : ''}
                </span>
              </div>
            </div>
          ) : (
            <span className="an-stat-sub">
              {mode === 'year' ? `≈ ${fmtSGD(summary.total / monthsElapsed)} per month` : 'Set a monthly budget on the Home page to track it here'}
            </span>
          )}
        </div>

        <div className="an-stat">
          <span className="an-stat-label">Daily average</span>
          <span className="an-stat-value">{fmtSGD(summary.averageDaily)}</span>
          <span className="an-stat-sub">
            {projected != null
              ? <>On track for <strong>{fmtSGD(projected)}</strong> this month</>
              : mode === 'year' ? `Across ${year === currentYear ? 'the year so far' : year}` : `Across ${daysInMonth} days`}
          </span>
        </div>

        <div className="an-stat">
          <span className="an-stat-label">Biggest expense</span>
          {biggestTx ? (
            <>
              <span className="an-stat-value">{fmtSGD(parseFloat(biggestTx.amount))}</span>
              <span className="an-stat-sub an-stat-sub--truncate">
                {emojiFor(biggestTx.category)} {biggestTx.item} · {fmtShortDate(biggestTx.occurredOn)}
              </span>
            </>
          ) : (
            <span className="an-stat-value">—</span>
          )}
        </div>

        <div className="an-stat">
          <span className="an-stat-label">Transactions</span>
          <span className="an-stat-value">{summary.transactionCount}</span>
          <span className="an-stat-sub">{summary.transactionCount > 0 ? `Avg ${fmtSGD(avgPerTx)} each` : 'Nothing logged yet'}</span>
        </div>
      </div>

      {/* ── Trend + categories ── */}
      <div className={`an-grid an-grid--main${loading ? ' is-loading' : ''}`}>
        {mode === 'month' ? (
          <MonthTrendChart transactions={transactions} month={month} year={year} budget={monthlyBudget} />
        ) : (
          <YearTrendChart transactions={transactions} year={year} budget={monthlyBudget} onSelectMonth={(m) => goToMonth(m, year)} />
        )}

        <div className="an-card">
          <div className="an-card-head">
            <div>
              <h3 className="an-card-title">Where it went</h3>
              <p className="an-card-sub">
                {summary.topCategory ? <><strong>{summary.topCategory}</strong> leads in {label}</> : `Categories in ${label}`}
              </p>
            </div>
          </div>
          <CategoryDonut data={breakdown} centerLabel={mode === 'month' ? 'This month' : 'This year'} emptyText={`No spending in ${label}.`} maxRows={6} />
        </div>
      </div>

      {/* ── Biggest expenses + weekday pattern ── */}
      <div className={`an-grid an-grid--split${loading ? ' is-loading' : ''}`}>
        <div className="an-card">
          <div className="an-card-head">
            <div>
              <h3 className="an-card-title">Biggest expenses</h3>
              <p className="an-card-sub">Your largest transactions in {label}</p>
            </div>
          </div>
          {biggest.length === 0 ? (
            <div className="ui-empty-inline">Nothing logged yet.</div>
          ) : (
            <ol className="an-top-list">
              {biggest.map((tx, i) => {
                const amount = parseFloat(tx.amount)
                const share = summary.total > 0 ? Math.round((amount / summary.total) * 100) : 0
                return (
                  <li key={tx.id} className="an-top-row">
                    <span className="an-top-rank">{i + 1}</span>
                    <span className="an-top-emoji">{emojiFor(tx.category)}</span>
                    <div className="an-top-body">
                      <span className="an-top-item">{tx.item}</span>
                      <span className="an-top-meta">{tx.category} · {fmtShortDate(tx.occurredOn, mode === 'year')}</span>
                    </div>
                    <div className="an-top-right">
                      <span className="an-top-amount">{fmtSGD(amount)}</span>
                      <span className="an-top-share">{share}% of total</span>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <WeekdayChart transactions={transactions} />
      </div>

      {/* ── History ── */}
      <div className="an-grid">
        <MonthHistoryChart
          data={history}
          budget={monthlyBudget}
          selected={mode === 'month' ? { month, year } : null}
          onSelect={goToMonth}
        />
      </div>
    </Layout>
  )
}
