import { eq, and, lte, sql } from 'drizzle-orm'
import { recurringPayments } from '@spend-again/db'
import type { RecurringPayment } from '@spend-again/db'
import { createLogger } from '@spend-again/shared'
import type { DbClient } from '../lib/db.js'
import type { TransactionService } from './transactions.js'

const log = createLogger('api:recurring')

export type CreateRecurringInput = {
  userId: string
  name: string
  amountCents: number
  category: string
  subCategory: string
  description?: string | undefined
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly'
  startDate: string // YYYY-MM-DD
}

export type UpdateRecurringInput = {
  name?: string | undefined
  amountCents?: number | undefined
  category?: string | undefined
  subCategory?: string | undefined
  description?: string | undefined
  frequency?: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly' | undefined
  isActive?: boolean | undefined
}

export function advanceByFrequency(dateStr: string, frequency: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1))

  switch (frequency) {
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7)
      break
    case 'fortnightly':
      date.setUTCDate(date.getUTCDate() + 14)
      break
    case 'monthly':
      advanceMonths(date, 1)
      break
    case 'quarterly':
      advanceMonths(date, 3)
      break
    case 'yearly':
      advanceMonths(date, 12)
      break
  }

  return date.toISOString().slice(0, 10)
}

/**
 * Advance a UTC Date by `months` calendar months, clamping to the last day of
 * the target month when the original day exceeds the target month's length.
 * e.g. Jan 31 + 1 month → Feb 28 (not Mar 3).
 */
function advanceMonths(date: Date, months: number): void {
  const originalDay = date.getUTCDate()
  const targetYear = date.getUTCFullYear() + Math.floor((date.getUTCMonth() + months) / 12)
  const targetMonth = (date.getUTCMonth() + months) % 12
  // Day 0 of the next month = last day of targetMonth
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  date.setUTCFullYear(targetYear, targetMonth, Math.min(originalDay, daysInTarget))
}

function isoToDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d ?? '01'}/${m ?? '01'}/${y ?? '2026'}`
}

export interface RecurringService {
  create(input: CreateRecurringInput): Promise<RecurringPayment>
  listByUser(userId: string): Promise<RecurringPayment[]>
  update(id: string, userId: string, input: UpdateRecurringInput): Promise<RecurringPayment | null>
  remove(id: string, userId: string): Promise<boolean>
  processOverdue(txService: TransactionService): Promise<void>
}

export function createRecurringService(db: DbClient): RecurringService {
  return {
    async create(input: CreateRecurringInput): Promise<RecurringPayment> {
      const rows = await db
        .insert(recurringPayments)
        .values({
          userId: input.userId,
          name: input.name,
          amountCents: input.amountCents,
          category: input.category,
          subCategory: input.subCategory,
          description: input.description ?? null,
          frequency: input.frequency,
          nextDueDate: input.startDate,
          isActive: 1,
        })
        .returning()

      const row = rows[0]
      if (!row) throw new Error('Insert returned no rows')
      return row
    },

    async listByUser(userId: string): Promise<RecurringPayment[]> {
      return db
        .select()
        .from(recurringPayments)
        .where(eq(recurringPayments.userId, userId))
        .orderBy(recurringPayments.nextDueDate)
    },

    async update(id: string, userId: string, input: UpdateRecurringInput): Promise<RecurringPayment | null> {
      const patch: Record<string, unknown> = {}
      if (input.name !== undefined) patch['name'] = input.name
      if (input.amountCents !== undefined) patch['amountCents'] = input.amountCents
      if (input.category !== undefined) patch['category'] = input.category
      if (input.subCategory !== undefined) patch['subCategory'] = input.subCategory
      if (input.description !== undefined) patch['description'] = input.description
      if (input.frequency !== undefined) patch['frequency'] = input.frequency
      if (input.isActive !== undefined) patch['isActive'] = input.isActive ? 1 : 0

      if (Object.keys(patch).length === 0) {
        const rows = await db
          .select()
          .from(recurringPayments)
          .where(and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)))
          .limit(1)
        return rows[0] ?? null
      }

      patch['updatedAt'] = sql`now()`

      const rows = await db
        .update(recurringPayments)
        .set(patch)
        .where(and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)))
        .returning()

      return rows[0] ?? null
    },

    async remove(id: string, userId: string): Promise<boolean> {
      const rows = await db
        .delete(recurringPayments)
        .where(and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)))
        .returning({ id: recurringPayments.id })
      return rows.length > 0
    },

    async processOverdue(txService: TransactionService): Promise<void> {
      const today = new Date().toISOString().slice(0, 10)

      const overdueRows = await db
        .select()
        .from(recurringPayments)
        .where(
          and(
            eq(recurringPayments.isActive, 1),
            lte(recurringPayments.nextDueDate, today),
          ),
        )

      for (const payment of overdueRows) {
        const nextDate = advanceByFrequency(today, payment.frequency)

        // Advance date FIRST — prevents duplicate on crash between the two writes.
        await db
          .update(recurringPayments)
          .set({ nextDueDate: nextDate, updatedAt: sql`now()` })
          .where(eq(recurringPayments.id, payment.id))

        if (payment.nextDueDate < today) {
          log.warn({ paymentId: payment.id, name: payment.name, missedFrom: payment.nextDueDate, today }, 'recurring payment was overdue; creating one transaction and skipping ahead')
        }

        await txService.create({
          userId: payment.userId,
          amountCents: payment.amountCents,
          item: payment.name,
          description: payment.description ?? undefined,
          category: payment.category,
          subCategory: payment.subCategory,
          date: isoToDDMMYYYY(today),
          source: 'recurring',
        })
      }
    },
  }
}
