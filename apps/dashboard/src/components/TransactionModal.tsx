import { useState, useEffect, useRef } from 'react'
import { CATEGORIES, CATEGORY_MAP } from '@spend-again/shared'
import type { Category, CustomCategory } from '@spend-again/shared'
import type { ApiTransaction } from '../lib/api'
import { listCustomCategories, createCustomCategory } from '../lib/api'

export type TransactionFormData = {
  item: string
  amountCents: number
  category: string
  subCategory: string
  date: string  // DD/MM/YYYY
  source: 'manual'
}

type Props = {
  mode: 'create' | 'edit'
  transaction?: ApiTransaction | undefined
  onSave: (data: TransactionFormData) => Promise<void>
  onClose: () => void
}

function htmlDateToDDMMYYYY(htmlDate: string): string {
  const [y, m, d] = htmlDate.split('-')
  return `${d ?? '01'}/${m ?? '01'}/${y ?? '2026'}`
}

function isoToHtmlDate(date: string): string {
  // occurredOn is already YYYY-MM-DD which is the HTML date input format
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  return todayHtmlDate()
}

function todayHtmlDate(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

const ADD_NEW = '__add_new__'
const DEFAULT_CATEGORY: Category = 'Food'

type DrawerTarget = 'category' | 'subcategory' | null

export function TransactionModal({ mode, transaction, onSave, onClose }: Props) {
  const initCategory = (transaction?.category as Category | undefined) ?? DEFAULT_CATEGORY

  const [item, setItem] = useState(transaction?.item ?? '')
  const [amount, setAmount] = useState(
    transaction ? parseFloat(transaction.amount).toFixed(2) : ''
  )
  const [category, setCategory] = useState<string>(initCategory)
  const [subCategory, setSubCategory] = useState(
    transaction?.subCategory ?? CATEGORY_MAP[initCategory][0] ?? 'Other'
  )
  const [date, setDate] = useState(
    transaction ? isoToHtmlDate(transaction.occurredOn) : todayHtmlDate()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Server-backed custom categories
  const [serverCustoms, setServerCustoms] = useState<CustomCategory[]>([])

  useEffect(() => {
    let cancelled = false
    void listCustomCategories().then((data) => { if (!cancelled) setServerCustoms(data) })
    return () => { cancelled = true }
  }, [])

  const customCategoryNames = Array.from(new Set(serverCustoms.map((c) => c.category)))
    .filter((c) => !CATEGORIES.includes(c as Category))
  const allCategories: string[] = [...CATEGORIES, ...customCategoryNames]

  const customSubsForCategory = serverCustoms
    .filter((c) => c.category === category)
    .map((c) => c.subCategory)
  const baseSubs: string[] = (CATEGORY_MAP[category as Category] ?? ['Other']) as string[]
  const allSubCategories = Array.from(new Set([...baseSubs, ...customSubsForCategory]))

  // Drawer state
  const [drawerTarget, setDrawerTarget] = useState<DrawerTarget>(null)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [drawerInput, setDrawerInput] = useState('')
  const drawerInputRef = useRef<HTMLInputElement>(null)

  // Animate drawer in after mount
  useEffect(() => {
    if (drawerTarget !== null) {
      requestAnimationFrame(() => {
        setDrawerVisible(true)
        setTimeout(() => drawerInputRef.current?.focus(), 50)
      })
    }
  }, [drawerTarget])

  function openDrawer(target: DrawerTarget) {
    setDrawerInput('')
    setDrawerTarget(target)
  }

  function closeDrawer() {
    setDrawerVisible(false)
    setTimeout(() => setDrawerTarget(null), 350)
  }

  async function handleDrawerConfirm() {
    const name = drawerInput.trim()
    if (!name) return
    try {
      if (drawerTarget === 'category') {
        const created = await createCustomCategory({ category: name, subCategory: 'Other' })
        setServerCustoms((prev) => [...prev, created])
        setCategory(name)
        setSubCategory('Other')
      } else if (drawerTarget === 'subcategory') {
        const created = await createCustomCategory({ category, subCategory: name })
        setServerCustoms((prev) => [...prev, created])
        setSubCategory(name)
      }
      closeDrawer()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add')
    }
  }

  function handleCategoryChange(cat: string) {
    setCategory(cat)
    const subs = (CATEGORY_MAP[cat as Category] ?? []) as string[]
    const customSubs = serverCustoms
      .filter((c) => c.category === cat)
      .map((c) => c.subCategory)
    setSubCategory(subs[0] ?? customSubs[0] ?? 'Other')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item.trim() || !amount || !date) return

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Amount must be a positive number')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        item: item.trim(),
        amountCents: Math.round(amountNum * 100),
        category,
        subCategory,
        date: htmlDateToDDMMYYYY(date),
        source: 'manual',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save transaction')
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-header">
            <h2 id="modal-title" className="modal-title">
              {mode === 'create' ? 'Add Transaction' : 'Edit Transaction'}
            </h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e) }}>
            <div className="modal-body">
              {error && (
                <div className="modal-error" role="alert">{error}</div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="tx-item">Item</label>
                <input
                  id="tx-item"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Chicken rice at Maxwell"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="tx-amount">Amount (SGD)</label>
                  <input
                    id="tx-amount"
                    type="number"
                    className="form-input"
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="tx-date">Date</label>
                  <input
                    id="tx-date"
                    type="date"
                    className="form-input"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="tx-category">Category</label>
                  <select
                    id="tx-category"
                    className="form-select"
                    value={category}
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW) {
                        openDrawer('category')
                      } else {
                        handleCategoryChange(e.target.value)
                      }
                    }}
                  >
                    {allCategories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value={ADD_NEW}>+ Add New</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="tx-subcategory">Sub-category</label>
                  <select
                    id="tx-subcategory"
                    className="form-select"
                    value={subCategory}
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW) {
                        openDrawer('subcategory')
                      } else {
                        setSubCategory(e.target.value)
                      }
                    }}
                  >
                    {allSubCategories.map((sub) => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                    <option value={ADD_NEW}>+ Add New</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-save" disabled={saving}>
                {saving ? 'Saving…' : mode === 'create' ? 'Add Transaction' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Add New drawer */}
      {drawerTarget !== null && (
        <div
          className={`drawer-backdrop ${drawerVisible ? 'drawer-backdrop--visible' : ''}`}
          onClick={closeDrawer}
        >
          <div
            className={`drawer ${drawerVisible ? 'drawer--open' : ''}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={drawerTarget === 'category' ? 'Add new category' : 'Add new sub-category'}
          >
            <div className="drawer-handle" />
            <p className="drawer-title">
              {drawerTarget === 'category' ? 'New Category' : 'New Sub-category'}
            </p>
            <input
              ref={drawerInputRef}
              type="text"
              className="drawer-input"
              placeholder={drawerTarget === 'category' ? 'e.g. Gifts' : 'e.g. Birthday'}
              value={drawerInput}
              onChange={(e) => setDrawerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleDrawerConfirm() }}
              maxLength={40}
            />
            <button
              type="button"
              className="drawer-confirm"
              onClick={() => { void handleDrawerConfirm() }}
              disabled={!drawerInput.trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </>
  )
}
