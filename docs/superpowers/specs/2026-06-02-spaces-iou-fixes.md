# Spaces & IOU Fixes — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Overview

A set of fixes and additions to the Spaces and IOU features across the Telegram bot and website dashboard. No schema changes are required — all new behaviour is built on top of the existing `spaces`, `transactionSpaces`, and `debts` tables.

---

## Section 1 — Spaces

### 1.1 Website: Spaces List Page (`Spaces.tsx`)

**Active / Archived tabs**
- Two tabs at the top of the page: **Active (N)** and **Archived (N)**.
- Default tab is Active.
- Each tab renders a filtered subset of the spaces array (filter by `status`).

**Card actions — Active space**
- View → (navigates to SpaceDetail)
- Deactivate (replaces the current "Archive" button — calls `PATCH /api/spaces/:id { status: 'archived' }`)
- Delete (triggers inline confirmation: *"Permanently remove this space? Transactions are kept."* → Confirm / Cancel → calls new `DELETE /api/spaces/:id/permanent`)

**Card actions — Archived space**
- View →
- Reactivate (calls `PATCH /api/spaces/:id { status: 'active' }`)
- Delete (same confirmation flow as above)

### 1.2 Website: Space Detail Page (`SpaceDetail.tsx`)

**Edit name / emoji**
- A small edit icon (✏️) sits next to the space name in the page header.
- Clicking it toggles an inline edit form: a single text field pre-filled with `{emoji} {name}` (e.g. `🏖️ Bali Trip`). The emoji is just the first character(s) — no special picker widget needed.
- Save calls `PATCH /api/spaces/:id { name, emoji }`. Cancel restores the header.

**Tabs: Overview / Transactions**
- KPI cards (Spent, Budget, Used %, Transactions) are always visible above the tabs.
- **Overview tab** — Recharts `PieChart` (donut style) showing spending breakdown by top-level category. Data from `GET /api/spaces/:id/breakdown`.
- **Transactions tab** — chronological list of transactions tagged to this space. Data from `GET /api/spaces/:id/transactions`. Each row shows: date, item description, category, amount (SGD).

### 1.3 API: New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| DELETE | `/api/spaces/:id/permanent` | Hard-delete the space row. `transactionSpaces` rows cascade-deleted automatically (FK `onDelete: 'cascade'`). Actual `transactions` rows are untouched. |
| GET | `/api/spaces/:id/transactions` | Returns transactions joined via `transactionSpaces` for this space, ordered by `occurred_on` desc. |
| GET | `/api/spaces/:id/breakdown` | Returns `{ category, totalCents, pct }[]` aggregated from the space's transactions. |

The existing `PATCH /api/spaces/:id` already accepts `{ status, name, emoji }` — no changes needed.

### 1.4 Bot: Space Creation Flow (Emoji + Name Confirmation)

Gemini already returns an `emoji` field in `ParsedSpaceResult`. The creation flow is extended:

1. Gemini parses input → returns `{ name, emoji?, startDate?, endDate?, budgetCents? }`.
2. Bot shows confirmation: *"Here's what I got: 🏖️ **Bali Trip**\nDates: 03/06 – 08/06\n\nUse this name and emoji?"* → **[Yes ✓]** **[Edit name]**
3. **Yes** → proceeds to budget prompt (existing flow).
4. **Edit name** → bot replies with a fallback suggestion (`📦 {name}`, stripping the Gemini emoji) and prompts: *"Send me a new name (and optional emoji at the start)."* User's reply becomes the new name+emoji.
5. After name is confirmed → budget prompt → activate?

This mirrors the existing budget confirmation pattern.

### 1.5 Bot: Space List & Per-Space Actions

**`/space` command list view**
- Shows active spaces as inline keyboard buttons (existing behaviour).
- Adds an **"📂 Archived Spaces"** button at the bottom of the keyboard.
- Tapping "📂 Archived Spaces" → fetches spaces with `status: 'archived'` → shows them as buttons with a "↩️ Reactivate" and "🗑 Delete" option per space.

**Active space keyboard** (shown after activating a space — `buildSpaceActiveKeyboard`)
- Existing buttons: View Total, Clear Active Space.
- New buttons: **Deactivate**, **Delete**.

**Deactivate callback (`space_deactivate:<id>`)**
- Calls `PATCH /api/spaces/:id { status: 'archived' }`.
- Replies: *"Space deactivated. Use /space → Archived Spaces to reactivate."*

**Delete callback (`space_delete_confirm:<id>`)**
- First press → bot asks confirmation: *"Permanently delete this space? Transactions are kept."* → **[Yes, delete]** **[Cancel]**
- Confirm (`space_delete_final:<id>`) → calls `DELETE /api/spaces/:id/permanent`.

**Bug fix: `ctx.match` in `spaceCommandHandler`**
- When triggered via `bot.hears('📦 Spaces', ...)`, `ctx.match` is the full matched string `"📦 Spaces"`, not a space name argument.
- Fix: only treat `ctx.match` as a search arg when the handler was invoked via the `/space` command (i.e. check `ctx.message?.text?.startsWith('/')` or use a dedicated hears handler that calls `spaceCommandHandler` with an empty arg).

---

## Section 2 — IOUs (Bot)

### 2.1 New Keyboard Button

Add **💸 IOUs** to the persistent reply keyboard (alongside existing buttons).

### 2.2 `/iou` Command + `💸 IOUs` Button

Both trigger the same handler:

1. Fetch all open/partially-paid debts for the user.
2. If none → reply: *"No open IOUs. Record one with 'I lent Alex $20 for lunch'."*
3. If some → reply with a per-person summary message + inline keyboard:
   - Each open debt as a row: *"👤 Alex owes you S$27.50"* → **[Settle]**
   - Each owed debt: *"👤 You owe Jun S$20.00"* → **[Settle]**
   - **[➕ Record new IOU]** button at the bottom.
4. Tapping **[Settle]** on a debt → existing settle/partial-repay flow (already implemented in `iouCallbackHandler`).
5. Tapping **[➕ Record new IOU]** → bot prompts: *"Tell me the IOU, e.g. 'I lent Alex $20 for lunch' or 'I owe Jun $50'."* → sets a pending state → next message is processed by the existing `detectIouIntent` path.

### 2.3 Natural Language

Typing IOU-style sentences at any time still triggers `detectIouIntent` directly — the `/iou` menu is additive, not a replacement.

---

## Section 3 — Help (`MSG_HELP`)

`packages/shared/src/bot-messages.ts` — rewrite `MSG_HELP` to include:

- **Logging expenses** (existing)
- **Receipt scanning** (existing)
- **Spending queries** (existing)
- **Spaces** — `/space` to manage spaces, keyboard button `📦 Spaces`; how to create, activate, deactivate
- **IOUs** — `/iou` or `💸 IOUs` button; natural language examples (`"I lent Alex $20"`, `"Alex paid me back"`)
- **Commands list** — `/start`, `/help`, `/recent`, `/space`, `/iou`
- **Keyboard buttons** — all 5: 🌐 Dashboard, 📊 Monthly Report, 📝 Recents, 📦 Spaces, 💸 IOUs, ❓ Help

---

## Implementation Notes

- No DB migrations needed.
- `recharts` is likely not yet installed in the dashboard — add it with `pnpm add recharts --filter @spend-again/dashboard`.
- `DELETE /api/spaces/:id/permanent` is a new route, distinct from the existing soft-delete `DELETE /api/spaces/:id` (which maps to `archive`). Keep both to avoid breaking existing bot behaviour.
- `ParsedSpaceResult` in `packages/parser/src/gemini.ts` does **not** have an `emoji` field yet. Two changes required: (1) add `emoji?: string | null` to the type, (2) update `buildSpacePrompt` to include `"emoji"` in the JSON shape and instruct Gemini to suggest a single relevant emoji for the space name (e.g. `"🏖️"` for a beach trip). The bot handler then reads `parsed.emoji` and uses it in the name+emoji confirmation step.
