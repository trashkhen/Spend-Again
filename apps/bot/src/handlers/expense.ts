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

// ── Description derivation ────────────────────────────────────────────────────

const PRICE_PREFIX_RE = /^(?:S\$|SGD\s*|\$)?\s*\d+(?:\.\d{1,2})?\s*/i
const PRICE_SUFFIX_RE = /\s*(?:S\$|SGD\s*|\$)\s*\d+(?:\.\d{1,2})?$/i

export function deriveDescription(raw: string): string | undefined {
  let s = raw.trim()
  s = s.replace(PRICE_PREFIX_RE, '')
  s = s.replace(PRICE_SUFFIX_RE, '')
  s = s.trim()
  return s.length > 0 ? s : undefined
}

// ── Pending confirmation store ─────────────────────────────────────────────────

export type PendingConfirmation = {
  result: ParseResult
  rawInput: string
  activeSpaceId?: string | undefined
  activeSpaceName?: string | undefined
  suggestedSpaceId?: string | undefined
  suggestedSpaceName?: string | undefined
}

/**
 * Stores pending parse results (+ raw input) keyed by chat ID while awaiting
 * user confirmation. rawInput is the original message text, needed by the
 * learn flow to derive the Tier-2 lookup key (regex item) so the saved
 * mapping key matches what the parser will search for next time.
 */
export const pendingConfirmations = new Map<number, PendingConfirmation>()

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

export function buildConfirmationMessage(entry: PendingConfirmation): string {
  const { result, activeSpaceName, suggestedSpaceName } = entry
  const emoji = getCategoryEmoji(result)
  const amount = fmtSGD(result.amount)
  const category = formatCategory(result)
  let msg = MSG_CONFIRM_PROMPT(emoji, amount, result.item, category)
  if (activeSpaceName) {
    msg += `\nSpace: ${activeSpaceName}`
  } else if (suggestedSpaceName) {
    msg += `\n\nThis falls during ${suggestedSpaceName}.\nAdd to Space?`
  }
  return msg
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

  // Attach human-readable description stripped of the price token
  const desc = deriveDescription(text)
  if (desc !== undefined) result.description = desc

  // Resolve active space or suggest one based on date window
  let activeSpaceId: string | undefined
  let activeSpaceName: string | undefined
  let suggestedSpaceId: string | undefined
  let suggestedSpaceName: string | undefined

  try {
    const activeSpace = await apiClient.getActiveSpace()
    if (activeSpace) {
      activeSpaceId = activeSpace.id
      activeSpaceName = `${activeSpace.emoji ?? '📦'} ${activeSpace.name}`
    } else if (result.date) {
      // result.date is DD/MM/YYYY — convert to YYYY-MM-DD for the API
      const parts = result.date.split('/')
      if (parts.length === 3) {
        const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`
        const windowSpaces = await apiClient.findSpacesForDate(isoDate)
        if (windowSpaces.length > 0 && windowSpaces[0]) {
          suggestedSpaceId = windowSpaces[0].id
          suggestedSpaceName = `${windowSpaces[0].emoji ?? '📦'} ${windowSpaces[0].name}`
        }
      }
    }
  } catch {
    // Space lookup failures must never block expense logging
  }

  const pendingEntry: PendingConfirmation = {
    result,
    rawInput: text,
    ...(activeSpaceId ? { activeSpaceId, activeSpaceName } : {}),
    ...(suggestedSpaceId ? { suggestedSpaceId, suggestedSpaceName } : {}),
  }
  pendingConfirmations.set(chatId, pendingEntry)
  const confirmationMsg = buildConfirmationMessage(pendingEntry)
  const hasSpaceSuggestion = !!(activeSpaceId ?? suggestedSpaceId)

  await ctx.reply(confirmationMsg, { reply_markup: buildConfirmKeyboard(hasSpaceSuggestion) })
}
