import { Hono } from 'hono'
import { z } from 'zod'
import { CATEGORIES } from '@spend-again/shared'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { createTransactionService } from '../services/transactions.js'
import type { DbClient } from '../lib/db.js'
import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  ListTransactionsQuery,
} from '../services/transactions.js'

// ── Context variable types ─────────────────────────────────────────────────────

type AppVariables = {
  validatedBody: unknown
  validatedQuery: unknown
  userId: string         // set by requireAuth middleware (applied in index.ts)
  telegramId: string | undefined
}

type AppEnv = {
  Variables: AppVariables
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

export const createTransactionSchema = z.object({
  amountCents: z.number().int().min(1),
  item: z.string().min(1),
  category: z.enum(CATEGORIES as readonly [string, ...string[]]),
  subCategory: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in DD/MM/YYYY format'),
  source: z.enum(['manual', 'bot', 'sms', 'ocr']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const updateTransactionSchema = z.object({
  amountCents: z.number().int().min(1).optional(),
  item: z.string().min(1).optional(),
  category: z.enum(CATEGORIES as readonly [string, ...string[]]).optional(),
  subCategory: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in DD/MM/YYYY format')
    .optional(),
  source: z.enum(['manual', 'bot', 'sms', 'ocr']).optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const listTransactionsQuerySchema = z.object({
  category: z.enum(CATEGORIES as readonly [string, ...string[]]).optional(),
  month: z
    .string()
    .regex(/^\d{2}$/, 'month must be 2-digit, e.g. 05')
    .optional(),
  year: z
    .string()
    .regex(/^\d{4}$/, 'year must be 4-digit, e.g. 2026')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

// ── Response helper ────────────────────────────────────────────────────────────

/**
 * Converts integer cents to a decimal SGD string, e.g. 1050 → "10.50".
 */
function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * Creates the /api/transactions router.
 * Accepts a DbClient so the router can be instantiated with a mock in tests.
 */
export function createTransactionsRouter(db: DbClient): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  const svc = createTransactionService(db)

  // POST /api/transactions
  router.post('/', validateBody(createTransactionSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as Omit<CreateTransactionInput, 'userId'>
    const tx = await svc.create({ ...input, userId })
    const { amountCents, ...rest } = tx
    return c.json({ ...rest, amount: centsToDecimalString(amountCents) }, 201)
  })

  // GET /api/transactions
  router.get('/', validateQuery(listTransactionsQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.get('validatedQuery') as Omit<ListTransactionsQuery, 'userId'>
    const txs = await svc.list({ ...query, userId })
    return c.json(
      txs.map(({ amountCents, ...rest }) => ({
        ...rest,
        amount: centsToDecimalString(amountCents),
      })),
    )
  })

  // GET /api/transactions/:id
  router.get('/:id', async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const tx = await svc.findById(id, userId)
    if (!tx) {
      return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404)
    }
    const { amountCents, ...rest } = tx
    return c.json({ ...rest, amount: centsToDecimalString(amountCents) })
  })

  // PUT /api/transactions/:id
  router.put('/:id', validateBody(updateTransactionSchema), async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const input = c.get('validatedBody') as UpdateTransactionInput
    const tx = await svc.update(id, userId, input)
    if (!tx) {
      return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404)
    }
    const { amountCents, ...rest } = tx
    return c.json({ ...rest, amount: centsToDecimalString(amountCents) })
  })

  // DELETE /api/transactions/:id
  router.delete('/:id', async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const deleted = await svc.remove(id, userId)
    if (!deleted) {
      return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404)
    }
    return c.json({ success: true })
  })

  return router
}
