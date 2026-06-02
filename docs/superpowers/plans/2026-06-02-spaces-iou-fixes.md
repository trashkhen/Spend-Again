# Spaces & IOU Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add space deactivate/reactivate/delete, emoji confirmation flow, archived-spaces tab (website + bot), space detail tabs with donut chart and transaction list, dedicated `/iou` command with per-person list, and update the help message.

**Architecture:** Extend existing spaces service with three new methods (hardDelete, getTransactions, getBreakdown), register new API routes, then build UI and bot handler changes on top. No DB schema changes needed — `transactionSpaces` FK already cascades on space delete.

**Tech Stack:** Hono (API), Drizzle ORM, React + Recharts (dashboard), grammY (Telegram bot), Vitest (tests), TypeScript strict throughout.

---

## File Map

**Modified:**
- `packages/parser/src/gemini.ts` — add `emoji` to `ParsedSpaceResult` type + `buildSpacePrompt`
- `apps/api/src/services/spaces.ts` — add `hardDelete`, `getTransactions`, `getBreakdown` to service
- `apps/api/src/routes/spaces.ts` — register `DELETE /:id/permanent`, `GET /:id/transactions`, `GET /:id/breakdown`
- `apps/api/__tests__/spaces.test.ts` — tests for three new service methods
- `apps/bot/src/lib/api-client.ts` — add `updateSpace`, `hardDeleteSpace`, `listAllDebts`
- `apps/bot/src/keyboards/space.ts` — add emoji-confirm, deactivate, delete-confirm, archived-list, archived-item, reactivate keyboards
- `apps/bot/src/keyboards/iou.ts` — add `buildIouListKeyboard`
- `apps/bot/src/handlers/space.ts` — emoji confirm flow, deactivate/delete/archived callbacks, ctx.match fix
- `apps/bot/src/handlers/iou.ts` — add `iouCommandHandler`, `pendingIouNew`, `iou_new` + `iou_settle_single:` callbacks
- `apps/bot/src/keyboards/main.ts` — add `💸 IOUs` button
- `apps/bot/src/bot.ts` — register `/iou` command, `💸 IOUs` hears, pending-iou-new flow
- `apps/dashboard/src/lib/api.ts` — add `reactivateSpace`, `permanentDeleteSpace`, `getSpaceTransactions`, `getSpaceBreakdown`, `SpaceBreakdownItem` type
- `apps/dashboard/src/pages/Spaces.tsx` — Active/Archived tabs, Deactivate/Reactivate/Delete buttons, SpaceDetail inline edit + Overview/Transactions tabs
- `packages/shared/src/bot-messages.ts` — update `MSG_HELP`

**Created:**
- `apps/dashboard/src/components/SpaceDonutChart.tsx` — Recharts PieChart donut component

---

## Task 1: Parser — add emoji to ParsedSpaceResult

**Files:**
- Modify: `packages/parser/src/gemini.ts`

- [ ] **Step 1: Write failing test**

  In `packages/parser/src/gemini.test.ts` (create if not exists):

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { buildSpacePrompt } from './gemini.js'

  describe('buildSpacePrompt', () => {
    it('includes emoji in the JSON shape', () => {
      const prompt = buildSpacePrompt('Bali Trip from 03/06 to 08/06')
      expect(prompt).toContain('"emoji"')
    })
  })
  ```

  Run: `pnpm --filter @spend-again/parser test`
  Expected: FAIL — `buildSpacePrompt` output doesn't contain `"emoji"`

- [ ] **Step 2: Update `ParsedSpaceResult` type**

  In `packages/parser/src/gemini.ts`, change:

  ```typescript
  export type ParsedSpaceResult = {
    name: string
    budgetCents?: number | null
    startDate?: string | null
    endDate?: string | null
  }
  ```

  to:

  ```typescript
  export type ParsedSpaceResult = {
    name: string
    emoji?: string | null
    budgetCents?: number | null
    startDate?: string | null
    endDate?: string | null
  }
  ```

- [ ] **Step 3: Update `buildSpacePrompt`**

  Find the `VALID JSON SHAPE` block in `buildSpacePrompt` and replace it:

  ```typescript
  // Old JSON shape:
  // {
  //   "name": "string",
  //   "budgetCents": number or null,
  //   "startDate": "YYYY-MM-DD" or null,
  //   "endDate": "YYYY-MM-DD" or null
  // }

  // New JSON shape (add emoji field and rule):
  ```

  Update the return string so the JSON shape section reads:

  ```
  VALID JSON SHAPE (you MUST return ONLY this JSON shape, nothing else):
  {
    "name": "string",
    "emoji": "single emoji or null",
    "budgetCents": number or null,
    "startDate": "YYYY-MM-DD" or null,
    "endDate": "YYYY-MM-DD" or null
  }
  ```

  And add this rule after the existing rules:

  ```
  6. "emoji" should be a single emoji character that best represents the space theme (e.g. "🏖️" for beach/holiday, "🎓" for school/university, "🛫" for travel, "🎉" for events, "🍽️" for food outings). If no clear emoji fits, return null.
  ```

- [ ] **Step 4: Extract emoji in `parseSpaceWithGemini`**

  In the parsing block that builds the return value (around line 309–316), add emoji extraction:

  ```typescript
  const name = typeof obj['name'] === 'string' ? obj['name'] : ''
  if (!name) return null

  const emoji = typeof obj['emoji'] === 'string' && obj['emoji'].length > 0
    ? obj['emoji']
    : null
  const budgetCents = typeof obj['budgetCents'] === 'number' ? obj['budgetCents'] : null
  const startDate = typeof obj['startDate'] === 'string' ? obj['startDate'] : null
  const endDate = typeof obj['endDate'] === 'string' ? obj['endDate'] : null

  return { name, emoji, budgetCents, startDate, endDate }
  ```

- [ ] **Step 5: Run test — expect PASS**

  Run: `pnpm --filter @spend-again/parser test`
  Expected: PASS

- [ ] **Step 6: Lint**

  Run: `pnpm turbo run lint`
  Expected: no errors

- [ ] **Step 7: Commit**

  ```bash
  git add packages/parser/src/gemini.ts packages/parser/src/gemini.test.ts
  git commit -m "feat(parser): add emoji field to ParsedSpaceResult and Gemini space prompt"
  ```

---

## Task 2: API service — hardDelete, getTransactions, getBreakdown

**Files:**
- Modify: `apps/api/src/services/spaces.ts`
- Modify: `apps/api/__tests__/spaces.test.ts`

- [ ] **Step 1: Write failing tests**

  Add to `apps/api/__tests__/spaces.test.ts`. First find the `makeMockDb` function and add `deleteHardReturn` and `selectTxReturn` to the overrides object. Then add three new `describe` blocks after the existing ones:

  ```typescript
  // Add to makeMockDb overrides type:
  // deleteHardReturn?: { id: string }[]
  // selectTxReturn?: Record<string, unknown>[]
  ```

  Then add tests:

  ```typescript
  describe('hardDelete', () => {
    it('returns true when space exists', async () => {
      const svc = createSpacesService(makeMockDb({ deleteReturn: [{ id: BASE_SPACE.id }] }))
      const result = await svc.hardDelete(BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toBe(true)
    })

    it('returns false when space not found', async () => {
      const svc = createSpacesService(makeMockDb({ deleteReturn: [] }))
      const result = await svc.hardDelete('non-existent', BASE_SPACE.userId)
      expect(result).toBe(false)
    })
  })

  describe('getBreakdown', () => {
    it('returns empty array when no transactions', async () => {
      const mockDb = makeMockDb({ selectReturn: [] })
      // Override select to return empty for breakdown query
      const svc = createSpacesService({
        ...mockDb,
        select: () => ({
          from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }) }) }),
        }),
      } as unknown as DbClient)
      const result = await svc.getBreakdown(BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toEqual([])
    })

    it('calculates percentage correctly', async () => {
      const rows = [
        { category: 'Food', totalCents: 600 },
        { category: 'Transport', totalCents: 400 },
      ]
      const svc = createSpacesService({
        select: () => ({
          from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve(rows) }) }) }) }),
        }),
      } as unknown as DbClient)
      const result = await svc.getBreakdown(BASE_SPACE.id, BASE_SPACE.userId)
      expect(result).toHaveLength(2)
      const food = result.find(r => r.category === 'Food')
      expect(food?.pct).toBe(60)
    })
  })
  ```

  Run: `pnpm --filter @spend-again/api test`
  Expected: FAIL — `hardDelete`, `getBreakdown` not defined on service

- [ ] **Step 2: Update `SpacesService` interface**

  In `apps/api/src/services/spaces.ts`, add three new method signatures to the `SpacesService` interface:

  ```typescript
  export interface SpacesService {
    create(input: CreateSpaceInput): Promise<ApiSpace>
    list(userId: string): Promise<SpaceWithTotal[]>
    findById(id: string, userId: string): Promise<ApiSpace | null>
    update(id: string, userId: string, input: UpdateSpaceInput): Promise<ApiSpace | null>
    archive(id: string, userId: string): Promise<boolean>
    hardDelete(id: string, userId: string): Promise<boolean>
    getTransactions(id: string, userId: string): Promise<ApiTransaction[]>
    getBreakdown(id: string, userId: string): Promise<{ category: string; totalCents: number; pct: number }[]>
    attachTransaction(transactionId: string, spaceId: string, userId: string): Promise<boolean>
    detachTransaction(transactionId: string, spaceId: string, userId: string): Promise<boolean>
    findByDateWindow(userId: string, isoDate: string): Promise<ApiSpace[]>
    setActiveSpace(userId: string, spaceId: string | null): Promise<void>
    getActiveSpace(userId: string): Promise<ApiSpace | null>
  }
  ```

  Add `ApiTransaction` to imports from `@spend-again/shared`:

  ```typescript
  import type { SpaceWithTotal, ApiSpace, ApiTransaction } from '@spend-again/shared'
  ```

  Add `desc` to drizzle-orm import:

  ```typescript
  import { eq, and, lte, gte, sql, desc } from 'drizzle-orm'
  ```

- [ ] **Step 3: Add a local `toApiTx` helper and the three methods**

  Add `toApiTx` just below the existing `toApiSpace` function:

  ```typescript
  function toApiTx(
    row: typeof transactions.$inferSelect,
    spaceId: string,
  ): ApiTransaction {
    return {
      id: row.id,
      userId: row.userId,
      amountCents: row.amountCents,
      amount: centsToDecimalString(row.amountCents),
      item: row.item,
      description: row.description ?? null,
      category: row.category,
      subCategory: row.subCategory,
      occurredOn: row.occurredOn,
      source: row.source as ApiTransaction['source'],
      spaceId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
  ```

  Then add three methods to `createSpacesService`, after the existing `archive` method:

  ```typescript
  async hardDelete(id, userId) {
    const rows = await db
      .delete(spaces)
      .where(and(eq(spaces.id, id), eq(spaces.userId, userId)))
      .returning()
    return rows.length > 0
  },

  async getTransactions(id, userId) {
    const rows = await db
      .select({ tx: transactions })
      .from(transactionSpaces)
      .innerJoin(transactions, eq(transactions.id, transactionSpaces.transactionId))
      .innerJoin(spaces, eq(spaces.id, transactionSpaces.spaceId))
      .where(and(eq(transactionSpaces.spaceId, id), eq(spaces.userId, userId)))
      .orderBy(desc(transactions.occurredOn))
    return rows.map(r => toApiTx(r.tx, id))
  },

  async getBreakdown(id, userId) {
    const rows = await db
      .select({
        category: transactions.category,
        totalCents: sql<number>`sum(${transactions.amountCents})`,
      })
      .from(transactionSpaces)
      .innerJoin(transactions, eq(transactions.id, transactionSpaces.transactionId))
      .innerJoin(spaces, eq(spaces.id, transactionSpaces.spaceId))
      .where(and(eq(transactionSpaces.spaceId, id), eq(spaces.userId, userId)))
      .groupBy(transactions.category)
    const grandTotal = rows.reduce((s, r) => s + Number(r.totalCents), 0)
    return rows.map(r => ({
      category: r.category,
      totalCents: Number(r.totalCents),
      pct: grandTotal > 0 ? Math.round((Number(r.totalCents) / grandTotal) * 100) : 0,
    }))
  },
  ```

- [ ] **Step 4: Run tests — expect PASS**

  Run: `pnpm --filter @spend-again/api test`
  Expected: PASS (the `hardDelete` tests pass; the breakdown percentage tests pass)

- [ ] **Step 5: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/api/src/services/spaces.ts apps/api/__tests__/spaces.test.ts
  git commit -m "feat(api): add hardDelete, getTransactions, getBreakdown to spaces service"
  ```

---

## Task 3: API routes — register new endpoints

**Files:**
- Modify: `apps/api/src/routes/spaces.ts`

- [ ] **Step 1: Add `DELETE /:id/permanent` before the existing `DELETE /:id`**

  In `apps/api/src/routes/spaces.ts`, insert this block *before* the existing `router.delete('/:id', ...)` block (Hono matches routes in registration order, so the specific `/permanent` suffix must be first):

  ```typescript
  // DELETE /api/spaces/:id/permanent  (hard delete — keeps transactions)
  router.delete('/:id/permanent', async (c) => {
    const userId = c.get('userId')
    const ok = await svc.hardDelete(c.req.param('id'), userId)
    if (!ok) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    return c.json({ ok: true })
  })
  ```

- [ ] **Step 2: Add `GET /:id/transactions` and `GET /:id/breakdown`**

  Insert both *after* the existing `GET /:id` route:

  ```typescript
  // GET /api/spaces/:id/transactions
  router.get('/:id/transactions', async (c) => {
    const userId = c.get('userId')
    const txs = await svc.getTransactions(c.req.param('id'), userId)
    return c.json(txs)
  })

  // GET /api/spaces/:id/breakdown
  router.get('/:id/breakdown', async (c) => {
    const userId = c.get('userId')
    const breakdown = await svc.getBreakdown(c.req.param('id'), userId)
    return c.json(breakdown)
  })
  ```

- [ ] **Step 3: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/api/src/routes/spaces.ts
  git commit -m "feat(api): add permanent delete, transactions, and breakdown routes for spaces"
  ```

---

## Task 4: Bot API client — new methods

**Files:**
- Modify: `apps/bot/src/lib/api-client.ts`

- [ ] **Step 1: Verify `CreateSpacePayload` includes `emoji`**

  Search for `CreateSpacePayload` in `apps/bot/src/lib/api-client.ts`. If it's missing the `emoji` field, add it:

  ```typescript
  type CreateSpacePayload = {
    name: string
    emoji?: string
    budgetCents?: number
    startDate?: string
    endDate?: string
  }
  ```

- [ ] **Step 2: Add `updateSpace`, `hardDeleteSpace`, `listAllDebts`**

  Locate the `setActiveSpace` method in the api-client object and add the three new methods nearby:

  ```typescript
  async updateSpace(id: string, data: { status?: 'active' | 'archived'; name?: string; emoji?: string | null }): Promise<ApiSpace | null> {
    try {
      const res = await fetch(`${API_URL}/api/spaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(data),
      })
      if (!res.ok) { log.error({ status: res.status }, 'updateSpace failed'); return null }
      return res.json() as Promise<ApiSpace>
    } catch (err) { log.error({ err }, 'updateSpace error'); return null }
  },

  async hardDeleteSpace(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/spaces/${id}/permanent`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      })
      return res.ok
    } catch (err) { log.error({ err }, 'hardDeleteSpace error'); return false }
  },

  async listAllDebts(): Promise<DebtWithPerson[]> {
    try {
      const res = await fetch(`${API_URL}/api/iou/debts`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!res.ok) { log.error({ status: res.status }, 'listAllDebts failed'); return [] }
      return res.json() as Promise<DebtWithPerson[]>
    } catch (err) { log.error({ err }, 'listAllDebts error'); return [] }
  },
  ```

  > Note: `listAllDebts` calls `GET /api/iou/debts` without a `personName` filter — verify this endpoint returns all open/partially_paid debts when no filter is passed. If the endpoint requires a filter, check `apps/api/src/routes/iou.ts` and adjust accordingly.

- [ ] **Step 3: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/bot/src/lib/api-client.ts
  git commit -m "feat(bot): add updateSpace, hardDeleteSpace, listAllDebts to API client"
  ```

---

## Task 5: Dashboard API client — new functions

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add type and four new functions**

  Add at the bottom of the spaces section in `apps/dashboard/src/lib/api.ts`:

  ```typescript
  export type SpaceBreakdownItem = {
    category: string
    totalCents: number
    pct: number
  }

  export async function deactivateSpace(id: string): Promise<void> {
    await apiFetch(`/api/spaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
  }

  export async function reactivateSpace(id: string): Promise<void> {
    await apiFetch(`/api/spaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })
  }

  export async function permanentDeleteSpace(id: string): Promise<void> {
    await apiFetch(`/api/spaces/${id}/permanent`, { method: 'DELETE' })
  }

  export async function getSpaceTransactions(id: string): Promise<ApiTransaction[]> {
    return apiFetch<ApiTransaction[]>(`/api/spaces/${id}/transactions`)
  }

  export async function getSpaceBreakdown(id: string): Promise<SpaceBreakdownItem[]> {
    return apiFetch<SpaceBreakdownItem[]>(`/api/spaces/${id}/breakdown`)
  }
  ```

- [ ] **Step 2: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/dashboard/src/lib/api.ts
  git commit -m "feat(dashboard): add deactivate, reactivate, permanent delete, breakdown API client functions"
  ```

---

## Task 6: Install recharts + SpaceDonutChart component

**Files:**
- Create: `apps/dashboard/src/components/SpaceDonutChart.tsx`

- [ ] **Step 1: Install recharts**

  ```bash
  pnpm add recharts --filter @spend-again/dashboard
  ```

  Expected: recharts added to `apps/dashboard/package.json`

- [ ] **Step 2: Create `SpaceDonutChart.tsx`**

  ```tsx
  import { PieChart, Pie, Cell, Legend, Tooltip } from 'recharts'
  import type { SpaceBreakdownItem } from '../lib/api'

  const COLORS = ['#7c83fd', '#4ade80', '#f59e0b', '#f87171', '#a78bfa', '#34d399', '#fb923c', '#60a5fa']

  type Props = { data: SpaceBreakdownItem[] }

  export function SpaceDonutChart({ data }: Props) {
    if (data.length === 0) {
      return <p className="space-meta">No transactions to chart yet.</p>
    }
    const chartData = data.map(d => ({ name: d.category, value: d.totalCents, pct: d.pct }))
    return (
      <PieChart width={300} height={240}>
        <Pie
          data={chartData}
          cx={100}
          cy={110}
          innerRadius={60}
          outerRadius={95}
          dataKey="value"
          paddingAngle={2}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => [`S$${(value / 100).toFixed(2)}`, 'Spent']}
        />
        <Legend
          formatter={(name: string, entry) => {
            const payload = entry.payload as { pct: number } | undefined
            return `${name} ${payload?.pct ?? 0}%`
          }}
        />
      </PieChart>
    )
  }
  ```

- [ ] **Step 3: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/dashboard/src/components/SpaceDonutChart.tsx apps/dashboard/package.json pnpm-lock.yaml
  git commit -m "feat(dashboard): add SpaceDonutChart component using recharts"
  ```

---

## Task 7: Dashboard — Spaces list page (Active/Archived tabs)

**Files:**
- Modify: `apps/dashboard/src/pages/Spaces.tsx` — `Spaces` component only (not `SpaceDetail`)

- [ ] **Step 1: Rewrite the `Spaces` component**

  Replace the entire `Spaces` function (lines 9–86) with:

  ```tsx
  export function Spaces() {
    const [spaces, setSpaces] = useState<SpaceWithTotal[]>([])
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
      listSpaces().then(setSpaces).catch(() => {}).finally(() => setLoading(false))
    }, [])

    async function handleDeactivate(id: string) {
      try {
        await deactivateSpace(id)
        setSpaces(prev => prev.map(s => s.id === id ? { ...s, status: 'archived' as const } : s))
      } catch { /* silent */ }
    }

    async function handleReactivate(id: string) {
      try {
        await reactivateSpace(id)
        setSpaces(prev => prev.map(s => s.id === id ? { ...s, status: 'active' as const } : s))
      } catch { /* silent */ }
    }

    async function handleDelete(id: string) {
      try {
        await permanentDeleteSpace(id)
        setSpaces(prev => prev.filter(s => s.id !== id))
        setConfirmDeleteId(null)
      } catch { /* silent */ }
    }

    const shown = spaces.filter(s => s.status === activeTab)
    const activeCount = spaces.filter(s => s.status === 'active').length
    const archivedCount = spaces.filter(s => s.status === 'archived').length

    return (
      <Layout>
        <div className="app-main page-enter">
          <div className="page-header">
            <div>
              <h1 className="page-title">Spaces</h1>
              <p className="page-subtitle">Organise spending into dedicated budgets and trips.</p>
            </div>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            {(['active', 'archived'] as const).map(tab => (
              <button
                key={tab}
                className="btn btn-ghost"
                style={{
                  borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRadius: 0,
                  color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                  padding: '8px 16px',
                }}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'active' ? `Active (${activeCount})` : `Archived (${archivedCount})`}
              </button>
            ))}
          </div>

          {loading && (
            <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
          )}
          {!loading && shown.length === 0 && (
            <div className="table-state table-state--empty">
              <p className="table-empty-message">
                {activeTab === 'active'
                  ? <>No active spaces. Create one via Telegram: <code>/space</code></>
                  : 'No archived spaces.'}
              </p>
            </div>
          )}

          {shown.map(s => (
            <div key={s.id} className="space-card" style={{ marginBottom: 14 }}>
              {confirmDeleteId === s.id ? (
                <div>
                  <p style={{ marginBottom: 8, fontSize: 14 }}>
                    Permanently remove <strong>{s.emoji ?? '📦'} {s.name}</strong>? Transactions are kept.
                  </p>
                  <div className="space-actions">
                    <button className="btn btn-danger" onClick={() => { void handleDelete(s.id) }}>
                      Yes, delete
                    </button>
                    <button className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-item-row">
                    <span className="space-item-name" style={{ fontSize: 15 }}>
                      {s.emoji ?? '📦'} {s.name}
                    </span>
                    <span className={`space-status-badge space-status-badge--${s.status}`}>
                      {s.status}
                    </span>
                  </div>
                  {s.startDate != null && (
                    <p className="space-meta">{s.startDate} – {s.endDate}</p>
                  )}
                  <p className="space-meta">
                    Spent: <strong>S${s.spent}</strong>
                    {s.budget != null ? ` / S$${s.budget}` : ''} ({s.transactionCount} transactions)
                  </p>
                  <div className="space-actions">
                    <button className="btn btn-ghost" onClick={() => navigate(`/spaces/${s.id}`)}>
                      View →
                    </button>
                    {s.status === 'active' ? (
                      <button className="btn btn-ghost" onClick={() => { void handleDeactivate(s.id) }}>
                        Deactivate
                      </button>
                    ) : (
                      <button className="btn btn-ghost" onClick={() => { void handleReactivate(s.id) }}>
                        Reactivate
                      </button>
                    )}
                    <button className="btn btn-ghost" style={{ color: 'var(--danger, #f87171)' }}
                      onClick={() => setConfirmDeleteId(s.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Layout>
    )
  }
  ```

- [ ] **Step 2: Update imports at the top of Spaces.tsx**

  The import line needs the new API functions:

  ```typescript
  import {
    listSpaces, deactivateSpace, reactivateSpace, permanentDeleteSpace,
    updateSpace,
  } from '../lib/api'
  ```

  Also add `updateSpace` to the import — it's used in SpaceDetail (Task 8). You can update the full import at that point.

- [ ] **Step 3: Add `btn-danger` CSS if not already present**

  Check `apps/dashboard/src/index.css` for `.btn-danger`. If missing, add:

  ```css
  .btn-danger {
    background: transparent;
    border: 1px solid #f87171;
    color: #f87171;
  }
  .btn-danger:hover {
    background: rgba(248, 113, 113, 0.1);
  }
  ```

- [ ] **Step 4: Start dev server and verify**

  Run: `pnpm turbo run dev`
  Check: `/spaces` shows Active/Archived tabs. Active tab lists spaces. Archived tab lists deactivated spaces. Deactivate button moves a space to archived tab. Reactivate moves it back. Delete shows confirmation then removes.

- [ ] **Step 5: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/dashboard/src/pages/Spaces.tsx apps/dashboard/src/index.css
  git commit -m "feat(dashboard): Spaces list with Active/Archived tabs, Deactivate, Reactivate, Delete"
  ```

---

## Task 8: Dashboard — SpaceDetail (edit name + tabs + chart + transactions)

**Files:**
- Modify: `apps/dashboard/src/pages/Spaces.tsx` — `SpaceDetail` component only

- [ ] **Step 1: Replace `SpaceDetail` component**

  Replace the entire `SpaceDetail` function (from `export function SpaceDetail()` to end of file) with:

  ```tsx
  export function SpaceDetail() {
    const { id } = useParams<{ id: string }>()
    const [space, setSpace] = useState<SpaceWithTotal | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [editValue, setEditValue] = useState('')
    const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview')
    const [breakdown, setBreakdown] = useState<SpaceBreakdownItem[]>([])
    const [txs, setTxs] = useState<ApiTransaction[]>([])
    const navigate = useNavigate()

    useEffect(() => {
      if (!id) return
      listSpaces()
        .then(all => {
          const found = all.find(s => s.id === id) ?? null
          setSpace(found)
          if (found) setEditValue(`${found.emoji ?? ''} ${found.name}`.trim())
        })
        .catch(() => {})
      getSpaceBreakdown(id).then(setBreakdown).catch(() => {})
      getSpaceTransactions(id).then(setTxs).catch(() => {})
    }, [id])

    async function handleSaveName() {
      if (!id || !space) return
      const trimmed = editValue.trim()
      const emojiMatch = trimmed.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)/u)
      const emoji = emojiMatch?.[0] ?? null
      const name = emoji ? trimmed.slice(emoji.length).trim() : trimmed
      if (!name) return
      const updated = await updateSpace(id, { name, emoji: emoji ?? undefined })
      if (updated) {
        setSpace(prev => prev ? { ...prev, name: updated.name, emoji: updated.emoji } : prev)
        setEditValue(`${updated.emoji ?? ''} ${updated.name}`.trim())
      }
      setEditMode(false)
    }

    if (!space) {
      return (
        <Layout>
          <div className="app-main page-enter">
            <div className="table-state"><span className="spinner" aria-label="Loading…" /></div>
          </div>
        </Layout>
      )
    }

    const budgetPct = space.budgetCents != null
      ? Math.round((space.spentCents / space.budgetCents) * 100)
      : null

    return (
      <Layout>
        <div className="app-main page-enter">
          <button className="space-back-btn" onClick={() => navigate('/spaces')}>← Back</button>

          <div className="page-header" style={{ marginBottom: 20, alignItems: 'center' }}>
            {editMode ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <input
                  className="mock-input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleSaveName() }}
                  autoFocus
                  style={{ flex: 1, fontSize: 18 }}
                />
                <button className="btn btn-primary" onClick={() => { void handleSaveName() }}>Save</button>
                <button className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 className="page-title">{space.emoji ?? '📦'} {space.name}</h1>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 16, padding: '2px 8px' }}
                  onClick={() => setEditMode(true)}
                  title="Edit name"
                >✏️</button>
              </div>
            )}
          </div>

          {space.startDate != null && (
            <p className="space-meta" style={{ marginBottom: 16 }}>{space.startDate} – {space.endDate}</p>
          )}

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-label">Spent</div>
              <div className="kpi-value">S${space.spent}</div>
            </div>
            {space.budget != null && (
              <div className="kpi-card">
                <div className="kpi-label">Budget</div>
                <div className="kpi-value">S${space.budget}</div>
              </div>
            )}
            {budgetPct != null && (
              <div className="kpi-card">
                <div className="kpi-label">Used</div>
                <div className="kpi-value">{budgetPct}%</div>
              </div>
            )}
            <div className="kpi-card">
              <div className="kpi-label">Transactions</div>
              <div className="kpi-value">{space.transactionCount}</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            {(['overview', 'transactions'] as const).map(tab => (
              <button
                key={tab}
                className="btn btn-ghost"
                style={{
                  borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRadius: 0,
                  color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                  padding: '8px 16px',
                  textTransform: 'capitalize',
                }}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div>
              <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Spending by Category
              </h3>
              <SpaceDonutChart data={breakdown} />
            </div>
          )}

          {activeTab === 'transactions' && (
            <div>
              {txs.length === 0 ? (
                <p className="space-meta">No transactions in this space yet.</p>
              ) : (
                txs.map(tx => (
                  <div key={tx.id} className="space-card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14 }}>{tx.item}</div>
                      <div className="space-meta">{tx.occurredOn} · {tx.category}</div>
                    </div>
                    <div style={{ fontWeight: 600 }}>S${tx.amount}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Layout>
    )
  }
  ```

- [ ] **Step 2: Update imports at the top of Spaces.tsx**

  Final import block for the file:

  ```typescript
  import { useEffect, useState } from 'react'
  import { useParams, useNavigate } from 'react-router-dom'
  import { Layout } from '../components/Layout'
  import { SpaceDonutChart } from '../components/SpaceDonutChart'
  import {
    listSpaces, deactivateSpace, reactivateSpace, permanentDeleteSpace,
    updateSpace, getSpaceTransactions, getSpaceBreakdown,
  } from '../lib/api'
  import type { SpaceWithTotal, ApiTransaction, SpaceBreakdownItem } from '../lib/api'
  ```

- [ ] **Step 3: Start dev server and verify**

  - Click into a space → see KPI cards + Overview / Transactions tabs
  - Overview tab → donut chart renders with categories
  - Transactions tab → list of transactions
  - ✏️ button → inline edit field pre-filled → Save updates the header name

- [ ] **Step 4: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/dashboard/src/pages/Spaces.tsx
  git commit -m "feat(dashboard): SpaceDetail with inline edit, Overview/Transactions tabs, donut chart"
  ```

---

## Task 9: Bot space keyboards — new buttons

**Files:**
- Modify: `apps/bot/src/keyboards/space.ts`

- [ ] **Step 1: Replace the file contents**

  ```typescript
  import { InlineKeyboard } from 'grammy'
  import type { SpaceWithTotal } from '@spend-again/shared'

  export function buildSpaceListKeyboard(spaces: SpaceWithTotal[], hasActive: boolean): InlineKeyboard {
    const kb = new InlineKeyboard()
    for (const s of spaces) {
      kb.text(`${s.emoji ?? '📦'} ${s.name}`, `space_activate:${s.id}`).row()
    }
    kb.text('➕ New Space', 'space_new')
    if (hasActive) kb.row().text('🏠 Main only', 'space_clear')
    kb.row().text('📂 Archived Spaces', 'space_show_archived')
    return kb
  }

  export function buildSpaceActiveKeyboard(spaceId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('🛑 Stop using space', 'space_clear')
      .row()
      .text('📊 View total', `space_total:${spaceId}`)
      .row()
      .text('💤 Deactivate', `space_deactivate:${spaceId}`)
      .text('🗑 Delete', `space_delete_confirm:${spaceId}`)
  }

  export function buildSpaceCreatedKeyboard(spaceId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('✅ Set active', `space_activate:${spaceId}`)
      .text('Not now', 'space_created_skip')
  }

  export function buildSpaceBudgetChoiceKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('✅ Yes', 'space_budget_choice:yes')
      .text('❌ No', 'space_budget_choice:no')
  }

  export function buildSpaceNameEmojiConfirmKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('✅ Yes, use this', 'space_name_confirm')
      .text('✏️ Edit name', 'space_name_edit')
  }

  export function buildSpaceDeleteConfirmKeyboard(spaceId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('⚠️ Yes, delete', `space_delete_final:${spaceId}`)
      .text('Cancel', 'space_delete_cancel')
  }

  export function buildSpaceArchivedListKeyboard(archivedSpaces: SpaceWithTotal[]): InlineKeyboard {
    const kb = new InlineKeyboard()
    for (const s of archivedSpaces) {
      kb.text(`${s.emoji ?? '📦'} ${s.name}`, `space_archived_view:${s.id}`).row()
    }
    kb.text('← Back to active', 'space_back_to_active')
    return kb
  }

  export function buildSpaceArchivedItemKeyboard(spaceId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('♻️ Reactivate', `space_reactivate:${spaceId}`)
      .text('🗑 Delete', `space_delete_confirm:${spaceId}`)
  }
  ```

- [ ] **Step 2: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/bot/src/keyboards/space.ts
  git commit -m "feat(bot): add deactivate, delete, archived, emoji-confirm space keyboards"
  ```

---

## Task 10: Bot space handler — emoji confirm flow + new callbacks + ctx.match fix

**Files:**
- Modify: `apps/bot/src/handlers/space.ts`

- [ ] **Step 1: Add new state exports at the top**

  After the existing state declarations (pendingSpaceCreate, pendingSpaceDetails, pendingSpaceBudgetInput), add:

  ```typescript
  type PendingSpaceDetails = {
    name: string
    emoji?: string | null
    startDate?: string | null
    endDate?: string | null
  }

  type PendingNameConfirm = PendingSpaceDetails & { budgetCents?: number | null }

  export const pendingSpaceNameConfirm = new Map<number, PendingNameConfirm>()
  export const pendingSpaceNameEdit = new Set<number>()
  ```

  > Also update the existing `PendingSpaceDetails` type definition if it's inline — add `emoji?: string | null` to it.

- [ ] **Step 2: Update `createSpaceAndPrompt` to accept and pass emoji**

  Change the signature and body:

  ```typescript
  async function createSpaceAndPrompt(
    ctx: Context,
    payload: { name: string; emoji?: string | null; budgetCents?: number; startDate?: string; endDate?: string }
  ): Promise<void> {
    const space = await apiClient.createSpace({
      name: payload.name,
      ...(payload.emoji ? { emoji: payload.emoji } : {}),
      ...(payload.budgetCents !== undefined ? { budgetCents: payload.budgetCents } : {}),
      ...(payload.startDate ? { startDate: payload.startDate } : {}),
      ...(payload.endDate ? { endDate: payload.endDate } : {}),
    })
    if (!space) {
      await ctx.reply('Could not create space. Please try again.')
      return
    }
    const label = `${space.emoji ?? '📦'} ${space.name}`
    const dateRange = payload.startDate && payload.endDate
      ? `\nDates: ${payload.startDate} – ${payload.endDate}` : ''
    const budgetLine = payload.budgetCents
      ? `\nBudget: S$${(payload.budgetCents / 100).toFixed(2)}` : ''
    await ctx.reply(
      `Created ${label}${dateRange}${budgetLine}\n\nSet as active space?`,
      { reply_markup: buildSpaceCreatedKeyboard(space.id) },
    )
  }
  ```

- [ ] **Step 3: Fix ctx.match bug in `spaceCommandHandler`**

  Change the `arg` extraction line from:

  ```typescript
  const arg = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  ```

  to:

  ```typescript
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  const arg = raw === '📦 Spaces' ? '' : raw
  ```

- [ ] **Step 4: Update `handlePendingSpaceCreate` to show emoji+name confirmation**

  Replace the final section of `handlePendingSpaceCreate` (from `if (parsed.budgetCents !== undefined` to `return true`) with:

  ```typescript
  // Always show name+emoji confirmation before proceeding
  const emoji = parsed.emoji ?? null
  const suggestionLabel = emoji ? `${emoji} ${parsed.name}` : `📦 ${parsed.name}`
  const datesLine = parsed.startDate && parsed.endDate
    ? `\nDates: ${parsed.startDate} – ${parsed.endDate}` : ''

  pendingSpaceNameConfirm.set(chatId, {
    name: parsed.name,
    emoji,
    startDate: parsed.startDate ?? null,
    endDate: parsed.endDate ?? null,
    budgetCents: parsed.budgetCents ?? null,
  })

  await ctx.reply(
    `Here's what I got:\n*${suggestionLabel}*${datesLine}\n\nUse this name and emoji?`,
    { parse_mode: 'Markdown', reply_markup: buildSpaceNameEmojiConfirmKeyboard() },
  )
  return true
  ```

- [ ] **Step 5: Add new callbacks in `spaceCallbackHandler`**

  Add these blocks inside `spaceCallbackHandler`, after the existing handlers:

  ```typescript
  // Name+emoji confirmation
  if (data === 'space_name_confirm') {
    const details = pendingSpaceNameConfirm.get(chatId)
    pendingSpaceNameConfirm.delete(chatId)
    if (!details) { await ctx.editMessageText('Session expired. Please try creating a space again.'); return }
    if (details.budgetCents !== undefined && details.budgetCents !== null) {
      await ctx.editMessageText('Creating space…')
      await createSpaceAndPrompt(ctx, {
        name: details.name,
        emoji: details.emoji,
        budgetCents: details.budgetCents,
        ...(details.startDate ? { startDate: details.startDate } : {}),
        ...(details.endDate ? { endDate: details.endDate } : {}),
      })
      return
    }
    pendingSpaceDetails.set(chatId, {
      name: details.name,
      emoji: details.emoji,
      startDate: details.startDate,
      endDate: details.endDate,
    })
    const label = details.emoji ? `${details.emoji} ${details.name}` : details.name
    await ctx.editMessageText(
      `Got it! Do you want to set a budget for *${label}*?`,
      { parse_mode: 'Markdown', reply_markup: buildSpaceBudgetChoiceKeyboard() },
    )
    return
  }

  if (data === 'space_name_edit') {
    const details = pendingSpaceNameConfirm.get(chatId)
    if (!details) { await ctx.editMessageText('Session expired. Please try creating a space again.'); return }
    pendingSpaceNameEdit.add(chatId)
    const fallback = `📦 ${details.name}`
    await ctx.editMessageText(
      `No problem! I suggest: *${fallback}*\n\nSend a new name (you can start with an emoji, e.g. "🎓 NUS Sem 2").`,
      { parse_mode: 'Markdown' },
    )
    return
  }

  // Deactivate
  if (data.startsWith('space_deactivate:')) {
    const spaceId = data.slice('space_deactivate:'.length)
    const ok = await apiClient.updateSpace(spaceId, { status: 'archived' })
    await ctx.editMessageText(
      ok ? 'Space deactivated. Use /space → 📂 Archived Spaces to reactivate.' : 'Could not deactivate. Try again.',
    )
    return
  }

  // Delete — first confirmation step
  if (data.startsWith('space_delete_confirm:')) {
    const spaceId = data.slice('space_delete_confirm:'.length)
    await ctx.editMessageText(
      'Permanently delete this space? Transactions are kept.',
      { reply_markup: buildSpaceDeleteConfirmKeyboard(spaceId) },
    )
    return
  }

  // Delete — final confirm
  if (data.startsWith('space_delete_final:')) {
    const spaceId = data.slice('space_delete_final:'.length)
    const ok = await apiClient.hardDeleteSpace(spaceId)
    await ctx.editMessageText(ok ? '✅ Space permanently deleted.' : 'Could not delete. Try again.')
    return
  }

  if (data === 'space_delete_cancel') {
    await ctx.editMessageText('Cancelled.')
    return
  }

  // Archived spaces list
  if (data === 'space_show_archived') {
    const allSpaces = await apiClient.listSpaces()
    const archived = allSpaces.filter(s => s.status === 'archived')
    if (archived.length === 0) {
      await ctx.editMessageText('No archived spaces.')
      return
    }
    await ctx.editMessageText('Archived spaces:', { reply_markup: buildSpaceArchivedListKeyboard(archived) })
    return
  }

  if (data.startsWith('space_archived_view:')) {
    const spaceId = data.slice('space_archived_view:'.length)
    const allSpaces = await apiClient.listSpaces()
    const space = allSpaces.find(s => s.id === spaceId)
    if (!space) { await ctx.editMessageText('Space not found.'); return }
    const label = `${space.emoji ?? '📦'} ${space.name}`
    await ctx.editMessageText(
      `${label}\nStatus: archived\nSpent: S$${space.spent} (${space.transactionCount} transactions)`,
      { reply_markup: buildSpaceArchivedItemKeyboard(spaceId) },
    )
    return
  }

  if (data.startsWith('space_reactivate:')) {
    const spaceId = data.slice('space_reactivate:'.length)
    const space = await apiClient.updateSpace(spaceId, { status: 'active' })
    const label = space ? `${space.emoji ?? '📦'} ${space.name}` : 'Space'
    await ctx.editMessageText(`♻️ ${label} reactivated! Use /space to activate it.`)
    return
  }

  if (data === 'space_back_to_active') {
    const [allSpaces, activeSpace] = await Promise.all([apiClient.listSpaces(), apiClient.getActiveSpace()])
    const activeLabel = activeSpace ? `${activeSpace.emoji ?? '📦'} ${activeSpace.name}` : 'None'
    const activeSpaces = allSpaces.filter(s => s.status === 'active')
    await ctx.editMessageText(
      `Active space: ${activeLabel}\n\nChoose a space:`,
      { reply_markup: buildSpaceListKeyboard(activeSpaces, activeSpace !== null) },
    )
    return
  }
  ```

- [ ] **Step 6: Add `handlePendingSpaceNameEdit` export**

  Add at the end of the file (before `void log`):

  ```typescript
  export async function handlePendingSpaceNameEdit(ctx: Context): Promise<boolean> {
    const text = ctx.message?.text
    const telegramId = ctx.from?.id
    const chatId = ctx.chat?.id
    if (!text || !telegramId || !chatId) return false
    if (!pendingSpaceNameEdit.has(chatId)) return false

    pendingSpaceNameEdit.delete(chatId)
    const details = pendingSpaceNameConfirm.get(chatId)
    pendingSpaceNameConfirm.delete(chatId)

    if (!details) {
      await ctx.reply('Session expired. Please type /space to start over.')
      return true
    }

    // Parse optional leading emoji
    const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)/u)
    const emoji = emojiMatch?.[0] ?? null
    const name = emoji ? text.slice(emoji.length).trim() : text.trim()

    if (!name) {
      await ctx.reply('Name cannot be empty. Please try creating a space again with /space.')
      return true
    }

    const token = await ensureToken(telegramId)
    if (!token) return true
    apiClient.setToken(token)

    pendingSpaceDetails.set(chatId, {
      name,
      emoji,
      startDate: details.startDate ?? null,
      endDate: details.endDate ?? null,
    })

    const label = emoji ? `${emoji} ${name}` : name
    await ctx.reply(
      `Got it! Do you want to set a budget for *${label}*?`,
      { parse_mode: 'Markdown', reply_markup: buildSpaceBudgetChoiceKeyboard() },
    )
    return true
  }
  ```

- [ ] **Step 7: Update `handlePendingSpaceBudgetInput` to pass emoji through**

  In the `createSpaceAndPrompt` call inside `handlePendingSpaceBudgetInput`, pass `emoji`:

  ```typescript
  await createSpaceAndPrompt(ctx, {
    name: details.name,
    emoji: details.emoji ?? null,
    budgetCents,
    ...(details.startDate ? { startDate: details.startDate } : {}),
    ...(details.endDate ? { endDate: details.endDate } : {}),
  })
  ```

  Do the same for the `space_budget_choice:no` handler and `space_budget_choice:yes` handler.

- [ ] **Step 8: Update keyboards import**

  At the top of `space.ts`, update the keyboard imports:

  ```typescript
  import {
    buildSpaceListKeyboard,
    buildSpaceActiveKeyboard,
    buildSpaceCreatedKeyboard,
    buildSpaceBudgetChoiceKeyboard,
    buildSpaceNameEmojiConfirmKeyboard,
    buildSpaceDeleteConfirmKeyboard,
    buildSpaceArchivedListKeyboard,
    buildSpaceArchivedItemKeyboard,
  } from '../keyboards/space.js'
  ```

- [ ] **Step 9: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/bot/src/handlers/space.ts
  git commit -m "feat(bot): space emoji confirm flow, deactivate/delete/archived callbacks, fix ctx.match bug"
  ```

---

## Task 11: Wire space handler changes in bot.ts

**Files:**
- Modify: `apps/bot/src/bot.ts`

- [ ] **Step 1: Add new imports from space handler**

  Update the space handler import:

  ```typescript
  import {
    spaceCommandHandler,
    spaceCallbackHandler,
    handlePendingSpaceCreate,
    pendingSpaceCreate,
    pendingSpaceBudgetInput,
    handlePendingSpaceBudgetInput,
    pendingSpaceNameEdit,
    handlePendingSpaceNameEdit,
  } from './handlers/space.js'
  ```

- [ ] **Step 2: Add pendingSpaceNameEdit check in the message handler**

  In the message handler (the `bot.on('message:text', ...)` block), add the name-edit check *before* the existing `pendingSpaceCreate` check:

  ```typescript
  // Pending /space name edit flow
  if (chatId !== undefined && pendingSpaceNameEdit.has(chatId)) {
    const consumed = await handlePendingSpaceNameEdit(ctx)
    if (consumed) return
  }
  ```

- [ ] **Step 3: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/bot/src/bot.ts
  git commit -m "feat(bot): wire space name-edit pending flow in bot.ts"
  ```

---

## Task 12: Bot IOU keyboard + iouCommandHandler

**Files:**
- Modify: `apps/bot/src/keyboards/iou.ts`
- Modify: `apps/bot/src/handlers/iou.ts`

- [ ] **Step 1: Add `buildIouListKeyboard` to `apps/bot/src/keyboards/iou.ts`**

  Add at the bottom:

  ```typescript
  export function buildIouListKeyboard(debts: DebtWithPerson[]): InlineKeyboard {
    const kb = new InlineKeyboard()
    for (const d of debts) {
      const label = d.direction === 'they_owe_me'
        ? `👤 ${d.person.name} owes you S$${d.remainingAmount}`
        : `👤 You owe ${d.person.name} S$${d.remainingAmount}`
      kb.text(label, `iou_settle_single:${d.id}`).row()
    }
    kb.text('➕ Record new IOU', 'iou_new')
    return kb
  }
  ```

- [ ] **Step 2: Add `pendingIouNew` state and `iouCommandHandler` to `apps/bot/src/handlers/iou.ts`**

  Add after the existing state declarations:

  ```typescript
  export const pendingIouNew = new Set<number>()
  ```

  Add the new command handler after `ensureAuth`:

  ```typescript
  export async function iouCommandHandler(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id
    const chatId = ctx.chat?.id
    if (!telegramId || !chatId) return
    if (!await ensureAuth(telegramId)) {
      await ctx.reply('Please /start to register first.')
      return
    }

    const debts = await apiClient.listAllDebts()
    const openDebts = debts.filter(d => d.status === 'open' || d.status === 'partially_paid')

    if (openDebts.length === 0) {
      await ctx.reply(
        'No open IOUs! Record one naturally:\n• "I lent Alex $20 for lunch"\n• "I owe Jun $50"',
        { reply_markup: new InlineKeyboard().text('➕ Record new IOU', 'iou_new') },
      )
      return
    }

    const lines = openDebts.map(d =>
      d.direction === 'they_owe_me'
        ? `👤 ${d.person.name} owes you S$${d.remainingAmount}`
        : `👤 You owe ${d.person.name} S$${d.remainingAmount}`
    ).join('\n')

    await ctx.reply(
      `💸 Open IOUs:\n\n${lines}\n\nTap a row to settle, or record a new one.`,
      { reply_markup: buildIouListKeyboard(openDebts) },
    )
  }
  ```

- [ ] **Step 3: Add `iou_new` and `iou_settle_single:` callbacks in `iouCallbackHandler`**

  Add after the existing `iou_cancel` handler:

  ```typescript
  if (data === 'iou_new') {
    const chatId = ctx.chat?.id
    if (chatId === undefined) return
    pendingIouNew.add(chatId)
    await ctx.editMessageText(
      'Tell me the IOU:\n• "I lent Alex $20 for lunch"\n• "I owe Jun $50"\n• "Sam owes me $15"',
    )
    return
  }

  if (data.startsWith('iou_settle_single:')) {
    const chatId = ctx.chat?.id
    if (chatId === undefined) return
    const debtId = data.slice('iou_settle_single:'.length)
    const debts = await apiClient.listAllDebts()
    const debt = debts.find(d => d.id === debtId)
    if (!debt) { await ctx.editMessageText('Debt not found.'); return }
    pendingIouSettle.set(chatId, { personName: debt.person.name, debts: [debt] })
    const desc = debt.description ? ` for ${debt.description}` : ''
    const label = debt.direction === 'they_owe_me'
      ? `${debt.person.name} owes you S$${debt.remainingAmount}${desc}`
      : `You owe ${debt.person.name} S$${debt.remainingAmount}${desc}`
    await ctx.editMessageText(
      `${label}\nMark as paid?`,
      { reply_markup: buildIouSettleKeyboard([debt]) },
    )
    return
  }
  ```

- [ ] **Step 4: Update imports in iou.ts**

  ```typescript
  import { buildIouAmbiguousKeyboard, buildIouSettleKeyboard, buildIouListKeyboard } from '../keyboards/iou.js'
  import { InlineKeyboard } from 'grammy'
  ```

  Export `iouCommandHandler` in the import line used by bot.ts.

- [ ] **Step 5: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/bot/src/keyboards/iou.ts apps/bot/src/handlers/iou.ts
  git commit -m "feat(bot): add iouCommandHandler, iou_new + iou_settle_single callbacks, IOU list keyboard"
  ```

---

## Task 13: Wire /iou command + 💸 IOUs keyboard button

**Files:**
- Modify: `apps/bot/src/keyboards/main.ts`
- Modify: `apps/bot/src/bot.ts`

- [ ] **Step 1: Add `💸 IOUs` to the main keyboard**

  Replace `apps/bot/src/keyboards/main.ts` with:

  ```typescript
  import { Keyboard } from 'grammy'

  export const mainKeyboard = new Keyboard()
    .text('🌐 Bring me to Site')
    .text('📊 Monthly Report')
    .row()
    .text('📝 Recents')
    .text('📦 Spaces')
    .row()
    .text('💸 IOUs')
    .text('❓ Help')
    .resized()
    .persistent()
  ```

- [ ] **Step 2: Register `/iou` command and `💸 IOUs` hears in bot.ts**

  Update the IOU import:

  ```typescript
  import {
    iouHandler, iouCallbackHandler, handlePendingPartialRepay,
    pendingPartialRepay, detectIouIntent, iouCommandHandler, pendingIouNew,
  } from './handlers/iou.js'
  ```

  Add command + hears after the existing space command:

  ```typescript
  bot.command('iou', iouCommandHandler)
  bot.hears('💸 IOUs', iouCommandHandler)
  ```

  In the callback handler block, add iou_settle_single callback routing — the existing `bot.callbackQuery(/^iou_/, iouCallbackHandler)` already catches `iou_new` and `iou_settle_single:` since they start with `iou_`. No change needed there.

- [ ] **Step 3: Handle `pendingIouNew` in the message handler**

  In the `bot.on('message:text', ...)` block, add *before* the IOU intent check:

  ```typescript
  // Pending /iou new entry flow
  if (chatId !== undefined && pendingIouNew.has(chatId)) {
    pendingIouNew.delete(chatId)
    // Fall through to iouHandler — it will call detectIouIntent on the text
    await iouHandler(ctx)
    return
  }
  ```

- [ ] **Step 4: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add apps/bot/src/keyboards/main.ts apps/bot/src/bot.ts
  git commit -m "feat(bot): add /iou command, 💸 IOUs keyboard button, pendingIouNew flow"
  ```

---

## Task 14: Update MSG_HELP

**Files:**
- Modify: `packages/shared/src/bot-messages.ts`

- [ ] **Step 1: Replace `MSG_HELP`**

  Replace the existing `MSG_HELP` constant with:

  ```typescript
  export const MSG_HELP =
    `How to use Spend Again? \u{1F914}\n\n` +

    `*Log an expense* — Just type it:\n` +
    `  "8.50 chicken rice Maxwell"\n` +
    `  "$12 grab home"\n` +
    `  "25 NTUC groceries"\n\n` +

    `*Snap a receipt* — Send a photo \u{1F4F8}\n\n` +

    `*Ask about your spending:*\n` +
    `  "How much did I spend this month?"\n` +
    `  "Show breakdown by category last week"\n\n` +

    `*Spaces* — Organise expenses into trips or budgets:\n` +
    `  /space — View + switch spaces\n` +
    `  "Bali Trip from 03/06 to 08/06 budget $500" — Create a space\n` +
    `  \u{1F4E6} Spaces button — Quick access\n` +
    `  Tap a space to set it active; new expenses are tagged automatically\n` +
    `  In a space menu: Deactivate to archive, Delete to remove permanently\n\n` +

    `*IOUs* — Track who owes who:\n` +
    `  /iou — View all open IOUs\n` +
    `  \u{1F4B8} IOUs button — Quick access\n` +
    `  "I lent Alex $20 for lunch" — Record IOU\n` +
    `  "I owe Jun $50" — Record what you owe\n` +
    `  "Alex paid me back" — Mark as settled\n\n` +

    `*Commands:*\n` +
    `/start — Welcome message\n` +
    `/help — Show this help\n` +
    `/recent — Last 5 transactions\n` +
    `/space — Manage spaces\n` +
    `/iou — View & record IOUs\n\n` +

    `*Keyboard buttons:*\n` +
    `\u{1F310} Bring me to Site — Open your dashboard\n` +
    `\u{1F4CA} Monthly Report — Current month summary\n` +
    `\u{1F4DD} Recents — Last 5 transactions\n` +
    `\u{1F4E6} Spaces — Manage your spaces\n` +
    `\u{1F4B8} IOUs — View open debts\n` +
    `\u{2753} Help — Show this message\n\n` +

    `Can lah, you got this! \u{1F44A}`
  ```

- [ ] **Step 2: Lint + commit**

  ```bash
  pnpm turbo run lint
  git add packages/shared/src/bot-messages.ts
  git commit -m "docs(bot): update MSG_HELP to include Spaces, IOUs, and all keyboard buttons"
  ```

---

## Final Verification

- [ ] **Run full test suite**

  ```bash
  pnpm turbo run test
  ```

  Expected: all tests pass

- [ ] **Run full lint**

  ```bash
  pnpm turbo run lint
  ```

  Expected: no errors

- [ ] **Smoke test on dev server**

  ```bash
  pnpm turbo run dev
  ```

  Checklist:
  - [ ] `/spaces` — Active/Archived tabs work, Deactivate/Reactivate/Delete work
  - [ ] Space detail — ✏️ edit saves, Overview tab shows donut, Transactions tab shows list
  - [ ] Bot: `/space` → shows list + 📂 Archived Spaces button (no "No active space found" error on button tap)
  - [ ] Bot: Create space → Gemini suggests emoji+name → confirm prompt → budget prompt
  - [ ] Bot: Space active menu → Deactivate / Delete (with confirmation)
  - [ ] Bot: `/iou` → per-person list with Settle buttons + ➕ Record new IOU
  - [ ] Bot: `💸 IOUs` keyboard button → same as `/iou`
  - [ ] Bot: `/help` → includes Spaces and IOUs sections
