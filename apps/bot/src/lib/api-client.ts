import { createHmac, createHash } from 'node:crypto'
import { createLogger } from '@spend-again/shared'
import type { Category, SubCategory, Transaction } from '@spend-again/shared'

const log = createLogger('bot:api-client')

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

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Ensures a host-only API_URL value has an https:// scheme prefix. */
function normalizeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `https://${url}`
}

// ── Telegram login helper ─────────────────────────────────────────────────────

type TelegramUser = {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

/**
 * Authenticates a Telegram user against the API using the same HMAC-SHA256
 * hash the Telegram Login Widget produces. Populates tokenStore and userIdStore
 * on success.
 */
export async function loginViaTelegram(
  from: TelegramUser,
  apiUrl: string = process.env['API_URL'] ?? 'https://spend-againapi-production.up.railway.app',
): Promise<{ token: string; userId: string } | null> {
  apiUrl = normalizeUrl(apiUrl)
  const botToken = process.env['BOT_TOKEN'] ?? ''
  if (!botToken) return null

  const authDate = Math.floor(Date.now() / 1000)

  const fields: Record<string, string> = {
    id: String(from.id),
    auth_date: String(authDate),
  }
  if (from.first_name) fields['first_name'] = from.first_name
  if (from.last_name) fields['last_name'] = from.last_name
  if (from.username) fields['username'] = from.username

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')

  const secret = createHash('sha256').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  try {
    const body: Record<string, string | number> = {
      id: String(from.id),
      auth_date: authDate,
      hash,
    }
    if (from.first_name) body['first_name'] = from.first_name
    if (from.last_name) body['last_name'] = from.last_name
    if (from.username) body['username'] = from.username

    const res = await fetch(`${apiUrl}/api/auth/telegram-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      log.error(
        { status: res.status, body: (await res.text()).slice(0, 500) },
        'loginViaTelegram API login failed',
      )
      return null
    }

    const result = (await res.json()) as { token: string; userId: string }
    tokenStore.set(from.id, result.token)
    userIdStore.set(from.id, result.userId)
    return { token: result.token, userId: result.userId }
  } catch (err) {
    log.error({ err }, 'loginViaTelegram API login error')
    return null
  }
}

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
        log.error(
          { status: res.status, body: (await res.text()).slice(0, 500) },
          'createTransaction failed',
        )
        return null
      }

      const body = (await res.json()) as ApiTransactionResponse
      return { id: body.id }
    } catch (err) {
      log.error({ err }, 'createTransaction error')
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
        log.error(
          { status: res.status, body: (await res.text()).slice(0, 500) },
          'getRecentTransactions failed',
        )
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
      log.error({ err }, 'getRecentTransactions error')
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
      log.error({ err }, 'saveLearnedMapping error')
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
        log.error({ status: res.status }, 'getSpendingSummary failed')
        return null
      }
      return (await res.json()) as AnalyticsSummary
    } catch (err) {
      log.error({ err }, 'getSpendingSummary error')
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
        log.error({ status: res.status }, 'getTopExpense failed')
        return null
      }
      return (await res.json()) as TopExpense
    } catch (err) {
      log.error({ err }, 'getTopExpense error')
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
        log.error({ status: res.status }, 'getCategoryBreakdown failed')
        return null
      }
      return (await res.json()) as CategoryBreakdown
    } catch (err) {
      log.error({ err }, 'getCategoryBreakdown error')
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
        log.error({ status: res.status }, 'getBudget failed')
        return null
      }
      return (await res.json()) as BudgetData
    } catch (err) {
      log.error({ err }, 'getBudget error')
      return null
    }
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

const API_URL = normalizeUrl(process.env['API_URL'] ?? 'https://spend-againapi-production.up.railway.app')
export const apiClient = new ApiClient(API_URL)
