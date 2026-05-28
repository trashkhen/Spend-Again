import type { Context } from 'grammy'
import { parse, GeminiRateLimitError } from '@spend-again/parser'
import type { ParseResult } from '@spend-again/parser'
import {
  MSG_NOT_REGISTERED,
  MSG_PARSE_FAILED,
  MSG_CONFIRM_PROMPT,
  CATEGORY_EMOJI,
  fmtSGD,
} from '@spend-again/shared'
import { tokenStore, loginViaTelegram, apiClient } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'
import { buildConfirmKeyboard } from '../keyboards/confirm.js'

// ── Pending confirmation store ─────────────────────────────────────────────────

/**
 * Stores pending parse results keyed by chat ID while awaiting user confirmation.
 * Exported so confirm.ts can read and clear entries.
 */
export const pendingConfirmations = new Map<number, ParseResult>()

// ── Expense heuristic ─────────────────────────────────────────────────────────

/**
 * Returns true if the message text looks like an expense entry.
 * Matches:
 *   - Messages starting with $, S$, or SGD
 *   - Messages starting with a bare number (e.g. "10 chicken rice")
 */
function looksLikeExpense(text: string): boolean {
  // Amount at start: "$5 chicken rice", "5.50 kopi", "SGD 8 lunch"
  // Currency-prefixed amount anywhere: "chicken rice $5", "lunch S$8.50"
  return /^(?:S\$|SGD\s*|\$|\d)|(?:S\$|SGD\s*|\$)\s*\d+(?:\.\d{1,2})?/.test(text.trim())
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatCategory(result: ParseResult): string {
  if (result.category !== undefined && result.subCategory !== undefined) {
    return `${result.category}/${result.subCategory}`
  }
  if (result.category !== undefined) {
    return result.category
  }
  return 'Unknown'
}

function getCategoryEmoji(result: ParseResult): string {
  if (result.category !== undefined) {
    return CATEGORY_EMOJI[result.category] ?? '\u{1F4B0}'
  }
  return '\u{1F4B0}'
}

// ── Confirmation message builder ──────────────────────────────────────────────

export function buildConfirmationMessage(result: ParseResult): string {
  const emoji = getCategoryEmoji(result)
  const amount = fmtSGD(result.amount)
  const category = formatCategory(result)
  return MSG_CONFIRM_PROMPT(emoji, amount, result.item, category)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function expenseHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id

  if (text === undefined || telegramId === undefined || chatId === undefined) {
    return
  }

  // Skip commands
  if (text.startsWith('/')) {
    return
  }

  // Only handle messages that look like expenses
  if (!looksLikeExpense(text)) {
    return
  }

  // Check if user is linked (has a JWT); tokenStore may be empty after a process restart
  let token = tokenStore.get(telegramId)
  if (token === undefined && ctx.from !== undefined) {
    const auth = await loginViaTelegram(ctx.from)
    token = auth?.token
  }
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  // Set token on API client so getLearnedMapping can authenticate
  apiClient.setToken(token)

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
    throw err
  }

  if (result === null) {
    await ctx.reply(MSG_PARSE_FAILED)
    return
  }

  // Store pending confirmation
  pendingConfirmations.set(chatId, result)

  const confirmationMsg = buildConfirmationMessage(result)
  const keyboard = buildConfirmKeyboard()

  await ctx.reply(confirmationMsg, { reply_markup: keyboard })
}
