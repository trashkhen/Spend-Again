import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { CATEGORIES, CATEGORY_MAP, fmtSGD } from '@spend-again/shared'
import type { Category, RecurringFrequency, ApiRecurring } from '@spend-again/shared'
import { MSG_NOT_REGISTERED } from '@spend-again/shared'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'

type RecurringDraft = {
  step: 'name' | 'amount' | 'awaiting_category' | 'awaiting_subcategory' | 'awaiting_frequency' | 'startDate'
  name?: string
  amountCents?: number
  category?: string
  subCategory?: string
  frequency?: string
}

export const pendingRecurring = new Map<number, RecurringDraft>() // chatId → draft

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']

function categoryKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
  const cats = CATEGORIES as readonly string[]
  for (let i = 0; i < cats.length; i += 3) {
    const row = cats.slice(i, i + 3)
    for (const cat of row) kb.text(cat, `rec_cat:${cat}`)
    kb.row()
  }
  return kb
}

function subCategoryKeyboard(category: string): InlineKeyboard {
  const kb = new InlineKeyboard()
  const subs = (CATEGORY_MAP[category as Category] ?? ['Other']) as string[]
  for (const sub of subs) kb.text(sub, `rec_sub:${sub}`).row()
  return kb
}

function frequencyKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const freq of FREQUENCIES) {
    kb.text(freq.charAt(0).toUpperCase() + freq.slice(1), `rec_freq:${freq}`).row()
  }
  return kb
}

function formatNextDue(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [y, m, d] = parts
  return `${parseInt(d ?? '1', 10)} ${months[(parseInt(m ?? '1', 10) - 1)] ?? m} ${y}`
}

function ddmmyyyyToISO(ddmmyyyy: string): string | null {
  const parts = ddmmyyyy.split('/')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  const iso = `${y}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  return iso
}

async function requireAuth(ctx: Context): Promise<{ token: string; userId: string } | null> {
  const telegramId = ctx.from?.id
  if (telegramId === undefined) return null
  const token = tokenStore.get(telegramId)
  if (token === undefined) { await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL)); return null }
  const userId = userIdStore.get(telegramId)
  if (userId === undefined) { await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL)); return null }
  apiClient.setToken(token)
  return { token, userId }
}

// ── /recurring command ────────────────────────────────────────────────────────

export async function recurringCommandHandler(ctx: Context): Promise<void> {
  const auth = await requireAuth(ctx)
  if (auth === null) return

  const items = await apiClient.listRecurring()
  const addKb = new InlineKeyboard().text('\u{2795} Add Recurring', 'add_recurring')

  if (items.length === 0) {
    await ctx.reply('No recurring payments set up yet lah! \u{1F4C5} Tap below to add one.', { reply_markup: addKb })
    return
  }

  const lines = items.map((item: ApiRecurring) => {
    const status = item.isActive === 1 ? '' : ' \u{23F8} Paused'
    return `\u{1F501} *${item.name}* \u{2014} ${fmtSGD(item.amountCents)} (${item.frequency}) \u{00B7} Next: ${formatNextDue(item.nextDueDate)}${status}`
  })

  const manageKb = new InlineKeyboard()
  for (const item of items) {
    const pauseLabel = item.isActive === 1 ? `\u{23F8} Pause ${item.name}` : `\u{25B6}\u{FE0F} Resume ${item.name}`
    manageKb.text(pauseLabel, `rec_toggle:${item.id}`).row()
    manageKb.text(`\u{1F5D1} Delete ${item.name}`, `rec_delete:${item.id}`).row()
  }
  manageKb.text('\u{2795} Add Recurring', 'add_recurring')

  await ctx.reply(
    `\u{1F501} *Your Recurring Payments*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', reply_markup: manageKb },
  )
}

// ── Add recurring — start ─────────────────────────────────────────────────────

export async function addRecurringStart(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id
  if (chatId === undefined) return
  await ctx.answerCallbackQuery()
  pendingRecurring.set(chatId, { step: 'name' })
  await ctx.reply(`What's the name of this payment? (e.g. Netflix, Gym, Rent)`)
}

// ── Handle text messages for the recurring conversation flow ──────────────────

export async function handlePendingRecurring(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id
  const text = ctx.message?.text?.trim()
  if (chatId === undefined || text === undefined) return false

  const draft = pendingRecurring.get(chatId)
  if (draft === undefined) return false

  // Commands escape the flow
  if (text.startsWith('/')) {
    pendingRecurring.delete(chatId)
    return false
  }

  switch (draft.step) {
    case 'name': {
      draft.name = text
      draft.step = 'amount'
      await ctx.reply(`How much? (e.g. 18.98)`)
      return true
    }
    case 'amount': {
      const num = parseFloat(text)
      if (isNaN(num) || num <= 0) {
        await ctx.reply(`That doesn't look right leh. Enter just the amount, e.g. \`18.98\``, { parse_mode: 'Markdown' })
        return true
      }
      draft.amountCents = Math.round(num * 100)
      draft.step = 'awaiting_category'
      await ctx.reply(`Which category?`, { reply_markup: categoryKeyboard() })
      return true
    }
    case 'awaiting_category':
    case 'awaiting_subcategory':
    case 'awaiting_frequency': {
      await ctx.reply(`Please tap one of the buttons above to continue lah \u{1F447}`)
      return true
    }
    case 'startDate': {
      let iso: string | null = null
      if (text.toLowerCase() === 'today') {
        iso = new Date().toISOString().slice(0, 10)
      } else {
        iso = ddmmyyyyToISO(text)
      }
      if (iso === null) {
        await ctx.reply(`Please send a date in DD/MM/YYYY format, or type \`today\``, { parse_mode: 'Markdown' })
        return true
      }

      const auth = await requireAuth(ctx)
      if (auth === null) { pendingRecurring.delete(chatId); return true }

      const result = await apiClient.createRecurring({
        name: draft.name ?? 'Unnamed',
        amountCents: draft.amountCents ?? 0,
        category: draft.category ?? 'Other',
        subCategory: draft.subCategory ?? 'Other',
        frequency: draft.frequency ?? 'monthly',
        startDate: iso,
      })
      pendingRecurring.delete(chatId)

      if (result === null) {
        await ctx.reply('Aiyah, could not save the recurring payment. Try again later lah! \u{1F625}')
        return true
      }

      await ctx.reply(
        `\u{2705} Recurring payment added!\n*${draft.name}* \u{2014} ${fmtSGD(draft.amountCents ?? 0)} ${draft.frequency}, starting ${formatNextDue(iso)}`,
        { parse_mode: 'Markdown' },
      )
      return true
    }
    default:
      return false
  }
}

// ── Inline keyboard callbacks ─────────────────────────────────────────────────

export async function recCategoryHandler(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id
  const data = ctx.callbackQuery?.data
  if (chatId === undefined || data === undefined) return
  await ctx.answerCallbackQuery()

  const category = data.replace('rec_cat:', '')
  const draft = pendingRecurring.get(chatId)
  if (draft === undefined) return

  draft.category = category
  draft.step = 'awaiting_subcategory'
  await ctx.reply(`Which sub-category for *${category}*?`, {
    parse_mode: 'Markdown',
    reply_markup: subCategoryKeyboard(category),
  })
}

export async function recSubCategoryHandler(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id
  const data = ctx.callbackQuery?.data
  if (chatId === undefined || data === undefined) return
  await ctx.answerCallbackQuery()

  const sub = data.replace('rec_sub:', '')
  const draft = pendingRecurring.get(chatId)
  if (draft === undefined) return

  draft.subCategory = sub
  draft.step = 'awaiting_frequency'
  await ctx.reply(`How often?`, { reply_markup: frequencyKeyboard() })
}

export async function recFrequencyHandler(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id
  const data = ctx.callbackQuery?.data
  if (chatId === undefined || data === undefined) return
  await ctx.answerCallbackQuery()

  const freq = data.replace('rec_freq:', '')
  const draft = pendingRecurring.get(chatId)
  if (draft === undefined) return

  draft.frequency = freq
  draft.step = 'startDate'
  await ctx.reply(`Starting from? Send DD/MM/YYYY or type \`today\``, { parse_mode: 'Markdown' })
}

export async function recToggleHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  if (data === undefined) return
  await ctx.answerCallbackQuery()

  const id = data.replace('rec_toggle:', '')
  const auth = await requireAuth(ctx)
  if (auth === null) return

  const items = await apiClient.listRecurring()
  const item = items.find((i: ApiRecurring) => i.id === id)
  if (item === undefined) { await ctx.reply('Payment not found leh.'); return }

  await apiClient.updateRecurring(id, { isActive: item.isActive !== 1 })
  const action = item.isActive === 1 ? 'Paused' : 'Resumed'
  await ctx.reply(`${action} *${item.name}* \u{2705}`, { parse_mode: 'Markdown' })
}

export async function recDeleteHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  if (data === undefined) return
  await ctx.answerCallbackQuery()

  const auth = await requireAuth(ctx)
  if (auth === null) return

  const id = data.replace('rec_delete:', '')
  const items = await apiClient.listRecurring()
  const item = items.find((i: ApiRecurring) => i.id === id)
  const name = item?.name ?? 'this payment'

  const kb = new InlineKeyboard()
    .text('\u{2705} Yes, delete', `rec_delete_yes:${id}`)
    .text('\u{274C} Cancel', 'rec_delete_cancel')

  await ctx.reply(
    `Delete *${name}*? This won't remove past transactions.`,
    { parse_mode: 'Markdown', reply_markup: kb },
  )
}

export async function recDeleteConfirmHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  if (data === undefined) return
  await ctx.answerCallbackQuery()

  if (data === 'rec_delete_cancel') {
    await ctx.editMessageText('Cancelled.')
    return
  }

  const id = data.replace('rec_delete_yes:', '')
  const auth = await requireAuth(ctx)
  if (auth === null) return

  await apiClient.deleteRecurring(id)
  await ctx.editMessageText('Deleted \u{1F5D1}')
}
