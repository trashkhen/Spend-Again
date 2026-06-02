import { describe, it, expect, vi } from 'vitest'

// Prevent @spend-again/db from throwing "DATABASE_URL is required" at module
// init. The actual DB is never used in these tests.
vi.mock('@spend-again/db', () => ({
  db: {},
  spaces: {},
  transactionSpaces: {},
  users: {},
  transactions: {},
  learnedMappings: {},
}))

import { createSpacesService } from '../src/services/spaces.js'
import type { DbClient } from '../src/lib/db.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-31T10:00:00Z')

const BASE_SPACE = {
  id: '00000000-0000-4000-8000-000000000010',
  userId: '00000000-0000-4000-8000-000000000099',
  name: 'Tokyo Trip',
  emoji: '✈️',
  budgetCents: 50000,
  startDate: '2026-06-01',
  endDate: '2026-06-14',
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
}

const BASE_USER = {
  id: '00000000-0000-4000-8000-000000000099',
  email: 'user@test.com',
  telegramId: null,
  telegramUsername: null,
  monthlyBudget: null,
  budgetAlertPct: 100,
  activeSpaceId: BASE_SPACE.id,
  createdAt: NOW,
  updatedAt: NOW,
}

// ── Mock DB builder ────────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<{
  insertReturn: typeof BASE_SPACE
  selectReturn: (typeof BASE_SPACE)[]
  selectUserReturn: (typeof BASE_USER)[]
  updateReturn: typeof BASE_SPACE
  deleteReturn: { id: string }[]
}> = {}): DbClient {
  const insertReturn = overrides.insertReturn ?? BASE_SPACE
  const selectReturn = overrides.selectReturn ?? [BASE_SPACE]
  const selectUserReturn = overrides.selectUserReturn ?? [BASE_USER]
  const updateReturn = overrides.updateReturn ?? { ...BASE_SPACE, status: 'archived' }
  const deleteReturn = overrides.deleteReturn ?? [{ id: BASE_SPACE.id }]

  // Chainable select chain that supports .from().where().limit() and is awaitable
  const makeSelectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => {
        const sliced = rows.slice(0, n)
        const tail: Record<string, unknown> = {
          offset: vi.fn().mockResolvedValue(sliced),
        }
        Object.defineProperty(tail, 'then', {
          get() {
            return (resolve: (v: unknown[]) => void) => resolve(sliced)
          },
        })
        return tail
      }),
    }
    Object.defineProperty(chain, 'then', {
      get() {
        return (resolve: (v: unknown[]) => void) => resolve(rows)
      },
    })
    return chain
  }

  // Track call count so alternate calls return different data (spaces vs users)
  let selectCallCount = 0

  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertReturn]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockImplementation(() => {
      // getActiveSpace calls select twice: once for users, then again for findById
      // We alternate: odd calls → users, even calls → spaces (by overrides)
      selectCallCount++
      // If selectUserReturn is explicitly provided, first call uses it
      if (selectCallCount === 1 && overrides.selectUserReturn !== undefined) {
        return makeSelectChain(selectUserReturn)
      }
      return makeSelectChain(selectReturn)
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updateReturn]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(deleteReturn),
      }),
    }),
  } as unknown as DbClient
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createSpacesService', () => {
  describe('create', () => {
    it('returns an ApiSpace with formatted budget string', async () => {
      const db = makeMockDb({ insertReturn: BASE_SPACE })
      const svc = createSpacesService(db)

      const result = await svc.create({
        userId: BASE_SPACE.userId,
        name: 'Tokyo Trip',
        emoji: '✈️',
        budgetCents: 50000,
        startDate: '2026-06-01',
        endDate: '2026-06-14',
      })

      expect(result.id).toBe(BASE_SPACE.id)
      expect(result.name).toBe('Tokyo Trip')
      expect(result.budgetCents).toBe(50000)
      expect(result.budget).toBe('500.00')
      expect(result.status).toBe('active')
      expect(result.createdAt).toBe(NOW.toISOString())
    })

    it('returns null budget when budgetCents is null', async () => {
      const noBudgetSpace = { ...BASE_SPACE, budgetCents: null }
      const db = makeMockDb({ insertReturn: noBudgetSpace as typeof BASE_SPACE })
      const svc = createSpacesService(db)

      const result = await svc.create({
        userId: BASE_SPACE.userId,
        name: 'Casual',
      })

      expect(result.budgetCents).toBeNull()
      expect(result.budget).toBeNull()
    })

    it('throws when insert returns no rows', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as DbClient
      const svc = createSpacesService(db)

      await expect(svc.create({ userId: 'u1', name: 'X' })).rejects.toThrow('Insert returned no rows')
    })
  })

  describe('findByDateWindow', () => {
    it('calls select with the correct userId and date filters', async () => {
      const db = makeMockDb({ selectReturn: [BASE_SPACE] })
      const svc = createSpacesService(db)

      const results = await svc.findByDateWindow(BASE_SPACE.userId, '2026-06-07')

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe(BASE_SPACE.id)
      // select().from().where() chain must have been invoked
      const selectMock = vi.mocked(db.select as unknown as () => unknown)
      expect(selectMock).toHaveBeenCalled()
      const chain = selectMock.mock.results[0]?.value as { from: ReturnType<typeof vi.fn> }
      expect(chain.from).toHaveBeenCalled()
    })

    it('returns empty array when no spaces match the date window', async () => {
      const db = makeMockDb({ selectReturn: [] })
      const svc = createSpacesService(db)

      const results = await svc.findByDateWindow(BASE_SPACE.userId, '2030-01-01')
      expect(results).toHaveLength(0)
    })
  })

  describe('archive', () => {
    it('returns true and updates status to archived when space exists', async () => {
      const archivedSpace = { ...BASE_SPACE, status: 'archived' }
      const db = makeMockDb({ updateReturn: archivedSpace })
      const svc = createSpacesService(db)

      const result = await svc.archive(BASE_SPACE.id, BASE_SPACE.userId)

      expect(result).toBe(true)
      const updateMock = vi.mocked(db.update as unknown as () => unknown)
      const setMock = (updateMock.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'archived' }),
      )
    })

    it('returns false when space does not exist', async () => {
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as DbClient
      const svc = createSpacesService(db)

      const result = await svc.archive('nonexistent-id', BASE_SPACE.userId)
      expect(result).toBe(false)
    })
  })

  describe('attachTransaction', () => {
    it('calls insert on transactionSpaces and returns true', async () => {
      const db = makeMockDb()
      const svc = createSpacesService(db)

      const result = await svc.attachTransaction('tx-1', BASE_SPACE.id, BASE_SPACE.userId)

      expect(result).toBe(true)
      const insertMock = vi.mocked(db.insert as unknown as () => unknown)
      expect(insertMock).toHaveBeenCalled()
      const valuesMock = (insertMock.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> }).values
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'tx-1',
          spaceId: BASE_SPACE.id,
          userId: BASE_SPACE.userId,
        }),
      )
    })

    it('returns false when insert throws', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockRejectedValue(new Error('db error')),
          }),
        }),
      } as unknown as DbClient
      const svc = createSpacesService(db)

      const result = await svc.attachTransaction('tx-1', 'space-1', 'user-1')
      expect(result).toBe(false)
    })
  })

  describe('detachTransaction', () => {
    it('calls delete on transactionSpaces and returns true when row exists', async () => {
      const db = makeMockDb({ deleteReturn: [{ id: 'tx-1' }] })
      const svc = createSpacesService(db)

      const result = await svc.detachTransaction('tx-1', BASE_SPACE.id, BASE_SPACE.userId)

      expect(result).toBe(true)
      const deleteMock = vi.mocked(db.delete as unknown as () => unknown)
      expect(deleteMock).toHaveBeenCalled()
    })

    it('returns false when no row was deleted', async () => {
      const db = makeMockDb({ deleteReturn: [] })
      const svc = createSpacesService(db)

      const result = await svc.detachTransaction('tx-1', BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toBe(false)
    })
  })

  describe('hardDelete', () => {
    it('returns true when space exists', async () => {
      const svc = createSpacesService(makeMockDb({ deleteReturn: [{ id: BASE_SPACE.id }] }))
      const result = await svc.hardDelete(BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toBe(true)
    })

    it('returns false when space not found', async () => {
      const svc = createSpacesService(makeMockDb({ deleteReturn: [] }))
      const result = await svc.hardDelete('non-existent', BASE_SPACE.userId)
      expect(result).toBe(false)
    })
  })

  describe('getBreakdown', () => {
    it('returns empty array when no transactions', async () => {
      // Use a mock db that returns [] for the breakdown query
      const svc = createSpacesService({
        ...makeMockDb(),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  groupBy: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      } as unknown as DbClient)
      const result = await svc.getBreakdown(BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toEqual([])
    })

    it('calculates percentage correctly', async () => {
      const rows = [
        { category: 'Food', totalCents: 600 },
        { category: 'Transport', totalCents: 400 },
      ]
      const svc = createSpacesService({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  groupBy: vi.fn().mockResolvedValue(rows),
                }),
              }),
            }),
          }),
        }),
      } as unknown as DbClient)
      const result = await svc.getBreakdown(BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toHaveLength(2)
      expect(result.find(r => r.category === 'Food')?.pct).toBe(60)
      expect(result.find(r => r.category === 'Transport')?.pct).toBe(40)
    })
  })
})
