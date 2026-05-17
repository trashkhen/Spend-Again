import type { ApiTransaction } from '../lib/api'

const PAGE_SIZE = 20

type Props = {
  transactions: ApiTransaction[]
  loading: boolean
  page: number
  onPageChange: (page: number) => void
}

/**
 * Formats a decimal string amount as "S$XX.XX".
 * Input is already a decimal string from the API (e.g. "10.50").
 */
function formatAmount(amount: string): string {
  const num = parseFloat(amount)
  return `S$${num.toFixed(2)}`
}

/**
 * Returns a CSS class name for the category badge.
 * Maps to colours defined in index.css.
 */
function categoryClass(category: string): string {
  return `category-badge category-badge--${category.toLowerCase().replace(/[^a-z]/g, '-')}`
}

export function TransactionTable({ transactions, loading, page, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  const sliced = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) {
    return (
      <div className="table-state table-state--loading">
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
    <div className="transaction-table-wrapper">
      <table className="transaction-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Item</th>
            <th scope="col">Category</th>
            <th scope="col" className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {sliced.map((tx) => (
            <tr key={tx.id} className="transaction-row">
              <td className="transaction-date">{tx.date}</td>
              <td className="transaction-item">{tx.item}</td>
              <td>
                <span className={categoryClass(tx.category)}>
                  {tx.category}
                  {tx.subCategory ? ` / ${tx.subCategory}` : ''}
                </span>
              </td>
              <td className="transaction-amount text-right">{formatAmount(tx.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
            &laquo; Prev
          </button>

          <span className="pagination-info">
            Page {page} of {totalPages}
          </span>

          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next &raquo;
          </button>
        </div>
      )}
    </div>
  )
}
