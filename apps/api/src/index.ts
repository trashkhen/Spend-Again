import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { healthRouter } from './routes/health.js'
import { createTransactionsRouter } from './routes/transactions.js'
import { createAuthRouter } from './routes/auth.js'
import { createAnalyticsRouter } from './routes/analytics.js'
import { createUsersRouter } from './routes/users.js'
import { globalErrorHandler } from './middleware/error-handler.js'
import { rateLimitMiddleware } from './middleware/rate-limit.js'
import { requireAuth } from './middleware/auth.js'
import { db } from './lib/db.js'

const app = new Hono()

// ── CORS ──────────────────────────────────────────────────────────────────────
const explicitOrigins = process.env['CORS_ORIGINS']
  ? process.env['CORS_ORIGINS'].split(',').map((o) => o.trim().replace(/\/$/, ''))
  : ['http://localhost:5173', 'http://localhost:5174', 'https://spend-again-dashboard.vercel.app']

// Allow any Vercel preview deployment for this project (spend-again-dashboard-*.vercel.app)
// in addition to the explicit list. CORS_ORIGINS env var always takes precedence.
function isAllowedOrigin(origin: string): boolean {
  if (explicitOrigins.includes(origin)) return true
  if (!process.env['CORS_ORIGINS']) {
    // Also allow Vercel preview URLs for the dashboard project
    return /^https:\/\/spend-again-dashboard(-[a-z0-9]+)*\.vercel\.app$/.test(origin)
  }
  return false
}

app.use(
  '*',
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

// ── Global error handler ──────────────────────────────────────────────────────
app.onError(globalErrorHandler)

// ── Rate limiting on all API routes ──────────────────────────────────────────
// Applied after auth middleware so userId is available for per-user limits.
// The health endpoint is intentionally excluded (it's public and cheap).
app.use('/api/*', rateLimitMiddleware)

// ── Routes ────────────────────────────────────────────────────────────────────
app.route('/', healthRouter)
app.use('/api/transactions', requireAuth)
app.use('/api/transactions/*', requireAuth)
app.route('/api/transactions', createTransactionsRouter(db))
app.use('/api/analytics', requireAuth)
app.use('/api/analytics/*', requireAuth)
app.route('/api/auth', createAuthRouter(db))
app.route('/api/analytics', createAnalyticsRouter(db))
app.route('/api/users', createUsersRouter(db))

const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on port ${info.port}`)
})
