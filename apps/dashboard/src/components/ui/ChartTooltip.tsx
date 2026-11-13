import { fmtSGD } from '../../lib/format'

type Row = { label: string; value: number; color?: string | undefined }

/** Consistent tooltip body for Recharts `content` render props. */
export function ChartTooltipBox({ title, rows, note }: { title: string; rows: Row[]; note?: string | undefined }) {
  return (
    <div className="ui-chart-tooltip">
      <div className="ui-chart-tooltip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="ui-chart-tooltip-row">
          {r.color && <span className="ui-dot" style={{ background: r.color }} />}
          <span className="ui-chart-tooltip-label">{r.label}</span>
          <span className="ui-chart-tooltip-value">{fmtSGD(r.value)}</span>
        </div>
      ))}
      {note && <div className="ui-chart-tooltip-note">{note}</div>}
    </div>
  )
}
