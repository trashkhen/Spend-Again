import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { userCustomCategories } from '@spend-again/db'
import { validateBody } from '../middleware/validate.js'
import type { DbClient } from '../lib/db.js'

type Env = {
  Variables: {
    validatedBody: unknown
    userId: string
    telegramId: string | undefined
  }
}

const createSchema = z.object({
  category: z.string().min(1).max(60),
  subCategory: z.string().min(1).max(60),
})

export function createCustomCategoriesRouter(db: DbClient): Hono<Env> {
  const r = new Hono<Env>()

  r.get('/', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const rows = await db
      .select()
      .from(userCustomCategories)
      .where(eq(userCustomCategories.userId, userId))

    return c.json(
      rows.map((row) => ({
        id: row.id,
        category: row.category,
        subCategory: row.subCategory,
        createdAt: row.createdAt,
      })),
    )
  })

  r.post('/', validateBody(createSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const input = c.get('validatedBody') as z.infer<typeof createSchema>
    try {
      const rows = await db
        .insert(userCustomCategories)
        .values({
          userId,
          category: input.category,
          subCategory: input.subCategory,
        })
        .returning()

      const row = rows[0]
      if (!row) return c.json({ error: 'Insert failed', code: 'INSERT_FAILED' }, 500)
      return c.json(row, 201)
    } catch (err) {
      if (err instanceof Error && err.message.includes('duplicate key')) {
        return c.json({ error: 'Already exists', code: 'CONFLICT' }, 409)
      }
      throw err
    }
  })

  r.delete('/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const id = c.req.param('id')
    const result = await db
      .delete(userCustomCategories)
      .where(and(eq(userCustomCategories.id, id), eq(userCustomCategories.userId, userId)))
      .returning({ id: userCustomCategories.id })

    if (result.length === 0) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json({ success: true })
  })

  return r
}
