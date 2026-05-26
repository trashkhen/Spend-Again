# Codex Review Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute all 17 items from the 2026-05-26 code review across 5 sequential phases, ending with a unified type system, single-writer DB architecture, real `date` column, and per-user custom categories.

**Architecture:** Five sequential phases dispatched one subagent per phase via `superpowers:subagent-driven-development` in isolated git worktrees. Phase N starts only after Phase N−1 is merged green. A bot↔API↔DB integration test built in Phase 0 gates every subsequent phase.

**Tech Stack:** TypeScript strict, pnpm workspaces, Turbo, Hono + zod (API), grammY (bot), Drizzle ORM + Postgres (Supabase), Vite + React + react-router-dom v7 (dashboard), Vitest, pino (logging, added Phase 0).

**Spec:** `docs/superpowers/specs/2026-05-26-codex-review-followup-design.md`

---

## File structure

### New files
- `apps/api/__tests__/integration/round-trip.test.ts`
- `apps/api/__tests__/integration/setup.ts`
- `apps/api/src/routes/custom-categories.ts`
- `apps/api/src/routes/learned-mappings.ts`
- `apps/api/__tests__/custom-categories.test.ts`
- `apps/api/__tests__/learned-mappings.test.ts`
- `packages/db/drizzle/0002_add_occurred_on.sql`
- `packages/db/drizzle/0003_user_custom_categories.sql`
- `packages/db/drizzle/0004_drop_text_date.sql`
- `packages/shared/src/logger.ts`
- `packages/shared/src/dates.ts`
- `packages/shared/src/format.ts`
- `packages/shared/src/category-emoji.ts`
- `packages/shared/src/env.ts`

### Deleted files
- `packages/parser/src/learned.ts`
- `apps/dashboard/src/pages/Settings.tsx`

### Heavy modifications
- `packages/shared/src/types.ts` — rewrite as wire DTOs
- `packages/shared/src/categories.ts` — move Books to Shopping
- `packages/shared/src/errors.ts` — drop hardcoded RPM string
- `packages/parser/src/index.ts` — `parse()` accepts injected lookup
- `packages/parser/src/gemini.ts` — error dedupe, prompt fix, constant interpolation
- `packages/parser/src/ocr.ts` — error dedupe, prompt fix, constant interpolation
- `packages/db/src/schema.ts` — `occurredOn`, `userCustomCategories`
- `apps/api/src/index.ts` — middleware ordering
- `apps/api/src/services/transactions.ts` — dual-write, then drop
- `apps/api/src/routes/transactions.ts` — pagination, ordering
- `apps/api/src/routes/analytics.ts` — read cutover to `occurred_on`
- `apps/bot/src/handlers/receipt-confirm.ts` — userId fix
- `apps/bot/src/handlers/confirm.ts` — callback_data fix, saveLearnedMapping wiring
- `apps/bot/src/handlers/expense.ts` — inject lookup into parse
- `apps/bot/src/lib/api-client.ts` — getLearnedMapping, drop direct db
- `apps/dashboard/src/pages/Welcome.tsx` — fix render-time navigate
- `apps/dashboard/src/components/TransactionModal.tsx` — server-backed custom categories
- `apps/dashboard/src/components/TransactionTable.tsx` — remove Income special-case
- `apps/dashboard/src/components/Sidebar.tsx` — remove Settings link
- `apps/dashboard/src/components/Header.tsx` — remove notification bell
- `apps/dashboard/src/hooks/useAuth.ts` — delete mock token

---

# Phase 0 — Safety net

**Subagent:** `general-purpose`. Worktree: `wt-phase-0-safety-net`. **Gates everything after.**

### Task 0.1: Add pino logger to shared

**Files:**
- Modify: `packages/shared/package.json`
- Create: `packages/shared/src/logger.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add pino dep**

```bash
pnpm add pino --filter @spend-again/shared
```

- [ ] **Step 2: Create logger module**

`packages/shared/src/logger.ts`:
```ts
import pino from 'pino'

export type Logger = pino.Logger

/**
 * Create a tagged logger for a service. The `service` tag appears on every log line.
 * In dev (NODE_ENV !== 'production'), pretty-prints. In prod, structured JSON.
 */
export function createLogger(service: string): Logger {
  const isProd = process.env['NODE_ENV'] === 'production'
  return pino({
    name: service,
    level: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
    ...(isProd
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  })
}
```

- [ ] **Step 3: Add pino-pretty as devDep**

```bash
pnpm add -D pino-pretty --filter @spend-again/shared
```

- [ ] **Step 4: Re-export from shared index**

In `packages/shared/src/index.ts`, append:
```ts
export * from './logger.js'
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add pino logger factory"
```

### Task 0.2: Swap console calls for logger in API and bot

**Files (all read first, then modify):**
- `apps/api/src/index.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/src/lib/jwt.ts`
- `apps/bot/src/index.ts`
- `apps/bot/src/bot.ts`
- `apps/bot/src/lib/api-client.ts`
- `apps/bot/src/lib/dev-mode.ts`
- `apps/bot/src/handlers/confirm.ts`
- `apps/bot/src/handlers/query.ts`
- `apps/bot/src/handlers/start.ts`

- [ ] **Step 1: Create logger instances at top of API entry**

In `apps/api/src/index.ts`, add near top:
```ts
import { createLogger } from '@spend-again/shared'
const log = createLogger('api')
```
Replace `console.log(\`API server running on port ${info.port}\`)` with `log.info({ port: info.port }, 'API server running')`.

- [ ] **Step 2: Replace logger usage in error-handler**

`apps/api/src/middleware/error-handler.ts`:
```ts
import { createLogger } from '@spend-again/shared'
const log = createLogger('api')
```
Replace `console.error('[API] Unhandled error:', err)` with `log.error({ err }, 'Unhandled error')`.

- [ ] **Step 3: Replace logger usage in jwt.ts**

`apps/api/src/lib/jwt.ts`:
```ts
import { createLogger } from '@spend-again/shared'
const log = createLogger('api:jwt')
```
Replace `console.warn(...)` with `log.warn(...)`. (This warning will be removed entirely in Phase 1; for now just swap the call.)

- [ ] **Step 4: Replace bot logger calls**

In each bot file listed above, add:
```ts
import { createLogger } from '@spend-again/shared'
const log = createLogger('bot')   // or 'bot:query', 'bot:api-client', etc.
```
Replace every `console.error(prefix, ...args)` with `log.error({ /* structured fields */ }, message)`. Drop the `[prefix]` strings — the logger now tags them.

Example for `api-client.ts`:
```ts
// before
console.error('[ApiClient] createTransaction failed:', res.status, await res.text())
// after
log.error({ status: res.status, body: await res.text() }, 'createTransaction failed')
```

- [ ] **Step 5: Lint and confirm no `console.` in src dirs**

```bash
pnpm turbo run lint
grep -rn "console\." apps/api/src apps/bot/src packages/shared/src packages/parser/src packages/db/src
```
Expected: no matches in those paths (dashboard's `console.warn` is allowed; gemini.ts's `console.error` stays for now — it's mid-refactor).

Actually update gemini.ts and ocr.ts too — same pattern, `createLogger('parser:gemini')`.

- [ ] **Step 6: Commit**

```bash
git add apps/ packages/
git commit -m "refactor: replace console with pino logger across api, bot, parser"
```

### Task 0.3: Integration test scaffold

**Files:**
- Create: `apps/api/__tests__/integration/setup.ts`
- Create: `apps/api/__tests__/integration/round-trip.test.ts`
- Modify: `apps/api/vitest.config.ts`

- [ ] **Step 1: Read existing vitest config**

```bash
cat apps/api/vitest.config.ts
```
Note the existing test glob and any setup.

- [ ] **Step 2: Create setup helpers**

`apps/api/__tests__/integration/setup.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '@spend-again/db/src/schema.js'

export type IntegrationDb = ReturnType<typeof drizzle<typeof schema>>

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export function requireTestDatabaseUrl(): string {
  if (!TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests. ' +
      'Point it at a disposable Postgres instance (NOT prod).',
    )
  }
  return TEST_DATABASE_URL
}

export async function setupTestDb(): Promise<{
  db: IntegrationDb
  cleanup: () => Promise<void>
}> {
  const url = requireTestDatabaseUrl()
  const sql = postgres(url, { max: 2 })
  const db = drizzle(sql, { schema })
  await migrate(db, { migrationsFolder: '../../packages/db/drizzle' })
  // Wipe all tables for a clean slate per test run
  await sql`TRUNCATE users, transactions, learned_mappings RESTART IDENTITY CASCADE`
  return { db, cleanup: async () => { await sql.end() } }
}
```

- [ ] **Step 3: Write the round-trip test**

`apps/api/__tests__/integration/round-trip.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, type IntegrationDb } from './setup.js'
import { createTransactionsRouter } from '../../src/routes/transactions.js'
import { createAuthRouter } from '../../src/routes/auth.js'
import { createAnalyticsRouter } from '../../src/routes/analytics.js'
import { Hono } from 'hono'
import { requireAuth } from '../../src/middleware/auth.js'
import { signJWT } from '../../src/lib/jwt.js'

describe('integration: bot ↔ API ↔ DB round trip', () => {
  let db: IntegrationDb
  let cleanup: () => Promise<void>
  let app: Hono
  let userId: string
  let token: string

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'integration-test-secret'
    const setup = await setupTestDb()
    db = setup.db
    cleanup = setup.cleanup

    // Seed a user
    const [user] = await db.insert((await import('@spend-again/db/src/schema.js')).users).values({
      telegramId: '99999',
      telegramUsername: 'integration_test',
    }).returning()
    if (!user) throw new Error('Failed to seed user')
    userId = user.id
    token = await signJWT({ userId, telegramId: '99999' })

    // Build a Hono app wiring the routers under test
    app = new Hono()
    app.use('/api/transactions/*', requireAuth)
    app.use('/api/analytics/*', requireAuth)
    app.route('/api/transactions', createTransactionsRouter(db))
    app.route('/api/analytics', createAnalyticsRouter(db))
    app.route('/api/auth', createAuthRouter(db))
  })

  afterAll(async () => { await cleanup() })

  it('creates and fetches a transaction', async () => {
    const createRes = await app.request('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        amountCents: 1050,
        item: 'Chicken rice',
        category: 'Food',
        subCategory: 'Hawker',
        date: '15/05/2026',
        source: 'bot',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.amount).toBe('10.50')

    const listRes = await app.request('/api/transactions?userId=' + userId, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].item).toBe('Chicken rice')
  })

  it('returns analytics summary for the current month', async () => {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = String(now.getFullYear())
    const res = await app.request(`/api/analytics/summary?month=${month}&year=${year}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('totalCents')
    expect(body).toHaveProperty('count')
  })
})
```

- [ ] **Step 4: Update vitest config to include integration tests**

`apps/api/vitest.config.ts` — confirm test glob is `'**/__tests__/**/*.test.ts'` (default). No change needed unless it's narrower.

- [ ] **Step 5: Document TEST_DATABASE_URL in .env.example**

In `.env.example`, append:
```
# ── Tests ──────────────────────────────────────────────────────────────────────
# Disposable Postgres URL for integration tests. NEVER point at prod.
# TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spend_again_test
```

- [ ] **Step 6: Verify the test runs (or skips cleanly if no DB)**

```bash
pnpm --filter @spend-again/api test -- __tests__/integration
```
Expected: passes if `TEST_DATABASE_URL` is set; throws clear error otherwise.

- [ ] **Step 7: Commit**

```bash
git add apps/api/__tests__/integration apps/api/vitest.config.ts .env.example
git commit -m "test(api): integration round-trip scaffold"
```

### Task 0.4: Drop --passWithNoTests

**Files:**
- Modify: `turbo.json`
- Modify: `apps/api/package.json`
- Modify: `apps/bot/package.json`
- Modify: `apps/dashboard/package.json` (if applicable)

- [ ] **Step 1: Find every --passWithNoTests**

```bash
grep -rn "passWithNoTests" /Users/khen/Desktop/spend-again --include="*.json"
```

- [ ] **Step 2: Remove the flag from every match**

In each `package.json` `test` script, change `"vitest run --passWithNoTests"` → `"vitest run"`.

- [ ] **Step 3: Add a placeholder test to any package that has none**

Run `pnpm turbo run test` — note any package that fails with "No test files found". Add a trivial test in that package's `__tests__/` directory:
```ts
import { describe, it, expect } from 'vitest'
describe('package', () => { it('builds', () => { expect(true).toBe(true) }) })
```

- [ ] **Step 4: Verify all tests pass**

```bash
pnpm turbo run test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: require tests in every package"
```

### Task 0.5: Move planning docs into docs/

**Files:**
- Move: `task.md`, `implementation_plan.md`, `implementation_plan2.md`, `.superpowers/` → `docs/legacy/`
- Move: `Spend Again?.png` → `docs/`
- Modify: `README.md`

- [ ] **Step 1: Create docs/legacy**

```bash
mkdir -p docs/legacy
```

- [ ] **Step 2: Move files**

```bash
git mv task.md docs/legacy/task.md
git mv implementation_plan.md docs/legacy/implementation_plan.md
git mv implementation_plan2.md docs/legacy/implementation_plan2.md
git mv .superpowers docs/legacy/superpowers-history
git mv "Spend Again?.png" docs/spend-again-logo.png
```

- [ ] **Step 3: Update README references**

```bash
grep -n "task.md\|implementation_plan\|Spend Again?.png" README.md
```
Update any matched paths to the new locations.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: move planning docs and logo under docs/"
```

### Task 0.6: Phase 0 acceptance gate

- [ ] **Step 1: Run lint, type-check, and tests across the monorepo**

```bash
pnpm turbo run lint type-check test
```
Expected: all green. Integration test runs (with `TEST_DATABASE_URL` set) and passes.

- [ ] **Step 2: Open PR for Phase 0**

Branch is ready for review. After merge, Phase 1 begins.

---

# Phase 1 — Block-merge bug fixes

**Subagent:** `general-purpose`. Worktree: `wt-phase-1-bug-fixes`. TDD discipline.

### Task 1.1: Fix receipt-confirm using telegram ID as userId

**Files:**
- Modify: `apps/bot/src/handlers/receipt-confirm.ts:60-110`
- Modify: `apps/bot/__tests__/` — add test if missing

- [ ] **Step 1: Read current handler**

```bash
sed -n '60,115p' apps/bot/src/handlers/receipt-confirm.ts
```

- [ ] **Step 2: Replace telegramId-as-userId with DB UUID from store**

In `handleConfirmAll`, after the token check, add:
```ts
const userId = userIdStore.get(telegramId)
if (userId === undefined) {
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
  await ctx.editMessageText(MSG_NOT_REGISTERED(dashboardUrl))
  return
}
```
Add import:
```ts
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
```
In the per-line-item loop, replace `userId: String(telegramId)` with `userId,`.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/handlers/receipt-confirm.ts
git commit -m "fix(bot): use DB UUID, not telegram id, when saving receipt items"
```

### Task 1.2: Add limit, offset, and orderBy to transactions list

**Files:**
- Modify: `apps/api/src/routes/transactions.ts:55-65` (schema)
- Modify: `apps/api/src/services/transactions.ts:73-103` (service)
- Modify: `apps/api/__tests__/transactions.test.ts` (add test)

- [ ] **Step 1: Write failing test for ordering and limit**

In `apps/api/__tests__/transactions.test.ts`, add:
```ts
it('returns rows ordered by createdAt desc and respects limit', async () => {
  // … seed 3 txs, call list with limit=2, assert length=2 and order desc
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @spend-again/api test -- transactions
```
Expected: the test fails because the response includes all rows in arbitrary order.

- [ ] **Step 3: Extend schema with limit/offset**

In `apps/api/src/routes/transactions.ts:55-65`:
```ts
export const listTransactionsQuerySchema = z.object({
  category: z.enum(CATEGORIES as readonly [string, ...string[]]).optional(),
  month: z.string().regex(/^\d{2}$/, 'month must be 2-digit').optional(),
  year: z.string().regex(/^\d{4}$/, 'year must be 4-digit').optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})
```

- [ ] **Step 4: Service applies limit/offset/orderBy**

In `apps/api/src/services/transactions.ts`, extend `ListTransactionsQuery`:
```ts
export type ListTransactionsQuery = {
  userId?: string
  category?: string
  month?: string
  year?: string
  limit?: number
  offset?: number
}
```

In `list()`, replace the final select chain:
```ts
import { desc } from 'drizzle-orm'

const baseQuery = db.select().from(transactions)
const filtered = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery
return filtered
  .orderBy(desc(transactions.createdAt))
  .limit(query.limit ?? 50)
  .offset(query.offset ?? 0)
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm --filter @spend-again/api test -- transactions
```

- [ ] **Step 6: Update bot's apiClient to thread the limit**

In `apps/bot/src/lib/api-client.ts`, `getRecentTransactions` already passes `limit` — no change. `getAllTransactions(userId)` calls with 10000 — change to:
```ts
async getAllTransactions(userId: string): Promise<Transaction[]> {
  return this.getRecentTransactions(userId, 500)
}
```
(500 matches the new max. If callers need more, paginate.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/ apps/bot/src/lib/api-client.ts
git commit -m "fix(api): add limit/offset/order to GET /api/transactions"
```

### Task 1.3: Reorder rate-limit and auth middleware

**Files:**
- Modify: `apps/api/src/index.ts:42-60`

- [ ] **Step 1: Read current order**

```bash
sed -n '42,65p' apps/api/src/index.ts
```

- [ ] **Step 2: Remove global rate-limit, attach per-router after auth**

Replace lines 48–59 with:
```ts
// Public routes
app.route('/', healthRouter)
app.use('/api/auth/*', rateLimitMiddleware)            // IP-based limit only
app.route('/api/auth', createAuthRouter(db))

// Authenticated routes — order matters: auth first, then per-user rate limit
app.use('/api/transactions/*', requireAuth, rateLimitMiddleware)
app.route('/api/transactions', createTransactionsRouter(db))

app.use('/api/analytics/*', requireAuth, rateLimitMiddleware)
app.route('/api/analytics', createAnalyticsRouter(db))

app.use('/api/users/*', requireAuth, rateLimitMiddleware)
app.route('/api/users', createUsersRouter(db))
```

- [ ] **Step 3: Remove inline requireAuth from users routes**

In `apps/api/src/routes/users.ts`, drop `requireAuth` from the per-route signatures (it's now at index level).

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @spend-again/api test
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "fix(api): apply rate limit after auth so it's per-user not per-IP"
```

### Task 1.4: Move Books from Education to Shopping

**Files:**
- Modify: `packages/shared/src/categories.ts:53-57,103,107`
- Modify: `packages/parser/src/gemini.ts:103` (prompt)
- Modify: `packages/parser/src/ocr.ts:122` (prompt)

- [ ] **Step 1: Update SubCategory union if needed**

Books already exists in the SubCategory union. Only the CATEGORY_MAP needs updating.

- [ ] **Step 2: Update CATEGORY_MAP**

In `packages/shared/src/categories.ts`:
```ts
Shopping: ['Clothing', 'Electronics', 'Home & Living', 'Personal Care', 'Online Shopping', 'Books', 'Other'],
Education: ['Tuition', 'Courses', 'School Fees', 'Other'],
```

- [ ] **Step 3: Update Gemini prompt**

In `packages/parser/src/gemini.ts:103`, change:
```
- Popular, MPH bookstore → Education / Books
```
to:
```
- Popular, MPH bookstore → Shopping / Books
```

- [ ] **Step 4: Update OCR prompt**

In `packages/parser/src/ocr.ts`, same line. Change Education → Shopping.

- [ ] **Step 5: Run parser tests**

```bash
pnpm --filter @spend-again/parser test
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/categories.ts packages/parser/
git commit -m "fix(categories): move Books from Education to Shopping"
```

### Task 1.5: Drive RPM message off constant; verify constant

**Files:**
- Modify: `packages/shared/src/constants.ts:5`
- Modify: `packages/shared/src/errors.ts:81-94`
- Modify: `packages/parser/src/gemini.ts:10-15,22`
- Modify: `packages/parser/src/ocr.ts:48-53`

- [ ] **Step 1: Verify Gemini Flash-Lite free tier RPM**

```bash
# Read current docs
echo "Confirm GEMINI_RPM_LIMIT against https://ai.google.dev/pricing"
```
Web search if needed. Current value `30`. If Google has changed it, update the constant; otherwise keep at 30.

- [ ] **Step 2: Update shared error messages**

`packages/shared/src/errors.ts`:
```ts
import { GEMINI_RPM_LIMIT } from './constants.js'

export class GeminiRateLimitError extends RateLimitError {
  constructor() {
    super(`Gemini rate limit exceeded (${GEMINI_RPM_LIMIT} RPM)`)
    this.name = 'GeminiRateLimitError'
  }
}

export class OcrRateLimitError extends RateLimitError {
  constructor() {
    super(`OCR rate limit exceeded (${GEMINI_RPM_LIMIT} RPM)`)
    this.name = 'OcrRateLimitError'
  }
}
```

- [ ] **Step 3: Delete the duplicate error classes in parser**

In `packages/parser/src/gemini.ts`, delete the local `GeminiRateLimitError` class (lines 10–15). Replace its imports + usages:
```ts
import { GeminiRateLimitError } from '@spend-again/shared'
```
In `packages/parser/src/ocr.ts`, same: delete the local `OcrRateLimitError` class, import from shared.

- [ ] **Step 4: Fix bot's name-string check**

`apps/bot/src/handlers/receipt.ts:215-222`:
```ts
import { OcrRateLimitError } from '@spend-again/shared'

let ocrResult: OcrResult | null
try {
  ocrResult = await parseReceiptWithOcr(imageData, mimeType)
} catch (err) {
  const errorMessage =
    err instanceof OcrRateLimitError ? MSG_RECEIPT_RATE_LIMIT : MSG_RECEIPT_PARSE_FAILED
  await ctx.reply(errorMessage)
  return
}
```

- [ ] **Step 5: Update parser/index.ts re-export**

`packages/parser/src/index.ts`:
```ts
export { GeminiRateLimitError, OcrRateLimitError } from '@spend-again/shared'
```
Drop the line that previously re-exported from `./gemini.js`.

- [ ] **Step 6: Update existing tests that asserted the message**

```bash
grep -n "15 RPM" packages/parser/__tests__
```
Change any matched assertion to interpolate `GEMINI_RPM_LIMIT`.

- [ ] **Step 7: Run all tests**

```bash
pnpm turbo run test
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: dedupe rate-limit error classes, drive message off constant"
```

### Task 1.6: Hard-fail on missing env vars at startup

**Files:**
- Create: `packages/shared/src/env.ts`
- Modify: `apps/api/src/lib/jwt.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/bot/src/index.ts`
- Modify: `apps/bot/src/bot.ts`
- Modify: `apps/bot/src/lib/api-client.ts`
- Modify: `packages/db/src/client.ts`

- [ ] **Step 1: Create shared env helper**

`packages/shared/src/env.ts`:
```ts
/**
 * Require an environment variable. Throws a clear error at startup if missing.
 * Use at module top level in entry points and library modules that depend on env.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `Required environment variable "${name}" is not set. ` +
      `Set it in your .env (dev) or service env vars (prod) before starting.`,
    )
  }
  return value
}
```

Re-export from `packages/shared/src/index.ts`:
```ts
export * from './env.js'
```

- [ ] **Step 2: jwt.ts hard-fails**

Replace `apps/api/src/lib/jwt.ts:3-9` with:
```ts
import { requireEnv } from '@spend-again/shared'
const secret = new TextEncoder().encode(requireEnv('JWT_SECRET'))
```
Drop the fallback and the `console.warn`.

- [ ] **Step 3: db/client.ts already hard-fails, leave it; standardise the message**

`packages/db/src/client.ts:5-6` already throws. Replace with the shared helper:
```ts
import { requireEnv } from '@spend-again/shared'
const connectionString = requireEnv('DATABASE_URL')
```

- [ ] **Step 4: bot/bot.ts hard-fails on BOT_TOKEN**

`apps/bot/src/bot.ts:13-14`:
```ts
import { requireEnv } from '@spend-again/shared'
const token = requireEnv('BOT_TOKEN')
```

- [ ] **Step 5: bot/api-client.ts hard-fails on API_URL**

`apps/bot/src/lib/api-client.ts` — replace `process.env['API_URL'] ?? 'https://…'` defaults with `requireEnv('API_URL')`. Inside `loginViaTelegram`, default the param to `requireEnv('API_URL')` instead of the URL string. The `normalizeUrl` helper can stay for the case where someone sets API_URL without scheme.

- [ ] **Step 6: bot/index.ts no longer needs API_URL default**

In `apps/bot/src/index.ts:23`, replace `process.env['API_URL'] ?? 'http://localhost:3001'` with `process.env['API_URL'] ?? 'http://localhost:3001'` (keep dev fallback only because this is dev-mode init — but only if NODE_ENV !== 'production'). Better: extract this into a single env-loader that the bot reads once on boot.

Simplify: at top of `apps/bot/src/index.ts`:
```ts
import { requireEnv } from '@spend-again/shared'
const apiUrl = requireEnv('API_URL')
```
Pass `apiUrl` into `initDevMode` instead of reading env again.

- [ ] **Step 7: Verify boot fails clean with missing env**

```bash
unset JWT_SECRET
pnpm --filter @spend-again/api dev
```
Expected: starts then throws `Required environment variable "JWT_SECRET" is not set…`.

- [ ] **Step 8: Update .env.example to mark required vs optional**

Annotate each var in `.env.example` with `# Required` or `# Optional`.

- [ ] **Step 9: Commit**

```bash
git add packages/ apps/ .env.example
git commit -m "fix: hard-fail at startup on missing required env vars"
```

### Task 1.7: Welcome.tsx — replace render-time navigate with Navigate

**Files:**
- Modify: `apps/dashboard/src/pages/Welcome.tsx:6-13`

- [ ] **Step 1: Replace the if-block with Navigate**

`apps/dashboard/src/pages/Welcome.tsx`:
```tsx
import { Navigate, useNavigate } from 'react-router-dom'
import { isAuthenticated } from '../lib/auth'

const BOT_NAME = import.meta.env['VITE_TELEGRAM_BOT_NAME'] ?? 'spend_again_bot'

export function Welcome() {
  const navigate = useNavigate()

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  // … rest unchanged
}
```

- [ ] **Step 2: Build to confirm**

```bash
pnpm --filter @spend-again/dashboard type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/pages/Welcome.tsx
git commit -m "fix(dashboard): use <Navigate> in Welcome instead of render-time navigate()"
```

### Task 1.8: Stop stuffing item names into callback_data

**Files:**
- Modify: `apps/bot/src/handlers/confirm.ts:148-220`
- Add: `apps/bot/__tests__/learn-prompt.test.ts`

- [ ] **Step 1: Add an in-memory pending-learn store**

In `apps/bot/src/handlers/confirm.ts`, near the top:
```ts
import { randomBytes } from 'node:crypto'

type PendingLearn = { item: string; category: Category; subCategory: SubCategory }
const pendingLearnPrompts = new Map<string, PendingLearn>()

function makeLearnId(): string {
  return randomBytes(6).toString('hex') // 12 chars, fits any callback budget
}
```

- [ ] **Step 2: Replace the inline_keyboard construction**

Inside `handleConfirmYes`, replace the existing `ctx.reply(MSG_LEARN_PROMPT(...))` block with:
```ts
if (result.tier === 3) {
  const learnId = makeLearnId()
  pendingLearnPrompts.set(learnId, { item: result.item, category, subCategory })
  await ctx.reply(MSG_LEARN_PROMPT(result.item, category, subCategory), {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Yes, remember it \u{1F9E0}', callback_data: `learn_yes|${learnId}` },
        { text: 'No thanks', callback_data: 'learn_no' },
      ]],
    },
  })
}
```

- [ ] **Step 3: Replace `learnHandler` to look up by id**

```ts
export async function learnHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  if (callbackData === undefined) return
  await ctx.answerCallbackQuery()

  if (callbackData === 'learn_no') {
    await ctx.editMessageText(MSG_LEARN_DECLINED)
    return
  }

  if (callbackData.startsWith('learn_yes|')) {
    const id = callbackData.slice('learn_yes|'.length)
    const pending = pendingLearnPrompts.get(id)
    pendingLearnPrompts.delete(id)

    if (pending === undefined) {
      await ctx.editMessageText(MSG_LEARN_ITEM_MISSING)
      return
    }

    try {
      await saveMapping(pending.item, pending.category, pending.subCategory, 'user')
      await ctx.editMessageText(MSG_LEARN_SAVED(pending.item, pending.category, pending.subCategory))
    } catch {
      await ctx.editMessageText(MSG_LEARN_FAILED)
    }
  }
}
```

(Note: `saveMapping` import stays for now; Phase 3 replaces it with `apiClient.saveLearnedMapping`.)

- [ ] **Step 4: Write test for the new flow**

`apps/bot/__tests__/learn-prompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
// Test that the learnId map round-trips item names regardless of length
// and that a long item name produces a callback_data within Telegram's 64-byte limit.
```
Use the existing `expense.test.ts` pattern.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @spend-again/bot test
```

- [ ] **Step 6: Commit**

```bash
git add apps/bot/
git commit -m "fix(bot): stash learn prompts by id to stay within Telegram 64-byte callback_data limit"
```

### Task 1.9: Phase 1 acceptance gate

- [ ] **Step 1: Lint + type-check + test**

```bash
pnpm turbo run lint type-check test
```

- [ ] **Step 2: Run Phase 0 integration test**

```bash
pnpm --filter @spend-again/api test -- __tests__/integration
```
Expected: green.

- [ ] **Step 3: Open PR for Phase 1**

---

# Phase 2 — Schema + new endpoints

**Subagent:** `general-purpose`. Worktree: `wt-phase-2-schema`. TDD.

### Task 2.1: Add occurred_on column with backfill

**Files:**
- Create: `packages/db/drizzle/0002_add_occurred_on.sql`
- Create: `packages/db/drizzle/meta/0002_snapshot.json` (drizzle-kit generates)
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts:30-36`

- [ ] **Step 1: Update schema.ts first**

In `packages/db/src/schema.ts`, add inside `transactions`:
```ts
import { date } from 'drizzle-orm/pg-core'

export const transactions = pgTable('transactions', {
  // … existing columns …
  date: text('date').notNull(),                           // legacy, dropped in Phase 4
  occurredOn: date('occurred_on', { mode: 'string' }),    // new, nullable until backfilled
  // … rest …
})
```

- [ ] **Step 2: Generate migration**

```bash
pnpm --filter @spend-again/db exec drizzle-kit generate
```
This emits `0002_*.sql`. Inspect it.

- [ ] **Step 3: Edit migration to add backfill + NOT NULL**

Append to `packages/db/drizzle/0002_*.sql`:
```sql
UPDATE transactions
   SET occurred_on = to_date(date, 'DD/MM/YYYY')
 WHERE occurred_on IS NULL;

DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM transactions WHERE occurred_on IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % rows have NULL occurred_on. Inspect transactions.date for malformed values before re-running.', bad_count;
  END IF;
END $$;

ALTER TABLE transactions ALTER COLUMN occurred_on SET NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_user_occurred_idx
  ON transactions (user_id, occurred_on DESC);
```

- [ ] **Step 4: Update schema to mark NOT NULL**

In `packages/db/src/schema.ts`:
```ts
occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
```

- [ ] **Step 5: Run migration against test DB**

```bash
TEST_DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @spend-again/db exec tsx src/migrate.ts
```
Expected: migration runs cleanly; integration test still passes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add occurred_on date column with backfill and index"
```

### Task 2.2: Service dual-writes both date columns

**Files:**
- Modify: `apps/api/src/services/transactions.ts:50-130`

- [ ] **Step 1: Add a helper to convert DD/MM/YYYY → YYYY-MM-DD**

In `packages/shared/src/dates.ts` (create if not exists from Phase 0; otherwise add to existing helpers):
```ts
/** Convert DD/MM/YYYY → YYYY-MM-DD. Throws on malformed input. */
export function ddmmyyyyToIso(date: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
  if (!m) throw new Error(`Invalid DD/MM/YYYY date: "${date}"`)
  return `${m[3]}-${m[2]}-${m[1]}`
}
```
Re-export from index.

- [ ] **Step 2: Service writes both columns**

In `apps/api/src/services/transactions.ts`, inside `create`:
```ts
import { ddmmyyyyToIso } from '@spend-again/shared'

const rows = await db.insert(transactions).values({
  userId: input.userId,
  amountCents: input.amountCents,
  item: input.item,
  category: input.category,
  subCategory: input.subCategory,
  date: input.date,
  occurredOn: ddmmyyyyToIso(input.date),
  source: input.source,
  tier: input.tier ?? null,
  confidence: input.confidence !== undefined ? String(input.confidence) : null,
}).returning()
```
Inside `update`, when `input.date !== undefined`, set both `patch['date']` and `patch['occurredOn'] = ddmmyyyyToIso(input.date)`.

- [ ] **Step 3: Test**

```bash
pnpm --filter @spend-again/api test
```
Add an assertion in `transactions.test.ts` that `occurred_on` is populated. Re-run integration test.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/dates.ts packages/shared/src/index.ts apps/api/
git commit -m "feat(api): dual-write occurred_on alongside text date column"
```

### Task 2.3: Add user_custom_categories table

**Files:**
- Create: `packages/db/drizzle/0003_user_custom_categories.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add table to schema**

`packages/db/src/schema.ts`:
```ts
import { uniqueIndex } from 'drizzle-orm/pg-core'

export const userCustomCategories = pgTable('user_custom_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  subCategory: text('sub_category').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniq: uniqueIndex('user_custom_categories_unique').on(table.userId, table.category, table.subCategory),
}))

export type UserCustomCategory = typeof userCustomCategories.$inferSelect
export type NewUserCustomCategory = typeof userCustomCategories.$inferInsert
```

- [ ] **Step 2: Generate + verify migration**

```bash
pnpm --filter @spend-again/db exec drizzle-kit generate
```
Inspect `0003_*.sql` — should create table and unique index.

- [ ] **Step 3: Re-export from db/index.ts**

```ts
export { userCustomCategories } from './schema.js'
export type { UserCustomCategory, NewUserCustomCategory } from './schema.js'
```

- [ ] **Step 4: Run migration**

```bash
TEST_DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @spend-again/db exec tsx src/migrate.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add user_custom_categories table with per-user unique constraint"
```

### Task 2.4: Custom-categories endpoints

**Files:**
- Create: `apps/api/src/routes/custom-categories.ts`
- Create: `apps/api/__tests__/custom-categories.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing endpoint tests**

`apps/api/__tests__/custom-categories.test.ts`:
```ts
// Tests:
// - GET /api/users/custom-categories returns [] when none exist
// - POST adds, returns the new row, GET reflects it
// - POST with duplicate (user, category, sub) returns 409
// - DELETE :id removes, GET no longer shows it
// - All require auth (401 without token)
```

- [ ] **Step 2: Create router**

`apps/api/src/routes/custom-categories.ts`:
```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { userCustomCategories } from '@spend-again/db'
import { validateBody } from '../middleware/validate.js'
import type { DbClient } from '../lib/db.js'

type Env = { Variables: { validatedBody: unknown; userId: string; telegramId: string | undefined } }

const createSchema = z.object({
  category: z.string().min(1).max(60),
  subCategory: z.string().min(1).max(60),
})

export function createCustomCategoriesRouter(db: DbClient): Hono<Env> {
  const r = new Hono<Env>()

  r.get('/', async (c) => {
    const userId = c.get('userId')
    const rows = await db
      .select()
      .from(userCustomCategories)
      .where(eq(userCustomCategories.userId, userId))
    return c.json(rows.map((row) => ({
      id: row.id, category: row.category, subCategory: row.subCategory, createdAt: row.createdAt,
    })))
  })

  r.post('/', validateBody(createSchema), async (c) => {
    const userId = c.get('userId')
    const input = c.get('validatedBody') as z.infer<typeof createSchema>
    try {
      const [row] = await db.insert(userCustomCategories).values({
        userId, category: input.category, subCategory: input.subCategory,
      }).returning()
      if (!row) return c.json({ error: 'Insert failed', code: 'INSERT_FAILED' }, 500)
      return c.json(row, 201)
    } catch (err) {
      // unique violation
      if (err instanceof Error && err.message.includes('duplicate key')) {
        return c.json({ error: 'Already exists', code: 'CONFLICT' }, 409)
      }
      throw err
    }
  })

  r.delete('/:id', async (c) => {
    const userId = c.get('userId')
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
```

- [ ] **Step 3: Mount the router**

In `apps/api/src/index.ts`, after the users mount:
```ts
import { createCustomCategoriesRouter } from './routes/custom-categories.js'
app.use('/api/users/custom-categories/*', requireAuth, rateLimitMiddleware)
app.use('/api/users/custom-categories', requireAuth, rateLimitMiddleware)
app.route('/api/users/custom-categories', createCustomCategoriesRouter(db))
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @spend-again/api test -- custom-categories
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add custom-categories endpoints"
```

### Task 2.5: Learned-mappings endpoints

**Files:**
- Create: `apps/api/src/routes/learned-mappings.ts`
- Create: `apps/api/__tests__/learned-mappings.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// - POST upserts (insert new, increments usage on existing)
// - GET /:itemName returns mapping or 404
// - Auth required
```

- [ ] **Step 2: Create router**

`apps/api/src/routes/learned-mappings.ts`:
```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { findMapping, upsertMapping } from '@spend-again/db'
import { CATEGORIES } from '@spend-again/shared'
import { validateBody } from '../middleware/validate.js'
import type { DbClient } from '../lib/db.js'

type Env = { Variables: { validatedBody: unknown; userId: string; telegramId: string | undefined } }

const createSchema = z.object({
  itemName: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [string, ...string[]]),
  subCategory: z.string().min(1).max(60),
  source: z.enum(['regex', 'gemini', 'user']).optional().default('user'),
})

export function createLearnedMappingsRouter(_db: DbClient): Hono<Env> {
  const r = new Hono<Env>()

  r.get('/:itemName', async (c) => {
    const itemName = decodeURIComponent(c.req.param('itemName'))
    const result = await findMapping(itemName)
    if (result === null) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json(result)
  })

  r.post('/', validateBody(createSchema), async (c) => {
    const input = c.get('validatedBody') as z.infer<typeof createSchema>
    // input.category is z.enum(CATEGORIES) so the runtime guarantee matches Category.
    // Cast through unknown to satisfy strict TS without no-explicit-any.
    const category = input.category as unknown as import('@spend-again/shared').Category
    const subCategory = input.subCategory as unknown as import('@spend-again/shared').SubCategory
    await upsertMapping(input.itemName, category, subCategory, input.source)
    return c.json({ success: true }, 201)
  })

  return r
}
```

- [ ] **Step 3: Mount**

In `apps/api/src/index.ts`:
```ts
import { createLearnedMappingsRouter } from './routes/learned-mappings.js'
app.use('/api/learned-mappings/*', requireAuth, rateLimitMiddleware)
app.use('/api/learned-mappings', requireAuth, rateLimitMiddleware)
app.route('/api/learned-mappings', createLearnedMappingsRouter(db))
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @spend-again/api test -- learned-mappings
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add learned-mappings endpoints (GET, POST)"
```

### Task 2.6: Phase 2 acceptance gate

- [ ] **Step 1: Full test sweep**

```bash
pnpm turbo run lint type-check test
pnpm --filter @spend-again/api test -- __tests__/integration
```

- [ ] **Step 2: Open Phase 2 PR**

---

# Phase 3 — Cutover + types unification

**Subagent:** `general-purpose`. Worktree: `wt-phase-3-cutover`. TDD. **Riskiest phase.**

### Task 3.1: Bot apiClient gains getLearnedMapping

**Files:**
- Modify: `apps/bot/src/lib/api-client.ts`

- [ ] **Step 1: Add the methods**

In the `ApiClient` class:
```ts
async getLearnedMapping(itemName: string): Promise<{ category: Category; subCategory: SubCategory; confidence: number } | null> {
  try {
    const res = await fetch(`${this.baseUrl}/api/learned-mappings/${encodeURIComponent(itemName.toLowerCase())}`, {
      headers: this.buildHeaders(),
    })
    if (res.status === 404) return null
    if (!res.ok) {
      log.error({ status: res.status }, 'getLearnedMapping failed')
      return null
    }
    return (await res.json()) as { category: Category; subCategory: SubCategory; confidence: number }
  } catch (err) {
    log.error({ err }, 'getLearnedMapping error')
    return null
  }
}
```
`saveLearnedMapping` already exists — change its URL from `/api/learned-mappings` to keep matching the actual route. Already correct.

- [ ] **Step 2: Commit**

```bash
git add apps/bot/src/lib/api-client.ts
git commit -m "feat(bot): add apiClient.getLearnedMapping"
```

### Task 3.2: Inject lookupItem into parse()

**Files:**
- Modify: `packages/parser/src/index.ts`
- Delete: `packages/parser/src/learned.ts`
- Modify: `packages/parser/__tests__/learned.test.ts` (delete or rewrite)
- Modify: `apps/bot/src/handlers/expense.ts`
- Modify: `apps/bot/src/handlers/confirm.ts`

- [ ] **Step 1: Change parse() signature**

`packages/parser/src/index.ts`:
```ts
import { parseWithRegex } from './regex.js'
import { parseWithGemini, waitForGeminiRpmBudget } from './gemini.js'
import type { ParseResult } from './regex.js'
import type { Category, SubCategory } from '@spend-again/shared'

export type LookupResult = { category: Category; subCategory: SubCategory; confidence: number }
export type LookupFn = (itemName: string) => Promise<LookupResult | null>

export type { ParseResult } from './regex.js'
export { parseWithRegex } from './regex.js'
export { parseWithGemini, buildPrompt, waitForGeminiRpmBudget } from './gemini.js'
export { GeminiRateLimitError, OcrRateLimitError } from '@spend-again/shared'

export async function parse(input: string, opts: { lookupItem: LookupFn }): Promise<ParseResult | null> {
  const tier1 = parseWithRegex(input)
  if (tier1 !== null && tier1.category !== undefined) return tier1

  const itemToLookup = tier1?.item ?? input
  const tier2 = await opts.lookupItem(itemToLookup)
  if (tier2 !== null) {
    return {
      amount: tier1 !== null && tier1.amount !== 0 ? tier1.amount : 0,
      item: tier1?.item ?? input,
      category: tier2.category,
      subCategory: tier2.subCategory,
      confidence: tier2.confidence,
      tier: 2,
      ...(tier1?.date !== undefined ? { date: tier1.date } : {}),
    }
  }

  await waitForGeminiRpmBudget()
  return parseWithGemini(input)
}
```

- [ ] **Step 2: Delete learned.ts**

```bash
git rm packages/parser/src/learned.ts
git rm packages/parser/__tests__/learned.test.ts
```

- [ ] **Step 3: Update bot's expense handler to pass apiClient.getLearnedMapping**

`apps/bot/src/handlers/expense.ts`:
```ts
import { apiClient, tokenStore, loginViaTelegram } from '../lib/api-client.js'

// inside expenseHandler, after token is established:
apiClient.setToken(token)
result = await parse(text, { lookupItem: (name) => apiClient.getLearnedMapping(name) })
```

- [ ] **Step 4: Replace saveMapping in confirm.ts with apiClient.saveLearnedMapping**

In `apps/bot/src/handlers/confirm.ts`, replace:
```ts
import { saveMapping } from '@spend-again/parser'
// …
await saveMapping(pending.item, pending.category, pending.subCategory, 'user')
```
with:
```ts
import { apiClient } from '../lib/api-client.js'
// …
apiClient.setToken(token)
const ok = await apiClient.saveLearnedMapping(pending.item, pending.category, pending.subCategory)
if (!ok) throw new Error('save failed')
```
(Need the token in scope inside `learnHandler` — pass it via the pending store too.)

Extend `PendingLearn` to include `telegramId` so we can look up the token in the handler.

- [ ] **Step 5: Drop @spend-again/db from parser**

`packages/parser/package.json` — remove `@spend-again/db` dep if listed. `packages/parser/src/index.ts` no longer imports from it.

- [ ] **Step 6: Drop @spend-again/db from bot's transitive graph**

Confirm `apps/bot/package.json` doesn't list `@spend-again/db`. Confirm nothing imports it from the bot code:
```bash
grep -rn "@spend-again/db" apps/bot/src
```
Expected: no matches.

- [ ] **Step 7: Remove DATABASE_URL from bot env requirements**

The bot no longer needs it. Update `.env.example` to mark `DATABASE_URL` as API-only.

- [ ] **Step 8: Run all tests**

```bash
pnpm turbo run lint type-check test
pnpm --filter @spend-again/api test -- __tests__/integration
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: parser accepts injected lookup; bot uses HTTP for learned mappings"
```

### Task 3.3: Switch analytics + transactions reads to occurred_on

**Files:**
- Modify: `apps/api/src/routes/analytics.ts`
- Modify: `apps/api/src/routes/transactions.ts`
- Modify: `apps/api/src/services/transactions.ts`

- [ ] **Step 1: Add date-range helper**

In `packages/shared/src/dates.ts`:
```ts
/** Returns the [start, endExclusive] ISO date strings for a given YYYY-MM month. */
export function monthRange(yearStr: string, monthStr: string): { startIso: string; endIso: string } {
  const y = Number(yearStr)
  const m = Number(monthStr)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return {
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  }
}
```

- [ ] **Step 2: Update analytics summary**

In `apps/api/src/routes/analytics.ts`, replace `like(transactions.date, '__/MM/YYYY')` with:
```ts
import { gte, lt } from 'drizzle-orm'
import { monthRange } from '@spend-again/shared'

const { startIso, endIso } = monthRange(year, month)
const conditions = [
  eq(transactions.userId, userId),
  gte(transactions.occurredOn, startIso),
  lt(transactions.occurredOn, endIso),
]
```
Apply the same change in `breakdown` and `top` (month branch).

- [ ] **Step 3: Update `top` week branch**

Replace the "pull all rows then JS-filter" hack with a real query:
```ts
const today = new Date()
const day = today.getUTCDay() // 0=Sun
const startOfWeek = new Date(today)
startOfWeek.setUTCDate(today.getUTCDate() - day)
const startIso = startOfWeek.toISOString().slice(0, 10)

const rows = await db.select().from(transactions)
  .where(and(userCondition, gte(transactions.occurredOn, startIso)))
  .orderBy(desc(transactions.amountCents))
  .limit(1)
```

- [ ] **Step 4: Update transaction service list filter**

In `apps/api/src/services/transactions.ts`, replace the `like(...)` patterns in `list()` with `monthRange`-based `between` queries. Replace `orderBy(desc(transactions.createdAt))` with `orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))`.

- [ ] **Step 5: Run integration test**

```bash
pnpm --filter @spend-again/api test -- __tests__/integration
```
Must pass.

- [ ] **Step 6: Delete dead parseDDMMYYYY in analytics.ts**

```bash
grep -n "parseDDMMYYYY\|getCurrentWeekDateRange" apps/api/src/routes/analytics.ts
```
Delete those helper functions.

- [ ] **Step 7: Commit**

```bash
git add apps/api/ packages/shared/
git commit -m "refactor(api): read paths use occurred_on (real date) instead of text LIKE"
```

### Task 3.4: Shared types rewrite

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/bot/src/lib/api-client.ts`

- [ ] **Step 1: Rewrite types.ts**

```ts
import type { Category, SubCategory } from './categories.js'

/** Wire shape for a transaction over the API. amount is a decimal string. */
export type ApiTransaction = {
  id: string
  userId: string
  amount: string                       // decimal SGD, e.g. "10.50"
  item: string
  category: Category | string          // canonical OR user custom
  subCategory: SubCategory | string
  date: string                         // DD/MM/YYYY (legacy; remove when 4.1 lands)
  source: 'manual' | 'bot' | 'sms' | 'ocr'
  tier?: 1 | 2 | 3
  confidence?: string
  createdAt: string
  updatedAt: string
}

export type CreateTransactionRequest = {
  amountCents: number
  item: string
  category: string
  subCategory: string
  date: string
  source: 'manual' | 'bot' | 'sms' | 'ocr'
  tier?: 1 | 2 | 3
  confidence?: number
}

export type UpdateTransactionRequest = Partial<Omit<CreateTransactionRequest, 'source'>> & {
  source?: 'manual' | 'bot' | 'sms' | 'ocr'
}

export type ApiUser = {
  id: string
  email?: string | null
  telegramId?: string | null
  telegramUsername?: string | null
  monthlyBudget?: number | null        // cents
  budgetAlertPct?: number
  createdAt: string
}

export type BudgetSettings = {
  monthlyBudget: number | null
  budgetAlertPct: number
}

export type CustomCategory = {
  id: string
  category: string
  subCategory: string
  createdAt: string
}

export type LearnedMapping = {
  itemName: string
  category: Category
  subCategory: SubCategory
  confidence: number
  source: 'regex' | 'gemini' | 'user'
  usageCount: number
}
```

- [ ] **Step 2: Dashboard imports from shared**

In `apps/dashboard/src/lib/api.ts`, replace the local `ApiTransaction`, `BudgetSettings` types with:
```ts
import type { ApiTransaction, CreateTransactionRequest, UpdateTransactionRequest, BudgetSettings, CustomCategory } from '@spend-again/shared'

export type { ApiTransaction, BudgetSettings }
export type CreateTransactionPayload = CreateTransactionRequest & { userId: string }
export type UpdateTransactionPayload = UpdateTransactionRequest
```

- [ ] **Step 3: Bot imports from shared**

In `apps/bot/src/lib/api-client.ts`, replace `ApiTransactionResponse` and the local `Transaction` mapping with `ApiTransaction` from shared. Remove the `Transaction` shared-type import and the round-trip cents conversion in `getRecentTransactions` — return `ApiTransaction[]` directly. Callers (`recent.ts`, `query.ts`) update to read `tx.amount` (string) instead of `tx.amount` (number cents).

Update consumers:
- `apps/bot/src/handlers/recent.ts:47` — `S$(tx.amount/100)` becomes `S$${tx.amount}` (already a decimal string).
- `apps/bot/src/handlers/query.ts:186-187, 209, 212, 234, 261` — replace `tx.amount` integer math with `parseFloat(tx.amount)`. Or keep cents internally by adding a `parseAmountToCents(tx)` helper in shared.

Recommended: add a helper in `packages/shared/src/format.ts`:
```ts
export function amountToCents(decimalAmount: string): number {
  const n = Number.parseFloat(decimalAmount)
  return Math.round(n * 100)
}
```
Use it everywhere the bot wants cents.

- [ ] **Step 4: Delete `Transaction` type from shared (already done in Step 1)**

```bash
grep -rn "from '@spend-again/shared'" apps packages | grep "Transaction"
```
Expected: only `ApiTransaction` matches.

- [ ] **Step 5: Type-check**

```bash
pnpm turbo run type-check
```
Fix any breaks.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: shared types now host wire DTOs; dashboard and bot consume them"
```

### Task 3.5: Dashboard modal uses server-backed custom categories

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/dashboard/src/components/TransactionModal.tsx`

- [ ] **Step 1: Add api functions**

In `apps/dashboard/src/lib/api.ts`:
```ts
import type { CustomCategory } from '@spend-again/shared'

export async function listCustomCategories(): Promise<CustomCategory[]> {
  return apiFetch<CustomCategory[]>('/api/users/custom-categories')
}

export async function createCustomCategory(input: { category: string; subCategory: string }): Promise<CustomCategory> {
  return apiFetch<CustomCategory>('/api/users/custom-categories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteCustomCategory(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/users/custom-categories/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 2: Modal fetches on mount**

In `apps/dashboard/src/components/TransactionModal.tsx`:
```tsx
import { useEffect } from 'react'
import { listCustomCategories, createCustomCategory } from '../lib/api'
import type { CustomCategory } from '@spend-again/shared'

// inside component:
const [serverCustoms, setServerCustoms] = useState<CustomCategory[]>([])

useEffect(() => {
  let cancelled = false
  void listCustomCategories().then((data) => { if (!cancelled) setServerCustoms(data) })
  return () => { cancelled = true }
}, [])

// derive allCategories and allSubCategories from server data instead of session state:
const customCategoryNames = Array.from(new Set(serverCustoms.map((c) => c.category)))
  .filter((c) => !CATEGORIES.includes(c as Category))
const allCategories = [...CATEGORIES, ...customCategoryNames]

const customSubsForCategory = serverCustoms
  .filter((c) => c.category === category)
  .map((c) => c.subCategory)
const baseSubs = (CATEGORY_MAP[category as Category] ?? ['Other']) as string[]
const allSubCategories = Array.from(new Set([...baseSubs, ...customSubsForCategory]))
```

- [ ] **Step 3: handleDrawerConfirm POSTs to server**

```tsx
async function handleDrawerConfirm() {
  const name = drawerInput.trim()
  if (!name) return
  try {
    if (drawerTarget === 'category') {
      const created = await createCustomCategory({ category: name, subCategory: 'Other' })
      setServerCustoms((prev) => [...prev, created])
      setCategory(name)
      setSubCategory('Other')
    } else if (drawerTarget === 'subcategory') {
      const created = await createCustomCategory({ category, subCategory: name })
      setServerCustoms((prev) => [...prev, created])
      setSubCategory(name)
    }
    closeDrawer()
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to add')
  }
}
```

- [ ] **Step 4: Delete session-only state**

Remove the `customCategories` and `customSubCategories` state and their usages.

- [ ] **Step 5: Type-check and run**

```bash
pnpm --filter @spend-again/dashboard type-check
pnpm --filter @spend-again/dashboard dev   # smoke-test in browser
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/
git commit -m "feat(dashboard): persist custom (sub-)categories via /api/users/custom-categories"
```

### Task 3.6: Centralise duplicated helpers

**Files:**
- Verify/extend: `packages/shared/src/dates.ts`, `packages/shared/src/format.ts`, `packages/shared/src/category-emoji.ts`
- Delete duplicates across apps

- [ ] **Step 1: Consolidate dates.ts**

`packages/shared/src/dates.ts` (extend Phase 2 version):
```ts
export function getTodayDDMMYYYY(): string {
  const now = new Date()
  return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`
}

export function getYesterdayDDMMYYYY(): string {
  const now = new Date(); now.setDate(now.getDate() - 1)
  return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`
}

export function parseDDMMYYYY(s: string): Date | null {
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yyyy] = parts
  if (!dd || !mm || !yyyy) return null
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
}

export function fmtShortDate(s: string): string {
  const parts = s.split('/')
  if (parts.length !== 3) return s
  return `${parts[0]}/${parts[1]}`
}
```

- [ ] **Step 2: Create format.ts**

`packages/shared/src/format.ts`:
```ts
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}
export function parseCents(raw: string): number {
  const dot = raw.indexOf('.')
  if (dot === -1) return parseInt(raw, 10) * 100
  const int = raw.slice(0, dot)
  const dec = raw.slice(dot + 1).padEnd(2, '0').slice(0, 2)
  return parseInt(int, 10) * 100 + parseInt(dec, 10)
}
export function amountToCents(decimal: string): number {
  const n = Number.parseFloat(decimal)
  return Math.round(n * 100)
}
export function fmtSGD(cents: number): string {
  return `S$${centsToDecimalString(cents)}`
}
```

- [ ] **Step 3: Create category-emoji.ts**

`packages/shared/src/category-emoji.ts`:
```ts
import type { Category } from './categories.js'

export const CATEGORY_EMOJI: Record<Category, string> = {
  Food: '\u{1F35C}', Transport: '\u{1F697}', Groceries: '\u{1F6D2}',
  Shopping: '\u{1F6CD}', Entertainment: '\u{1F3AE}', Health: '\u{1F48A}',
  Education: '\u{1F4DA}', Travel: '\u{2708}', Utilities: '\u{1F4A1}',
  Finance: '\u{1F4B3}', Housing: '\u{1F3E0}', Other: '\u{1F4B0}',
}

export function emojiFor(category: string | undefined): string {
  if (!category) return CATEGORY_EMOJI.Other
  return CATEGORY_EMOJI[category as Category] ?? CATEGORY_EMOJI.Other
}
```

- [ ] **Step 4: Re-export from shared index**

```ts
export * from './dates.js'
export * from './format.js'
export * from './category-emoji.js'
```

- [ ] **Step 5: Delete duplicates**

In each file below, delete the local definition and import from `@spend-again/shared`:
- `packages/parser/src/regex.ts:32-47, 49-57` (date + parseCents)
- `packages/parser/src/gemini.ts:126-141`
- `packages/parser/src/ocr.ts:132-138`
- `packages/parser/src/sms.ts:12-20`
- `apps/api/src/routes/analytics.ts:51-74`
- `apps/bot/src/handlers/confirm.ts:29-35`
- `apps/bot/src/handlers/receipt-confirm.ts:21-27`
- `apps/bot/src/handlers/query.ts:17-44, 180`
- `apps/bot/src/handlers/expense.ts:15-28, 54-56` (CATEGORY_EMOJI, formatAmount)
- `apps/bot/src/handlers/recent.ts:10-23`
- `apps/bot/src/handlers/receipt.ts:86-99`
- `apps/dashboard/src/components/TransactionTable.tsx:17-31` (CATEGORY_EMOJI map; CATEGORY_COLOR can stay — it's UI-specific)

- [ ] **Step 6: Remove the Income special-case from TransactionTable**

Delete the `Income` entry from `CATEGORY_EMOJI` and `CATEGORY_COLOR`, and remove the `isIncome`/`+`-sign logic. Income is no longer a recognised category.

- [ ] **Step 7: Lint + tests**

```bash
pnpm turbo run lint type-check test
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: centralise date, cents, and category-emoji helpers in @spend-again/shared"
```

### Task 3.7: Phase 3 acceptance gate

- [ ] **Step 1: Full sweep**

```bash
pnpm turbo run lint type-check test
pnpm --filter @spend-again/api test -- __tests__/integration
```

- [ ] **Step 2: Manual smoke**

Run the bot locally against the test API. Log an expense ("$10 chicken rice"), confirm, tap "remember it", restart the bot, log another and confirm Tier-2 lookup works. Open the dashboard, add a custom subcategory, refresh — it should still be there.

- [ ] **Step 3: PR**

---

# Phase 4 — Drop legacy

**Subagent:** `general-purpose`. Worktree: `wt-phase-4-drop-legacy`. **Sign-off gate on 4.1.**

### Task 4.1: Drop text date column

**Files:**
- Create: `packages/db/drizzle/0004_drop_text_date.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `apps/api/src/services/transactions.ts`
- Modify: `packages/shared/src/types.ts` (drop `date` from `ApiTransaction` if no consumer needs it)

- [ ] **Step 1: SIGN-OFF CHECKPOINT**

Subagent reports: "About to DROP COLUMN date. Confirm Supabase snapshot taken. Awaiting human go."

- [ ] **Step 2: Add migration**

```sql
ALTER TABLE transactions DROP COLUMN date;
```
Generate via `drizzle-kit generate` after removing `date: text(...)` from `schema.ts`.

- [ ] **Step 3: Service no longer dual-writes**

In `apps/api/src/services/transactions.ts`, drop the `date: input.date` write in `create()` and `update()`. `CreateTransactionInput.date` becomes the input to `ddmmyyyyToIso` only.

- [ ] **Step 4: ApiTransaction response replaces `date` with `occurredOn`**

In `packages/shared/src/types.ts`, drop `date: string` from `ApiTransaction` and add `occurredOn: string` (ISO `YYYY-MM-DD`). The API serialiser already returns the row spread, so this lines up automatically once `transactions.date` is gone.

Update consumers that previously read `tx.date` (DD/MM/YYYY) to read `tx.occurredOn` (ISO) and reformat for display:
- `apps/dashboard/src/components/TransactionTable.tsx:54` — rewrite `formatDate` to accept `YYYY-MM-DD` and output `D Mon YYYY`.
- `apps/dashboard/src/components/TransactionModal.tsx:27-31` — `ddmmyyyyToHtmlDate` becomes the identity for ISO; `htmlDateToDDMMYYYY` becomes `htmlDateToIso` (also identity, since `<input type="date">` outputs `YYYY-MM-DD`). The form submits ISO; the API service still expects DD/MM/YYYY in `CreateTransactionRequest.date` until 4.1 closes — change the request DTO field too. Decision: rename the request field to `date` but document as ISO in the comment, and have the service call `ddmmyyyyToIso` only if input is DD/MM/YYYY (detect by regex; accept both for one transition period). After 4.5, change to ISO-only.
- `apps/bot/src/handlers/recent.ts:48` — `(${tx.date})` becomes formatted from `tx.occurredOn`.
- `apps/bot/src/handlers/query.ts` — `parseDDMMYYYY(tx.date)` becomes `new Date(tx.occurredOn)`.
- `apps/api/src/services/transactions.ts` `CreateTransactionInput.date` — accept ISO `YYYY-MM-DD`. Drop `ddmmyyyyToIso` from the write path; the bot/dashboard pass ISO directly.
- `apps/bot/src/handlers/{confirm,receipt-confirm}.ts` — `getTodayDDMMYYYY()` use replaced with ISO equivalent `new Date().toISOString().slice(0,10)`.

- [ ] **Step 5: Run migration + integration test**

```bash
pnpm --filter @spend-again/db migrate
pnpm --filter @spend-again/api test -- __tests__/integration
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): drop legacy text date column; reads/writes use occurred_on"
```

### Task 4.2: Remove Settings stub

**Files:**
- Delete: `apps/dashboard/src/pages/Settings.tsx`
- Modify: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/src/components/Sidebar.tsx`

- [ ] **Step 1: Delete file**

```bash
git rm apps/dashboard/src/pages/Settings.tsx
```

- [ ] **Step 2: Drop route**

In `apps/dashboard/src/App.tsx`, remove the `/settings` Route and the `Settings` import.

- [ ] **Step 3: Drop sidebar entry**

In `apps/dashboard/src/components/Sidebar.tsx:40-44`, drop the Settings NAV_ITEM and the `IconSettings` component.

- [ ] **Step 4: Type-check + build**

```bash
pnpm --filter @spend-again/dashboard type-check
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(dashboard): remove placeholder Settings page until there are real settings"
```

### Task 4.3: Remove non-functional notification bell

**Files:**
- Modify: `apps/dashboard/src/components/Header.tsx`

- [ ] **Step 1: Drop the bell block**

In `Header.tsx`, remove the `<div className="header-bell" …>` block. Leave the user/avatar/logout intact.

- [ ] **Step 2: Build**

```bash
pnpm --filter @spend-again/dashboard type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/Header.tsx
git commit -m "chore(dashboard): remove non-functional notification bell"
```

### Task 4.4: Delete mock dev-token fallback

**Files:**
- Modify: `apps/dashboard/src/hooks/useAuth.ts`
- Modify: `apps/dashboard/src/pages/Login.tsx`

- [ ] **Step 1: Delete createMockDevToken and the catch fallback**

In `apps/dashboard/src/hooks/useAuth.ts`, delete the `createMockDevToken` function. In `loginAsTestUser`, simplify the catch to surface the error:
```ts
} catch (err) {
  setState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'Dev login failed' }))
}
```

- [ ] **Step 2: Gate the button on build-time DEV flag**

In `apps/dashboard/src/pages/Login.tsx:5`:
```ts
const DEV_MODE = import.meta.env.DEV
```
(Replace the `VITE_DEV_MODE === 'true'` runtime check with Vite's compile-time flag, which is `false` in production builds.)

- [ ] **Step 3: Build prod, confirm button gone**

```bash
pnpm --filter @spend-again/dashboard build
grep -r "Skip login" apps/dashboard/dist
```
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/
git commit -m "chore(dashboard): remove mock dev-token fallback; gate dev button on import.meta.env.DEV"
```

### Task 4.5: Phase 4 acceptance gate

- [ ] **Step 1: Final sweep**

```bash
pnpm turbo run lint type-check test
pnpm --filter @spend-again/api test -- __tests__/integration
```

- [ ] **Step 2: PR**

After merge, the review is fully closed.

---

# Self-review (run before handing to executor)

Skim each section of the spec, confirm a task implements it:

- [x] 1.1 receipt userId → Task 1.1
- [x] 1.3 list pagination + ordering → Task 1.2
- [x] 1.4 rate-limit ordering → Task 1.3
- [x] 1.5 Books → Shopping → Task 1.4
- [x] 1.6 RPM message → Task 1.5
- [x] 1.7 error class dedupe → Task 1.5
- [x] 1.8 hard-fail env → Task 1.6
- [x] 1.9 Welcome.tsx → Task 1.7
- [x] 1.10 callback_data → Task 1.8
- [x] 2.1 occurred_on add+backfill → Task 2.1
- [x] 2.2 service dual-write → Task 2.2
- [x] 2.3 user_custom_categories table → Task 2.3
- [x] 2.4 custom-categories endpoints → Task 2.4
- [x] 2.6 learned-mappings endpoints → Task 2.5
- [x] 2.7 users requireAuth at index → covered in 1.3 (per-router pattern)
- [x] 3.1 bot uses /api/learned-mappings → Task 3.1, 3.2
- [x] 3.2 drop DATABASE_URL from bot → Task 3.2
- [x] 3.3 read cutover → Task 3.3
- [x] 3.4 types unification → Task 3.4
- [x] 3.5 dashboard server-backed customs → Task 3.5
- [x] 3.6 centralise helpers → Task 3.6
- [x] 3.7 wire RPM gate → Task 3.2 (parse() awaits before Gemini)
- [x] 4.1 drop text date → Task 4.1
- [x] 4.2 Settings → Task 4.2
- [x] 4.3 bell → Task 4.3
- [x] 4.4 mock token → Task 4.4

Coverage: complete.
