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
    <div className="card">
      <h3 className="card-title">People / IOUs</h3>
      {people.map(p => (
        <div
          key={p.id}
          style={{
            display: 'flex', justifyContent: 'space-between',
            marginBottom: '0.5rem', cursor: 'pointer',
          }}
          onClick={() => navigate(`/people/${p.id}`)}
        >
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          <span>
            {p.theyOweMeCents > 0 && (
              <span style={{ color: 'var(--green, #38a169)' }}>
                owes you S${p.theyOweMe}
              </span>
            )}
            {p.iOweThemCents > 0 && (
              <span style={{ color: 'var(--red, #e53e3e)', marginLeft: p.theyOweMeCents > 0 ? '0.5rem' : 0 }}>
                you owe S${p.iOweThem}
              </span>
            )}
          </span>
        </div>
      ))}
      <button
        className="btn-link"
        style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
        onClick={() => navigate('/people')}
      >
        Manage IOUs →
      </button>
    </div>
  )
}
