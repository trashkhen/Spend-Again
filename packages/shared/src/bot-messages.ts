/**
 * Singlish-flavored message templates for the Spend Again? Telegram bot.
 *
 * All user-facing bot messages should be sourced from here to keep personality
 * consistent and enable easy copy-editing without touching handler logic.
 */

// ---------------------------------------------------------------------------
// Welcome / onboarding
// ---------------------------------------------------------------------------

export const MSG_WELCOME = (dashboardUrl: string): string =>
  `Eh, welcome to Spend Again? \u{1F1F8}\u{1F1EC}\n` +
  `Track your kopi money lah! Send me an expense like:\n` +
  `"$3.50 kopi-o at Ya Kun"\n\n` +
  `\u{1F4CA} <a href="${dashboardUrl}">Open Dashboard</a>\n` +
  `Type /help to see all commands lor.`

export const MSG_HELP =
  `How to use Spend Again? \u{1F914}\n\n` +

  `*Log an expense* — Just type it:\n` +
  `  "8.50 chicken rice Maxwell"\n` +
  `  "$12 grab home"\n` +
  `  "25 NTUC groceries"\n\n` +

  `*Snap a receipt* — Send a photo \u{1F4F8}\n\n` +

  `*Ask about your spending:*\n` +
  `  "How much did I spend this month?"\n` +
  `  "Show breakdown by category last week"\n\n` +

  `*Spaces* — Organise expenses into trips or budgets:\n` +
  `  /space — View + switch spaces\n` +
  `  "Bali Trip from 03/06 to 08/06 budget $500" — Create a space\n` +
  `  \u{1F4E6} Spaces button — Quick access\n` +
  `  Tap a space to set it active; new expenses are tagged automatically\n` +
  `  In a space menu: Deactivate to archive, Delete to remove permanently\n\n` +

  `*IOUs* — Track who owes who:\n` +
  `  /iou — View all open IOUs\n` +
  `  \u{1F4B8} IOUs button — Quick access\n` +
  `  "I lent Alex $20 for lunch" — Record IOU\n` +
  `  "I owe Jun $50" — Record what you owe\n` +
  `  "Alex paid me back" — Mark as settled\n\n` +

  `*Commands:*\n` +
  `/start — Welcome message\n` +
  `/help — Show this help\n` +
  `/recent — Last 5 transactions\n` +
  `/space — Manage spaces\n` +
  `/iou — View & record IOUs\n\n` +

  `*Keyboard buttons:*\n` +
  `\u{1F310} Bring me to Site — Open your dashboard\n` +
  `\u{1F4CA} Monthly Report — Current month summary\n` +
  `\u{1F4DD} Recents — Last 5 transactions\n` +
  `\u{1F4E6} Spaces — Manage your spaces\n` +
  `\u{1F4B8} IOUs — View open debts\n` +
  `\u{2753} Help — Show this message\n\n` +

  `Can lah, you got this! \u{1F44A}`

// ---------------------------------------------------------------------------
// Auth / registration
// ---------------------------------------------------------------------------

export const MSG_NOT_REGISTERED = (dashboardUrl: string): string =>
  `Eh, you haven't registered yet leh! \u{1F64F}\n` +
  `Please sign up at ${dashboardUrl} first, then come back here lor.`

// ---------------------------------------------------------------------------
// Expense parsing
// ---------------------------------------------------------------------------

export const MSG_PARSE_FAILED =
  `Aiyah, cannot understand lah \u{1F615}\n` +
  `Try something like:\n` +
  `  "$10 chicken rice"\n` +
  `  "3.50 kopi"\n` +
  `  "25 grab to airport"`

export const MSG_CURRENCY_UNAVAILABLE =
  `Aiyah, cannot fetch the exchange rate right now leh \u{1F615}\n` +
  `Give it a few minutes and try again lor.`

/** Shown when the bot is about to confirm a parsed expense. */
export const MSG_CONFIRM_PROMPT = (
  emoji: string,
  amount: string,
  item: string,
  category: string,
): string => `${emoji} *${amount}* — ${item} — ${category}\n\nCorrect or not?`

// ---------------------------------------------------------------------------
// Confirmation flow
// ---------------------------------------------------------------------------

export const MSG_SAVED = `Shiok! Saved already \u{1F4B0}\u{2705}`

export const MSG_SAVE_FAILED =
  `Alamak, cannot save leh! \u{1F615}\n` + `Please try again later lor.`

export const MSG_CONFIRM_EDIT =
  `OK lor! Send me the corrected expense (e.g. "$10 chicken rice at Maxwell").`

export const MSG_CONFIRM_CANCELLED = `OK, cancelled. Nothing was saved. \u{1F44C}`

export const MSG_NO_PENDING_EXPENSE =
  `Eh, no pending expense leh. Please send an expense first!`

// ---------------------------------------------------------------------------
// Learned mappings (Tier-3 remember prompt)
// ---------------------------------------------------------------------------

export const MSG_LEARN_PROMPT = (item: string, category: string, subCategory: string): string =>
  `Got it! Should I remember *${item}* as ${category}/${subCategory} for next time? \u{1F914}`

export const MSG_LEARN_SAVED = (item: string, category: string, subCategory: string): string =>
  `Steady lah! I'll remember *${item}* as ${category}/${subCategory} next time. \u{1F9E0}`

export const MSG_LEARN_DECLINED = `OK lor, won't remember. \u{1F44C}`

export const MSG_LEARN_FAILED =
  `Cannot save the mapping right now lah. But your expense is already saved! \u{1F44D}`

export const MSG_LEARN_ITEM_MISSING =
  `Aiyoh, cannot save — item name missing leh. \u{1F615}`

// ---------------------------------------------------------------------------
// Recent transactions
// ---------------------------------------------------------------------------

export const MSG_RECENT_HEADER = `\u{1F4DD} Your last 5 transactions:\n`

export const MSG_RECENT_EMPTY =
  `No transactions yet lah! Send me an expense like "$10 chicken rice". \u{1F35C}`

// ---------------------------------------------------------------------------
// Receipt / OCR
// ---------------------------------------------------------------------------

export const MSG_RECEIPT_PROCESSING = `\u{1F4F8} Processing your receipt... give me a moment lah!`

export const MSG_RECEIPT_UNSUPPORTED_FORMAT =
  `Aiyah, only JPEG, PNG, and WebP images supported leh! \u{1F615}\n` +
  `Please send the receipt as a photo or supported image file lor.`

export const MSG_RECEIPT_NO_IMAGE =
  `Eh, no image found leh. Please send a receipt photo! \u{1F4F8}`

export const MSG_RECEIPT_TOO_LARGE = (sizeMb: string): string =>
  `Wah, that image too big lah (${sizeMb} MB)! \u{1F4F7}\n` +
  `Please send images under 10 MB lor.`

export const MSG_RECEIPT_DOWNLOAD_FAILED =
  `Cannot download the image leh. Please try again! \u{1F615}`

export const MSG_RECEIPT_RATE_LIMIT =
  `Aiyah, system a bit busy now! \u{23F3}\n` +
  `Please try again in a moment lor.`

export const MSG_RECEIPT_PARSE_FAILED =
  `Hmm, cannot read that receipt leh. \u{1F914}\n` +
  `Please try a clearer photo or enter the expense manually (e.g. "$10 chicken rice").`

export const MSG_RECEIPT_ERROR = (reason: string): string =>
  `Aiyah, cannot read the receipt: ${reason}. \u{1F615}\n` +
  `Please try a clearer photo or enter the expense manually lor.`

/** Header shown above the multi-item receipt summary. */
export const MSG_RECEIPT_MULTI_HEADER = `\u{1F4C4} Receipt detected! These are the items lah:`

/** Footer asking whether to save. */
export const MSG_RECEIPT_SAVE_PROMPT = `\nSave all items as individual transactions or not?`

export const MSG_RECEIPT_SAVED = (count: number): string =>
  `Shiok! Saved ${count} transaction${count === 1 ? '' : 's'} from your receipt! \u{1F4B0}\u{2705}`

export const MSG_RECEIPT_PARTIAL_SAVE = (saved: number, failedItems: string[]): string =>
  `\u{26A0}️ Saved ${saved} transaction${saved === 1 ? '' : 's'}, but these items cannot save leh:\n` +
  failedItems.map((i) => `\u{2022} ${i}`).join('\n')

export const MSG_RECEIPT_SAVE_TOTAL_FAILURE =
  `Alamak, cannot save any of the transactions leh! \u{1F625}\n` +
  `Please try again or enter expenses manually lor.`

export const MSG_RECEIPT_CANCELLED = `OK lah, cancelled. Nothing was saved. \u{1F44C}`

export const MSG_RECEIPT_NO_PENDING =
  `Eh, no pending receipt leh. Please send a receipt photo first! \u{1F4F8}`

// ---------------------------------------------------------------------------
// Budget alerts
// ---------------------------------------------------------------------------

export const MSG_BUDGET_WARNING = (spent: string, budget: string, pct: number): string =>
  `\u{1F92C} Oi cut down on spending la, going to hit budget alr!\n\n` +
  `\u{1F4B8} Spent: *S$${spent}* / S$${budget} (${pct}%)\n` +
  `Tighten your belt this month lah! \u{1F972}`
