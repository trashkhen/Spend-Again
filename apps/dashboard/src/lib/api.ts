/**
 * API client for @spend-again/api.
 * All requests attach the JWT from localStorage as Authorization: Bearer <token>.
 * Amounts arrive as decimal strings ("10.50") from the API — the UI displays them as-is.
 */

import { authHeader } from './auth'
import type { ApiTransaction, BudgetSettings, CustomCategory, SpaceWithTotal, ApiSpace, PersonWithDebtSummary, DebtWithPerson } from '@spend-again/shared'

export type { ApiTransaction, BudgetSettings, CustomCategory, SpaceWithTotal, ApiSpace, PersonWithDebtSummary, DebtWithPerson }

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001'

// ── Response shapes ────────────────────────────────────────────────────────────

export type ApiError = {
  error: string
  code: string
  details?: unknown
}

export type ListTransactionsParams = {
  category?: string | undefined
  month?: string | undefined  // 2-digit, e.g. "05"
  year?: string | undefined   // 4-digit, e.g. "2026"
  userId?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as ApiError
      errorMessage = body.error ?? errorMessage
    } catch {
      // response body isn't JSON (e.g. HTML from a proxy or cold-start page)
    }
    throw new Error(errorMessage)
  }

  return response.json() as Promise<T>
}

// ── Analytics types ────────────────────────────────────────────────────────────

export type MonthlyAnalyticsItem = {
  month: string     // "MM"
  year: string      // "YYYY"
  label: string     // "Mar 2026"
  totalCents: number
  total: string     // decimal string, e.g. "1459.42"
  count: number
}

// ── Transaction endpoints ──────────────────────────────────────────────────────

export async function listTransactions(
  params: ListTransactionsParams = {},
): Promise<ApiTransaction[]> {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.month) qs.set('month', params.month)
  if (params.year) qs.set('year', params.year)
  if (params.userId) qs.set('userId', params.userId)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))

  const query = qs.toString()
  const path = `/api/transactions${query ? `?${query}` : ''}`
  return apiFetch<ApiTransaction[]>(path)
}

export async function getTransaction(id: string): Promise<ApiTransaction> {
  return apiFetch<ApiTransaction>(`/api/transactions/${id}`)
}

export type CreateTransactionPayload = {
  userId: string
  amountCents: number
  item: string
  description?: string
  category: string
  subCategory: string
  date: string  // DD/MM/YYYY
  source: 'manual'
}

export type UpdateTransactionPayload = {
  amountCents?: number
  item?: string
  description?: string
  category?: string
  subCategory?: string
  date?: string  // DD/MM/YYYY
  source?: 'manual'
}

export async function createTransaction(data: CreateTransactionPayload): Promise<ApiTransaction> {
  return apiFetch<ApiTransaction>('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTransaction(id: string, data: UpdateTransactionPayload): Promise<ApiTransaction> {
  return apiFetch<ApiTransaction>(`/api/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteTransaction(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' })
}

// ── Analytics endpoints ────────────────────────────────────────────────────────

export async function getMonthlyAnalytics(months = 6): Promise<MonthlyAnalyticsItem[]> {
  return apiFetch<MonthlyAnalyticsItem[]>(`/api/analytics/monthly?months=${months}`)
}

// ── Custom categories endpoints ────────────────────────────────────────────────

export async function listCustomCategories(): Promise<CustomCategory[]> {
  return apiFetch<CustomCategory[]>('/api/users/custom-categories')
}

export async function createCustomCategory(input: { category: string; subCategory: string }): Promise<CustomCategory> {
  return apiFetch<CustomCategory>('/api/users/custom-categories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteCustomCategory(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/users/custom-categories/${id}`, { method: 'DELETE' })
}

// ── Budget endpoints ───────────────────────────────────────────────────────────

export async function getBudget(): Promise<BudgetSettings> {
  return apiFetch<BudgetSettings>('/api/users/budget')
}

export async function updateBudget(data: BudgetSettings): Promise<BudgetSettings> {
  return apiFetch<BudgetSettings>('/api/users/budget', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ── Spaces ─────────────────────────────────────────────────────────────────────

export async function listSpaces(): Promise<SpaceWithTotal[]> {
  return apiFetch<SpaceWithTotal[]>('/api/spaces')
}

export async function createSpace(data: {
  name: string
  emoji?: string
  budgetCents?: number
  startDate?: string
  endDate?: string
}): Promise<ApiSpace> {
  return apiFetch<ApiSpace>('/api/spaces', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateSpace(
  id: string,
  data: Partial<{ name: string; emoji: string; budgetCents: number; startDate: string; endDate: string; status: string }>,
): Promise<ApiSpace> {
  return apiFetch<ApiSpace>(`/api/spaces/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function archiveSpace(id: string): Promise<void> {
  await apiFetch(`/api/spaces/${id}`, { method: 'DELETE' })
}

export type SpaceBreakdownItem = {
  category: string
  totalCents: number
  pct: number
}

export async function deactivateSpace(id: string): Promise<void> {
  await apiFetch(`/api/spaces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'archived' }),
  })
}

export async function reactivateSpace(id: string): Promise<void> {
  await apiFetch(`/api/spaces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'active' }),
  })
}

export async function permanentDeleteSpace(id: string): Promise<void> {
  await apiFetch(`/api/spaces/${id}/permanent`, { method: 'DELETE' })
}

export async function getSpaceTransactions(id: string): Promise<ApiTransaction[]> {
  return apiFetch<ApiTransaction[]>(`/api/spaces/${id}/transactions`)
}

export async function getSpaceBreakdown(id: string): Promise<SpaceBreakdownItem[]> {
  return apiFetch<SpaceBreakdownItem[]>(`/api/spaces/${id}/breakdown`)
}

export async function detachFromSpace(spaceId: string, transactionId: string): Promise<void> {
  await apiFetch(`/api/spaces/${spaceId}/transactions/${transactionId}`, { method: 'DELETE' })
}

export async function attachToSpace(spaceId: string, transactionId: string): Promise<void> {
  await apiFetch(`/api/spaces/${spaceId}/transactions`, {
    method: 'POST',
    body: JSON.stringify({ transactionId }),
  })
}

// ── IOUs ───────────────────────────────────────────────────────────────────────

export async function listPeople(): Promise<PersonWithDebtSummary[]> {
  return apiFetch<PersonWithDebtSummary[]>('/api/iou/people')
}

export async function listDebts(params?: { personId?: string; status?: string }): Promise<DebtWithPerson[]> {
  const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : ''
  return apiFetch<DebtWithPerson[]>(`/api/iou/debts${qs ? '?' + qs : ''}`)
}

export async function settleDebt(id: string): Promise<void> {
  await apiFetch(`/api/iou/debts/${id}/settle`, { method: 'POST' })
}

export async function createDebt(data: {
  personName: string
  direction: string
  amountCents: number
  description?: string
  occurredOn: string
}): Promise<{ debt: DebtWithPerson; person: PersonWithDebtSummary }> {
  return apiFetch('/api/iou/debts', { method: 'POST', body: JSON.stringify(data) })
}
