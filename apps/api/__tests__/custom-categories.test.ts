import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

// Prevent @spend-again/db from throwing "DATABASE_URL is required" at module init.
vi.mock('@spend-again/db', () => ({
  db: {},
  transactions: {},
  users: {},
  learnedMappings: {},
  userCustomCategories: {},
}))

import { createCustomCategoriesRouter } from '../src/routes/custom-categories.js'
import type { DbClient } from '../src/lib/db.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-4000-8000-000000000099'
const CATEGORY_ROW = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  userId: USER_ID,
  category: 'Food',
  subCategory: 'Hawker',
  createdAt: new Date('2026-05-13T10:00:00Z'),
}

// ── Mock DB builder ────────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<{
  selectReturn: typeof CATEGORY_ROW[]
  insertReturn: typeof CATEGORY_ROW
  deleteReturn: { id: string }[]
  insertThrow: Error
}> = {}): DbClient {
  const selectReturn = overrides.selectReturn ?? [CATEGORY_ROW]
  const insertReturn = overrides.insertReturn ?? CATEGORY_ROW
  const deleteReturn = overrides.deleteReturn ?? [{ id: CATEGORY_ROW.id }]

  const makeSelectorChain = (rows: typeof CATEGORY_ROW[]) => {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
  }

  let insertImpl: ReturnType<typeof vi.fn>
  if (overrides.insertThrow) {
    const err = overrides.insertThrow
    insertImpl = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(err),
      }),
    })
  } else {
    insertImpl = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertReturn]),
      }),
    })
  }

  return {
    select: vi.fn().mockImplementation(() => makeSelectorChain(selectReturn)),
    insert: insertImpl,
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(deleteReturn),
      }),
    }),
    update: vi.fn(),
  } as unknown as DbClient
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Wraps the router in a parent Hono app that injects userId via middleware first.
 * This mirrors how the real app works: requireAuth sets userId before the route runs.
 */
function makeApp(db: DbClient, userId: string | undefined = USER_ID) {
  // Use a parent app so middleware runs before routes (Hono middleware order is
  // per-app registration order, not sub-router registration order).
  type AppEnv = { Variables: { userId: string; telegramId: string | undefined } }
  const parent = new Hono<AppEnv>()
  if (userId !== undefined) {
    parent.use('*', async (c, next) => {
      c.set('userId', userId)
      await next()
    })
  }
  parent.route('/', createCustomCategoriesRouter(db))
  return parent
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/users/custom-categories', () => {
  it('returns [] when none exist', async () => {
    const db = makeMockDb({ selectReturn: [] })
    const app = makeApp(db)

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('returns existing categories for the user', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json() as Array<Record<string, unknown>>
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]?.['category']).toBe('Food')
    expect(body[0]?.['subCategory']).toBe('Hawker')
    expect(body[0]?.['id']).toBe(CATEGORY_ROW.id)
  })
})

describe('POST /api/users/custom-categories', () => {
  it('creates a new custom category and returns 201', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Food', subCategory: 'Hawker' }),
    })

    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body['category']).toBe('Food')
    expect(body['subCategory']).toBe('Hawker')
  })

  it('returns 409 on duplicate (same user, category, subCategory)', async () => {
    const db = makeMockDb({
      insertThrow: new Error('duplicate key value violates unique constraint "user_custom_categories_unique"'),
    })
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Food', subCategory: 'Hawker' }),
    })

    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body['code']).toBe('CONFLICT')
  })

  it('returns 400 for missing category field', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subCategory: 'Hawker' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for missing subCategory field', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Food' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })
})

describe('DELETE /api/users/custom-categories/:id', () => {
  it('deletes a category and returns success', async () => {
    const db = makeMockDb()
    const app = makeApp(db)

    const res = await app.request(`/${CATEGORY_ROW.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['success']).toBe(true)
  })

  it('returns 404 when category does not exist or belongs to another user', async () => {
    const db = makeMockDb({ deleteReturn: [] })
    const app = makeApp(db)

    const res = await app.request('/00000000-0000-0000-0000-000000000000', { method: 'DELETE' })
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('Auth enforcement', () => {
  it('GET returns 401 without auth token (userId not set)', async () => {
    const db = makeMockDb()
    // Create router without userId injection to simulate missing auth
    const router = createCustomCategoriesRouter(db)
    const res = await router.request('/')
    // When userId is undefined, the route should return 401
    expect(res.status).toBe(401)
  })

  it('POST returns 401 without auth token', async () => {
    const db = makeMockDb()
    const router = createCustomCategoriesRouter(db)
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Food', subCategory: 'Hawker' }),
    })
    expect(res.status).toBe(401)
  })

  it('DELETE returns 401 without auth token', async () => {
    const db = makeMockDb()
    const router = createCustomCategoriesRouter(db)
    const res = await router.request(`/${CATEGORY_ROW.id}`, { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
