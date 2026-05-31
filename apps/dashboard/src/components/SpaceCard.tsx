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
    <div className="space-card">
      <h3 className="space-card-title">Active Spaces</h3>
      {spaces.map(s => {
        const budgetPct =
          s.budgetCents != null
            ? Math.min(100, Math.round((s.spentCents / s.budgetCents) * 100))
            : null
        return (
          <div
            key={s.id}
            className="space-item"
            onClick={() => navigate(`/spaces/${s.id}`)}
          >
            <div className="space-item-row">
              <span className="space-item-name">
                {s.emoji ?? '📦'} {s.name}
              </span>
              <span className="space-item-amount">
                S${s.spent}
                {s.budget != null ? ` / S$${s.budget}` : ''}
              </span>
            </div>
            {s.startDate != null && s.endDate != null && (
              <div className="space-item-dates">
                {s.startDate.slice(5).replace('-', '/')} – {s.endDate.slice(5).replace('-', '/')}
              </div>
            )}
            {budgetPct != null && (
              <div className="space-budget-bar">
                <div
                  className={`space-budget-bar-fill ${budgetPct > 90 ? 'space-budget-bar-fill--warn' : 'space-budget-bar-fill--ok'}`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
      <button
        className="section-manage-link"
        onClick={() => navigate('/spaces')}
      >
        Manage spaces →
      </button>
    </div>
  )
}
