import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPeople } from '../lib/api'
import type { PersonWithDebtSummary } from '../lib/api'

export function IouCard() {
  const [people, setPeople] = useState<PersonWithDebtSummary[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    listPeople()
      .then(all => setPeople(all.filter(p => p.openDebtCount > 0)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading || people.length === 0) return null

  return (
    <div className="iou-card">
      <h3 className="iou-card-title">People / IOUs</h3>
      {people.map(p => (
        <div
          key={p.id}
          className="iou-item"
          onClick={() => navigate(`/people/${p.id}`)}
        >
          <div>
            <span className="iou-item-name">{p.name}</span>
          </div>
          <span>
            {p.theyOweMeCents > 0 && (
              <span className="iou-amount--owed">
                owes you S${p.theyOweMe}
              </span>
            )}
            {p.iOweThemCents > 0 && (
              <span className="iou-amount--owing">
                you owe S${p.iOweThem}
              </span>
            )}
          </span>
        </div>
      ))}
      <button
        className="section-manage-link"
        onClick={() => navigate('/people')}
      >
        Manage IOUs →
      </button>
    </div>
  )
}
