import { useState } from 'react'
import type { ApiTransaction } from '../lib/api'

const PAGE_SIZE = 20

type Props = {
  transactions: ApiTransaction[]
  loading: boolean
  page: number
  onPageChange: (page: number) => void
  onEdit: (tx: ApiTransaction) => void
  onDelete: (id: string) => Promise<void>
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount)
  return `S$${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(date: string): string {
  const parts = date.split('/')
  if (parts.length !== 3) return date
  const [d, m, y] = parts
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthName = months[(parseInt(m ?? '1', 10) - 1)] ?? m
  return `${parseInt(d ?? '1', 10)} ${monthName} ${y}`
}

function isIncome(category: string): boolean {
  return category.toLowerCase() === 'income'
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

export function TransactionTable({ transactions, loading, page, onPageChange, onEdit, onDelete }: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  const sliced = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function handleDeleteConfirm(id: string) {
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
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
      </div>

      <ul className="tx-list" role="list">
        {sliced.map((tx) => {
          const income = isIncome(tx.category)
          const isConfirmingDelete = confirmDeleteId === tx.id
          const isDeleting = deletingId === tx.id

          return (
            <li key={tx.id} className="tx-row">
              <div className="tx-row-left">
                <span className="tx-item-name">{tx.item}</span>
                <span className="tx-item-meta">
                  {tx.category}{tx.subCategory ? ` / ${tx.subCategory}` : ''} · {formatDate(tx.date)}
                </span>
              </div>

              <div className="tx-row-right">
                <span className={`tx-amount${income ? ' tx-amount--income' : ''}`}>
                  {income ? '+' : ''}{formatAmount(tx.amount)}
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
