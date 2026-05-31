import type { Context } from 'grammy'
import { parseReceiptWithOcr, simpleReceiptToParseResult } from '@spend-again/parser/ocr'
import type { OcrResult, MultiItemReceiptResult } from '@spend-again/parser/ocr'
import {
  MSG_NOT_REGISTERED,
  MSG_RECEIPT_PROCESSING,
  MSG_RECEIPT_UNSUPPORTED_FORMAT,
  MSG_RECEIPT_NO_IMAGE,
  MSG_RECEIPT_TOO_LARGE,
  MSG_RECEIPT_DOWNLOAD_FAILED,
  MSG_RECEIPT_RATE_LIMIT,
  MSG_RECEIPT_PARSE_FAILED,
  MSG_RECEIPT_ERROR,
  MSG_RECEIPT_MULTI_HEADER,
  MSG_RECEIPT_SAVE_PROMPT,
  OcrRateLimitError,
  emojiFor,
  fmtSGD,
} from '@spend-again/shared'
import { tokenStore } from '../lib/api-client.js'
import { BOT_TOKEN, DASHBOARD_URL } from '../lib/env.js'
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
  const lines: string[] = [MSG_RECEIPT_MULTI_HEADER]

  for (const item of result.items) {
    const emoji = emojiFor(item.category)
    const amount = fmtSGD(item.amount)
    const cat =
      item.subCategory !== undefined
        ? `${item.category}/${item.subCategory}`
        : (item.category ?? 'Unknown')
    lines.push(`  ${emoji} ${amount} — ${item.item} (${cat})`)
  }

  const total = fmtSGD(result.total)
  lines.push(`\n\u{1F4B0} Total: ${total}`)
  if (result.date !== undefined) {
    lines.push(`\u{1F4C5} Date: ${result.date}`)
  }
  lines.push(MSG_RECEIPT_SAVE_PROMPT)

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
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
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
      await ctx.reply(MSG_RECEIPT_UNSUPPORTED_FORMAT)
      return
    }
    fileId = document.file_id
    fileSizeBytes = document.file_size
    mimeType = resolved
  }

  if (fileId === undefined) {
    await ctx.reply(MSG_RECEIPT_NO_IMAGE)
    return
  }

  // Size guard (file_size is optional — Telegram may not always include it)
  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_IMAGE_BYTES) {
    await ctx.reply(MSG_RECEIPT_TOO_LARGE((fileSizeBytes / 1024 / 1024).toFixed(1)))
    return
  }

  // ── Acknowledge receipt and start processing ───────────────────────────────

  await ctx.reply(MSG_RECEIPT_PROCESSING)

  // ── Download and OCR ───────────────────────────────────────────────────────

  const imageData = await downloadTelegramFile(fileId, BOT_TOKEN)
  if (imageData === null) {
    await ctx.reply(MSG_RECEIPT_DOWNLOAD_FAILED)
    return
  }

  // Post-download size guard (catches cases where file_size was not provided)
  if (imageData.byteLength > MAX_IMAGE_BYTES) {
    await ctx.reply(MSG_RECEIPT_TOO_LARGE((imageData.byteLength / 1024 / 1024).toFixed(1)))
    return
  }

  let ocrResult: OcrResult | null
  try {
    ocrResult = await parseReceiptWithOcr(imageData, mimeType)
  } catch (err) {
    const errorMessage =
      err instanceof OcrRateLimitError ? MSG_RECEIPT_RATE_LIMIT : MSG_RECEIPT_PARSE_FAILED
    await ctx.reply(errorMessage)
    return
  }

  if (ocrResult === null) {
    await ctx.reply(MSG_RECEIPT_PARSE_FAILED)
    return
  }

  // ── Handle error result ────────────────────────────────────────────────────

  if (ocrResult.type === 'error') {
    await ctx.reply(MSG_RECEIPT_ERROR(ocrResult.reason))
    return
  }

  // ── Handle simple receipt ─────────────────────────────────────────────────

  if (ocrResult.type === 'simple') {
    const parseResult = simpleReceiptToParseResult(ocrResult)
    // No raw text for receipts; use item name so lookupKey falls back to it.
    pendingConfirmations.set(chatId, { result: parseResult, rawInput: parseResult.item })

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
            { text: '\u{2705} Save All', callback_data: 'receipt_confirm_all' },
            { text: '\u{274C} Cancel', callback_data: 'receipt_cancel' },
          ],
        ],
      },
    })
  }
}
