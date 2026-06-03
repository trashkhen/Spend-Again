import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { computeCategoryBreakdown } from '../../lib/analytics'
import type { ApiTransaction } from '../../lib/api'
import type { CategorySpend } from '../../lib/analytics'

type Props = {
  transactions: ApiTransaction[]
  month: number
  year: number
}

const PALETTE: readonly string[] = [
  '#136B4C', '#27AE60', '#FF6B6B', '#FFC857',
  '#2A9D8F', '#E9C46A', '#F4A261', '#264653',
  '#6B8C7A', '#A8C4B4', '#E76F51', '#023047',
]

function monthLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleString('en-SG', { month: 'long', year: 'numeric' })
}

export function CategoryBreakdown({ transactions, month, year }: Props) {
  const data = useMemo(
    () => computeCategoryBreakdown(transactions, month, year),
    [transactions, month, year],
  )

  return (
    <div className="chart-wrapper">
      <div className="chart-header">
        <h3 className="chart-title" style={{ marginBottom: 0 }}>Category Breakdown</h3>
        <span className="chart-month-label">{monthLabel(month, year)}</span>
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
