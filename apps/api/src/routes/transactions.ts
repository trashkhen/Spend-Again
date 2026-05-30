import { Hono } from 'hono'
import { z } from 'zod'
import { CATEGORIES, centsToDecimalString } from '@spend-again/shared'
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
  description: z.string().optional(),
  category: z.enum(CATEGORIES as readonly [string, ...string[]]),
  subCategory: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in DD/MM/YYYY format'),
  source: z.enum(['manual', 'bot', 'sms', 'ocr', 'recurring']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const updateTransactionSchema = z.object({
  amountCents: z.number().int().min(1).optional(),
  item: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.enum(CATEGORIES as readonly [string, ...string[]]).optional(),
  subCategory: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in DD/MM/YYYY format')
    .optional(),
  source: z.enum(['manual', 'bot', 'sms', 'ocr', 'recurring']).optional(),
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

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * Creates the /api/transactions router.
 * Accepts a DbClient so the router can be instantiated with a mock in tests.
 */
export function createTransactionsRouter(db: DbClient): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  const svc = createTransactionService(db)

  // POST /api/transactions
  // Wire shape: include BOTH amountCents (integer, for math) and amount
  // (decimal string, for display). Mirrors the analytics endpoints' shape.
  router.post('/', validateBody(createTransactionSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as Omit<CreateTransactionInput, 'userId'>
    const tx = await svc.create({ ...input, userId })
    return c.json({ ...tx, amount: centsToDecimalString(tx.amountCents) }, 201)
  })

  // GET /api/transactions
  router.get('/', validateQuery(listTransactionsQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.get('validatedQuery') as Omit<ListTransactionsQuery, 'userId'>
    const txs = await svc.list({ ...query, userId })
    return c.json(
      txs.map((tx) => ({
        ...tx,
        amount: centsToDecimalString(tx.amountCents),
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
    return c.json({ ...tx, amount: centsToDecimalString(tx.amountCents) })
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
    return c.json({ ...tx, amount: centsToDecimalString(tx.amountCents) })
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
