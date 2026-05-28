import { requireEnv } from '@spend-again/shared'

export const BOT_TOKEN = requireEnv('BOT_TOKEN')
export const API_URL = requireEnv('API_URL')

// Dashboard URL is used in user-facing messages (e.g. "register at <url>").
// Production should always set DASHBOARD_URL; the fallback only fires for
// local dev so we don't crash if it's missing.
export const DASHBOARD_URL =
  process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
