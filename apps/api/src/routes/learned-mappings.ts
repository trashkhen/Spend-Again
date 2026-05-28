import { Hono } from 'hono'
import { z } from 'zod'
import { findMapping, upsertMapping } from '@spend-again/db'
import { CATEGORIES } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
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
  itemName: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [string, ...string[]]),
  subCategory: z.string().min(1).max(60),
  source: z.enum(['regex', 'gemini', 'user']).optional().default('user'),
})

export function createLearnedMappingsRouter(_db: DbClient): Hono<Env> {
  const r = new Hono<Env>()

  // NOTE: learned_mappings is intentionally a global table for this single-tenant
  // deployment (see codex-review-followup-design.md §1 non-goals). When per-user
  // scoping is required, add `user_id` to the schema and filter here.
  r.get('/:itemName', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const itemName = decodeURIComponent(c.req.param('itemName'))
    if (itemName.length === 0 || itemName.length > 200) {
      return c.json({ error: 'itemName must be 1–200 chars', code: 'BAD_REQUEST' }, 400)
    }
    const result = await findMapping(itemName)
    if (result === null) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(result)
  })

  r.post('/', validateBody(createSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const input = c.get('validatedBody') as z.infer<typeof createSchema>
    await upsertMapping(
      input.itemName,
      input.category as Category,
      input.subCategory as SubCategory,
      input.source,
    )
    return c.json({ success: true }, 201)
  })

  return r
}
