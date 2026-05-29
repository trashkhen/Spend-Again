import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { MonthlySpend } from '../../lib/analytics'

type Props = {
  data: MonthlySpend[]
  budget?: number  // in SGD dollars, e.g. 1000
}

export function MonthlySpendChart({ data, budget }: Props) {
  const hasData = data.some((d) => d.total > 0)

  if (!hasData) {
    return (
      <div className="chart-empty">
        <p>No spending data for the last 6 months.</p>
      </div>
    )
  }

  return (
    <div className="chart-wrapper">
      <h3 className="chart-title">Monthly Spend (Last 6 Months)</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(19,107,76,0.08)" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `S$${v}`}
          />
          <Tooltip
            formatter={(value) => {
              const num = typeof value === 'number' ? value : parseFloat(String(value))
              return [`S$${num.toFixed(2)}`, 'Spend']
            }}
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
            labelStyle={{ color: 'var(--color-text)' }}
          />
          <Bar dataKey="total" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
          {budget != null && (
            <ReferenceLine
              y={budget}
              stroke="#ef4444"
              strokeDasharray="6 4"
              strokeWidth={2}
              label={{
                value: `Budget S$${budget}`,
                position: 'right',
                fill: '#ef4444',
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
