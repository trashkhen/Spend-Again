import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { createSpacesService } from '../services/spaces.js'
import type { DbClient } from '../lib/db.js'

type AppVariables = { userId: string; validatedBody: unknown; validatedQuery: unknown }
type AppEnv = { Variables: AppVariables }

const createSpaceSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(4).optional(),
  budgetCents: z.number().int().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const updateSpaceSchema = createSpaceSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
})

export function createSpacesRouter(db: DbClient): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  const svc = createSpacesService(db)

  // GET /api/spaces
  router.get('/', async (c) => {
    const userId = c.get('userId')
    return c.json(await svc.list(userId))
  })

  // GET /api/spaces/active   — MUST be before /:id to avoid route conflict
  router.get('/active', async (c) => {
    const userId = c.get('userId')
    const space = await svc.getActiveSpace(userId)
    return c.json(space ?? null)
  })

  // PUT /api/spaces/active
  router.put('/active', validateBody(z.object({ spaceId: z.string().uuid().nullable() })), async (c) => {
    const userId = c.get('userId')
    const { spaceId } = c.get('validatedBody') as { spaceId: string | null }
    await svc.setActiveSpace(userId, spaceId)
    return c.json({ ok: true })
  })

  // GET /api/spaces/window?date=YYYY-MM-DD   — MUST be before /:id
  router.get('/window', validateQuery(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })), async (c) => {
    const userId = c.get('userId')
    const { date } = c.get('validatedQuery') as { date: string }
    return c.json(await svc.findByDateWindow(userId, date))
  })

  // POST /api/spaces
  router.post('/', validateBody(createSpaceSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof createSpaceSchema>
    const space = await svc.create({ userId, ...input })
    return c.json(space, 201)
  })

  // GET /api/spaces/:id
  router.get('/:id', async (c) => {
    const userId = c.get('userId')
    const space = await svc.findById(c.req.param('id'), userId)
    if (!space) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(space)
  })

  // PATCH /api/spaces/:id
  router.patch('/:id', validateBody(updateSpaceSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof updateSpaceSchema>
    const space = await svc.update(c.req.param('id'), userId, input)
    if (!space) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(space)
  })

  // DELETE /api/spaces/:id  (archives, not hard delete)
  router.delete('/:id', async (c) => {
    const userId = c.get('userId')
    const ok = await svc.archive(c.req.param('id'), userId)
    if (!ok) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json({ ok: true })
  })

  // POST /api/spaces/:id/transactions  (attach)
  router.post('/:id/transactions', validateBody(z.object({ transactionId: z.string().uuid() })), async (c) => {
    const userId = c.get('userId')
    const { transactionId } = c.get('validatedBody') as { transactionId: string }
    const ok = await svc.attachTransaction(transactionId, c.req.param('id'), userId)
    return c.json({ ok })
  })

  // DELETE /api/spaces/:id/transactions/:txId  (detach)
  router.delete('/:id/transactions/:txId', async (c) => {
    const userId = c.get('userId')
    const ok = await svc.detachTransaction(c.req.param('txId'), c.req.param('id'), userId)
    if (!ok) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json({ ok: true })
  })

  return router
}
