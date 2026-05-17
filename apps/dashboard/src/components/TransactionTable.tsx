import type { ApiTransaction } from '../lib/api'

const PAGE_SIZE = 20

type Props = {
  transactions: ApiTransaction[]
  loading: boolean
  page: number
  onPageChange: (page: number) => void
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount)
  return `S$${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Formats DD/MM/YYYY → "15 May 2026" */
function formatDate(date: string): string {
  const parts = date.split('/')
  if (parts.length !== 3) return date
  const [d, m, y] = parts
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthName = months[(parseInt(m ?? '1', 10) - 1)] ?? m
  return `${parseInt(d ?? '1', 10)} ${monthName} ${y}`
}

/** Simple heuristic: transactions categorised as "Income" are rendered in green */
function isIncome(category: string): boolean {
  return category.toLowerCase() === 'income'
}

export function TransactionTable({ transactions, loading, page, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  const sliced = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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
          return (
            <li key={tx.id} className="tx-row">
              <div className="tx-row-left">
                <span className="tx-item-name">{tx.item}</span>
                <span className="tx-item-meta">
                  {tx.category}{tx.subCategory ? ` / ${tx.subCategory}` : ''} · {formatDate(tx.date)}
                </span>
              </div>
              <span className={`tx-amount${income ? ' tx-amount--income' : ''}`}>
                {income ? '+' : ''}{formatAmount(tx.amount)}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Pagination */}
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
