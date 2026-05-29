import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { computeDailyTrend } from '../../lib/analytics'
import type { ApiTransaction } from '../../lib/api'

type Props = {
  transactions: ApiTransaction[]
  month: number
  year: number
  onMonthChange: (month: number, year: number) => void
}

function getLast6Months(): { month: number; year: number; label: string }[] {
  const result = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: d.toLocaleString('en-SG', { month: 'long', year: 'numeric' }),
    })
  }
  return result
}

export function DailyTrend({ transactions, month, year, onMonthChange }: Props) {
  const months = useMemo(() => getLast6Months(), [])
  const data = useMemo(
    () => computeDailyTrend(transactions, month, year),
    [transactions, month, year],
  )

  const selectedValue = `${month}-${year}`
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-SG', { month: 'long', year: 'numeric' })
  const hasData = data.some((d) => d.total > 0)

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const [m, y] = e.target.value.split('-').map(Number)
    if (m && y) onMonthChange(m, y)
  }

  return (
    <div className="chart-wrapper">
      <div className="chart-header">
        <h3 className="chart-title" style={{ marginBottom: 0 }}>Daily Spend ({monthLabel})</h3>
        <select className="chart-month-select" value={selectedValue} onChange={handleMonthChange}>
          {months.map((m) => (
            <option key={`${m.month}-${m.year}`} value={`${m.month}-${m.year}`}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {!hasData || data.length === 0 ? (
        <div className="chart-empty-inner">No spending recorded for this month.</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(19,107,76,0.08)" />
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
      )}
    </div>
  )
}
