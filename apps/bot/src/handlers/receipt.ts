import type { Context } from 'grammy'
import { parseReceiptWithOcr, simpleReceiptToParseResult } from '@spend-again/parser/ocr'
import type { OcrResult, MultiItemReceiptResult } from '@spend-again/parser/ocr'
import type { Category } from '@spend-again/shared'
import { tokenStore } from '../lib/api-client.js'
import { buildConfirmKeyboard } from '../keyboards/confirm.js'
import { buildConfirmationMessage, pendingConfirmations } from './expense.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported MIME types for Gemini Vision. */
type SupportedMime = 'image/jpeg' | 'image/png' | 'image/webp'

/**
 * Stores pending OCR multi-item results keyed by chat ID.
 * Exported so receipt-confirm.ts can read and clear entries.
 */
export const pendingReceiptResults = new Map<number, MultiItemReceiptResult>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mimeFromExtension(ext: string): SupportedMime | null {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    default:
      return null
  }
}

/** Download a file from Telegram using the bot token and return its bytes. */
async function downloadTelegramFile(fileId: string, botToken: string): Promise<Uint8Array | null> {
  try {
    // Step 1: resolve file path
    const infoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    const infoRes = await fetch(infoUrl)
    if (!infoRes.ok) return null

    const infoBody = (await infoRes.json()) as { ok: boolean; result?: { file_path?: string } }
    const filePath = infoBody.result?.file_path
    if (filePath === undefined || filePath === '') return null

    // Step 2: download the actual file bytes
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`
    const fileRes = await fetch(fileUrl)
    if (!fileRes.ok) return null

    const buffer = await fileRes.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

/** Format a multi-item receipt as a human-readable Telegram message. */
function formatMultiReceipt(result: MultiItemReceiptResult): string {
  const CATEGORY_EMOJI: Record<Category, string> = {
    Food: '\u{1F35C}',
    Transport: '\u{1F697}',
    Groceries: '\u{1F6D2}',
    Shopping: '\u{1F6CD}',
    Entertainment: '\u{1F3AE}',
    Health: '\u{1F48A}',
    Education: '\u{1F4DA}',
    Travel: '\u{2708}',
    Utilities: '\u{1F4A1}',
    Finance: '\u{1F4B3}',
    Housing: '\u{1F3E0}',
    Other: '\u{1F4B0}',
  }

  const lines: string[] = ['📄 Receipt detected:']

  for (const item of result.items) {
    const emoji =
      item.category !== undefined ? (CATEGORY_EMOJI[item.category] ?? '\u{1F4B0}') : '\u{1F4B0}'
    const amount = `S$${(item.amount / 100).toFixed(2)}`
    const cat =
      item.subCategory !== undefined
        ? `${item.category}/${item.subCategory}`
        : (item.category ?? 'Unknown')
    lines.push(`  ${emoji} ${amount} — ${item.item} (${cat})`)
  }

  const total = `S$${(result.total / 100).toFixed(2)}`
  lines.push(`\n💰 Total: ${total}`)
  if (result.date !== undefined) {
    lines.push(`📅 Date: ${result.date}`)
  }
  lines.push('\nSave all items as individual transactions?')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function receiptHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id

  if (telegramId === undefined || chatId === undefined) return

  // Check if user is linked
  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
    await ctx.reply(`Please register at ${dashboardUrl} first! \u{1F64F}`)
    return
  }

  const botToken = process.env['BOT_TOKEN']
  if (botToken === undefined) {
    await ctx.reply('Bot is not configured correctly. Please contact support.')
    return
  }

  // ── Determine photo to use ──────────────────────────────────────────────────
  // Telegram sends compressed photos as `message.photo` (array of sizes).
  // Uncompressed documents (e.g. "Send as file") come as `message.document`.

  let fileId: string | undefined
  let mimeType: SupportedMime = 'image/jpeg' // default for Telegram compressed photos
  let fileSizeBytes: number | undefined

  const photo = ctx.message?.photo
  const document = ctx.message?.document

  if (photo !== undefined && photo.length > 0) {
    // Use the largest photo variant (last element = highest resolution)
    const largest = photo[photo.length - 1]
    if (largest !== undefined) {
      fileId = largest.file_id
      fileSizeBytes = largest.file_size
      mimeType = 'image/jpeg' // Telegram always compresses photos to JPEG
    }
  } else if (document !== undefined) {
    const docMime = document.mime_type ?? ''
    const ext = document.file_name?.split('.').pop() ?? ''
    const resolved = mimeFromExtension(ext) ?? (docMime as SupportedMime | null)
    if (
      resolved !== 'image/jpeg' &&
      resolved !== 'image/png' &&
      resolved !== 'image/webp'
    ) {
      await ctx.reply(
        'Sorry, only JPEG, PNG, and WebP images are supported. Please send the receipt as a photo or supported image file.',
      )
      return
    }
    fileId = document.file_id
    fileSizeBytes = document.file_size
    mimeType = resolved
  }

  if (fileId === undefined) {
    await ctx.reply('No image found in your message. Please send a receipt photo.')
    return
  }

  // Size guard (file_size is optional — Telegram may not always include it)
  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_IMAGE_BYTES) {
    await ctx.reply(
      `That image is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB). Please send images under 10 MB.`,
    )
    return
  }

  // ── Acknowledge receipt and start processing ───────────────────────────────

  await ctx.reply('📸 Processing your receipt...')

  // ── Download and OCR ───────────────────────────────────────────────────────

  const imageData = await downloadTelegramFile(fileId, botToken)
  if (imageData === null) {
    await ctx.reply('Could not download the image. Please try again.')
    return
  }

  // Post-download size guard (catches cases where file_size was not provided)
  if (imageData.byteLength > MAX_IMAGE_BYTES) {
    await ctx.reply('That image is too large. Please send images under 10 MB.')
    return
  }

  let ocrResult: OcrResult | null
  try {
    ocrResult = await parseReceiptWithOcr(imageData, mimeType)
  } catch (err) {
    const errorMessage =
      err instanceof Error && err.name === 'OcrRateLimitError'
        ? 'Processing is a bit busy right now. Please try again in a moment!'
        : 'Could not process the receipt. Please try again or enter the expense manually.'
    await ctx.reply(errorMessage)
    return
  }

  if (ocrResult === null) {
    await ctx.reply(
      "Hmm, I couldn't read that receipt. Please try a clearer photo or enter the expense manually (e.g. \"$10 chicken rice\").",
    )
    return
  }

  // ── Handle error result ────────────────────────────────────────────────────

  if (ocrResult.type === 'error') {
    await ctx.reply(
      `Could not read the receipt: ${ocrResult.reason}. Please try a clearer photo or enter the expense manually.`,
    )
    return
  }

  // ── Handle simple receipt ─────────────────────────────────────────────────

  if (ocrResult.type === 'simple') {
    const parseResult = simpleReceiptToParseResult(ocrResult)
    pendingConfirmations.set(chatId, parseResult)

    const confirmMsg = buildConfirmationMessage(parseResult)
    const keyboard = buildConfirmKeyboard()
    await ctx.reply(confirmMsg, { reply_markup: keyboard })
    return
  }

  // ── Handle multi-item receipt ─────────────────────────────────────────────

  if (ocrResult.type === 'multi') {
    pendingReceiptResults.set(chatId, ocrResult)

    const formattedMsg = formatMultiReceipt(ocrResult)
    await ctx.reply(formattedMsg, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Save All', callback_data: 'receipt_confirm_all' },
            { text: '❌ Cancel', callback_data: 'receipt_cancel' },
          ],
        ],
      },
    })
  }
}
