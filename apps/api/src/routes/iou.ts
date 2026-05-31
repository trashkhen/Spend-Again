import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { createIouService } from '../services/iou.js'
import type { DbClient } from '../lib/db.js'
import type { DebtStatus } from '@spend-again/shared'

type AppEnv = { Variables: { userId: string; validatedBody: unknown; validatedQuery: unknown } }

const createDebtSchema = z.object({
  personName: z.string().min(1),
  direction: z.enum(['they_owe_me', 'i_owe_them']),
  amountCents: z.number().int().min(1),
  description: z.string().optional(),
  linkedTransactionId: z.string().uuid().optional(),
  linkedSpaceId: z.string().uuid().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const paymentSchema = z.object({
  amountCents: z.number().int().min(1),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional(),
})

export function createIouRouter(db: DbClient): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  const svc = createIouService(db)

  // GET /api/iou/people
  router.get('/people', async (c) => {
    return c.json(await svc.listPeople(c.get('userId')))
  })

  // GET /api/iou/debts?personId=...&status=...
  router.get('/debts', async (c) => {
    const userId = c.get('userId')
    const { personId, status } = c.req.query()
    return c.json(await svc.listDebts(userId, {
      ...(personId ? { personId } : {}),
      ...(status ? { status: status as DebtStatus } : {}),
    }))
  })

  // POST /api/iou/debts
  router.post('/debts', validateBody(createDebtSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof createDebtSchema>
    const person = await svc.findOrCreatePerson(userId, input.personName)
    const debt = await svc.createDebt({
      userId,
      personId: person.id,
      direction: input.direction,
      amountCents: input.amountCents,
      description: input.description ?? null,
      linkedTransactionId: input.linkedTransactionId ?? null,
      linkedSpaceId: input.linkedSpaceId ?? null,
      occurredOn: input.occurredOn,
    })
    return c.json({ debt, person }, 201)
  })

  // GET /api/iou/debts/:id
  router.get('/debts/:id', async (c) => {
    const debt = await svc.findDebt(c.req.param('id'), c.get('userId'))
    if (!debt) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(debt)
  })

  // POST /api/iou/debts/:id/payments
  router.post('/debts/:id/payments', validateBody(paymentSchema), async (c) => {
    const userId = c.get('userId')
    const { amountCents, paidOn, note } = c.get('validatedBody') as z.infer<typeof paymentSchema>
    const debt = await svc.addPayment(c.req.param('id'), userId, amountCents, paidOn, note)
    if (!debt) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(debt)
  })

  // POST /api/iou/debts/:id/settle
  router.post('/debts/:id/settle', async (c) => {
    const debt = await svc.settle(c.req.param('id'), c.get('userId'))
    if (!debt) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(debt)
  })

  return router
}
