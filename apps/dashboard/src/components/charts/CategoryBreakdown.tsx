import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import type { CategorySpend } from '../../lib/analytics'

type Props = {
  data: CategorySpend[]
}

const PALETTE: readonly string[] = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
  '#06b6d4', '#a855f7',
]

function renderCustomLabel(props: PieLabelRenderProps): React.ReactElement | null {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props

  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    typeof midAngle !== 'number' ||
    typeof innerRadius !== 'number' ||
    typeof outerRadius !== 'number' ||
    typeof percent !== 'number' ||
    percent < 0.05
  ) {
    return null
  }

  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export function CategoryBreakdown({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No spending data for this month.</p>
      </div>
    )
  }

  return (
    <div className="chart-wrapper">
      <h3 className="chart-title">Category Breakdown (This Month)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            labelLine={false}
            label={renderCustomLabel}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${entry.name}`}
                fill={PALETTE[index % PALETTE.length] ?? '#6366f1'}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => {
              const num = typeof value === 'number' ? value : parseFloat(String(value))
              return [`S$${num.toFixed(2)}`, '']
            }}
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
            labelStyle={{ color: 'var(--color-text)' }}
          />
          <Legend
            formatter={(value: string) => (
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
