import { Bot } from 'grammy'
import { expenseHandler } from './handlers/expense.js'
import { confirmHandler, learnHandler } from './handlers/confirm.js'

const token = process.env['BOT_TOKEN']
if (!token) throw new Error('BOT_TOKEN is required')

export const bot = new Bot(token)

// ── Inline keyboard callback handlers ────────────────────────────────────────

bot.callbackQuery(/^confirm_/, confirmHandler)
bot.callbackQuery(/^learn_/, learnHandler)

// ── Expense text message handler ──────────────────────────────────────────────

bot.on('message:text', expenseHandler)
