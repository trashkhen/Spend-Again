import { eq, and, lte, gte, sql } from 'drizzle-orm'
import { spaces, transactionSpaces, users, transactions } from '@spend-again/db'
import type { Space } from '@spend-again/db'
import { centsToDecimalString } from '@spend-again/shared'
import type { SpaceWithTotal, ApiSpace } from '@spend-again/shared'
import type { DbClient } from '../lib/db.js'

export type CreateSpaceInput = {
  userId: string
  name: string
  emoji?: string | undefined
  budgetCents?: number | undefined
  startDate?: string | undefined  // YYYY-MM-DD
  endDate?: string | undefined    // YYYY-MM-DD
}

export type UpdateSpaceInput = {
  name?: string | undefined
  emoji?: string | undefined
  budgetCents?: number | undefined
  startDate?: string | undefined
  endDate?: string | undefined
  status?: 'active' | 'archived' | undefined
}

function toApiSpace(s: Space): ApiSpace {
  return {
    id: s.id,
    userId: s.userId,
    name: s.name,
    emoji: s.emoji ?? null,
    budgetCents: s.budgetCents ?? null,
    budget: s.budgetCents != null ? centsToDecimalString(s.budgetCents) : null,
    startDate: s.startDate ?? null,
    endDate: s.endDate ?? null,
    status: s.status as 'active' | 'archived',
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

export interface SpacesService {
  create(input: CreateSpaceInput): Promise<ApiSpace>
  list(userId: string): Promise<SpaceWithTotal[]>
  findById(id: string, userId: string): Promise<ApiSpace | null>
  update(id: string, userId: string, input: UpdateSpaceInput): Promise<ApiSpace | null>
  archive(id: string, userId: string): Promise<boolean>
  attachTransaction(transactionId: string, spaceId: string, userId: string): Promise<boolean>
  detachTransaction(transactionId: string, spaceId: string, userId: string): Promise<boolean>
  findByDateWindow(userId: string, isoDate: string): Promise<ApiSpace[]>
  setActiveSpace(userId: string, spaceId: string | null): Promise<void>
  getActiveSpace(userId: string): Promise<ApiSpace | null>
}

export function createSpacesService(db: DbClient): SpacesService {
  return {
    async create(input) {
      const rows = await db
        .insert(spaces)
        .values({
          userId: input.userId,
          name: input.name,
          emoji: input.emoji,
          budgetCents: input.budgetCents,
          startDate: input.startDate,
          endDate: input.endDate,
        })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('Insert returned no rows')
      return toApiSpace(row)
    },

    async list(userId) {
      const rows = await db
        .select({
          space: spaces,
          spentCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
          txCount: sql<number>`count(distinct ${transactionSpaces.transactionId})`,
        })
        .from(spaces)
        .leftJoin(transactionSpaces, eq(transactionSpaces.spaceId, spaces.id))
        .leftJoin(transactions, eq(transactions.id, transactionSpaces.transactionId))
        .where(eq(spaces.userId, userId))
        .groupBy(spaces.id)
        .orderBy(spaces.createdAt)

      return rows.map(({ space, spentCents, txCount }) => ({
        ...toApiSpace(space),
        spentCents: Number(spentCents),
        spent: centsToDecimalString(Number(spentCents)),
        transactionCount: Number(txCount),
      }))
    },

    async findById(id, userId) {
      const rows = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.id, id), eq(spaces.userId, userId)))
        .limit(1)
      return rows[0] ? toApiSpace(rows[0]) : null
    },

    async update(id, userId, input) {
      const rows = await db
        .update(spaces)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.emoji !== undefined && { emoji: input.emoji }),
          ...(input.budgetCents !== undefined && { budgetCents: input.budgetCents }),
          ...(input.startDate !== undefined && { startDate: input.startDate }),
          ...(input.endDate !== undefined && { endDate: input.endDate }),
          ...(input.status !== undefined && { status: input.status }),
          updatedAt: new Date(),
        })
        .where(and(eq(spaces.id, id), eq(spaces.userId, userId)))
        .returning()
      return rows[0] ? toApiSpace(rows[0]) : null
    },

    async archive(id, userId) {
      const rows = await db
        .update(spaces)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(spaces.id, id), eq(spaces.userId, userId)))
        .returning()
      return rows.length > 0
    },

    async attachTransaction(transactionId, spaceId, userId) {
      try {
        await db
          .insert(transactionSpaces)
          .values({ transactionId, spaceId, userId })
          .onConflictDoNothing()
        return true
      } catch {
        return false
      }
    },

    async detachTransaction(transactionId, spaceId, userId) {
      const rows = await db
        .delete(transactionSpaces)
        .where(
          and(
            eq(transactionSpaces.transactionId, transactionId),
            eq(transactionSpaces.spaceId, spaceId),
            eq(transactionSpaces.userId, userId),
          ),
        )
        .returning()
      return rows.length > 0
    },

    async findByDateWindow(userId, isoDate) {
      const rows = await db
        .select()
        .from(spaces)
        .where(
          and(
            eq(spaces.userId, userId),
            eq(spaces.status, 'active'),
            lte(spaces.startDate, isoDate),
            gte(spaces.endDate, isoDate),
          ),
        )
      return rows.map(toApiSpace)
    },

    async setActiveSpace(userId, spaceId) {
      await db
        .update(users)
        .set({ activeSpaceId: spaceId, updatedAt: new Date() })
        .where(eq(users.id, userId))
    },

    async getActiveSpace(userId) {
      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      const activeId = userRows[0]?.activeSpaceId
      if (!activeId) return null
      return this.findById(activeId, userId)
    },
  }
}
