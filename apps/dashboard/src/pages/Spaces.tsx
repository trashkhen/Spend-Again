import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { emojiFor } from '@spend-again/shared'
import { Layout } from '../components/Layout'
import { CategoryDonut } from '../components/ui/CategoryDonut'
import { SpaceFormModal } from '../components/SpaceFormModal'
import {
  listSpaces, deactivateSpace, reactivateSpace, permanentDeleteSpace,
  updateSpace, createSpace, getSpaceTransactions, getSpaceBreakdown,
} from '../lib/api'
import { fmtSGD, fmtShortDate } from '../lib/format'
import { spaceBudgetState, spaceTimeline } from '../lib/spaces'
import type { SpaceWithTotal, ApiTransaction, SpaceBreakdownItem } from '../lib/api'
import type { SpaceFormValues } from '../components/SpaceFormModal'
import type { DonutRow } from '../components/ui/CategoryDonut'

// ── Small icons ───────────────────────────────────────────────────────────────

function IconArchive() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="4" rx="1" /><path d="M4 7.5v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8" /><path d="M8 11h4" />
    </svg>
  )
}
function IconRestore() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" /><path d="M3 3.5v3.5h3.5" />
    </svg>
  )
}
function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 5.5h13" /><path d="M15.5 5.5l-.8 10.5a1.5 1.5 0 0 1-1.5 1.5H6.8a1.5 1.5 0 0 1-1.5-1.5L4.5 5.5" /><path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    </svg>
  )
}
function IconEdit() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 3.5l3 3L7 16H4v-3z" />
    </svg>
  )
}

function BudgetBar({ space }: { space: SpaceWithTotal }) {
  const state = spaceBudgetState(space)
  if (!state) return null
  return (
    <div className="sp-budget">
      <div className="ui-progress" aria-label={`${state.pct}% of budget used`}>
        <div className={`ui-progress-fill${state.tone === 'over' ? ' is-over' : state.tone === 'warn' ? ' is-warn' : ''}`} style={{ width: `${Math.min(100, state.pct)}%` }} />
      </div>
      <div className="sp-budget-meta">
        <span>{state.pct}% used</span>
        <span className={state.remaining < 0 ? 'is-over' : ''}>
          {state.remaining >= 0 ? `${fmtSGD(state.remaining)} left` : `${fmtSGD(-state.remaining)} over`}
        </span>
      </div>
    </div>
  )
}

// ── Spaces list ───────────────────────────────────────────────────────────────

export function Spaces() {
  const [spaces, setSpaces] = useState<SpaceWithTotal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  function reload() {
    return listSpaces().then(setSpaces)
  }

  useEffect(() => {
    reload()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load spaces'))
      .finally(() => setLoading(false))
  }, [])

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const handleArchive = (id: string) => run(async () => {
    await deactivateSpace(id)
    setSpaces(prev => prev.map(s => s.id === id ? { ...s, status: 'archived' as const } : s))
  })
  const handleRestore = (id: string) => run(async () => {
    await reactivateSpace(id)
    setSpaces(prev => prev.map(s => s.id === id ? { ...s, status: 'active' as const } : s))
  })
  const handleDelete = (id: string) => run(async () => {
    await permanentDeleteSpace(id)
    setSpaces(prev => prev.filter(s => s.id !== id))
    setConfirmDeleteId(null)
  })

  async function handleCreate(values: SpaceFormValues) {
    const created = await createSpace(values)
    await reload()
    setCreating(false)
    navigate(`/spaces/${created.id}`)
  }

  const active = spaces.filter(s => s.status === 'active')
  const archived = spaces.filter(s => s.status === 'archived')
  const shown = activeTab === 'active' ? active : archived
  const activeTotal = active.reduce((sum, s) => sum + s.spentCents, 0) / 100
  const overBudget = active.filter(s => (spaceBudgetState(s)?.tone ?? 'ok') === 'over').length
  const ongoing = active.filter(s => spaceTimeline(s).phase === 'ongoing').length

  return (
    <Layout>
      <div className="sp-header">
        <div>
          <h1 className="page-title">Spaces</h1>
          <p className="page-subtitle">Group spending for trips, events and projects, each with its own budget.</p>
        </div>
        <button type="button" className="btn-add-transaction" onClick={() => setCreating(true)}>+ New space</button>
      </div>

      {!loading && active.length > 0 && (
        <div className="sp-summary">
          <div className="sp-summary-item">
            <span className="sp-summary-value">{active.length}</span>
            <span className="sp-summary-label">active space{active.length === 1 ? '' : 's'}</span>
          </div>
          <div className="sp-summary-item">
            <span className="sp-summary-value">{fmtSGD(activeTotal)}</span>
            <span className="sp-summary-label">spent across them</span>
          </div>
          <div className="sp-summary-item">
            <span className="sp-summary-value">{ongoing}</span>
            <span className="sp-summary-label">happening now</span>
          </div>
          <div className={`sp-summary-item${overBudget > 0 ? ' is-over' : ''}`}>
            <span className="sp-summary-value">{overBudget}</span>
            <span className="sp-summary-label">over budget</span>
          </div>
        </div>
      )}

      <div className="sp-toolbar">
        <div className="ui-seg" role="tablist" aria-label="Space status">
          {(['active', 'archived'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`ui-seg-btn${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => { setActiveTab(tab); setConfirmDeleteId(null) }}
            >
              {tab === 'active' ? 'Active' : 'Archived'}
              <span className="ui-seg-count">{tab === 'active' ? active.length : archived.length}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {loading ? (
        <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
      ) : shown.length === 0 && activeTab === 'archived' ? (
        <div className="sp-empty">
          <span className="sp-empty-emoji">🗂️</span>
          <p className="sp-empty-title">No archived spaces</p>
          <p className="sp-empty-text">Archive a space when the trip or event is over. It keeps its history and you can restore it any time.</p>
        </div>
      ) : (
        <div className="sp-grid">
          {shown.map(s => {
            const timeline = spaceTimeline(s)
            const budget = spaceBudgetState(s)
            const confirming = confirmDeleteId === s.id
            return (
              <article
                key={s.id}
                className={`sp-card sp-card--${timeline.phase}${s.status === 'archived' ? ' is-archived' : ''}`}
                onClick={() => { if (!confirming) navigate(`/spaces/${s.id}`) }}
                onKeyDown={(e) => { if (!confirming && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/spaces/${s.id}`) } }}
                role="link"
                tabIndex={0}
                aria-label={`Open ${s.name}`}
              >
                <div className="sp-card-head">
                  <span className="sp-emoji">{s.emoji ?? '📦'}</span>
                  <div className="sp-card-title-wrap">
                    <h3 className="sp-card-title">{s.name}</h3>
                    <p className="sp-card-range">{timeline.range ?? 'No dates'}</p>
                  </div>
                  <span className={`ui-pill ui-pill--${s.status === 'archived' ? 'muted' : timeline.phase}`}>
                    {s.status === 'archived' ? 'Archived' : timeline.phase === 'ongoing' ? 'Now' : timeline.phase === 'upcoming' ? 'Upcoming' : timeline.phase === 'ended' ? 'Ended' : 'Open'}
                  </span>
                </div>

                <div className="sp-card-amounts">
                  <span className="sp-card-spent">{fmtSGD(s.spentCents / 100)}</span>
                  {s.budgetCents != null && <span className="sp-card-of">of {fmtSGD(s.budgetCents / 100)}</span>}
                </div>

                {budget ? <BudgetBar space={s} /> : <p className="sp-card-nobudget">No budget set</p>}

                <div className="sp-card-foot" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {confirming ? (
                    <div className="sp-confirm">
                      <span>Delete permanently? Transactions are kept.</span>
                      <div className="sp-confirm-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        <button type="button" className="btn btn-danger" onClick={() => { void handleDelete(s.id) }}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="sp-card-meta">
                        {s.transactionCount} transaction{s.transactionCount === 1 ? '' : 's'}
                        {timeline.phase === 'ongoing' || timeline.phase === 'upcoming' ? ` · ${timeline.label}` : ''}
                      </span>
                      <div className="sp-card-actions">
                        {s.status === 'active' ? (
                          <button type="button" className="ui-icon-btn" onClick={() => { void handleArchive(s.id) }} title="Archive" aria-label={`Archive ${s.name}`}>
                            <IconArchive />
                          </button>
                        ) : (
                          <button type="button" className="ui-icon-btn" onClick={() => { void handleRestore(s.id) }} title="Restore" aria-label={`Restore ${s.name}`}>
                            <IconRestore />
                          </button>
                        )}
                        <button type="button" className="ui-icon-btn ui-icon-btn--danger" onClick={() => setConfirmDeleteId(s.id)} title="Delete" aria-label={`Delete ${s.name}`}>
                          <IconTrash />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            )
          })}

          {activeTab === 'active' && (
            <button type="button" className="sp-card sp-card--new" onClick={() => setCreating(true)}>
              <span className="sp-new-plus">+</span>
              <span className="sp-new-title">{active.length === 0 ? 'Create your first space' : 'New space'}</span>
              <span className="sp-new-text">A trip, a wedding, a renovation. Give it a budget and dates, or create one in Telegram with <code>/space</code>.</span>
            </button>
          )}
        </div>
      )}

      {creating && (
        <SpaceFormModal mode="create" onSave={handleCreate} onClose={() => setCreating(false)} />
      )}
    </Layout>
  )
}

// ── Space detail ──────────────────────────────────────────────────────────────

function groupByDate(txs: ApiTransaction[]): { date: string; items: ApiTransaction[]; total: number }[] {
  const map = new Map<string, ApiTransaction[]>()
  for (const tx of [...txs].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt))) {
    const list = map.get(tx.occurredOn) ?? []
    list.push(tx)
    map.set(tx.occurredOn, list)
  }
  return Array.from(map.entries()).map(([date, items]) => ({
    date,
    items,
    total: items.reduce((s, t) => s + parseFloat(t.amount), 0),
  }))
}

export function SpaceDetail() {
  const { id } = useParams<{ id: string }>()
  const [space, setSpace] = useState<SpaceWithTotal | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [breakdown, setBreakdown] = useState<SpaceBreakdownItem[]>([])
  const [txs, setTxs] = useState<ApiTransaction[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    listSpaces()
      .then(all => {
        const found = all.find(s => s.id === id) ?? null
        setSpace(found)
        setNotFound(found === null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load space'))
    getSpaceBreakdown(id).then(setBreakdown).catch(() => {})
    getSpaceTransactions(id).then(setTxs).catch(() => {})
  }, [id])

  const donut: DonutRow[] = useMemo(
    () => breakdown.map(b => ({ name: b.category, total: b.totalCents / 100, percentage: b.pct })),
    [breakdown],
  )
  const groups = useMemo(() => groupByDate(txs), [txs])

  async function handleSave(values: SpaceFormValues) {
    if (!id) return
    const updated = await updateSpace(id, values)
    setSpace(prev => prev ? { ...prev, ...updated } : prev)
    setEditing(false)
  }

  async function toggleArchive() {
    if (!id || !space) return
    setError(null)
    try {
      if (space.status === 'active') await deactivateSpace(id)
      else await reactivateSpace(id)
      setSpace({ ...space, status: space.status === 'active' ? 'archived' : 'active' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  if (notFound) {
    return (
      <Layout>
        <div className="sp-empty">
          <span className="sp-empty-emoji">🔍</span>
          <p className="sp-empty-title">Space not found</p>
          <p className="sp-empty-text">It may have been deleted.</p>
          <Link to="/spaces" className="btn btn-ghost">Back to spaces</Link>
        </div>
      </Layout>
    )
  }

  if (!space) {
    return (
      <Layout>
        {error ? <div className="error-banner" role="alert">{error}</div> : <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>}
      </Layout>
    )
  }

  const timeline = spaceTimeline(space)
  const budget = spaceBudgetState(space)
  const spent = space.spentCents / 100
  const avgPerTx = space.transactionCount > 0 ? spent / space.transactionCount : 0
  const perDay = timeline.daysElapsed && timeline.daysElapsed > 0 ? spent / timeline.daysElapsed : null
  const canSpendPerDay = budget && budget.remaining > 0 && timeline.daysLeft != null && timeline.daysLeft > 0
    ? budget.remaining / (timeline.daysLeft + 1) // include today
    : null
  const topCategory = donut[0]

  return (
    <Layout>
      <button type="button" className="sp-back" onClick={() => navigate('/spaces')}>
        <span aria-hidden="true">←</span> All spaces
      </button>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {/* ── Hero ── */}
      <section className="sp-hero">
        <span className="sp-hero-emoji">{space.emoji ?? '📦'}</span>
        <div className="sp-hero-text">
          <div className="sp-hero-title-row">
            <h1 className="sp-hero-title">{space.name}</h1>
            <span className={`ui-pill ui-pill--${space.status === 'archived' ? 'muted' : timeline.phase}`}>
              {space.status === 'archived' ? 'Archived' : timeline.phase === 'ongoing' ? 'Happening now' : timeline.phase === 'upcoming' ? 'Upcoming' : timeline.phase === 'ended' ? 'Ended' : 'Open'}
            </span>
          </div>
          <p className="sp-hero-sub">
            {timeline.range ? <>{timeline.range} · {timeline.label}</> : 'No dates set'}
          </p>
        </div>
        <div className="sp-hero-actions">
          <button type="button" className="btn btn-ghost sp-hero-btn" onClick={() => setEditing(true)}>
            <IconEdit /> Edit
          </button>
          <button type="button" className="btn btn-ghost sp-hero-btn" onClick={() => { void toggleArchive() }}>
            {space.status === 'active' ? <><IconArchive /> Archive</> : <><IconRestore /> Restore</>}
          </button>
        </div>
      </section>

      {/* ── Budget + stats ── */}
      <section className="sp-stats">
        <div className="an-stat an-stat--hero">
          <div className="an-stat-top">
            <span className="an-stat-label">Spent</span>
            {budget && (
              <span className={`ui-chip ui-chip--${budget.tone === 'over' ? 'bad' : budget.tone === 'warn' ? 'warn' : 'good'}`}>
                {budget.tone === 'over' ? 'Over budget' : budget.tone === 'warn' ? 'Nearly there' : 'On track'}
              </span>
            )}
          </div>
          <span className="an-stat-value an-stat-value--xl">
            {fmtSGD(spent)}
            {space.budgetCents != null && <span className="an-stat-of"> / {fmtSGD(space.budgetCents / 100)}</span>}
          </span>
          {budget ? (
            <BudgetBar space={space} />
          ) : (
            <button type="button" className="sp-link-btn" onClick={() => setEditing(true)}>+ Set a budget</button>
          )}
        </div>

        <div className="an-stat">
          <span className="an-stat-label">{canSpendPerDay != null ? 'Daily allowance' : 'Per day'}</span>
          <span className="an-stat-value">
            {canSpendPerDay != null ? fmtSGD(canSpendPerDay) : perDay != null ? fmtSGD(perDay) : '—'}
          </span>
          <span className="an-stat-sub">
            {canSpendPerDay != null
              ? `to stay on budget for the remaining ${(timeline.daysLeft ?? 0) + 1} days`
              : perDay != null ? `average over ${timeline.daysElapsed} day${timeline.daysElapsed === 1 ? '' : 's'}` : 'Add dates to see daily pace'}
          </span>
        </div>

        <div className="an-stat">
          <span className="an-stat-label">Transactions</span>
          <span className="an-stat-value">{space.transactionCount}</span>
          <span className="an-stat-sub">{space.transactionCount > 0 ? `Avg ${fmtSGD(avgPerTx)} each` : 'Nothing linked yet'}</span>
        </div>

        <div className="an-stat">
          <span className="an-stat-label">Top category</span>
          <span className="an-stat-value an-stat-value--text">{topCategory ? `${emojiFor(topCategory.name)} ${topCategory.name}` : '—'}</span>
          <span className="an-stat-sub">{topCategory ? `${topCategory.percentage}% · ${fmtSGD(topCategory.total)}` : 'No spending yet'}</span>
        </div>
      </section>

      {/* ── Breakdown + transactions ── */}
      <section className="an-grid an-grid--space">
        <div className="an-card">
          <div className="an-card-head">
            <div>
              <h3 className="an-card-title">Where it went</h3>
              <p className="an-card-sub">Spending by category</p>
            </div>
          </div>
          <CategoryDonut data={donut} centerLabel="Spent" emptyText="No transactions to chart yet." />
        </div>

        <div className="an-card">
          <div className="an-card-head">
            <div>
              <h3 className="an-card-title">Transactions</h3>
              <p className="an-card-sub">Tag expenses to this space from the Home page or in Telegram</p>
            </div>
          </div>
          {groups.length === 0 ? (
            <div className="ui-empty-inline">No transactions in this space yet.</div>
          ) : (
            <div className="sp-tx-groups">
              {groups.map(g => (
                <div key={g.date} className="sp-tx-group">
                  <div className="sp-tx-date">
                    <span>{fmtShortDate(g.date, true)}</span>
                    <span>{fmtSGD(g.total)}</span>
                  </div>
                  {g.items.map(tx => (
                    <div key={tx.id} className="sp-tx-row">
                      <span className="sp-tx-emoji">{emojiFor(tx.category)}</span>
                      <div className="sp-tx-body">
                        <span className="sp-tx-item">{tx.item}</span>
                        <span className="sp-tx-meta">{tx.category}{tx.subCategory ? ` / ${tx.subCategory}` : ''}</span>
                      </div>
                      <span className="sp-tx-amount">{fmtSGD(parseFloat(tx.amount))}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {editing && (
        <SpaceFormModal mode="edit" initial={space} onSave={handleSave} onClose={() => setEditing(false)} />
      )}
    </Layout>
  )
}
