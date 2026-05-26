# Codex Review Follow-up — Design

**Date:** 2026-05-26
**Status:** Approved (sections 1–4)
**Source:** Senior tech-lead code review of the prod codebase (see chat transcript 2026-05-26)

This spec consolidates the fixes for all 17 actions from the review. It is sized for sequential subagent execution and is the single source of truth for the implementation plan.

---

## 1. Goals & non-goals

**Goals**
- Eliminate the seven block-merge bugs that will surface as user-visible failures under load.
- Eliminate the architectural drift between `@spend-again/shared`, `@spend-again/db`, the API wire shape, and the bot/dashboard consumers.
- Make custom categories persist per user.
- Get the bot off direct DB access; the API becomes the sole writer.
- Migrate the `transactions.date` text column to a real `date` type without downtime.
- Establish a safety-net integration test that every later phase runs.

**Non-goals (out of scope, deferred)**
- Building the real Settings page. Phase 4 removes the stub; revisit when there are real settings beyond Budget (which lives on Dashboard today).
- Per-user (not global) learned mappings. Schema stays global; can be made per-user later by tagging `learned_mappings.source` with `user:<uuid>`.
- Refresh tokens / JWT revocation table.
- Structured tracing beyond a `pino` logger.
- Replacing the in-memory rate-limit store with Redis. Acceptable for single-process Railway deployment.

---

## 2. Decisions baked in

| ID | Decision |
|----|----|
| 1.5 | `Books` moves from `Education` to `Shopping`. `CATEGORY_MAP.Shopping` gains `'Books'`. `CATEGORY_MAP.Education` loses `'Books'`. Gemini and OCR prompts update accordingly. SG mappings (`popular`, `popular bookstore`) keep `Shopping/Books`. |
| 1.6 | Drive the rate-limit message off `GEMINI_RPM_LIMIT` constant. Verify the constant matches Gemini 2.5 Flash-Lite's current free-tier RPM (web check at implementation time); update constant if wrong. Replace every hardcoded `"15 RPM"` literal. |
| 1.8 | Leave `spend-againapi-production` URL spelling alone — that is the deployed Railway hostname. |
| 2.3 | New table `user_custom_categories(id, user_id, category, sub_category, created_at)` with `UNIQUE (user_id, category, sub_category)`. Per-user, persistent, supports pre-creation. |
| 2.4/11 | Bot stops writing to DB directly. New `POST /api/learned-mappings` endpoint. Bot's existing `apiClient.saveLearnedMapping` is activated. `saveMapping`/`upsertMapping`/`findMapping` removed from the bot's import graph. Learned-mapping reads also move to the API (`GET /api/learned-mappings/:itemName`) so the bot can drop `DATABASE_URL` entirely. |
| 8 | Dual-write migration for the date column: add new `occurred_on date`, backfill, dual-write for one release, cut reads over, drop legacy column. |
| 9 | `@spend-again/db` keeps DB row types (Drizzle-inferred — already correct). `@spend-again/shared/types.ts` is rewritten to host wire DTOs (`ApiTransaction`, `CreateTransactionRequest`, `UpdateTransactionRequest`, `ApiUser`, `BudgetSettings`, `CustomCategory`, etc.). Dashboard and bot import from shared; remove their local duplicates. The misleading `Transaction` and `User` types in shared are deleted. |
| 10 | Keep typed `GeminiRateLimitError` and `OcrRateLimitError` in `@spend-again/shared/errors.ts`. Delete the duplicate plain-`Error` classes in `packages/parser/src/gemini.ts` and `packages/parser/src/ocr.ts`. Bot's `name`-string check (`receipt.ts:218`) becomes `instanceof`. |
| 12 | Categories are free-form per user. The canonical `CATEGORIES`/`CATEGORY_MAP` is a *suggestion set*; the DB stores whatever text was selected. The `Income` special-case in `TransactionTable` is removed (no such category exists; if a user wants Income tracking they can add it via the custom-categories table). |

---

## 3. Phasing

Five sequential phases. Each phase is one subagent dispatched via `superpowers:subagent-driven-development`, working in a git worktree, under TDD discipline. Phase N starts only after Phase N−1 is merged green.

| # | Phase | Items |
|---|---|---|
| **0** | Safety net | Integration test, central logging, repo cleanup |
| **1** | Block-merge bug fixes | 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10 |
| **2** | Schema + new endpoints | `occurred_on` add+backfill, `user_custom_categories` table, `POST /api/learned-mappings`, `GET /api/learned-mappings/:itemName`, custom-categories endpoints |
| **3** | Cutover + types unification | Bot stops touching DB, dashboard uses custom-categories API, reads switch to `occurred_on`, shared types rewritten, helpers centralised, RPM gate wired |
| **4** | Drop legacy | Drop text `date` column, remove dual-write, remove Settings stub, remove notification bell, delete mock-token fallback |

---

## 4. Phase 0 — Safety net

Subagent: `general-purpose`.

| Task | Detail |
|---|---|
| 0.1 | Write `apps/api/__tests__/integration/round-trip.test.ts`. Exercises: register user → telegram-login (mocked HMAC) → create transaction via `POST /api/transactions` → fetch via `GET /api/transactions` → upsert learned mapping → assert idempotence. Uses a real Postgres test DB (separate from prod). Provides utilities for spinning up a clean schema. |
| 0.2 | Add `pino` as a workspace dep. Create `packages/shared/src/logger.ts` exporting `createLogger(service: string)`. Replace `console.error|warn|log` call sites in API and bot with `logger.error|warn|info`. Tag with service name. Dashboard keeps `console.warn` for now (browser env, separate concern). |
| 0.3 | Drop `--passWithNoTests` from `turbo.json`'s `test` task and from any package `test` scripts. Confirm every package has ≥1 test. |
| 0.4 | Move `task.md`, `implementation_plan.md`, `implementation_plan2.md`, `.superpowers/` directory, root `Spend Again?.png` into `docs/`. Update README references. |

Acceptance: `pnpm turbo run lint && pnpm turbo run test` is green. The integration test passes.

---

## 5. Phase 1 — Block-merge bug fixes

Subagent: `general-purpose`, TDD. Sub-tasks marked ‖ are parallel-safe but execute sequentially for atomic review.

| Task | Detail |
|---|---|
| 1.1 ‖ | `apps/bot/src/handlers/receipt-confirm.ts:95` — replace `userId: String(telegramId)` with `userIdStore.get(telegramId)`; bail with `MSG_NOT_REGISTERED` if missing (mirror `confirm.ts`). |
| 1.2 ‖ | `apps/api/src/routes/transactions.ts` — extend `listTransactionsQuerySchema` with `limit` (1–500, default 50), `offset` (≥0, default 0). Service applies `.limit().offset().orderBy(desc(createdAt))`. Bot's `getRecentTransactions(userId, 5)` now actually returns 5. |
| 1.3 ‖ | `apps/api/src/index.ts` — remove global `app.use('/api/*', rateLimitMiddleware)`. Each protected router does `router.use('*', requireAuth, rateLimitMiddleware)`. `/api/auth/*` and `/health` get rate-limit only. |
| 1.4 ‖ | `packages/shared/src/categories.ts` — add `'Books'` to `CATEGORY_MAP.Shopping`, remove from `Education`. `packages/parser/src/gemini.ts` and `packages/parser/src/ocr.ts` prompts — change "Popular, MPH → Education/Books" to "Popular, MPH → Shopping/Books". |
| 1.5 ‖ | `packages/shared/src/constants.ts` — verify `GEMINI_RPM_LIMIT = 30` matches current Gemini 2.5 Flash-Lite free tier (web check); update if wrong. Replace hardcoded `"15 RPM"` strings in `packages/shared/src/errors.ts`, `packages/parser/src/gemini.ts`, `packages/parser/src/ocr.ts` with interpolated constant. |
| 1.6 ‖ | Delete `GeminiRateLimitError` and `OcrRateLimitError` from the parser package. Re-export from `@spend-again/shared/errors`. Update `apps/bot/src/handlers/receipt.ts:218` from name-string check to `instanceof OcrRateLimitError`. |
| 1.7 ‖ | Hard-fail at startup in `apps/api/src/lib/jwt.ts`, `apps/api/src/index.ts`, `apps/bot/src/bot.ts`, `apps/bot/src/index.ts`, `apps/bot/src/lib/api-client.ts`, `packages/db/src/client.ts`. Missing `JWT_SECRET` / `BOT_TOKEN` / `API_URL` / `DATABASE_URL` throws on import. No string defaults. |
| 1.8 ‖ | `apps/dashboard/src/pages/Welcome.tsx` — replace `navigate()` in render with `<Navigate to="/login" replace />`. |
| 1.9 | `apps/bot/src/handlers/confirm.ts:159` — stop encoding item in callback_data. Introduce `pendingLearnPrompts: Map<string, { item, category, subCategory }>` keyed by a short random ID; callback_data becomes `learn_yes\|<id>`. `learnHandler` looks up by ID and deletes after use. Same fix for any other callback_data approaching the 64-byte limit. |
| 1.10 | `pnpm turbo run lint && pnpm turbo run test`. Phase 0 integration test stays green. |

---

## 6. Phase 2 — Schema + new endpoints

Subagent: `general-purpose`, TDD.

| Task | Detail |
|---|---|
| 2.1 | New Drizzle migration `0002_add_occurred_on.sql`: `ALTER TABLE transactions ADD COLUMN occurred_on date`. Backfill: `UPDATE transactions SET occurred_on = to_date(date, 'DD/MM/YYYY')`. Precheck: `SELECT count(*) FROM transactions WHERE to_date(date,'DD/MM/YYYY') IS NULL` — abort if non-zero. Then `ALTER COLUMN occurred_on SET NOT NULL`. Index `(user_id, occurred_on DESC)`. |
| 2.2 | New migration `0003_user_custom_categories.sql`: see Section 2 of design (`CREATE TABLE user_custom_categories …`). |
| 2.3 | Update `packages/db/src/schema.ts` — add `occurredOn`, add `userCustomCategories` table. Re-export from `index.ts`. |
| 2.4 | Transaction service: writes both `date` (text, existing) and `occurredOn` (date) on insert/update. Reads still use `date` for now. |
| 2.5 | New router `apps/api/src/routes/custom-categories.ts` mounted at `/api/users/custom-categories`. Endpoints: `GET` (list for current user), `POST` `{category, subCategory}` (add), `DELETE :id`. Auth required. |
| 2.6 | New router `apps/api/src/routes/learned-mappings.ts` mounted at `/api/learned-mappings`. `POST` `{itemName, category, subCategory, source}` calls `upsertMapping`. `GET /:itemName` calls `findMapping`. Auth required. |
| 2.7 | Move `requireAuth` for `users` router up to `index.ts` level for consistency. |
| 2.8 | Tests for every new endpoint. Lint + test pass. Phase 0 integration test stays green. |

---

## 7. Phase 3 — Cutover + types unification

Subagent: `general-purpose`, TDD. **Riskiest phase.**

| Task | Detail |
|---|---|
| 3.1 | Bot: replace `saveMapping` import in `apps/bot/src/handlers/confirm.ts` with `apiClient.saveLearnedMapping`. Add `apiClient.getLearnedMapping(itemName)` calling `GET /api/learned-mappings/:itemName` (route from 2.6). The parser package cannot call apiClient directly (apiClient lives in the bot), so refactor `parse()` to accept a lookup function: `parse(input, { lookupItem }: { lookupItem: (name: string) => Promise<MappingResult \| null> })`. Bot's `expense.ts` passes `apiClient.getLearnedMapping`. Delete `packages/parser/src/learned.ts` and its direct DB imports entirely. |
| 3.2 | Remove `@spend-again/db` from `apps/bot/package.json` transitive dependency. Remove `DATABASE_URL` from bot env requirements. Update `.env.example` and Railway docs. |
| 3.3 | API read cutover for transactions list / `/analytics/top` / `/analytics/breakdown` / `/analytics/summary` — switch every `like(transactions.date, '__/MM/YYYY')` filter to `between(transactions.occurredOn, startOfMonth, endOfMonth)`. Switch order-by from JS `parseDDMMYYYY` sort to `desc(transactions.occurredOn)`. Delete `parseDDMMYYYY` from `apps/api/src/routes/analytics.ts`. |
| 3.4 | Shared types refactor — rewrite `packages/shared/src/types.ts`: export `ApiTransaction`, `CreateTransactionRequest`, `UpdateTransactionRequest`, `ApiUser`, `BudgetSettings`, `CustomCategory`. Delete `Transaction` and `User`. Dashboard `lib/api.ts` and bot `lib/api-client.ts` import from `@spend-again/shared`; remove their local duplicates. Do per-consumer in this order: api → bot → dashboard. TypeScript guides each step. |
| 3.5 | Dashboard `TransactionModal`: on mount call `getCustomCategories()`, merge with canonical `CATEGORIES` + `CATEGORY_MAP`. "+ Add New" calls `POST /api/users/custom-categories`, optimistically appends to local list, refetches on error. Delete the in-component `customCategories`/`customSubCategories` state. |
| 3.6 | Centralise helpers: create `@spend-again/shared/src/dates.ts` (`getTodayDDMMYYYY`, `getYesterdayDDMMYYYY`, `parseDDMMYYYY`, `formatShortDate`), `format.ts` (`parseCents`, `centsToDecimalString`, `fmtSGD`), `category-emoji.ts` (single `CATEGORY_EMOJI` map). Delete every duplicate copy across apps. Remove the `Income` special-case in `TransactionTable.tsx`. |
| 3.7 | Wire `waitForGeminiRpmBudget()` into `parse()` (`packages/parser/src/index.ts`), `parseQueryWithGemini()` (`apps/bot/src/handlers/query.ts`), and `parseReceiptWithOcr()` (`packages/parser/src/ocr.ts`). |
| 3.8 | Lint + test + Phase 0 integration test all green. |

---

## 8. Phase 4 — Drop legacy

Subagent: `general-purpose`. **Requires human sign-off before running the migration.**

| Task | Detail |
|---|---|
| 4.1 | Migration `0004_drop_text_date.sql`: `ALTER TABLE transactions DROP COLUMN date`. Remove the dual-write code in the transaction service. `NewTransaction` no longer has `date: string`. Requires Supabase point-in-time snapshot before running. |
| 4.2 | Remove Settings nav item from `Sidebar.tsx`. Remove `/settings` route from `App.tsx`. Delete `apps/dashboard/src/pages/Settings.tsx`. |
| 4.3 | Remove the notification bell from `Header.tsx` (no notifications wired). |
| 4.4 | Delete `useAuth.ts.createMockDevToken` and the offline-fallback branch. Gate the `loginAsTestUser` button on `import.meta.env.DEV` exclusively. |
| 4.5 | Final lint + test + integration sweep. |

---

## 9. Risk & mitigations

| Risk | Mitigation |
|---|---|
| Phase 2 backfill aborts on malformed `date` rows | Precheck `SELECT count(*) WHERE to_date(date,'DD/MM/YYYY') IS NULL` and abort migration cleanly if non-zero. Subagent reports the offending rows. |
| Phase 3 read cutover breaks analytics silently | Phase 0 integration test must cover `/api/analytics/summary`, `/api/analytics/top`, `/api/analytics/breakdown`, `/api/transactions` filters, and the bot's `query.ts` aggregations. Cutover is gated on test stability. |
| Phase 3 type refactor produces a sprawling diff | Per-consumer rename (api → bot → dashboard), one consumer per commit. TypeScript guides each step. |
| Phase 4 column drop is irreversible | Supabase point-in-time snapshot before migration. Human sign-off required before subagent invokes `pnpm --filter db migrate`. |
| Bot loses learned-mappings reads if Phase 3.1 partial | Subagent confirms tier-2 lookup works (one end-to-end test) before deleting parser's DB imports in 3.2. |

---

## 10. Dispatch & sequencing

- Subagent per phase, dispatched via `superpowers:subagent-driven-development`, agent type `general-purpose`.
- Each phase runs in its own git worktree.
- After each phase: `superpowers:requesting-code-review` pass before moving on.
- After all phases: `superpowers:finishing-a-development-branch`.
- Implementation plan (the operational version of this spec, with step-by-step instructions and checkpoints) will be produced by `superpowers:writing-plans` and saved alongside this design.
