# PR 2: Recurring Payments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring payments with auto-create: a new DB table, CRUD API, dashboard Recurring page, daily cron that auto-creates transactions, and a multi-step Telegram bot flow to manage subscriptions.

**Architecture:** `recurring_payments` table stores schedules. A daily `setInterval` cron in the API server calls `TransactionService.create` directly for each overdue payment and advances `nextDueDate`. The bot uses a conversation state machine (`pendingRecurring` Map) to collect subscription details over multiple messages before posting to the API. The dashboard Recurring page is a standalone React page with its own API client module.

**Tech Stack:** Drizzle ORM, Hono + Zod, grammY (inline keyboards + conversation state), React, Vitest

**Prerequisite:** PR 1 must be merged and deployed first (description column in transactions, 'recurring' source type in API).

---

## File Map

| File | Action |
|---|---|
| `packages/db/src/schema.ts` | Add `recurring_payments` table |
| `apps/api/src/services/recurring.ts` | NEW — CRUD + processOverdue |
| `apps/api/src/routes/recurring.ts` | NEW — /api/recurring router |
| `apps/api/src/lib/recurring-cron.ts` | NEW — daily auto-create cron |
| `apps/api/src/index.ts` | Register router + start cron |
| `packages/shared/src/types.ts` | Add ApiRecurring type |
| `apps/dashboard/src/lib/api-recurring.ts` | NEW — dashboard API client for recurring |
| `apps/dashboard/src/pages/Recurring.tsx` | Replace placeholder with full page |
| `apps/bot/src/handlers/recurring.ts` | NEW — /recurring command + conversation flow |
| `apps/bot/src/bot.ts` | Register /recurring and recurring callbacks |

---

## Task 1: DB — create recurring_payments table

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Verify recurring_payments does not already exist**

  Via Supabase MCP execute_sql:
  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'recurring_payments';
  ```
  Expected: zero rows.

- [ ] **Step 2: Add the table to schema.ts**

  In `packages/db/src/schema.ts`, add after the existing table definitions:
  ```typescript
  export const recurringPayments = pgTable('recurring_payments', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amountCents: integer('amount_cents').notNull(),
    category: text('category').notNull(),
    subCategory: text('sub_category').notNull(),
    description: text('description'),
    frequency: text('frequency').notNull(), // 'weekly'|'fortnightly'|'monthly'|'quarterly'|'yearly'
    nextDueDate: date('next_due_date', { mode: 'string' }).notNull(), // YYYY-MM-DD
    isActive: integer('is_active').notNull().default(1), // 1=active, 0=paused (boolean via integer for broad compat)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  })

  export type RecurringPayment = typeof recurringPayments.$inferSelect
  export type NewRecurringPayment = typeof recurringPayments.$inferInsert
  ```

  Note: `isActive` stored as integer (1/0) to avoid needing the `boolean` pg-core import; treated as boolean in service layer.

- [ ] **Step 3: Generate migration SQL**

  ```bash
  pnpm --filter @spend-again/db generate
  ```
  Expected: new migration file in `packages/db/drizzle/` with a `CREATE TABLE "recurring_payments"` statement.

- [ ] **Step 4: Apply migration via Supabase MCP**

  Use `apply_migration` with name `create_recurring_payments` and the generated SQL (the full CREATE TABLE statement from the migration file).

- [ ] **Step 5: Verify**

  Via Supabase MCP execute_sql:
  ```sql
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'recurring_payments' ORDER BY ordinal_position;
  ```
  Expected: id, user_id, name, amount_cents, category, sub_category, description, frequency, next_due_date, is_active, created_at, updated_at.

- [ ] **Step 6: Export from db package index**

  In `packages/db/src/index.ts`, make sure `recurringPayments`, `RecurringPayment`, `NewRecurringPayment` are exported. Add them if missing:
  ```typescript
  export { recurringPayments } from './schema.js'
  export type { RecurringPayment, NewRecurringPayment } from './schema.js'
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/db/src/schema.ts packages/db/src/index.ts packages/db/drizzle/
  git commit -m "feat: add recurring_payments table to schema and migration"
  ```

---

## Task 2: API service — recurring CRUD + processOverdue

**Files:**
- Create: `apps/api/src/services/recurring.ts`
- Test: `apps/api/__tests__/recurring.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `apps/api/__tests__/recurring.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach } from 'vitest'
  import { createRecurringService } from '../src/services/recurring.js'
  import { advanceByFrequency } from '../src/services/recurring.js'

  describe('advanceByFrequency', () => {
    it('advances weekly by 7 days', () => {
      expect(advanceByFrequency('2026-06-01', 'weekly')).toBe('2026-06-08')
    })
    it('advances fortnightly by 14 days', () => {
      expect(advanceByFrequency('2026-06-01', 'fortnightly')).toBe('2026-06-15')
    })
    it('advances monthly by 1 calendar month', () => {
      expect(advanceByFrequency('2026-01-31', 'monthly')).toBe('2026-02-28')
    })
    it('advances quarterly by 3 months', () => {
      expect(advanceByFrequency('2026-01-15', 'quarterly')).toBe('2026-04-15')
    })
    it('advances yearly by 1 year', () => {
      expect(advanceByFrequency('2026-06-01', 'yearly')).toBe('2027-06-01')
    })
  })
  ```

- [ ] **Step 2: Run to confirm tests fail**

  ```bash
  pnpm --filter @spend-again/api test -- --reporter=verbose 2>&1 | grep -A3 advanceByFrequency
  ```
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

  Create `apps/api/src/services/recurring.ts`:
  ```typescript
  import { eq, and, lte } from 'drizzle-orm'
  import { sql } from 'drizzle-orm'
  import { recurringPayments } from '@spend-again/db'
  import type { RecurringPayment } from '@spend-again/db'
  import type { DbClient } from '../lib/db.js'
  import type { TransactionService } from './transactions.js'
  import { getTodayDDMMYYYY } from '@spend-again/shared'

  export type CreateRecurringInput = {
    userId: string
    name: string
    amountCents: number
    category: string
    subCategory: string
    description?: string
    frequency: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly'
    startDate: string // YYYY-MM-DD
  }

  export type UpdateRecurringInput = {
    name?: string
    amountCents?: number
    category?: string
    subCategory?: string
    description?: string
    frequency?: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly'
    isActive?: boolean
  }

  export function advanceByFrequency(dateStr: string, frequency: string): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1))

    switch (frequency) {
      case 'weekly':      date.setUTCDate(date.getUTCDate() + 7); break
      case 'fortnightly': date.setUTCDate(date.getUTCDate() + 14); break
      case 'monthly':     date.setUTCMonth(date.getUTCMonth() + 1); break
      case 'quarterly':   date.setUTCMonth(date.getUTCMonth() + 3); break
      case 'yearly':      date.setUTCFullYear(date.getUTCFullYear() + 1); break
    }

    return date.toISOString().slice(0, 10)
  }

  function isoToDDMMYYYY(iso: string): string {
    const [y, m, d] = iso.split('-')
    return `${d ?? '01'}/${m ?? '01'}/${y ?? '2026'}`
  }

  export interface RecurringService {
    create(input: CreateRecurringInput): Promise<RecurringPayment>
    listByUser(userId: string): Promise<RecurringPayment[]>
    update(id: string, userId: string, input: UpdateRecurringInput): Promise<RecurringPayment | null>
    remove(id: string, userId: string): Promise<boolean>
    processOverdue(txService: TransactionService): Promise<void>
  }

  export function createRecurringService(db: DbClient): RecurringService {
    return {
      async create(input: CreateRecurringInput): Promise<RecurringPayment> {
        const rows = await db
          .insert(recurringPayments)
          .values({
            userId: input.userId,
            name: input.name,
            amountCents: input.amountCents,
            category: input.category,
            subCategory: input.subCategory,
            description: input.description ?? null,
            frequency: input.frequency,
            nextDueDate: input.startDate,
            isActive: 1,
          })
          .returning()

        const row = rows[0]
        if (!row) throw new Error('Insert returned no rows')
        return row
      },

      async listByUser(userId: string): Promise<RecurringPayment[]> {
        return db
          .select()
          .from(recurringPayments)
          .where(eq(recurringPayments.userId, userId))
          .orderBy(recurringPayments.nextDueDate)
      },

      async update(id: string, userId: string, input: UpdateRecurringInput): Promise<RecurringPayment | null> {
        const patch: Record<string, unknown> = {}
        if (input.name !== undefined)        patch['name'] = input.name
        if (input.amountCents !== undefined) patch['amountCents'] = input.amountCents
        if (input.category !== undefined)    patch['category'] = input.category
        if (input.subCategory !== undefined) patch['subCategory'] = input.subCategory
        if (input.description !== undefined) patch['description'] = input.description
        if (input.frequency !== undefined)   patch['frequency'] = input.frequency
        if (input.isActive !== undefined)    patch['isActive'] = input.isActive ? 1 : 0

        if (Object.keys(patch).length === 0) {
          const rows = await db.select().from(recurringPayments)
            .where(and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)))
            .limit(1)
          return rows[0] ?? null
        }

        patch['updatedAt'] = sql`now()`

        const rows = await db
          .update(recurringPayments)
          .set(patch)
          .where(and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)))
          .returning()

        return rows[0] ?? null
      },

      async remove(id: string, userId: string): Promise<boolean> {
        const rows = await db
          .delete(recurringPayments)
          .where(and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)))
          .returning({ id: recurringPayments.id })
        return rows.length > 0
      },

      async processOverdue(txService: TransactionService): Promise<void> {
        const today = new Date().toISOString().slice(0, 10)

        const overdueRows = await db
          .select()
          .from(recurringPayments)
          .where(
            and(
              eq(recurringPayments.isActive, 1),
              lte(recurringPayments.nextDueDate, today),
            ),
          )

        for (const payment of overdueRows) {
          await txService.create({
            userId: payment.userId,
            amountCents: payment.amountCents,
            item: payment.name,
            description: payment.description ?? undefined,
            category: payment.category,
            subCategory: payment.subCategory,
            date: isoToDDMMYYYY(today),
            source: 'recurring',
          })

          const nextDate = advanceByFrequency(today, payment.frequency)
          await db
            .update(recurringPayments)
            .set({ nextDueDate: nextDate, updatedAt: sql`now()` })
            .where(eq(recurringPayments.id, payment.id))
        }
      },
    }
  }
  ```

- [ ] **Step 4: Run tests**

  ```bash
  pnpm --filter @spend-again/api test
  ```
  Expected: all pass including advanceByFrequency tests.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/services/recurring.ts apps/api/__tests__/recurring.test.ts
  git commit -m "feat: add recurring payments service with CRUD and processOverdue"
  ```

---

## Task 3: API router — /api/recurring

**Files:**
- Create: `apps/api/src/routes/recurring.ts`

- [ ] **Step 1: Create the router**

  Create `apps/api/src/routes/recurring.ts`:
  ```typescript
  import { Hono } from 'hono'
  import { z } from 'zod'
  import { validateBody } from '../middleware/validate.js'
  import { createRecurringService } from '../services/recurring.js'
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
  ```

- [ ] **Step 2: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/api/src/routes/recurring.ts
  git commit -m "feat: add /api/recurring CRUD router"
  ```

---

## Task 4: API — recurring cron

**Files:**
- Create: `apps/api/src/lib/recurring-cron.ts`

- [ ] **Step 1: Create the cron module**

  Create `apps/api/src/lib/recurring-cron.ts`:
  ```typescript
  import { createLogger } from '@spend-again/shared'
  import { createRecurringService } from '../services/recurring.js'
  import { createTransactionService } from '../services/transactions.js'
  import type { DbClient } from './db.js'

  const log = createLogger('api:recurring-cron')
  const INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

  export function startRecurringCron(db: DbClient): void {
    const run = async () => {
      try {
        log.info('running recurring payments check')
        const recurringService = createRecurringService(db)
        const txService = createTransactionService(db)
        await recurringService.processOverdue(txService)
        log.info('recurring payments check complete')
      } catch (err) {
        log.error({ err }, 'recurring cron error')
      }
    }

    void run()
    setInterval(() => void run(), INTERVAL_MS)
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add apps/api/src/lib/recurring-cron.ts
  git commit -m "feat: add daily cron to auto-create recurring transactions"
  ```

---

## Task 5: API index — register router and start cron

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Register the recurring router and start the cron**

  In `apps/api/src/index.ts`, add imports:
  ```typescript
  import { createRecurringRouter } from './routes/recurring.js'
  import { startRecurringCron } from './lib/recurring-cron.js'
  ```

  After the existing `app.route('/api/learned-mappings', ...)` line, add:
  ```typescript
  app.use('/api/recurring', requireAuth, rateLimitMiddleware)
  app.use('/api/recurring/*', requireAuth, rateLimitMiddleware)
  app.route('/api/recurring', createRecurringRouter(db))
  ```

  After the `serve(...)` call, add:
  ```typescript
  startRecurringCron(db)
  ```

- [ ] **Step 2: Run API tests**

  ```bash
  pnpm --filter @spend-again/api test
  ```
  Expected: all pass.

- [ ] **Step 3: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/api/src/index.ts
  git commit -m "feat: register /api/recurring router and start recurring cron at startup"
  ```

---

## Task 6: Shared types — ApiRecurring

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add ApiRecurring type**

  In `packages/shared/src/types.ts`, add after `ApiTransaction`:
  ```typescript
  export type RecurringFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly'

  export type ApiRecurring = {
    id: string
    userId: string
    name: string
    amountCents: number
    amount: string          // decimal string e.g. "18.98"
    category: string
    subCategory: string
    description?: string | null
    frequency: RecurringFrequency
    nextDueDate: string     // YYYY-MM-DD
    isActive: number        // 1 = active, 0 = paused
    createdAt: string
    updatedAt: string
  }
  ```

  Also export it from `packages/shared/src/index.ts` if it's not already re-exported automatically.

- [ ] **Step 2: Commit**

  ```bash
  git add packages/shared/src/types.ts
  git commit -m "feat: add ApiRecurring and RecurringFrequency shared types"
  ```

---

## Task 7: Dashboard API client — recurring endpoints

**Files:**
- Create: `apps/dashboard/src/lib/api-recurring.ts`

- [ ] **Step 1: Create recurring API client module**

  Create `apps/dashboard/src/lib/api-recurring.ts`:
  ```typescript
  import { authHeader } from './auth'
  import type { ApiRecurring, RecurringFrequency } from '@spend-again/shared'

  const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001'

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
        ...init?.headers,
      },
    })
    if (!response.ok) {
      let msg = `HTTP ${response.status}`
      try { msg = ((await response.json()) as { error: string }).error ?? msg } catch { /* */ }
      throw new Error(msg)
    }
    return response.json() as Promise<T>
  }

  export type CreateRecurringPayload = {
    name: string
    amountCents: number
    category: string
    subCategory: string
    description?: string
    frequency: RecurringFrequency
    startDate: string // YYYY-MM-DD
  }

  export type UpdateRecurringPayload = {
    name?: string
    amountCents?: number
    category?: string
    subCategory?: string
    description?: string
    frequency?: RecurringFrequency
    isActive?: boolean
  }

  export async function listRecurring(): Promise<ApiRecurring[]> {
    return apiFetch<ApiRecurring[]>('/api/recurring')
  }

  export async function createRecurring(data: CreateRecurringPayload): Promise<ApiRecurring> {
    return apiFetch<ApiRecurring>('/api/recurring', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  export async function updateRecurring(id: string, data: UpdateRecurringPayload): Promise<ApiRecurring> {
    return apiFetch<ApiRecurring>(`/api/recurring/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  export async function deleteRecurring(id: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/recurring/${id}`, { method: 'DELETE' })
  }
  ```

- [ ] **Step 2: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/dashboard/src/lib/api-recurring.ts
  git commit -m "feat: add dashboard API client for recurring payments"
  ```

---

## Task 8: Dashboard — Recurring page

**Files:**
- Modify: `apps/dashboard/src/pages/Recurring.tsx` (replace placeholder)

- [ ] **Step 1: Replace the placeholder with the full page**

  Replace `apps/dashboard/src/pages/Recurring.tsx` entirely:
  ```tsx
  import { useState, useEffect } from 'react'
  import { CATEGORIES, CATEGORY_MAP } from '@spend-again/shared'
  import type { ApiRecurring, Category, RecurringFrequency } from '@spend-again/shared'
  import { Layout } from '../components/Layout'
  import {
    listRecurring,
    createRecurring,
    updateRecurring,
    deleteRecurring,
  } from '../lib/api-recurring'

  const FREQUENCIES: RecurringFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']

  function formatNextDue(dateStr: string): string {
    const parts = dateStr.split('-')
    if (parts.length !== 3) return dateStr
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const [y, m, d] = parts
    return `${parseInt(d ?? '1', 10)} ${months[(parseInt(m ?? '1', 10) - 1)] ?? m} ${y}`
  }

  function monthlyEquivalent(amountCents: number, frequency: RecurringFrequency): number {
    switch (frequency) {
      case 'weekly':      return Math.round(amountCents * 52 / 12)
      case 'fortnightly': return Math.round(amountCents * 26 / 12)
      case 'monthly':     return amountCents
      case 'quarterly':   return Math.round(amountCents / 3)
      case 'yearly':      return Math.round(amountCents / 12)
    }
  }

  function formatAmount(amountCents: number): string {
    return `S$${(amountCents / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  type ModalMode = 'create' | 'edit'
  type ModalState = { mode: ModalMode; item?: ApiRecurring } | null

  function RecurringModal({
    mode,
    item,
    onSave,
    onClose,
  }: {
    mode: ModalMode
    item?: ApiRecurring
    onSave: (data: Parameters<typeof createRecurring>[0]) => Promise<void>
    onClose: () => void
  }) {
    const initCategory = (item?.category as Category | undefined) ?? 'Food'
    const [name, setName] = useState(item?.name ?? '')
    const [amount, setAmount] = useState(item ? (item.amountCents / 100).toFixed(2) : '')
    const [category, setCategory] = useState<string>(initCategory)
    const [subCategory, setSubCategory] = useState(
      item?.subCategory ?? (CATEGORY_MAP[initCategory as Category]?.[0] ?? 'Other')
    )
    const [description, setDescription] = useState(item?.description ?? '')
    const [frequency, setFrequency] = useState<RecurringFrequency>(item?.frequency ?? 'monthly')
    const [startDate, setStartDate] = useState(() => {
      if (item?.nextDueDate) return item.nextDueDate
      return new Date().toISOString().slice(0, 10)
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    function handleCategoryChange(cat: string) {
      setCategory(cat)
      setSubCategory((CATEGORY_MAP[cat as Category]?.[0] ?? 'Other') as string)
    }

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault()
      if (!name.trim() || !amount) return
      const amountNum = parseFloat(amount)
      if (isNaN(amountNum) || amountNum <= 0) { setError('Amount must be positive'); return }
      setSaving(true)
      setError(null)
      try {
        await onSave({
          name: name.trim(),
          amountCents: Math.round(amountNum * 100),
          category,
          subCategory,
          description: description.trim() || undefined,
          frequency,
          startDate,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
        setSaving(false)
      }
    }

    return (
      <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-header">
            <h2 className="modal-title">{mode === 'create' ? 'Add Subscription' : 'Edit Subscription'}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <form onSubmit={(e) => { void handleSubmit(e) }}>
            <div className="modal-body">
              {error && <div className="modal-error" role="alert">{error}</div>}
              <div className="form-group">
                <label className="form-label" htmlFor="rec-name">Name</label>
                <input id="rec-name" type="text" className="form-input" placeholder="e.g. Netflix" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="rec-amount">Amount (SGD)</label>
                  <input id="rec-amount" type="number" className="form-input" placeholder="0.00" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rec-frequency">Frequency</label>
                  <select id="rec-frequency" className="form-select" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                    {FREQUENCIES.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="rec-category">Category</label>
                  <select id="rec-category" className="form-select" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rec-subcategory">Sub-category</label>
                  <select id="rec-subcategory" className="form-select" value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
                    {(CATEGORY_MAP[category as Category] ?? ['Other']).map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rec-start">Next due date</label>
                <input id="rec-start" type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rec-desc">Description <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span></label>
                <input id="rec-desc" type="text" className="form-input" placeholder="e.g. Family plan" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-save" disabled={saving}>{saving ? 'Saving…' : mode === 'create' ? 'Add Subscription' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  export function Recurring() {
    const [items, setItems] = useState<ApiRecurring[]>([])
    const [loading, setLoading] = useState(true)
    const [modal, setModal] = useState<ModalState>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    useEffect(() => {
      let cancelled = false
      setLoading(true)
      void listRecurring().then((data) => {
        if (!cancelled) { setItems(data); setLoading(false) }
      }).catch(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [])

    const activeItems = items.filter((i) => i.isActive === 1)
    const monthlyCostCents = activeItems.reduce(
      (sum, i) => sum + monthlyEquivalent(i.amountCents, i.frequency),
      0,
    )

    async function handleSave(data: Parameters<typeof createRecurring>[0]) {
      if (modal?.mode === 'edit' && modal.item) {
        const updated = await updateRecurring(modal.item.id, data)
        setItems((prev) => prev.map((i) => i.id === updated.id ? updated : i))
      } else {
        const created = await createRecurring(data)
        setItems((prev) => [...prev, created])
      }
      setModal(null)
    }

    async function handleTogglePause(item: ApiRecurring) {
      const updated = await updateRecurring(item.id, { isActive: item.isActive !== 1 })
      setItems((prev) => prev.map((i) => i.id === updated.id ? updated : i))
    }

    async function handleDelete(id: string) {
      await deleteRecurring(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setConfirmDeleteId(null)
    }

    return (
      <Layout>
        <div className="app-main page-enter">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{ color: 'var(--color-accent)', marginBottom: 2 }}>Recurring Payments</h2>
              {!loading && activeItems.length > 0 && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                  Monthly cost (active): <strong style={{ color: 'var(--color-accent)' }}>{formatAmount(monthlyCostCents)}</strong>
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn-save"
              onClick={() => setModal({ mode: 'create' })}
              style={{ flexShrink: 0 }}
            >
              + Add Subscription
            </button>
          </div>

          {loading ? (
            <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
          ) : items.length === 0 ? (
            <div className="table-state table-state--empty">
              <p className="table-empty-message">No recurring payments yet. Add your first subscription!</p>
            </div>
          ) : (
            <div className="tx-list-card">
              <ul className="tx-list" role="list">
                {items.map((item) => (
                  <li key={item.id} className="tx-row" style={{ opacity: item.isActive === 1 ? 1 : 0.5 }}>
                    <div className="tx-row-left">
                      <div className="tx-row-text">
                        <span className="tx-item-name">{item.name}</span>
                        <span className="tx-item-meta">
                          <span className="tx-category-name">{item.category}</span>
                          {item.subCategory ? <span className="tx-subcategory"> / {item.subCategory}</span> : null}
                          {' · '}{item.frequency} · Next: {formatNextDue(item.nextDueDate)}
                          {item.isActive !== 1 ? ' · ⏸ Paused' : null}
                        </span>
                      </div>
                    </div>
                    <div className="tx-row-right">
                      <span className="tx-amount">{formatAmount(item.amountCents)}</span>
                      <div className="tx-row-actions">
                        <button type="button" className="tx-action-btn" onClick={() => setModal({ mode: 'edit', item })} title="Edit">✏️</button>
                        <button type="button" className="tx-action-btn" onClick={() => void handleTogglePause(item)} title={item.isActive === 1 ? 'Pause' : 'Resume'}>
                          {item.isActive === 1 ? '⏸' : '▶️'}
                        </button>
                        {confirmDeleteId === item.id ? (
                          <div className="tx-delete-confirm">
                            <span className="tx-delete-confirm-label">Delete?</span>
                            <button type="button" className="tx-action-btn tx-action-btn--confirm-delete" onClick={() => void handleDelete(item.id)}>✓</button>
                            <button type="button" className="tx-action-btn" onClick={() => setConfirmDeleteId(null)}>✕</button>
                          </div>
                        ) : (
                          <button type="button" className="tx-action-btn tx-action-btn--delete" onClick={() => setConfirmDeleteId(item.id)} title="Delete">🗑</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {modal !== null && (
          <RecurringModal
            mode={modal.mode}
            item={modal.item}
            onSave={handleSave}
            onClose={() => setModal(null)}
          />
        )}
      </Layout>
    )
  }
  ```

- [ ] **Step 2: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/dashboard/src/pages/Recurring.tsx
  git commit -m "feat: implement Recurring payments dashboard page"
  ```

---

## Task 9: Bot — recurring handler

**Files:**
- Create: `apps/bot/src/handlers/recurring.ts`

- [ ] **Step 1: Create the handler**

  Create `apps/bot/src/handlers/recurring.ts`:
  ```typescript
  import { InlineKeyboard } from 'grammy'
  import type { Context } from 'grammy'
  import { CATEGORIES, CATEGORY_MAP, fmtSGD, getTodayDDMMYYYY } from '@spend-again/shared'
  import type { Category, RecurringFrequency } from '@spend-again/shared'
  import { MSG_NOT_REGISTERED } from '@spend-again/shared'
  import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
  import { DASHBOARD_URL } from '../lib/env.js'

  type RecurringDraft = {
    step: 'name' | 'amount' | 'awaiting_category' | 'awaiting_subcategory' | 'awaiting_frequency' | 'startDate'
    name?: string
    amountCents?: number
    category?: string
    subCategory?: string
    frequency?: RecurringFrequency
  }

  export const pendingRecurring = new Map<number, RecurringDraft>() // chatId → draft

  const FREQUENCIES: RecurringFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']

  function categoryKeyboard(): InlineKeyboard {
    const kb = new InlineKeyboard()
    const rows = []
    for (let i = 0; i < CATEGORIES.length; i += 3) {
      rows.push(CATEGORIES.slice(i, i + 3))
    }
    for (const row of rows) {
      for (const cat of row) kb.text(cat, `rec_cat:${cat}`)
      kb.row()
    }
    return kb
  }

  function subCategoryKeyboard(category: string): InlineKeyboard {
    const kb = new InlineKeyboard()
    const subs = (CATEGORY_MAP[category as Category] ?? ['Other']) as string[]
    for (const sub of subs) kb.text(sub, `rec_sub:${sub}`).row()
    return kb
  }

  function frequencyKeyboard(): InlineKeyboard {
    const kb = new InlineKeyboard()
    for (const freq of FREQUENCIES) {
      kb.text(freq.charAt(0).toUpperCase() + freq.slice(1), `rec_freq:${freq}`).row()
    }
    return kb
  }

  function formatNextDue(dateStr: string): string {
    const parts = dateStr.split('-')
    if (parts.length !== 3) return dateStr
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const [y, m, d] = parts
    return `${parseInt(d ?? '1', 10)} ${months[(parseInt(m ?? '1', 10) - 1)] ?? m} ${y}`
  }

  function isoToStartDate(): string {
    return new Date().toISOString().slice(0, 10)
  }

  function ddmmyyyyToISO(ddmmyyyy: string): string | null {
    const parts = ddmmyyyy.split('/')
    if (parts.length !== 3) return null
    const [d, m, y] = parts
    const iso = `${y}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
    return iso
  }

  async function requireAuth(ctx: Context): Promise<{ token: string; userId: string } | null> {
    const telegramId = ctx.from?.id
    if (telegramId === undefined) return null
    const token = tokenStore.get(telegramId)
    if (token === undefined) {
      await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
      return null
    }
    const userId = userIdStore.get(telegramId)
    if (userId === undefined) {
      await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
      return null
    }
    apiClient.setToken(token)
    return { token, userId }
  }

  // ── /recurring command ────────────────────────────────────────────────────────

  export async function recurringCommandHandler(ctx: Context): Promise<void> {
    const auth = await requireAuth(ctx)
    if (auth === null) return

    const items = await apiClient.listRecurring()
    const kb = new InlineKeyboard().text('\u{2795} Add Recurring', 'add_recurring')

    if (items.length === 0) {
      await ctx.reply('No recurring payments set up yet lah! \u{1F4C5}', { reply_markup: kb })
      return
    }

    const lines = items.map((item) => {
      const status = item.isActive === 1 ? '' : ' \u{23F8} Paused'
      return `\u{1F501} *${item.name}* — ${fmtSGD(item.amountCents)} (${item.frequency}) · Next: ${formatNextDue(item.nextDueDate)}${status}`
    })

    const manageKb = new InlineKeyboard()
    for (const item of items) {
      const pauseLabel = item.isActive === 1 ? `\u{23F8} Pause ${item.name}` : `\u{25B6}\u{FE0F} Resume ${item.name}`
      manageKb.text(pauseLabel, `rec_toggle:${item.id}`).row()
      manageKb.text(`\u{1F5D1} Delete ${item.name}`, `rec_delete:${item.id}`).row()
    }
    manageKb.text('\u{2795} Add Recurring', 'add_recurring')

    await ctx.reply(
      `\u{1F501} *Your Recurring Payments*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown', reply_markup: manageKb },
    )
  }

  // ── Add recurring — step 1: ask for name ─────────────────────────────────────

  export async function addRecurringStart(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id
    if (chatId === undefined) return
    await ctx.answerCallbackQuery()
    pendingRecurring.set(chatId, { step: 'name' })
    await ctx.reply(`What's the name of this payment? (e.g. Netflix, Gym, Rent)`)
  }

  // ── Handle text messages for the recurring conversation flow ──────────────────

  export async function handlePendingRecurring(ctx: Context): Promise<boolean> {
    const chatId = ctx.chat?.id
    const text = ctx.message?.text?.trim()
    if (chatId === undefined || text === undefined) return false

    const draft = pendingRecurring.get(chatId)
    if (draft === undefined) return false

    switch (draft.step) {
      case 'name': {
        draft.name = text
        draft.step = 'amount'
        await ctx.reply(`How much? (e.g. 18.98)`)
        return true
      }
      case 'amount': {
        const num = parseFloat(text)
        if (isNaN(num) || num <= 0) {
          await ctx.reply(`That doesn't look right leh. Enter just the amount, e.g. \`18.98\``, { parse_mode: 'Markdown' })
          return true
        }
        draft.amountCents = Math.round(num * 100)
        draft.step = 'awaiting_category'
        await ctx.reply(`Which category?`, { reply_markup: categoryKeyboard() })
        return true
      }
      case 'awaiting_category':
      case 'awaiting_subcategory':
      case 'awaiting_frequency': {
        await ctx.reply(`Please tap one of the buttons above to continue lah \u{1F447}`)
        return true
      }
      case 'startDate': {
        let iso: string | null = null
        if (text.toLowerCase() === 'today') {
          iso = isoToStartDate()
        } else {
          iso = ddmmyyyyToISO(text)
        }
        if (iso === null) {
          await ctx.reply(`Please send a date in DD/MM/YYYY format, or type \`today\``, { parse_mode: 'Markdown' })
          return true
        }

        const auth = await requireAuth(ctx)
        if (auth === null) { pendingRecurring.delete(chatId); return true }

        const result = await apiClient.createRecurring({
          name: draft.name ?? 'Unnamed',
          amountCents: draft.amountCents ?? 0,
          category: draft.category ?? 'Other',
          subCategory: draft.subCategory ?? 'Other',
          frequency: draft.frequency ?? 'monthly',
          startDate: iso,
        })
        pendingRecurring.delete(chatId)

        if (result === null) {
          await ctx.reply('Aiyah, could not save the recurring payment. Try again later lah! \u{1F625}')
          return true
        }

        await ctx.reply(
          `\u{2705} Recurring payment added!\n*${draft.name}* — ${fmtSGD(draft.amountCents ?? 0)} ${draft.frequency}, starting ${formatNextDue(iso)}`,
          { parse_mode: 'Markdown' },
        )
        return true
      }
      default:
        return false
    }
  }

  // ── Inline keyboard callbacks ─────────────────────────────────────────────────

  export async function recCategoryHandler(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id
    const data = ctx.callbackQuery?.data
    if (chatId === undefined || data === undefined) return
    await ctx.answerCallbackQuery()

    const category = data.replace('rec_cat:', '')
    const draft = pendingRecurring.get(chatId)
    if (draft === undefined) return

    draft.category = category
    draft.step = 'awaiting_subcategory'
    await ctx.reply(`Which sub-category for *${category}*?`, {
      parse_mode: 'Markdown',
      reply_markup: subCategoryKeyboard(category),
    })
  }

  export async function recSubCategoryHandler(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id
    const data = ctx.callbackQuery?.data
    if (chatId === undefined || data === undefined) return
    await ctx.answerCallbackQuery()

    const sub = data.replace('rec_sub:', '')
    const draft = pendingRecurring.get(chatId)
    if (draft === undefined) return

    draft.subCategory = sub
    draft.step = 'awaiting_frequency'
    await ctx.reply(`How often?`, { reply_markup: frequencyKeyboard() })
  }

  export async function recFrequencyHandler(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id
    const data = ctx.callbackQuery?.data
    if (chatId === undefined || data === undefined) return
    await ctx.answerCallbackQuery()

    const freq = data.replace('rec_freq:', '') as RecurringFrequency
    const draft = pendingRecurring.get(chatId)
    if (draft === undefined) return

    draft.frequency = freq
    draft.step = 'startDate'
    await ctx.reply(`Starting from? Send DD/MM/YYYY or type \`today\``, { parse_mode: 'Markdown' })
  }

  export async function recToggleHandler(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data
    if (data === undefined) return
    await ctx.answerCallbackQuery()

    const id = data.replace('rec_toggle:', '')
    const auth = await requireAuth(ctx)
    if (auth === null) return

    const items = await apiClient.listRecurring()
    const item = items.find((i) => i.id === id)
    if (item === undefined) { await ctx.reply('Payment not found leh.'); return }

    await apiClient.updateRecurring(id, { isActive: item.isActive !== 1 })
    const action = item.isActive === 1 ? 'Paused' : 'Resumed'
    await ctx.reply(`${action} *${item.name}* \u{2705}`, { parse_mode: 'Markdown' })
  }

  export async function recDeleteHandler(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data
    if (data === undefined) return
    await ctx.answerCallbackQuery()

    const id = data.replace('rec_delete:', '')
    const items = await apiClient.listRecurring()
    const item = items.find((i) => i.id === id)
    const name = item?.name ?? 'this payment'

    const kb = new InlineKeyboard()
      .text('\u{2705} Yes, delete', `rec_delete_yes:${id}`)
      .text('\u{274C} Cancel', 'rec_delete_cancel')

    await ctx.reply(
      `Delete *${name}*? This won't remove past transactions.`,
      { parse_mode: 'Markdown', reply_markup: kb },
    )
  }

  export async function recDeleteConfirmHandler(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data
    if (data === undefined) return
    await ctx.answerCallbackQuery()

    if (data === 'rec_delete_cancel') {
      await ctx.editMessageText('Cancelled.')
      return
    }

    const id = data.replace('rec_delete_yes:', '')
    const auth = await requireAuth(ctx)
    if (auth === null) return

    await apiClient.deleteRecurring(id)
    await ctx.editMessageText('Deleted \u{1F5D1}')
  }
  ```

- [ ] **Step 2: Add listRecurring, updateRecurring, createRecurring, deleteRecurring to bot ApiClient**

  In `apps/bot/src/lib/api-client.ts`, add these types and methods:

  First add the response types near the top of the file:
  ```typescript
  export type ApiRecurring = {
    id: string
    name: string
    amountCents: number
    category: string
    subCategory: string
    frequency: string
    nextDueDate: string
    isActive: number
  }

  export type CreateRecurringInput = {
    name: string
    amountCents: number
    category: string
    subCategory: string
    description?: string
    frequency: string
    startDate: string // YYYY-MM-DD
  }
  ```

  Add methods to the `ApiClient` class:
  ```typescript
  async listRecurring(): Promise<ApiRecurring[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/recurring`, { headers: this.buildHeaders() })
      if (!res.ok) { log.error({ status: res.status }, 'listRecurring failed'); return [] }
      return (await res.json()) as ApiRecurring[]
    } catch (err) {
      log.error({ err }, 'listRecurring error')
      return []
    }
  }

  async createRecurring(data: CreateRecurringInput): Promise<ApiRecurring | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/recurring`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(data),
      })
      if (!res.ok) { log.error({ status: res.status }, 'createRecurring failed'); return null }
      return (await res.json()) as ApiRecurring
    } catch (err) {
      log.error({ err }, 'createRecurring error')
      return null
    }
  }

  async updateRecurring(id: string, data: { isActive?: boolean; frequency?: string }): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/recurring/${id}`, {
        method: 'PUT',
        headers: this.buildHeaders(),
        body: JSON.stringify(data),
      })
    } catch (err) {
      log.error({ err }, 'updateRecurring error')
    }
  }

  async deleteRecurring(id: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/recurring/${id}`, {
        method: 'DELETE',
        headers: this.buildHeaders(),
      })
    } catch (err) {
      log.error({ err }, 'deleteRecurring error')
    }
  }
  ```

- [ ] **Step 3: Run tests**

  ```bash
  pnpm --filter @spend-again/bot test
  ```
  Expected: all pass.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/bot/src/handlers/recurring.ts apps/bot/src/lib/api-client.ts
  git commit -m "feat: add /recurring bot handler with multi-step add flow and manage callbacks"
  ```

---

## Task 10: Bot — register recurring in bot.ts

**Files:**
- Modify: `apps/bot/src/bot.ts`

- [ ] **Step 1: Register all recurring handlers**

  In `apps/bot/src/bot.ts`, add imports:
  ```typescript
  import {
    recurringCommandHandler,
    addRecurringStart,
    handlePendingRecurring,
    recCategoryHandler,
    recSubCategoryHandler,
    recFrequencyHandler,
    recToggleHandler,
    recDeleteHandler,
    recDeleteConfirmHandler,
    pendingRecurring,
  } from './handlers/recurring.js'
  ```

  Add command after the existing commands:
  ```typescript
  bot.command('recurring', recurringCommandHandler)
  ```

  Add callback registrations:
  ```typescript
  bot.callbackQuery('add_recurring', addRecurringStart)
  bot.callbackQuery(/^rec_cat:/, recCategoryHandler)
  bot.callbackQuery(/^rec_sub:/, recSubCategoryHandler)
  bot.callbackQuery(/^rec_freq:/, recFrequencyHandler)
  bot.callbackQuery(/^rec_toggle:/, recToggleHandler)
  bot.callbackQuery(/^rec_delete:/, recDeleteHandler)
  bot.callbackQuery(/^rec_delete_yes:/, recDeleteConfirmHandler)
  bot.callbackQuery('rec_delete_cancel', recDeleteConfirmHandler)
  ```

  In the `bot.on('message:text', ...)` handler, add a check for pending recurring state before the existing checks:
  ```typescript
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id
    const text = ctx.message.text ?? ''

    // Pending recurring add flow
    if (chatId !== undefined && pendingRecurring.has(chatId)) {
      await handlePendingRecurring(ctx)
      return
    }

    // ... existing pendingEdits and pendingInlineEdits checks ...
  })
  ```

- [ ] **Step 2: Run full test suite**

  ```bash
  pnpm turbo run test
  ```
  Expected: all pass.

- [ ] **Step 3: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 4: Final commit**

  ```bash
  git add apps/bot/src/bot.ts
  git commit -m "feat: register /recurring command and all recurring callbacks in bot"
  ```
