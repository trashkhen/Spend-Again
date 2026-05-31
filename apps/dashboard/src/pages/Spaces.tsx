import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { listSpaces, archiveSpace } from '../lib/api'
import type { SpaceWithTotal } from '../lib/api'

// ── Spaces list ───────────────────────────────────────────────────────────────

export function Spaces() {
  const [spaces, setSpaces] = useState<SpaceWithTotal[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    listSpaces().then(setSpaces).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleArchive(id: string) {
    try {
      await archiveSpace(id)
      setSpaces(prev => prev.filter(s => s.id !== id))
    } catch {
      // error silently ignored in MVP
    }
  }

  return (
    <Layout>
      <div className="app-main page-enter">
        <div className="page-header">
          <div>
            <h1 className="page-title">Spaces</h1>
            <p className="page-subtitle">Organise spending into dedicated budgets and trips.</p>
          </div>
        </div>

        {loading && (
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        )}
        {!loading && spaces.length === 0 && (
          <div className="table-state table-state--empty">
            <p className="table-empty-message">
              No spaces yet. Create one via Telegram: <code>/space</code>
            </p>
          </div>
        )}
        {spaces.map(s => (
          <div key={s.id} className="space-card" style={{ marginBottom: 14 }}>
            <div className="space-item-row">
              <span className="space-item-name" style={{ fontSize: 15 }}>
                {s.emoji ?? '📦'} {s.name}
              </span>
              <span
                className={`space-status-badge ${s.status === 'active' ? 'space-status-badge--active' : 'space-status-badge--archived'}`}
              >
                {s.status}
              </span>
            </div>
            {s.startDate != null && (
              <p className="space-meta">
                {s.startDate} – {s.endDate}
              </p>
            )}
            <p className="space-meta">
              Spent: <strong>S${s.spent}</strong>
              {s.budget != null ? ` / S$${s.budget}` : ''} ({s.transactionCount} transactions)
            </p>
            <div className="space-actions">
              <button className="btn btn-ghost" onClick={() => navigate(`/spaces/${s.id}`)}>
                View →
              </button>
              {s.status === 'active' && (
                <button
                  className="btn btn-ghost"
                  onClick={() => { void handleArchive(s.id) }}
                >
                  Archive
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  )
}

// ── Space detail ──────────────────────────────────────────────────────────────

export function SpaceDetail() {
  const { id } = useParams<{ id: string }>()
  const [space, setSpace] = useState<SpaceWithTotal | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    listSpaces()
      .then(all => setSpace(all.find(s => s.id === id) ?? null))
      .catch(() => {})
  }, [id])

  if (!space) {
    return (
      <Layout>
        <div className="app-main page-enter">
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        </div>
      </Layout>
    )
  }

  const budgetPct =
    space.budgetCents != null
      ? Math.round((space.spentCents / space.budgetCents) * 100)
      : null

  return (
    <Layout>
      <div className="app-main page-enter">
        <button
          className="space-back-btn"
          onClick={() => navigate('/spaces')}
        >
          ← Back
        </button>
        <div className="page-header" style={{ marginBottom: 20 }}>
          <h1 className="page-title">
            {space.emoji ?? '📦'} {space.name}
          </h1>
        </div>
        {space.startDate != null && (
          <p className="space-meta" style={{ marginBottom: 16 }}>
            {space.startDate} – {space.endDate}
          </p>
        )}
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="kpi-card">
            <div className="kpi-label">Spent</div>
            <div className="kpi-value">S${space.spent}</div>
          </div>
          {space.budget != null && (
            <div className="kpi-card">
              <div className="kpi-label">Budget</div>
              <div className="kpi-value">S${space.budget}</div>
            </div>
          )}
          {budgetPct != null && (
            <div className="kpi-card">
              <div className="kpi-label">Used</div>
              <div className="kpi-value">{budgetPct}%</div>
            </div>
          )}
          <div className="kpi-card">
            <div className="kpi-label">Transactions</div>
            <div className="kpi-value">{space.transactionCount}</div>
          </div>
        </div>
        <p className="space-detail-info" style={{ marginTop: 20 }}>
          Full transaction list filtering by space coming in a future update. Use Telegram to browse expenses in this space.
        </p>
      </div>
    </Layout>
  )
}
