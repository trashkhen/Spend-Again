type TelegramProfile = {
  first_name?: string
  username?: string
}

/**
 * Builds the one-tap dashboard login URL.
 *
 * Besides the JWT it carries the user's Telegram first name / username so the
 * dashboard header can greet them by name (the JWT only holds ids and the DB
 * doesn't store first names). These are display-only values — the dashboard
 * never trusts them for auth.
 */
export function buildDashboardAuthUrl(
  dashboardUrl: string,
  token: string,
  from?: TelegramProfile,
): string {
  let url = `${dashboardUrl}/auth?token=${encodeURIComponent(token)}`
  const name = from?.first_name?.trim()
  const username = from?.username?.trim()
  if (name) url += `&name=${encodeURIComponent(name)}`
  if (username) url += `&username=${encodeURIComponent(username)}`
  return url
}

/** Escapes a URL for use inside an HTML href attribute in Telegram HTML parse mode. */
export function escapeHrefForTelegramHtml(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
