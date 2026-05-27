import { describe, it, expect, vi } from 'vitest'

vi.mock('@spend-again/db', () => ({
  db: {},
  users: {},
}))

import { Hono } from 'hono'
import { createUsersRouter } from '../src/routes/users.js'
import { signJWT } from '../src/lib/jwt.js'
import { requireAuth } from '../src/middleware/auth.js'
import type { DbClient } from '../src/lib/db.js'

// Mirror production wiring: auth middleware lives at the mount point, not in
// the router itself. Tests wrap the router accordingly so the 401 path is
// still exercised.
function mountWithAuth(db: DbClient): Hono {
  const app = new Hono()
  app.use('/budget', requireAuth)
  app.use('/budget/*', requireAuth)
  app.route('/', createUsersRouter(db))
  return app
}

const TEST_USER_ID = '00000000-0000-4000-8000-000000000099'
const BUDGET_ROW = { monthlyBudget: 100000, budgetAlertPct: 80 }

function makeSelectDb(rows: unknown[]): DbClient {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as DbClient
}

function makeUpdateDb(rows: unknown[]): DbClient {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
    delete: vi.fn(),
  } as unknown as DbClient
}

describe('GET /api/users/budget', () => {
  it('returns 401 without auth token', async () => {
    const app = mountWithAuth(makeSelectDb([BUDGET_ROW]))
    const res = await app.request('/budget', { method: 'GET' })
    expect(res.status).toBe(401)
  })

  it('returns budget settings for authenticated user', async () => {
    const app = mountWithAuth(makeSelectDb([BUDGET_ROW]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['monthlyBudget']).toBe(100000)
    expect(body['budgetAlertPct']).toBe(80)
  })

  it('returns 404 when user not found', async () => {
    const app = mountWithAuth(makeSelectDb([]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns budgetAlertPct as 100 when null in DB', async () => {
    const app = mountWithAuth(makeSelectDb([{ monthlyBudget: null, budgetAlertPct: null }]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['monthlyBudget']).toBeNull()
    expect(body['budgetAlertPct']).toBe(100)
  })
})

describe('PUT /api/users/budget', () => {
  it('returns 401 without auth token', async () => {
    const app = mountWithAuth(makeUpdateDb([BUDGET_ROW]))
    const res = await app.request('/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudget: 100000, budgetAlertPct: 80 }),
    })
    expect(res.status).toBe(401)
  })

  it('updates budget and returns new values', async () => {
    const app = mountWithAuth(makeUpdateDb([BUDGET_ROW]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudget: 100000, budgetAlertPct: 80 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['monthlyBudget']).toBe(100000)
    expect(body['budgetAlertPct']).toBe(80)
  })

  it('accepts null monthlyBudget to clear budget', async () => {
    const app = mountWithAuth(makeUpdateDb([{ monthlyBudget: null, budgetAlertPct: 100 }]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudget: null, budgetAlertPct: 100 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['monthlyBudget']).toBeNull()
  })

  it('rejects budgetAlertPct of 0', async () => {
    const app = mountWithAuth(makeUpdateDb([]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudget: 100000, budgetAlertPct: 0 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when user not found on update', async () => {
    const app = mountWithAuth(makeUpdateDb([]))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await app.request('/budget', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudget: 100000, budgetAlertPct: 80 }),
    })
    expect(res.status).toBe(404)
  })
})
