import { useState, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { FilterBar } from '../components/FilterBar'
import { TransactionTable } from '../components/TransactionTable'
import { listTransactions } from '../lib/api'
import { getUserId } from '../lib/auth'
import type { ApiTransaction } from '../lib/api'
import type { Filters } from '../components/FilterBar'

const DEFAULT_FILTERS: Filters = {
  category: '',
  search: '',
  month: String(new Date().getMonth() + 1).padStart(2, '0'),
  year: String(new Date().getFullYear()),
  page: 1,
}

export function Dashboard() {
  const userId = getUserId()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [allTransactions, setAllTransactions] = useState<ApiTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    void fetchTransactions()
  }, [fetchTransactions])

  // Client-side text search filter applied on top of server-filtered results
  const filtered = filters.search
    ? allTransactions.filter((tx) =>
        tx.item.toLowerCase().includes(filters.search.toLowerCase()),
      )
    : allTransactions

  return (
    <Layout>
      <div className="dashboard-section">
        <h2 className="section-heading">Transactions</h2>

        <FilterBar filters={filters} onChange={setFilters} />

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button type="button" className="error-retry-btn" onClick={() => void fetchTransactions()}>
              Retry
            </button>
          </div>
        )}

        <TransactionTable
          transactions={filtered}
          loading={loading}
          page={filters.page}
          onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
        />
      </div>
    </Layout>
  )
}
