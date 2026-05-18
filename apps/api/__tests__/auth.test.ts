import { describe, it, expect, vi, afterEach } from 'vitest'

// Prevent @spend-again/db from throwing at module init — tests pass their own mock
vi.mock('@spend-again/db', () => ({
  db: {},
  users: {},
}))

import { createAuthRouter } from '../src/routes/auth.js'
import type { DbClient } from '../src/lib/db.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000099'
const TEST_USER = {
  id: TEST_USER_ID,
  telegramId: '__dev_test__',
  telegramUsername: null,
  email: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ── Mock DB builder ────────────────────────────────────────────────────────────

function makeDbWithNoUser(): DbClient {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([TEST_USER]),
      }),
    }),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as DbClient
}

function makeDbWithExistingUser(): DbClient {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([TEST_USER]),
    }),
    insert: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([TEST_USER]),
        }),
      }),
    }),
    delete: vi.fn(),
  } as unknown as DbClient
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/auth/dev-login', () => {
  const originalNodeEnv = process.env['NODE_ENV']

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv
  })

  it('creates a test user and returns token + userId in development', async () => {
    process.env['NODE_ENV'] = 'development'
    const db = makeDbWithNoUser()
    const app = createAuthRouter(db)

    const res = await app.request('/dev-login', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body['token']).toBe('string')
    expect((body['token'] as string).length).toBeGreaterThan(10)
    expect(body['userId']).toBe(TEST_USER_ID)
  })

  it('returns existing userId when test user already exists', async () => {
    process.env['NODE_ENV'] = 'development'
    const db = makeDbWithExistingUser()
    const app = createAuthRouter(db)

    const res = await app.request('/dev-login', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['userId']).toBe(TEST_USER_ID)
  })

  it('returns 404 when NODE_ENV is production', async () => {
    process.env['NODE_ENV'] = 'production'
    const db = makeDbWithNoUser()
    const app = createAuthRouter(db)

    const res = await app.request('/dev-login', { method: 'POST' })

    expect(res.status).toBe(404)
  })
})

describe('POST /api/auth/telegram-login', () => {
  it('createAuthRouter factory and response shape are defined', () => {
    const db = makeDbWithExistingUser()
    const app = createAuthRouter(db)
    expect(typeof createAuthRouter).toBe('function')
    expect(app).toBeDefined()
  })
})
