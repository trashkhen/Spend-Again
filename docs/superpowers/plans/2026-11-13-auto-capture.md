# Auto-capture (Apple Pay + UOB SMS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone Shortcuts automations POST Apple Pay taps and UOB SMS alerts to the bot service, which logs them as expenses and reports each one in Telegram.

**Architecture:** A per-user capture key (hash stored on `users`) is exchanged at the API for a normal login token. The bot service gains `POST /ingest` next to the Telegram webhook; it parses the text with the existing parser, saves through a dedicated `ApiClient`, and sends a Telegram message with Edit/Delete buttons. Unconfident parses fall into the existing confirm flow.

**Tech Stack:** TypeScript (strict, no `any`), Hono + Zod (API), grammY + `node:http` (bot), Drizzle, Vitest, pnpm + Turbo.

**Spec:** `docs/superpowers/specs/2026-11-13-auto-capture-design.md`

## Scope change (13/11/2026, khen)

UOB is paused; build Apple Pay only.

- **Task 2 is skipped entirely.**
- Task 3: no `sms` branch in `processIngest`; `IngestRequest.source` is `'wallet'` only; drop the SMS tests and the `'ignored'` outcome; `via` is always `Apple Pay`. `CreateTransactionInput.source` widens to `'bot' | 'wallet'`.
- Task 4: `source` other than `wallet` (including `sms`) → 400.
- Task 6: guide covers the Apple Pay automation only.
- Review Focus item 3 no longer applies.

## Global Constraints

- SGD, amounts as integer cents, dates DD/MM/YYYY.
- No `any`. `pnpm turbo run lint` and `pnpm turbo run test` pass at the end of every task.
- Migrations: verify with Supabase MCP `execute_sql` against `information_schema`, generate with `pnpm --filter @spend-again/db generate`, apply with Supabase MCP `apply_migration`. Never `pnpm migrate`.
- Never write an SMS body or wallet text to logs or the database (the parsed `item` is fine).
- The capture key is never stored or logged; only its SHA-256 hex digest.
- Work on branch `feat/auto-capture`, one commit per task.
- Run `graphify update .` after the last task.

## Review Focus

1. Shortcuts sends the amount in an unexpected shape (`S$8.50`, `SGD 8.50`, `$1,234.00`) → still logged with the right cents. (Task 3)
2. The same payment arrives twice (Shortcuts retry, or Wallet tap + UOB SMS for one purchase) → saved, second message carries the duplicate warning. (Task 3)
3. UOB texts that are not spending (incoming PayNow, OTP, promo) → nothing saved, no Telegram message. (Task 2, Task 3)
4. A request with a replaced/unknown key → 202 is not leaked as success: 401, nothing saved, no message. (Task 4)
5. An auto-capture that needs confirmation arrives while a manual confirmation is already pending in that chat → the pending one is not overwritten; user gets the "couldn't log" message instead. (Task 3)

---

### Task 1: Capture key on the API

**Files:**
- Modify: `packages/db/src/schema.ts` (users table)
- Create: `packages/db/drizzle/0010_*.sql` (generated)
- Create: `apps/api/src/lib/ingest-key.ts`
- Modify: `apps/api/src/routes/users.ts`, `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/transactions.ts`, `apps/api/src/services/transactions.ts` (add `'wallet'` to every `source` union/enum)
- Test: `apps/api/__tests__/ingest-key.test.ts`

**Interfaces:**
- Produces:
  - `users.ingestKeyHash` → column `ingest_key_hash text unique`, nullable.
  - `generateIngestKey(): { key: string; hash: string }` — `key` is `sa_` + 32 random bytes base64url; `hash` is `hashIngestKey(key)`.
  - `hashIngestKey(key: string): string` — SHA-256 hex.
  - `POST /api/users/ingest-key` (authenticated) → `201 { key }`; overwrites any previous hash.
  - `POST /api/auth/ingest-login` body `{ key: string }` (20–100 chars) → `200 { token, userId, telegramId }`; `401 { error: 'Unauthorized', code: 'INVALID_INGEST_KEY' }` when no user has that hash or the user has no `telegramId`. Token is signed exactly as `telegram-login` signs it (`userId`, `telegramId`).
  - `source: 'wallet'` accepted by `POST/PUT /api/transactions`.

- [ ] **Step 1: Write failing tests** in `apps/api/__tests__/ingest-key.test.ts`, using the mock-DB style of `apps/api/__tests__/auth.test.ts`:

```ts
it('generateIngestKey returns sa_-prefixed key whose hash is sha256 hex', () => {
  const { key, hash } = generateIngestKey()
  expect(key).toMatch(/^sa_[A-Za-z0-9_-]{43}$/)
  expect(hash).toBe(createHash('sha256').update(key).digest('hex'))
})
it('two generated keys differ', ...)
it('POST /ingest-login returns token, userId, telegramId for a known hash', ...) // db select resolves [{ id, telegramId: '12345' }]
it('POST /ingest-login 401 INVALID_INGEST_KEY when no row', ...)
it('POST /ingest-login 401 when user has null telegramId', ...)
it('POST /ingest-login 400 when key shorter than 20 chars', ...)
it('POST /users/ingest-key stores the hash, never the key, and returns the key', ...) // assert update().set called with { ingestKeyHash: hashIngestKey(body.key), ... }
it('POST /api/transactions accepts source "wallet"', ...) // add to transactions.test.ts
```

- [ ] **Step 2:** Run `pnpm --filter @spend-again/api test -- ingest-key` → FAIL (module not found).
- [ ] **Step 3:** Add the column to `schema.ts`; implement `ingest-key.ts`; add both routes; add `'wallet'` to the four `source` declarations. Lookup is by hash equality in SQL, so no separate constant-time compare is needed.
- [ ] **Step 4:** Run API tests → PASS.
- [ ] **Step 5: Migration.** `execute_sql`: `select column_name from information_schema.columns where table_name='users'` and confirm `ingest_key_hash` is absent; `list_migrations` to confirm 0009 is the latest applied. Run `pnpm --filter @spend-again/db generate`. Confirm the generated SQL is only `ALTER TABLE "users" ADD COLUMN "ingest_key_hash" text` plus the unique constraint. Apply with `apply_migration` name `add_users_ingest_key_hash`. Re-run the `information_schema` query; column present.
- [ ] **Step 6:** Commit `feat(api,db): capture key for auto-logging`.

### Task 2: Bank SMS classification and UOB transfer patterns

**Files:**
- Modify: `packages/parser/src/sms.ts`, `packages/parser/src/index.ts`
- Test: `packages/parser/__tests__/sms.test.ts`

**Interfaces:**
- Produces (both exported from `@spend-again/parser`):
  - `classifyBankSms(text: string): 'outgoing' | 'ignore'`
  - `parseFromSMS(input: string): ParseResult | null` (existing; now exported from the package index and extended)

Rules for `classifyBankSms`, checked in this order:
1. `ignore` if it matches `/\b(OTP|one[- ]time|verification code|do not share)\b/i`.
2. `ignore` if it matches `/\b(received|credited|refund(ed)?|deposit(ed)?|incoming)\b/i`.
3. `outgoing` if it contains a money amount (`/(S\$|SGD)\s?[\d,]+\.\d{2}/i`) **and** matches `/\b(paid|payment|transfer(red)?|debited|charged|spent|withdrawn|deducted|PayNow)\b/i`.
4. Otherwise `ignore`.

New `tryUOB` patterns (placeholders for real wording; replace when khen pastes a real alert — keep the tests in step with it):
- `You made a PayNow transfer of SGD 5.00 to <NAME> on <date>` → merchant `<NAME>`.
- `SGD 5.00 was transferred from your account ... to <NAME>` → merchant `<NAME>`.

`parseFromSMS` amount handling must strip thousands commas (`SGD 1,234.50` → `123450`).

- [ ] **Step 1: Write failing tests:**

```ts
describe('classifyBankSms', () => {
  it.each([
    ['UOB: Your OTP is 123456. Do not share it.', 'ignore'],
    ['UOB: You have received SGD 20.00 via PayNow from TAN AH KOW.', 'ignore'],
    ['UOB: Enjoy S$2 off with Rewards+ this Friday!', 'ignore'],
    ['UOB: A refund of SGD 12.00 was credited to your card.', 'ignore'],
    ['UOB: You made a PayNow transfer of SGD 5.00 to AH HUAT KOPI on 13 Nov 2026.', 'outgoing'],
    ['UOB: Your card ending 1234 has been charged SGD25.00 at GRAB', 'outgoing'],
  ])('%s → %s', (text, expected) => expect(classifyBankSms(text)).toBe(expected))
})
it('parses UOB PayNow transfer: amount 500, item "AH HUAT KOPI", date 13/11/2026', ...)
it('parses SGD 1,234.50 as 123450 cents', ...)
it('parseFromSMS and classifyBankSms are exported from the package index', ...)
```

- [ ] **Step 2:** `pnpm --filter @spend-again/parser test -- sms` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Parser tests → PASS.
- [ ] **Step 5:** Commit `feat(parser): classify bank SMS and parse UOB transfers`.

### Task 3: Ingest processing in the bot

**Files:**
- Create: `apps/bot/src/lib/ingest.ts`
- Create: `apps/bot/src/keyboards/autolog.ts`
- Modify: `apps/bot/src/lib/api-client.ts` (`ingestLogin`, `deleteTransaction`, widen `CreateTransactionInput.source` to `'bot' | 'sms' | 'wallet'`)
- Modify: `packages/shared/src/bot-messages.ts` (new copy)
- Test: `apps/bot/__tests__/ingest.test.ts`

**Interfaces:**
- Consumes: Task 1 `POST /api/auth/ingest-login`; Task 2 `classifyBankSms`, `parseFromSMS`; existing `parse`, `ApiClient`, `pendingConfirmations`, `buildConfirmationMessage`, `buildConfirmKeyboard`, `tokenStore`, `userIdStore`, `getTodayDDMMYYYY`, `fmtSGD`, `CATEGORY_EMOJI`.
- Produces:

```ts
export type IngestRequest = { source: 'wallet' | 'sms'; text: string; card?: string }
export type IngestOutcome = 'saved' | 'asked' | 'ignored' | 'failed' | 'unauthorized'
export type IngestAuth = { token: string; userId: string; telegramId: string }
export type IngestDeps = {
  send: (chatId: number, text: string, keyboard?: InlineKeyboard) => Promise<void>
  makeClient: (token: string) => ApiClient
  now: () => number
}
export const INGEST_AUTOSAVE_MIN_CONFIDENCE = 0.8
export const INGEST_DUPLICATE_WINDOW_MS = 180_000
export function normalizeWalletText(text: string): string   // strips thousands commas inside amounts, collapses whitespace
export async function processIngest(auth: IngestAuth, req: IngestRequest, deps: IngestDeps): Promise<IngestOutcome>
export function clearIngestState(): void                    // tests only
// api-client.ts
export async function ingestLogin(key: string, apiUrl?: string): Promise<IngestAuth | null>
ApiClient.deleteTransaction(txId: string): Promise<boolean> // DELETE /api/transactions/:id
// keyboards/autolog.ts
export function buildAutologKeyboard(txId: string): InlineKeyboard
//   '✏️ Edit'  → callback `edit_select:${txId}` (existing handler)
//   '🗑 Delete' → callback `autolog_del:${txId}`
// bot-messages.ts
export const MSG_AUTOLOGGED: (amount: string, item: string, category: string, via: string, date: string, duplicate: boolean) => string
export const MSG_AUTOLOG_FAILED: (amount: string | undefined, item: string | undefined) => string
```

`MSG_AUTOLOGGED` copy (duplicate line only when `duplicate`):
```
⚠️ Same amount as an entry a moment ago
⚡ Auto-logged  $8.50  Ya Kun Kaya Toast
Food / Cafe · Apple Pay · 13/11/2026
```
`via` is `Apple Pay` for wallet (append ` (<card>)` when `card` is set) and `UOB SMS` for sms.
`MSG_AUTOLOG_FAILED`: `Couldn't log a payment of $8.50 at Ya Kun — send it to me manually can?` (omit the parts that are undefined).

`processIngest` behaviour:
1. `chatId = Number(auth.telegramId)`. Set `tokenStore`/`userIdStore` for that id so the confirm and edit handlers work afterwards. Use `deps.makeClient(auth.token)` for every API call — never the shared `apiClient` singleton (its token is per-request mutable state).
2. `sms`: if `classifyBankSms(text) === 'ignore'` → return `'ignored'`, send nothing. Else `parseFromSMS(text)`; if it returns a result without a category, run `parse("<amount in dollars> <item>", { lookupItem })` to categorise; if `parseFromSMS` returns null, `parse(text, …)`.
3. `wallet`: `parse(normalizeWalletText(text), { lookupItem })`.
4. Parser throws (`GeminiRateLimitError`, `CurrencyConversionError`, anything) or returns null or `amount <= 0` → send `MSG_AUTOLOG_FAILED`, return `'failed'`.
5. Auto-save when `category` and `subCategory` are set and `confidence >= INGEST_AUTOSAVE_MIN_CONFIDENCE`: `createTransaction` with `source` = request source, `date` = `result.date ?? getTodayDDMMYYYY()`, `description` = `result.item`. Attach to the active Space if there is one (failure there must not fail the save). Null from `createTransaction` → `MSG_AUTOLOG_FAILED`, `'failed'`. Otherwise send `MSG_AUTOLOGGED` with `buildAutologKeyboard(id)`, return `'saved'`.
6. Duplicate: module-level `Map<userId, { amountCents: number; at: number }[]>`; an entry with the same `amountCents` within `INGEST_DUPLICATE_WINDOW_MS` of `deps.now()` sets `duplicate = true`. Record every auto-save; prune entries older than the window.
7. Not confident: if `pendingConfirmations.has(chatId)` → `MSG_AUTOLOG_FAILED`, `'failed'`. Otherwise set a `PendingConfirmation` (`rawInput` = the text that was parsed) and send `buildConfirmationMessage(entry)` with `buildConfirmKeyboard()`, return `'asked'`.
8. A throwing `deps.send` after a successful save is logged (without the text) and the outcome stays `'saved'`.

- [ ] **Step 1: Write failing tests** (mock `@spend-again/parser` and the API client the way `apps/bot/__tests__/expense.test.ts` does):

```ts
it('wallet: confident parse is saved with source "wallet" and one message with Edit/Delete', ...)
it('wallet: "S$1,234.00 Apple Store" is normalised to "S$1234.00 Apple Store" before parse', ...)
it('sms: OTP text → "ignored", createTransaction and send not called', ...)
it('sms: incoming PayNow → "ignored", send not called', ...)
it('sms: UOB transfer with unknown payee → "asked", pendingConfirmations has the chat, nothing saved', ...)
it('same amount twice within 180s → both saved, second message starts with the ⚠️ line', ...)
it('same amount 181s apart → no ⚠️ line', ...)
it('pending confirmation already present → not overwritten, MSG_AUTOLOG_FAILED sent, "failed"', ...)
it('parser returns null → MSG_AUTOLOG_FAILED, "failed"', ...)
it('GeminiRateLimitError → MSG_AUTOLOG_FAILED, "failed"', ...)
it('createTransaction returns null → MSG_AUTOLOG_FAILED, "failed"', ...)
it('send throws after save → outcome still "saved"', ...)
it('date defaults to today DD/MM/YYYY when the parse has none', ...)
it('uses makeClient(token), never apiClient.setToken', ...)
```

- [ ] **Step 2:** `pnpm --filter @spend-again/bot test -- ingest` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Bot tests → PASS.
- [ ] **Step 5:** Commit `feat(bot): process auto-captured payments`.

### Task 4: `/ingest` HTTP route on the bot service

**Files:**
- Create: `apps/bot/src/server.ts`
- Modify: `apps/bot/src/index.ts`
- Test: `apps/bot/__tests__/server.test.ts`

**Interfaces:**
- Consumes: Task 3 `processIngest`, `ingestLogin`, `IngestRequest`.
- Produces:

```ts
export type ServerDeps = {
  webhook?: { secret: string; handle: (req: IncomingMessage, res: ServerResponse) => Promise<void> }
  login: (key: string) => Promise<IngestAuth | null>
  process: (auth: IngestAuth, req: IngestRequest) => Promise<IngestOutcome>
  now: () => number
}
export function createRequestHandler(deps: ServerDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>
export const INGEST_MAX_PER_HOUR = 30
export const INGEST_MAX_BODY_BYTES = 4096
export const INGEST_MAX_TEXT_CHARS = 500
```

Routing:
- `POST /ingest` → ingest.
- any other `POST` → existing webhook behaviour, byte-for-byte (secret header check, `handleUpdate`, 500 on throw). When `webhook` is undefined (dev), 404.
- anything else → existing 200 text.

Ingest responses: missing/malformed `Authorization: Bearer` → 401; body over `INGEST_MAX_BODY_BYTES` → 413; invalid JSON, `source` not `wallet|sms`, `text` empty or over `INGEST_MAX_TEXT_CHARS`, `card` not a string ≤ 60 → 400; more than `INGEST_MAX_PER_HOUR` in a sliding hour for the same key hash → 429; `login` returns null → 401; otherwise **202** `{ "ok": true }`, then `process(...)` runs un-awaited with a `.catch` that logs (no text). Rate-limit is keyed on the SHA-256 of the presented key and counted before `login`, so guessing is throttled too.

`index.ts`: build the handler once; in webhook mode pass `webhook`; in long-polling mode also `createServer(handler).listen(port)` so `/ingest` works locally. `send` is `(chatId, text, keyboard) => bot.api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : {})`.

- [ ] **Step 1: Write failing tests** (drive the handler with a real `http.createServer` on port 0 and `fetch`):

```ts
it('202 and calls process once for a valid wallet request', ...)
it('401 without Authorization; process not called', ...)
it('401 when login returns null; process not called', ...)
it('400 for source "email", for empty text, for 501-char text, for non-JSON', ...)
it('413 for a 5000-byte body', ...)
it('31st request in an hour with the same key → 429; a different key still 202', ...)
it('window slides: 31st request 3600s later → 202', ...)
it('POST / with the right secret header reaches webhook.handle; wrong secret → 403', ...)
it('process rejecting does not change the 202 or crash the server', ...)
it('GET / → 200', ...)
```

- [ ] **Step 2:** `pnpm --filter @spend-again/bot test -- server` → FAIL.
- [ ] **Step 3:** Implement `server.ts`; switch `index.ts` to it.
- [ ] **Step 4:** Bot tests → PASS. Manual: `pnpm turbo run dev`, then `curl -i -X POST localhost:3002/ingest -H 'Authorization: Bearer x' -d '{"source":"wallet","text":"8.50 Ya Kun"}'` → `401`.
- [ ] **Step 5:** Commit `feat(bot): /ingest endpoint`.

### Task 5: `/autolog` command and Delete button

**Files:**
- Create: `apps/bot/src/handlers/autolog.ts`
- Modify: `apps/bot/src/bot.ts` (register before the `message:text` catch-all), `apps/bot/src/lib/api-client.ts` (`createIngestKey`), `apps/bot/src/lib/env.ts` (`INGEST_URL`), `apps/bot/src/handlers/help.ts` (one line), `packages/shared/src/bot-messages.ts`
- Test: `apps/bot/__tests__/autolog.test.ts`

**Interfaces:**
- Consumes: Task 1 `POST /api/users/ingest-key`; Task 3 `ApiClient.deleteTransaction`, callback prefix `autolog_del:`.
- Produces:
  - `ApiClient.createIngestKey(): Promise<string | null>`
  - `autologCommandHandler(ctx: Context): Promise<void>` — `bot.command('autolog', …)`
  - `autologDeleteHandler(ctx: Context): Promise<void>` — `bot.callbackQuery(/^autolog_del:/, …)`
  - `INGEST_URL`: `process.env['INGEST_URL']`, else `WEBHOOK_URL`'s origin + `/ingest`, else `http://localhost:${PORT ?? 3002}/ingest`.
  - `MSG_AUTOLOG_SETUP(url: string, key: string): string` — states the URL and key in monospace, that the key is shown once, that running `/autolog` again replaces it, and points to `docs/auto-capture-setup.md` steps in two short lines (Transaction automation; Message automation).

Behaviour: `/autolog` requires a logged-in user (same token lookup + `MSG_NOT_REGISTERED` as `editCommandHandler`); on API failure reply with a retry message; never log the key. Delete: `answerCallbackQuery`, `deleteTransaction(id)`, then edit the message to `🗑 Deleted` with no keyboard; on failure reply `Couldn't delete leh, try /edit`.

- [ ] **Step 1: Write failing tests:**

```ts
it('/autolog replies with MSG_AUTOLOG_SETUP containing the key and INGEST_URL', ...)
it('/autolog when not registered → MSG_NOT_REGISTERED, createIngestKey not called', ...)
it('/autolog when createIngestKey returns null → retry message, no key in reply', ...)
it('autolog_del:<id> deletes that id and edits the message to "🗑 Deleted"', ...)
it('autolog_del failure → reply, message left untouched', ...)
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and register.
- [ ] **Step 4:** Bot tests → PASS.
- [ ] **Step 5:** Commit `feat(bot): /autolog setup command and delete button`.

### Task 6: Setup guide and wrap-up

**Files:**
- Create: `docs/auto-capture-setup.md`

- [ ] **Step 1:** Write the guide: run `/autolog`; a `curl` test from the Mac using the returned URL/key (`{"source":"wallet","text":"S$8.50 Ya Kun Kaya Toast","card":"Revolut"}`) and the Telegram message to expect; the Apple Pay Transaction automation (all cards, Run Immediately, Get Contents of URL: POST, `Authorization: Bearer <key>`, JSON `source=wallet`, `text=<Amount> <Merchant>`, `card=<Card>`); the UOB Message automation (`source=sms`, `text=<Message>`); troubleshooting (401 → key replaced; no message → check Shortcuts automation history; UOB sender name; fallback to screenshot + Back Tap if no SMS arrives for Scan to Pay); `INGEST_URL` env var on Railway if the public URL differs from `WEBHOOK_URL`.
- [ ] **Step 2:** `pnpm turbo run lint && pnpm turbo run test` → all pass.
- [ ] **Step 3:** `graphify update .`
- [ ] **Step 4:** Commit `docs: auto-capture phone setup`.

## Not in this plan

- Deploying to Railway and setting `INGEST_URL` — khen's call after review.
- Final UOB pattern wording — needs one real alert text.
