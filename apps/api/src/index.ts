import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { createLogger } from '@spend-again/shared'
import { healthRouter } from './routes/health.js'
import { createTransactionsRouter } from './routes/transactions.js'
import { createAuthRouter } from './routes/auth.js'
import { createAnalyticsRouter } from './routes/analytics.js'
import { createUsersRouter } from './routes/users.js'
import { createCustomCategoriesRouter } from './routes/custom-categories.js'
import { globalErrorHandler } from './middleware/error-handler.js'
import { rateLimitMiddleware } from './middleware/rate-limit.js'
import { requireAuth } from './middleware/auth.js'
import { db } from './lib/db.js'

const log = createLogger('api')
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

// ── Routes ────────────────────────────────────────────────────────────────────
// Middleware ordering matters: requireAuth runs BEFORE rateLimitMiddleware so
// the per-user limiter sees c.get('userId'). Without this, anonymous requests
// share a single IP-keyed bucket and one user can starve another.

// Public routes
app.route('/', healthRouter)

// /api/auth is unauthenticated by definition; rate-limit by IP only.
app.use('/api/auth/*', rateLimitMiddleware)
app.route('/api/auth', createAuthRouter(db))

// Authenticated routes — auth first, then per-user rate limit.
app.use('/api/transactions', requireAuth, rateLimitMiddleware)
app.use('/api/transactions/*', requireAuth, rateLimitMiddleware)
app.route('/api/transactions', createTransactionsRouter(db))

app.use('/api/analytics', requireAuth, rateLimitMiddleware)
app.use('/api/analytics/*', requireAuth, rateLimitMiddleware)
app.route('/api/analytics', createAnalyticsRouter(db))

app.use('/api/users', requireAuth, rateLimitMiddleware)
app.use('/api/users/*', requireAuth, rateLimitMiddleware)
app.route('/api/users', createUsersRouter(db))

app.use('/api/users/custom-categories/*', requireAuth, rateLimitMiddleware)
app.use('/api/users/custom-categories', requireAuth, rateLimitMiddleware)
app.route('/api/users/custom-categories', createCustomCategoriesRouter(db))

const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  log.info({ port: info.port }, 'API server running')
})
