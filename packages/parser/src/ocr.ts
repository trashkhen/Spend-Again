import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import { CATEGORY_MAP, GEMINI_MODEL, OcrRateLimitError } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import type { ParseResult } from './regex.js'
import { waitForGeminiRpmBudget } from './gemini.js'

// ---------------------------------------------------------------------------
// OCR-specific result types
// ---------------------------------------------------------------------------

/** A single line item extracted from a receipt. */
export type ReceiptLineItem = {
  item: string
  amount: number // integer cents
  category?: Category
  subCategory?: SubCategory
}

/** Result for a multi-item receipt (e.g. supermarket). */
export type MultiItemReceiptResult = {
  type: 'multi'
  items: ReceiptLineItem[]
  total: number // integer cents (sum of items or extracted total)
  date?: string // DD/MM/YYYY
}

/** Result for a simple receipt (single charge, e.g. hawker, restaurant). */
export type SimpleReceiptResult = {
  type: 'simple'
  item: string
  amount: number // integer cents
  category?: Category
  subCategory?: SubCategory
  date?: string // DD/MM/YYYY
}

/** Failure result when image is unreadable. */
export type ReceiptErrorResult = {
  type: 'error'
  reason: string
}

export type OcrResult = MultiItemReceiptResult | SimpleReceiptResult | ReceiptErrorResult

// Re-export the rate-limit error so existing parser callers keep working.
// Canonical class lives in @spend-again/shared.
export { OcrRateLimitError }

// ---------------------------------------------------------------------------
// Internal Gemini JSON shapes
// ---------------------------------------------------------------------------

type GeminiLineItem = {
  item: string
  amount: number
  category: string | null
  subCategory: string | null
}

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
  // error
  reason?: string
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildCategoryList(): string {
  return Object.entries(CATEGORY_MAP)
    .map(([cat, subs]) => `  ${cat}: [${subs.join(', ')}]`)
    .join('\n')
}

export function buildOcrPrompt(): string {
  const categoryList = buildCategoryList()
  const today = getTodayDDMMYYYY()

  return `You are a Singapore receipt parser. Analyse the attached receipt image and extract structured expense data.

VALID CATEGORIES (use ONLY these exact values):
${categoryList}

RULES:
1. Return ONLY a JSON object — no markdown fences, no explanation.
2. All amounts must be numbers in DOLLARS (e.g. 8.50 for S$8.50). Do NOT convert to cents.
3. Dates must be in DD/MM/YYYY format. If no date visible, use today: ${today}.
4. "category" and "subCategory" must use exact names from the list above, or null if unknown.
5. If the image is unreadable or not a receipt, return {"type":"error","reason":"<brief reason>"}.

RECEIPT TYPES:
- For a receipt with MULTIPLE line items (supermarket, department store):
  Return: {"type":"multi","items":[{"item":"...", "amount":x.xx, "category":"...", "subCategory":"..."},...], "total":x.xx, "date":"DD/MM/YYYY"}
  Each item should have its own category/subCategory based on what it is.

- For a SIMPLE single-charge receipt (hawker, grab, restaurant bill, clinic):
  Return: {"type":"simple","item":"<description>","amount":x.xx,"category":"...","subCategory":"...","date":"DD/MM/YYYY"}

SINGAPORE CONTEXT:
- Hawker centres, kopitiam, food courts → Food / Hawker
- NTUC FairPrice, Cold Storage, Giant, Sheng Siong → Groceries / Supermarket
- Grab / GoJek → Transport / Grab or Transport / Gojek
- MRT / bus / EZ-Link → Transport / MRT/Bus
- Guardian, Watsons → Health / Pharmacy
- Popular, MPH → Shopping / Books
- Lazada, Shopee → Shopping / Online Shopping

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

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

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

function resolveCategory(
  rawCategory: string | null | undefined,
  rawSub: string | null | undefined,
): { category?: Category; subCategory?: SubCategory } {
  if (rawCategory === null || rawCategory === undefined || !isValidCategory(rawCategory)) {
    return {}
  }
  const category: Category = rawCategory
  if (rawSub !== null && rawSub !== undefined && isValidSubCategory(category, rawSub)) {
    return { category, subCategory: rawSub as SubCategory }
  }
  return { category }
}

/** Convert a dollar-amount number to integer cents. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

function parseGeminiJSON(raw: string): GeminiReceiptJSON | null {
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
  const type = obj['type']
  if (type !== 'multi' && type !== 'simple' && type !== 'error') return null

  return obj as unknown as GeminiReceiptJSON
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Send a receipt image buffer to Gemini Vision and return structured OCR data.
 *
 * @param imageData - Raw image bytes (JPEG, PNG, or WebP)
 * @param mimeType  - MIME type of the image
 * @returns Structured OCR result, or null when the API call itself fails
 */
export async function parseReceiptWithOcr(
  imageData: Uint8Array,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<OcrResult | null> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const client = new GoogleGenerativeAI(apiKey)
  // Use a vision-capable model
  const model = client.getGenerativeModel({ model: GEMINI_MODEL })

  const prompt = buildOcrPrompt()

  await waitForGeminiRpmBudget()

  let rawText: string
  try {
    const result = await model.generateContent([
      {
        inlineData: {
          data: Buffer.from(imageData).toString('base64'),
          mimeType,
        },
      },
      prompt,
    ])
    rawText = result.response.text()
  } catch (err) {
    if (err instanceof GoogleGenerativeAIFetchError && err.status === 429) {
      throw new OcrRateLimitError()
    }
    throw err
  }

  const parsed = parseGeminiJSON(rawText)
  if (parsed === null) return null

  // Error result
  if (parsed.type === 'error') {
    return {
      type: 'error',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'Unreadable image',
    }
  }

  // Simple result
  if (parsed.type === 'simple') {
    const amount = typeof parsed.amount === 'number' ? toCents(parsed.amount) : 0
    const item = typeof parsed.item === 'string' ? parsed.item : 'Unknown'
    const { category, subCategory } = resolveCategory(
      parsed.category as string | null | undefined,
      parsed.subCategory as string | null | undefined,
    )

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

    return simpleResult
  }

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

    const multiResult: MultiItemReceiptResult = { type: 'multi', items, total: extractedTotal }

    if (typeof parsed.date === 'string' && parsed.date.trim().length > 0) {
      multiResult.date = parsed.date.trim()
    }

    return multiResult
  }

  return null
}

// ---------------------------------------------------------------------------
// Convenience adapter — convert a SimpleReceiptResult to a ParseResult
// so the existing confirmation flow can handle simple receipts uniformly.
// ---------------------------------------------------------------------------

export function simpleReceiptToParseResult(result: SimpleReceiptResult): ParseResult {
  return {
    amount: result.amount,
    item: result.item,
    confidence: 0.85,
    tier: 3,
    ...(result.category !== undefined ? { category: result.category } : {}),
    ...(result.subCategory !== undefined ? { subCategory: result.subCategory } : {}),
    ...(result.date !== undefined ? { date: result.date } : {}),
  }
}
