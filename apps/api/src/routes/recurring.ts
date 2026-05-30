import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { createRecurringService } from '../services/recurring.js'
import { createTransactionService } from '../services/transactions.js'
import { centsToDecimalString } from '@spend-again/shared'
import type { DbClient } from '../lib/db.js'

type AppVariables = {
  validatedBody: unknown
  userId: string
}
type AppEnv = { Variables: AppVariables }

const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] as const

const createRecurringSchema = z.object({
  name: z.string().min(1),
  amountCents: z.number().int().min(1),
  category: z.string().min(1),
  subCategory: z.string().min(1),
  description: z.string().optional(),
  frequency: z.enum(FREQUENCIES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
})

const updateRecurringSchema = z.object({
  name: z.string().min(1).optional(),
  amountCents: z.number().int().min(1).optional(),
  category: z.string().min(1).optional(),
  subCategory: z.string().min(1).optional(),
  description: z.string().optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  isActive: z.boolean().optional(),
})

function withAmount(row: ReturnType<typeof Object.assign>) {
  return { ...row, amount: centsToDecimalString(row.amountCents as number) }
}

export function createRecurringRouter(db: DbClient): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  const svc = createRecurringService(db)

  router.get('/', async (c) => {
    const userId = c.get('userId')
    const rows = await svc.listByUser(userId)
    return c.json(rows.map(withAmount))
  })

  router.post('/', validateBody(createRecurringSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof createRecurringSchema>
    const row = await svc.create({ ...input, userId })

    // If the start date is today or already past, fire processOverdue immediately
    // so the first transaction is created without waiting for the nightly cron.
    const today = new Date().toISOString().slice(0, 10)
    if (input.startDate <= today) {
      const txService = createTransactionService(db)
      await svc.processOverdue(txService)
    }

    return c.json(withAmount(row), 201)
  })

  router.put('/:id', validateBody(updateRecurringSchema), async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const input = c.get('validatedBody') as z.infer<typeof updateRecurringSchema>
    const row = await svc.update(id, userId, input)
    if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(withAmount(row))
  })

  router.delete('/:id', async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const ok = await svc.remove(id, userId)
    if (!ok) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json({ success: true })
  })

  return router
}
