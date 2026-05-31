import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { listPeople, listDebts, settleDebt } from '../lib/api'
import type { PersonWithDebtSummary, DebtWithPerson } from '../lib/api'

// ── People list ───────────────────────────────────────────────────────────────

export function People() {
  const [people, setPeople] = useState<PersonWithDebtSummary[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    listPeople().then(setPeople).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <Layout>
      <h2>People / IOUs</h2>
      {loading && <p>Loading…</p>}
      {!loading && people.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          No IOUs yet. Try saying <code>lent Ben $12</code> in Telegram.
        </p>
      )}
      {people.map(p => (
        <div
          key={p.id}
          className="card"
          style={{ marginBottom: '1rem', cursor: 'pointer' }}
          onClick={() => navigate(`/people/${p.id}`)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{p.name}</strong>
            <span>
              {p.theyOweMeCents > 0 && (
                <span style={{ color: 'var(--green, #38a169)' }}>owes S${p.theyOweMe}</span>
              )}
              {p.iOweThemCents > 0 && (
                <span style={{ color: 'var(--red, #e53e3e)', marginLeft: '0.5rem' }}>
                  you owe S${p.iOweThem}
                </span>
              )}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.25rem 0 0' }}>
            {p.openDebtCount} open IOU{p.openDebtCount !== 1 ? 's' : ''}
          </p>
        </div>
      ))}
    </Layout>
  )
}

// ── Person detail ─────────────────────────────────────────────────────────────

export function PersonDetail() {
  const { id } = useParams<{ id: string }>()
  const [person, setPerson] = useState<PersonWithDebtSummary | null>(null)
  const [debts, setDebts] = useState<DebtWithPerson[]>([])
  const navigate = useNavigate()

  async function load() {
    if (!id) return
    const [allPeople, allDebts] = await Promise.all([
      listPeople(),
      listDebts({ personId: id }),
    ])
    setPerson(allPeople.find(p => p.id === id) ?? null)
    setDebts(allDebts)
  }

  useEffect(() => {
    void load()
  }, [id])

  async function handleSettle(debtId: string) {
    await settleDebt(debtId)
    void load()
  }

  if (!person) {
    return (
      <Layout>
        <p>Loading…</p>
      </Layout>
    )
  }

  const openDebts = debts.filter(d => d.status !== 'settled')
  const settledDebts = debts.filter(d => d.status === 'settled')

  return (
    <Layout>
      <button
        onClick={() => navigate('/people')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', marginBottom: '1rem' }}
      >
        ← Back
      </button>
      <h2>{person.name}</h2>
      {person.theyOweMeCents > 0 && (
        <p style={{ color: 'var(--green, #38a169)' }}>Owes you: S${person.theyOweMe}</p>
      )}
      {person.iOweThemCents > 0 && (
        <p style={{ color: 'var(--red, #e53e3e)' }}>You owe: S${person.iOweThem}</p>
      )}

      <h3>Open ({openDebts.length})</h3>
      {openDebts.length === 0 && <p style={{ color: 'var(--muted)' }}>No open IOUs.</p>}
      {openDebts.map(d => (
        <div key={d.id} className="card" style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {d.direction === 'they_owe_me'
                ? `${person.name} owes you S$${d.remainingAmount}`
                : `You owe ${person.name} S$${d.remainingAmount}`}
            </span>
            <button onClick={() => void handleSettle(d.id)}>Settle</button>
          </div>
          {d.description != null && (
            <p style={{ fontSize: '0.8rem', margin: '0.25rem 0 0', color: 'var(--muted)' }}>
              {d.description}
            </p>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0.25rem 0 0' }}>
            {d.occurredOn}
          </p>
        </div>
      ))}

      {settledDebts.length > 0 && (
        <>
          <h3>Settled ({settledDebts.length})</h3>
          {settledDebts.map(d => (
            <div
              key={d.id}
              style={{
                padding: '0.5rem 0', color: 'var(--muted)', fontSize: '0.85rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {d.direction === 'they_owe_me'
                ? `${person.name} paid S$${d.originalAmount}`
                : `You paid S$${d.originalAmount}`}
              {d.description != null && ` · ${d.description}`}
            </div>
          ))}
        </>
      )}
    </Layout>
  )
}
