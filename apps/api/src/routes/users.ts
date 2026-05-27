import { Hono } from 'hono'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { users } from '@spend-again/db'
import { validateBody } from '../middleware/validate.js'
import type { DbClient } from '../lib/db.js'

type UsersVariables = {
  validatedBody: unknown
  validatedQuery: unknown
  userId: string
  telegramId: string | undefined
}

type UsersEnv = { Variables: UsersVariables }

const updateBudgetSchema = z.object({
  monthlyBudget: z.number().int().min(1).nullable(),
  budgetAlertPct: z.number().int().min(1).max(200),
})

export function createUsersRouter(db: DbClient): Hono<UsersEnv> {
  const router = new Hono<UsersEnv>()

  router.get('/budget', async (c) => {
    const userId = c.get('userId')
    const rows = await db
      .select({ monthlyBudget: users.monthlyBudget, budgetAlertPct: users.budgetAlertPct })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const user = rows[0]
    if (!user) return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)

    return c.json({
      monthlyBudget: user.monthlyBudget ?? null,
      budgetAlertPct: user.budgetAlertPct ?? 100,
    })
  })

  router.put('/budget', validateBody(updateBudgetSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof updateBudgetSchema>

    const rows = await db
      .update(users)
      .set({ monthlyBudget: input.monthlyBudget, budgetAlertPct: input.budgetAlertPct, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning({ monthlyBudget: users.monthlyBudget, budgetAlertPct: users.budgetAlertPct })

    if (!rows[0]) return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)

    return c.json({
      monthlyBudget: rows[0].monthlyBudget ?? null,
      budgetAlertPct: rows[0].budgetAlertPct ?? 100,
    })
  })

  return router
}
