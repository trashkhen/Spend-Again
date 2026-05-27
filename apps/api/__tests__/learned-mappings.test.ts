import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

// Prevent @spend-again/db from throwing "DATABASE_URL is required" at module init.
// Also mock findMapping and upsertMapping so they don't hit a real DB.
vi.mock('@spend-again/db', () => ({
  db: {},
  transactions: {},
  users: {},
  learnedMappings: {},
  userCustomCategories: {},
  findMapping: vi.fn(),
  upsertMapping: vi.fn(),
}))

import { findMapping, upsertMapping } from '@spend-again/db'
import { createLearnedMappingsRouter } from '../src/routes/learned-mappings.js'
import type { DbClient } from '../src/lib/db.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-4000-8000-000000000099'

const MAPPING_RESULT = {
  category: 'Food' as const,
  subCategory: 'Hawker' as const,
  confidence: 0.95,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeApp(userId: string | undefined = USER_ID) {
  type AppEnv = { Variables: { userId: string; telegramId: string | undefined } }
  const parent = new Hono<AppEnv>()
  if (userId !== undefined) {
    parent.use('*', async (c, next) => {
      c.set('userId', userId)
      await next()
    })
  }
  // db is passed but not used (findMapping/upsertMapping use global db)
  parent.route('/', createLearnedMappingsRouter({} as unknown as DbClient))
  return parent
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/learned-mappings/:itemName', () => {
  it('returns the mapping when found', async () => {
    vi.mocked(findMapping).mockResolvedValueOnce(MAPPING_RESULT)
    const app = makeApp()

    const res = await app.request('/chicken%20rice')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['category']).toBe('Food')
    expect(body['subCategory']).toBe('Hawker')
    expect(body['confidence']).toBe(0.95)
  })

  it('returns 404 when mapping not found', async () => {
    vi.mocked(findMapping).mockResolvedValueOnce(null)
    const app = makeApp()

    const res = await app.request('/unknown-item')
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('NOT_FOUND')
  })

  it('decodes URI-encoded item names', async () => {
    vi.mocked(findMapping).mockResolvedValueOnce(MAPPING_RESULT)
    const app = makeApp()

    await app.request('/chicken%20rice')
    expect(vi.mocked(findMapping)).toHaveBeenCalledWith('chicken rice')
  })

  it('returns 401 without auth token', async () => {
    const router = createLearnedMappingsRouter({} as unknown as DbClient)
    const res = await router.request('/chicken-rice')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/learned-mappings', () => {
  it('upserts a mapping and returns 201', async () => {
    vi.mocked(upsertMapping).mockResolvedValueOnce(undefined)
    const app = makeApp()

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemName: 'chicken rice',
        category: 'Food',
        subCategory: 'Hawker',
        source: 'user',
      }),
    })

    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body['success']).toBe(true)
    expect(vi.mocked(upsertMapping)).toHaveBeenCalledWith(
      'chicken rice',
      'Food',
      'Hawker',
      'user',
    )
  })

  it('defaults source to "user" when not provided', async () => {
    vi.mocked(upsertMapping).mockResolvedValueOnce(undefined)
    const app = makeApp()

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemName: 'kaya toast',
        category: 'Food',
        subCategory: 'Cafe',
      }),
    })

    expect(res.status).toBe(201)
    expect(vi.mocked(upsertMapping)).toHaveBeenCalledWith(
      'kaya toast',
      'Food',
      'Cafe',
      'user',
    )
  })

  it('updates (upserts) when itemName already exists', async () => {
    vi.mocked(upsertMapping).mockResolvedValueOnce(undefined)
    const app = makeApp()

    // First call
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName: 'nasi lemak', category: 'Food', subCategory: 'Hawker' }),
    })

    vi.mocked(upsertMapping).mockResolvedValueOnce(undefined)
    // Second call with same itemName but different category — should still succeed (upsert)
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName: 'nasi lemak', category: 'Food', subCategory: 'Restaurant' }),
    })

    expect(res.status).toBe(201)
  })

  it('returns 400 for invalid category', async () => {
    const app = makeApp()

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName: 'test', category: 'InvalidCategory', subCategory: 'Hawker' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for missing itemName', async () => {
    const app = makeApp()

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Food', subCategory: 'Hawker' }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 401 without auth token', async () => {
    const router = createLearnedMappingsRouter({} as unknown as DbClient)
    const res = await router.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName: 'test', category: 'Food', subCategory: 'Hawker' }),
    })
    expect(res.status).toBe(401)
  })
})
