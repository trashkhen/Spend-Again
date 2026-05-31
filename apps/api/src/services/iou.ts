import { eq, and, sql } from 'drizzle-orm'
import { people, debts, debtPayments } from '@spend-again/db'
import type { Person, Debt } from '@spend-again/db'
import { centsToDecimalString } from '@spend-again/shared'
import type { ApiPerson, ApiDebt, DebtWithPerson, DebtDirection, DebtStatus, PersonWithDebtSummary } from '@spend-again/shared'
import type { DbClient } from '../lib/db.js'

export type CreateDebtInput = {
  userId: string
  personId: string
  direction: DebtDirection
  amountCents: number
  description?: string | undefined
  linkedTransactionId?: string | undefined
  linkedSpaceId?: string | undefined
  occurredOn: string // YYYY-MM-DD
}

function toPerson(p: Person): ApiPerson {
  return {
    id: p.id, userId: p.userId, name: p.name,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  }
}

function toDebt(d: Debt, person?: Person): ApiDebt & { person?: ApiPerson } {
  return {
    id: d.id, userId: d.userId, personId: d.personId,
    direction: d.direction as DebtDirection,
    originalAmountCents: d.originalAmountCents,
    originalAmount: centsToDecimalString(d.originalAmountCents),
    remainingAmountCents: d.remainingAmountCents,
    remainingAmount: centsToDecimalString(d.remainingAmountCents),
    description: d.description ?? null,
    linkedTransactionId: d.linkedTransactionId ?? null,
    linkedSpaceId: d.linkedSpaceId ?? null,
    status: d.status as DebtStatus,
    occurredOn: d.occurredOn,
    settledAt: d.settledAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    ...(person ? { person: toPerson(person) } : {}),
  }
}

export interface IouService {
  findOrCreatePerson(userId: string, name: string): Promise<ApiPerson>
  listPeople(userId: string): Promise<PersonWithDebtSummary[]>
  createDebt(input: CreateDebtInput): Promise<ApiDebt>
  listDebts(userId: string, opts?: { personId?: string; status?: DebtStatus }): Promise<DebtWithPerson[]>
  findDebt(id: string, userId: string): Promise<DebtWithPerson | null>
  addPayment(debtId: string, userId: string, amountCents: number, paidOn: string, note?: string): Promise<ApiDebt | null>
  settle(debtId: string, userId: string): Promise<ApiDebt | null>
}

export function createIouService(db: DbClient): IouService {
  return {
    async findOrCreatePerson(userId, name) {
      const rows = await db
        .insert(people)
        .values({ userId, name })
        .onConflictDoUpdate({
          target: [people.userId, people.name],
          set: { updatedAt: new Date() },
        })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('Insert returned no rows')
      return toPerson(row)
    },

    async listPeople(userId) {
      const rows = await db
        .select({
          person: people,
          theyOweMeCents: sql<number>`coalesce(sum(case when ${debts.direction} = 'they_owe_me' and ${debts.status} != 'settled' then ${debts.remainingAmountCents} else 0 end), 0)`,
          iOweThemCents: sql<number>`coalesce(sum(case when ${debts.direction} = 'i_owe_them' and ${debts.status} != 'settled' then ${debts.remainingAmountCents} else 0 end), 0)`,
          openDebtCount: sql<number>`count(case when ${debts.status} != 'settled' then 1 end)`,
        })
        .from(people)
        .leftJoin(debts, and(eq(debts.personId, people.id), eq(debts.userId, userId)))
        .where(eq(people.userId, userId))
        .groupBy(people.id)

      return rows.map(({ person, theyOweMeCents, iOweThemCents, openDebtCount }) => ({
        ...toPerson(person),
        theyOweMeCents: Number(theyOweMeCents),
        iOweThemCents: Number(iOweThemCents),
        theyOweMe: centsToDecimalString(Number(theyOweMeCents)),
        iOweThem: centsToDecimalString(Number(iOweThemCents)),
        openDebtCount: Number(openDebtCount),
      }))
    },

    async createDebt(input) {
      const rows = await db
        .insert(debts)
        .values({
          userId: input.userId,
          personId: input.personId,
          direction: input.direction,
          originalAmountCents: input.amountCents,
          remainingAmountCents: input.amountCents,
          description: input.description,
          linkedTransactionId: input.linkedTransactionId,
          linkedSpaceId: input.linkedSpaceId,
          occurredOn: input.occurredOn,
        })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('Insert returned no rows')
      return toDebt(row) as ApiDebt
    },

    async listDebts(userId, opts) {
      const conditions = [eq(debts.userId, userId)]
      if (opts?.personId) conditions.push(eq(debts.personId, opts.personId))
      if (opts?.status) conditions.push(eq(debts.status, opts.status))

      const rows = await db
        .select({ debt: debts, person: people })
        .from(debts)
        .innerJoin(people, eq(debts.personId, people.id))
        .where(and(...conditions))
        .orderBy(debts.occurredOn)

      return rows.map(({ debt, person }) => toDebt(debt, person) as DebtWithPerson)
    },

    async findDebt(id, userId) {
      const rows = await db
        .select({ debt: debts, person: people })
        .from(debts)
        .innerJoin(people, eq(debts.personId, people.id))
        .where(and(eq(debts.id, id), eq(debts.userId, userId)))
        .limit(1)
      if (!rows[0]) return null
      return toDebt(rows[0].debt, rows[0].person) as DebtWithPerson
    },

    async addPayment(debtId, userId, amountCents, paidOn, note) {
      const debt = await this.findDebt(debtId, userId)
      if (!debt) return null

      await db.insert(debtPayments).values({ debtId, userId, amountCents, paidOn, note })

      const newRemaining = Math.max(0, debt.remainingAmountCents - amountCents)
      const newStatus: DebtStatus = newRemaining === 0 ? 'settled' : 'partially_paid'

      const rows = await db
        .update(debts)
        .set({
          remainingAmountCents: newRemaining,
          status: newStatus,
          ...(newStatus === 'settled' ? { settledAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(debts.id, debtId), eq(debts.userId, userId)))
        .returning()
      return rows[0] ? toDebt(rows[0]) as ApiDebt : null
    },

    async settle(debtId, userId) {
      const rows = await db
        .update(debts)
        .set({ remainingAmountCents: 0, status: 'settled', settledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(debts.id, debtId), eq(debts.userId, userId)))
        .returning()
      return rows[0] ? toDebt(rows[0]) as ApiDebt : null
    },
  }
}
