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
      <div className="app-main page-enter">
        <div className="page-header">
          <div>
            <h1 className="page-title">People / IOUs</h1>
            <p className="page-subtitle">Track who owes what and settle debts.</p>
          </div>
        </div>

        {loading && (
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        )}
        {!loading && people.length === 0 && (
          <div className="table-state table-state--empty">
            <p className="table-empty-message">
              No IOUs yet. Try saying <code>lent Ben $12</code> in Telegram.
            </p>
          </div>
        )}
        {people.map(p => (
          <div
            key={p.id}
            className="iou-card"
            style={{ marginBottom: 14, cursor: 'pointer' }}
            onClick={() => navigate(`/people/${p.id}`)}
          >
            <div className="iou-item" style={{ borderBottom: 'none', padding: 0 }}>
              <div>
                <span className="iou-item-name" style={{ fontSize: 15 }}>{p.name}</span>
                <div className="iou-item-meta">
                  {p.openDebtCount} open IOU{p.openDebtCount !== 1 ? 's' : ''}
                </div>
              </div>
              <span>
                {p.theyOweMeCents > 0 && (
                  <span className="iou-amount--owed">owes S${p.theyOweMe}</span>
                )}
                {p.iOweThemCents > 0 && (
                  <span className="iou-amount--owing">
                    you owe S${p.iOweThem}
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
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
        <div className="app-main page-enter">
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        </div>
      </Layout>
    )
  }

  const openDebts = debts.filter(d => d.status !== 'settled')
  const settledDebts = debts.filter(d => d.status === 'settled')

  return (
    <Layout>
      <div className="app-main page-enter">
        <button
          className="space-back-btn"
          onClick={() => navigate('/people')}
        >
          ← Back
        </button>
        <div className="page-header" style={{ marginBottom: 20 }}>
          <h1 className="page-title">{person.name}</h1>
        </div>

        {person.theyOweMeCents > 0 && (
          <p className="iou-summary--owed">Owes you: S${person.theyOweMe}</p>
        )}
        {person.iOweThemCents > 0 && (
          <p className="iou-summary--owing">You owe: S${person.iOweThem}</p>
        )}

        <section className="dashboard-section" style={{ marginTop: 20 }}>
          <h2 className="section-heading">Open ({openDebts.length})</h2>
          {openDebts.length === 0 && (
            <p className="space-detail-info">No open IOUs.</p>
          )}
          {openDebts.map(d => (
            <div key={d.id} className="debt-item">
              <div className="debt-item-row">
                <span>
                  {d.direction === 'they_owe_me'
                    ? `${person.name} owes you S$${d.remainingAmount}`
                    : `You owe ${person.name} S$${d.remainingAmount}`}
                </span>
                <button className="btn btn-primary" onClick={() => void handleSettle(d.id)}>
                  Settle
                </button>
              </div>
              {d.description != null && (
                <p className="debt-item-desc">{d.description}</p>
              )}
              <p className="debt-item-date">{d.occurredOn}</p>
            </div>
          ))}
        </section>

        {settledDebts.length > 0 && (
          <section className="dashboard-section" style={{ marginTop: 20 }}>
            <h2 className="section-heading">Settled ({settledDebts.length})</h2>
            {settledDebts.map(d => (
              <div key={d.id} className="debt-item debt-item--settled">
                <span className="debt-item-desc" style={{ marginTop: 0 }}>
                  {d.direction === 'they_owe_me'
                    ? `${person.name} paid S$${d.originalAmount}`
                    : `You paid S$${d.originalAmount}`}
                  {d.description != null && ` · ${d.description}`}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </Layout>
  )
}
