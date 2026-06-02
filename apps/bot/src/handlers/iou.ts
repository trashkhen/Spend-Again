import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { apiClient, tokenStore } from '../lib/api-client.js'
import { buildIouAmbiguousKeyboard, buildIouListKeyboard, buildIouSettleKeyboard } from '../keyboards/iou.js'
import type { DebtWithPerson } from '@spend-again/shared'

type PendingSettle = { personName: string; debts: DebtWithPerson[] }
export const pendingIouSettle = new Map<number, PendingSettle>()
export const pendingPartialRepay = new Map<number, string>() // chatId → debtId
export const pendingIouNew = new Set<number>()

// ── Intent detection ──────────────────────────────────────────────────────────

const LENT_RE = /^(?:i\s+)?(?:lent|covered|treated)\s+([A-Za-z]+)\s+(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/i
const OWES_ME_RE = /^([A-Za-z]+)\s+owes?\s+me\s+(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/i
const PAID_FOR_RE = /^paid\s+(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)\s+for\s+([A-Za-z]+)/i
const OWE_THEM_RE = /^(?:i\s+owe)\s+([A-Za-z]+)\s+(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/i
const BORROWED_RE = /^([A-Za-z]+)\s+lent\s+me\s+(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/i
const PAID_BACK_RE = /^(?:([A-Za-z]+)\s+paid\s+(?:me\s+)?back|paid\s+([A-Za-z]+)\s+back|([A-Za-z]+)\s+returned)/i

export type IouIntent =
  | { type: 'they_owe_me'; personName: string; amountCents: number }
  | { type: 'i_owe_them'; personName: string; amountCents: number }
  | { type: 'paid_for_ambiguous'; personName: string; amountCents: number }
  | { type: 'repayment'; personName: string }

export function detectIouIntent(text: string): IouIntent | null {
  const t = text.trim()

  let m = t.match(LENT_RE)
  if (m?.[1] && m?.[2]) {
    return { type: 'they_owe_me', personName: m[1], amountCents: Math.round(parseFloat(m[2]) * 100) }
  }

  m = t.match(OWES_ME_RE)
  if (m?.[1] && m?.[2]) {
    return { type: 'they_owe_me', personName: m[1], amountCents: Math.round(parseFloat(m[2]) * 100) }
  }

  m = t.match(PAID_FOR_RE)
  if (m?.[1] && m?.[2]) {
    return { type: 'paid_for_ambiguous', personName: m[2], amountCents: Math.round(parseFloat(m[1]) * 100) }
  }

  m = t.match(OWE_THEM_RE)
  if (m?.[1] && m?.[2]) {
    return { type: 'i_owe_them', personName: m[1], amountCents: Math.round(parseFloat(m[2]) * 100) }
  }

  m = t.match(BORROWED_RE)
  if (m?.[1] && m?.[2]) {
    return { type: 'i_owe_them', personName: m[1], amountCents: Math.round(parseFloat(m[2]) * 100) }
  }

  m = t.match(PAID_BACK_RE)
  if (m) {
    const personName = m[1] ?? m[2] ?? m[3]
    if (personName) return { type: 'repayment', personName }
  }

  return null
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function ensureAuth(telegramId: number): Promise<boolean> {
  const token = tokenStore.get(telegramId)
  if (!token) return false
  apiClient.setToken(token)
  return true
}

export async function iouCommandHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!telegramId || !chatId) return
  const token = tokenStore.get(telegramId)
  if (!token) {
    await ctx.reply('Please /start to register first.')
    return
  }
  apiClient.setToken(token)

  const debts = await apiClient.listAllDebts()
  const openDebts = debts.filter(d => d.status === 'open' || d.status === 'partially_paid')

  if (openDebts.length === 0) {
    await ctx.reply(
      'No open IOUs! Record one naturally:\n• "I lent Alex $20 for lunch"\n• "I owe Jun $50"',
      { reply_markup: new InlineKeyboard().text('➕ Record new IOU', 'iou_new') },
    )
    return
  }

  const lines = openDebts.map(d =>
    d.direction === 'they_owe_me'
      ? `👤 ${d.person.name} owes you S$${d.remainingAmount}`
      : `👤 You owe ${d.person.name} S$${d.remainingAmount}`
  ).join('\n')

  await ctx.reply(
    `💸 Open IOUs:\n\n${lines}\n\nTap a row to settle, or record a new one.`,
    { reply_markup: buildIouListKeyboard(openDebts) },
  )
}

export async function iouHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim()
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!text || !telegramId || !chatId) return

  if (!await ensureAuth(telegramId)) {
    await ctx.reply('Please /start to register first.')
    return
  }

  const intent = detectIouIntent(text)
  if (!intent) return

  const today = new Date().toISOString().slice(0, 10)

  if (intent.type === 'they_owe_me') {
    const result = await apiClient.createDebt({
      personName: intent.personName,
      direction: 'they_owe_me',
      amountCents: intent.amountCents,
      description: text,
      occurredOn: today,
    })
    if (!result) { await ctx.reply('Could not save IOU. Try again.'); return }
    await ctx.reply(
      `Recorded: ${intent.personName} owes you S$${(intent.amountCents / 100).toFixed(2)}.\n\nSay "${intent.personName} paid me back" when settled.`,
    )
    return
  }

  if (intent.type === 'i_owe_them') {
    const result = await apiClient.createDebt({
      personName: intent.personName,
      direction: 'i_owe_them',
      amountCents: intent.amountCents,
      description: text,
      occurredOn: today,
    })
    if (!result) { await ctx.reply('Could not save IOU. Try again.'); return }
    await ctx.reply(`Recorded: You owe ${intent.personName} S$${(intent.amountCents / 100).toFixed(2)}.`)
    return
  }

  if (intent.type === 'paid_for_ambiguous') {
    await ctx.reply(
      `How should I treat this?`,
      { reply_markup: buildIouAmbiguousKeyboard(intent.amountCents, intent.personName) },
    )
    return
  }

  if (intent.type === 'repayment') {
    const openDebts = await apiClient.listOpenDebts(intent.personName)
    if (openDebts.length === 0) {
      await ctx.reply(`I don't see any open IOUs with ${intent.personName}.`)
      return
    }
    pendingIouSettle.set(chatId, { personName: intent.personName, debts: openDebts })
    if (openDebts.length === 1 && openDebts[0]) {
      const d = openDebts[0]
      await ctx.reply(
        `${intent.personName} owes you S$${d.remainingAmount}${d.description ? ' for ' + d.description : ''}.\nMark as paid?`,
        { reply_markup: buildIouSettleKeyboard([d]) },
      )
    } else {
      await ctx.reply(
        `${intent.personName} currently owes you:\n` +
          openDebts
            .map((d, i) => `${i + 1}. S$${d.remainingAmount}${d.description ? ' · ' + d.description : ''}`)
            .join('\n') +
          '\n\nWhich one?',
        { reply_markup: buildIouSettleKeyboard(openDebts) },
      )
    }
  }
}

export async function iouCallbackHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!data || !telegramId || !chatId) return

  await ctx.answerCallbackQuery()
  if (!await ensureAuth(telegramId)) return

  const today = new Date().toISOString().slice(0, 10)

  if (data.startsWith('iou_they_owe:')) {
    const parts = data.slice('iou_they_owe:'.length).split(':')
    const amountCents = parseInt(parts[0] ?? '0', 10)
    const personName = parts.slice(1).join(':')
    const result = await apiClient.createDebt({
      personName, direction: 'they_owe_me', amountCents, occurredOn: today,
    })
    if (!result) { await ctx.editMessageText('Could not save. Try again.'); return }
    await ctx.editMessageText(`Recorded: ${personName} owes you S$${(amountCents / 100).toFixed(2)}.`)
    return
  }

  if (data === 'iou_own_expense') {
    await ctx.editMessageText('Treated as your own expense. Log it normally.')
    return
  }

  if (data === 'iou_cancel') {
    pendingIouSettle.delete(chatId)
    await ctx.editMessageText('Cancelled.')
    return
  }

  if (data === 'iou_new') {
    const chatId = ctx.chat?.id
    if (chatId === undefined) return
    pendingIouNew.add(chatId)
    await ctx.editMessageText(
      'Tell me the IOU:\n• "I lent Alex $20 for lunch"\n• "I owe Jun $50"\n• "Sam owes me $15"',
    )
    return
  }

  if (data.startsWith('iou_settle_single:')) {
    const chatId = ctx.chat?.id
    if (chatId === undefined) return
    const debtId = data.slice('iou_settle_single:'.length)
    const debts = await apiClient.listAllDebts()
    const debt = debts.find(d => d.id === debtId)
    if (!debt) { await ctx.editMessageText('Debt not found.'); return }
    pendingIouSettle.set(chatId, { personName: debt.person.name, debts: [debt] })
    const desc = debt.description ? ` for ${debt.description}` : ''
    const label = debt.direction === 'they_owe_me'
      ? `${debt.person.name} owes you S$${debt.remainingAmount}${desc}`
      : `You owe ${debt.person.name} S$${debt.remainingAmount}${desc}`
    await ctx.editMessageText(
      `${label}\nMark as paid?`,
      { reply_markup: buildIouSettleKeyboard([debt]) },
    )
    return
  }

  if (data.startsWith('iou_settle:')) {
    const debtId = data.slice('iou_settle:'.length)
    const ok = await apiClient.settleDebt(debtId)
    pendingIouSettle.delete(chatId)
    await ctx.editMessageText(ok ? '✅ Marked as settled!' : 'Could not settle. Try again.')
    return
  }

  if (data === 'iou_partial') {
    const pending = pendingIouSettle.get(chatId)
    if (!pending?.debts[0]) {
      await ctx.editMessageText('No pending debt selected.')
      return
    }
    pendingPartialRepay.set(chatId, pending.debts[0].id)
    await ctx.editMessageText('How much did they pay? Send the amount (e.g. `$5`)', { parse_mode: 'Markdown' })
    return
  }
}

export async function handlePendingPartialRepay(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  const text = ctx.message?.text?.trim()
  if (!text || !telegramId || !chatId) return false
  if (!pendingPartialRepay.has(chatId)) return false

  const debtId = pendingPartialRepay.get(chatId)!
  pendingPartialRepay.delete(chatId)

  if (!await ensureAuth(telegramId)) return false

  const amountMatch = text.match(/(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/)
  if (!amountMatch?.[1]) {
    await ctx.reply('Could not parse amount. Please try again.')
    return true
  }

  const amountCents = Math.round(parseFloat(amountMatch[1]) * 100)
  const today = new Date().toISOString().slice(0, 10)
  const ok = await apiClient.addDebtPayment(debtId, amountCents, today)
  await ctx.reply(
    ok
      ? `Recorded S$${(amountCents / 100).toFixed(2)} repayment.`
      : 'Could not record repayment. Try again.',
  )
  return true
}
