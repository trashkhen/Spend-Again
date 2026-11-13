import type { InlineKeyboard } from 'grammy'
import { parse } from '@spend-again/parser'
import type { ParseResult } from '@spend-again/parser'
import {
  createLogger,
  fmtSGD,
  getTodayDDMMYYYY,
  MSG_AUTOLOGGED,
  MSG_AUTOLOG_FAILED,
} from '@spend-again/shared'
import { tokenStore, userIdStore } from './api-client.js'
import type { ApiClient, IngestAuth } from './api-client.js'
import { pendingConfirmations, buildConfirmationMessage } from '../handlers/expense.js'
import type { PendingConfirmation } from '../handlers/expense.js'
import { buildConfirmKeyboard } from '../keyboards/confirm.js'
import { buildAutologKeyboard } from '../keyboards/autolog.js'

export type { IngestAuth } from './api-client.js'

const log = createLogger('bot:ingest')

// ── Types ─────────────────────────────────────────────────────────────────────

/** What a phone automation reports. `text` is "<amount> <merchant>". */
export type IngestRequest = { source: 'wallet'; text: string; card?: string }

export type IngestOutcome = 'saved' | 'asked' | 'failed'

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

/** Below this the category is a guess, so the bot asks before saving. */
export const INGEST_AUTOSAVE_MIN_CONFIDENCE = 0.8

/** Two captures of the same amount this close together are flagged as a possible duplicate. */
export const INGEST_DUPLICATE_WINDOW_MS = 180_000

// ── Duplicate tracking ────────────────────────────────────────────────────────

type RecentCapture = { amountCents: number; at: number }

/** userId → recent auto-saves. In-memory is enough: the window is 3 minutes. */
const recentCaptures = new Map<string, RecentCapture[]>()

/** Test hook: forget every recent capture. */
export function clearIngestState(): void {
  recentCaptures.clear()
}

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

// ── Text helpers ──────────────────────────────────────────────────────────────

/**
 * Shortcuts formats the Wallet amount for display ("S$1,234.00"); the parser
 * expects plain decimals. Strips thousands separators that sit between
 * digits and tidies whitespace. Commas elsewhere (merchant names) are kept.
 */
export function normalizeWalletText(text: string): string {
  return text
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function describeVia(req: IngestRequest): string {
  const card = req.card?.trim()
  return card !== undefined && card.length > 0 ? `Apple Pay (${card})` : 'Apple Pay'
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Turns one reported payment into a saved expense (or a question, or a
 * failure notice). Every path except a successful save-and-notify tells the
 * user something, so a payment is never dropped silently.
 */
export async function processIngest(
  auth: IngestAuth,
  req: IngestRequest,
  deps: IngestDeps,
): Promise<IngestOutcome> {
  const chatId = Number(auth.telegramId)
  const api = deps.makeClient(auth.token)

  // The Edit / Confirm buttons run through handlers that read these stores.
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

  const fail = async (result?: ParseResult | null): Promise<IngestOutcome> => {
    const amount = result && result.amount > 0 ? fmtSGD(result.amount) : undefined
    const item = result && result.item.length > 0 ? result.item : undefined
    await notify(MSG_AUTOLOG_FAILED(amount, item))
    return 'failed'
  }

  const parsedText = normalizeWalletText(req.text)

  let result: ParseResult | null
  try {
    result = await parse(parsedText, { lookupItem: (name) => api.getLearnedMapping(name) })
  } catch (err) {
    log.warn({ err }, 'auto-capture parse failed')
    return fail()
  }

  if (result === null || result.amount <= 0) {
    return fail(result)
  }

  const confident =
    result.category !== undefined &&
    result.subCategory !== undefined &&
    result.confidence >= INGEST_AUTOSAVE_MIN_CONFIDENCE

  if (!confident || result.category === undefined || result.subCategory === undefined) {
    // A second question would silently replace the one already on screen.
    if (pendingConfirmations.has(chatId)) {
      return fail(result)
    }
    const entry: PendingConfirmation = { result, rawInput: parsedText }
    pendingConfirmations.set(chatId, entry)
    await notify(buildConfirmationMessage(entry), buildConfirmKeyboard())
    return 'asked'
  }

  const date = result.date ?? getTodayDDMMYYYY()
  const saved = await api.createTransaction({
    userId: auth.userId,
    amountCents: result.amount,
    item: result.item,
    description: result.item,
    category: result.category,
    subCategory: result.subCategory,
    date,
    source: req.source,
    tier: result.tier,
    confidence: result.confidence,
  })

  if (saved === null) {
    return fail(result)
  }

  const duplicate = noteCapture(auth.userId, result.amount, deps.now())

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
    MSG_AUTOLOGGED(
      fmtSGD(result.amount),
      result.item,
      `${result.category} / ${result.subCategory}`,
      describeVia(req),
      date,
      duplicate,
    ),
    buildAutologKeyboard(saved.id),
  )
  return 'saved'
}
