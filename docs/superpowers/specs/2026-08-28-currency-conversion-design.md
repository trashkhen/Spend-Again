# Automatic Currency Conversion in Expense Parsing

**Date:** 2026-08-28
**Status:** Approved, ready for planning

## Problem

Spend Again? currently assumes every logged expense is in SGD. Amounts are
stored as `amount_cents` with no currency concept anywhere in the schema or
parser. When a user travels or spends in a foreign currency (e.g. "5.60 euro
pasta 20 aug"), that number is either mis-parsed or silently stored as if it
were SGD.

Goal: when no currency is specified, keep defaulting to SGD (unchanged
behaviour). When a currency is specified — in any word order the parser
already supports ("20 aug 5.60 euro pasta", "5.60 euro pasta 20 aug", etc.) —
automatically detect it and convert the amount to SGD before it is stored,
using a live exchange-rate API. Both free-text messages and receipt photo OCR
are in scope.

## Non-goals

- No DB schema changes. `amount_cents` remains the single stored amount, in
  SGD, exactly as today. Original currency/amount/rate are used transiently
  for the bot confirmation message only — not persisted.
- No historical/date-specific exchange rates. The rate used is always the
  rate at the time of logging ("latest"), not the rate on the transaction's
  `occurred_on` date — the free tier of the chosen provider does not support
  historical rates.
- No support for arbitrary/any ISO 4217 code in the fast regex path. Only a
  small curated set converts inline; everything else is deferred to Gemini.

## Provider

**exchangerate-api.com**, free tier. Requires a free API key (no card) —
add `EXCHANGERATE_API_KEY` to the required env vars (`packages/shared/src/env.ts`),
alongside `GEMINI_API_KEY`. The user is responsible for signing up and
setting this in Railway before the feature works end-to-end; this spec does
not create the key.

Endpoint used: `GET https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/latest/{code}`
→ `{ conversion_rates: { SGD: <rate>, ... } }`.

Free tier is capped around 1500 requests/month (~50/day). Since rates only
change once a day, an in-memory cache keyed by `` `${code}:${todayISODate}` ``
avoids repeat calls for the same currency on the same day. The cache lives in
process memory and resets on redeploy/restart — acceptable, since a reset
just means the next request re-fetches.

## Architecture

Currency handling is added entirely inside `packages/parser`, at the point
amounts are first extracted. By the time a `ParseResult` (or OCR result)
reaches `apps/bot`/`apps/api`, the amount is already final SGD cents — no
changes needed outside the parser package.

### New module: `packages/parser/src/currency.ts`

- `CURRENCY_CONVERT_MAP` — symbols/words → ISO code, for the fast Tier-1
  path: `USD` (usd), `EUR` (eur, euro, euros, €), `GBP` (gbp, pound, pounds,
  £), `JPY` (jpy, yen, ¥), `MYR` (myr, ringgit). Bare `$`/`SGD` continues to
  mean SGD as today and is not part of this map.
- `CURRENCY_HINT_WORDS` — detection-only, no conversion: baht, rupiah, won,
  yuan, rmb, dong, dirham, riyal, rupee, peso, kip. Used solely to force
  Tier-1 to bail out (see Priority Rule below); Gemini resolves the actual
  code and amount for these.
- `detectCurrency(input: string): { code: string; kind: 'convert' | 'hint'; matchedText: string } | undefined`
  — single scan combining both lists, used by Tier-1 regex parsing.
- `convertToSGD(amountCents: number, currencyCode: string): Promise<{ convertedCents: number; rate: number }>`
  — calls the provider, applies the in-memory daily cache, converts cents by
  the rate, rounds to nearest cent. Throws `CurrencyConversionError` on
  missing API key, fetch failure, non-OK response, or a missing `SGD` entry
  in `conversion_rates`.

### `packages/shared/src/errors.ts`

Add `CurrencyConversionError` (own class, not a `RateLimitError` subclass —
this is a service-unavailable condition, not a rate limit) so callers can
distinguish "FX service unavailable" from "Gemini is rate-limited." Re-export
from `packages/parser` the same way `GeminiRateLimitError`/`OcrRateLimitError`
already are.

### `packages/shared/src/env.ts`

Add `EXCHANGERATE_API_KEY` to the required env var list, same shape as the
existing `GEMINI_API_KEY` entry.

### Priority rule (Tier-1 regex, `packages/parser/src/regex.ts`)

Currency detection is a gate that runs **before** item-category lookup, and
strictly outranks it. `parseWithRegex()`'s control flow becomes:

1. Extract the amount (unchanged).
2. Run `detectCurrency()` on the remaining text.
3. **Hint match** (e.g. "baht") → return `null` immediately. Tier-1 never
   attempts the item-map lookup, so a coincidental substring match (e.g.
   "taxi" inside "50 baht taxi") can never override an unrecognized foreign
   currency. The item flows to Tier-2 (on the full raw string — no clean
   match expected) and then Tier-3 Gemini, which resolves currency and
   category together.
4. **Convert match** (e.g. "euro") → strip the matched token from the
   remaining text (so it doesn't pollute the item name), proceed with
   item-lookup and category resolution as today. The returned `ParseResult`
   carries `currency: 'EUR'` and `amount` **in the original currency's
   cents** — conversion itself is not performed inside `parseWithRegex`,
   keeping it I/O-free.
5. **No match** → SGD assumed, unchanged from today.

### Single conversion point (`packages/parser/src/index.ts`)

`parse()` gains one step: after any tier (1, 2, or 3) produces a resolved
result, if `result.currency` is set and not `'SGD'`, call `convertToSGD()`
and rewrite the result — `amount` becomes converted SGD cents;
`originalAmount`, `originalCurrency`, `exchangeRate` are set for display.
This is the only place a conversion call happens, regardless of which tier
resolved the base fields. Tier-2's existing merge logic (which already
carries `tier1.amount`/`tier1.date` through when only category comes from
the learned mapping) is extended to carry `tier1.currency` through
unchanged.

### Tier-3 (`packages/parser/src/gemini.ts`)

`buildPrompt()` gains a `"currency"` field instruction: return the ISO 4217
code if a non-SGD currency is mentioned in the input, else `null`. Gemini
already has world knowledge of currencies, so no code list needs to be
maintained here — this is what makes the "everything else falls through to
Gemini" half of the design possible without an exhaustive hardcoded list.
`parseGeminiJSON()`/`parseWithGemini()` read the field into
`ParseResult.currency`. Conversion is **not** performed inside `gemini.ts` —
Tier-3 results flow through the same single conversion point in `index.ts`
as Tier-1 results.

### Receipt OCR (`packages/parser/src/ocr.ts`)

`buildOcrPrompt()` gains a single top-level `"currency"` field — one receipt
implies one currency, unlike free text. After parsing Gemini's JSON, if
`currency` is present and not SGD/null, `convertToSGD()` is called **once**
for the whole receipt (one rate), then applied to `total` and every line
item's `amount`. `originalAmount`, `originalCurrency`, `exchangeRate` are set
on the result (top-level for `SimpleReceiptResult`/`MultiItemReceiptResult`,
and per-item `originalAmount` on each `ReceiptLineItem`) for display.

### `ParseResult` type additions (`regex.ts`)

```ts
export type ParseResult = {
  // ...existing fields unchanged...
  currency?: string        // transient — ISO code, consumed by index.ts's conversion step
  originalAmount?: number  // final — cents in the original currency, display only
  originalCurrency?: string // final — ISO code, display only
  exchangeRate?: number    // final — rate applied, display only
}
```

`originalAmount`/`originalCurrency`/`exchangeRate` are never sent to the API
— `confirm.ts` and `receipt-confirm.ts` already hand-pick specific fields
onto `CreateTransactionInput`, so these extra fields are safe to carry on the
in-memory type without a schema or API change.

## Data Flow Examples

```
"5.60 euro pasta 20 aug"
  → parseWithRegex(): amount=560 (cents, EUR), currency="EUR" (convert),
    date="20/08/2026", item="pasta"
  → SG_ITEM_MAP lookup on "pasta" → no match → category unresolved
  → parse() proceeds to Tier-2 lookup on "pasta" → no mapping either
  → Tier-3 Gemini called on original input → resolves category=Food/Restaurant
    (tier1's amount/currency/date preserved through the merge)
  → index.ts sees result.currency="EUR" → convertToSGD(560, "EUR")
      → cache miss for "EUR:2026-08-28" → fetch latest/EUR → rate=1.4384 → cached
      → convertedCents = round(560 * 1.4384) = 805
  → final ParseResult: amount=805, originalAmount=560, originalCurrency="EUR",
    exchangeRate=1.4384
  → expense.ts confirmation: "€5.60 → S$8.05 (1 EUR = 1.4384 SGD)"
  → confirm.ts: txInput.amountCents = result.amount (805, SGD) — unchanged today
```

```
"50 baht taxi"
  → parseWithRegex(): detectCurrency finds "baht" → kind="hint" → returns null
  → parse(): tier1 is null, itemToLookup = input = "50 baht taxi"
  → Tier-2 lookup on full string → no mapping match
  → Tier-3 Gemini on "50 baht taxi" → amount=50, currency="THB",
    category=Transport, item="Taxi"
  → index.ts converts 5000 cents THB → SGD via convertToSGD(5000, "THB")
  → final result shown/stored correctly
```

`"20 aug 5.60 euro pasta"` (reordered) follows the same path as the first
example — `extractDate()`/`detectCurrency()`/amount extraction are already
position-independent scans over the whole input, so word order does not
require special-casing.

Receipt OCR follows the same shape: `parseReceiptWithOcr()` returns raw
amounts + one `currency` field; conversion is applied once (same rate) to
`total` and each line item before the result reaches
`receipt.ts`/`receipt-confirm.ts`.

## Error Handling

- `EXCHANGERATE_API_KEY` missing → `convertToSGD()` throws immediately, same
  pattern as the existing `GEMINI_API_KEY` check in `gemini.ts`/`ocr.ts`.
  This is a config error, not a per-request one.
- Fetch fails, non-OK response, or `conversion_rates.SGD` missing →
  `CurrencyConversionError`.
- `apps/bot/src/handlers/expense.ts` and `apps/bot/src/handlers/receipt.ts`
  catch `CurrencyConversionError` alongside the existing
  `GeminiRateLimitError`/`OcrRateLimitError` catches, and reply with a new
  `MSG_CURRENCY_UNAVAILABLE` message (`packages/shared/src/bot-messages.ts`).
  The transaction is **not** saved — never silently store a wrong SGD amount.
- An unsupported/hallucinated ISO code from Gemini surfaces as a non-OK
  response from the provider, which is caught by the same
  `CurrencyConversionError` path — no separate code-validation list is
  needed; the provider is the source of truth for what it supports.

## Testing

- `currency.test.ts` (new): `detectCurrency()` against every convert-list and
  hint-list entry, plus negative cases (plain item words must not
  false-positive). `convertToSGD()` with mocked `fetch`: success, cache-hit
  skips fetch, non-OK response, missing `SGD` rate, missing API key.
- `regex.test.ts`: add cases for `"5.60 euro pasta 20 aug"`,
  `"20 aug 5.60 euro pasta"`, hint-word bailout (`"50 baht taxi"` →
  `parseWithRegex` returns `null`), and confirm bare `"$10 lunch"` still
  defaults to SGD.
- `gemini.test.ts`: prompt includes the currency instruction;
  `parseGeminiJSON` reads a `currency` field correctly and defaults to
  `undefined`/SGD when absent or `null`.
- `index.test.ts`: `parse()` integration — mock `convertToSGD`, verify it is
  called exactly once with the right args regardless of which tier resolved
  the result, and that `originalAmount`/`originalCurrency`/`exchangeRate`
  land on the final result.
- `ocr.test.ts`: receipt-level currency conversion applied uniformly to
  `total` and every line item.

## Open Items for Implementation

- Exact wording of `MSG_CURRENCY_UNAVAILABLE` and the confirmation-message
  conversion note format (`bot-messages.ts`) — follow existing message
  style in that file.
- `formatMultiReceipt()` in `receipt.ts` needs a currency-note line added
  (once per receipt, not per item) when `originalCurrency` is set.
