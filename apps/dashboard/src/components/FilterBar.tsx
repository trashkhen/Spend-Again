import { CATEGORIES } from '@spend-again/shared'
import type { Category } from '@spend-again/shared'

export type Filters = {
  category: string
  search: string
  month: string
  year: string
  page: number
}

type Props = {
  filters: Filters
  onChange: (filters: Filters) => void
}

const YEAR_OPTIONS: string[] = []
const currentYear = new Date().getFullYear()
for (let y = currentYear; y >= currentYear - 3; y--) {
  YEAR_OPTIONS.push(String(y))
}

const MONTH_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All months' },
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

export function FilterBar({ filters, onChange }: Props) {
  function update(patch: Partial<Filters>) {
    // Reset to page 1 whenever a filter changes
    onChange({ ...filters, ...patch, page: 1 })
  }

  return (
    <div className="filter-bar">
      {/* Text search */}
      <div className="filter-group">
        <label htmlFor="search-input" className="filter-label">
          Search
        </label>
        <input
          id="search-input"
          type="text"
          className="filter-input"
          placeholder="Item name..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
        />
      </div>

      {/* Category dropdown */}
      <div className="filter-group">
        <label htmlFor="category-select" className="filter-label">
          Category
        </label>
        <select
          id="category-select"
          className="filter-select"
          value={filters.category}
          onChange={(e) => update({ category: e.target.value })}
        >
          <option value="">All categories</option>
          {(CATEGORIES as readonly Category[]).map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Month picker */}
      <div className="filter-group">
        <label htmlFor="month-select" className="filter-label">
          Month
        </label>
        <select
          id="month-select"
          className="filter-select"
          value={filters.month}
          onChange={(e) => update({ month: e.target.value })}
        >
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Year picker */}
      <div className="filter-group">
        <label htmlFor="year-select" className="filter-label">
          Year
        </label>
        <select
          id="year-select"
          className="filter-select"
          value={filters.year}
          onChange={(e) => update({ year: e.target.value })}
        >
          <option value="">All years</option>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Clear filters */}
      {(filters.category || filters.search || filters.month || filters.year) && (
        <button
          type="button"
          className="filter-clear-btn"
          onClick={() => onChange({ category: '', search: '', month: '', year: '', page: 1 })}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
