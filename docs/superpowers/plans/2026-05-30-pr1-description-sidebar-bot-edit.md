# PR 1: Description Field, Sidebar Redesign, Bot Edit Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a description field to transactions end-to-end, redesign the sidebar to 180px with text labels, polish mobile KPI cards, and implement a structured bot edit flow.

**Architecture:** Description flows from the original bot message (price stripped) through ParseResult → API → DB → dashboard tooltip + modal. Sidebar is purely CSS + component changes. Bot edit uses a shared `parseStructuredEdit` helper consumed by two flows: the existing ✏️ Edit confirmation button (inline edit) and a new `/edit` command (saved transaction edit).

**Tech Stack:** Drizzle ORM (schema + migration), Hono + Zod (API), grammY (bot), React + CSS (dashboard), Vitest (tests)

---

## File Map

| File | Action |
|---|---|
| `packages/db/src/schema.ts` | Add `description` column to transactions |
| `packages/parser/src/regex.ts` | Add `description?: string` to ParseResult |
| `apps/bot/src/handlers/expense.ts` | Add `deriveDescription` + set on ParseResult |
| `apps/bot/src/lib/api-client.ts` | Add `UpdateTransactionInput`, `updateTransaction`, `description` to CreateTransactionInput |
| `apps/api/src/routes/transactions.ts` | Add `description` to Zod schemas |
| `apps/api/src/services/transactions.ts` | Add `description` to types + insert/update |
| `packages/shared/src/types.ts` | Add `description` to ApiTransaction |
| `apps/dashboard/src/lib/api.ts` | Add `description` to payload types |
| `apps/dashboard/src/components/TransactionTable.tsx` | Tooltip on hover |
| `apps/dashboard/src/components/TransactionModal.tsx` | Description textarea field |
| `apps/dashboard/src/index.css` | Sidebar 180px + mobile KPI rules |
| `apps/dashboard/src/components/Sidebar.tsx` | Logo text + nav labels + Recurring nav item |
| `apps/dashboard/src/pages/Recurring.tsx` | NEW — placeholder page |
| `apps/dashboard/src/App.tsx` | Add /recurring protected route |
| `apps/bot/src/lib/parse-structured-edit.ts` | NEW — shared structured-format parser |
| `apps/bot/src/handlers/inline-edit.ts` | NEW — pendingInlineEdits + handler |
| `apps/bot/src/handlers/confirm.ts` | Update `handleConfirmEdit` to use pendingInlineEdits |
| `apps/bot/src/handlers/edit.ts` | NEW — /edit command + edit_select callback |
| `apps/bot/src/bot.ts` | Register /edit, edit_select, inline-edit routing |

---

## Task 1: DB — add description column to transactions

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Verify current schema in Supabase before touching anything**

  Via Supabase MCP execute_sql:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'transactions' ORDER BY ordinal_position;
  ```
  Expected columns: id, user_id, amount_cents, item, category, sub_category, occurred_on, source, tier, confidence, created_at, updated_at. Confirm `description` is NOT already present.

- [ ] **Step 2: Add description to schema**

  In `packages/db/src/schema.ts`, add `description` after `subCategory`:
  ```typescript
  export const transactions = pgTable('transactions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    item: text('item').notNull(),
    category: text('category').notNull(),
    subCategory: text('sub_category').notNull(),
    description: text('description'),                  // ← ADD THIS
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    source: text('source').notNull(),
    tier: integer('tier'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }, (table) => ({
    userOccurredIdx: index('transactions_user_occurred_idx')
      .on(table.userId, table.occurredOn),
  }))
  ```

- [ ] **Step 3: Generate the migration SQL**

  ```bash
  pnpm --filter @spend-again/db generate
  ```
  Expected: a new file appears in `packages/db/drizzle/` containing:
  ```sql
  ALTER TABLE "transactions" ADD COLUMN "description" text;
  ```

- [ ] **Step 4: Apply migration via Supabase MCP**

  Use `apply_migration` with name `add_description_to_transactions` and the generated SQL:
  ```sql
  ALTER TABLE "transactions" ADD COLUMN "description" text;
  ```

- [ ] **Step 5: Verify**

  Via Supabase MCP execute_sql:
  ```sql
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'transactions' AND column_name = 'description';
  ```
  Expected: one row, `data_type = 'text'`.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/db/src/schema.ts packages/db/drizzle/
  git commit -m "feat: add description column to transactions table"
  ```

---

## Task 2: ParseResult — add description field

**Files:**
- Modify: `packages/parser/src/regex.ts`
- Test: `packages/parser/__tests__/regex.test.ts`

- [ ] **Step 1: Add description to ParseResult type**

  In `packages/parser/src/regex.ts`, update the `ParseResult` type:
  ```typescript
  export type ParseResult = {
    amount: number // integer cents
    item: string
    description?: string   // ← ADD: original input minus price, set by caller
    category?: Category
    subCategory?: SubCategory
    date?: string // DD/MM/YYYY
    confidence: number // 0–1
    tier: 1 | 2 | 3
  }
  ```
  No other changes needed in this file — description is derived externally (in the bot expense handler) and stamped onto the result.

- [ ] **Step 2: Run existing parser tests to confirm nothing broke**

  ```bash
  pnpm --filter @spend-again/parser test
  ```
  Expected: all existing tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/parser/src/regex.ts
  git commit -m "feat: add optional description field to ParseResult"
  ```

---

## Task 3: Bot expense handler — derive and attach description

**Files:**
- Modify: `apps/bot/src/handlers/expense.ts`
- Test: `apps/bot/__tests__/expense.test.ts`

- [ ] **Step 1: Write a failing test for deriveDescription**

  In `apps/bot/__tests__/expense.test.ts`, add:
  ```typescript
  import { deriveDescription } from '../src/handlers/expense.js'

  describe('deriveDescription', () => {
    it('strips dollar-prefix amount from start', () => {
      expect(deriveDescription('$3.50 coffee from june coffee')).toBe('coffee from june coffee')
    })
    it('strips S$ prefix', () => {
      expect(deriveDescription('S$8.50 lunch at Amoy')).toBe('lunch at Amoy')
    })
    it('strips bare number from start', () => {
      expect(deriveDescription('8.50 for lunch')).toBe('for lunch')
    })
    it('strips trailing currency amount', () => {
      expect(deriveDescription('coffee S$3.50')).toBe('coffee')
    })
    it('returns undefined for amount-only input', () => {
      expect(deriveDescription('$5')).toBeUndefined()
    })
  })
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  pnpm --filter @spend-again/bot test -- --reporter=verbose 2>&1 | grep -A3 deriveDescription
  ```
  Expected: FAIL — `deriveDescription` not found.

- [ ] **Step 3: Implement deriveDescription and wire into expenseHandler**

  In `apps/bot/src/handlers/expense.ts`:

  Add the helper after the imports:
  ```typescript
  const PRICE_PREFIX_RE = /^(?:S\$|SGD\s*|\$)?\s*\d+(?:\.\d{1,2})?\s*/i
  const PRICE_SUFFIX_RE = /\s*(?:S\$|SGD\s*|\$)\s*\d+(?:\.\d{1,2})?$/i

  export function deriveDescription(raw: string): string | undefined {
    let s = raw.trim()
    s = s.replace(PRICE_PREFIX_RE, '')
    s = s.replace(PRICE_SUFFIX_RE, '')
    s = s.trim()
    return s.length > 0 ? s : undefined
  }
  ```

  In `expenseHandler`, after `result` is set and before `pendingConfirmations.set(chatId, result)`, attach the description:
  ```typescript
  result.description = deriveDescription(text)
  pendingConfirmations.set(chatId, result)
  ```

- [ ] **Step 4: Run tests to confirm pass**

  ```bash
  pnpm --filter @spend-again/bot test
  ```
  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/bot/src/handlers/expense.ts apps/bot/__tests__/expense.test.ts
  git commit -m "feat: derive description from original expense message in bot"
  ```

---

## Task 4: Bot API client — add description + updateTransaction

**Files:**
- Modify: `apps/bot/src/lib/api-client.ts`

- [ ] **Step 1: Add description to CreateTransactionInput and UpdateTransactionInput**

  In `apps/bot/src/lib/api-client.ts`, update:
  ```typescript
  export type CreateTransactionInput = {
    userId: string
    amountCents: number
    item: string
    description?: string   // ← ADD
    category: Category
    subCategory: SubCategory
    date: string // DD/MM/YYYY
    source: 'bot'
    tier?: 1 | 2 | 3
    confidence?: number
  }

  export type UpdateTransactionInput = {
    amountCents?: number
    item?: string
    category?: string
    subCategory?: string
    date?: string // DD/MM/YYYY
    source?: 'bot' | 'manual'
  }
  ```

- [ ] **Step 2: Pass description in createTransaction**

  In the `createTransaction` method body, add `description: data.description` to the JSON body:
  ```typescript
  body: JSON.stringify({
    userId: data.userId,
    amountCents: data.amountCents,
    item: data.item,
    description: data.description,   // ← ADD
    category: data.category,
    subCategory: data.subCategory,
    date: data.date,
    source: data.source,
    tier: data.tier,
    confidence: data.confidence,
  }),
  ```

- [ ] **Step 3: Add updateTransaction method to ApiClient**

  Add after `createTransaction`:
  ```typescript
  async updateTransaction(txId: string, input: UpdateTransactionInput): Promise<{ id: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/transactions/${txId}`, {
        method: 'PUT',
        headers: this.buildHeaders(),
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        log.error({ status: res.status, body: (await res.text()).slice(0, 500) }, 'updateTransaction failed')
        return null
      }
      const body = (await res.json()) as ApiTransaction
      return { id: body.id }
    } catch (err) {
      log.error({ err }, 'updateTransaction error')
      return null
    }
  }
  ```

- [ ] **Step 4: Run bot tests**

  ```bash
  pnpm --filter @spend-again/bot test
  ```
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/bot/src/lib/api-client.ts
  git commit -m "feat: add description + updateTransaction to bot API client"
  ```

---

## Task 5: API — description in route schemas and service

**Files:**
- Modify: `apps/api/src/routes/transactions.ts`
- Modify: `apps/api/src/services/transactions.ts`
- Test: `apps/api/__tests__/transactions.test.ts`

- [ ] **Step 1: Add description to Zod schemas**

  In `apps/api/src/routes/transactions.ts`, update both schemas:
  ```typescript
  export const createTransactionSchema = z.object({
    amountCents: z.number().int().min(1),
    item: z.string().min(1),
    description: z.string().optional(),   // ← ADD
    category: z.enum(CATEGORIES as readonly [string, ...string[]]),
    subCategory: z.string().min(1),
    date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in DD/MM/YYYY format'),
    source: z.enum(['manual', 'bot', 'sms', 'ocr', 'recurring']),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })

  export const updateTransactionSchema = z.object({
    amountCents: z.number().int().min(1).optional(),
    item: z.string().min(1).optional(),
    description: z.string().optional(),   // ← ADD
    category: z.enum(CATEGORIES as readonly [string, ...string[]]).optional(),
    subCategory: z.string().min(1).optional(),
    date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in DD/MM/YYYY format').optional(),
    source: z.enum(['manual', 'bot', 'sms', 'ocr', 'recurring']).optional(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  ```

- [ ] **Step 2: Add description to service input types**

  In `apps/api/src/services/transactions.ts`, update:
  ```typescript
  export type CreateTransactionInput = {
    userId: string
    amountCents: number
    item: string
    description?: string   // ← ADD
    category: string
    subCategory: string
    date: string // DD/MM/YYYY
    source: 'manual' | 'bot' | 'sms' | 'ocr' | 'recurring'
    tier?: 1 | 2 | 3
    confidence?: number
  }

  export type UpdateTransactionInput = {
    amountCents?: number
    item?: string
    description?: string   // ← ADD
    category?: string
    subCategory?: string
    date?: string
    source?: 'manual' | 'bot' | 'sms' | 'ocr' | 'recurring'
    tier?: 1 | 2 | 3
    confidence?: number
  }
  ```

- [ ] **Step 3: Pass description through in service create and update**

  In the `create` method, add `description: input.description ?? null` to the `.values({...})` call:
  ```typescript
  .values({
    userId: input.userId,
    amountCents: input.amountCents,
    item: input.item,
    description: input.description ?? null,   // ← ADD
    category: input.category,
    subCategory: input.subCategory,
    occurredOn: ddmmyyyyToIso(input.date),
    source: input.source,
    tier: input.tier ?? null,
    confidence: input.confidence !== undefined ? String(input.confidence) : null,
  })
  ```

  In the `update` method, add inside the `patch` block:
  ```typescript
  if (input.description !== undefined) patch['description'] = input.description
  ```

- [ ] **Step 4: Run API tests**

  ```bash
  pnpm --filter @spend-again/api test
  ```
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/routes/transactions.ts apps/api/src/services/transactions.ts
  git commit -m "feat: add description field to transaction API schemas and service"
  ```

---

## Task 6: Shared types + dashboard API client

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add description to ApiTransaction**

  In `packages/shared/src/types.ts`:
  ```typescript
  export type ApiTransaction = {
    id: string
    userId: string
    amountCents: number
    amount: string
    item: string
    description?: string | null   // ← ADD
    category: Category | string
    subCategory: SubCategory | string
    occurredOn: string
    source: 'manual' | 'bot' | 'sms' | 'ocr' | 'recurring'
    tier?: 1 | 2 | 3
    confidence?: string
    createdAt: string
    updatedAt: string
  }
  ```

- [ ] **Step 2: Add description to dashboard payload types**

  In `apps/dashboard/src/lib/api.ts`:
  ```typescript
  export type CreateTransactionPayload = {
    userId: string
    amountCents: number
    item: string
    description?: string   // ← ADD
    category: string
    subCategory: string
    date: string  // DD/MM/YYYY
    source: 'manual'
  }

  export type UpdateTransactionPayload = {
    amountCents?: number
    item?: string
    description?: string   // ← ADD
    category?: string
    subCategory?: string
    date?: string  // DD/MM/YYYY
    source?: 'manual'
  }
  ```

- [ ] **Step 3: Run lint to catch any type errors**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/shared/src/types.ts apps/dashboard/src/lib/api.ts
  git commit -m "feat: add description to ApiTransaction and dashboard payload types"
  ```

---

## Task 7: Dashboard components — description tooltip + modal field

**Files:**
- Modify: `apps/dashboard/src/components/TransactionTable.tsx`
- Modify: `apps/dashboard/src/components/TransactionModal.tsx`

- [ ] **Step 1: Add description tooltip to TransactionTable**

  In `TransactionTable.tsx`, find the `.tx-item-name` span and add a `title` prop:
  ```tsx
  <span
    className="tx-item-name"
    title={tx.description ?? undefined}
  >
    {tx.item}
  </span>
  ```

- [ ] **Step 2: Add description to TransactionFormData**

  In `TransactionModal.tsx`, update the type:
  ```typescript
  export type TransactionFormData = {
    item: string
    amountCents: number
    description?: string   // ← ADD
    category: string
    subCategory: string
    date: string  // DD/MM/YYYY
    source: 'manual'
  }
  ```

- [ ] **Step 3: Add description state and textarea to the modal**

  Add state after the existing `date` state:
  ```typescript
  const [description, setDescription] = useState(transaction?.description ?? '')
  ```

  In `handleSubmit`, include description in the `onSave` call:
  ```typescript
  await onSave({
    item: item.trim(),
    amountCents: Math.round(amountNum * 100),
    description: description.trim() || undefined,
    category,
    subCategory,
    date: htmlDateToDDMMYYYY(date),
    source: 'manual',
  })
  ```

  Add the textarea field in the modal body, after the item input group:
  ```tsx
  <div className="form-group">
    <label className="form-label" htmlFor="tx-description">Description <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span></label>
    <textarea
      id="tx-description"
      className="form-input"
      placeholder="e.g. coffee from june coffee"
      value={description}
      onChange={(e) => setDescription(e.target.value)}
      rows={2}
      style={{ resize: 'vertical', minHeight: '52px' }}
    />
  </div>
  ```

- [ ] **Step 4: Confirm Dashboard.tsx needs no changes**

  In `apps/dashboard/src/pages/Dashboard.tsx`, `handleSave` at line 219 does:
  ```typescript
  await createTransaction({ ...data, userId })   // create
  await updateTransaction(editingTransaction.id, data)  // edit
  ```
  Both spread `TransactionFormData` directly into the API call. Since `description` is now part of `TransactionFormData` and both `CreateTransactionPayload` and `UpdateTransactionPayload` accept it as optional, no changes to Dashboard.tsx are required — the field flows through automatically.

- [ ] **Step 5: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/dashboard/src/components/TransactionTable.tsx apps/dashboard/src/components/TransactionModal.tsx
  git commit -m "feat: add description tooltip and textarea to dashboard transaction UI"
  ```

---

## Task 8: CSS — sidebar 180px + mobile KPI polish

**Files:**
- Modify: `apps/dashboard/src/index.css`

- [ ] **Step 1: Update sidebar width token and core sidebar styles**

  In `index.css`, change:
  ```css
  :root {
    /* ... existing tokens ... */
    --sidebar-width: 180px;   /* was 60px */
  }
  ```

  Replace the `.sidebar` rule:
  ```css
  .sidebar {
    width: var(--sidebar-width);
    background: var(--color-sidebar);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    padding: 16px 12px;
    transition: transform var(--transition-base);
  }
  ```

  Replace `.sidebar-logo-img` and add `.sidebar-logo-row` + `.sidebar-logo-name`:
  ```css
  .sidebar-logo-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 4px;
    margin-bottom: 14px;
    flex-shrink: 0;
  }

  .sidebar-logo-img {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    object-fit: cover;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.20);
    flex-shrink: 0;
  }

  .sidebar-logo-name {
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.95);
    white-space: nowrap;
  }
  ```

  Update `.sidebar-nav`:
  ```css
  .sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    width: 100%;
  }
  ```

  Update `.nav-item`:
  ```css
  .nav-item {
    width: 100%;
    height: 38px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 0 10px;
    color: var(--color-sidebar-icon-muted);
    transition: background var(--transition-fast), color var(--transition-fast);
    cursor: pointer;
    text-decoration: none;
  }
  ```

  Add `.nav-label`:
  ```css
  .nav-label {
    font-size: 13px;
    font-weight: 500;
    color: inherit;
    white-space: nowrap;
  }
  ```

- [ ] **Step 2: Fix mobile KPI at ≤480px — override the existing rule**

  Find the existing `@media (max-width: 480px)` block and replace:
  ```css
  @media (max-width: 480px) {
    .kpi-grid {
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .kpi-card {
      padding: 10px;
      gap: 6px;
    }

    .kpi-icon {
      width: 28px;
      height: 28px;
      font-size: 13px;
    }

    .kpi-value {
      font-size: 15px;
    }

    .kpi-label {
      font-size: 9px;
    }

    .app-main {
      padding: 12px;
    }
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/dashboard/src/index.css
  git commit -m "feat: widen sidebar to 180px with labels; compact KPI cards on mobile"
  ```

---

## Task 9: Sidebar component — logo text, nav labels, Recurring nav item

**Files:**
- Modify: `apps/dashboard/src/components/Sidebar.tsx`

- [ ] **Step 1: Update NAV_ITEMS and add nav-label spans**

  Replace the full file content:
  ```tsx
  import { useLocation, Link } from 'react-router-dom'
  import { getTelegramDisplayName } from '../lib/auth'

  type NavItem = {
    path: string
    label: string
    icon: React.ReactNode
  }

  function IconDashboard() {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <rect x="2" y="2" width="7" height="7" rx="1.5"/>
        <rect x="11" y="2" width="7" height="7" rx="1.5"/>
        <rect x="2" y="11" width="7" height="7" rx="1.5"/>
        <rect x="11" y="11" width="7" height="7" rx="1.5"/>
      </svg>
    )
  }

  function IconAnalytics() {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <rect x="2" y="12" width="3" height="6" rx="1"/>
        <rect x="7" y="8" width="3" height="10" rx="1"/>
        <rect x="12" y="5" width="3" height="13" rx="1"/>
      </svg>
    )
  }

  function IconRecurring() {
    return (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10a6 6 0 0 1 10.5-4"/>
        <path d="M16 10a6 6 0 0 1-10.5 4"/>
        <polyline points="14 6 17 6 17 3"/>
        <polyline points="6 14 3 14 3 17"/>
      </svg>
    )
  }

  const NAV_ITEMS: NavItem[] = [
    { path: '/dashboard', label: 'Home', icon: <IconDashboard /> },
    { path: '/analytics', label: 'Analytics', icon: <IconAnalytics /> },
    { path: '/recurring', label: 'Recurring', icon: <IconRecurring /> },
  ]

  type Props = {
    isOpen: boolean
    onClose: () => void
  }

  export function Sidebar({ isOpen, onClose }: Props) {
    const { pathname } = useLocation()
    const displayName = getTelegramDisplayName()
    const avatarInitial = displayName[0]?.toUpperCase() ?? 'U'

    return (
      <>
        <div
          className={`layout-sidebar-overlay${isOpen ? ' layout-sidebar-overlay--visible' : ''}`}
          onClick={onClose}
          aria-hidden="true"
        />

        <aside className={`sidebar${isOpen ? ' sidebar--open' : ''}`} aria-label="Sidebar navigation">
          <div className="sidebar-logo-row">
            <img src="/logo_v2.png" alt="Spend Again?" className="sidebar-logo-img" />
            <span className="sidebar-logo-name">Spend Again?</span>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.path
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                  onClick={onClose}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              )
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-avatar" aria-hidden="true">{avatarInitial}</div>
          </div>
        </aside>
      </>
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
  git add apps/dashboard/src/components/Sidebar.tsx
  git commit -m "feat: add text labels and Recurring nav item to sidebar"
  ```

---

## Task 10: Dashboard — Recurring placeholder page + App.tsx route

**Files:**
- Create: `apps/dashboard/src/pages/Recurring.tsx`
- Modify: `apps/dashboard/src/App.tsx`

- [ ] **Step 1: Create placeholder Recurring page**

  Create `apps/dashboard/src/pages/Recurring.tsx`:
  ```tsx
  import { Layout } from '../components/Layout'

  export function Recurring() {
    return (
      <Layout>
        <div className="app-main page-enter">
          <h2 style={{ color: 'var(--color-accent)', marginBottom: 8 }}>Recurring Payments</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>Coming soon — manage your subscriptions here.</p>
        </div>
      </Layout>
    )
  }
  ```

- [ ] **Step 2: Add /recurring route in App.tsx**

  In `apps/dashboard/src/App.tsx`:
  ```tsx
  import { Recurring } from './pages/Recurring'

  // Inside <Routes>, after the /analytics route:
  <Route
    path="/recurring"
    element={
      <ProtectedRoute>
        <Recurring />
      </ProtectedRoute>
    }
  />
  ```

- [ ] **Step 3: Run lint**

  ```bash
  pnpm turbo run lint
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/dashboard/src/pages/Recurring.tsx apps/dashboard/src/App.tsx
  git commit -m "feat: add /recurring placeholder route and page"
  ```

---

## Task 11: Bot — parseStructuredEdit helper

**Files:**
- Create: `apps/bot/src/lib/parse-structured-edit.ts`
- Test: `apps/bot/__tests__/` (new test file)

- [ ] **Step 1: Write failing tests**

  Create `apps/bot/__tests__/parse-structured-edit.test.ts`:
  ```typescript
  import { parseStructuredEdit } from '../src/lib/parse-structured-edit.js'

  describe('parseStructuredEdit', () => {
    it('parses price + item + category + subCategory', () => {
      const result = parseStructuredEdit('3.50 iced coffee Food Cafe')
      expect(result).toMatchObject({
        amountCents: 350,
        item: 'iced coffee',
        category: 'Food',
        subCategory: 'Cafe',
      })
    })

    it('parses price + item + category (no subCategory, uses first default)', () => {
      const result = parseStructuredEdit('15.30 grab home Transport')
      expect(result).not.toBeNull()
      expect(result?.amountCents).toBe(1530)
      expect(result?.item).toBe('grab home')
      expect(result?.category).toBe('Transport')
    })

    it('returns null for fewer than 3 tokens', () => {
      expect(parseStructuredEdit('3.50 Food')).toBeNull()
    })

    it('returns null for invalid price', () => {
      expect(parseStructuredEdit('abc coffee Food')).toBeNull()
    })

    it('returns null when no valid category found', () => {
      expect(parseStructuredEdit('3.50 coffee Nonsense')).toBeNull()
    })

    it('is case-insensitive for category', () => {
      const result = parseStructuredEdit('5 kopi food')
      expect(result?.category).toBe('Food')
    })
  })
  ```

- [ ] **Step 2: Run to confirm tests fail**

  ```bash
  pnpm --filter @spend-again/bot test -- --reporter=verbose 2>&1 | grep -A3 parseStructuredEdit
  ```
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement parseStructuredEdit**

  Create `apps/bot/src/lib/parse-structured-edit.ts`:
  ```typescript
  import { CATEGORY_MAP } from '@spend-again/shared'
  import type { Category, SubCategory } from '@spend-again/shared'

  export type StructuredEdit = {
    amountCents: number
    item: string
    category: Category
    subCategory: SubCategory
  }

  const CATEGORIES = Object.keys(CATEGORY_MAP) as Category[]

  function matchCategory(token: string): Category | undefined {
    return CATEGORIES.find((c) => c.toLowerCase() === token.toLowerCase())
  }

  export function parseStructuredEdit(input: string): StructuredEdit | null {
    const tokens = input.trim().split(/\s+/)
    if (tokens.length < 3) return null

    const price = parseFloat(tokens[0] ?? '')
    if (isNaN(price) || price <= 0) return null
    const amountCents = Math.round(price * 100)

    // Try pattern: [price] [...item] [category] [subCategory]
    const last = tokens[tokens.length - 1] ?? ''
    const secondLast = tokens[tokens.length - 2] ?? ''

    const catFromSecondLast = matchCategory(secondLast)
    if (catFromSecondLast !== undefined && tokens.length >= 4) {
      // last token is sub-category
      const itemTokens = tokens.slice(1, tokens.length - 2)
      if (itemTokens.length === 0) return null
      return {
        amountCents,
        item: itemTokens.join(' '),
        category: catFromSecondLast,
        subCategory: last as SubCategory,
      }
    }

    // Try pattern: [price] [...item] [category]
    const catFromLast = matchCategory(last)
    if (catFromLast !== undefined && tokens.length >= 3) {
      const itemTokens = tokens.slice(1, tokens.length - 1)
      if (itemTokens.length === 0) return null
      const defaultSub = (CATEGORY_MAP[catFromLast][0] ?? 'Other') as SubCategory
      return {
        amountCents,
        item: itemTokens.join(' '),
        category: catFromLast,
        subCategory: defaultSub,
      }
    }

    return null
  }
  ```

- [ ] **Step 4: Run tests**

  ```bash
  pnpm --filter @spend-again/bot test
  ```
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/bot/src/lib/parse-structured-edit.ts apps/bot/__tests__/parse-structured-edit.test.ts
  git commit -m "feat: add parseStructuredEdit helper for bot edit flow"
  ```

---

## Task 12: Bot — inline-edit handler + update confirm handler

**Files:**
- Create: `apps/bot/src/handlers/inline-edit.ts`
- Modify: `apps/bot/src/handlers/confirm.ts`

- [ ] **Step 1: Create inline-edit handler**

  Create `apps/bot/src/handlers/inline-edit.ts`:
  ```typescript
  import type { Context } from 'grammy'
  import { parseStructuredEdit } from '../lib/parse-structured-edit.js'
  import { pendingConfirmations, buildConfirmationMessage } from './expense.js'
  import { buildConfirmKeyboard } from '../keyboards/confirm.js'

  export const pendingInlineEdits = new Set<number>()

  export async function handlePendingInlineEdit(ctx: Context): Promise<void> {
    const text = ctx.message?.text
    const chatId = ctx.chat?.id
    if (text === undefined || chatId === undefined) return

    const parsed = parseStructuredEdit(text)
    if (parsed === null) {
      await ctx.reply(
        `Hmm, format not right leh\u{1F914} Try:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 coffee Food Cafe\`\n\nSub-category is optional.`,
        { parse_mode: 'Markdown' },
      )
      return // keep pendingInlineEdits for retry
    }

    pendingInlineEdits.delete(chatId)

    const existing = pendingConfirmations.get(chatId)
    if (existing === undefined) {
      await ctx.reply('No pending transaction found leh. Start again!')
      return
    }

    existing.amount = parsed.amountCents
    existing.item = parsed.item
    existing.category = parsed.category
    existing.subCategory = parsed.subCategory

    const msg = buildConfirmationMessage(existing)
    await ctx.reply(msg, { reply_markup: buildConfirmKeyboard() })
  }
  ```

- [ ] **Step 2: Update handleConfirmEdit in confirm.ts**

  In `apps/bot/src/handlers/confirm.ts`, add the import at the top:
  ```typescript
  import { pendingInlineEdits } from './inline-edit.js'
  ```

  Replace the `handleConfirmEdit` function body:
  ```typescript
  async function handleConfirmEdit(ctx: Context, chatId: number): Promise<void> {
    pendingInlineEdits.add(chatId)
    await ctx.editMessageText(
      `No worries! Send the corrected details:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 coffee Food Cafe\`\n\nSub-category is optional.`,
      { parse_mode: 'Markdown' },
    )
  }
  ```

- [ ] **Step 3: Run tests**

  ```bash
  pnpm --filter @spend-again/bot test
  ```
  Expected: all pass.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/bot/src/handlers/inline-edit.ts apps/bot/src/handlers/confirm.ts
  git commit -m "feat: wire confirm Edit button into structured inline-edit flow"
  ```

---

## Task 13: Bot — /edit command handler

**Files:**
- Create: `apps/bot/src/handlers/edit.ts`

- [ ] **Step 1: Create the /edit handler**

  Create `apps/bot/src/handlers/edit.ts`:
  ```typescript
  import { InlineKeyboard } from 'grammy'
  import type { Context } from 'grammy'
  import {
    MSG_NOT_REGISTERED,
    CATEGORY_EMOJI,
    fmtSGD,
    occurredOnToDisplay,
  } from '@spend-again/shared'
  import type { Category } from '@spend-again/shared'
  import { parseStructuredEdit } from '../lib/parse-structured-edit.js'
  import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
  import { DASHBOARD_URL } from '../lib/env.js'

  export const pendingEdits = new Map<number, string>() // chatId → txId

  const EDIT_FORMAT_HINT =
    `Send the updated details:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 iced coffee Food Cafe\`\n\nSub-category is optional.`

  export async function editCommandHandler(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id
    const chatId = ctx.chat?.id
    if (telegramId === undefined || chatId === undefined) return

    const token = tokenStore.get(telegramId)
    if (token === undefined) {
      await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
      return
    }

    apiClient.setToken(token)
    const userId = userIdStore.get(telegramId)
    if (userId === undefined) {
      await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
      return
    }

    const txs = await apiClient.getRecentTransactions(userId, 5)
    if (txs.length === 0) {
      await ctx.reply('No recent transactions to edit lah! \u{1F605}')
      return
    }

    const keyboard = new InlineKeyboard()
    for (const tx of txs) {
      const emoji = CATEGORY_EMOJI[tx.category as Category] ?? '\u{1F4B0}'
      const label = `${emoji} ${fmtSGD(tx.amountCents)} ${tx.item} (${occurredOnToDisplay(tx.occurredOn)})`
      keyboard.text(label, `edit_select:${tx.id}`).row()
    }

    await ctx.reply('Which transaction to edit?', { reply_markup: keyboard })
  }

  export async function editSelectHandler(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery?.data
    const chatId = ctx.chat?.id
    if (callbackData === undefined || chatId === undefined) return
    await ctx.answerCallbackQuery()

    const txId = callbackData.replace('edit_select:', '')
    pendingEdits.set(chatId, txId)
    await ctx.reply(EDIT_FORMAT_HINT, { parse_mode: 'Markdown' })
  }

  export async function handlePendingEdit(ctx: Context): Promise<boolean> {
    const text = ctx.message?.text
    const chatId = ctx.chat?.id
    const telegramId = ctx.from?.id
    if (text === undefined || chatId === undefined || telegramId === undefined) return false

    const txId = pendingEdits.get(chatId)
    if (txId === undefined) return false

    const parsed = parseStructuredEdit(text)
    if (parsed === null) {
      await ctx.reply(
        `Hmm, format not right leh \u{1F914} Try:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 iced coffee Food Cafe\``,
        { parse_mode: 'Markdown' },
      )
      return true // consumed — keep pendingEdits for retry
    }

    const token = tokenStore.get(telegramId)
    if (token === undefined) {
      pendingEdits.delete(chatId)
      await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
      return true
    }

    apiClient.setToken(token)
    const updated = await apiClient.updateTransaction(txId, {
      amountCents: parsed.amountCents,
      item: parsed.item,
      category: parsed.category,
      subCategory: parsed.subCategory,
      source: 'bot',
    })

    pendingEdits.delete(chatId)

    if (updated === null) {
      await ctx.reply('Aiyah, could not update the transaction. Try again later lah! \u{1F625}')
      return true
    }

    await ctx.reply(
      `Updated! \u{2705} ${fmtSGD(parsed.amountCents)} ${parsed.item} (${parsed.category}/${parsed.subCategory})`,
    )
    return true
  }
  ```

- [ ] **Step 2: Run tests**

  ```bash
  pnpm --filter @spend-again/bot test
  ```
  Expected: all pass.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/bot/src/handlers/edit.ts
  git commit -m "feat: add /edit command handler for bot transaction editing"
  ```

---

## Task 14: Bot — register all edit handlers in bot.ts

**Files:**
- Modify: `apps/bot/src/bot.ts`

- [ ] **Step 1: Register /edit command, edit_select callbacks, and inline-edit routing**

  In `apps/bot/src/bot.ts`, add imports:
  ```typescript
  import { editCommandHandler, editSelectHandler, handlePendingEdit } from './handlers/edit.js'
  import { handlePendingInlineEdit, pendingInlineEdits } from './handlers/inline-edit.js'
  import { pendingEdits } from './handlers/edit.js'
  ```

  Add command registration after `bot.command('recent', recentHandler)`:
  ```typescript
  bot.command('edit', editCommandHandler)
  ```

  Add callback registration after the existing `bot.callbackQuery` lines:
  ```typescript
  bot.callbackQuery(/^edit_select:/, editSelectHandler)
  ```

  Replace the `bot.on('message:text', ...)` handler to check pending states first:
  ```typescript
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id
    const text = ctx.message.text ?? ''

    // Pending /edit flow (editing a saved transaction)
    if (chatId !== undefined && pendingEdits.has(chatId)) {
      await handlePendingEdit(ctx)
      return
    }

    // Pending inline-edit flow (correcting a parsed transaction before save)
    if (chatId !== undefined && pendingInlineEdits.has(chatId)) {
      await handlePendingInlineEdit(ctx)
      return
    }

    if (!text.startsWith('/') && looksLikeQuery(text)) {
      await queryHandler(ctx)
    } else {
      await expenseHandler(ctx)
    }
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

- [ ] **Step 4: Commit**

  ```bash
  git add apps/bot/src/bot.ts
  git commit -m "feat: register /edit command and inline-edit routing in bot"
  ```
