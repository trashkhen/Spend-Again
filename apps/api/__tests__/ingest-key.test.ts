import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('@spend-again/db', () => ({
  db: {},
  users: {},
}))

import { Hono } from 'hono'
import { generateIngestKey, hashIngestKey } from '../src/lib/ingest-key.js'
import { createAuthRouter } from '../src/routes/auth.js'
import { createUsersRouter } from '../src/routes/users.js'
import { signJWT, verifyJWT } from '../src/lib/jwt.js'
import { requireAuth } from '../src/middleware/auth.js'
import type { DbClient } from '../src/lib/db.js'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000099'
const VALID_KEY = `sa_${'a'.repeat(43)}`

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

function postJson(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

describe('generateIngestKey', () => {
  it('returns an sa_-prefixed key whose hash is its sha256 hex digest', () => {
    const { key, hash } = generateIngestKey()
    expect(key).toMatch(/^sa_[A-Za-z0-9_-]{43}$/)
    expect(hash).toBe(createHash('sha256').update(key).digest('hex'))
    expect(hashIngestKey(key)).toBe(hash)
  })

  it('returns a different key each time', () => {
    expect(generateIngestKey().key).not.toBe(generateIngestKey().key)
  })
})

describe('POST /api/auth/ingest-login', () => {
  function mount(db: DbClient): Hono {
    const app = new Hono()
    app.route('/', createAuthRouter(db))
    return app
  }

  it('returns a token, userId and telegramId for a known key', async () => {
    const app = mount(makeSelectDb([{ id: TEST_USER_ID, telegramId: '12345' }]))
    const res = await postJson(app, '/ingest-login', { key: VALID_KEY })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; userId: string; telegramId: string }
    expect(body.userId).toBe(TEST_USER_ID)
    expect(body.telegramId).toBe('12345')
    const payload = await verifyJWT(body.token)
    expect(payload?.userId).toBe(TEST_USER_ID)
    expect(payload?.telegramId).toBe('12345')
  })

  it('returns 401 INVALID_INGEST_KEY when no user has that key', async () => {
    const app = mount(makeSelectDb([]))
    const res = await postJson(app, '/ingest-login', { key: VALID_KEY })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_INGEST_KEY')
  })

  it('returns 401 when the user has no Telegram account linked', async () => {
    const app = mount(makeSelectDb([{ id: TEST_USER_ID, telegramId: null }]))
    const res = await postJson(app, '/ingest-login', { key: VALID_KEY })
    expect(res.status).toBe(401)
  })

  it('returns 400 when the key is shorter than 20 characters', async () => {
    const app = mount(makeSelectDb([{ id: TEST_USER_ID, telegramId: '12345' }]))
    const res = await postJson(app, '/ingest-login', { key: 'short' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/users/ingest-key', () => {
  it('stores the hash, never the key, and returns the key once', async () => {
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: TEST_USER_ID }]) }),
    })
    const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn().mockReturnValue({ set }), delete: vi.fn() } as unknown as DbClient
    const app = new Hono()
    app.use('/ingest-key', requireAuth)
    app.route('/', createUsersRouter(db))

    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await postJson(app, '/ingest-key', {}, { Authorization: `Bearer ${token}` })

    expect(res.status).toBe(201)
    const { key } = (await res.json()) as { key: string }
    expect(key).toMatch(/^sa_[A-Za-z0-9_-]{43}$/)
    const stored = set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(stored['ingestKeyHash']).toBe(hashIngestKey(key))
    expect(JSON.stringify(stored)).not.toContain(key)
  })

  it('returns 404 when the user does not exist', async () => {
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    })
    const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn().mockReturnValue({ set }), delete: vi.fn() } as unknown as DbClient
    const app = new Hono()
    app.use('/ingest-key', requireAuth)
    app.route('/', createUsersRouter(db))
    const token = await signJWT({ userId: TEST_USER_ID })
    const res = await postJson(app, '/ingest-key', {}, { Authorization: `Bearer ${token}` })
    expect(res.status).toBe(404)
  })
})
