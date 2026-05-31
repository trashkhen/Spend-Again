import { useState, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { FilterBar } from '../components/FilterBar'
import { TransactionTable } from '../components/TransactionTable'
import { TransactionModal } from '../components/TransactionModal'
import { CategoryBreakdown } from '../components/charts/CategoryBreakdown'
import { SpaceCard } from '../components/SpaceCard'
import { IouCard } from '../components/IouCard'
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getBudget,
  updateBudget,
  listSpaces,
  attachToSpace,
  detachFromSpace,
} from '../lib/api'
import { getUserId } from '../lib/auth'
import { computeSummary } from '../lib/analytics'
import type { ApiTransaction, BudgetSettings, SpaceWithTotal } from '../lib/api'
import type { Filters } from '../components/FilterBar'
import type { TransactionFormData } from '../components/TransactionModal'

const DEFAULT_FILTERS: Filters = {
  category: '',
  search: '',
  month: String(new Date().getMonth() + 1).padStart(2, '0'),
  year: String(new Date().getFullYear()),
  page: 1,
}

function fmtSGD(amount: number): string {
  return `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getBudgetTierClass(totalThisMonth: number, budget: BudgetSettings | null): string {
  if (budget?.monthlyBudget == null) return ''
  // totalThisMonth is dollars; monthlyBudget is cents — multiply by 100 to match units, then × 100 for %
  const pct = (totalThisMonth * 100 / budget.monthlyBudget) * 100
  const alertPct = budget.budgetAlertPct
  if (pct > 100) return 'kpi-budget--exceeded'
  if (pct >= alertPct) return 'kpi-budget--warning'
  if (pct >= alertPct * 0.75) return 'kpi-budget--caution'
  if (pct >= 50) return 'kpi-budget--moderate'
  return 'kpi-budget--safe'
}

// ── Budget modal ───────────────────────────────────────────────────────────────

function BudgetModal({
  initial,
  onSave,
  onClose,
}: {
  initial: BudgetSettings | null
  onSave: (values: BudgetSettings) => Promise<void>
  onClose: () => void
}) {
  const [amount, setAmount] = useState(
    initial?.monthlyBudget != null ? String(initial.monthlyBudget / 100) : '',
  )
  const [alertPct, setAlertPct] = useState(String(initial?.budgetAlertPct ?? 100))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const monthlyBudget = amount.trim() === '' ? null : Math.round(parseFloat(amount) * 100)
      const budgetAlertPct = parseInt(alertPct, 10)
      if (monthlyBudget !== null && (isNaN(monthlyBudget) || monthlyBudget <= 0)) {
        setError('Enter a valid budget amount')
        setSaving(false)
        return
      }
      if (isNaN(budgetAlertPct) || budgetAlertPct < 1 || budgetAlertPct > 200) {
        setError('Alert % must be between 1 and 200')
        setSaving(false)
        return
      }
      await onSave({ monthlyBudget, budgetAlertPct })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      await onSave({ monthlyBudget: null, budgetAlertPct: 100 })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Monthly Budget</span>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="modal-error">{error}</div>}
          <div className="form-group">
            <label className="form-label">Budget Amount (S$)</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 1500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Alert at (%)</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 80"
              value={alertPct}
              onChange={(e) => setAlertPct(e.target.value)}
              min="1"
              max="200"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={() => void handleClear()} disabled={saving}>
            Clear Budget
          </button>
          <button type="button" className="btn-save" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

export function Dashboard() {
  const userId = getUserId()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [allTransactions, setAllTransactions] = useState<ApiTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudget] = useState<BudgetSettings | null>(null)
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [showBudgetToast, setShowBudgetToast] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<ApiTransaction | null>(null)
  const [chartMonth, setChartMonth] = useState(new Date().getMonth() + 1)
  const [chartYear, setChartYear] = useState(new Date().getFullYear())
  const [spaces, setSpaces] = useState<SpaceWithTotal[]>([])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listTransactions({
        category: filters.category || undefined,
        month: filters.month || undefined,
        year: filters.year || undefined,
        userId: userId ?? undefined,
      })
      setAllTransactions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }, [filters.category, filters.month, filters.year, userId])

  useEffect(() => { void fetchTransactions() }, [fetchTransactions])

  useEffect(() => {
    void (async () => {
      try {
        const b = await getBudget()
        setBudget(b)
      } catch {
        // budget is optional
      }
    })()
    // Fetch spaces once on mount
    void listSpaces().then(setSpaces).catch(() => {})
  }, [])

  const summary = computeSummary(allTransactions)

  useEffect(() => {
    if (budget?.monthlyBudget == null) return
    // Key the dedup to the current calendar month so the toast fires at most
    // once per browser session per month (mirrors the bot's monthly dedup).
    const now = new Date()
    const monthKey = `budget-toast-${now.getMonth() + 1}-${now.getFullYear()}`
    if (sessionStorage.getItem(monthKey) === 'shown') return
    // totalThisMonth is SGD dollars; monthlyBudget is cents — convert to same unit
    const spentCents = summary.totalThisMonth * 100
    const pct = (spentCents / budget.monthlyBudget) * 100
    if (pct >= budget.budgetAlertPct) {
      sessionStorage.setItem(monthKey, 'shown')
      setShowBudgetToast(true)
      const timer = setTimeout(() => setShowBudgetToast(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [budget, summary.totalThisMonth])

  const filtered = filters.search
    ? allTransactions.filter((tx) => tx.item.toLowerCase().includes(filters.search.toLowerCase()))
    : allTransactions

  function openCreate() { setEditingTransaction(null); setModalMode('create') }
  function openEdit(tx: ApiTransaction) { setEditingTransaction(tx); setModalMode('edit') }
  function closeModal() { setModalMode(null); setEditingTransaction(null) }

  async function handleSave(data: TransactionFormData) {
    if (modalMode === 'create') {
      if (!userId) throw new Error('Not authenticated')
      const { spaceId, ...txData } = data
      const created = await createTransaction({ ...txData, userId })
      // Attach to space if selected
      if (spaceId && created.id) {
        try {
          await attachToSpace(spaceId, created.id)
        } catch {
          // Non-blocking — transaction is still saved
        }
      }
    } else if (modalMode === 'edit' && editingTransaction) {
      const { spaceId, ...txData } = data
      await updateTransaction(editingTransaction.id, txData)
      // Handle space change on edit
      const oldSpaceId = editingTransaction.spaceId
      if (spaceId !== oldSpaceId) {
        try {
          if (oldSpaceId) await detachFromSpace(oldSpaceId, editingTransaction.id)
          if (spaceId) await attachToSpace(spaceId, editingTransaction.id)
        } catch {
          // Non-blocking
        }
      }
    }
    await fetchTransactions()
    // Refresh spaces to update totals
    void listSpaces().then(setSpaces).catch(() => {})
    closeModal()
  }

  async function handleDelete(id: string) {
    await deleteTransaction(id)
    await fetchTransactions()
    // Refresh spaces to update totals
    void listSpaces().then(setSpaces).catch(() => {})
  }

  async function handleSpaceChange(txId: string, newSpaceId: string | null, oldSpaceId: string | null) {
    try {
      if (oldSpaceId) await detachFromSpace(oldSpaceId, txId)
      if (newSpaceId) await attachToSpace(newSpaceId, txId)
      // Optimistic update: patch the local transaction list
      setAllTransactions(prev =>
        prev.map(tx => tx.id === txId ? { ...tx, spaceId: newSpaceId } : tx)
      )
      // Refresh spaces to update spent totals
      void listSpaces().then(setSpaces).catch(() => {})
    } catch {
      // Revert: re-fetch to get true state
      void fetchTransactions()
    }
  }

  return (
    <Layout
      searchValue={filters.search}
      onSearchChange={(val) => setFilters((prev) => ({ ...prev, search: val, page: 1 }))}
    >
      {/* ── Hero row ── */}
      <div className="dashboard-hero-row">
        <div className="dashboard-hero">
          <div>
            <h1 className="page-title">Dashboard 👋</h1>
            <p className="page-subtitle">Welcome back! Here's your financial overview.</p>
          </div>
          <div className="dashboard-hero-actions">
            <button type="button" className="btn-budget" onClick={() => setBudgetModalOpen(true)}>
              Budget
            </button>
            <button type="button" className="btn-add-transaction" onClick={openCreate}>
              + Add Transaction
            </button>
          </div>
        </div>
        <div className="dashboard-hero-banner-card">
          <img src="/banner.png" alt="" className="dashboard-hero-img" aria-hidden="true" />
        </div>
      </div>

      {/* ── KPI grid ── */}
      <div className="kpi-grid">
        <div className={`kpi-card ${getBudgetTierClass(summary.totalThisMonth, budget)}`}>
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--blue">💳</div>
            <span className="kpi-trend kpi-trend--up">↑ this month</span>
          </div>
          <span className="kpi-label">Monthly Spending</span>
          <span className="kpi-value">{fmtSGD(summary.totalThisMonth)}</span>
          {budget?.monthlyBudget != null && (
            <span className="budget-kpi-sub">/ {fmtSGD(budget.monthlyBudget / 100)}</span>
          )}
        </div>

        <div className="kpi-card kpi-card--coral">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--red">📈</div>
            <span className="kpi-trend kpi-trend--up">avg / day</span>
          </div>
          <span className="kpi-label">Daily Average</span>
          <span className="kpi-value">{fmtSGD(summary.averageDaily)}</span>
        </div>

        <div className="kpi-card kpi-card--gold">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--orange">🏆</div>
            <span className="kpi-trend" style={{ color: 'var(--color-warning)' }}>top spend</span>
          </div>
          <span className="kpi-label">Top Category</span>
          <span className="kpi-value" style={{ fontSize: '17px' }}>{summary.topCategory ?? '—'}</span>
        </div>

        <div className="kpi-card kpi-card--leaf">
          <div className="kpi-card-top">
            <div className="kpi-icon kpi-icon--green">🧾</div>
            <span className="kpi-trend kpi-trend--up">this month</span>
          </div>
          <span className="kpi-label">Transactions</span>
          <span className="kpi-value">{summary.transactionCount}</span>
        </div>
      </div>

      {/* ── Two-column main row ── */}
      <div className="dashboard-main-row">
        <div className="dashboard-section">
          <FilterBar filters={filters} onChange={setFilters} />
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button type="button" className="error-retry-btn" onClick={() => void fetchTransactions()}>Retry</button>
            </div>
          )}
          <TransactionTable
            transactions={filtered}
            loading={loading}
            page={filters.page}
            onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
            onEdit={openEdit}
            onDelete={handleDelete}
            spaces={spaces}
            onSpaceChange={handleSpaceChange}
          />
        </div>

        <div className="dashboard-spending-overview">
          <CategoryBreakdown
            transactions={allTransactions}
            month={chartMonth}
            year={chartYear}
            onMonthChange={(m, y) => { setChartMonth(m); setChartYear(y) }}
          />
          <SpaceCard />
          <IouCard />
        </div>
      </div>

      {budgetModalOpen && (
        <BudgetModal
          initial={budget}
          onSave={async (values) => {
            const updated = await updateBudget(values)
            setBudget(updated)
            setBudgetModalOpen(false)
          }}
          onClose={() => setBudgetModalOpen(false)}
        />
      )}

      {modalMode && (
        <TransactionModal
          mode={modalMode}
          transaction={editingTransaction ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
          spaces={spaces}
        />
      )}

      {showBudgetToast && (
        <div
          className="budget-toast"
          onClick={() => setShowBudgetToast(false)}
          role="alert"
        >
          Oi cut down on spending la, going to hit budget alr 🤬
        </div>
      )}
    </Layout>
  )
}
