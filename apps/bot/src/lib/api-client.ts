import type { Category, SubCategory, Transaction } from '@spend-again/shared'

// ── Analytics response types ───────────────────────────────────────────────────

export type AnalyticsSummary = {
  month: string
  year: string
  totalCents: number
  total: string // e.g. "150.00"
  count: number
}

export type TopExpense = {
  period: 'week' | 'month'
  transaction: {
    id: string
    userId: string
    amountCents: number
    amount: string
    item: string
    category: string
    subCategory: string
    date: string
    source: string
  } | null
}

export type CategoryBreakdownItem = {
  category: string
  totalCents: number
  total: string
  count: number
}

export type CategoryBreakdown = {
  month: string
  year: string
  breakdown: CategoryBreakdownItem[]
  grandTotalCents: number
  grandTotal: string
}

export type BudgetData = {
  monthlyBudget: number | null // budget in cents (e.g. 100000 = S$1000)
  budgetAlertPct: number // alert threshold percentage (e.g. 80)
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type CreateTransactionInput = {
  userId: string
  amountCents: number
  item: string
  category: Category
  subCategory: SubCategory
  date: string // DD/MM/YYYY
  source: 'bot'
  tier?: 1 | 2 | 3
  confidence?: number
}

type ApiTransactionResponse = {
  id: string
  userId: string
  amount: string // decimal string from API, e.g. "10.50"
  item: string
  category: Category
  subCategory: SubCategory
  date: string
  source: string
  createdAt: string
  updatedAt: string
}

// ── Token + userId stores (keyed by Telegram user ID) ─────────────────────────

/** In-memory JWT store. Maps Telegram user ID → JWT token. */
export const tokenStore = new Map<number, string>()

/** In-memory user ID store. Maps Telegram user ID → database UUID (from /api/auth/telegram-login). */
export const userIdStore = new Map<number, string>()

// ── ApiClient ─────────────────────────────────────────────────────────────────

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private token?: string,
  ) {}

  setToken(token: string): void {
    this.token = token
  }

  getToken(): string | undefined {
    return this.token
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token !== undefined) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    return headers
  }

  /**
   * POST /api/transactions
   * Returns the created transaction id, or null on failure.
   */
  async createTransaction(data: CreateTransactionInput): Promise<{ id: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/transactions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          userId: data.userId,
          amountCents: data.amountCents,
          item: data.item,
          category: data.category,
          subCategory: data.subCategory,
          date: data.date,
          source: data.source,
          tier: data.tier,
          confidence: data.confidence,
        }),
      })

      if (!res.ok) {
        console.error('[ApiClient] createTransaction failed:', res.status, await res.text())
        return null
      }

      const body = (await res.json()) as ApiTransactionResponse
      return { id: body.id }
    } catch (err) {
      console.error('[ApiClient] createTransaction error:', err)
      return null
    }
  }

  /**
   * GET /api/transactions?userId=<userId>&limit=<limit>
   * Returns an array of transactions, or an empty array on failure.
   */
  async getRecentTransactions(userId: string, limit = 10): Promise<Transaction[]> {
    try {
      const url = new URL(`${this.baseUrl}/api/transactions`)
      url.searchParams.set('userId', userId)
      url.searchParams.set('limit', String(limit))

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: this.buildHeaders(),
      })

      if (!res.ok) {
        console.error('[ApiClient] getRecentTransactions failed:', res.status, await res.text())
        return []
      }

      const body = (await res.json()) as ApiTransactionResponse[]
      // Map the decimal "amount" string back to integer cents for the shared Transaction type
      return body.map((tx) => ({
        id: tx.id,
        userId: tx.userId,
        amount: Math.round(parseFloat(tx.amount) * 100),
        item: tx.item,
        category: tx.category,
        subCategory: tx.subCategory,
        date: tx.date,
        source: tx.source as Transaction['source'],
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
      }))
    } catch (err) {
      console.error('[ApiClient] getRecentTransactions error:', err)
      return []
    }
  }

  /**
   * GET /api/transactions?userId=<userId>
   * Returns all transactions for the user (no date filter), or empty array on failure.
   */
  async getAllTransactions(userId: string): Promise<Transaction[]> {
    return this.getRecentTransactions(userId, 10000)
  }

  /**
   * POST /api/learned-mappings
   * Saves a learned item → category mapping for future lookups.
   */
  async saveLearnedMapping(
    itemName: string,
    category: Category,
    subCategory: SubCategory,
  ): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/learned-mappings`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          itemName,
          category,
          subCategory,
          source: 'user',
        }),
      })
      return res.ok
    } catch (err) {
      console.error('[ApiClient] saveLearnedMapping error:', err)
      return false
    }
  }

  /**
   * GET /api/analytics/summary
   * Returns total spend and count for the given month/year (defaults to current month).
   */
  async getSpendingSummary(
    userId: string,
    month?: string,
    year?: string,
  ): Promise<AnalyticsSummary | null> {
    try {
      const url = new URL(`${this.baseUrl}/api/analytics/summary`)
      url.searchParams.set('userId', userId)
      if (month !== undefined) url.searchParams.set('month', month)
      if (year !== undefined) url.searchParams.set('year', year)

      const res = await fetch(url.toString(), { method: 'GET', headers: this.buildHeaders() })
      if (!res.ok) {
        console.error('[ApiClient] getSpendingSummary failed:', res.status)
        return null
      }
      return (await res.json()) as AnalyticsSummary
    } catch (err) {
      console.error('[ApiClient] getSpendingSummary error:', err)
      return null
    }
  }

  /**
   * GET /api/analytics/top
   * Returns the biggest single transaction for the given period.
   */
  async getTopExpense(userId: string, period: 'week' | 'month' = 'month'): Promise<TopExpense | null> {
    try {
      const url = new URL(`${this.baseUrl}/api/analytics/top`)
      url.searchParams.set('userId', userId)
      url.searchParams.set('period', period)

      const res = await fetch(url.toString(), { method: 'GET', headers: this.buildHeaders() })
      if (!res.ok) {
        console.error('[ApiClient] getTopExpense failed:', res.status)
        return null
      }
      return (await res.json()) as TopExpense
    } catch (err) {
      console.error('[ApiClient] getTopExpense error:', err)
      return null
    }
  }

  /**
   * GET /api/analytics/breakdown
   * Returns per-category spending summary for the given month/year.
   */
  async getCategoryBreakdown(
    userId: string,
    month?: string,
    year?: string,
  ): Promise<CategoryBreakdown | null> {
    try {
      const url = new URL(`${this.baseUrl}/api/analytics/breakdown`)
      url.searchParams.set('userId', userId)
      if (month !== undefined) url.searchParams.set('month', month)
      if (year !== undefined) url.searchParams.set('year', year)

      const res = await fetch(url.toString(), { method: 'GET', headers: this.buildHeaders() })
      if (!res.ok) {
        console.error('[ApiClient] getCategoryBreakdown failed:', res.status)
        return null
      }
      return (await res.json()) as CategoryBreakdown
    } catch (err) {
      console.error('[ApiClient] getCategoryBreakdown error:', err)
      return null
    }
  }

  /**
   * GET /api/users/budget
   * Returns the user's budget settings (authenticated endpoint).
   */
  async getBudget(): Promise<BudgetData | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/users/budget`, {
        method: 'GET',
        headers: this.buildHeaders(),
      })
      if (!res.ok) {
        console.error('[ApiClient] getBudget failed:', res.status)
        return null
      }
      return (await res.json()) as BudgetData
    } catch (err) {
      console.error('[ApiClient] getBudget error:', err)
      return null
    }
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001'
export const apiClient = new ApiClient(API_URL)
