import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import { CATEGORY_MAP, GEMINI_MODEL, GEMINI_RPM_LIMIT, createLogger } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import type { ParseResult } from './regex.js'

const log = createLogger('parser:gemini')

// ---------------------------------------------------------------------------
// Typed error for rate-limit responses
// ---------------------------------------------------------------------------

export class GeminiRateLimitError extends Error {
  constructor() {
    super('Gemini rate limit exceeded (15 RPM)')
    this.name = 'GeminiRateLimitError'
  }
}

// ---------------------------------------------------------------------------
// Rate-limit queue — exported utility for callers to enforce 15 RPM cap
// ---------------------------------------------------------------------------

/**
 * Simple sliding-window rate-limit queue for the Gemini free tier (15 RPM).
 *
 * Callers (e.g. the parse() orchestrator) can call `waitForGeminiRpmBudget()`
 * before invoking `parseWithGemini` to avoid hitting the quota. This is kept
 * separate from `parseWithGemini` itself so that the queue state does not
 * interfere with unit tests (which run many calls in rapid succession).
 */
const _rpmTimestamps: number[] = []
const _MAX_RPM = GEMINI_RPM_LIMIT

/**
 * Wait until there is available capacity in the 15 RPM budget.
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
2. "amount" must be a number in DOLLARS (e.g. 8.50 for SGD 8.50). Do NOT convert to cents.
3. "item" is a short description of what was purchased (e.g. "Lunch at Amoy Street").
4. "category" must be one of the exact category names listed above, or null if unknown.
5. "subCategory" must be one of the valid sub-categories for the chosen category, or null.
6. "date" must be in DD/MM/YYYY format. If no date is mentioned, use today: ${today}.
7. If the input cannot be parsed as an expense, return null for all fields (keep amount as 0).

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
Output: {"amount":8.50,"item":"Lunch at Amoy","category":"Food","subCategory":"Hawker","date":"${today}"}

Input: "$12 NTUC groceries"
Output: {"amount":12,"item":"NTUC groceries","category":"Groceries","subCategory":"Supermarket","date":"${today}"}

Input: "grab home 15.30 yesterday"
Output: {"amount":15.30,"item":"Grab ride home","category":"Transport","subCategory":"Grab","date":"${getYesterdayDDMMYYYY()}"}

Now parse this input:
"${input}"

Respond with ONLY the JSON object.`
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getTodayDDMMYYYY(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = String(now.getFullYear())
  return `${dd}/${mm}/${yyyy}`
}

function getYesterdayDDMMYYYY(): string {
  const now = new Date()
  now.setDate(now.getDate() - 1)
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = String(now.getFullYear())
  return `${dd}/${mm}/${yyyy}`
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

  return { amount, item, category, subCategory, date }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function parseWithGemini(input: string): Promise<ParseResult | null> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const client = new GoogleGenerativeAI(apiKey)
  const model = client.getGenerativeModel({ model: GEMINI_MODEL })

  const prompt = buildPrompt(input)

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
