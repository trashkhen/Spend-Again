import { useState, useEffect } from 'react'
import { CATEGORIES, CATEGORY_MAP } from '@spend-again/shared'
import type { ApiRecurring, Category, RecurringFrequency } from '@spend-again/shared'
import { Layout } from '../components/Layout'
import {
  listRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
} from '../lib/api-recurring'

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']

function formatNextDue(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [y, m, d] = parts
  return `${parseInt(d ?? '1', 10)} ${months[(parseInt(m ?? '1', 10) - 1)] ?? m} ${y}`
}

function monthlyEquivalent(amountCents: number, frequency: RecurringFrequency): number {
  switch (frequency) {
    case 'weekly':      return Math.round(amountCents * 52 / 12)
    case 'fortnightly': return Math.round(amountCents * 26 / 12)
    case 'monthly':     return amountCents
    case 'quarterly':   return Math.round(amountCents / 3)
    case 'yearly':      return Math.round(amountCents / 12)
  }
}

function formatAmount(amountCents: number): string {
  return `S$${(amountCents / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type ModalMode = 'create' | 'edit'
type ModalState = { mode: ModalMode; item?: ApiRecurring } | null

function RecurringModal({
  mode,
  item,
  onSave,
  onClose,
}: {
  mode: ModalMode
  item?: ApiRecurring
  onSave: (data: Parameters<typeof createRecurring>[0]) => Promise<void>
  onClose: () => void
}) {
  const initCategory = (item?.category as Category | undefined) ?? 'Food'
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? (item.amountCents / 100).toFixed(2) : '')
  const [category, setCategory] = useState<string>(initCategory)
  const [subCategory, setSubCategory] = useState(
    item?.subCategory ?? (CATEGORY_MAP[initCategory as Category]?.[0] ?? 'Other')
  )
  const [description, setDescription] = useState(item?.description ?? '')
  const [frequency, setFrequency] = useState<RecurringFrequency>(item?.frequency ?? 'monthly')
  const [startDate, setStartDate] = useState(() => {
    if (item?.nextDueDate) return item.nextDueDate
    return new Date().toISOString().slice(0, 10)
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleCategoryChange(cat: string) {
    setCategory(cat)
    setSubCategory((CATEGORY_MAP[cat as Category]?.[0] ?? 'Other') as string)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !amount) return
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) { setError('Amount must be positive'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        amountCents: Math.round(amountNum * 100),
        category,
        subCategory,
        description: description.trim() || undefined,
        frequency,
        startDate,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">{mode === 'create' ? 'Add Subscription' : 'Edit Subscription'}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e) }}>
          <div className="modal-body">
            {error && <div className="modal-error" role="alert">{error}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="rec-name">Name</label>
              <input id="rec-name" type="text" className="form-input" placeholder="e.g. Netflix" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="rec-amount">Amount (SGD)</label>
                <input id="rec-amount" type="number" className="form-input" placeholder="0.00" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rec-frequency">Frequency</label>
                <select id="rec-frequency" className="form-select" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="rec-category">Category</label>
                <select id="rec-category" className="form-select" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rec-subcategory">Sub-category</label>
                <select id="rec-subcategory" className="form-select" value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
                  {(CATEGORY_MAP[category as Category] ?? ['Other']).map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="rec-start">Next due date</label>
              <input id="rec-start" type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="rec-desc">Description <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span></label>
              <input id="rec-desc" type="text" className="form-input" placeholder="e.g. Family plan" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-save" disabled={saving}>{saving ? 'Saving…' : mode === 'create' ? 'Add Subscription' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Recurring() {
  const [items, setItems] = useState<ApiRecurring[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalState>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listRecurring().then((data) => {
      if (!cancelled) { setItems(data); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const activeItems = items.filter((i) => i.isActive === 1)
  const monthlyCostCents = activeItems.reduce(
    (sum, i) => sum + monthlyEquivalent(i.amountCents, i.frequency),
    0,
  )

  async function handleSave(data: Parameters<typeof createRecurring>[0]) {
    if (modal?.mode === 'edit' && modal.item) {
      const updated = await updateRecurring(modal.item.id, data)
      setItems((prev) => prev.map((i) => i.id === updated.id ? updated : i))
    } else {
      const created = await createRecurring(data)
      setItems((prev) => [...prev, created])
    }
    setModal(null)
  }

  async function handleTogglePause(item: ApiRecurring) {
    const updated = await updateRecurring(item.id, { isActive: item.isActive !== 1 })
    setItems((prev) => prev.map((i) => i.id === updated.id ? updated : i))
  }

  async function handleDelete(id: string) {
    await deleteRecurring(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setConfirmDeleteId(null)
  }

  return (
    <Layout>
      <div className="app-main page-enter">
        <div className="page-header">
          <div>
            <h1 className="page-title">Recurring Payments</h1>
            {!loading && activeItems.length > 0 && (
              <p className="page-subtitle">
                Monthly cost (active): <strong style={{ color: 'var(--color-accent)' }}>{formatAmount(monthlyCostCents)}</strong>
              </p>
            )}
            {(loading || activeItems.length === 0) && (
              <p className="page-subtitle">Manage your subscriptions and recurring expenses.</p>
            )}
          </div>
          <button
            type="button"
            className="btn-add-transaction"
            onClick={() => setModal({ mode: 'create' })}
          >
            + Add Subscription
          </button>
        </div>

        {loading ? (
          <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
        ) : items.length === 0 ? (
          <div className="table-state table-state--empty">
            <p className="table-empty-message">No recurring payments yet. Add your first subscription!</p>
          </div>
        ) : (
          <div className="tx-list-card">
            <ul className="tx-list" role="list">
              {items.map((item) => (
                <li key={item.id} className="tx-row" style={{ opacity: item.isActive === 1 ? 1 : 0.5 }}>
                  <div className="tx-row-left">
                    <div className="tx-row-text">
                      <span className="tx-item-name">{item.name}</span>
                      <span className="tx-item-meta">
                        <span className="tx-category-name">{item.category}</span>
                        {item.subCategory ? <span className="tx-subcategory"> / {item.subCategory}</span> : null}
                        {' · '}{item.frequency} · Next: {formatNextDue(item.nextDueDate)}
                        {item.isActive !== 1 ? ' · ⏸ Paused' : null}
                      </span>
                    </div>
                  </div>
                  <div className="tx-row-right">
                    <span className="tx-amount">{formatAmount(item.amountCents)}</span>
                    <div className="tx-row-actions">
                      <button type="button" className="tx-action-btn" onClick={() => setModal({ mode: 'edit', item })} title="Edit">✏️</button>
                      <button type="button" className="tx-action-btn" onClick={() => void handleTogglePause(item)} title={item.isActive === 1 ? 'Pause' : 'Resume'}>
                        {item.isActive === 1 ? '⏸' : '▶️'}
                      </button>
                      {confirmDeleteId === item.id ? (
                        <div className="tx-delete-confirm">
                          <span className="tx-delete-confirm-label">Delete?</span>
                          <button type="button" className="tx-action-btn tx-action-btn--confirm-delete" onClick={() => void handleDelete(item.id)}>✓</button>
                          <button type="button" className="tx-action-btn" onClick={() => setConfirmDeleteId(null)}>✕</button>
                        </div>
                      ) : (
                        <button type="button" className="tx-action-btn tx-action-btn--delete" onClick={() => setConfirmDeleteId(item.id)} title="Delete">🗑</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {modal !== null && (
        <RecurringModal
          mode={modal.mode}
          item={modal.item}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </Layout>
  )
}
