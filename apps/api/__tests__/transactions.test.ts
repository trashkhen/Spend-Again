import { describe, it, expect, vi } from 'vitest'

// Prevent @spend-again/db from throwing "DATABASE_URL is required" at module
// init. The actual DB is never used in these tests — each test passes its own
// mock DbClient directly to createTransactionsRouter().
vi.mock('@spend-again/db', () => ({
  db: {},
  transactions: {},
  users: {},
  learnedMappings: {},
}))

import { createTransactionsRouter } from '../src/routes/transactions.js'
import type { TransactionRow } from '../src/services/transactions.js'
import type { DbClient } from '../src/lib/db.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const BASE_TX: TransactionRow = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000099',
  amountCents: 1050,
  item: 'chicken rice',
  category: 'Food',
  subCategory: 'Hawker',
  occurredOn: '2026-05-13',
  source: 'bot',
  tier: 1,
  confidence: '0.95',
  createdAt: new Date('2026-05-13T10:00:00Z'),
  updatedAt: new Date('2026-05-13T10:00:00Z'),
}

// ── Mock DB builder ────────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<{
  insertReturn: TransactionRow
  selectReturn: TransactionRow[]
  updateReturn: TransactionRow
  deleteReturn: { id: string }[]
}> = {}): DbClient {
  const insertReturn = overrides.insertReturn ?? BASE_TX
  const selectReturn = overrides.selectReturn ?? [BASE_TX]
  const updateReturn = overrides.updateReturn ?? { ...BASE_TX, item: 'nasi lemak', amountCents: 800 }
  const deleteReturn = overrides.deleteReturn ?? [{ id: BASE_TX.id }]

  // Build a chainable query builder mock.
  // Supports: .from().where().orderBy().limit().offset() (await-able at any point)
  // and the findById style: .from().where().limit(1).
  const makeSelectorChain = (rows: TransactionRow[]) => {
    const chain: Record<string, unknown> = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => {
        // findById uses .where(...).limit(1) (no orderBy) and awaits.
        // list uses .orderBy(...).limit(N).offset(M) and awaits offset.
        const sliced = rows.slice(0, n)
        // Return a chain that still supports .offset() but is also awaitable.
        const tail: Record<string, unknown> = {
          offset: vi.fn().mockImplementation((skip: number) =>
            Promise.resolve(sliced.slice(skip)),
          ),
        }
        Object.defineProperty(tail, 'then', {
          get() {
            return (resolve: (v: TransactionRow[]) => void) => resolve(sliced)
          },
        })
        return tail
      }),
    }
    Object.defineProperty(chain, 'then', {
      get() {
        return (resolve: (v: TransactionRow[]) => void) => resolve(rows)
      },
    })
    return chain
  }

  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertReturn]),
      }),
    }),
    select: vi.fn().mockImplementation(() => makeSelectorChain(selectReturn)),
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeApp(db: DbClient) {
  return createTransactionsRouter(db)
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/transactions', () => {
  const validBody = {
    userId: '00000000-0000-4000-8000-000000000099',
    amountCents: 1050,
    item: 'chicken rice',
    category: 'Food',
    subCategory: 'Hawker',
    date: '13/05/2026',
    source: 'bot',
  }

  it('creates a transaction and returns 201 with amount as decimal string', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })

    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body['amount']).toBe('10.50')
    expect(body['amountCents']).toBeUndefined()
    expect(body['item']).toBe('chicken rice')
    expect(body['category']).toBe('Food')
  })

  it('writes occurredOn in ISO format (converted from DD/MM/YYYY input)', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })

    expect(res.status).toBe(201)
    const body = await json(res)
    // The response reflects the mock return value which includes occurredOn
    expect(body['occurredOn']).toBe('2026-05-13')
    // Verify the insert was called with occurredOn derived from date (no legacy date column)
    const insertMock = vi.mocked(db.insert as unknown as () => unknown)
    const valuesMock = (insertMock.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> }).values
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredOn: '2026-05-13',
      }),
    )
    expect(valuesMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        date: expect.anything(),
      }),
    )
  })

  it('returns 400 for missing required fields', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'missing amount' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(Array.isArray(body['details'])).toBe(true)
  })

  it('returns 400 for invalid date format', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, date: '2026-05-13' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for invalid category', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, category: 'NotACategory' }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 for malformed JSON', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('INVALID_JSON')
  })
})

describe('GET /api/transactions', () => {
  it('lists all transactions with amount as decimal string', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json() as TransactionRow[]
    expect(Array.isArray(body)).toBe(true)
    const first = body[0] as Record<string, unknown>
    expect(first['amount']).toBe('10.50')
    expect(first['amountCents']).toBeUndefined()
  })

  it('filters by category query param', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/?category=Food')
    expect(res.status).toBe(200)
  })

  it('filters by month and year query params', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/?month=05&year=2026')
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid category query param', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/?category=BadCategory')
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for invalid month format', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/?month=5')
    expect(res.status).toBe(400)
  })

  it('passes limit and offset to the underlying select chain and orders by createdAt desc', async () => {
    const olderTx: TransactionRow = {
      ...BASE_TX,
      id: '00000000-0000-4000-8000-000000000002',
      createdAt: new Date('2026-05-12T10:00:00Z'),
    }
    // Pretend DB returned both rows (we'll assert the chain calls)
    const db = makeMockDb({ selectReturn: [BASE_TX, olderTx] })
    const app = makeApp(db)

    const res = await app.request('/?limit=2&offset=0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(2)

    // The mock select() returns a chain; orderBy + limit + offset must have been called.
    const selectMock = vi.mocked(db.select as unknown as () => unknown)
    const chain = selectMock.mock.results[selectMock.mock.results.length - 1]?.value as {
      orderBy: ReturnType<typeof vi.fn>
      limit: ReturnType<typeof vi.fn>
    }
    expect(chain.orderBy).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(2)
  })

  it('rejects limit > 500', async () => {
    const db = makeMockDb()
    const app = makeApp(db)
    const res = await app.request('/?limit=501')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/transactions/:id', () => {
  it('returns a single transaction with amount as decimal string', async () => {
    const db = makeMockDb({ selectReturn: [BASE_TX] })
    const app = makeApp(db)

    const res = await app.request(`/${BASE_TX.id}`)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['id']).toBe(BASE_TX.id)
    expect(body['amount']).toBe('10.50')
    expect(body['amountCents']).toBeUndefined()
  })

  it('returns 404 when transaction is not found', async () => {
    const db = makeMockDb({ selectReturn: [] })
    const app = makeApp(db)

    const res = await app.request('/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('PUT /api/transactions/:id', () => {
  it('updates a transaction and returns updated data with amount as decimal string', async () => {
    const updated: TransactionRow = { ...BASE_TX, item: 'nasi lemak', amountCents: 800 }
    const db = makeMockDb({ updateReturn: updated })
    const app = makeApp(db)

    const res = await app.request(`/${BASE_TX.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'nasi lemak', amountCents: 800 }),
    })

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['item']).toBe('nasi lemak')
    expect(body['amount']).toBe('8.00')
    expect(body['amountCents']).toBeUndefined()
  })

  it('returns 404 when transaction does not exist', async () => {
    const db = makeMockDb({
      updateReturn: undefined as unknown as TransactionRow,
    })
    // Override update to return empty array
    const mockDb = {
      ...db,
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as DbClient

    const app = makeApp(mockDb)

    const res = await app.request('/00000000-0000-0000-0000-000000000000', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'new item' }),
    })

    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('NOT_FOUND')
  })

  it('returns 400 for invalid update body', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request(`/${BASE_TX.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-05-13' }), // wrong format
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('converts date DD/MM/YYYY to occurredOn YYYY-MM-DD in the DB patch, and does not pass date field directly', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request(`/${BASE_TX.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '13/05/2026' }),
    })

    expect(res.status).toBe(200)

    // The update set() call should receive occurredOn, not the raw date field
    const updateMock = vi.mocked(db.update as unknown as () => unknown)
    const setMock = (updateMock.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredOn: '2026-05-13',
      }),
    )
    expect(setMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        date: expect.anything(),
      }),
    )
  })
})

describe('DELETE /api/transactions/:id', () => {
  it('deletes a transaction and returns success', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request(`/${BASE_TX.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['success']).toBe(true)
  })

  it('returns 404 when transaction does not exist', async () => {
    const mockDb = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as DbClient

    const app = makeApp(mockDb)

    const res = await app.request('/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('Amount conversion', () => {
  it('converts 0 cents to "0.00"', async () => {
    const zeroTx: TransactionRow = { ...BASE_TX, amountCents: 0 }
    const db = makeMockDb({ insertReturn: zeroTx })
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: BASE_TX.userId,
        amountCents: 1, // passes validation (positive), but DB mock returns 0
        item: 'test',
        category: 'Food',
        subCategory: 'Hawker',
        date: '01/01/2026',
        source: 'manual',
      }),
    })

    const body = await json(res)
    expect(body['amount']).toBe('0.00')
  })

  it('converts large amounts correctly, e.g. 100000 → "1000.00"', async () => {
    const bigTx: TransactionRow = { ...BASE_TX, amountCents: 100000 }
    const db = makeMockDb({ insertReturn: bigTx })
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: BASE_TX.userId,
        amountCents: 100000,
        item: 'laptop',
        category: 'Shopping',
        subCategory: 'Electronics',
        date: '01/01/2026',
        source: 'manual',
      }),
    })

    const body = await json(res)
    expect(body['amount']).toBe('1000.00')
  })
})
