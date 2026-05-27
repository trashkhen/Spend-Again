/**
 * API client for @spend-again/api.
 * All requests attach the JWT from localStorage as Authorization: Bearer <token>.
 * Amounts arrive as decimal strings ("10.50") from the API — the UI displays them as-is.
 */

import { authHeader } from './auth'
import type { ApiTransaction, BudgetSettings, CustomCategory } from '@spend-again/shared'

export type { ApiTransaction, BudgetSettings, CustomCategory }

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

// ── Transaction endpoints ──────────────────────────────────────────────────────

export async function listTransactions(
  params: ListTransactionsParams = {},
): Promise<ApiTransaction[]> {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.month) qs.set('month', params.month)
  if (params.year) qs.set('year', params.year)
  if (params.userId) qs.set('userId', params.userId)

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
  category: string
  subCategory: string
  date: string  // DD/MM/YYYY
  source: 'manual'
}

export type UpdateTransactionPayload = {
  amountCents?: number
  item?: string
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
