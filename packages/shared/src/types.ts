import type { Category, SubCategory } from './categories.js'

export type { Category, SubCategory }

// ── API wire types (DTOs over HTTP) ──────────────────────────────────────────

/**
 * Wire shape for a transaction over the API.
 *
 * Carries BOTH `amountCents` (integer, source of truth for arithmetic) and
 * `amount` (decimal string, ready for display). Consumers that need to do
 * math should use `amountCents` directly — never parseFloat(amount).
 */
export type ApiTransaction = {
  id: string
  userId: string
  amountCents: number                  // integer cents, source of truth
  amount: string                       // decimal SGD for display, e.g. "10.50"
  item: string
  description?: string | null
  category: Category | string
  subCategory: SubCategory | string
  occurredOn: string                   // YYYY-MM-DD
  source: 'manual' | 'bot' | 'sms' | 'ocr' | 'recurring'
  tier?: 1 | 2 | 3
  confidence?: string
  createdAt: string
  updatedAt: string
}

export type CreateTransactionRequest = {
  amountCents: number
  item: string
  category: string
  subCategory: string
  date: string
  source: 'manual' | 'bot' | 'sms' | 'ocr'
  tier?: 1 | 2 | 3
  confidence?: number
}

export type UpdateTransactionRequest = Partial<Omit<CreateTransactionRequest, 'source'>> & {
  source?: 'manual' | 'bot' | 'sms' | 'ocr'
}

export type ApiUser = {
  id: string
  email?: string | null
  telegramId?: string | null
  telegramUsername?: string | null
  monthlyBudget?: number | null
  budgetAlertPct?: number
  createdAt: string
}

export type BudgetSettings = {
  monthlyBudget: number | null
  budgetAlertPct: number
}

export type CustomCategory = {
  id: string
  category: string
  subCategory: string
  createdAt: string
}

export type LearnedMapping = {
  itemName: string
  category: Category
  subCategory: SubCategory
  confidence: number
  source: 'regex' | 'gemini' | 'user'
  usageCount: number
}

export type RecurringFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly'

export type ApiRecurring = {
  id: string
  userId: string
  name: string
  amountCents: number
  amount: string          // decimal string e.g. "18.98"
  category: string
  subCategory: string
  description?: string | null
  frequency: RecurringFrequency
  nextDueDate: string     // YYYY-MM-DD
  isActive: number        // 1 = active, 0 = paused
  createdAt: string
  updatedAt: string
}

