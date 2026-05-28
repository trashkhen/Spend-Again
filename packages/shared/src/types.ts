import type { Category, SubCategory } from './categories.js'

export type { Category, SubCategory }

// ── API wire types (DTOs over HTTP) ──────────────────────────────────────────

/** Wire shape for a transaction over the API. amount is a decimal string. */
export type ApiTransaction = {
  id: string
  userId: string
  amount: string                       // decimal SGD, e.g. "10.50"
  item: string
  category: Category | string
  subCategory: SubCategory | string
  occurredOn: string                   // YYYY-MM-DD
  source: 'manual' | 'bot' | 'sms' | 'ocr'
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

