import type { InlineKeyboard } from 'grammy'
import {
  convertToSGD,
  lookupMerchant,
  parseWithGemini,
  waitForGeminiRpmBudget,
} from '@spend-again/parser'
import {
  createLogger,
  fmtCurrency,
  fmtSGD,
  getTodayDDMMYYYY,
  DEFAULT_CATEGORY,
  DEFAULT_SUB_CATEGORY,
  MSG_AUTOLOGGED,
  MSG_AUTOLOG_FAILED,
} from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import { tokenStore, userIdStore } from './api-client.js'
import type { ApiClient, IngestAuth } from './api-client.js'
import { buildAutologKeyboard } from '../keyboards/autolog.js'
import { rememberAutologMerchant, clearAutologMerchants } from './autolog-merchants.js'

export { autologMerchantFor } from './autolog-merchants.js'

export type { IngestAuth } from './api-client.js'

const log = createLogger('bot:ingest')

// ── Types ─────────────────────────────────────────────────────────────────────

/** What a phone automation reports. `text` is "<amount> <merchant>". */
export type IngestRequest = { source: 'wallet'; text: string; card?: string }

export type IngestOutcome = 'saved' | 'failed'

/** The slice of ApiClient that auto-capture needs. */
export type IngestApi = Pick<
  ApiClient,
  'createTransaction' | 'getLearnedMapping' | 'getActiveSpace' | 'attachTransactionToSpace'
>

export type IngestDeps = {
  send: (chatId: number, text: string, keyboard?: InlineKeyboard) => Promise<void>
  /**
   * Builds an API client bound to the capture's own token. The shared
   * `apiClient` singleton holds one mutable token, and a capture can arrive
   * while another user's Telegram update is mid-flight.
   */
  makeClient: (token: string) => IngestApi
  now: () => number
}

/** Two captures of the same amount this close together are flagged as a possible duplicate. */
export const INGEST_DUPLICATE_WINDOW_MS = 180_000

const NO_MERCHANT_ITEM = 'Apple Pay payment'

// ── Wallet text ───────────────────────────────────────────────────────────────

export type WalletPayment = {
  /** Hundredths of `currency` (so ¥1,200 is 120000). */
  amountCents: number
  /** ISO 4217 code. */
  currency: string
  merchant: string
}

/**
 * Currency markers Wallet may put in front of an amount. A bare `$` is taken
 * as SGD: on a Singapore-region phone other dollars carry a prefix.
 */
const CURRENCY_PREFIXES: Record<string, string> = {
  'S$': 'SGD',
  $: 'SGD',
  'US$': 'USD',
  'A$': 'AUD',
  'AU$': 'AUD',
  'NZ$': 'NZD',
  'C$': 'CAD',
  'CA$': 'CAD',
  'HK$': 'HKD',
  'NT$': 'TWD',
  '\u{20AC}': 'EUR',
  '\u{00A3}': 'GBP',
  '\u{00A5}': 'JPY',
  'JP\u{00A5}': 'JPY',
  'CN\u{00A5}': 'CNY',
  RM: 'MYR',
  Rp: 'IDR',
  '\u{20A9}': 'KRW',
  '\u{0E3F}': 'THB',
  '\u{20B9}': 'INR',
  '\u{20AB}': 'VND',
  '\u{20B1}': 'PHP',
}

// <marker><number> <merchant>. The marker is any run of non-digit,
// non-space characters (so "S$", "US$", "€", "RM", "SGD"), optionally
// separated from the number by a space. A minus sign anywhere before the
// number never matches, which is how refunds are kept out.
const WALLET_RE = /^([^\d\s\-\u{2212}]*)\s?(\d[\d,]*(?:\.\d{1,2})?)(?:\s+(.*))?$/u

/**
 * Splits what the Shortcut sends into amount, currency and merchant.
 *
 * This is deliberately not the free-text expense parser: that one looks for
 * dates and currency words anywhere in the message, so a merchant called
 * "May Flower" or "Yen Yakiniku" would change the amount or the date. Here
 * the amount is always the first token and everything after it is the name.
 *
 * Returns null for refunds, zero amounts, unknown currency markers and text
 * with no leading amount.
 */
export function parseWalletText(text: string): WalletPayment | null {
  const match = WALLET_RE.exec(text.replace(/\s+/g, ' ').trim())
  if (match === null) return null

  const marker = match[1] ?? ''
  const currency =
    marker === ''
      ? 'SGD'
      : (CURRENCY_PREFIXES[marker] ?? (/^[A-Z]{3}$/.test(marker) ? marker : undefined))
  if (currency === undefined) return null

  const amountCents = Math.round(Number((match[2] ?? '').replace(/,/g, '')) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null

  return { amountCents, currency, merchant: (match[3] ?? '').trim() }
}

// ── Duplicate tracking ────────────────────────────────────────────────────────

type RecentCapture = { amountCents: number; at: number }

/** userId → recent auto-saves. In-memory is enough: the window is 3 minutes. */
const recentCaptures = new Map<string, RecentCapture[]>()

/** Records a save and reports whether the same amount was saved within the window. */
function noteCapture(userId: string, amountCents: number, now: number): boolean {
  const fresh = (recentCaptures.get(userId) ?? []).filter(
    (c) => now - c.at <= INGEST_DUPLICATE_WINDOW_MS,
  )
  const duplicate = fresh.some((c) => c.amountCents === amountCents)
  fresh.push({ amountCents, at: now })
  recentCaptures.set(userId, fresh)
  return duplicate
}

/** Test hook: forget recent captures and remembered merchants. */
export function clearIngestState(): void {
  recentCaptures.clear()
  clearAutologMerchants()
}

// ── Categorisation ────────────────────────────────────────────────────────────

type Categorised = { category: Category; subCategory: SubCategory; tier: 1 | 2 | 3; confidence: number }

/**
 * Built-in map, then what the user has taught the bot, then Gemini. Only the
 * category is ever taken from these — the amount, date and name come from
 * Wallet. Returns null when nothing knows the merchant (or Gemini is busy);
 * the payment is still saved, under the default category.
 */
async function categorise(payment: WalletPayment, api: IngestApi): Promise<Categorised | null> {
  if (payment.merchant.length === 0) return null

  const builtIn = lookupMerchant(payment.merchant)
  if (builtIn !== undefined) return { ...builtIn, tier: 1, confidence: 0.9 }

  const learned = await api.getLearnedMapping(payment.merchant.toLowerCase())
  if (learned !== null) {
    return { category: learned.category, subCategory: learned.subCategory, tier: 2, confidence: learned.confidence }
  }

  try {
    await waitForGeminiRpmBudget()
    const guess = await parseWithGemini(`${(payment.amountCents / 100).toFixed(2)} ${payment.merchant}`)
    if (guess !== null && guess.category !== undefined && guess.subCategory !== undefined) {
      return { category: guess.category, subCategory: guess.subCategory, tier: 3, confidence: guess.confidence }
    }
  } catch (err) {
    log.warn({ err }, 'auto-capture categorisation unavailable')
  }
  return null
}

function describeVia(req: IngestRequest): string {
  const card = req.card?.trim()
  return card !== undefined && card.length > 0 ? `Apple Pay (${card})` : 'Apple Pay'
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Turns one reported payment into a saved expense and a Telegram message.
 *
 * A payment whose category is unknown is still saved (under the default
 * category, flagged in the message) rather than parked behind a question:
 * a parked payment can be overwritten or forgotten, a saved one cannot.
 * Whatever cannot be saved is reported, so nothing is dropped silently.
 */
export async function processIngest(
  auth: IngestAuth,
  req: IngestRequest,
  deps: IngestDeps,
): Promise<IngestOutcome> {
  const chatId = Number(auth.telegramId)
  const api = deps.makeClient(auth.token)

  // The Edit / Delete buttons run through handlers that read these stores.
  tokenStore.set(chatId, auth.token)
  userIdStore.set(chatId, auth.userId)

  const notify = async (text: string, keyboard?: InlineKeyboard): Promise<void> => {
    try {
      await deps.send(chatId, text, keyboard)
    } catch (err) {
      // Never log `text` or the request body: they carry payment details.
      log.error({ err }, 'auto-capture notification failed')
    }
  }

  const fail = async (amount?: string, merchant?: string): Promise<IngestOutcome> => {
    await notify(
      MSG_AUTOLOG_FAILED(amount, merchant !== undefined && merchant.length > 0 ? merchant : undefined),
    )
    return 'failed'
  }

  const payment = parseWalletText(req.text)
  if (payment === null) return fail()

  // Everything is stored in SGD; a foreign tap is converted at today's rate.
  let amountCents = payment.amountCents
  let original: string | undefined
  if (payment.currency !== 'SGD') {
    original = fmtCurrency(payment.amountCents, payment.currency)
    try {
      amountCents = (await convertToSGD(payment.amountCents, payment.currency)).convertedCents
    } catch (err) {
      log.warn({ err, currency: payment.currency }, 'auto-capture currency conversion failed')
      return fail(original, payment.merchant)
    }
    if (amountCents <= 0) return fail(original, payment.merchant)
  }

  const categorised = await categorise(payment, api)
  const item = payment.merchant.length > 0 ? payment.merchant : NO_MERCHANT_ITEM
  const category = categorised?.category ?? (DEFAULT_CATEGORY as Category)
  const subCategory = categorised?.subCategory ?? (DEFAULT_SUB_CATEGORY as SubCategory)
  const date = getTodayDDMMYYYY()

  const saved = await api.createTransaction({
    userId: auth.userId,
    amountCents,
    item,
    description: item,
    category,
    subCategory,
    date,
    source: req.source,
    ...(categorised !== null ? { tier: categorised.tier, confidence: categorised.confidence } : {}),
  })

  if (saved === null) return fail(fmtSGD(amountCents), payment.merchant)

  const duplicate = noteCapture(auth.userId, amountCents, deps.now())
  rememberAutologMerchant(saved.id, payment.merchant)

  try {
    const activeSpace = await api.getActiveSpace()
    if (activeSpace) {
      await api.attachTransactionToSpace(saved.id, activeSpace.id)
    }
  } catch (err) {
    // Space problems must never undo or hide a logged expense.
    log.error({ err }, 'auto-capture space attach failed')
  }

  await notify(
    MSG_AUTOLOGGED(fmtSGD(amountCents), item, `${category} / ${subCategory}`, describeVia(req), date, {
      duplicate,
      unsure: categorised === null,
      ...(original !== undefined ? { original } : {}),
    }),
    buildAutologKeyboard(saved.id),
  )
  return 'saved'
}
