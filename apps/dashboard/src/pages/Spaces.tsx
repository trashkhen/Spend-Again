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
      <h2>Spaces</h2>
      {loading && <p>Loading…</p>}
      {!loading && spaces.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          No spaces yet. Create one via Telegram: <code>/space</code>
        </p>
      )}
      {spaces.map(s => (
        <div key={s.id} className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              {s.emoji ?? '📦'} {s.name}
            </h3>
            <span
              style={{
                fontSize: '0.75rem', padding: '0.125rem 0.5rem',
                borderRadius: '999px', background: s.status === 'active' ? 'var(--green, #38a169)' : 'var(--muted)',
                color: '#fff',
              }}
            >
              {s.status}
            </span>
          </div>
          {s.startDate != null && (
            <p style={{ margin: '0.25rem 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
              {s.startDate} – {s.endDate}
            </p>
          )}
          <p style={{ margin: '0.25rem 0' }}>
            Spent: S${s.spent}
            {s.budget != null ? ` / S$${s.budget}` : ''} ({s.transactionCount} transactions)
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button onClick={() => navigate(`/spaces/${s.id}`)}>View →</button>
            {s.status === 'active' && (
              <button
                onClick={() => { void handleArchive(s.id) }}
                style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Archive
              </button>
            )}
          </div>
        </div>
      ))}
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
        <p>Loading…</p>
      </Layout>
    )
  }

  const budgetPct =
    space.budgetCents != null
      ? Math.round((space.spentCents / space.budgetCents) * 100)
      : null

  return (
    <Layout>
      <button
        onClick={() => navigate('/spaces')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', marginBottom: '1rem' }}
      >
        ← Back
      </button>
      <h2>
        {space.emoji ?? '📦'} {space.name}
      </h2>
      {space.startDate != null && (
        <p style={{ color: 'var(--muted)' }}>
          {space.startDate} – {space.endDate}
        </p>
      )}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
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
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
        Full transaction list filtering by space coming in a future update. Use Telegram to browse expenses in this space.
      </p>
    </Layout>
  )
}
