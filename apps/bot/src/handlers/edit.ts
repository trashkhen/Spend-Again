import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import {
  MSG_NOT_REGISTERED,
  CATEGORIES,
  CATEGORY_MAP,
  CATEGORY_EMOJI,
  fmtSGD,
  fmtCurrency,
  occurredOnToDisplay,
  occurredOnToFullDisplay,
  ddmmyyyyToIso,
} from '@spend-again/shared'
import type { Category } from '@spend-again/shared'
import { convertToSGD } from '@spend-again/parser'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
import type { UpdateTransactionInput } from '../lib/api-client.js'
import { autologMerchantFor } from '../lib/autolog-merchants.js'
import { parseEditAmount, parseEditDate } from '../lib/edit-input.js'
import { DASHBOARD_URL } from '../lib/env.js'

/** An open edit: the transaction as last saved, and which field is awaiting typed input. */
export type EditSession = {
  txId: string
  amountCents: number
  item: string
  category: string
  subCategory: string
  occurredOn: string // YYYY-MM-DD
  awaiting: 'amount' | 'name' | 'date' | null
  /** One-off line shown under the summary, e.g. "€12.00 → S$16.20". */
  note?: string | undefined
  /** Top-level category tapped, while its sub-categories are on screen. */
  chosenCategory?: Category | undefined
  expiresAt: number
}

export const EDIT_SESSION_MS = 10 * 60_000

export const editSessions = new Map<number, EditSession>() // chatId → session

const EXPIRED_MSG = 'That edit timed out lah \u{23F1} Tap Edit again.'

// ── Keyboards and text ───────────────────────────────────────────────────────

function summary(s: EditSession): string {
  const lines = [
    '\u{270F}\u{FE0F} Editing',
    `${fmtSGD(s.amountCents)} \u{00B7} ${s.item}`,
    `${s.category} / ${s.subCategory} \u{00B7} ${occurredOnToFullDisplay(s.occurredOn)}`,
  ]
  if (s.note !== undefined) lines.push('', s.note)
  return lines.join('\n')
}

function pickerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('\u{1F4B0} Amount', 'ef:amount')
    .text('\u{1F4DD} Name', 'ef:name')
    .row()
    .text('\u{1F3F7} Category', 'ef:cat')
    .text('\u{1F4C5} Date', 'ef:date')
    .row()
    .text('\u{2705} Done', 'ef:done')
}

function categoryKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
  CATEGORIES.forEach((cat, i) => {
    kb.text(`${CATEGORY_EMOJI[cat] ?? ''} ${cat}`.trim(), `ec:${i}`)
    if (i % 2 === 1) kb.row()
  })
  return kb.row().text('\u{2039} Back', 'ef:back')
}

function subCategoryKeyboard(category: Category): InlineKeyboard {
  const kb = new InlineKeyboard()
  const subs = CATEGORY_MAP[category] ?? ['Other']
  subs.forEach((sub, i) => {
    kb.text(sub, `es:${i}`)
    if (i % 2 === 1) kb.row()
  })
  return kb.row().text('\u{2039} Back', 'ef:cat')
}

function dateKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Today', 'ef:d_today')
    .text('Yesterday', 'ef:d_yday')
    .row()
    .text('\u{2039} Back', 'ef:back')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shows `text` by rewriting the tapped message, or sending a new one when there is none. */
async function show(ctx: Context, text: string, kb: InlineKeyboard): Promise<void> {
  if (ctx.callbackQuery !== undefined) {
    try {
      await ctx.editMessageText(text, { reply_markup: kb })
      return
    } catch {
      // Message unchanged or too old to edit — fall through and send a fresh one.
    }
  }
  await ctx.reply(text, { reply_markup: kb })
}

function liveSession(chatId: number): EditSession | undefined {
  const s = editSessions.get(chatId)
  if (s === undefined) return undefined
  if (Date.now() > s.expiresAt) {
    editSessions.delete(chatId)
    return undefined
  }
  return s
}

/** Saves a change, and on success folds it into the session. Returns false on failure. */
async function save(
  ctx: Context,
  s: EditSession,
  change: UpdateTransactionInput,
  apply: () => void,
): Promise<boolean> {
  const telegramId = ctx.from?.id
  const token = telegramId !== undefined ? tokenStore.get(telegramId) : undefined
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return false
  }
  apiClient.setToken(token)
  const updated = await apiClient.updateTransaction(s.txId, change)
  if (updated === null) return false
  apply()
  s.expiresAt = Date.now() + EDIT_SESSION_MS
  return true
}

// ── /edit and the Edit button ────────────────────────────────────────────────

export async function editCommandHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (telegramId === undefined || chatId === undefined) return

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  apiClient.setToken(token)
  const userId = userIdStore.get(telegramId)
  if (userId === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  const txs = await apiClient.getRecentTransactions(userId, 5)
  if (txs.length === 0) {
    await ctx.reply('No recent transactions to edit lah! \u{1F605}')
    return
  }

  const keyboard = new InlineKeyboard()
  for (const tx of txs) {
    const emoji = CATEGORY_EMOJI[tx.category as Category] ?? '\u{1F4B0}'
    const label = `${emoji} ${fmtSGD(tx.amountCents)} ${tx.item} (${occurredOnToDisplay(tx.occurredOn)})`
    keyboard.text(label, `edit_select:${tx.id}`).row()
  }

  await ctx.reply('Which transaction to edit?', { reply_markup: keyboard })
}

export async function editSelectHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  const chatId = ctx.chat?.id
  const telegramId = ctx.from?.id
  if (callbackData === undefined || chatId === undefined || telegramId === undefined) return
  await ctx.answerCallbackQuery()

  const txId = callbackData.replace('edit_select:', '')
  const token = tokenStore.get(telegramId)
  const userId = userIdStore.get(telegramId)
  if (token === undefined || userId === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  apiClient.setToken(token)
  // The tapped entry may be older than the newest few, so look further back.
  const tx = (await apiClient.getRecentTransactions(userId, 50)).find((t) => t.id === txId)
  if (tx === undefined) {
    await ctx.reply(`Can't find that transaction leh \u{1F625} It may have been deleted.`)
    return
  }

  const session: EditSession = {
    txId,
    amountCents: tx.amountCents,
    item: tx.item,
    category: tx.category,
    subCategory: tx.subCategory,
    occurredOn: tx.occurredOn,
    awaiting: null,
    expiresAt: Date.now() + EDIT_SESSION_MS,
  }
  editSessions.set(chatId, session)
  await ctx.reply(`${summary(session)}\n\nWhat do you want to change?`, { reply_markup: pickerKeyboard() })
}

// ── Field picker (ef:) ───────────────────────────────────────────────────────

export async function editFieldHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  const chatId = ctx.chat?.id
  if (data === undefined || chatId === undefined) return
  await ctx.answerCallbackQuery()

  const s = liveSession(chatId)
  if (s === undefined) {
    await ctx.reply(EXPIRED_MSG)
    return
  }
  const action = data.replace('ef:', '')

  if (action === 'done') {
    editSessions.delete(chatId)
    await show(ctx, `${summary({ ...s, note: undefined })}\n\n\u{2705} Done`, new InlineKeyboard())
    return
  }

  if (action === 'back') {
    s.awaiting = null
    s.note = undefined
    await show(ctx, `${summary(s)}\n\nWhat do you want to change?`, pickerKeyboard())
    return
  }

  if (action === 'cat') {
    s.awaiting = null
    await show(ctx, `${summary(s)}\n\nPick a category:`, categoryKeyboard())
    return
  }

  if (action === 'd_today' || action === 'd_yday') {
    const picked = parseEditDate(action === 'd_today' ? 'today' : 'yesterday')
    if (picked !== null) await applyDate(ctx, s, picked)
    return
  }

  if (action === 'amount') {
    s.awaiting = 'amount'
    await show(
      ctx,
      `${summary(s)}\n\nType the new amount. Any currency works, e.g. 16.20 or 12 EUR \u{2014} I'll convert it to SGD.`,
      new InlineKeyboard().text('\u{2039} Back', 'ef:back'),
    )
    return
  }

  if (action === 'name') {
    s.awaiting = 'name'
    await show(ctx, `${summary(s)}\n\nType the new name.`, new InlineKeyboard().text('\u{2039} Back', 'ef:back'))
    return
  }

  if (action === 'date') {
    s.awaiting = 'date'
    await show(
      ctx,
      `${summary(s)}\n\nPick a day, or type it as DD/MM/YYYY (DD/MM works for this year).`,
      dateKeyboard(),
    )
  }
}

// ── Category buttons (ec: / es:) ─────────────────────────────────────────────

export async function editCategoryHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  const chatId = ctx.chat?.id
  if (data === undefined || chatId === undefined) return
  await ctx.answerCallbackQuery()

  const s = liveSession(chatId)
  if (s === undefined) {
    await ctx.reply(EXPIRED_MSG)
    return
  }
  const category = CATEGORIES[Number(data.replace('ec:', ''))]
  if (category === undefined) return
  // Remember the chosen top-level category until a sub-category is tapped.
  s.chosenCategory = category
  s.note = undefined
  await show(
    ctx,
    `${summary(s)}\n\n${CATEGORY_EMOJI[category] ?? ''} ${category} \u{2014} pick a sub-category:`,
    subCategoryKeyboard(category),
  )
}

export async function editSubCategoryHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  const chatId = ctx.chat?.id
  if (data === undefined || chatId === undefined) return
  await ctx.answerCallbackQuery()

  const s = liveSession(chatId)
  const category = s?.chosenCategory
  if (s === undefined || category === undefined) {
    await ctx.reply(EXPIRED_MSG)
    return
  }
  const subCategory = (CATEGORY_MAP[category] ?? [])[Number(data.replace('es:', ''))]
  if (subCategory === undefined) return

  const ok = await save(ctx, s, { category, subCategory }, () => {
    s.category = category
    s.subCategory = subCategory
  })
  if (!ok) {
    await ctx.reply('Aiyah, could not update the transaction. Try again later lah! \u{1F625}')
    return
  }
  s.chosenCategory = undefined

  // An auto-logged expense was categorised from the merchant name alone.
  // Remember the correction under that name so the next tap gets it right.
  const merchant = autologMerchantFor(s.txId)
  if (merchant !== undefined) {
    try {
      await apiClient.saveLearnedMapping(merchant.toLowerCase(), category, subCategory)
    } catch {
      // Learning is a bonus; the edit itself already succeeded.
    }
  }

  await show(ctx, `${summary(s)}\n\nCategory set \u{2705} Anything else?`, pickerKeyboard())
}

// ── Typed input ──────────────────────────────────────────────────────────────

async function applyDate(ctx: Context, s: EditSession, ddmmyyyy: string): Promise<void> {
  const ok = await save(ctx, s, { date: ddmmyyyy }, () => {
    s.occurredOn = ddmmyyyyToIso(ddmmyyyy)
  })
  if (!ok) {
    await ctx.reply('Aiyah, could not update the transaction. Try again later lah! \u{1F625}')
    return
  }
  s.awaiting = null
  await show(ctx, `${summary(s)}\n\nDate set \u{2705} Anything else?`, pickerKeyboard())
}

/**
 * Handles a typed message while an edit is waiting for an amount, name or
 * date. Returns false when no edit is waiting, so the message goes on to the
 * normal expense handling instead of being swallowed.
 */
export async function handlePendingEdit(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text
  const chatId = ctx.chat?.id
  if (text === undefined || chatId === undefined) return false

  const s = liveSession(chatId)
  if (s === undefined || s.awaiting === null) return false

  if (text.startsWith('/')) {
    editSessions.delete(chatId)
    return false
  }

  if (s.awaiting === 'name') {
    const item = text.trim()
    if (item.length === 0 || item.length > 100) {
      await ctx.reply('Name should be 1 to 100 characters leh. Try again?')
      return true
    }
    const ok = await save(ctx, s, { item, description: item }, () => {
      s.item = item
    })
    if (!ok) {
      await ctx.reply('Aiyah, could not update the transaction. Try again later lah! \u{1F625}')
      return true
    }
    s.awaiting = null
    await ctx.reply(`${summary(s)}\n\nName set \u{2705} Anything else?`, { reply_markup: pickerKeyboard() })
    return true
  }

  if (s.awaiting === 'date') {
    const date = parseEditDate(text)
    if (date === null) {
      await ctx.reply('Hmm, I need a date that has already happened, like 25/11/2026 or 25/11. Try again?')
      return true
    }
    await applyDate(ctx, s, date)
    return true
  }

  // amount
  const amount = parseEditAmount(text)
  if (amount === null) {
    await ctx.reply('Hmm, I need just an amount, like 16.20 or 12 EUR. Try again?')
    return true
  }

  let amountCents = amount.amountCents
  let note: string | undefined
  if (amount.currency !== 'SGD') {
    try {
      amountCents = (await convertToSGD(amount.amountCents, amount.currency)).convertedCents
    } catch {
      await ctx.reply(`Couldn't convert ${amount.currency} to SGD right now. Type the SGD amount instead?`)
      return true
    }
    if (amountCents <= 0) {
      await ctx.reply(`That's too small once converted to SGD. Try another amount?`)
      return true
    }
    note = `${fmtCurrency(amount.amountCents, amount.currency)} \u{2192} ${fmtSGD(amountCents)}`
  }

  const ok = await save(ctx, s, { amountCents }, () => {
    s.amountCents = amountCents
  })
  if (!ok) {
    await ctx.reply('Aiyah, could not update the transaction. Try again later lah! \u{1F625}')
    return true
  }
  s.awaiting = null
  await ctx.reply(
    `${summary({ ...s, ...(note !== undefined ? { note } : {}) })}\n\nAmount set \u{2705} Anything else?`,
    { reply_markup: pickerKeyboard() },
  )
  return true
}
