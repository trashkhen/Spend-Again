import { PieChart, Pie, Cell, Legend, Tooltip } from 'recharts'
import type { SpaceBreakdownItem } from '../lib/api'

const COLORS = ['#7c83fd', '#4ade80', '#f59e0b', '#f87171', '#a78bfa', '#34d399', '#fb923c', '#60a5fa']

type Props = { data: SpaceBreakdownItem[] }

export function SpaceDonutChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="space-meta">No transactions to chart yet.</p>
  }
  const chartData = data.map(d => ({ name: d.category, value: d.totalCents, pct: d.pct }))
  return (
    <PieChart width={300} height={240}>
      <Pie
        data={chartData}
        cx={100}
        cy={110}
        innerRadius={60}
        outerRadius={95}
        dataKey="value"
        paddingAngle={2}
      >
        {chartData.map((_, i) => (
          <Cell key={i} fill={COLORS[i % COLORS.length]} />
        ))}
      </Pie>
      <Tooltip
        formatter={(value: number) => [`S$${(value / 100).toFixed(2)}`, 'Spent']}
      />
      <Legend
        formatter={(name: string, entry) => {
          const payload = entry.payload as { pct: number } | undefined
          return `${name} ${payload?.pct ?? 0}%`
        }}
      />
    </PieChart>
  )
}
