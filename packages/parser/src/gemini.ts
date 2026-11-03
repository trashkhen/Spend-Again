import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import { CATEGORY_MAP, GEMINI_MODEL, GEMINI_RPM_LIMIT, createLogger, GeminiRateLimitError, getTodayDDMMYYYY, getYesterdayDDMMYYYY } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import type { ParseResult } from './regex.js'

const log = createLogger('parser:gemini')

// Re-export so existing imports from '@spend-again/parser' keep working.
// (The canonical class lives in @spend-again/shared so it can be thrown and
// caught across the API/bot/parser boundary without duplication.)
export { GeminiRateLimitError }

// ---------------------------------------------------------------------------
// Rate-limit queue — enforce the Gemini free-tier RPM cap (GEMINI_RPM_LIMIT)
// ---------------------------------------------------------------------------

/**
 * Simple sliding-window rate-limit queue for the Gemini free tier.
 *
 * Callers (e.g. the parse() orchestrator) can call `waitForGeminiRpmBudget()`
 * before invoking `parseWithGemini` to avoid hitting the quota. This is kept
 * separate from `parseWithGemini` itself so that the queue state does not
 * interfere with unit tests (which run many calls in rapid succession).
 */
const _rpmTimestamps: number[] = []
const _MAX_RPM = GEMINI_RPM_LIMIT

/**
 * Wait until there is available capacity in the GEMINI_RPM_LIMIT budget.
 * Call this before each `parseWithGemini` invocation in production code.
 */
export async function waitForGeminiRpmBudget(): Promise<void> {
  const now = Date.now()
  while (_rpmTimestamps.length > 0 && now - (_rpmTimestamps[0] ?? 0) >= 60_000) {
    _rpmTimestamps.shift()
  }

  if (_rpmTimestamps.length >= _MAX_RPM) {
    const oldest = _rpmTimestamps[0] ?? now
    const waitMs = 60_000 - (now - oldest) + 100
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
    return waitForGeminiRpmBudget()
  }

  _rpmTimestamps.push(Date.now())
}

/** Clear the RPM tracking state (primarily for testing). */
export function clearGeminiRpmState(): void {
  _rpmTimestamps.length = 0
}

// ---------------------------------------------------------------------------
// Internal shape of the JSON Gemini is expected to return
// ---------------------------------------------------------------------------

type GeminiExpenseJSON = {
  amount: number
  item: string
  category: string | null
  subCategory: string | null
  date: string | null
  currency: string | null
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildCategoryList(): string {
  return Object.entries(CATEGORY_MAP)
    .map(([cat, subs]) => `  ${cat}: [${subs.join(', ')}]`)
    .join('\n')
}

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

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

// Extract the first {...} block from an arbitrary string.
function extractJSON(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + 1)
}

function isValidCategory(value: string): value is Category {
  return value in CATEGORY_MAP
}

function isValidSubCategory(category: Category, value: string): value is SubCategory {
  const subs = CATEGORY_MAP[category] as readonly string[]
  return subs.includes(value)
}

function parseGeminiJSON(raw: string): GeminiExpenseJSON | null {
  const jsonStr = extractJSON(raw)
  if (jsonStr === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const obj = parsed as Record<string, unknown>

  const amount = typeof obj['amount'] === 'number' ? obj['amount'] : null
  if (amount === null) return null

  const item = typeof obj['item'] === 'string' ? obj['item'] : ''
  const category = typeof obj['category'] === 'string' ? obj['category'] : null
  const subCategory = typeof obj['subCategory'] === 'string' ? obj['subCategory'] : null
  const date = typeof obj['date'] === 'string' ? obj['date'] : null
  const currency = typeof obj['currency'] === 'string' ? obj['currency'] : null

  return { amount, item, category, subCategory, date, currency }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Hard cap on a single Gemini call. Observed latency is 1.5–7s, so 20s leaves
 * room for slow responses while still failing fast on a hung request.
 */
const GEMINI_REQUEST_TIMEOUT_MS = 20_000

export async function parseWithGemini(input: string): Promise<ParseResult | null> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const client = new GoogleGenerativeAI(apiKey)
  const model = client.getGenerativeModel({ model: GEMINI_MODEL }, { timeout: GEMINI_REQUEST_TIMEOUT_MS })

  const prompt = buildPrompt(input)

  let rawText: string
  try {
    const result = await model.generateContent(prompt)
    rawText = result.response.text()
  } catch (err) {
    if (err instanceof GoogleGenerativeAIAbortError) {
      // Surfaces to the user as the same "AI a bit busy, try again" reply.
      log.error({ timeoutMs: GEMINI_REQUEST_TIMEOUT_MS }, 'Gemini request timed out')
      throw new GeminiRateLimitError()
    }
    if (err instanceof GoogleGenerativeAIFetchError && (err.status === 429 || err.status === 503)) {
      log.error({ status: err.status, message: err.message, errorDetails: err.errorDetails }, 'rate limit / unavailable from API')
      throw new GeminiRateLimitError()
    }
    throw err
  }

  const geminiData = parseGeminiJSON(rawText)
  if (geminiData === null) return null

  // Convert dollars to integer cents
  const amountCents = Math.round(geminiData.amount * 100)

  const parseResult: ParseResult = {
    amount: amountCents,
    item: geminiData.item,
    confidence: 0.85,
    tier: 3,
  }

  if (geminiData.date !== null && geminiData.date.trim().length > 0) {
    parseResult.date = geminiData.date
  }

  if (
    geminiData.currency !== null &&
    geminiData.currency.trim().length > 0 &&
    geminiData.currency.trim().toUpperCase() !== 'SGD'
  ) {
    parseResult.currency = geminiData.currency.trim().toUpperCase()
  }

  if (geminiData.category !== null && isValidCategory(geminiData.category)) {
    parseResult.category = geminiData.category
    if (
      geminiData.subCategory !== null &&
      isValidSubCategory(geminiData.category, geminiData.subCategory)
    ) {
      parseResult.subCategory = geminiData.subCategory as SubCategory
    }
  }

  return parseResult
}

// ---------------------------------------------------------------------------
// Space Parsing with Gemini
// ---------------------------------------------------------------------------

export type ParsedSpaceResult = {
  name: string
  emoji?: string | null
  budgetCents?: number | null
  startDate?: string | null
  endDate?: string | null
}

export function buildSpacePrompt(input: string): string {
  const today = new Date()
  const year = today.getFullYear()
  const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD

  return `You are a Singapore expense and financial planner assistant. Extract structured Space details from the user's free-text input. A Space represents a trip, project, semester, or budget category.

VALID JSON SHAPE (you MUST return ONLY this JSON shape, nothing else):
{
  "name": "string",
  "emoji": "single emoji or null",
  "budgetCents": number or null,
  "startDate": "YYYY-MM-DD" or null,
  "endDate": "YYYY-MM-DD" or null
}

RULES:
1. Return ONLY the JSON object — no markdown fences, no code blocks, no explanation.
2. "name" should be a concise, clean name for the space (e.g. "Bali Trip" or "JB Weekend" or "Exchange").
3. "budgetCents" must be the budget in integer cents (e.g. 50000 for $500, or 2000000 for $20000). If no budget is specified, return null.
4. "startDate" and "endDate" must be in YYYY-MM-DD format.
5. If the input mentions a duration (e.g. "for 5 days from 23 june"), calculate the start date and end date accordingly. E.g., June 23 to June 27 is 5 days inclusive, so startDate is "2026-06-23" and endDate is "2026-06-27".
6. "emoji" should be a single emoji character that best represents the space theme (e.g. "🏖️" for beach/holiday, "🎓" for school/university, "🛫" for travel, "🎉" for events, "🍽️" for food outings). If no clear emoji fits, return null.
7. Assume dates are in the future or present relative to today: ${todayStr} (current year: ${year}). If no year is specified for a date, use the current year ${year} (or the next year if the date has already passed and it makes sense, but default to ${year}).

EXAMPLES:
Input: "Bali Trip from 03/06 to 08/06 budget $500"
Output: {"name":"Bali Trip","emoji":"🏖️","budgetCents":50000,"startDate":"${year}-06-03","endDate":"${year}-06-08"}

Input: "JB Weekend budget $250"
Output: {"name":"JB Weekend","emoji":"🛫","budgetCents":25000,"startDate":null,"endDate":null}

Input: "NUS Semester"
Output: {"name":"NUS Semester","emoji":"🎓","budgetCents":null,"startDate":null,"endDate":null}

Input: "I'm going to bali for 5 days from 23 june"
Output: {"name":"Bali Trip","emoji":"🏖️","budgetCents":null,"startDate":"${year}-06-23","endDate":"${year}-06-27"}

Input: "Exchange from 23 Aug to 31 Dec budget $20000"
Output: {"name":"Exchange","emoji":"🎓","budgetCents":2000000,"startDate":"${year}-08-23","endDate":"${year}-12-31"}

Now parse this input:
"${input}"

Respond with ONLY the JSON object.`
}

export async function parseSpaceWithGemini(input: string): Promise<ParsedSpaceResult | null> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const client = new GoogleGenerativeAI(apiKey)
  const model = client.getGenerativeModel({ model: GEMINI_MODEL })

  const prompt = buildSpacePrompt(input)

  let rawText: string
  try {
    const result = await model.generateContent(prompt)
    rawText = result.response.text()
  } catch (err) {
    if (err instanceof GoogleGenerativeAIFetchError && (err.status === 429 || err.status === 503)) {
      log.error({ status: err.status, message: err.message, errorDetails: err.errorDetails }, 'rate limit / unavailable from API')
      throw new GeminiRateLimitError()
    }
    throw err
  }

  const jsonStr = extractJSON(rawText)
  if (jsonStr === null) return null

  try {
    const parsed = JSON.parse(jsonStr)
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    
    const name = typeof obj['name'] === 'string' ? obj['name'] : ''
    if (!name) return null

    const emoji = typeof obj['emoji'] === 'string' && obj['emoji'].length > 0
      ? obj['emoji']
      : null

    const budgetCents = typeof obj['budgetCents'] === 'number' ? obj['budgetCents'] : null
    const startDate = typeof obj['startDate'] === 'string' ? obj['startDate'] : null
    const endDate = typeof obj['endDate'] === 'string' ? obj['endDate'] : null

    return { name, emoji, budgetCents, startDate, endDate }
  } catch {
    return null
  }
}

