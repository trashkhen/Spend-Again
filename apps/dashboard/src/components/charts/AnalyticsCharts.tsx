import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { computeCumulativeDaily, computeMonthTotalsForYear, computeWeekdaySpend } from '../../lib/analytics'
import { fmtSGDCompact } from '../../lib/format'
import { ChartTooltipBox } from '../ui/ChartTooltip'
import type { ApiTransaction, MonthlyAnalyticsItem } from '../../lib/api'

const AXIS_TICK = { fill: 'var(--color-text-muted)', fontSize: 12 }
const GRID_STROKE = 'var(--color-ledger-line)'
const ACCENT = 'var(--color-accent)'
const ACCENT_SOFT = 'var(--color-accent-mid)'
const CORAL = 'var(--color-coral)'

// ── Month: daily bars or running total vs budget ──────────────────────────────

type MonthTrendProps = {
  transactions: ApiTransaction[]
  month: number
  year: number
  budget: number | null // SGD, monthly
}

type MonthPoint = { day: number; total: number; cumulative: number; pace: number | null }

export function MonthTrendChart({ transactions, month, year, budget }: MonthTrendProps) {
  const [view, setView] = useState<'daily' | 'cumulative'>('daily')
  const daysInMonth = new Date(year, month, 0).getDate()

  const data: MonthPoint[] = useMemo(
    () =>
      computeCumulativeDaily(transactions, month, year).map((p) => ({
        ...p,
        pace: budget != null ? Math.round(((budget * p.day) / daysInMonth) * 100) / 100 : null,
      })),
    [transactions, month, year, budget, daysInMonth],
  )
  const hasData = data.some((d) => d.total > 0)
  const maxDay = data.reduce((best, d) => (d.total > best.total ? d : best), { day: 0, total: 0 })
  const monthShort = new Date(year, month - 1, 1).toLocaleString('en-SG', { month: 'short' })

  return (
    <div className="an-card an-card--trend">
      <div className="an-card-head">
        <div>
          <h3 className="an-card-title">Spending trend</h3>
          <p className="an-card-sub">
            {view === 'daily'
              ? maxDay.total > 0 ? `Biggest day: ${maxDay.day} ${monthShort}` : 'Daily totals'
              : budget != null ? 'Running total vs. your budget pace' : 'Running total this month'}
          </p>
        </div>
        <div className="ui-seg ui-seg--sm" role="tablist" aria-label="Trend view">
          <button type="button" role="tab" aria-selected={view === 'daily'} className={`ui-seg-btn${view === 'daily' ? ' is-active' : ''}`} onClick={() => setView('daily')}>Daily</button>
          <button type="button" role="tab" aria-selected={view === 'cumulative'} className={`ui-seg-btn${view === 'cumulative' ? ' is-active' : ''}`} onClick={() => setView('cumulative')}>Running total</button>
        </div>
      </div>

      {!hasData ? (
        <div className="ui-empty-inline">No spending recorded for this month yet.</div>
      ) : view === 'daily' ? (
        <div className="an-chart-fill"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
            <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtSGDCompact} width={56} />
            <Tooltip
              cursor={{ fill: 'var(--color-accent-dim)' }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as MonthPoint | undefined) : undefined
                if (!p) return null
                return <ChartTooltipBox title={`${p.day} ${monthShort}`} rows={[{ label: 'Spent', value: p.total, color: ACCENT }]} />
              }}
            />
            <Bar dataKey="total" radius={[6, 6, 2, 2]} maxBarSize={22}>
              {data.map((d) => (
                <Cell key={d.day} fill={d.day === maxDay.day ? CORAL : ACCENT} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer></div>
      ) : (
        <div className="an-chart-fill"><ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="an-cum-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#27AE60" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#27AE60" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
            <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtSGDCompact}
              width={56}
              domain={[0, (max: number) => Math.max(max, budget ?? 0) * 1.05]}
            />
            <Tooltip
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as MonthPoint | undefined) : undefined
                if (!p) return null
                const rows = [{ label: 'Spent so far', value: p.cumulative, color: ACCENT_SOFT }]
                if (p.pace != null) rows.push({ label: 'Budget pace', value: p.pace, color: CORAL })
                const note = p.pace != null
                  ? p.cumulative > p.pace ? 'Ahead of budget pace' : 'Under budget pace'
                  : undefined
                return <ChartTooltipBox title={`Up to ${p.day} ${monthShort}`} rows={rows} note={note} />
              }}
            />
            {budget != null && (
              <ReferenceLine
                y={budget}
                stroke={CORAL}
                strokeDasharray="6 4"
                label={{ value: `Budget ${fmtSGDCompact(budget)}`, position: 'insideTopRight', fill: CORAL, fontSize: 11, fontWeight: 700 }}
              />
            )}
            <Area type="monotone" dataKey="cumulative" stroke={ACCENT} strokeWidth={2.5} fill="url(#an-cum-fill)" />
            {budget != null && (
              <Line type="linear" dataKey="pace" stroke={CORAL} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            )}
          </AreaChart>
        </ResponsiveContainer></div>
      )}
    </div>
  )
}

// ── Year: Jan–Dec bars (click to drill into a month) ──────────────────────────

type YearTrendProps = {
  transactions: ApiTransaction[]
  year: number
  budget: number | null
  onSelectMonth: (month: number) => void
}

export function YearTrendChart({ transactions, year, budget, onSelectMonth }: YearTrendProps) {
  const data = useMemo(() => computeMonthTotalsForYear(transactions, year), [transactions, year])
  const hasData = data.some((d) => d.total > 0)
  const now = new Date()

  return (
    <div className="an-card an-card--trend">
      <div className="an-card-head">
        <div>
          <h3 className="an-card-title">Month by month</h3>
          <p className="an-card-sub">Tap a month to see its details</p>
        </div>
      </div>
      {!hasData ? (
        <div className="ui-empty-inline">No spending recorded in {year}.</div>
      ) : (
        <div className="an-chart-fill"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtSGDCompact} width={56} />
            <Tooltip
              cursor={{ fill: 'var(--color-accent-dim)' }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as { label: string; total: number } | undefined) : undefined
                if (!p) return null
                return <ChartTooltipBox title={`${p.label} ${year}`} rows={[{ label: 'Spent', value: p.total, color: ACCENT }]} />
              }}
            />
            {budget != null && (
              <ReferenceLine y={budget} stroke={CORAL} strokeDasharray="6 4" label={{ value: 'Budget', position: 'insideTopRight', fill: CORAL, fontSize: 11, fontWeight: 700 }} />
            )}
            <Bar dataKey="total" radius={[6, 6, 2, 2]} maxBarSize={36}>
              {data.map((d) => {
                const future = year > now.getFullYear() || (year === now.getFullYear() && d.month > now.getMonth() + 1)
                const over = budget != null && d.total > budget
                return (
                  <Cell
                    key={d.month}
                    fill={over ? CORAL : ACCENT}
                    fillOpacity={future ? 0.25 : 1}
                    cursor="pointer"
                    onClick={() => onSelectMonth(d.month)}
                  />
                )
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer></div>
      )}
    </div>
  )
}

// ── Weekday pattern ───────────────────────────────────────────────────────────

export function WeekdayChart({ transactions }: { transactions: ApiTransaction[] }) {
  const data = useMemo(() => computeWeekdaySpend(transactions), [transactions])
  const total = data.reduce((s, d) => s + d.total, 0)
  const peak = data.reduce((best, d) => (d.total > best.total ? d : best), { day: '', total: 0, count: 0 })
  const weekend = (data[5]?.total ?? 0) + (data[6]?.total ?? 0)
  const weekendPct = total > 0 ? Math.round((weekend / total) * 100) : 0
  const fullNames: Record<string, string> = { Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays', Sun: 'Sundays' }

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <h3 className="an-card-title">By day of week</h3>
          <p className="an-card-sub">
            {total > 0 ? <>You spend most on <strong>{fullNames[peak.day] ?? peak.day}</strong> · weekends are {weekendPct}%</> : 'Spending pattern across the week'}
          </p>
        </div>
      </div>
      {total === 0 ? (
        <div className="ui-empty-inline">Nothing to show yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
            <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtSGDCompact} width={56} />
            <Tooltip
              cursor={{ fill: 'var(--color-accent-dim)' }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as { day: string; total: number; count: number } | undefined) : undefined
                if (!p) return null
                return (
                  <ChartTooltipBox
                    title={fullNames[p.day] ?? p.day}
                    rows={[{ label: 'Spent', value: p.total, color: ACCENT }]}
                    note={`${p.count} transaction${p.count === 1 ? '' : 's'}`}
                  />
                )
              }}
            />
            <Bar dataKey="total" radius={[6, 6, 2, 2]} maxBarSize={34}>
              {data.map((d) => (
                <Cell key={d.day} fill={d.day === peak.day ? CORAL : ACCENT} fillOpacity={d.day === peak.day ? 1 : 0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── 12-month history (click to jump to a month) ───────────────────────────────

type HistoryProps = {
  data: MonthlyAnalyticsItem[]
  budget: number | null
  selected: { month: number; year: number } | null
  onSelect: (month: number, year: number) => void
}

export function MonthHistoryChart({ data, budget, selected, onSelect }: HistoryProps) {
  const rows = data.map((d) => ({
    month: parseInt(d.month, 10),
    year: parseInt(d.year, 10),
    label: new Date(parseInt(d.year, 10), parseInt(d.month, 10) - 1, 1).toLocaleString('en-SG', { month: 'short' }),
    fullLabel: d.label,
    total: d.totalCents / 100,
    count: d.count,
  }))
  const nonZero = rows.filter((r) => r.total > 0)
  const avg = nonZero.length > 0 ? nonZero.reduce((s, r) => s + r.total, 0) / nonZero.length : 0

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <h3 className="an-card-title">Last 12 months</h3>
          <p className="an-card-sub">
            {avg > 0 ? <>Average month: <strong>{fmtSGDCompact(avg)}</strong> · tap a bar to open that month</> : 'Tap a bar to open that month'}
          </p>
        </div>
      </div>
      {nonZero.length === 0 ? (
        <div className="ui-empty-inline">No history yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 4" />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtSGDCompact} width={56} />
            <Tooltip
              cursor={{ fill: 'var(--color-accent-dim)' }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined
                if (!p) return null
                return (
                  <ChartTooltipBox
                    title={p.fullLabel}
                    rows={[{ label: 'Spent', value: p.total, color: ACCENT }]}
                    note={`${p.count} transaction${p.count === 1 ? '' : 's'}`}
                  />
                )
              }}
            />
            {budget != null && (
              <ReferenceLine y={budget} stroke={CORAL} strokeDasharray="6 4" label={{ value: 'Budget', position: 'insideTopRight', fill: CORAL, fontSize: 11, fontWeight: 700 }} />
            )}
            <Bar dataKey="total" radius={[6, 6, 2, 2]} maxBarSize={32}>
              {rows.map((r) => {
                const isSelected = selected != null && selected.month === r.month && selected.year === r.year
                return (
                  <Cell
                    key={`${r.year}-${r.month}`}
                    fill={isSelected ? CORAL : ACCENT}
                    fillOpacity={selected == null || isSelected ? 1 : 0.55}
                    cursor="pointer"
                    onClick={() => onSelect(r.month, r.year)}
                  />
                )
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
