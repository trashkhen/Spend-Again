import { InlineKeyboard } from 'grammy'
import type { DebtWithPerson } from '@spend-again/shared'

export function buildIouAmbiguousKeyboard(amountCents: number, personName: string): InlineKeyboard {
  const display = (amountCents / 100).toFixed(2)
  return new InlineKeyboard()
    .text(`${personName} owes me S$${display}`, `iou_they_owe:${amountCents}:${personName}`)
    .row()
    .text('My own expense', 'iou_own_expense')
    .text('Cancel', 'iou_cancel')
}

export function buildIouSettleKeyboard(debts: DebtWithPerson[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const d of debts) {
    const desc = d.description ? ` · ${d.description.slice(0, 20)}` : ''
    kb.text(`Settle S$${d.remainingAmount}${desc}`, `iou_settle:${d.id}`).row()
  }
  kb.text('Partial repayment', 'iou_partial').row()
  kb.text('Cancel', 'iou_cancel')
  return kb
}
