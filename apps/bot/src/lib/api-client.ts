import { createHmac, createHash } from 'node:crypto'
import { createLogger, requireEnv } from '@spend-again/shared'
import type { ApiTransaction, Category, SubCategory, ApiRecurring, ApiSpace, SpaceWithTotal, ApiDebt, ApiPerson, DebtWithPerson } from '@spend-again/shared'
import { BOT_TOKEN } from './env.js'

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
    occurredOn: string  // YYYY-MM-DD
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

// ── Recurring types ────────────────────────────────────────────────────────────

export type CreateRecurringPayload = {
  name: string
  amountCents: number
  category: string
  subCategory: string
  description?: string
  frequency: string
  startDate: string // YYYY-MM-DD
}

// ── Space types ────────────────────────────────────────────────────────────────

export type CreateSpacePayload = {
  name: string
  emoji?: string
  budgetCents?: number
  startDate?: string  // YYYY-MM-DD
  endDate?: string    // YYYY-MM-DD
}

// ── Debt types ────────────────────────────────────────────────────────────────

export type CreateDebtPayload = {
  personName: string
  direction: 'they_owe_me' | 'i_owe_them'
  amountCents: number
  description?: string
  linkedSpaceId?: string
  occurredOn: string  // YYYY-MM-DD
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type CreateTransactionInput = {
  userId: string
  amountCents: number
  item: string
  description?: string
  category: Category
  subCategory: SubCategory
  date: string // DD/MM/YYYY
  source: 'bot'
  tier?: 1 | 2 | 3
  confidence?: number
}

export type UpdateTransactionInput = {
  amountCents?: number
  item?: string
  description?: string
  category?: string
  subCategory?: string
  date?: string // DD/MM/YYYY
  source?: 'bot' | 'manual'
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
  apiUrl?: string,
): Promise<{ token: string; userId: string } | null> {
  // Resolve API_URL lazily so tests that don't exercise this codepath don't
  // need it set, while production callers still hard-fail at first use.
  const resolved = normalizeUrl(apiUrl ?? requireEnv('API_URL'))
  apiUrl = resolved

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

  const secret = createHash('sha256').update(BOT_TOKEN).digest()
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
          description: data.description,
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

      const body = (await res.json()) as ApiTransaction
      return { id: body.id }
    } catch (err) {
      log.error({ err }, 'createTransaction error')
      return null
    }
  }

  /**
   * PUT /api/transactions/:txId
   * Updates a transaction. Returns the updated transaction id, or null on failure.
   */
  async updateTransaction(txId: string, input: UpdateTransactionInput): Promise<{ id: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/transactions/${txId}`, {
        method: 'PUT',
        headers: this.buildHeaders(),
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        log.error({ status: res.status, body: (await res.text()).slice(0, 500) }, 'updateTransaction failed')
        return null
      }
      const body = (await res.json()) as ApiTransaction
      return { id: body.id }
    } catch (err) {
      log.error({ err }, 'updateTransaction error')
      return null
    }
  }

  /**
   * GET /api/transactions?userId=<userId>&limit=<limit>
   * Returns an array of transactions, or an empty array on failure.
   */
  async getRecentTransactions(userId: string, limit = 10): Promise<ApiTransaction[]> {
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

      return (await res.json()) as ApiTransaction[]
    } catch (err) {
      log.error({ err }, 'getRecentTransactions error')
      return []
    }
  }

  /**
   * GET /api/transactions?userId=<userId>
   * Returns all transactions for the user (no date filter), or empty array on failure.
   */
  async getAllTransactions(userId: string): Promise<ApiTransaction[]> {
    // Capped at 500 to match the API's new max page size. If callers need more,
    // they should paginate. The previous 10000 was silently truncated server-side.
    return this.getRecentTransactions(userId, 500)
  }

  /**
   * GET /api/learned-mappings/:itemName
   * Looks up a learned item → category mapping. Returns null if not found.
   */
  async getLearnedMapping(
    itemName: string,
  ): Promise<{ category: Category; subCategory: SubCategory; confidence: number } | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/learned-mappings/${encodeURIComponent(itemName.toLowerCase())}`,
        { headers: this.buildHeaders() },
      )
      if (res.status === 404) return null
      if (!res.ok) {
        log.error({ status: res.status }, 'getLearnedMapping failed')
        return null
      }
      return (await res.json()) as { category: Category; subCategory: SubCategory; confidence: number }
    } catch (err) {
      log.error({ err }, 'getLearnedMapping error')
      return null
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

  async listRecurring(): Promise<ApiRecurring[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/recurring`, { headers: this.buildHeaders() })
      if (!res.ok) { log.error({ status: res.status }, 'listRecurring failed'); return [] }
      return (await res.json()) as ApiRecurring[]
    } catch (err) {
      log.error({ err }, 'listRecurring error')
      return []
    }
  }

  async createRecurring(data: CreateRecurringPayload): Promise<ApiRecurring | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/recurring`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(data),
      })
      if (!res.ok) { log.error({ status: res.status }, 'createRecurring failed'); return null }
      return (await res.json()) as ApiRecurring
    } catch (err) {
      log.error({ err }, 'createRecurring error')
      return null
    }
  }

  async updateRecurring(id: string, data: { isActive?: boolean; frequency?: string; name?: string; amountCents?: number }): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/recurring/${id}`, {
        method: 'PUT',
        headers: this.buildHeaders(),
        body: JSON.stringify(data),
      })
      if (!res.ok) { log.error({ status: res.status }, 'updateRecurring failed') }
    } catch (err) {
      log.error({ err }, 'updateRecurring error')
    }
  }

  async deleteRecurring(id: string): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/recurring/${id}`, {
        method: 'DELETE',
        headers: this.buildHeaders(),
      })
      if (!res.ok) { log.error({ status: res.status }, 'deleteRecurring failed') }
    } catch (err) {
      log.error({ err }, 'deleteRecurring error')
    }
  }

  async listSpaces(): Promise<SpaceWithTotal[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/spaces`, { headers: this.buildHeaders() })
      if (!res.ok) { log.error({ status: res.status }, 'listSpaces failed'); return [] }
      return (await res.json()) as SpaceWithTotal[]
    } catch (err) { log.error({ err }, 'listSpaces error'); return [] }
  }

  async getActiveSpace(): Promise<ApiSpace | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/spaces/active`, { headers: this.buildHeaders() })
      if (!res.ok) return null
      return (await res.json()) as ApiSpace | null
    } catch (err) { log.error({ err }, 'getActiveSpace error'); return null }
  }

  async setActiveSpace(spaceId: string | null): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/spaces/active`, {
        method: 'PUT', headers: this.buildHeaders(),
        body: JSON.stringify({ spaceId }),
      })
      return res.ok
    } catch (err) { log.error({ err }, 'setActiveSpace error'); return false }
  }

  async createSpace(data: CreateSpacePayload): Promise<ApiSpace | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/spaces`, {
        method: 'POST', headers: this.buildHeaders(), body: JSON.stringify(data),
      })
      if (!res.ok) return null
      return (await res.json()) as ApiSpace
    } catch (err) { log.error({ err }, 'createSpace error'); return null }
  }

  async attachTransactionToSpace(transactionId: string, spaceId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/spaces/${spaceId}/transactions`, {
        method: 'POST', headers: this.buildHeaders(),
        body: JSON.stringify({ transactionId }),
      })
      return res.ok
    } catch (err) { log.error({ err }, 'attachTransactionToSpace error'); return false }
  }

  async findSpacesForDate(isoDate: string): Promise<ApiSpace[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/spaces/window?date=${encodeURIComponent(isoDate)}`, { headers: this.buildHeaders() })
      if (!res.ok) return []
      return (await res.json()) as ApiSpace[]
    } catch (err) { log.error({ err }, 'findSpacesForDate error'); return [] }
  }

  async listPeople(): Promise<ApiPerson[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/iou/people`, { headers: this.buildHeaders() })
      if (!res.ok) return []
      return (await res.json()) as ApiPerson[]
    } catch (err) { log.error({ err }, 'listPeople error'); return [] }
  }

  async listOpenDebts(personName?: string): Promise<DebtWithPerson[]> {
    try {
      const url = new URL(`${this.baseUrl}/api/iou/debts`)
      url.searchParams.set('status', 'open')
      const res = await fetch(url.toString(), { headers: this.buildHeaders() })
      if (!res.ok) return []
      const all = (await res.json()) as DebtWithPerson[]
      if (personName) {
        const lower = personName.toLowerCase()
        return all.filter(d => d.person.name.toLowerCase() === lower)
      }
      return all
    } catch (err) { log.error({ err }, 'listOpenDebts error'); return [] }
  }

  async createDebt(data: CreateDebtPayload): Promise<{ debt: ApiDebt; person: ApiPerson } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/iou/debts`, {
        method: 'POST', headers: this.buildHeaders(), body: JSON.stringify(data),
      })
      if (!res.ok) return null
      return (await res.json()) as { debt: ApiDebt; person: ApiPerson }
    } catch (err) { log.error({ err }, 'createDebt error'); return null }
  }

  async settleDebt(debtId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/iou/debts/${debtId}/settle`, {
        method: 'POST', headers: this.buildHeaders(), body: '{}',
      })
      return res.ok
    } catch (err) { log.error({ err }, 'settleDebt error'); return false }
  }

  async addDebtPayment(debtId: string, amountCents: number, paidOn: string, note?: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/iou/debts/${debtId}/payments`, {
        method: 'POST', headers: this.buildHeaders(),
        body: JSON.stringify({ amountCents, paidOn, note }),
      })
      return res.ok
    } catch (err) { log.error({ err }, 'addDebtPayment error'); return false }
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────
//
// This Proxy exists to defer `requireEnv('API_URL')` until the first method
// call on `apiClient`. Without it, importing this module would throw at load
// time, which breaks unit tests that exercise unrelated exports (e.g.
// `loginViaTelegram`, `tokenStore`) without configuring `API_URL`. Production
// code still hard-fails the moment it makes its first API request.
//
// Constraints (intentional, documented tech-debt):
//   - Methods are forwarded and bound to the underlying ApiClient instance,
//     so `apiClient.someMethod(...)` works as expected.
//   - Direct property assignment (e.g. `apiClient.foo = bar`) is NOT supported
//     — the Proxy only implements `get`. Such writes are silently dropped
//     onto the empty target object.
//   - `instanceof ApiClient` against the Proxy is NOT supported. Use the
//     underlying instance if you need that.
// no property assignments

function buildApiClient(): ApiClient {
  return new ApiClient(normalizeUrl(requireEnv('API_URL')))
}

let _apiClient: ApiClient | undefined
export const apiClient: ApiClient = new Proxy({} as ApiClient, {
  get(_target, prop, receiver) {
    if (_apiClient === undefined) _apiClient = buildApiClient()
    const value = Reflect.get(_apiClient, prop, receiver)
    return typeof value === 'function' ? value.bind(_apiClient) : value
  },
})
