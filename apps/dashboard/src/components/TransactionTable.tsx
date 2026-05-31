import { useState } from 'react'
import { emojiFor, parseYYYYMMDD } from '@spend-again/shared'
import type { ApiTransaction, SpaceWithTotal } from '../lib/api'

const PAGE_SIZE = 20

type PriceSort = 'asc' | 'desc' | null

type Props = {
  transactions: ApiTransaction[]
  loading: boolean
  page: number
  onPageChange: (page: number) => void
  onEdit: (tx: ApiTransaction) => void
  onDelete: (id: string) => Promise<void>
  spaces: SpaceWithTotal[]
  onSpaceChange: (txId: string, newSpaceId: string | null, oldSpaceId: string | null) => Promise<void>
}

const CATEGORY_COLOR: Record<string, string> = {
  Food: 'rgba(99,102,241,0.10)',
  Transport: 'rgba(245,158,11,0.10)',
  Groceries: 'rgba(16,185,129,0.10)',
  Shopping: 'rgba(139,92,246,0.10)',
  Entertainment: 'rgba(236,72,153,0.10)',
  Health: 'rgba(239,68,68,0.10)',
  Education: 'rgba(59,130,246,0.10)',
  Travel: 'rgba(20,184,166,0.10)',
  Utilities: 'rgba(249,115,22,0.10)',
  Finance: 'rgba(91,142,197,0.10)',
  Housing: 'rgba(132,204,22,0.10)',
  Other: 'rgba(148,163,184,0.10)',
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount)
  return `S$${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(occurredOn: string): string {
  // occurredOn is YYYY-MM-DD
  const parts = occurredOn.split('-')
  if (parts.length !== 3) return occurredOn
  const [y, m, d] = parts
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthName = months[(parseInt(m ?? '1', 10) - 1)] ?? m
  return `${parseInt(d ?? '1', 10)} ${monthName} ${y}`
}

function parseTransactionDate(occurredOn: string): Date {
  // Parse YYYY-MM-DD as local midnight (not UTC) to stay consistent with
  // parseDDMMYYYY in the modal and bot. new Date("2026-05-28") would parse
  // as UTC midnight and skew sorts at SGT day boundaries.
  return parseYYYYMMDD(occurredOn) ?? new Date(0)
}

function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 0 3L10 14l-4 1 1-4 8.5-8.5z"/>
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 19 6"/>
      <path d="M19 6l-1 12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L3 6"/>
      <path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}

export function TransactionTable({ transactions, loading, page, onPageChange, onEdit, onDelete, spaces, onSpaceChange }: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [priceSort, setPriceSort] = useState<PriceSort>(null)
  const [changingSpaceTxId, setChangingSpaceTxId] = useState<string | null>(null)

  function cyclePriceSort() {
    setPriceSort((cur) => cur === null ? 'asc' : cur === 'asc' ? 'desc' : null)
  }

  const sorted = priceSort
    ? [...transactions].sort((a, b) => {
        const diff = a.amountCents - b.amountCents
        return priceSort === 'asc' ? diff : -diff
      })
    : [...transactions].sort((a, b) =>
        parseTransactionDate(b.occurredOn).getTime() - parseTransactionDate(a.occurredOn).getTime()
      )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const sliced = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Only show active spaces in the dropdown
  const activeSpaces = spaces.filter(s => s.status === 'active')

  async function handleDeleteConfirm(id: string) {
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  async function handleSpaceSelect(txId: string, newSpaceId: string, oldSpaceId: string | null) {
    const target = newSpaceId === '' ? null : newSpaceId
    if (target === oldSpaceId) return
    setChangingSpaceTxId(txId)
    try {
      await onSpaceChange(txId, target, oldSpaceId)
    } finally {
      setChangingSpaceTxId(null)
    }
  }

  if (loading) {
    return (
      <div className="table-state">
        <span className="spinner" aria-label="Loading transactions..." />
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="table-state table-state--empty">
        <p className="table-empty-message">No transactions found. Start tracking your expenses!</p>
      </div>
    )
  }

  return (
    <div className="tx-list-card">
      <div className="tx-list-header">
        <h3 className="tx-list-title">Recent Transactions</h3>
        <button type="button" className="tx-list-sort-btn" onClick={cyclePriceSort} aria-label="Sort by price">
          Price{priceSort === 'asc' ? ' ↑' : priceSort === 'desc' ? ' ↓' : ''}
        </button>
      </div>

      <ul className="tx-list" role="list">
        {sliced.map((tx) => {
          const isConfirmingDelete = confirmDeleteId === tx.id
          const isDeleting = deletingId === tx.id
          const isChangingSpace = changingSpaceTxId === tx.id
          const emoji = emojiFor(tx.category)
          const iconBg = CATEGORY_COLOR[tx.category] ?? 'rgba(148,163,184,0.10)'

          return (
            <li key={tx.id} className="tx-row">
              <div className="tx-row-left">
                <div className="tx-category-icon" style={{ background: iconBg }}>
                  {emoji}
                </div>
                <div className="tx-row-text">
                  <span
                    className="tx-item-name"
                    title={tx.description ?? undefined}
                  >
                    {tx.item}
                  </span>
                  <span className="tx-item-meta">
                    <span className="tx-category-name">{tx.category}</span>
                    {tx.subCategory ? <span className="tx-subcategory"> / {tx.subCategory}</span> : null}
                    {' · '}{formatDate(tx.occurredOn)}
                    {' · '}
                    <select
                      className={`tx-space-select ${tx.spaceId == null ? 'tx-space-select--empty' : ''}`}
                      value={tx.spaceId ?? ''}
                      onChange={(e) => { void handleSpaceSelect(tx.id, e.target.value, tx.spaceId) }}
                      disabled={isChangingSpace}
                      aria-label={`Space for ${tx.item}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">No space</option>
                      {activeSpaces.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.emoji ?? '📦'} {s.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              </div>

              <div className="tx-row-right">
                <span className="tx-amount">
                  {formatAmount(tx.amount)}
                </span>

                {isConfirmingDelete ? (
                  <div className="tx-delete-confirm">
                    <span className="tx-delete-confirm-label">Delete?</span>
                    <button
                      type="button"
                      className="tx-action-btn tx-action-btn--confirm-delete"
                      onClick={() => { void handleDeleteConfirm(tx.id) }}
                      disabled={isDeleting}
                      aria-label="Confirm delete"
                    >
                      {isDeleting ? '…' : '✓'}
                    </button>
                    <button
                      type="button"
                      className="tx-action-btn"
                      onClick={() => setConfirmDeleteId(null)}
                      aria-label="Cancel delete"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="tx-row-actions">
                    <button
                      type="button"
                      className="tx-action-btn"
                      onClick={() => onEdit(tx)}
                      aria-label={`Edit ${tx.item}`}
                      title="Edit"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="tx-action-btn tx-action-btn--delete"
                      onClick={() => setConfirmDeleteId(tx.id)}
                      aria-label={`Delete ${tx.item}`}
                      title="Delete"
                    >
                      <IconTrash />
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {totalPages > 1 && (
        <div className="pagination" role="navigation" aria-label="Pagination">
          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            ← Prev
          </button>
          <span className="pagination-info">Page {page} of {totalPages}</span>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
