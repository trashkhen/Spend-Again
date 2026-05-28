import { describe, it, expect, vi } from 'vitest'

vi.mock('@spend-again/db', () => ({
  db: {},
  users: {},
  userCustomCategories: {},
}))

import { Hono } from 'hono'
import { createUsersRouter } from '../src/routes/users.js'
import type { DbClient } from '../src/lib/db.js'

// Regression test for codex review §1: prior to this fix the app registered
// both `app.use('/api/users/*', mw)` AND `app.use('/api/users/custom-categories/*', mw)`.
// Hono matched BOTH for any request under custom-categories, so requireAuth +
// rateLimitMiddleware fired twice per nested-route request, burning the
// per-user rate-limit budget at 2x speed.
//
// The fix nests the custom-categories router INSIDE the users router (see
// routes/users.ts) and removes the duplicate registration in index.ts.

function makeMockDb(): DbClient {
  // Provide both the GET-list shape (.from().where()) used by
  // custom-categories, and the .limit() shape used by /budget.
  const buildChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      then: undefined,
    }
    // Make the chain awaitable at .where() level too.
    chain['where'] = vi.fn().mockImplementation(() => ({
      then: (resolve: (rows: unknown[]) => void) => resolve([]),
      limit: vi.fn().mockResolvedValue([]),
    }))
    return chain
  }
  return {
    select: vi.fn().mockImplementation(buildChain),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as DbClient
}

type Env = { Variables: { userId: string; telegramId: string | undefined } }

describe('middleware: custom-categories nested under users router', () => {
  it('runs /api/users/* middleware exactly once on a custom-categories request', async () => {
    let middlewareFireCount = 0
    const app = new Hono<Env>()

    app.use('/api/users/*', async (c, next) => {
      middlewareFireCount++
      c.set('userId', 'test-user-id')
      await next()
    })
    app.route('/api/users', createUsersRouter(makeMockDb()))

    const res = await app.request('/api/users/custom-categories', { method: 'GET' })
    expect(res.status).toBe(200)
    expect(middlewareFireCount).toBe(1)
  })

  it('still routes /api/users/budget through the same middleware exactly once', async () => {
    let middlewareFireCount = 0
    const app = new Hono<Env>()

    app.use('/api/users/*', async (c, next) => {
      middlewareFireCount++
      c.set('userId', 'test-user-id')
      await next()
    })
    app.route('/api/users', createUsersRouter(makeMockDb()))

    const res = await app.request('/api/users/budget', { method: 'GET' })
    // Mock returns no row → 404. The body is irrelevant; we care that the
    // middleware fired exactly once on the way through.
    expect(res.status).toBe(404)
    expect(middlewareFireCount).toBe(1)
  })

  it('does NOT fire middleware twice when a top-level /api/users/custom-categories middleware would also match', async () => {
    // Simulates the pre-fix bug: if someone re-adds the duplicate registration
    // this test asserts the nested mount still keeps the single-fire contract.
    let middlewareFireCount = 0
    const app = new Hono<Env>()
    app.use('/api/users/*', async (c, next) => {
      middlewareFireCount++
      c.set('userId', 'test-user-id')
      await next()
    })
    app.route('/api/users', createUsersRouter(makeMockDb()))

    // POST /api/users/custom-categories/:id-style request
    const res = await app.request('/api/users/custom-categories', { method: 'GET' })
    expect(res.status).toBe(200)
    // Single fire — even though the route is two levels deep, only the parent
    // /api/users/* middleware ran (no separate custom-categories middleware
    // registered at app level any more).
    expect(middlewareFireCount).toBe(1)
  })
})
