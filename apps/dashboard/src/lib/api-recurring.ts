import { authHeader } from './auth'
import type { ApiRecurring, RecurringFrequency } from '@spend-again/shared'

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001'

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
    let msg = `HTTP ${response.status}`
    try { msg = ((await response.json()) as { error: string }).error ?? msg } catch { /* */ }
    throw new Error(msg)
  }
  return response.json() as Promise<T>
}

export type CreateRecurringPayload = {
  name: string
  amountCents: number
  category: string
  subCategory: string
  description?: string
  frequency: RecurringFrequency
  startDate: string // YYYY-MM-DD
}

export type UpdateRecurringPayload = {
  name?: string
  amountCents?: number
  category?: string
  subCategory?: string
  description?: string
  frequency?: RecurringFrequency
  isActive?: boolean
}

export async function listRecurring(): Promise<ApiRecurring[]> {
  return apiFetch<ApiRecurring[]>('/api/recurring')
}

export async function createRecurring(data: CreateRecurringPayload): Promise<ApiRecurring> {
  return apiFetch<ApiRecurring>('/api/recurring', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateRecurring(id: string, data: UpdateRecurringPayload): Promise<ApiRecurring> {
  return apiFetch<ApiRecurring>(`/api/recurring/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteRecurring(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/recurring/${id}`, { method: 'DELETE' })
}
