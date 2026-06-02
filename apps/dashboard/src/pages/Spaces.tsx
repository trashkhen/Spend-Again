import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { SpaceDonutChart } from '../components/SpaceDonutChart'
import {
  listSpaces, deactivateSpace, reactivateSpace, permanentDeleteSpace,
  updateSpace, getSpaceTransactions, getSpaceBreakdown,
} from '../lib/api'
import type { SpaceWithTotal, ApiTransaction, SpaceBreakdownItem } from '../lib/api'

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

        <div className="page-tabs">
          {(['active', 'archived'] as const).map(tab => (
            <button
              key={tab}
              className={`page-tab${activeTab === tab ? ' page-tab--active' : ''}`}
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
                    className="btn btn-danger"
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
  const [editMode, setEditMode] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview')
  const [breakdown, setBreakdown] = useState<SpaceBreakdownItem[]>([])
  const [txs, setTxs] = useState<ApiTransaction[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    listSpaces()
      .then(all => {
        const found = all.find(s => s.id === id) ?? null
        setSpace(found)
        if (found) setEditValue(`${found.emoji ?? ''} ${found.name}`.trim())
      })
      .catch(() => {})
    getSpaceBreakdown(id).then(setBreakdown).catch(() => {})
    getSpaceTransactions(id).then(setTxs).catch(() => {})
  }, [id])

  async function handleSaveName() {
    if (!id || !space) return
    const trimmed = editValue.trim()
    const emojiMatch = trimmed.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)/u)
    const emoji = emojiMatch?.[0] ?? null
    const name = emoji ? trimmed.slice(emoji.length).trim() : trimmed
    if (!name) return
    const payload: { name: string; emoji?: string } = { name }
    if (emoji) {
      payload.emoji = emoji
    }
    const updated = await updateSpace(id, payload)
    if (updated) {
      setSpace(prev => prev ? { ...prev, name: updated.name, emoji: updated.emoji } : prev)
      setEditValue(`${updated.emoji ?? ''} ${updated.name}`.trim())
    }
    setEditMode(false)
  }

  if (!space) {
    return (
      <Layout>
        <div className="app-main page-enter">
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        </div>
      </Layout>
    )
  }

  const budgetPct = space.budgetCents != null
    ? Math.round((space.spentCents / space.budgetCents) * 100)
    : null

  return (
    <Layout>
      <div className="app-main page-enter">
        <button className="space-back-btn" onClick={() => navigate('/spaces')}>← Back</button>

        <div className="page-header" style={{ marginBottom: 20, alignItems: 'center' }}>
          {editMode ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
              <input
                className="form-input"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSaveName() }}
                autoFocus
                style={{ flex: 1, fontSize: 15, height: 38 }}
              />
              <button className="btn btn-ghost" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }} onClick={() => { void handleSaveName() }}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 className="page-title">{space.emoji ?? '📦'} {space.name}</h1>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 16, padding: '2px 8px' }}
                onClick={() => setEditMode(true)}
                title="Edit name"
              >✏️</button>
            </div>
          )}
        </div>

        {space.startDate != null && (
          <p className="space-meta" style={{ marginBottom: 16 }}>{space.startDate} – {space.endDate}</p>
        )}

        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 20 }}>
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

        <div className="page-tabs">
          {(['overview', 'transactions'] as const).map(tab => (
            <button
              key={tab}
              className={`page-tab${activeTab === tab ? ' page-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div>
            <p className="section-label">Spending by Category</p>
            <SpaceDonutChart data={breakdown} />
          </div>
        )}

        {activeTab === 'transactions' && (
          <div>
            {txs.length === 0 ? (
              <p className="space-meta">No transactions in this space yet.</p>
            ) : (
              txs.map(tx => (
                <div key={tx.id} className="tx-row">
                  <div>
                    <div className="tx-row-item">{tx.item}</div>
                    <div className="tx-row-meta">{tx.occurredOn} · {tx.category}</div>
                  </div>
                  <div className="tx-row-amount">S${tx.amount}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
