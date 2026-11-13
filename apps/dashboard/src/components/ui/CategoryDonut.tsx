import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { emojiFor } from '@spend-again/shared'
import { paletteColor } from '../../lib/chart-colors'
import { fmtSGD } from '../../lib/format'
import { ChartTooltipBox } from './ChartTooltip'

export type DonutRow = {
  name: string
  total: number        // SGD
  percentage: number   // 0–100
  count?: number | undefined
}

type Props = {
  data: DonutRow[]
  centerLabel: string
  emptyText?: string
  /** Max rows in the ranked list before summarising the rest. */
  maxRows?: number
}

/**
 * Donut with the total in the middle, plus a ranked list with inline bars so
 * the proportions are readable without hovering.
 */
export function CategoryDonut({ data, centerLabel, emptyText = 'No spending yet.', maxRows = 8 }: Props) {
  if (data.length === 0) {
    return <div className="ui-empty-inline">{emptyText}</div>
  }

  const total = data.reduce((s, d) => s + d.total, 0)

  return (
    <div className="ui-donut">
      <div className="ui-donut-chart">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie
              data={data}
              dataKey="total"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={68}
              outerRadius={92}
              paddingAngle={data.length > 1 ? 3 : 0}
              cornerRadius={6}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={paletteColor(i)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const row = payload[0]?.payload as DonutRow | undefined
                if (!row) return null
                const idx = data.findIndex((d) => d.name === row.name)
                return (
                  <ChartTooltipBox
                    title={`${emojiFor(row.name)} ${row.name}`}
                    rows={[{ label: `${row.percentage.toFixed(0)}% of spend`, value: row.total, color: paletteColor(idx) }]}
                    note={row.count != null ? `${row.count} transaction${row.count === 1 ? '' : 's'}` : undefined}
                  />
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="ui-donut-center" aria-hidden="true">
          <span className="ui-donut-center-label">{centerLabel}</span>
          <span className="ui-donut-center-value">{fmtSGD(total)}</span>
        </div>
      </div>

      <ul className="ui-rank-list">
        {data.slice(0, maxRows).map((row, i) => (
          <li key={row.name} className="ui-rank-row">
            <span className="ui-rank-emoji" style={{ background: `${paletteColor(i)}22` }}>{emojiFor(row.name)}</span>
            <div className="ui-rank-body">
              <div className="ui-rank-top">
                <span className="ui-rank-name">{row.name}</span>
                <span className="ui-rank-amount">{fmtSGD(row.total)}</span>
              </div>
              <div className="ui-rank-bottom">
                <div className="ui-bar-track">
                  <div className="ui-bar-fill" style={{ width: `${Math.max(2, row.percentage)}%`, background: paletteColor(i) }} />
                </div>
                <span className="ui-rank-pct">{row.percentage.toFixed(0)}%</span>
              </div>
            </div>
          </li>
        ))}
        {data.length > maxRows && (
          <li className="ui-rank-more">+{data.length - maxRows} more categories</li>
        )}
      </ul>
    </div>
  )
}
