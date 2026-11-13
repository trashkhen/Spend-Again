import { useState } from 'react'
import { ModalPortal } from './ModalPortal'
import type { SpaceWithTotal } from '../lib/api'

const EMOJI_CHOICES = ['✈️', '🏖️', '🎉', '🏠', '🎁', '💍', '🎓', '🍽️', '🚗', '🛍️', '💼', '📦']

export type SpaceFormValues = {
  name: string
  emoji?: string
  budgetCents?: number
  startDate?: string
  endDate?: string
}

type Props = {
  mode: 'create' | 'edit'
  initial?: SpaceWithTotal | undefined
  onSave: (values: SpaceFormValues) => Promise<void>
  onClose: () => void
}

export function SpaceFormModal({ mode, initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '✈️')
  const [budget, setBudget] = useState(initial?.budgetCents != null ? String(initial.budgetCents / 100) : '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) { setError('Give your space a name'); return }

    const values: SpaceFormValues = { name: trimmed, emoji }
    if (budget.trim() !== '') {
      const cents = Math.round(parseFloat(budget) * 100)
      if (!Number.isFinite(cents) || cents <= 0) { setError('Budget must be a positive amount'); return }
      values.budgetCents = cents
    }
    if (endDate && !startDate) { setError('Add a start date too'); return }
    if (startDate && endDate && endDate < startDate) { setError('End date must be on or after the start date'); return }
    if (startDate) values.startDate = startDate
    if (endDate) values.endDate = endDate

    setSaving(true)
    try {
      await onSave(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save space')
      setSaving(false)
    }
  }

  return (
    <ModalPortal onClose={onClose}>
      <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="space-modal-title">
          <div className="modal-header">
            <h2 id="space-modal-title" className="modal-title">{mode === 'create' ? 'New space' : 'Edit space'}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <form onSubmit={(e) => { void handleSubmit(e) }}>
            <div className="modal-body">
              {error && <div className="modal-error" role="alert">{error}</div>}

              <div className="form-group">
                <span className="form-label">Icon</span>
                <div className="sp-emoji-picker" role="radiogroup" aria-label="Space icon">
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="radio"
                      aria-checked={emoji === e}
                      className={`sp-emoji-option${emoji === e ? ' is-active' : ''}`}
                      onClick={() => setEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="space-name">Name</label>
                <input
                  id="space-name"
                  className="form-input"
                  placeholder="e.g. Japan ski trip"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  autoFocus={mode === 'create'}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="space-budget">
                  Budget (S$) <span className="form-label-hint">optional</span>
                </label>
                <input
                  id="space-budget"
                  type="number"
                  inputMode="decimal"
                  className="form-input"
                  placeholder="e.g. 2500"
                  min="0"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>

              <div className="sp-form-dates">
                <div className="form-group">
                  <label className="form-label" htmlFor="space-start">
                    Start <span className="form-label-hint">optional</span>
                  </label>
                  <input id="space-start" type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="space-end">
                    End <span className="form-label-hint">optional</span>
                  </label>
                  <input id="space-end" type="date" className="form-input" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <p className="sp-form-hint">With dates set, the Telegram bot will suggest this space for expenses you log during those dates.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-save" disabled={saving}>
                {saving ? 'Saving…' : mode === 'create' ? 'Create space' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  )
}
