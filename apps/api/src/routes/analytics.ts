import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, sql, gte, lt } from 'drizzle-orm'
import { transactions } from '@spend-again/db'
import { CATEGORIES, monthRange } from '@spend-again/shared'
import { validateQuery } from '../middleware/validate.js'
import type { DbClient } from '../lib/db.js'

// ── Context variable types ─────────────────────────────────────────────────────

type AnalyticsVariables = {
  validatedQuery: unknown
  userId: string         // set by requireAuth middleware (applied in index.ts)
  telegramId: string | undefined
}

type AnalyticsEnv = {
  Variables: AnalyticsVariables
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const summaryQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{2}$/, 'month must be 2-digit, e.g. 05')
    .optional(),
  year: z
    .string()
    .regex(/^\d{4}$/, 'year must be 4-digit, e.g. 2026')
    .optional(),
})

const topExpenseQuerySchema = z.object({
  period: z.enum(['week', 'month']).optional().default('month'),
})

const categoryBreakdownQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{2}$/, 'month must be 2-digit, e.g. 05')
    .optional(),
  year: z
    .string()
    .regex(/^\d{4}$/, 'year must be 4-digit, e.g. 2026')
    .optional(),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCurrentMonthYear(): { month: string; year: string } {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const year = String(now.getFullYear())
  return { month, year }
}

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * Creates the /api/analytics router.
 * Exposes aggregation endpoints used by the bot's natural language query handler.
 */
export function createAnalyticsRouter(db: DbClient): Hono<AnalyticsEnv> {
  const router = new Hono<AnalyticsEnv>()

  /**
   * GET /api/analytics/summary
   * Returns total spend and transaction count for a given month/year.
   * Defaults to the current month.
   *
   * Query: userId (required), month (optional, MM), year (optional, YYYY)
   */
  router.get('/summary', validateQuery(summaryQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.get('validatedQuery') as z.infer<typeof summaryQuerySchema>
    const { month, year } = query.month !== undefined && query.year !== undefined
      ? { month: query.month, year: query.year }
      : getCurrentMonthYear()

    const { startIso, endIso } = monthRange(year, month)

    const conditions = [
      eq(transactions.userId, userId),
      gte(transactions.occurredOn, startIso),
      lt(transactions.occurredOn, endIso),
    ]

    const rows = await db
      .select({
        totalCents: sql<number>`COALESCE(SUM(${transactions.amountCents}), 0)`.as('totalCents'),
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(transactions)
      .where(and(...conditions))

    const row = rows[0]
    const totalCents = row?.totalCents ?? 0
    const count = row?.count ?? 0

    return c.json({
      month,
      year,
      totalCents: Number(totalCents),
      total: (Number(totalCents) / 100).toFixed(2),
      count: Number(count),
    })
  })

  /**
   * GET /api/analytics/top
   * Returns the single most expensive transaction in the given period.
   *
   * Query: userId (required), period ("week" | "month", default "month")
   */
  router.get('/top', validateQuery(topExpenseQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.get('validatedQuery') as z.infer<typeof topExpenseQuerySchema>
    const period = query.period ?? 'month'

    const userCondition = eq(transactions.userId, userId)

    if (period === 'month') {
      const { month, year } = getCurrentMonthYear()
      const { startIso, endIso } = monthRange(year, month)

      const rows = await db
        .select()
        .from(transactions)
        .where(and(
          userCondition,
          gte(transactions.occurredOn, startIso),
          lt(transactions.occurredOn, endIso),
        ))
        .orderBy(sql`${transactions.amountCents} DESC`)
        .limit(1)

      const tx = rows[0]
      if (!tx) {
        return c.json({ transaction: null, period })
      }
      return c.json({
        period,
        transaction: {
          ...tx,
          amount: (tx.amountCents / 100).toFixed(2),
        },
      })
    }

    // period === 'week' — use occurred_on date column
    const today = new Date()
    const day = today.getUTCDay()
    const startOfWeek = new Date(today)
    startOfWeek.setUTCDate(today.getUTCDate() - day)
    const startIso = startOfWeek.toISOString().slice(0, 10)

    const rows = await db
      .select()
      .from(transactions)
      .where(and(
        userCondition,
        gte(transactions.occurredOn, startIso),
      ))
      .orderBy(sql`${transactions.amountCents} DESC`)
      .limit(1)

    const tx = rows[0]
    if (!tx) {
      return c.json({ transaction: null, period })
    }
    return c.json({
      period,
      transaction: {
        ...tx,
        amount: (tx.amountCents / 100).toFixed(2),
      },
    })
  })

  /**
   * GET /api/analytics/breakdown
   * Returns a per-category spending summary for the given month/year.
   *
   * Query: userId (required), month (optional, MM), year (optional, YYYY)
   */
  router.get('/breakdown', validateQuery(categoryBreakdownQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.get('validatedQuery') as z.infer<typeof categoryBreakdownQuerySchema>
    const { month, year } = query.month !== undefined && query.year !== undefined
      ? { month: query.month, year: query.year }
      : getCurrentMonthYear()

    const { startIso, endIso } = monthRange(year, month)

    const conditions = [
      eq(transactions.userId, userId),
      gte(transactions.occurredOn, startIso),
      lt(transactions.occurredOn, endIso),
    ]

    const rows = await db
      .select({
        category: transactions.category,
        totalCents: sql<number>`SUM(${transactions.amountCents})`.as('totalCents'),
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(transactions.category)
      .orderBy(sql`SUM(${transactions.amountCents}) DESC`)

    // Ensure every known category appears in the response (with 0 for missing ones)
    const rowMap = new Map(rows.map((r) => [r.category, r]))

    const breakdown = CATEGORIES.map((cat) => {
      const r = rowMap.get(cat)
      const totalCents = r !== undefined ? Number(r.totalCents) : 0
      const count = r !== undefined ? Number(r.count) : 0
      return {
        category: cat,
        totalCents,
        total: (totalCents / 100).toFixed(2),
        count,
      }
    }).filter((item) => item.totalCents > 0)

    const grandTotalCents = breakdown.reduce((acc, b) => acc + b.totalCents, 0)

    return c.json({
      month,
      year,
      breakdown,
      grandTotalCents,
      grandTotal: (grandTotalCents / 100).toFixed(2),
    })
  })

  return router
}
