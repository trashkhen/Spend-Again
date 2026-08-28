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
