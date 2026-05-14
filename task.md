# Spend Again? — Engineering Tasks

> Each task is scoped to limited files, independently testable, and has clear acceptance criteria.

---

## Phase 1: Foundation

### Task 1.1 — Scaffold Monorepo
- [ ] Initialize pnpm workspace and Turborepo

**Files:**
- `[NEW] pnpm-workspace.yaml`
- `[NEW] turbo.json`
- `[MODIFY] package.json` (root)
- `[NEW] .npmrc`
- `[NEW] .gitignore`
- `[NEW] tsconfig.base.json`

**Acceptance Criteria:**
- `pnpm install` succeeds with no errors
- `pnpm turbo run build` runs (even if no packages have build scripts yet)
- Workspace packages are recognized: `pnpm ls -r` lists all packages
- `.gitignore` covers `node_modules`, `dist`, `.env`, `.turbo`

---

### Task 1.2 — Create `packages/shared` (Types, Constants, Categories)
- [ ] Shared types, category hierarchy, SG item mappings, constants

**Files:**
- `[NEW] packages/shared/package.json`
- `[NEW] packages/shared/tsconfig.json`
- `[NEW] packages/shared/src/index.ts`
- `[NEW] packages/shared/src/types.ts` — `Transaction`, `User`, `Category`, `SubCategory`, `LearnedMapping`
- `[NEW] packages/shared/src/categories.ts` — `CATEGORY_MAP` constant
- `[NEW] packages/shared/src/sg-mappings.ts` — `SG_ITEM_MAP` constant
- `[NEW] packages/shared/src/constants.ts` — Currency, date format, app config

**Acceptance Criteria:**
- `pnpm --filter shared build` compiles cleanly (no TS errors)
- All types are exported from `index.ts`
- `Category` type has 12 members including `Groceries`
- `SG_ITEM_MAP` has at least 15 entries
- No `any` types used

---

### Task 1.3 — Create `packages/db` (Drizzle Schema + Supabase Connection)
- [ ] Database schema, client, and migration setup

**Files:**
- `[NEW] packages/db/package.json`
- `[NEW] packages/db/tsconfig.json`
- `[NEW] packages/db/src/index.ts`
- `[NEW] packages/db/src/schema.ts` — `users`, `transactions`, `learned_mappings` tables
- `[NEW] packages/db/src/client.ts` — Drizzle client with Supabase connection
- `[NEW] packages/db/src/migrate.ts` — Migration runner script
- `[NEW] packages/db/drizzle.config.ts`
- `[NEW] .env.example` (root) — `DATABASE_URL` placeholder

**Acceptance Criteria:**
- Schema defines `users`, `transactions`, `learned_mappings` tables
- `transactions.amount_cents` is integer type
- `transactions.category` and `transactions.sub_category` are text
- `learned_mappings` has `item_name`, `category`, `sub_category`, `confidence`, `source`, `usage_count`
- `pnpm --filter db build` compiles cleanly
- `drizzle-kit generate` produces a migration file (dry run, no DB needed)

---

### Task 1.4 — Create `apps/bot` Skeleton (grammY)
- [ ] Basic Telegram bot with `/start` and `/help` commands

**Files:**
- `[NEW] apps/bot/package.json`
- `[NEW] apps/bot/tsconfig.json`
- `[NEW] apps/bot/src/index.ts` — Entry point, bot init
- `[NEW] apps/bot/src/bot.ts` — Bot instance + middleware
- `[NEW] apps/bot/src/handlers/start.ts` — `/start` command
- `[NEW] apps/bot/src/handlers/help.ts` — `/help` command

**Acceptance Criteria:**
- `pnpm --filter bot build` compiles cleanly
- Bot can be started locally with `pnpm --filter bot dev` (requires `BOT_TOKEN` in `.env`)
- `/start` responds with a welcome message
- `/help` responds with a list of available commands
- Bot uses long-polling in dev mode

---

### Task 1.5 — Create `apps/api` Skeleton (Hono)
- [ ] Minimal Hono server with health check endpoint

**Files:**
- `[NEW] apps/api/package.json`
- `[NEW] apps/api/tsconfig.json`
- `[NEW] apps/api/src/index.ts` — Entry point
- `[NEW] apps/api/src/routes/health.ts` — `GET /health` endpoint

**Acceptance Criteria:**
- `pnpm --filter api build` compiles cleanly
- `pnpm --filter api dev` starts the server
- `GET /health` returns `{ status: "ok" }` with 200
- Server listens on port from `PORT` env var (default 3001)

---

### Task 1.6 — Create `apps/dashboard` Skeleton (React + Vite)
- [ ] Scaffolded React app with basic routing

**Files:**
- `[NEW] apps/dashboard/` — Scaffolded via `pnpm create vite@latest`
- `[MODIFY] apps/dashboard/package.json` — Add workspace deps
- `[MODIFY] apps/dashboard/tsconfig.json` — Extend base config
- `[MODIFY] apps/dashboard/src/App.tsx` — Basic route structure

**Acceptance Criteria:**
- `pnpm --filter dashboard dev` starts Vite dev server
- App renders at `localhost:5173` with a placeholder page
- `pnpm --filter dashboard build` produces a production bundle
- TypeScript strict mode is enabled

---

## Phase 2: AI Parsing Engine

### Task 2.1 — Regex Parser (Tier 1)
- [ ] Static pattern matching for amounts, SG items, dates

**Files:**
- `[NEW] packages/parser/package.json`
- `[NEW] packages/parser/tsconfig.json`
- `[NEW] packages/parser/src/index.ts` — Unified `parse()` entrypoint
- `[NEW] packages/parser/src/regex.ts` — Regex-based extraction
- `[NEW] packages/parser/__tests__/regex.test.ts`

**Acceptance Criteria:**
- Parses `"$10 chicken rice"` → `{ amount: 1000, item: "chicken rice" }`
- Parses `"5.50 for lunch at Amoy"` → `{ amount: 550, item: "lunch at Amoy" }`
- Parses `"$12 at NTUC"` → `{ amount: 1200, item: "NTUC", category: "Groceries", subCategory: "Supermarket" }` (via SG_ITEM_MAP)
- Handles `S$`, `$`, `SGD` prefixes
- Handles amounts with/without decimals
- All tests pass: `pnpm --filter parser test`

---

### Task 2.2 — Gemini LLM Parser (Tier 3)
- [ ] Google Gemini integration for ambiguous inputs

**Files:**
- `[NEW] packages/parser/src/gemini.ts` — Gemini API client + structured output prompt
- `[NEW] packages/parser/__tests__/gemini.test.ts`
- `[MODIFY] .env.example` — Add `GEMINI_API_KEY`

**Acceptance Criteria:**
- Sends free-text input to Gemini, receives `{ amount, item, category, subCategory, date }` as structured JSON
- Prompt includes the `CATEGORY_MAP` for valid categories
- Handles Gemini rate limits gracefully (throws typed error, does not crash)
- Has a mock-based test that validates prompt construction and response parsing
- Respects the free-tier rate limit (15 RPM)

---

### Task 2.3 — Learned Mappings Lookup (Tier 2)
- [ ] Database-backed item → category lookup

**Files:**
- `[NEW] packages/parser/src/learned.ts` — DB lookup + save functions
- `[NEW] packages/parser/__tests__/learned.test.ts`
- `[MODIFY] packages/db/src/queries/` — `[NEW] learned-mappings.ts`

**Acceptance Criteria:**
- `lookupItem("daiso")` queries `learned_mappings` table, returns `{ category, subCategory }` or `null`
- `saveMapping("daiso", "Shopping", "Gifts", "gemini")` inserts a new row
- `saveMapping` on existing item updates `usage_count` and `updated_at`
- Case-insensitive matching (normalized to lowercase)
- Tests pass with a mocked DB layer

---

### Task 2.4 — Unified 3-Tier Parse Function
- [ ] Orchestrate regex → learned → Gemini in sequence

**Files:**
- `[MODIFY] packages/parser/src/index.ts` — Unified `parse()` function
- `[NEW] packages/parser/__tests__/index.test.ts`

**Acceptance Criteria:**
- `parse("$12 at NTUC")` returns result from Tier 1 (regex) — no DB or API call
- `parse("$15 at Daiso")` (if Daiso is in `learned_mappings`) returns from Tier 2 — no API call
- `parse("$8 laksa at unknown place")` (nothing in Tier 1/2) falls through to Tier 3 (Gemini)
- Result includes a `tier: 1 | 2 | 3` field indicating which tier resolved it
- Result includes a `confidence` score
- All tests pass: `pnpm --filter parser test`

---

### Task 2.5 — Forwarded SMS Parser
- [ ] Extract transaction data from forwarded bank SMS

**Files:**
- `[NEW] packages/parser/src/sms.ts` — SMS pattern matchers (DBS, OCBC, UOB, etc.)
- `[NEW] packages/parser/__tests__/sms.test.ts`

**Acceptance Criteria:**
- Parses DBS SMS format: `"DBS: SGD 25.00 was charged to Card ending 1234 at GRAB..."` → `{ amount: 2500, item: "GRAB", category: "Transport", subCategory: "Grab" }`
- Parses OCBC SMS format similarly
- Returns `null` for non-financial messages
- Source field set to `"sms"`
- Tests cover at least 3 bank formats (DBS, OCBC, UOB)

---

## Phase 3: API + Auth

### Task 3.1 — Transaction CRUD Routes
- [ ] REST API for transaction management

**Files:**
- `[NEW] apps/api/src/routes/transactions.ts` — GET, POST, PUT, DELETE
- `[NEW] apps/api/src/middleware/validate.ts` — Zod request validation
- `[NEW] apps/api/__tests__/transactions.test.ts`

**Acceptance Criteria:**
- `POST /api/transactions` creates a transaction (validated with Zod)
- `GET /api/transactions` lists transactions (supports `?category=Food&month=05&year=2026`)
- `GET /api/transactions/:id` returns a single transaction
- `PUT /api/transactions/:id` updates a transaction
- `DELETE /api/transactions/:id` deletes a transaction
- All amounts are stored as cents, returned as decimal strings in responses
- Invalid requests return 400 with error details
- Tests pass with mocked DB

---

### Task 3.2 — User Registration + Telegram Linking
- [ ] User signup and Telegram account linking

**Files:**
- `[NEW] apps/api/src/routes/auth.ts` — Register, login, link-telegram endpoints
- `[NEW] apps/api/src/middleware/auth.ts` — JWT verification middleware
- `[NEW] apps/api/src/lib/jwt.ts` — JWT sign/verify helpers
- `[NEW] apps/api/src/lib/telegram-auth.ts` — Telegram Login Widget validation
- `[MODIFY] .env.example` — Add `JWT_SECRET`, `BOT_TOKEN`

**Acceptance Criteria:**
- `POST /api/auth/register` creates a user, returns JWT
- `POST /api/auth/telegram-login` validates Telegram Login Widget data (hash check), returns JWT
- `POST /api/auth/link-telegram` links a Telegram ID to an existing user (requires JWT)
- JWT contains `userId` and `telegramId` claims
- Auth middleware rejects requests without valid JWT (401)
- Telegram auth hash validation follows [Telegram's spec](https://core.telegram.org/widgets/login#checking-authorization)

---

### Task 3.3 — Bot ↔ API Integration
- [x] Bot sends parsed expenses to the API

**Files:**
- `[NEW] apps/bot/src/handlers/expense.ts` — Message handler for expense text
- `[NEW] apps/bot/src/handlers/confirm.ts` — Inline keyboard confirmation flow
- `[NEW] apps/bot/src/lib/api-client.ts` — HTTP client to call the API
- `[MODIFY] apps/bot/src/bot.ts` — Register new handlers

**Acceptance Criteria:**
- User sends "$10 chicken rice" → bot parses → shows confirmation: "🍜 $10.00 — chicken rice — Food/Hawker. Correct?"
- User taps ✅ → transaction saved via API → bot confirms "Saved!"
- User taps ✏️ → bot prompts for correction
- For Tier 3 (Gemini-resolved) items, bot asks "Should I remember this category for next time?" → saves to `learned_mappings`
- Bot requires linked Telegram account (rejects unlinked users with "Please register at [dashboard URL]")

---

### Task 3.4 — Bot Keyboard + Dashboard Link
- [x] Reply keyboard with "Go to Dashboard" button and inline commands

**Files:**
- `[NEW] apps/bot/src/keyboards/main.ts` — Main reply keyboard
- `[NEW] apps/bot/src/keyboards/confirm.ts` — Confirmation inline keyboard
- `[MODIFY] apps/bot/src/handlers/start.ts` — Show main keyboard after `/start`

**Acceptance Criteria:**
- Main keyboard shows: "📊 Dashboard" | "📝 Recent" | "❓ Help"
- "📊 Dashboard" button sends the dashboard URL (with auth token for auto-login)
- "📝 Recent" shows last 5 transactions
- Confirmation keyboard has: "✅ Correct" | "✏️ Edit" | "❌ Cancel"

---

## Phase 4: Dashboard

### Task 4.1 — Dashboard Auth (Telegram Login Widget)
- [x] Login page with Telegram widget

**Files:**
- `[MODIFY] apps/dashboard/src/App.tsx` — Add routing (react-router-dom)
- `[NEW] apps/dashboard/src/pages/Login.tsx` — Telegram Login Widget
- `[NEW] apps/dashboard/src/lib/auth.ts` — Token storage, auth state
- `[NEW] apps/dashboard/src/hooks/useAuth.ts` — Auth hook
- `[NEW] apps/dashboard/src/components/ProtectedRoute.tsx`

**Acceptance Criteria:**
- `/login` page renders the Telegram Login Widget
- On successful Telegram auth, calls `POST /api/auth/telegram-login`, stores JWT
- Authenticated users are redirected to `/dashboard`
- Unauthenticated users are redirected to `/login`
- JWT is stored in `localStorage` and included in API requests as `Authorization: Bearer <token>`

---

### Task 4.2 — Transaction History Page
- [x] Filterable, paginated transaction list

**Files:**
- `[NEW] apps/dashboard/src/pages/Dashboard.tsx`
- `[NEW] apps/dashboard/src/components/TransactionTable.tsx`
- `[NEW] apps/dashboard/src/components/FilterBar.tsx` — Category, date range, search
- `[NEW] apps/dashboard/src/lib/api.ts` — API client (fetch wrapper)

**Acceptance Criteria:**
- Displays transactions in a table: Date | Item | Category | Amount
- Filters by category (dropdown), date range (date picker), and text search
- Amounts display as `S$XX.XX` (converted from cents)
- Dates display as `DD/MM/YYYY`
- Pagination (20 per page)
- Empty state message when no transactions

---

### Task 4.3 — Spending Charts
- [ ] Visual analytics with Recharts

**Files:**
- `[NEW] apps/dashboard/src/pages/Analytics.tsx`
- `[NEW] apps/dashboard/src/components/charts/MonthlySpendChart.tsx` — Bar chart
- `[NEW] apps/dashboard/src/components/charts/CategoryBreakdown.tsx` — Donut/pie chart
- `[NEW] apps/dashboard/src/components/charts/DailyTrend.tsx` — Line chart
- `[NEW] apps/dashboard/src/components/charts/SpendingSummary.tsx` — KPI cards

**Acceptance Criteria:**
- Monthly spend bar chart shows last 6 months
- Category breakdown shows current month as a donut chart with percentages
- Daily trend shows a line chart for the current month
- Summary cards show: Total this month | Average daily | Top category | Transaction count
- All charts are responsive
- Charts handle zero-data state gracefully

---

### Task 4.4 — Dashboard Styling + Layout
- [ ] Premium, SG-themed design system

**Files:**
- `[NEW] apps/dashboard/src/index.css` — Design tokens, global styles
- `[NEW] apps/dashboard/src/components/Layout.tsx` — App shell (sidebar, header)
- `[NEW] apps/dashboard/src/components/Sidebar.tsx` — Navigation
- `[NEW] apps/dashboard/src/components/Header.tsx` — User info, logout

**Acceptance Criteria:**
- Dark mode by default with warm accent colors
- Sidebar navigation: Dashboard | Analytics | Settings
- Mobile-responsive (sidebar collapses to hamburger menu)
- Google Font loaded (Inter or similar)
- Smooth page transitions
- Logo displayed in sidebar/header

---

## Phase 5: Receipt OCR

### Task 5.1 — Image Handling in Bot
- [ ] Receive and process receipt photos

**Files:**
- `[NEW] apps/bot/src/handlers/receipt.ts` — Photo message handler
- `[MODIFY] apps/bot/src/bot.ts` — Register photo handler

**Acceptance Criteria:**
- Bot receives a photo → downloads it → passes to parser
- Bot responds "📸 Processing your receipt..." while parsing
- Supports JPEG, PNG, WebP
- Rejects images over 10MB with a friendly message
- Handles Telegram's compressed vs uncompressed photo modes

---

### Task 5.2 — Gemini Vision Receipt Parser
- [ ] Extract transaction data from receipt images

**Files:**
- `[NEW] packages/parser/src/ocr.ts` — Gemini Vision integration
- `[NEW] packages/parser/__tests__/ocr.test.ts`

**Acceptance Criteria:**
- Sends receipt image to Gemini with a structured prompt
- Returns `{ items: [{ item, amount, category, subCategory }], total, date }` for multi-item receipts
- Returns `{ item, amount, category, subCategory, date }` for simple receipts
- Handles: supermarket receipts (multi-line), restaurant bills, hawker receipts
- Mock test validates prompt structure and response parsing
- Graceful error on unreadable images (returns `null` with reason)

---

### Task 5.3 — Receipt Confirmation Flow
- [ ] User confirms/edits OCR results before saving

**Files:**
- `[MODIFY] apps/bot/src/handlers/receipt.ts` — Add confirmation step
- `[NEW] apps/bot/src/handlers/receipt-confirm.ts` — Callback query handler

**Acceptance Criteria:**
- Bot shows parsed receipt as a formatted message: items, amounts, total, date
- User can ✅ confirm all items → saved as individual transactions
- User can ✏️ edit → bot walks through each field
- User can ❌ cancel → nothing saved
- For multi-item receipts, each item becomes a separate transaction

---

## Phase 6: Polish & Deploy

### Task 6.1 — Bot Personality (Singlish Responses)
- [ ] Inject SG-flavored personality into bot messages

**Files:**
- `[NEW] packages/shared/src/bot-messages.ts` — Message templates
- `[MODIFY] apps/bot/src/handlers/*.ts` — Use message templates

**Acceptance Criteria:**
- Bot uses Singlish-flavored responses (e.g., "Wah, you spent $50 on bubble tea this week sia 😅")
- Confirmation messages are friendly and conversational
- Error messages are helpful, not generic
- Messages include relevant emoji

---

### Task 6.2 — AI Chatbot Queries
- [ ] Users can ask spending questions in natural language

**Files:**
- `[NEW] apps/bot/src/handlers/query.ts` — Natural language query handler
- `[NEW] apps/api/src/routes/analytics.ts` — Aggregation endpoints

**Acceptance Criteria:**
- "How much did I spend on food this month?" → queries API → returns formatted answer
- "What's my biggest expense this week?" → returns top transaction
- "Show my spending breakdown" → returns category summary
- Falls back to "Sorry lah, I don't understand. Try asking about your spending! 🤔" for unrecognized queries

---

### Task 6.3 — Error Handling + Rate Limiting
- [ ] Production-grade error handling across all services

**Files:**
- `[NEW] apps/api/src/middleware/error-handler.ts`
- `[NEW] apps/api/src/middleware/rate-limit.ts`
- `[MODIFY] packages/parser/src/gemini.ts` — Retry logic, rate limit handling
- `[NEW] packages/shared/src/errors.ts` — Typed error classes

**Acceptance Criteria:**
- API returns consistent error format: `{ error: string, code: string, details?: unknown }`
- Rate limiting: 60 requests/min per user on API
- Gemini rate limiting: queue with 15 RPM cap, exponential backoff on 429
- Unhandled errors are caught and logged (not exposed to user)
- Bot errors show a friendly message, not a stack trace

---

### Task 6.4 — Deployment Configuration
- [ ] Deploy dashboard to Vercel, bot + API to Railway

**Files:**
- `[NEW] apps/dashboard/vercel.json`
- `[NEW] apps/api/Dockerfile` (or `railway.toml`)
- `[NEW] apps/bot/Dockerfile` (or `railway.toml`)
- `[NEW] .github/workflows/ci.yml` — Lint + test on PR

**Acceptance Criteria:**
- `pnpm turbo run build` succeeds for all packages
- Dashboard deploys to Vercel via Git push
- Bot + API deploy to Railway (single service or two services)
- Environment variables configured in Railway/Vercel (not committed)
- CI pipeline runs `lint` and `test` on every PR
- Bot uses webhooks in production (not long-polling)
