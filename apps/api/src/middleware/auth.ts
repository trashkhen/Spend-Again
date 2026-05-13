import type { MiddlewareHandler } from 'hono'
import { verifyJWT } from '../lib/jwt.js'

/**
 * Hono middleware that enforces JWT authentication.
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the JWT,
 * and sets `userId` and optionally `telegramId` in the Hono context variables.
 *
 * Returns 401 if the header is missing, malformed, or the token is invalid.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header('Authorization')

  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', code: 'NO_TOKEN' }, 401)
  }

  const token = auth.slice(7)
  const payload = await verifyJWT(token)

  if (!payload) {
    return c.json({ error: 'Unauthorized', code: 'INVALID_TOKEN' }, 401)
  }

  c.set('userId', payload.userId)
  if (payload.telegramId !== undefined) {
    c.set('telegramId', payload.telegramId)
  }

  await next()
}
