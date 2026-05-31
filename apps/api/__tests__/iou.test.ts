import { describe, it, expect, vi } from 'vitest'

// Prevent @spend-again/db from throwing "DATABASE_URL is required" at module
// init. The actual DB is never used in these tests.
vi.mock('@spend-again/db', () => ({
  db: {},
  people: {},
  debts: {},
  debtPayments: {},
}))

import { createIouService } from '../src/services/iou.js'
import type { DbClient } from '../src/lib/db.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-31T10:00:00Z')
const USER_ID = '00000000-0000-4000-8000-000000000099'
const PERSON_ID = '00000000-0000-4000-8000-000000000011'
const DEBT_ID = '00000000-0000-4000-8000-000000000022'

const BASE_PERSON = {
  id: PERSON_ID,
  userId: USER_ID,
  name: 'Alice',
  createdAt: NOW,
  updatedAt: NOW,
}

const BASE_DEBT = {
  id: DEBT_ID,
  userId: USER_ID,
  personId: PERSON_ID,
  direction: 'they_owe_me',
  originalAmountCents: 2500,
  remainingAmountCents: 2500,
  description: 'lunch',
  linkedTransactionId: null,
  linkedSpaceId: null,
  status: 'open',
  occurredOn: '2026-05-31',
  settledAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

// ── Mock DB builder ────────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<{
  insertReturn: object
  selectReturn: object[]
  updateReturn: object
}> = {}): DbClient {
  const insertReturn = overrides.insertReturn ?? BASE_PERSON
  const selectReturn = overrides.selectReturn ?? [{ debt: BASE_DEBT, person: BASE_PERSON }]
  const updateReturn = overrides.updateReturn ?? BASE_DEBT

  const makeSelectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => {
        const sliced = rows.slice(0, n)
        const tail: Record<string, unknown> = {}
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

  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertReturn]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([insertReturn]),
        }),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockImplementation(() => makeSelectChain(selectReturn)),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updateReturn]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as unknown as DbClient
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createIouService', () => {
  describe('findOrCreatePerson', () => {
    it('returns a person with the correct name', async () => {
      const db = makeMockDb({ insertReturn: BASE_PERSON })
      const svc = createIouService(db)

      const result = await svc.findOrCreatePerson(USER_ID, 'Alice')

      expect(result.id).toBe(PERSON_ID)
      expect(result.name).toBe('Alice')
      expect(result.userId).toBe(USER_ID)
      expect(result.createdAt).toBe(NOW.toISOString())
    })

    it('throws when insert returns no rows', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as DbClient
      const svc = createIouService(db)

      await expect(svc.findOrCreatePerson(USER_ID, 'Bob')).rejects.toThrow('Insert returned no rows')
    })
  })

  describe('createDebt', () => {
    it('creates with correct direction and returns formatted originalAmount', async () => {
      const db = makeMockDb({ insertReturn: BASE_DEBT })
      const svc = createIouService(db)

      const result = await svc.createDebt({
        userId: USER_ID,
        personId: PERSON_ID,
        direction: 'they_owe_me',
        amountCents: 2500,
        description: 'lunch',
        occurredOn: '2026-05-31',
      })

      expect(result.direction).toBe('they_owe_me')
      expect(result.originalAmountCents).toBe(2500)
      expect(result.originalAmount).toBe('25.00')
      expect(result.remainingAmountCents).toBe(2500)
      expect(result.remainingAmount).toBe('25.00')
      expect(result.status).toBe('open')
    })

    it('throws when insert returns no rows', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as DbClient
      const svc = createIouService(db)

      await expect(svc.createDebt({
        userId: USER_ID,
        personId: PERSON_ID,
        direction: 'i_owe_them',
        amountCents: 1000,
        occurredOn: '2026-05-31',
      })).rejects.toThrow('Insert returned no rows')
    })
  })

  describe('addPayment', () => {
    it('reduces remainingAmountCents correctly and sets status to partially_paid', async () => {
      // findDebt returns a debt with 2500 remaining
      const debtWithPerson = { debt: BASE_DEBT, person: BASE_PERSON }
      const updatedDebt = {
        ...BASE_DEBT,
        remainingAmountCents: 1500,
        status: 'partially_paid',
      }

      const db = makeMockDb({
        selectReturn: [debtWithPerson],
        updateReturn: updatedDebt,
      })
      const svc = createIouService(db)

      const result = await svc.addPayment(DEBT_ID, USER_ID, 1000, '2026-05-31')

      expect(result).not.toBeNull()
      expect(result!.remainingAmountCents).toBe(1500)
      expect(result!.remainingAmount).toBe('15.00')
      expect(result!.status).toBe('partially_paid')
    })

    it('returns null when debt is not found', async () => {
      const db = makeMockDb({ selectReturn: [] })
      const svc = createIouService(db)

      const result = await svc.addPayment('nonexistent', USER_ID, 500, '2026-05-31')
      expect(result).toBeNull()
    })

    it('sets status to settled when payment covers the full remaining amount', async () => {
      const debtWithPerson = { debt: BASE_DEBT, person: BASE_PERSON }
      const settledDebt = {
        ...BASE_DEBT,
        remainingAmountCents: 0,
        status: 'settled',
        settledAt: NOW,
      }

      const db = makeMockDb({
        selectReturn: [debtWithPerson],
        updateReturn: settledDebt,
      })
      const svc = createIouService(db)

      const result = await svc.addPayment(DEBT_ID, USER_ID, 2500, '2026-05-31')

      expect(result).not.toBeNull()
      expect(result!.status).toBe('settled')
      expect(result!.remainingAmountCents).toBe(0)
      expect(result!.remainingAmount).toBe('0.00')
    })
  })

  describe('settle', () => {
    it('sets remainingAmountCents to 0 and status to settled', async () => {
      const settledDebt = {
        ...BASE_DEBT,
        remainingAmountCents: 0,
        status: 'settled',
        settledAt: NOW,
      }

      const db = makeMockDb({ updateReturn: settledDebt })
      const svc = createIouService(db)

      const result = await svc.settle(DEBT_ID, USER_ID)

      expect(result).not.toBeNull()
      expect(result!.remainingAmountCents).toBe(0)
      expect(result!.remainingAmount).toBe('0.00')
      expect(result!.status).toBe('settled')

      const updateMock = vi.mocked(db.update as unknown as () => unknown)
      const setMock = (updateMock.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ remainingAmountCents: 0, status: 'settled' }),
      )
    })

    it('returns null when debt is not found', async () => {
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as DbClient
      const svc = createIouService(db)

      const result = await svc.settle('nonexistent', USER_ID)
      expect(result).toBeNull()
    })
  })
})
