import './pre-imports.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { users } from '@spend-again/db/schema'
import { setupTestDb, type IntegrationDb } from './setup.js'
import { createTransactionsRouter } from '../../src/routes/transactions.js'
import { createAuthRouter } from '../../src/routes/auth.js'
import { createAnalyticsRouter } from '../../src/routes/analytics.js'
import { requireAuth } from '../../src/middleware/auth.js'
import { signJWT } from '../../src/lib/jwt.js'

// Skip the entire suite when TEST_DATABASE_URL is unset rather than failing.
// Integration tests need a real Postgres; in environments without one we
// silently skip so unit-test runs stay green. CI / dev with a disposable DB
// should set TEST_DATABASE_URL (see .env.example).
const TEST_DB_URL = process.env['TEST_DATABASE_URL']

describe.skipIf(!TEST_DB_URL)('integration: bot ↔ API ↔ DB round trip', () => {
  let db: IntegrationDb
  let cleanup: () => Promise<void>
  let app: Hono
  let userId: string
  let token: string

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'integration-test-secret'
    const setup = await setupTestDb()
    db = setup.db
    cleanup = setup.cleanup

    // Seed a user
    const [user] = await db
      .insert(users)
      .values({
        telegramId: '99999',
        telegramUsername: 'integration_test',
      })
      .returning()
    if (!user) throw new Error('Failed to seed user')
    userId = user.id
    token = await signJWT({ userId, telegramId: '99999' })

    // Build a Hono app wiring the routers under test
    app = new Hono()
    app.use('/api/transactions/*', requireAuth)
    app.use('/api/analytics/*', requireAuth)
    app.route('/api/transactions', createTransactionsRouter(db))
    app.route('/api/analytics', createAnalyticsRouter(db))
    app.route('/api/auth', createAuthRouter(db))
  })

  afterAll(async () => {
    await cleanup()
  })

  it('creates and fetches a transaction', async () => {
    const createRes = await app.request('/api/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amountCents: 1050,
        item: 'Chicken rice',
        category: 'Food',
        subCategory: 'Hawker',
        date: '15/05/2026',
        source: 'bot',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { amount: string; amountCents: number }
    expect(created.amount).toBe('10.50')
    expect(created.amountCents).toBe(1050)

    const listRes = await app.request('/api/transactions?userId=' + userId, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as Array<{ item: string }>
    expect(list).toHaveLength(1)
    expect(list[0]?.item).toBe('Chicken rice')
  })

  it('returns analytics summary for the current month', async () => {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = String(now.getFullYear())
    const res = await app.request(
      `/api/analytics/summary?month=${month}&year=${year}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('totalCents')
    expect(body).toHaveProperty('count')
  })
})
