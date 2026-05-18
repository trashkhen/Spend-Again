import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { computeCategoryBreakdown } from '../../lib/analytics'
import type { ApiTransaction } from '../../lib/api'
import type { CategorySpend } from '../../lib/analytics'

type Props = {
  transactions: ApiTransaction[]
  month: number
  year: number
  onMonthChange: (month: number, year: number) => void
}

const PALETTE: readonly string[] = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
  '#06b6d4', '#a855f7',
]

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

export function CategoryBreakdown({ transactions, month, year, onMonthChange }: Props) {
  const months = useMemo(() => getLast6Months(), [])
  const data = useMemo(
    () => computeCategoryBreakdown(transactions, month, year),
    [transactions, month, year],
  )

  const selectedValue = `${month}-${year}`

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const [m, y] = e.target.value.split('-').map(Number)
    if (m && y) onMonthChange(m, y)
  }

  return (
    <div className="chart-wrapper">
      <div className="chart-header">
        <h3 className="chart-title" style={{ marginBottom: 0 }}>Category Breakdown</h3>
        <select className="chart-month-select" value={selectedValue} onChange={handleMonthChange}>
          {months.map((m) => (
            <option key={`${m.month}-${m.year}`} value={`${m.month}-${m.year}`}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {data.length === 0 ? (
        <div className="chart-empty-inner">No spending data for this month.</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                dataKey="total"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={4}
                cornerRadius={6}
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${entry.name}`}
                    fill={PALETTE[index % PALETTE.length] ?? '#6366f1'}
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0]?.payload as CategorySpend | undefined
                  if (!item) return null
                  return (
                    <div style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '13px',
                    }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{item.name}</span>
                      {': '}
                      <span style={{ color: 'var(--color-text)' }}>S${item.total.toFixed(2)}</span>
                      {' '}
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        ({item.count} transaction{item.count !== 1 ? 's' : ''})
                      </span>
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          <div className="category-legend">
            {data.map((entry, index) => (
              <div key={entry.name} className="category-legend-row">
                <span
                  className="category-legend-dot"
                  style={{ background: PALETTE[index % PALETTE.length] ?? '#6366f1' }}
                />
                <span className="category-legend-name">{entry.name}</span>
                <span className="category-legend-pct">{entry.percentage.toFixed(0)}%</span>
                <span className="category-legend-amount">S${entry.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
