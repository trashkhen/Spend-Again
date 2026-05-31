import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSpaces } from '../lib/api'
import type { SpaceWithTotal } from '../lib/api'

export function SpaceCard() {
  const [spaces, setSpaces] = useState<SpaceWithTotal[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    listSpaces()
      .then(all => setSpaces(all.filter(s => s.status === 'active')))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading || spaces.length === 0) return null

  return (
    <div className="card">
      <h3 className="card-title">Active Spaces</h3>
      {spaces.map(s => {
        const budgetPct =
          s.budgetCents != null
            ? Math.min(100, Math.round((s.spentCents / s.budgetCents) * 100))
            : null
        return (
          <div
            key={s.id}
            style={{ cursor: 'pointer', marginBottom: '0.75rem' }}
            onClick={() => navigate(`/spaces/${s.id}`)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500 }}>
                {s.emoji ?? '📦'} {s.name}
              </span>
              <span>
                S${s.spent}
                {s.budget != null ? ` / S$${s.budget}` : ''}
              </span>
            </div>
            {s.startDate != null && s.endDate != null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                {s.startDate.slice(5).replace('-', '/')} – {s.endDate.slice(5).replace('-', '/')}
              </div>
            )}
            {budgetPct != null && (
              <div
                style={{
                  marginTop: '0.25rem', height: '4px', background: 'var(--border)',
                  borderRadius: '2px', overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${budgetPct}%`, height: '100%',
                    background: budgetPct > 90 ? 'var(--red, #e53e3e)' : 'var(--green, #38a169)',
                  }}
                />
              </div>
            )}
          </div>
        )
      })}
      <button
        className="btn-link"
        style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
        onClick={() => navigate('/spaces')}
      >
        Manage spaces →
      </button>
    </div>
  )
}
