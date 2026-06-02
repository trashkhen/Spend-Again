import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { SpaceBreakdownItem } from '../lib/api'

const COLORS = ['#7c83fd', '#4ade80', '#f59e0b', '#f87171', '#a78bfa', '#34d399', '#fb923c', '#60a5fa']

type Props = { data: SpaceBreakdownItem[] }

export function SpaceDonutChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="space-meta">No transactions to chart yet.</p>
  }
  const chartData = data.map(d => ({ name: d.category, value: d.totalCents, pct: d.pct }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={chartData}
          cx="45%"
          cy={110}
          innerRadius={60}
          outerRadius={95}
          dataKey="value"
          paddingAngle={2}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length] ?? COLORS[0] ?? '#136B4C'} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => {
            const cents = typeof value === 'number' ? value : Number(value ?? 0)
            return [`S$${(cents / 100).toFixed(2)}`, 'Spent']
          }}
        />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconType="circle"
          iconSize={8}
          formatter={(name: string, entry) => {
            const payload = entry.payload as { pct: number } | undefined
            return `${name} ${payload?.pct ?? 0}%`
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
