import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac, createHash } from 'node:crypto'

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildTelegramAuth(
  botToken: string,
  fields: Record<string, string>,
): { hash: string; authDate: number } {
  const authDate = Math.floor(Date.now() / 1000)
  const allFields: Record<string, string> = { ...fields, auth_date: String(authDate) }

  const dataCheckString = Object.keys(allFields)
    .sort()
    .map((k) => `${k}=${allFields[k]}`)
    .join('\n')

  const secret = createHash('sha256').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex')
  return { hash, authDate }
}

describe('POST /api/auth/telegram-login', () => {
  // telegram-auth.ts captures BOT_TOKEN at module load (via requireEnv), so
  // the value used by verifyTelegramAuth is whatever vitest.setup.ts set on
  // first import. Read it back here so the test signs HMAC with the same key.
  const TEST_BOT_TOKEN = process.env['BOT_TOKEN'] ?? ''

  it('accepts a valid HMAC and returns a JWT token', async () => {
    const { hash, authDate } = buildTelegramAuth(TEST_BOT_TOKEN, {
      id: '12345678',
      first_name: 'Test',
      username: 'testuser',
    })

    const db = makeDbWithExistingUser()
    const app = createAuthRouter(db)

    const res = await app.request('/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '12345678',
        auth_date: authDate,
        hash,
        first_name: 'Test',
        username: 'testuser',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body['token']).toBe('string')
    expect((body['token'] as string).split('.').length).toBe(3) // valid JWT structure
    expect(typeof body['userId']).toBe('string')
  })

  it('accepts a valid HMAC with no optional fields', async () => {
    const { hash, authDate } = buildTelegramAuth(TEST_BOT_TOKEN, { id: '99999999' })

    const db = makeDbWithExistingUser()
    const app = createAuthRouter(db)

    const res = await app.request('/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '99999999', auth_date: authDate, hash }),
    })

    expect(res.status).toBe(200)
  })

  it('rejects a tampered hash', async () => {
    const { authDate } = buildTelegramAuth(TEST_BOT_TOKEN, { id: '12345678' })

    const db = makeDbWithExistingUser()
    const app = createAuthRouter(db)

    const res = await app.request('/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '12345678',
        auth_date: authDate,
        hash: 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff0000000011111111',
      }),
    })

    expect(res.status).toBe(401)
  })

  it('rejects a hash computed with the wrong bot token', async () => {
    const { hash, authDate } = buildTelegramAuth('wrong-bot-token', { id: '12345678' })

    const db = makeDbWithExistingUser()
    const app = createAuthRouter(db)

    const res = await app.request('/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '12345678', auth_date: authDate, hash }),
    })

    expect(res.status).toBe(401)
  })

  it('creates a new user when telegram ID is not registered', async () => {
    const { hash, authDate } = buildTelegramAuth(TEST_BOT_TOKEN, {
      id: '77777777',
      username: 'newuser',
    })

    const db = makeDbWithNoUser()
    const app = createAuthRouter(db)

    const res = await app.request('/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '77777777', auth_date: authDate, hash, username: 'newuser' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body['token']).toBe('string')
  })
})
