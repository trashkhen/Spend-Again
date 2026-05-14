import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { DailySpend } from '../../lib/analytics'

type Props = {
  data: DailySpend[]
}

export function DailyTrend({ data }: Props) {
  const hasData = data.some((d) => d.total > 0)

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No daily data available yet this month.</p>
      </div>
    )
  }

  if (!hasData) {
    return (
      <div className="chart-empty">
        <p>No spending recorded this month.</p>
      </div>
    )
  }

  return (
    <div className="chart-wrapper">
      <h3 className="chart-title">Daily Spend (This Month)</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="day"
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
            labelFormatter={(label) => `Day ${label}`}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
