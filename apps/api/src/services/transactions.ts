import { eq, and, like, sql } from 'drizzle-orm'
import { transactions } from '@spend-again/db'
import type { Transaction } from '@spend-again/db'
import type { DbClient } from '../lib/db.js'

// ── Input types (exported for use in routes and tests) ─────────────────────────

export type CreateTransactionInput = {
  userId: string
  amountCents: number
  item: string
  category: string
  subCategory: string
  date: string // DD/MM/YYYY
  source: 'manual' | 'bot' | 'sms' | 'ocr'
  tier?: 1 | 2 | 3
  confidence?: number
}

export type UpdateTransactionInput = {
  amountCents?: number
  item?: string
  category?: string
  subCategory?: string
  date?: string
  source?: 'manual' | 'bot' | 'sms' | 'ocr'
  tier?: 1 | 2 | 3
  confidence?: number
}

export type ListTransactionsQuery = {
  userId?: string
  category?: string
  month?: string
  year?: string
}

export type TransactionRow = Transaction

export interface TransactionService {
  create(input: CreateTransactionInput): Promise<TransactionRow>
  list(query: ListTransactionsQuery): Promise<TransactionRow[]>
  findById(id: string, userId: string): Promise<TransactionRow | null>
  update(id: string, userId: string, input: UpdateTransactionInput): Promise<TransactionRow | null>
  remove(id: string, userId: string): Promise<boolean>
}

// ── Service factory ────────────────────────────────────────────────────────────

export function createTransactionService(db: DbClient): TransactionService {
  return {
    async create(input: CreateTransactionInput): Promise<TransactionRow> {
      const rows = await db
        .insert(transactions)
        .values({
          userId: input.userId,
          amountCents: input.amountCents,
          item: input.item,
          category: input.category,
          subCategory: input.subCategory,
          date: input.date,
          source: input.source,
          tier: input.tier ?? null,
          confidence: input.confidence !== undefined ? String(input.confidence) : null,
        })
        .returning()

      const row = rows[0]
      if (!row) throw new Error('Insert returned no rows')
      return row
    },

    async list(query: ListTransactionsQuery): Promise<TransactionRow[]> {
      const conditions = []

      if (query.userId) {
        conditions.push(eq(transactions.userId, query.userId))
      }

      if (query.category) {
        conditions.push(eq(transactions.category, query.category))
      }

      // Date column is stored as "DD/MM/YYYY" text.
      // Build LIKE patterns to filter by month/year.
      if (query.month && query.year) {
        conditions.push(like(transactions.date, `__/${query.month}/${query.year}`))
      } else if (query.month) {
        conditions.push(like(transactions.date, `__/${query.month}/____`))
      } else if (query.year) {
        conditions.push(like(transactions.date, `__/__/${query.year}`))
      }

      const rows =
        conditions.length > 0
          ? await db
              .select()
              .from(transactions)
              .where(and(...conditions))
          : await db.select().from(transactions)

      return rows
    },

    async findById(id: string, userId: string): Promise<TransactionRow | null> {
      const rows = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
        .limit(1)

      return rows[0] ?? null
    },

    async update(
      id: string,
      userId: string,
      input: UpdateTransactionInput,
    ): Promise<TransactionRow | null> {
      const patch: Record<string, unknown> = {}

      if (input.amountCents !== undefined) patch['amountCents'] = input.amountCents
      if (input.item !== undefined) patch['item'] = input.item
      if (input.category !== undefined) patch['category'] = input.category
      if (input.subCategory !== undefined) patch['subCategory'] = input.subCategory
      if (input.date !== undefined) patch['date'] = input.date
      if (input.source !== undefined) patch['source'] = input.source
      if (input.tier !== undefined) patch['tier'] = input.tier
      if (input.confidence !== undefined) patch['confidence'] = String(input.confidence)

      if (Object.keys(patch).length === 0) {
        return this.findById(id, userId)
      }

      patch['updatedAt'] = sql`now()`

      const rows = await db
        .update(transactions)
        .set(patch)
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
        .returning()

      return rows[0] ?? null
    },

    async remove(id: string, userId: string): Promise<boolean> {
      const rows = await db
        .delete(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
        .returning({ id: transactions.id })

      return rows.length > 0
    },
  }
}
