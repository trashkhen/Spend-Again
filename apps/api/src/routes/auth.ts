import { Hono } from 'hono'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { users } from '@spend-again/db'
import { validateBody } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { signJWT } from '../lib/jwt.js'
import { verifyTelegramAuth } from '../lib/telegram-auth.js'
import type { DbClient } from '../lib/db.js'

// ── Context variable types ─────────────────────────────────────────────────────

type AuthVariables = {
  validatedBody: unknown
  validatedQuery: unknown
  userId: string
  telegramId: string | undefined
}

type AuthEnv = {
  Variables: AuthVariables
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email().optional(),
})

const telegramLoginSchema = z.object({
  id: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number().int().min(1),
  hash: z.string(),
})

const linkTelegramSchema = z.object({
  telegramId: z.string(),
  username: z.string().optional(),
})

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * Creates the /api/auth router.
 * Accepts a DbClient so the router can be tested with a mock in isolation.
 */
export function createAuthRouter(db: DbClient): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>()

  /**
   * POST /api/auth/register
   * Creates a new user (optionally with email), returns a signed JWT.
   */
  router.post('/register', validateBody(registerSchema), async (c) => {
    const input = c.get('validatedBody') as z.infer<typeof registerSchema>

    const rows = await db
      .insert(users)
      .values({
        email: input.email ?? null,
      })
      .returning()

    const user = rows[0]
    if (!user) {
      return c.json({ error: 'Failed to create user', code: 'INSERT_FAILED' }, 500)
    }

    const token = await signJWT({ userId: user.id })
    return c.json({ token, userId: user.id }, 201)
  })

  /**
   * POST /api/auth/telegram-login
   * Validates Telegram Login Widget data (hash check), upserts user, returns JWT.
   *
   * Body shape mirrors the Telegram Login Widget callback object:
   * { id, first_name?, last_name?, username?, photo_url?, auth_date, hash }
   */
  router.post('/telegram-login', validateBody(telegramLoginSchema), async (c) => {
    const input = c.get('validatedBody') as z.infer<typeof telegramLoginSchema>

    // Convert all values to strings for hash validation (Telegram spec requires this)
    const dataForVerification: Record<string, string> = {
      id: input.id,
      auth_date: String(input.auth_date),
      hash: input.hash,
    }
    if (input.first_name !== undefined) dataForVerification['first_name'] = input.first_name
    if (input.last_name !== undefined) dataForVerification['last_name'] = input.last_name
    if (input.username !== undefined) dataForVerification['username'] = input.username
    if (input.photo_url !== undefined) dataForVerification['photo_url'] = input.photo_url

    if (!verifyTelegramAuth(dataForVerification)) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_TELEGRAM_HASH' }, 401)
    }

    // Upsert: if a user with this telegram_id exists, update username; otherwise insert
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, input.id))
      .limit(1)

    let userId: string

    if (existing[0]) {
      userId = existing[0].id

      // Update username if provided
      await db
        .update(users)
        .set({
          telegramUsername: input.username ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, userId))
    } else {
      const rows = await db
        .insert(users)
        .values({
          telegramId: input.id,
          telegramUsername: input.username ?? null,
        })
        .returning()

      const newUser = rows[0]
      if (!newUser) {
        return c.json({ error: 'Failed to create user', code: 'INSERT_FAILED' }, 500)
      }
      userId = newUser.id
    }

    const token = await signJWT({ userId, telegramId: input.id })
    return c.json({
      token,
      userId,
      telegramFirstName: input.first_name ?? null,
      telegramUsername: input.username ?? null,
    }, 200)
  })

  /**
   * POST /api/auth/link-telegram
   * Links a Telegram ID to the authenticated user's account.
   * Requires a valid JWT (via requireAuth middleware).
   */
  router.post('/link-telegram', requireAuth, validateBody(linkTelegramSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof linkTelegramSchema>

    const conflict = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, input.telegramId))
      .limit(1)

    if (conflict[0] !== undefined && conflict[0].id !== userId) {
      return c.json(
        { error: 'Telegram ID already linked to another account', code: 'TELEGRAM_ID_ALREADY_CLAIMED' },
        409,
      )
    }

    const rows = await db
      .update(users)
      .set({
        telegramId: input.telegramId,
        telegramUsername: input.username ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId))
      .returning()

    if (!rows[0]) {
      return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
    }

    const token = await signJWT({ userId, telegramId: input.telegramId })
    return c.json({ success: true, token }, 200)
  })

  /**
   * POST /api/auth/dev-login
   * Development-only endpoint — creates or retrieves the fixed test user and returns a JWT.
   * Returns 404 in production to prevent accidental exposure.
   */
  router.post('/dev-login', async (c) => {
    if (process.env['NODE_ENV'] === 'production') {
      return c.json({ error: 'Not found' }, 404)
    }

    const DEV_TELEGRAM_ID = '__dev_test__'

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, DEV_TELEGRAM_ID))
      .limit(1)

    let userId: string

    if (existing[0]) {
      userId = existing[0].id
    } else {
      const rows = await db
        .insert(users)
        .values({ telegramId: DEV_TELEGRAM_ID })
        .returning()

      const newUser = rows[0]
      if (!newUser) {
        return c.json({ error: 'Failed to create test user', code: 'INSERT_FAILED' }, 500)
      }
      userId = newUser.id
    }

    const token = await signJWT({ userId, telegramId: DEV_TELEGRAM_ID })
    return c.json({ token, userId }, 200)
  })

  return router
}
