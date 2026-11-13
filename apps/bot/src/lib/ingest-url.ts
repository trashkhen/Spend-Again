/**
 * Public address a phone automation should POST captures to.
 *
 * `INGEST_URL` wins when set. Otherwise the bot service's own origin is taken
 * from `WEBHOOK_URL` (same server, different path), and local development
 * falls back to localhost.
 */
export function resolveIngestUrl(env: Record<string, string | undefined>): string {
  const explicit = env['INGEST_URL']
  if (explicit !== undefined && explicit.length > 0) return explicit

  const webhook = env['WEBHOOK_URL']
  if (webhook !== undefined && webhook.length > 0) {
    try {
      return `${new URL(webhook).origin}/ingest`
    } catch {
      // fall through to localhost
    }
  }

  return `http://localhost:${env['PORT'] ?? '3002'}/ingest`
}
