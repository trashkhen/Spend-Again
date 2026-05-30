# Spec: Description Field, Sidebar Redesign, Bot Edit Flow, Recurring Payments

**Date:** 2026-05-30
**Status:** Approved

---

## Overview

Four features split across two PRs:

- **PR 1:** Description field (end-to-end), sidebar/mobile redesign, bot edit flow
- **PR 2:** Recurring payments with auto-create

---

## PR 1

### 1. Description Field

**Goal:** Store a human-readable description alongside each transaction's short `item` name.

**DB:**
- Add `description text` (nullable) column to the `transactions` table via Supabase MCP migration.

**Parser / Bot:**
- `ParseResult` type gets `description?: string`.
- In the bot expense handler, after a successful parse the description is derived by stripping the price/currency portion from the original message text using a regex (removes `S$`, `$`, `SGD`, or a bare leading number and any trailing currency patterns).
  - Example: `"$3.50 coffee from june coffee"` → description `"coffee from june coffee"`
- Gemini continues to extract a short `item` name independently.

**API:**
- `createTransactionSchema` and `updateTransactionSchema` both accept `description: z.string().optional()`.
- All list/get responses include `description` (nullable).

**Dashboard:**
- `ApiTransaction` type gains `description?: string | null`.
- `TransactionTable`: each row shows the description as a native `title` tooltip on hover.
- `TransactionModal` (create + edit): adds an optional Description textarea, pre-populated from `tx.description` when editing.

---

### 2. Sidebar + Mobile Redesign

**Sidebar (all screen sizes):**
- `--sidebar-width` CSS variable: `60px` → `180px`.
- Sidebar layout: `align-items: flex-start`, `padding: 16px 12px`.
- Top section: logo image + `"Spend Again?"` text side-by-side.
- Nav items: full-width rows with `<span class="nav-icon">` + `<span class="nav-label">` side-by-side, `gap: 10px`, `padding: 0 12px`, `justify-content: flex-start`.
- Three nav items: **Home** (`/dashboard`), **Analytics** (`/analytics`), **Recurring** (`/recurring`).

**Mobile (≤768px):**
- Hamburger toggle and slide-in overlay behaviour unchanged.
- Sidebar opens at full 180px (same wide design — not icon-only on mobile).
- `margin-left` on `.app-content` stays `0` on mobile (sidebar overlays content).

**Mobile KPI polish (≤480px):**
- `.kpi-grid`: stays `1fr 1fr` (2 columns — does NOT go single-column).
- `.kpi-card`: `padding: 10px`, `gap: 6px`.
- `.kpi-icon`: `28px × 28px`, `font-size: 13px`.
- `.kpi-value`: `font-size: 15px`.
- `.kpi-label`: `font-size: 9px`.
- `.kpi-grid` gap: `8px`.
- Result: all 4 KPI cards + the start of the transaction list visible without scrolling on a standard phone.

---

### 3. Bot Edit Flow

Two entry points, one shared `parseStructuredEdit()` helper.

**Shared format:** `[price] [item] [category] [sub-category]`
- First token = price (number).
- Working backwards: last token = sub-category if it follows a valid category name; second-to-last = category if valid; middle tokens joined = item.
- Sub-category is optional.
- Example: `3.50 iced coffee Food Cafe`

**`parseStructuredEdit(input: string)`** returns `{ amountCents, item, category, subCategory } | null`. Reused by both entry points below. If it returns `null`, the bot replies with an error message showing the expected format and **keeps the pending state** so the user can try again without re-selecting.

**Entry point A — During confirmation (✏️ Edit button):**
- `handleConfirmEdit` stores the chat ID in a `pendingInlineEdits: Set<number>` instead of clearing the pending confirmation.
- Bot replies with the format prompt.
- On the next text message from that chat (detected before expense/query routing): parse via `parseStructuredEdit`, update the existing `pendingConfirmations` entry with corrected values, clear the chat from `pendingInlineEdits`, re-show the confirmation message.

**Entry point B — Editing a saved transaction (`/edit` command):**
1. Bot fetches the user's 5 most recent transactions.
2. Replies with inline keyboard — one button per transaction (e.g. `"☕ S$3.50 coffee (30 May)"`). Callback: `edit_select:{txId}`.
3. On tap: stores `txId` in `pendingEdits: Map<number, string>` (chatId → txId), replies with format prompt.
4. On next text message (chat has a pending edit): call `parseStructuredEdit`, call `PUT /api/transactions/:txId`, then offer the learn prompt (same existing `learn_yes|{id}` flow).

---

## PR 2

### 4. Recurring Payments

**DB — new `recurring_payments` table:**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → users | cascade delete |
| `name` | text | e.g. "Netflix" |
| `amount_cents` | integer | |
| `category` | text | |
| `sub_category` | text | |
| `description` | text nullable | |
| `frequency` | text | `weekly \| fortnightly \| monthly \| quarterly \| yearly` |
| `next_due_date` | date | YYYY-MM-DD |
| `is_active` | boolean | default true |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**API — `/api/recurring` router:**
- `GET /` — list user's recurring payments
- `POST /` — create
- `PUT /:id` — update (amount, name, frequency, `isActive` for pausing)
- `DELETE /:id` — remove

**Auto-create mechanism:**
- At API server startup: call the check once, then schedule it on a 24-hour `setInterval`.
- Check: find all active recurring payments where `next_due_date <= today`.
- For each: call the same internal transaction-create logic (reuse `TransactionService.create`), then advance `next_due_date` by one period.
- Period math: weekly = +7 days, fortnightly = +14 days, monthly = +1 calendar month, quarterly = +3 months, yearly = +1 year.
- If `next_due_date` is more than one period in the past (server was down for multiple periods), create exactly **one** transaction and advance `next_due_date` to the next period from **today** — not from the missed date. This prevents a flood of duplicate transactions after downtime.

**Dashboard — `/recurring` page:**
- New 3rd sidebar nav item: `🔁 Recurring`, route `/recurring`.
- Page header: monthly cost summary (sum of all active recurring payments normalised to monthly equivalent).
- List of subscriptions: name, amount, category, frequency, next due date, active/paused status.
- "Add Subscription" button → modal with fields: name, amount (SGD), category, sub-category, frequency (dropdown), start date.
- Each row: edit and delete/pause actions.

---

## Out of Scope

- Bot commands for managing recurring payments (dashboard-only for now).
- Multi-currency recurring payments.
- Retroactive backfill if the API server was down on a due date (next check will catch up for the current day only; past dates are skipped after processing).
