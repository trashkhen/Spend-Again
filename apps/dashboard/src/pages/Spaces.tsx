import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import {
  listSpaces, deactivateSpace, reactivateSpace, permanentDeleteSpace,
} from '../lib/api'
import type { SpaceWithTotal } from '../lib/api'

// ── Spaces list ───────────────────────────────────────────────────────────────

export function Spaces() {
  const [spaces, setSpaces] = useState<SpaceWithTotal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    listSpaces().then(setSpaces).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleDeactivate(id: string) {
    try {
      await deactivateSpace(id)
      setSpaces(prev => prev.map(s => s.id === id ? { ...s, status: 'archived' as const } : s))
    } catch { /* silent */ }
  }

  async function handleReactivate(id: string) {
    try {
      await reactivateSpace(id)
      setSpaces(prev => prev.map(s => s.id === id ? { ...s, status: 'active' as const } : s))
    } catch { /* silent */ }
  }

  async function handleDelete(id: string) {
    try {
      await permanentDeleteSpace(id)
      setSpaces(prev => prev.filter(s => s.id !== id))
      setConfirmDeleteId(null)
    } catch { /* silent */ }
  }

  const shown = spaces.filter(s => s.status === activeTab)
  const activeCount = spaces.filter(s => s.status === 'active').length
  const archivedCount = spaces.filter(s => s.status === 'archived').length

  return (
    <Layout>
      <div className="app-main page-enter">
        <div className="page-header">
          <div>
            <h1 className="page-title">Spaces</h1>
            <p className="page-subtitle">Organise spending into dedicated budgets and trips.</p>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
          {(['active', 'archived'] as const).map(tab => (
            <button
              key={tab}
              className="btn btn-ghost"
              style={{
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                borderRadius: 0,
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                padding: '8px 16px',
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'active' ? `Active (${activeCount})` : `Archived (${archivedCount})`}
            </button>
          ))}
        </div>

        {loading && (
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        )}
        {!loading && shown.length === 0 && (
          <div className="table-state table-state--empty">
            <p className="table-empty-message">
              {activeTab === 'active'
                ? <>No active spaces. Create one via Telegram: <code>/space</code></>
                : 'No archived spaces.'}
            </p>
          </div>
        )}

        {shown.map(s => (
          <div key={s.id} className="space-card" style={{ marginBottom: 14 }}>
            {confirmDeleteId === s.id ? (
              <div>
                <p style={{ marginBottom: 8, fontSize: 14 }}>
                  Permanently remove <strong>{s.emoji ?? '📦'} {s.name}</strong>? Transactions are kept.
                </p>
                <div className="space-actions">
                  <button className="btn btn-danger" onClick={() => { void handleDelete(s.id) }}>
                    Yes, delete
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-item-row">
                  <span className="space-item-name" style={{ fontSize: 15 }}>
                    {s.emoji ?? '📦'} {s.name}
                  </span>
                  <span className={`space-status-badge space-status-badge--${s.status}`}>
                    {s.status}
                  </span>
                </div>
                {s.startDate != null && (
                  <p className="space-meta">{s.startDate} – {s.endDate}</p>
                )}
                <p className="space-meta">
                  Spent: <strong>S${s.spent}</strong>
                  {s.budget != null ? ` / S$${s.budget}` : ''} ({s.transactionCount} transactions)
                </p>
                <div className="space-actions">
                  <button className="btn btn-ghost" onClick={() => navigate(`/spaces/${s.id}`)}>
                    View →
                  </button>
                  {s.status === 'active' ? (
                    <button className="btn btn-ghost" onClick={() => { void handleDeactivate(s.id) }}>
                      Deactivate
                    </button>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => { void handleReactivate(s.id) }}>
                      Reactivate
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--danger, #f87171)' }}
                    onClick={() => setConfirmDeleteId(s.id)}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
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
