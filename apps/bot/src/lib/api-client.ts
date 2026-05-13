import type { Category, SubCategory, Transaction } from '@spend-again/shared'

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

// ── Token store (keyed by Telegram user ID) ───────────────────────────────────

/**
 * In-memory JWT store. Maps Telegram user ID → JWT token.
 * Persistence is out of scope for this task — real auth is handled in Task 3.2.
 */
export const tokenStore = new Map<number, string>()

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
}

// ── Singleton instance ────────────────────────────────────────────────────────

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001'
export const apiClient = new ApiClient(API_URL)
