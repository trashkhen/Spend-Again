# Auto-capture: Apple Pay and UOB SMS — Design

Date: 13/11/2026

## Intent

Logging an expense still means opening Telegram and typing. That friction is
enough that expenses get skipped. Payments should log themselves at the moment
they happen, and Telegram becomes the place to *correct* an entry, not create
one.

## Goals

- An Apple Pay tap is logged with zero taps.
- A UOB Scan to Pay / PayNow payment is logged with zero taps, via UOB's SMS
  alert (the user has turned on SMS alerts for online fund transfers).
- Every auto-logged expense produces one Telegram message so mistakes are
  visible and fixable in one tap.
- A captured payment is never lost silently and never double-counted silently.

## Non-goals

- Reading Revolut or UOB push notifications (iOS does not allow it).
- A bank feed / Open Banking connection.
- Capturing cash, or online checkouts that bypass both Apple Pay and UOB SMS.
  These stay manual via the bot.
- Android support.
- A dashboard screen for managing capture keys (bot command only for now).

## Anti-goals

- Logging incoming money, OTP texts, or marketing texts as expenses.
- A capture key that, if leaked, exposes anything beyond "add an expense".
- Storing raw SMS bodies in the database or logs.

## Constraints

- iPhone only gives us two triggers: the Shortcuts **Transaction** automation
  (Wallet tap: merchant, amount, card) and the **Message** automation (SMS from
  a sender / containing text). Both can be set to run without confirmation.
- Parsing and Telegram both live in the bot service (`apps/bot`); the API
  (`apps/api`) is plain storage behind a 15-minute-style login token. The bot
  already runs an HTTP server for the Telegram webhook.
- Migrations go through Supabase MCP `apply_migration`, after verifying the
  current schema.
- SGD, integer cents, DD/MM/YYYY, no `any`.
- Gemini free-tier call cap already exists and must be respected.

## Approaches considered

1. **Shortcuts → bot service ingest endpoint (chosen).** Both automations POST
   a line of text plus a personal capture key to the bot service. The bot
   parses it with the existing parser, saves through the existing API client,
   and sends the Telegram message. Reuses everything; one new column.
2. **Shortcuts → API endpoint.** Cleaner on paper, but the API has neither the
   parser/Gemini wiring nor the bot token, so it would duplicate both or call
   back into the bot.
3. **Shortcuts → Telegram message as the user.** Not possible: Shortcuts cannot
   send a Telegram message into a bot chat without opening the app.
4. **Screenshot + Back Tap → receipt reader.** Works without SMS, but costs a
   gesture per payment. Kept as the fallback if UOB's SMS turns out not to
   fire for Scan to Pay.

Chosen: 1, picked by khen (Apple Pay via Shortcuts, UOB via SMS).

## Design

### Capture key

- New bot command `/autolog`. It mints a random 32-byte key, shows it once
  with setup steps, and replaces any previous key (that is also how you
  revoke).
- `users.ingest_key_hash` (text, nullable, unique): SHA-256 of the key. The
  key itself is never stored.
- New API route `POST /api/auth/ingest-login` `{ key }` → the same response as
  `telegram-login` (token + userId + telegramId). Rate-limited like the other
  auth routes; constant-time compare on the hash lookup result.
- New API route `POST /api/users/ingest-key` (authenticated) → generates and
  returns the key; called by `/autolog`.

### Ingest endpoint (bot service)

`POST /ingest` on the bot's existing HTTP server.

```
Authorization: Bearer <capture key>
{ "source": "wallet" | "sms", "text": "<=500 chars", "card": "optional" }
```

- The Telegram webhook moves to an explicit path check so the two POST routes
  don't collide; the webhook's secret-header check is unchanged.
- Responds 202 immediately after auth + validation, then works in the
  background (same reason the webhook acks early).
- Per-key limit: 30 requests / hour.
- In development (long-polling mode) the same handler is served on `PORT` so it
  can be tested locally.

### Processing

1. Exchange key for a login token via `ingest-login`; get the Telegram chat id.
2. Build the text to parse:
   - `wallet`: the shortcut sends `"<amount> <merchant>"`; goes through the
     normal `parse()`.
   - `sms`: goes through `parseSMS` first. Add a UOB pattern set to
     `packages/parser/src/sms.ts`. If no pattern matches, fall back to Gemini
     with an instruction to return "not an expense" for incoming funds, OTPs
     and promotions.
3. Not an expense → drop, no message.
4. Duplicate check: same user, same amount, created in the last 3 minutes by
   an auto-capture → still save, but flag it in the message.
5. Category confident (regex / learned mapping / SG map hit, or Gemini above
   the existing confidence bar) → **save immediately**, `source: 'sms'` for
   SMS and a new `source: 'wallet'` for Apple Pay. Respect the active Space
   the same way the bot does today.
6. Not confident (typical for PayNow to a person or hawker with no usable
   name) → don't save; send the normal confirm prompt with the amount filled
   in, so a one-line reply ("chicken rice") completes it. Reuses
   `pendingConfirmations`.
7. Parse or save fails → Telegram message "Couldn't log a payment of $X —
   send it manually", so nothing vanishes.

### Telegram message

```
⚡ Auto-logged  $8.50  Ya Kun Kaya Toast
Food / Cafe · Apple Pay · 13/11/2026
[ ✏️ Edit ]  [ 🗑 Delete ]
```

Duplicate variant adds a first line: `⚠️ Same amount as an entry 1 min ago`.
Edit opens the existing edit flow for that transaction id; Delete removes it.
Category corrections feed learned mappings as they do today, so repeat
merchants get it right next time.

### On the phone (documented in `docs/auto-capture-setup.md`)

- **Apple Pay:** Shortcuts → Automation → Transaction → all cards → Run
  Immediately → "Get Contents of URL" POST with merchant + amount.
- **UOB:** Shortcuts → Automation → Message → sender contains "UOB" → Run
  Immediately → POST the message body.

## Calls made by Claude (not decided by khen)

- Auto-save when confident, ask when not, rather than confirming every time.
- Key managed by a bot command, one key per user.
- Same-amount-within-3-minutes is flagged, not blocked.
- New `wallet` value for `source`.
- Endpoint lives on the bot service, not the API.

## Open until first real payment

- Exact wording of UOB's SMS, and whether Scan to Pay counts as an "online
  fund transfer" for alert purposes. The UOB pattern is written against a
  real sample; until then the Gemini fallback handles it. If no SMS arrives
  at all, switch UOB to approach 4.
- Whether a UOB card in Apple Pay produces both a Wallet trigger and an SMS.
  The duplicate flag covers it; tighten to auto-skip once seen.

## Left to the builder

- Route/file layout, test structure, exact message copy, key format.
- Whether `ingest-login` shares code with `telegram-login`.

## Amendments after the branch review (13/11/2026)

UOB / SMS is paused; only Apple Pay (`source: wallet`) is built.

- **Key exchange is bot-only.** `POST /api/auth/ingest-login` now also requires
  an HMAC made with the bot token over `<key>\n<ts>` (5-minute window). A leaked
  key alone can add expenses through `/ingest` and nothing else.
- **No "ask" path.** A payment whose category is unknown is saved under
  Other / Other and flagged in the message, instead of opening the shared
  confirm prompt (which a typed expense could overwrite, never expired, and
  skipped Spaces). Supersedes steps 5–6 of *Processing*.
- **Amount, merchant and date are never taken from the free-text parser.** The
  first token is the amount (with its currency marker), the rest is the
  merchant, the date is today. The built-in map, learned mappings and Gemini
  supply only the category.
- **Foreign currency** is converted to SGD with the existing rate lookup;
  unknown markers and failed lookups are reported, not guessed.
- **Edit teaches.** Editing an auto-logged entry saves a learned mapping under
  the merchant name Apple Pay reported.
- **Throttling.** Malformed keys are rejected without a lookup; verified keys
  are cached for 5 minutes (so a replaced key lingers up to 5 minutes); all
  unverified keys share 120 checks an hour; an unreachable API answers 503.
- `/autolog` answers only in private chats and, like Delete, uses its own API
  client rather than the shared one.
