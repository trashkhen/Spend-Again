import type { SpendingSummary as SummaryData } from '../../lib/analytics'

type Props = {
  summary: SummaryData
}

function fmtSGD(amount: number): string {
  return `S$${amount.toFixed(2)}`
}

export function SpendingSummary({ summary }: Props) {
  return (
    <div className="kpi-grid">
      <div className="kpi-card">
        <span className="kpi-label">Total this month</span>
        <span className="kpi-value">{fmtSGD(summary.totalThisMonth)}</span>
      </div>
      <div className="kpi-card">
        <span className="kpi-label">Daily average</span>
        <span className="kpi-value">{fmtSGD(summary.averageDaily)}</span>
      </div>
      <div className="kpi-card">
        <span className="kpi-label">Top category</span>
        <span className="kpi-value">{summary.topCategory ?? '—'}</span>
      </div>
      <div className="kpi-card">
        <span className="kpi-label">Transactions</span>
        <span className="kpi-value">{summary.transactionCount}</span>
      </div>
    </div>
  )
}
