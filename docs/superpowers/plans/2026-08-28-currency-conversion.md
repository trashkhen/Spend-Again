# Automatic Currency Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect foreign currencies in free-text expense messages and receipt OCR, and automatically convert them to SGD before storage, while SGD (or unspecified currency) continues to work exactly as today.

**Architecture:** All new logic lives inside `packages/parser`. A new `currency.ts` module owns detection (a small Tier-1 regex fast path + a broader "hint" list that forces fallthrough to Gemini) and conversion (a cached call to exchangerate-api.com). `index.ts`'s `parse()` orchestrator is the single point where conversion is applied, regardless of which tier resolved the result, so `apps/bot`/`apps/api` never need to know a conversion happened — they just receive final SGD cents plus optional display-only fields.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest, `@spend-again/shared` (error classes, formatting, bot messages), exchangerate-api.com free tier (`GET /v6/{key}/latest/{code}`), global `fetch` (Node 22, no extra typings needed — already used unmocked in `apps/bot/src/handlers/receipt.ts`).

## Global Constraints

- Reference spec: `docs/superpowers/specs/2026-08-28-currency-conversion-design.md` — read it before starting if anything below is ambiguous.
- No DB schema changes. `amount_cents` stays the only stored amount, always SGD. Original currency/amount/rate are transient, display-only fields on in-memory types — never sent to the API (confirmed safe: `apps/bot/src/handlers/confirm.ts` and `receipt-confirm.ts` already hand-pick specific fields onto `CreateTransactionInput`).
- Tier-1 (regex) convert list: `USD` (usd), `EUR` (eur, euro, euros, €), `GBP` (gbp, pound, pounds, £), `JPY` (jpy, yen, ¥), `MYR` (myr, ringgit). Bare `$`/`SGD` still means SGD, unchanged.
- Tier-1 hint list (detection-only, forces fallthrough, never converts itself): baht, rupiah, won, yuan, rmb, dong, dirham, riyal, rupee, peso, kip.
- Priority rule: currency detection outranks item-category resolution. A hint-list match makes `parseWithRegex()` return `null` immediately, even if the remaining text would otherwise resolve via `SG_ITEM_MAP`.
- Rate used is always "latest" (today's rate), never historical/date-specific — the free tier doesn't support historical rates.
- On any conversion failure (missing key, network error, non-OK response, missing SGD rate), throw `CurrencyConversionError` and never save the transaction with an unconverted or wrong amount.
- Cache exchange rates in-memory, keyed by `` `${code}:${todayISODate}` ``, to respect the free tier's ~1500 req/month cap.
- `EXCHANGERATE_API_KEY` is a new required env var (bot process), read via `process.env['EXCHANGERATE_API_KEY']` — same pattern as the existing `GEMINI_API_KEY` checks in `gemini.ts`/`ocr.ts`, not via `requireEnv()`.
- Follow existing code style exactly: `noPropertyAccessFromIndexSignature` means bracket access on `Record<string, T>`; `exactOptionalPropertyTypes` means optional fields are added via conditional spread (`...(x !== undefined ? { x } : {})`) or plain assignment, never `{ x: undefined }`.

---

### Task 1: Shared foundation — error class, formatting, message, env docs

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/format.ts`
- Modify: `packages/shared/src/bot-messages.ts`
- Modify: `.env.example`
- Modify: `README.md:126-136`
- Test: `packages/shared/__tests__/format.test.ts`

**Interfaces:**
- Produces: `CurrencyConversionError` (class, extends `AppError`, `code: 'CURRENCY_CONVERSION_ERROR'`, `statusCode: 503`), `fmtCurrency(cents: number, code: string): string`, `MSG_CURRENCY_UNAVAILABLE: string`. All re-exported from `@spend-again/shared`'s barrel (`export *` in `index.ts` — no change needed there).

- [ ] **Step 1: Write the failing test for `fmtCurrency`**

Add to `packages/shared/__tests__/format.test.ts` (append after the existing `fmtSGD` describe block):

```ts
describe('fmtCurrency', () => {
  it('formats known currencies with their symbol', () => {
    expect(fmtCurrency(560, 'EUR')).toBe('€5.60')
    expect(fmtCurrency(1000, 'USD')).toBe('$10.00')
    expect(fmtCurrency(500, 'GBP')).toBe('£5.00')
    expect(fmtCurrency(10000, 'JPY')).toBe('¥100.00')
    expect(fmtCurrency(2500, 'MYR')).toBe('RM25.00')
  })

  it('falls back to "CODE amount" for currencies with no known symbol', () => {
    expect(fmtCurrency(5000, 'AED')).toBe('AED 50.00')
  })
})
```

Also update the import line at the top of the file to include `fmtCurrency`:

```ts
import { parseCents, centsToDecimalString, amountToCents, fmtSGD, fmtCurrency } from '../src/format.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spend-again/shared test -- format.test.ts`
Expected: FAIL — `fmtCurrency` is not exported from `../src/format.js`.

- [ ] **Step 3: Implement `fmtCurrency` in `packages/shared/src/format.ts`**

Append to the end of the file (after the existing `fmtSGD` function):

```ts
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  MYR: 'RM',
  THB: '฿',
  IDR: 'Rp',
  KRW: '₩',
  CNY: '¥',
  RMB: '¥',
  VND: '₫',
  INR: '₹',
  PHP: '₱',
}

/**
 * Format cents in a foreign currency for display, e.g. fmtCurrency(560, 'EUR') → "€5.60".
 * Falls back to "CODE amount" (e.g. "AED 50.00") when no symbol is known for the code.
 */
export function fmtCurrency(cents: number, code: string): string {
  const symbol = CURRENCY_SYMBOLS[code]
  const decimal = centsToDecimalString(cents)
  return symbol !== undefined ? `${symbol}${decimal}` : `${code} ${decimal}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spend-again/shared test -- format.test.ts`
Expected: PASS (all `fmtCurrency` and existing `fmtSGD`/`parseCents`/etc. tests green).

- [ ] **Step 5: Add `CurrencyConversionError` to `packages/shared/src/errors.ts`**

Insert after the `OcrRateLimitError` class (after line 96, before the "Type guard helpers" section):

```ts
// ---------------------------------------------------------------------------
// Currency conversion errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the currency exchange-rate service is unavailable or returns
 * an unusable response (missing API key, network failure, non-OK response,
 * or no SGD rate in the payload). Not a RateLimitError subclass — this is a
 * service-unavailable condition, not specifically a rate limit, even though
 * the underlying cause is sometimes the free tier's request quota.
 */
export class CurrencyConversionError extends AppError {
  constructor(message = 'Currency conversion unavailable') {
    super(message, 'CURRENCY_CONVERSION_ERROR', 503)
    this.name = 'CurrencyConversionError'
  }
}
```

- [ ] **Step 6: Add `MSG_CURRENCY_UNAVAILABLE` to `packages/shared/src/bot-messages.ts`**

Insert after `MSG_PARSE_FAILED` (after line 81, before `MSG_CONFIRM_PROMPT`):

```ts
export const MSG_CURRENCY_UNAVAILABLE =
  `Aiyah, cannot fetch the exchange rate right now leh \u{1F615}\n` +
  `Give it a few minutes and try again lor.`
```

- [ ] **Step 7: Document the new env var in `.env.example`**

Insert after the `GEMINI_API_KEY` block (after line 11, before the `── Telegram Bot ──` section):

```
# ── Currency Conversion ─────────────────────────────────────────────────────
# Required (bot/parser — converts foreign-currency expenses to SGD). Free-tier
# key from https://www.exchangerate-api.com/ (sign up, no card required).
EXCHANGERATE_API_KEY=your-exchangerate-api-key-here
```

- [ ] **Step 8: Document the new env var in `README.md`**

In the table at `README.md:126-136`, insert a new row after the `GEMINI_API_KEY` row:

```
| `EXCHANGERATE_API_KEY` | Parser (bot) | exchangerate-api.com free-tier key, used to convert foreign-currency expenses to SGD. |
```

- [ ] **Step 9: Type-check and lint the shared package**

Run: `pnpm --filter @spend-again/shared type-check && pnpm --filter @spend-again/shared lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/errors.ts packages/shared/src/format.ts packages/shared/src/bot-messages.ts packages/shared/__tests__/format.test.ts .env.example README.md
git commit -m "feat(shared): add CurrencyConversionError, fmtCurrency, and currency-unavailable message"
```

---

### Task 2: Currency detection + conversion module

**Files:**
- Create: `packages/parser/src/currency.ts`
- Test: `packages/parser/__tests__/currency.test.ts`

**Interfaces:**
- Consumes: `CurrencyConversionError` from `@spend-again/shared` (Task 1).
- Produces: `detectCurrency(input: string): CurrencyDetection | undefined` where `CurrencyDetection = { kind: 'convert'; code: string; matchedText: string; pattern: RegExp } | { kind: 'hint'; matchedText: string; pattern: RegExp }`; `convertToSGD(amountCents: number, currencyCode: string): Promise<{ convertedCents: number; rate: number }>`; `clearCurrencyRateCache(): void` (test-only). Consumed by Tasks 3, 4, 5, 6.

- [ ] **Step 1: Write the failing tests**

Create `packages/parser/__tests__/currency.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrencyConversionError } from '@spend-again/shared'
import { detectCurrency, convertToSGD, clearCurrencyRateCache } from '../src/currency.js'

describe('detectCurrency', () => {
  it('detects convert-list words case-insensitively', () => {
    expect(detectCurrency('5.60 euro pasta')).toMatchObject({ kind: 'convert', code: 'EUR' })
    expect(detectCurrency('5.60 EURO pasta')).toMatchObject({ kind: 'convert', code: 'EUR' })
    expect(detectCurrency('100 yen snack')).toMatchObject({ kind: 'convert', code: 'JPY' })
    expect(detectCurrency('20 ringgit teh tarik')).toMatchObject({ kind: 'convert', code: 'MYR' })
    expect(detectCurrency('10 pounds fish and chips')).toMatchObject({ kind: 'convert', code: 'GBP' })
    expect(detectCurrency('15 usd burger')).toMatchObject({ kind: 'convert', code: 'USD' })
  })

  it('detects convert-list symbols', () => {
    expect(detectCurrency('€5.60 pasta')).toMatchObject({ kind: 'convert', code: 'EUR' })
    expect(detectCurrency('£10 fish and chips')).toMatchObject({ kind: 'convert', code: 'GBP' })
    expect(detectCurrency('¥100 snack')).toMatchObject({ kind: 'convert', code: 'JPY' })
  })

  it('detects hint-list words without resolving a code', () => {
    expect(detectCurrency('50 baht grab')).toMatchObject({ kind: 'hint' })
    expect(detectCurrency('1000 won kimchi')).toMatchObject({ kind: 'hint' })
    expect(detectCurrency('30 dirham shawarma')).toMatchObject({ kind: 'hint' })
  })

  it('does not false-positive on "wonton" (no word boundary around the hint word)', () => {
    expect(detectCurrency('$5 wonton mee')).toBeUndefined()
  })

  it('returns undefined when no currency indicator is present', () => {
    expect(detectCurrency('5.60 chicken rice yesterday')).toBeUndefined()
    expect(detectCurrency('$10 lunch')).toBeUndefined()
    expect(detectCurrency('SGD 25 grab')).toBeUndefined()
  })
})

describe('convertToSGD', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch
    process.env['EXCHANGERATE_API_KEY'] = 'test-fx-key'
    clearCurrencyRateCache()
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  function okResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: () => Promise.resolve(body) }
  }

  it('converts using the fetched SGD rate and rounds to the nearest cent', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ result: 'success', conversion_rates: { SGD: 1.4384 } }),
    )

    const result = await convertToSGD(560, 'EUR')

    expect(result.rate).toBe(1.4384)
    expect(result.convertedCents).toBe(Math.round(560 * 1.4384))
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch).toHaveBeenCalledWith('https://v6.exchangerate-api.com/v6/test-fx-key/latest/EUR')
  })

  it('caches the rate for the same currency and day — second call does not re-fetch', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ result: 'success', conversion_rates: { SGD: 1.4384 } }),
    )

    await convertToSGD(560, 'EUR')
    const second = await convertToSGD(1000, 'EUR')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(second.rate).toBe(1.4384)
    expect(second.convertedCents).toBe(Math.round(1000 * 1.4384))
  })

  it('does not share the cache across different currencies', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse({ result: 'success', conversion_rates: { SGD: 1.4384 } }))
      .mockResolvedValueOnce(okResponse({ result: 'success', conversion_rates: { SGD: 0.0091 } }))

    const eur = await convertToSGD(560, 'EUR')
    const jpy = await convertToSGD(10000, 'JPY')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(eur.rate).toBe(1.4384)
    expect(jpy.rate).toBe(0.0091)
  })

  it('throws CurrencyConversionError when EXCHANGERATE_API_KEY is not set', async () => {
    delete process.env['EXCHANGERATE_API_KEY']

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws CurrencyConversionError when fetch rejects (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
  })

  it('throws CurrencyConversionError on a non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
  })

  it('throws CurrencyConversionError when the API reports a non-success result', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ result: 'error', 'error-type': 'unsupported-code' }))

    await expect(convertToSGD(560, 'XYZ')).rejects.toThrow(CurrencyConversionError)
  })

  it('throws CurrencyConversionError when conversion_rates has no SGD entry', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ result: 'success', conversion_rates: { USD: 1.09 } }))

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spend-again/parser test -- currency.test.ts`
Expected: FAIL — `../src/currency.js` does not exist.

- [ ] **Step 3: Implement `packages/parser/src/currency.ts`**

```ts
import { CurrencyConversionError } from '@spend-again/shared'

// ---------------------------------------------------------------------------
// Currency detection
// ---------------------------------------------------------------------------

/**
 * Small Tier-1 fast path: symbols/words that resolve to an ISO 4217 code
 * inline, no Gemini call needed. Deliberately kept small — everything else
 * falls through to Gemini (Tier-3), which already has world knowledge of
 * currencies and needs no list maintained here.
 */
const CURRENCY_CONVERT_MAP: Record<string, string> = {
  usd: 'USD',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  '€': 'EUR',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  '£': 'GBP',
  jpy: 'JPY',
  yen: 'JPY',
  '¥': 'JPY',
  myr: 'MYR',
  ringgit: 'MYR',
}

/**
 * Detection-only — these words signal a foreign currency Tier-1 does not
 * try to convert. Matching one forces parseWithRegex() to bail out (return
 * null) so the item falls through to Tier-2/Tier-3, per the priority rule:
 * currency-non-match outranks item-category convenience.
 */
const CURRENCY_HINT_WORDS = [
  'baht',
  'rupiah',
  'won',
  'yuan',
  'rmb',
  'dong',
  'dirham',
  'riyal',
  'rupee',
  'peso',
  'kip',
]

export type CurrencyDetection =
  | { kind: 'convert'; code: string; matchedText: string; pattern: RegExp }
  | { kind: 'hint'; matchedText: string; pattern: RegExp }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Symbols (non-alphanumeric tokens) match anywhere; words match on a whole-word boundary. */
function buildPattern(token: string): RegExp {
  const isSymbol = /[^a-z0-9]/i.test(token)
  return isSymbol ? new RegExp(escapeRegExp(token), 'i') : new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i')
}

// Longest tokens first so e.g. "euros" is matched as a whole before shorter overlapping keys.
const CONVERT_KEYS = Object.keys(CURRENCY_CONVERT_MAP).sort((a, b) => b.length - a.length)
const HINT_KEYS = [...CURRENCY_HINT_WORDS].sort((a, b) => b.length - a.length)

/**
 * Scan free text for a currency indicator. Convert-list matches resolve to
 * an ISO code inline; hint-list matches signal "foreign, unknown rate" for
 * the caller to route elsewhere. Returns undefined when no indicator is
 * found (SGD assumed).
 */
export function detectCurrency(input: string): CurrencyDetection | undefined {
  for (const key of CONVERT_KEYS) {
    const pattern = buildPattern(key)
    const match = pattern.exec(input)
    if (match !== null) {
      const code = CURRENCY_CONVERT_MAP[key]
      if (code !== undefined) {
        return { kind: 'convert', code, matchedText: match[0], pattern }
      }
    }
  }

  for (const word of HINT_KEYS) {
    const pattern = buildPattern(word)
    const match = pattern.exec(input)
    if (match !== null) {
      return { kind: 'hint', matchedText: match[0], pattern }
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Conversion — exchangerate-api.com free tier, cached per (currency, day)
// ---------------------------------------------------------------------------

type ExchangeRateApiResponse = {
  result: string
  conversion_rates?: Record<string, number>
}

type CachedRate = { rate: number; fetchedAt: number }

const _rateCache = new Map<string, CachedRate>()

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

function cacheKey(currencyCode: string): string {
  return `${currencyCode}:${todayISODate()}`
}

async function fetchSGDRate(currencyCode: string): Promise<number> {
  const apiKey = process.env['EXCHANGERATE_API_KEY']
  if (apiKey === undefined || apiKey === '') {
    throw new CurrencyConversionError('EXCHANGERATE_API_KEY environment variable is not set')
  }

  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${currencyCode}`

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new CurrencyConversionError(`Failed to reach exchange rate service: ${message}`)
  }

  if (!response.ok) {
    throw new CurrencyConversionError(
      `Exchange rate service returned HTTP ${response.status} for ${currencyCode}`,
    )
  }

  const body = (await response.json()) as ExchangeRateApiResponse
  if (body.result !== 'success' || body.conversion_rates === undefined) {
    throw new CurrencyConversionError(`Exchange rate service could not resolve rates for ${currencyCode}`)
  }

  const rate = body.conversion_rates['SGD']
  if (rate === undefined) {
    throw new CurrencyConversionError(`No SGD rate returned for ${currencyCode}`)
  }

  return rate
}

async function getSGDRate(currencyCode: string): Promise<number> {
  const key = cacheKey(currencyCode)
  const cached = _rateCache.get(key)
  if (cached !== undefined) {
    return cached.rate
  }

  const rate = await fetchSGDRate(currencyCode)
  _rateCache.set(key, { rate, fetchedAt: Date.now() })
  return rate
}

/** Convert an amount in `currencyCode` cents to SGD cents using today's cached rate. */
export async function convertToSGD(
  amountCents: number,
  currencyCode: string,
): Promise<{ convertedCents: number; rate: number }> {
  const rate = await getSGDRate(currencyCode)
  const convertedCents = Math.round(amountCents * rate)
  return { convertedCents, rate }
}

/** Clear the in-memory rate cache. Test-only — production never needs to clear it manually. */
export function clearCurrencyRateCache(): void {
  _rateCache.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/parser test -- currency.test.ts`
Expected: PASS (all `detectCurrency` and `convertToSGD` tests green).

- [ ] **Step 5: Type-check and lint**

Run: `pnpm --filter @spend-again/parser type-check && pnpm --filter @spend-again/parser lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/currency.ts packages/parser/__tests__/currency.test.ts
git commit -m "feat(parser): add currency detection and SGD conversion module"
```

---

### Task 3: Wire currency detection into Tier-1 regex + fix date/amount ordering

**Files:**
- Modify: `packages/parser/src/regex.ts`
- Test: `packages/parser/__tests__/regex.test.ts`

**Interfaces:**
- Consumes: `detectCurrency` from `./currency.js` (Task 2).
- Produces: `ParseResult` gains `currency?: string`, `originalAmount?: number`, `originalCurrency?: string`, `exchangeRate?: number`. `parseWithRegex()` now sets `currency` on convert-list matches and returns `null` on hint-list matches, before ever attempting `SG_ITEM_MAP` lookup. Consumed by Tasks 4, 5, 6, 7.

Before writing code, note the bug this task also fixes: `BARE_AMOUNT_REGEX` (`/^(\d+(?:\.\d{1,2})?)(?:\s|$)/`) is anchored to the start of the string. For input like `"20 aug 5.60 euro pasta"`, running amount-extraction before date-extraction (today's order) makes it grab `"20"` (part of the date phrase) as the amount — silently wrong, independent of currency. The fix is to extract and strip the date **first**, then run amount extraction on what's left. Verified this does not change behavior for any existing test (all existing date-related tests use `$`/`SGD`-prefixed amounts, which `AMOUNT_REGEX` finds anywhere in the string regardless of extraction order — only the bare-amount fallback was order-sensitive).

- [ ] **Step 1: Write the failing tests**

Add to `packages/parser/__tests__/regex.test.ts`, as a new section before the final closing `})` of the `describe('parseWithRegex', ...)` block:

```ts
  // -------------------------------------------------------------------------
  // Currency detection (Tier-1 convert list)
  // -------------------------------------------------------------------------

  it('detects a convert-list currency and strips it from the item, amount-then-currency order', () => {
    const result = parseWithRegex('5.60 euro pasta 20 aug')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(560)
    expect(result?.currency).toBe('EUR')
    expect(result?.item).toBe('pasta')
    expect(result?.date).toMatch(/^20\/08\/\d{4}$/)
  })

  it('detects a convert-list currency with date-then-amount word order', () => {
    const result = parseWithRegex('20 aug 5.60 euro pasta')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(560)
    expect(result?.currency).toBe('EUR')
    expect(result?.item).toBe('pasta')
    expect(result?.date).toMatch(/^20\/08\/\d{4}$/)
  })

  it('does not set currency for bare $ amounts (defaults to SGD)', () => {
    const result = parseWithRegex('$10 lunch')
    expect(result).not.toBeNull()
    expect(result?.currency).toBeUndefined()
  })

  it('does not set currency for explicit SGD amounts', () => {
    const result = parseWithRegex('SGD 25 grab')
    expect(result).not.toBeNull()
    expect(result?.currency).toBeUndefined()
  })

  it('detects JPY via the yen symbol', () => {
    const result = parseWithRegex('¥500 sushi')
    expect(result).not.toBeNull()
    expect(result?.currency).toBe('JPY')
  })

  // -------------------------------------------------------------------------
  // Currency priority rule: hint-list words force Tier-1 to bail out,
  // even when the remaining item text would otherwise resolve via
  // SG_ITEM_MAP (e.g. "grab" → Transport/Grab).
  // -------------------------------------------------------------------------

  it('returns null for a hint-list currency, even when the item text would otherwise resolve', () => {
    const result = parseWithRegex('50 baht grab')
    expect(result).toBeNull()
  })

  it('returns null for other hint-list currencies', () => {
    expect(parseWithRegex('1000 won kimchi')).toBeNull()
    expect(parseWithRegex('30 dirham shawarma')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Date/amount ordering regression guard
  // -------------------------------------------------------------------------

  it('does not mistake a leading date-phrase number for the amount', () => {
    const result = parseWithRegex('20 aug 8 chicken rice')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(800)
    expect(result?.date).toMatch(/^20\/08\/\d{4}$/)
    expect(result?.item).toBe('chicken rice')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spend-again/parser test -- regex.test.ts`
Expected: FAIL — `currency` is `undefined` where tests expect `'EUR'`/`'JPY'`, hint-word tests return a non-null result, and the date/amount-ordering test gets `amount: 2000` instead of `800`.

- [ ] **Step 3: Rewrite `parseWithRegex()` in `packages/parser/src/regex.ts`**

First, add the import at the top of the file (after the existing `@spend-again/shared` import):

```ts
import { SG_ITEM_MAP, getTodayDDMMYYYY, getYesterdayDDMMYYYY, parseCents } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import { detectCurrency } from './currency.js'
```

Update the `ParseResult` type:

```ts
export type ParseResult = {
  amount: number // integer cents
  item: string
  description?: string // original input minus price, set by caller
  category?: Category
  subCategory?: SubCategory
  date?: string // DD/MM/YYYY
  confidence: number // 0–1
  tier: 1 | 2 | 3
  currency?: string // ISO 4217 code, set by Tier-1/Tier-3 when a non-SGD currency is detected; consumed and cleared by parse()'s conversion step
  originalAmount?: number // integer cents in originalCurrency — set only after conversion, display only, never sent to the API
  originalCurrency?: string // ISO 4217 code — display only
  exchangeRate?: number // 1 originalCurrency = exchangeRate SGD — display only
}
```

Add a helper function near `naturalDateToDDMMYYYY` (after it, before `extractDate`):

```ts
function stripDateTokens(text: string): string {
  return text
    .replace(DATE_REGEX, '')
    .replace(YESTERDAY_REGEX, '')
    .replace(TODAY_REGEX, '')
    .replace(DAY_MONTH_REGEX, '')
    .replace(MONTH_DAY_REGEX, '')
    .trim()
}
```

Replace the entire `parseWithRegex` function with:

```ts
export function parseWithRegex(input: string): ParseResult | null {
  if (input.trim().length === 0) {
    return null
  }

  const trimmedInput = input.trim()

  // Extract the date FIRST and strip it from the working text. This must
  // happen before amount extraction: the bare-amount fallback below is
  // anchored to the start of the string, so if a date phrase like "20 aug"
  // precedes a bare (no currency-symbol) amount, extracting the amount
  // first would incorrectly grab the date's day number instead.
  const date = extractDate(trimmedInput)
  let remainingText = date !== undefined ? stripDateTokens(trimmedInput) : trimmedInput

  let amountCents: number | null = null

  // Try currency-prefixed / suffixed amount first
  const prefixMatch = AMOUNT_REGEX.exec(remainingText)
  if (prefixMatch !== null) {
    // Group 1 = prefix form ($10, S$10, SGD10), group 2 = suffix form (10 SGD)
    const rawAmount = prefixMatch[1] ?? prefixMatch[2]
    if (rawAmount !== undefined) {
      amountCents = parseCents(rawAmount)
      // Remove the matched amount token from the remaining text
      remainingText =
        remainingText.slice(0, prefixMatch.index) +
        remainingText.slice(prefixMatch.index + prefixMatch[0].length)
      remainingText = remainingText.trim()
    }
  } else {
    // Fall back to bare number at the start of the string
    const bareMatch = BARE_AMOUNT_REGEX.exec(remainingText)
    if (bareMatch !== null && bareMatch[1] !== undefined) {
      amountCents = parseCents(bareMatch[1])
      remainingText = remainingText.slice(bareMatch[0].length).trim()
    }
  }

  if (amountCents === null) {
    return null
  }

  // Currency detection is a gate that runs before item-category resolution
  // and outranks it: a hint-list currency (one we can't confidently
  // convert) forces Tier-1 to bail out entirely, even if the remaining
  // text would otherwise resolve via SG_ITEM_MAP.
  const currencyMatch = detectCurrency(remainingText)
  if (currencyMatch?.kind === 'hint') {
    return null
  }

  let currency: string | undefined
  if (currencyMatch?.kind === 'convert') {
    currency = currencyMatch.code
    remainingText = remainingText.replace(currencyMatch.pattern, '').trim()
    remainingText = remainingText.replace(/\s{2,}/g, ' ').trim()
  }

  // Strip leading prepositions (e.g. "for lunch" → "lunch", "at NTUC" → "NTUC")
  remainingText = remainingText.replace(LEADING_PREPOSITIONS, '').trim()

  // Clean up extra whitespace
  remainingText = remainingText.replace(/\s{2,}/g, ' ').trim()

  const item = remainingText.length > 0 ? remainingText : trimmedInput

  // SG_ITEM_MAP lookup for category/subCategory
  const mapping = lookupItem(item)

  const result: ParseResult = {
    amount: amountCents,
    item,
    confidence: mapping !== undefined ? 0.9 : 0.7,
    tier: 1,
  }

  if (date !== undefined) {
    result.date = date
  }

  if (currency !== undefined) {
    result.currency = currency
  }

  if (mapping !== undefined) {
    result.category = mapping.category
    result.subCategory = mapping.subCategory
  }

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/parser test -- regex.test.ts`
Expected: PASS — all new currency/date-ordering tests green, and all pre-existing tests in the file still green (confirms the reorder is non-breaking).

- [ ] **Step 5: Type-check and lint**

Run: `pnpm --filter @spend-again/parser type-check && pnpm --filter @spend-again/parser lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/regex.ts packages/parser/__tests__/regex.test.ts
git commit -m "feat(parser): detect currency in Tier-1 regex; fix date/amount extraction order"
```

---

### Task 4: Wire currency into Tier-3 Gemini prompt and parsing

**Files:**
- Modify: `packages/parser/src/gemini.ts`
- Test: `packages/parser/__tests__/gemini.test.ts`

**Interfaces:**
- Produces: `buildPrompt()` output includes a `"currency"` instruction; `parseWithGemini()` sets `ParseResult.currency` (ISO code, uppercased) when Gemini reports a non-null, non-SGD currency. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Add to `packages/parser/__tests__/gemini.test.ts`, inside the `describe('buildPrompt', ...)` block (after the existing `'asks for amount in dollars (not cents)'` test):

```ts
  it('includes a currency instruction', () => {
    const prompt = buildPrompt('test')
    expect(prompt.toLowerCase()).toContain('currency')
    expect(prompt).toContain('ISO 4217')
  })
```

Add to the `describe('parseWithGemini', ...)` block (after the existing `'accepts valid category and subCategory'` test, before the "Null / empty date handling" section):

```ts
  // -------------------------------------------------------------------------
  // Currency field
  // -------------------------------------------------------------------------

  it('sets currency when Gemini reports a non-SGD currency', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        amount: 50,
        item: 'Taxi',
        category: 'Transport',
        subCategory: 'Taxi',
        date: '01/01/2026',
        currency: 'THB',
      }),
    )

    const result = await parseWithGemini('50 baht taxi')
    expect(result?.currency).toBe('THB')
  })

  it('omits currency when Gemini returns null', () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null, currency: null }),
    )

    return parseWithGemini('$10 item').then((result) => {
      expect(result?.currency).toBeUndefined()
    })
  })

  it('omits currency when Gemini omits the field entirely', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null }),
    )

    const result = await parseWithGemini('$10 item')
    expect(result?.currency).toBeUndefined()
  })

  it('omits currency when Gemini reports SGD explicitly', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null, currency: 'SGD' }),
    )

    const result = await parseWithGemini('$10 item')
    expect(result?.currency).toBeUndefined()
  })

  it('uppercases a lowercase currency code from Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 50, item: 'Taxi', category: null, subCategory: null, date: null, currency: 'thb' }),
    )

    const result = await parseWithGemini('50 baht taxi')
    expect(result?.currency).toBe('THB')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spend-again/parser test -- gemini.test.ts`
Expected: FAIL — prompt has no "currency"/"ISO 4217" text, and `result?.currency` is always `undefined`.

- [ ] **Step 3: Update `packages/parser/src/gemini.ts`**

Update the `GeminiExpenseJSON` type:

```ts
type GeminiExpenseJSON = {
  amount: number
  item: string
  category: string | null
  subCategory: string | null
  date: string | null
  currency: string | null
}
```

Replace the `buildPrompt` function body with (new rule 8 inserted, old rule 7 renumbered to 9, `currency` added to all three example outputs, and a fourth example added showing a foreign currency):

```ts
export function buildPrompt(input: string): string {
  const categoryList = buildCategoryList()
  const today = getTodayDDMMYYYY()

  return `You are a Singapore expense parser. Extract structured expense data from the user's free-text input.

VALID CATEGORIES (you MUST use only these exact values):
${categoryList}

RULES:
1. Return ONLY a JSON object — no markdown fences, no explanation.
2. "amount" must be a number in the ORIGINAL currency's DOLLARS/major-unit (e.g. 8.50 for SGD 8.50, or 5.60 for EUR 5.60). Do NOT convert to cents, and do NOT convert to SGD — that happens separately.
3. "item" is a short description of what was purchased (e.g. "Lunch at Amoy Street").
4. "category" must be one of the exact category names listed above, or null if unknown.
5. "subCategory" must be one of the valid sub-categories for the chosen category, or null.
6. "date" must be in DD/MM/YYYY format. If no date is mentioned, use today: ${today}.
7. "currency" must be the ISO 4217 code (e.g. "EUR", "USD", "THB") of the currency mentioned in the input, or null if the input specifies no currency, or explicitly says SGD/S$/dollars.
8. If the input cannot be parsed as an expense, return null for all fields (keep amount as 0).

SINGAPORE CONTEXT:
- Hawker centres, kopitiam, food courts → Food / Hawker
- NTUC FairPrice, Cold Storage, Giant, Sheng Siong → Groceries / Supermarket
- Grab / GoJek rides → Transport / Grab or Transport / Gojek
- MRT / bus / EZ-Link → Transport / MRT/Bus
- Guardian, Watsons → Health / Pharmacy
- Popular, MPH bookstore → Shopping / Books
- Lazada, Shopee → Shopping / Online Shopping

EXAMPLES:
Input: "8.50 for lunch at Amoy"
Output: {"amount":8.50,"item":"Lunch at Amoy","category":"Food","subCategory":"Hawker","date":"${today}","currency":null}

Input: "$12 NTUC groceries"
Output: {"amount":12,"item":"NTUC groceries","category":"Groceries","subCategory":"Supermarket","date":"${today}","currency":null}

Input: "grab home 15.30 yesterday"
Output: {"amount":15.30,"item":"Grab ride home","category":"Transport","subCategory":"Grab","date":"${getYesterdayDDMMYYYY()}","currency":null}

Input: "50 baht taxi bangkok"
Output: {"amount":50,"item":"Taxi","category":"Transport","subCategory":"Taxi","date":"${today}","currency":"THB"}

Now parse this input:
"${input}"

Respond with ONLY the JSON object.`
}
```

Update `parseGeminiJSON` to read the `currency` field — replace:

```ts
  const item = typeof obj['item'] === 'string' ? obj['item'] : ''
  const category = typeof obj['category'] === 'string' ? obj['category'] : null
  const subCategory = typeof obj['subCategory'] === 'string' ? obj['subCategory'] : null
  const date = typeof obj['date'] === 'string' ? obj['date'] : null

  return { amount, item, category, subCategory, date }
```

with:

```ts
  const item = typeof obj['item'] === 'string' ? obj['item'] : ''
  const category = typeof obj['category'] === 'string' ? obj['category'] : null
  const subCategory = typeof obj['subCategory'] === 'string' ? obj['subCategory'] : null
  const date = typeof obj['date'] === 'string' ? obj['date'] : null
  const currency = typeof obj['currency'] === 'string' ? obj['currency'] : null

  return { amount, item, category, subCategory, date, currency }
```

In `parseWithGemini`, after the existing `if (geminiData.date !== null && ...) { parseResult.date = ... }` block and before the `if (geminiData.category !== null && ...)` block, insert:

```ts
  if (
    geminiData.currency !== null &&
    geminiData.currency.trim().length > 0 &&
    geminiData.currency.trim().toUpperCase() !== 'SGD'
  ) {
    parseResult.currency = geminiData.currency.trim().toUpperCase()
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/parser test -- gemini.test.ts`
Expected: PASS — all new currency tests green, all pre-existing tests still green.

- [ ] **Step 5: Type-check and lint**

Run: `pnpm --filter @spend-again/parser type-check && pnpm --filter @spend-again/parser lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/gemini.ts packages/parser/__tests__/gemini.test.ts
git commit -m "feat(parser): extract currency field in Gemini Tier-3 parsing"
```

---

### Task 5: Single conversion point in the `parse()` orchestrator

**Files:**
- Modify: `packages/parser/src/index.ts`
- Test: `packages/parser/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `convertToSGD` from `./currency.js` (Task 2); `ParseResult.currency` from Tasks 3/4.
- Produces: `parse()` always returns a `ParseResult` with `amount` in final SGD cents; when a non-SGD currency was detected, `originalAmount`/`originalCurrency`/`exchangeRate` are set and `currency` is cleared. Re-exports `CurrencyConversionError`, `convertToSGD`, `detectCurrency` from the package root. Consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Add to `packages/parser/__tests__/index.test.ts`. First, add a spy on the currency module — update the imports block at the top of the file:

```ts
import * as RegexModule from '../src/regex.js'
import * as GeminiModule from '../src/gemini.js'
import * as CurrencyModule from '../src/currency.js'
import { parse } from '../src/index.js'
import type { ParseResult, LookupFn } from '../src/index.js'
```

Update the `beforeEach` inside `describe('parse() — unified 3-tier orchestration', ...)` to also spy on `convertToSGD`:

```ts
  let spyRegex: ReturnType<typeof vi.spyOn>
  let spyGemini: ReturnType<typeof vi.spyOn>
  let spyConvert: ReturnType<typeof vi.spyOn>
  let mockLookupItem: ReturnType<typeof vi.fn>
  let lookupItem: LookupFn

  beforeEach(() => {
    vi.resetAllMocks()
    spyRegex = vi.spyOn(RegexModule, 'parseWithRegex')
    spyGemini = vi.spyOn(GeminiModule, 'parseWithGemini')
    spyConvert = vi.spyOn(CurrencyModule, 'convertToSGD')
    mockLookupItem = vi.fn()
    lookupItem = mockLookupItem as unknown as LookupFn
  })
```

Add a new `describe` block at the end of the file, before the final closing `})` of the outer `describe`:

```ts
  // -------------------------------------------------------------------------
  // 7. Currency conversion — single point, regardless of which tier resolved
  // -------------------------------------------------------------------------

  describe('currency conversion', () => {
    it('converts a tier-1 result carrying a currency field', async () => {
      const tier1: ParseResult = { ...makeTier1Full(), currency: 'EUR' }
      spyRegex.mockReturnValueOnce(tier1)
      spyConvert.mockResolvedValueOnce({ convertedCents: 1727, rate: 1.4384 })

      const result = await parse('12 euro NTUC', { lookupItem })

      expect(spyConvert).toHaveBeenCalledWith(1200, 'EUR')
      expect(result?.amount).toBe(1727)
      expect(result?.originalAmount).toBe(1200)
      expect(result?.originalCurrency).toBe('EUR')
      expect(result?.exchangeRate).toBe(1.4384)
      expect(result?.currency).toBeUndefined()
    })

    it('does not call convertToSGD when no currency is set', async () => {
      spyRegex.mockReturnValueOnce(makeTier1Full())

      await parse('$12 NTUC', { lookupItem })

      expect(spyConvert).not.toHaveBeenCalled()
    })

    it('converts a tier-2 merged result carrying tier-1 currency through', async () => {
      const tier1: ParseResult = { ...makeTier1Partial(), currency: 'EUR' }
      spyRegex.mockReturnValueOnce(tier1)
      mockLookupItem.mockResolvedValueOnce(makeTier2Result('lunch'))
      spyConvert.mockResolvedValueOnce({ convertedCents: 1150, rate: 1.4384 })

      const result = await parse('8 euro lunch', { lookupItem })

      expect(spyConvert).toHaveBeenCalledWith(800, 'EUR')
      expect(result?.tier).toBe(2)
      expect(result?.amount).toBe(1150)
      expect(result?.originalCurrency).toBe('EUR')
    })

    it('converts a tier-3 gemini result carrying a currency field', async () => {
      spyRegex.mockReturnValueOnce(null)
      mockLookupItem.mockResolvedValueOnce(null)
      spyGemini.mockResolvedValueOnce({ ...makeTier3Result(), currency: 'THB' })
      spyConvert.mockResolvedValueOnce({ convertedCents: 143, rate: 0.0398 })

      const result = await parse('50 baht taxi', { lookupItem })

      expect(spyConvert).toHaveBeenCalledWith(850, 'THB')
      expect(result?.tier).toBe(3)
      expect(result?.amount).toBe(143)
      expect(result?.originalCurrency).toBe('THB')
    })

    it('propagates CurrencyConversionError instead of returning a result', async () => {
      const { CurrencyConversionError } = await import('@spend-again/shared')
      const tier1: ParseResult = { ...makeTier1Full(), currency: 'EUR' }
      spyRegex.mockReturnValueOnce(tier1)
      spyConvert.mockRejectedValueOnce(new CurrencyConversionError('rate service down'))

      await expect(parse('12 euro NTUC', { lookupItem })).rejects.toThrow(CurrencyConversionError)
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spend-again/parser test -- index.test.ts`
Expected: FAIL — `convertToSGD` is never called, `result?.amount` is the unconverted tier amount, `originalAmount`/`originalCurrency`/`exchangeRate` are `undefined`.

- [ ] **Step 3: Update `packages/parser/src/index.ts`**

Replace the full file contents with:

```ts
// Parser package entry point
import { parseWithRegex } from './regex.js'
import { parseWithGemini, waitForGeminiRpmBudget } from './gemini.js'
import { convertToSGD } from './currency.js'
import type { ParseResult } from './regex.js'
import type { Category, SubCategory } from '@spend-again/shared'

export type { ParseResult } from './regex.js'
export { parseWithRegex } from './regex.js'
export { parseWithGemini, buildPrompt, waitForGeminiRpmBudget, parseSpaceWithGemini } from './gemini.js'
export type { ParsedSpaceResult } from './gemini.js'
export { GeminiRateLimitError, OcrRateLimitError, CurrencyConversionError } from '@spend-again/shared'
export { convertToSGD, detectCurrency } from './currency.js'
export type { CurrencyDetection } from './currency.js'

export type LookupResult = { category: Category; subCategory: SubCategory; confidence: number }
export type LookupFn = (itemName: string) => Promise<LookupResult | null>

/**
 * Single conversion point: if a tier reported a non-SGD currency, convert
 * the amount to SGD cents and attach display-only original-amount fields.
 * Applied identically regardless of which tier (1, 2, or 3) resolved the
 * result, so callers never need tier-specific conversion logic.
 */
async function applyCurrencyConversion(result: ParseResult): Promise<ParseResult> {
  const { currency, ...rest } = result

  if (currency === undefined || currency === 'SGD') {
    return result
  }

  const { convertedCents, rate } = await convertToSGD(rest.amount, currency)

  return {
    ...rest,
    amount: convertedCents,
    originalAmount: rest.amount,
    originalCurrency: currency,
    exchangeRate: rate,
  }
}

/**
 * Unified 3-tier expense parser.
 *
 * Tier 1 — Regex: fast, no I/O. Returns a result with tier=1.
 *   - If the result has a category, we're done.
 *   - If the result has an amount but no category, we continue to Tier 2
 *     using the extracted item name.
 *   - If regex returns null (no amount found), we continue to Tier 2
 *     using the raw input string.
 *
 * Tier 2 — Learned mappings (via injected lookupItem): looks up item → category
 *   from past corrections/confirmations. If found, merges with any amount/date
 *   from the Tier 1 partial result.
 *
 * Tier 3 — Gemini LLM: called only when both previous tiers fail to produce
 *   a fully-resolved result.
 *
 * Currency conversion (see applyCurrencyConversion) is applied once, after
 * whichever tier resolves the result — a tier reports amount/currency in the
 * ORIGINAL currency; conversion to SGD cents always happens here, last.
 */
export async function parse(
  input: string,
  opts: { lookupItem: LookupFn },
): Promise<ParseResult | null> {
  // Tier 1: regex — no I/O
  const tier1 = parseWithRegex(input)

  if (tier1 !== null && tier1.category !== undefined) {
    // Fully resolved by regex
    return applyCurrencyConversion(tier1)
  }

  // Tier 2: learned mappings via injected lookup function
  // Use the item extracted by regex (if any) — it's already stripped of
  // amounts, dates, and prepositions, which improves lookup accuracy.
  const itemToLookup = tier1?.item ?? input
  const tier2 = await opts.lookupItem(itemToLookup)

  if (tier2 !== null) {
    // Merge: prefer tier1 amount/date/currency when available; take category from tier2
    const merged: ParseResult = {
      amount: tier1 !== null && tier1.amount !== 0 ? tier1.amount : 0,
      item: tier1?.item ?? input,
      category: tier2.category,
      subCategory: tier2.subCategory,
      confidence: tier2.confidence,
      tier: 2,
      ...(tier1?.date !== undefined ? { date: tier1.date } : {}),
      ...(tier1?.currency !== undefined ? { currency: tier1.currency } : {}),
    }
    return applyCurrencyConversion(merged)
  }

  // Tier 3: Gemini LLM — only when tiers 1 and 2 both fail
  await waitForGeminiRpmBudget()
  const tier3 = await parseWithGemini(input)
  if (tier3 === null) {
    return null
  }
  return applyCurrencyConversion(tier3)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/parser test -- index.test.ts`
Expected: PASS — all new currency-conversion tests green, and every pre-existing test in the file (tier routing, merging, null handling) still green.

- [ ] **Step 5: Run the full parser test suite**

Run: `pnpm --filter @spend-again/parser test`
Expected: PASS — `currency.test.ts`, `regex.test.ts`, `gemini.test.ts`, `index.test.ts`, `ocr.test.ts`, `sms.test.ts` all green.

- [ ] **Step 6: Type-check and lint**

Run: `pnpm --filter @spend-again/parser type-check && pnpm --filter @spend-again/parser lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/parser/src/index.ts packages/parser/__tests__/index.test.ts
git commit -m "feat(parser): apply currency conversion once in the parse() orchestrator"
```

---

### Task 6: Receipt OCR currency support

**Files:**
- Modify: `packages/parser/src/ocr.ts`
- Test: `packages/parser/__tests__/ocr.test.ts`

**Interfaces:**
- Consumes: `convertToSGD` from `./currency.js` (Task 2).
- Produces: `ReceiptLineItem` gains `originalAmount?: number`; `SimpleReceiptResult` gains `originalAmount?: number`, `originalCurrency?: string`, `exchangeRate?: number`; `MultiItemReceiptResult` gains `originalTotal?: number`, `originalCurrency?: string`, `exchangeRate?: number`. `buildOcrPrompt()` asks for a top-level `"currency"` field. `parseReceiptWithOcr()` converts `total`/each item's `amount` (simple: just `amount`) to SGD once per receipt when a non-SGD currency is reported. `simpleReceiptToParseResult()` carries the new fields onto `ParseResult`. Consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Add to `packages/parser/__tests__/ocr.test.ts`, inside `describe('buildOcrPrompt', ...)` (after the existing `'asks for amounts in dollars'` test):

```ts
  it('includes a currency instruction', () => {
    const prompt = buildOcrPrompt()
    expect(prompt.toLowerCase()).toContain('currency')
  })
```

Add a new top-level `describe` block at the end of the file (after the closing `})` of `describe('parseReceiptWithOcr', ...)`), and update the file's import to also bring in `clearCurrencyRateCache`:

```ts
import {
  OcrRateLimitError,
  buildOcrPrompt,
  parseReceiptWithOcr,
  simpleReceiptToParseResult,
} from '../src/ocr.js'
import { clearCurrencyRateCache } from '../src/currency.js'
```

```ts
describe('parseReceiptWithOcr — currency conversion', () => {
  const originalFetch = global.fetch
  const mockFxFetch = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
    process.env['EXCHANGERATE_API_KEY'] = 'test-fx-key'
    global.fetch = mockFxFetch as unknown as typeof fetch
    clearCurrencyRateCache()
    mockFxFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: 'success', conversion_rates: { SGD: 1.4384 } }),
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('converts a simple receipt amount and records original values', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        type: 'simple',
        item: 'Pasta',
        amount: 5.6,
        category: 'Food',
        subCategory: 'Restaurant',
        date: '20/08/2026',
        currency: 'EUR',
      }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')

    expect(result?.type).toBe('simple')
    if (result?.type === 'simple') {
      expect(result.amount).toBe(Math.round(560 * 1.4384))
      expect(result.originalAmount).toBe(560)
      expect(result.originalCurrency).toBe('EUR')
      expect(result.exchangeRate).toBe(1.4384)
    }
  })

  it('does not convert a simple receipt with no currency (SGD)', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        type: 'simple',
        item: 'Kopi',
        amount: 1.5,
        category: 'Food',
        subCategory: 'Hawker',
        date: '20/08/2026',
        currency: null,
      }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')

    expect(result?.type).toBe('simple')
    if (result?.type === 'simple') {
      expect(result.amount).toBe(150)
      expect(result.originalCurrency).toBeUndefined()
      expect(mockFxFetch).not.toHaveBeenCalled()
    }
  })

  it('converts every line item and the total on a multi-item receipt, using one rate fetch', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        type: 'multi',
        items: [
          { item: 'Bread', amount: 3.0, category: 'Groceries', subCategory: 'Supermarket' },
          { item: 'Milk', amount: 2.5, category: 'Groceries', subCategory: 'Supermarket' },
        ],
        total: 5.5,
        date: '20/08/2026',
        currency: 'EUR',
      }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')

    expect(result?.type).toBe('multi')
    if (result?.type === 'multi') {
      expect(result.total).toBe(Math.round(550 * 1.4384))
      expect(result.originalTotal).toBe(550)
      expect(result.originalCurrency).toBe('EUR')
      expect(result.items[0]?.amount).toBe(Math.round(300 * 1.4384))
      expect(result.items[0]?.originalAmount).toBe(300)
      expect(result.items[1]?.amount).toBe(Math.round(250 * 1.4384))
      expect(mockFxFetch).toHaveBeenCalledOnce()
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spend-again/parser test -- ocr.test.ts`
Expected: FAIL — prompt has no "currency" text; converted amounts equal the raw (unconverted) cents; `originalAmount`/`originalCurrency`/`exchangeRate`/`originalTotal` are `undefined`.

- [ ] **Step 3: Update `packages/parser/src/ocr.ts`**

Add the import (after the existing `waitForGeminiRpmBudget` import):

```ts
import { waitForGeminiRpmBudget } from './gemini.js'
import { convertToSGD } from './currency.js'
```

Update the result types:

```ts
/** A single line item extracted from a receipt. */
export type ReceiptLineItem = {
  item: string
  amount: number // integer cents (SGD, after conversion if applicable)
  category?: Category
  subCategory?: SubCategory
  originalAmount?: number // integer cents in originalCurrency — display only
}

/** Result for a multi-item receipt (e.g. supermarket). */
export type MultiItemReceiptResult = {
  type: 'multi'
  items: ReceiptLineItem[]
  total: number // integer cents (SGD, after conversion if applicable)
  date?: string // DD/MM/YYYY
  originalTotal?: number // integer cents in originalCurrency — display only
  originalCurrency?: string // ISO 4217 code — display only
  exchangeRate?: number // 1 originalCurrency = exchangeRate SGD — display only
}

/** Result for a simple receipt (single charge, e.g. hawker, restaurant). */
export type SimpleReceiptResult = {
  type: 'simple'
  item: string
  amount: number // integer cents (SGD, after conversion if applicable)
  category?: Category
  subCategory?: SubCategory
  date?: string // DD/MM/YYYY
  originalAmount?: number // integer cents in originalCurrency — display only
  originalCurrency?: string // ISO 4217 code — display only
  exchangeRate?: number // 1 originalCurrency = exchangeRate SGD — display only
}
```

Update the `GeminiReceiptJSON` type — add `currency?: string | null` after the `date` field:

```ts
type GeminiReceiptJSON = {
  type: 'multi' | 'simple' | 'error'
  // multi
  items?: GeminiLineItem[]
  total?: number
  // simple
  item?: string
  amount?: number
  category?: string | null
  subCategory?: string | null
  // shared
  date?: string | null
  currency?: string | null
  // error
  reason?: string
}
```

Replace the `buildOcrPrompt` function body's `RULES` section (rules 1–5) with a version that adds a currency rule, and mention `"currency"` in both JSON shape lines:

```ts
export function buildOcrPrompt(): string {
  const categoryList = buildCategoryList()
  const today = getTodayDDMMYYYY()

  return `You are a Singapore receipt parser. Analyse the attached receipt image and extract structured expense data.

VALID CATEGORIES (use ONLY these exact values):
${categoryList}

RULES:
1. Return ONLY a JSON object — no markdown fences, no explanation.
2. All amounts must be numbers in the ORIGINAL currency's DOLLARS/major-unit (e.g. 8.50 for S$8.50, or 5.60 for €5.60). Do NOT convert to cents, and do NOT convert to SGD — that happens separately.
3. Dates must be in DD/MM/YYYY format. If no date visible, use today: ${today}.
4. "category" and "subCategory" must use exact names from the list above, or null if unknown.
5. "currency" must be the ISO 4217 code of the currency printed on the receipt (e.g. "EUR", "USD", "THB"), or null if it is Singapore Dollars (S$/SGD) or not indicated. A receipt has exactly ONE currency for the whole thing.
6. If the image is unreadable or not a receipt, return {"type":"error","reason":"<brief reason>"}.

RECEIPT TYPES:
- For a receipt with MULTIPLE line items (supermarket, department store):
  Return: {"type":"multi","items":[{"item":"...", "amount":x.xx, "category":"...", "subCategory":"..."},...], "total":x.xx, "date":"DD/MM/YYYY", "currency":null}
  Each item should have its own category/subCategory based on what it is.

- For a SIMPLE single-charge receipt (hawker, grab, restaurant bill, clinic):
  Return: {"type":"simple","item":"<description>","amount":x.xx,"category":"...","subCategory":"...","date":"DD/MM/YYYY","currency":null}

SINGAPORE CONTEXT:
- Hawker centres, kopitiam, food courts → Food / Hawker
- NTUC FairPrice, Cold Storage, Giant, Sheng Siong → Groceries / Supermarket
- Grab / GoJode → Transport / Grab or Transport / Gojek
- MRT / bus / EZ-Link → Transport / MRT/Bus
- Guardian, Watsons → Health / Pharmacy
- Popular, MPH → Shopping / Books
- Lazada, Shopee → Shopping / Online Shopping

Respond with ONLY the JSON object.`
}
```

(Note: keep the "Grab / GoJode" line exactly as `Grab / GoJode → Transport / Grab or Transport / Gojek` — this is a typo already present in the current file at `packages/parser/src/ocr.ts:113` (`GoJode` instead of `GoJek`); reproduce it as-is since fixing unrelated typos is out of scope for this task.)

In `parseReceiptWithOcr`, after the existing error-type branch (`if (parsed.type === 'error') { ... return ... }`), insert the shared currency-code extraction:

```ts
  // Error result
  if (parsed.type === 'error') {
    return {
      type: 'error',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'Unreadable image',
    }
  }

  // Shared currency detection — a receipt has one currency for everything on it.
  const currencyCode =
    typeof parsed.currency === 'string' &&
    parsed.currency.trim().length > 0 &&
    parsed.currency.trim().toUpperCase() !== 'SGD'
      ? parsed.currency.trim().toUpperCase()
      : undefined
```

Replace the "Simple result" branch with:

```ts
  // Simple result
  if (parsed.type === 'simple') {
    const rawAmount = typeof parsed.amount === 'number' ? toCents(parsed.amount) : 0
    const item = typeof parsed.item === 'string' ? parsed.item : 'Unknown'
    const { category, subCategory } = resolveCategory(
      parsed.category as string | null | undefined,
      parsed.subCategory as string | null | undefined,
    )

    let amount = rawAmount
    let conversion: { originalAmount: number; originalCurrency: string; exchangeRate: number } | undefined

    if (currencyCode !== undefined) {
      const { convertedCents, rate } = await convertToSGD(rawAmount, currencyCode)
      amount = convertedCents
      conversion = { originalAmount: rawAmount, originalCurrency: currencyCode, exchangeRate: rate }
    }

    const simpleResult: SimpleReceiptResult = { type: 'simple', item, amount }

    if (typeof parsed.date === 'string' && parsed.date.trim().length > 0) {
      simpleResult.date = parsed.date.trim()
    }
    if (category !== undefined) {
      simpleResult.category = category
    }
    if (subCategory !== undefined) {
      simpleResult.subCategory = subCategory
    }
    if (conversion !== undefined) {
      simpleResult.originalAmount = conversion.originalAmount
      simpleResult.originalCurrency = conversion.originalCurrency
      simpleResult.exchangeRate = conversion.exchangeRate
    }

    return simpleResult
  }
```

Replace the "Multi result" branch with:

```ts
  // Multi result
  if (parsed.type === 'multi') {
    const rawItems = Array.isArray(parsed.items) ? parsed.items : []
    const items: ReceiptLineItem[] = rawItems
      .filter((i): i is GeminiLineItem => typeof i === 'object' && i !== null)
      .map((i) => {
        const amount = typeof i.amount === 'number' ? toCents(i.amount) : 0
        const item = typeof i.item === 'string' ? i.item : 'Unknown'
        const { category, subCategory } = resolveCategory(i.category, i.subCategory)
        const lineItem: ReceiptLineItem = { item, amount }
        if (category !== undefined) {
          lineItem.category = category
        }
        if (subCategory !== undefined) {
          lineItem.subCategory = subCategory
        }
        return lineItem
      })

    const extractedTotal =
      typeof parsed.total === 'number' ? toCents(parsed.total) : items.reduce((s, i) => s + i.amount, 0)

    let finalItems = items
    let finalTotal = extractedTotal
    let conversion: { originalTotal: number; originalCurrency: string; exchangeRate: number } | undefined

    if (currencyCode !== undefined) {
      const { convertedCents, rate } = await convertToSGD(extractedTotal, currencyCode)
      finalItems = items.map((lineItem) => ({
        ...lineItem,
        originalAmount: lineItem.amount,
        amount: Math.round(lineItem.amount * rate),
      }))
      finalTotal = convertedCents
      conversion = { originalTotal: extractedTotal, originalCurrency: currencyCode, exchangeRate: rate }
    }

    const multiResult: MultiItemReceiptResult = { type: 'multi', items: finalItems, total: finalTotal }

    if (typeof parsed.date === 'string' && parsed.date.trim().length > 0) {
      multiResult.date = parsed.date.trim()
    }
    if (conversion !== undefined) {
      multiResult.originalTotal = conversion.originalTotal
      multiResult.originalCurrency = conversion.originalCurrency
      multiResult.exchangeRate = conversion.exchangeRate
    }

    return multiResult
  }

  return null
}
```

Finally, update `simpleReceiptToParseResult` to carry the new fields onto `ParseResult`:

```ts
export function simpleReceiptToParseResult(result: SimpleReceiptResult): ParseResult {
  return {
    amount: result.amount,
    item: result.item,
    confidence: 0.85,
    tier: 3,
    ...(result.category !== undefined ? { category: result.category } : {}),
    ...(result.subCategory !== undefined ? { subCategory: result.subCategory } : {}),
    ...(result.date !== undefined ? { date: result.date } : {}),
    ...(result.originalAmount !== undefined ? { originalAmount: result.originalAmount } : {}),
    ...(result.originalCurrency !== undefined ? { originalCurrency: result.originalCurrency } : {}),
    ...(result.exchangeRate !== undefined ? { exchangeRate: result.exchangeRate } : {}),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/parser test -- ocr.test.ts`
Expected: PASS — all new currency-conversion tests green, and every pre-existing test in the file still green.

- [ ] **Step 5: Run the full parser test suite**

Run: `pnpm --filter @spend-again/parser test`
Expected: PASS, all files green.

- [ ] **Step 6: Type-check and lint**

Run: `pnpm --filter @spend-again/parser type-check && pnpm --filter @spend-again/parser lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/parser/src/ocr.ts packages/parser/__tests__/ocr.test.ts
git commit -m "feat(parser): convert receipt OCR amounts when a foreign currency is detected"
```

---

### Task 7: Bot display and error handling

**Files:**
- Modify: `apps/bot/src/handlers/expense.ts`
- Modify: `apps/bot/src/handlers/receipt.ts`
- Test: `apps/bot/__tests__/expense.test.ts`
- Test: `apps/bot/__tests__/receipt.test.ts` (new)

**Interfaces:**
- Consumes: `fmtCurrency`, `MSG_CURRENCY_UNAVAILABLE` from `@spend-again/shared` (Task 1); `CurrencyConversionError` from `@spend-again/parser` (Task 5); `ParseResult.originalAmount`/`originalCurrency`/`exchangeRate` (Task 3/5); `MultiItemReceiptResult.originalTotal`/`originalCurrency`/`exchangeRate` (Task 6).
- Produces: `buildConfirmationMessage()` appends a conversion note when present. `formatMultiReceipt()` (newly exported) does the same for receipts. Both handlers reply with `MSG_CURRENCY_UNAVAILABLE` and do not save when `CurrencyConversionError` is thrown.

Note on scope: `receiptHandler()` itself (the Telegram photo-download → OCR → reply flow) has no existing unit test in this codebase — only `formatMultiReceipt()` (a pure function, once exported) and `receiptConfirmHandler` (in `receipt-confirm.test.ts`) are tested at that layer. This task adds a test for the pure `formatMultiReceipt()` function and does not add new test scaffolding for `receiptHandler`'s Telegram-download path, consistent with existing coverage in this file.

- [ ] **Step 1: Write the failing tests for `expense.ts`**

Update the `vi.mock('@spend-again/parser', ...)` block near the top of `apps/bot/__tests__/expense.test.ts` to also export a `CurrencyConversionError` mock class:

```ts
vi.mock('@spend-again/parser', () => ({
  parse: vi.fn(),
  GeminiRateLimitError: class GeminiRateLimitError extends Error {
    constructor() {
      super('Gemini rate limit exceeded')
      this.name = 'GeminiRateLimitError'
    }
  },
  CurrencyConversionError: class CurrencyConversionError extends Error {
    constructor(message = 'Currency conversion unavailable') {
      super(message)
      this.name = 'CurrencyConversionError'
    }
  },
}))
```

Update the top-level import line to also bring in `buildConfirmationMessage` and `CurrencyConversionError`:

```ts
import { expenseHandler, deriveDescription, buildConfirmationMessage } from '../src/handlers/expense.js'
import { loginViaTelegram, tokenStore } from '../src/lib/api-client.js'
import { parse, CurrencyConversionError } from '@spend-again/parser'
import type { ParseResult } from '@spend-again/parser'
```

Add two new `describe` blocks at the end of the file:

```ts
describe('buildConfirmationMessage — currency conversion note', () => {
  function makeResult(overrides: Partial<ParseResult> = {}): ParseResult {
    return {
      amount: 805,
      item: 'Pasta',
      category: 'Food' as never,
      subCategory: 'Restaurant' as never,
      confidence: 0.85,
      tier: 3,
      ...overrides,
    }
  }

  it('appends a conversion note when originalAmount/originalCurrency/exchangeRate are set', () => {
    const msg = buildConfirmationMessage({
      result: makeResult({ originalAmount: 560, originalCurrency: 'EUR', exchangeRate: 1.4384 }),
      rawInput: '5.60 euro pasta',
    })

    expect(msg).toContain('€5.60')
    expect(msg).toContain('S$8.05')
    expect(msg).toContain('1 EUR = 1.4384 SGD')
  })

  it('omits the conversion note when there was no conversion', () => {
    const msg = buildConfirmationMessage({ result: makeResult(), rawInput: '$8.05 pasta' })

    expect(msg).not.toContain('→')
  })
})

describe('expenseHandler — currency conversion failure', () => {
  beforeEach(() => {
    tokenStore.clear()
    vi.clearAllMocks()
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)
  })

  it('replies with the currency-unavailable message and does not throw when parse() rejects with CurrencyConversionError', async () => {
    vi.mocked(parse).mockRejectedValue(new CurrencyConversionError('rate service down'))

    const ctx = makeCtx()
    await expenseHandler(ctx as never)

    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('exchange rate'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spend-again/bot test -- expense.test.ts`
Expected: FAIL — conversion note is absent from `buildConfirmationMessage()`'s output, and the `CurrencyConversionError` test either times out/throws (uncaught rejection) or gets the generic "cannot understand" style reply instead of the exchange-rate message.

- [ ] **Step 3: Update `apps/bot/src/handlers/expense.ts`**

Update the imports at the top of the file:

```ts
import type { Context } from 'grammy'
import { parse, GeminiRateLimitError, CurrencyConversionError } from '@spend-again/parser'
import type { ParseResult } from '@spend-again/parser'
import {
  MSG_NOT_REGISTERED,
  MSG_PARSE_FAILED,
  MSG_CONFIRM_PROMPT,
  MSG_CURRENCY_UNAVAILABLE,
  CATEGORY_EMOJI,
  fmtSGD,
  fmtCurrency,
} from '@spend-again/shared'
import { tokenStore, loginViaTelegram, apiClient } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'
import { buildConfirmKeyboard } from '../keyboards/confirm.js'
```

Replace `buildConfirmationMessage` with:

```ts
export function buildConfirmationMessage(entry: PendingConfirmation): string {
  const { result, activeSpaceName, suggestedSpaceName } = entry
  const emoji = getCategoryEmoji(result)
  const amount = fmtSGD(result.amount)
  const category = formatCategory(result)
  let msg = MSG_CONFIRM_PROMPT(emoji, amount, result.item, category)
  if (
    result.originalAmount !== undefined &&
    result.originalCurrency !== undefined &&
    result.exchangeRate !== undefined
  ) {
    const original = fmtCurrency(result.originalAmount, result.originalCurrency)
    msg += `\n${original} \u{2192} ${amount} (1 ${result.originalCurrency} = ${result.exchangeRate.toFixed(4)} SGD)`
  }
  if (activeSpaceName) {
    msg += `\nSpace: ${activeSpaceName}`
  } else if (suggestedSpaceName) {
    msg += `\n\nThis falls during ${suggestedSpaceName}.\nAdd to Space?`
  }
  return msg
}
```

Replace the `parse()` call's `try`/`catch` block inside `expenseHandler`:

```ts
  // Run the 3-tier parser
  let result: ParseResult | null
  try {
    result = await parse(text, { lookupItem: (name) => apiClient.getLearnedMapping(name) })
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      await ctx.reply(
        `Wait ah, AI a bit busy right now! \u{23F3}\n` +
          `Pls try again later.`,
      )
      return
    }
    if (err instanceof CurrencyConversionError) {
      await ctx.reply(MSG_CURRENCY_UNAVAILABLE)
      return
    }
    throw err
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/bot test -- expense.test.ts`
Expected: PASS — all new tests green, and every pre-existing test in the file still green.

- [ ] **Step 5: Write the failing test for `formatMultiReceipt`**

Create `apps/bot/__tests__/receipt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMultiReceipt } from '../src/handlers/receipt.js'
import type { MultiItemReceiptResult } from '@spend-again/parser/ocr'

function makeReceipt(overrides: Partial<MultiItemReceiptResult> = {}): MultiItemReceiptResult {
  return {
    type: 'multi',
    items: [
      { item: 'Bread', amount: 431, category: 'Groceries', subCategory: 'Supermarket' },
      { item: 'Milk', amount: 360, category: 'Groceries', subCategory: 'Supermarket' },
    ],
    total: 791,
    ...overrides,
  }
}

describe('formatMultiReceipt', () => {
  it('includes a currency conversion line when the receipt was converted', () => {
    const msg = formatMultiReceipt(
      makeReceipt({ originalTotal: 550, originalCurrency: 'EUR', exchangeRate: 1.4384 }),
    )

    expect(msg).toContain('€5.50')
    expect(msg).toContain('S$7.91')
    expect(msg).toContain('1 EUR = 1.4384 SGD')
  })

  it('omits the conversion line when there was no conversion', () => {
    const msg = formatMultiReceipt(makeReceipt())

    expect(msg).not.toContain('→')
  })

  it('still lists every item and the total', () => {
    const msg = formatMultiReceipt(makeReceipt())

    expect(msg).toContain('Bread')
    expect(msg).toContain('Milk')
    expect(msg).toContain('S$7.91')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @spend-again/bot test -- receipt.test.ts`
Expected: FAIL — `formatMultiReceipt` is not exported from `../src/handlers/receipt.js`.

- [ ] **Step 7: Update `apps/bot/src/handlers/receipt.ts`**

Update the imports at the top of the file:

```ts
import type { Context } from 'grammy'
import { parseReceiptWithOcr, simpleReceiptToParseResult } from '@spend-again/parser/ocr'
import type { OcrResult, MultiItemReceiptResult } from '@spend-again/parser/ocr'
import { CurrencyConversionError } from '@spend-again/parser'
import {
  MSG_NOT_REGISTERED,
  MSG_RECEIPT_PROCESSING,
  MSG_RECEIPT_UNSUPPORTED_FORMAT,
  MSG_RECEIPT_NO_IMAGE,
  MSG_RECEIPT_TOO_LARGE,
  MSG_RECEIPT_DOWNLOAD_FAILED,
  MSG_RECEIPT_RATE_LIMIT,
  MSG_RECEIPT_PARSE_FAILED,
  MSG_RECEIPT_ERROR,
  MSG_RECEIPT_MULTI_HEADER,
  MSG_RECEIPT_SAVE_PROMPT,
  MSG_CURRENCY_UNAVAILABLE,
  OcrRateLimitError,
  emojiFor,
  fmtSGD,
  fmtCurrency,
} from '@spend-again/shared'
import { tokenStore } from '../lib/api-client.js'
import { BOT_TOKEN, DASHBOARD_URL } from '../lib/env.js'
import { buildConfirmKeyboard } from '../keyboards/confirm.js'
import { buildConfirmationMessage, pendingConfirmations } from './expense.js'
```

Replace `formatMultiReceipt` (adding `export` and the conversion-note line):

```ts
/** Format a multi-item receipt as a human-readable Telegram message. */
export function formatMultiReceipt(result: MultiItemReceiptResult): string {
  const lines: string[] = [MSG_RECEIPT_MULTI_HEADER]

  if (
    result.originalTotal !== undefined &&
    result.originalCurrency !== undefined &&
    result.exchangeRate !== undefined
  ) {
    const originalTotalFmt = fmtCurrency(result.originalTotal, result.originalCurrency)
    const convertedTotalFmt = fmtSGD(result.total)
    lines.push(
      `\u{1F4B1} ${originalTotalFmt} \u{2192} ${convertedTotalFmt} (1 ${result.originalCurrency} = ${result.exchangeRate.toFixed(4)} SGD)`,
    )
  }

  for (const item of result.items) {
    const emoji = emojiFor(item.category)
    const amount = fmtSGD(item.amount)
    const cat =
      item.subCategory !== undefined
        ? `${item.category}/${item.subCategory}`
        : (item.category ?? 'Unknown')
    lines.push(`  ${emoji} ${amount} — ${item.item} (${cat})`)
  }

  const total = fmtSGD(result.total)
  lines.push(`\n\u{1F4B0} Total: ${total}`)
  if (result.date !== undefined) {
    lines.push(`\u{1F4C5} Date: ${result.date}`)
  }
  lines.push(MSG_RECEIPT_SAVE_PROMPT)

  return lines.join('\n')
}
```

Replace the `try`/`catch` around `parseReceiptWithOcr` inside `receiptHandler`:

```ts
  let ocrResult: OcrResult | null
  try {
    ocrResult = await parseReceiptWithOcr(imageData, mimeType)
  } catch (err) {
    if (err instanceof OcrRateLimitError) {
      await ctx.reply(MSG_RECEIPT_RATE_LIMIT)
      return
    }
    if (err instanceof CurrencyConversionError) {
      await ctx.reply(MSG_CURRENCY_UNAVAILABLE)
      return
    }
    await ctx.reply(MSG_RECEIPT_PARSE_FAILED)
    return
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @spend-again/bot test -- receipt.test.ts`
Expected: PASS — all three `formatMultiReceipt` tests green.

- [ ] **Step 9: Run the full bot test suite**

Run: `pnpm --filter @spend-again/bot test`
Expected: PASS — every test file in `apps/bot/__tests__/` green, including `expense.test.ts`, `receipt.test.ts`, and `receipt-confirm.test.ts` (unaffected).

- [ ] **Step 10: Type-check and lint**

Run: `pnpm --filter @spend-again/bot type-check && pnpm --filter @spend-again/bot lint`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add apps/bot/src/handlers/expense.ts apps/bot/src/handlers/receipt.ts apps/bot/__tests__/expense.test.ts apps/bot/__tests__/receipt.test.ts
git commit -m "feat(bot): show currency conversion in confirmations and handle rate-service failures"
```

---

### Final verification

- [ ] **Step 1: Run the full monorepo test suite**

Run: `pnpm turbo run test`
Expected: PASS across all packages (`@spend-again/shared`, `@spend-again/parser`, `@spend-again/bot`, `@spend-again/api`, `@spend-again/db`, dashboard) — the API/db/dashboard packages are untouched by this plan and should be unaffected.

- [ ] **Step 2: Run the full monorepo lint + type-check**

Run: `pnpm turbo run lint && pnpm turbo run type-check`
Expected: no errors.

- [ ] **Step 3: Manual smoke check (requires a real `EXCHANGERATE_API_KEY` in your local `.env`)**

Set `EXCHANGERATE_API_KEY` in your local `.env`, start the bot (`pnpm turbo run dev`), and in Telegram send:
- `"5.60 euro pasta 20 aug"` — expect a confirmation showing `€5.60 → S$X.XX` with a rate line, category resolved via Gemini.
- `"20 aug 5.60 euro pasta"` — expect the same result as above (word-order independence).
- `"$10 lunch"` — expect no conversion note, unchanged from current behavior.
- `"50 baht grab"` — expect it to resolve as Transport (via Gemini, not a coincidental Tier-1 "grab" match) with a THB conversion note.

This step is exploratory verification, not part of the automated test suite — no code changes are expected to come out of it unless it surfaces a bug, in which case stop and report back before continuing.
