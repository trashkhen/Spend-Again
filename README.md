# Spend Again?

> A low-friction, Singapore-centric expense tracker powered by Telegram and AI.

![Spend Again? Logo](./docs/spend-again-logo.png)

## Overview

**Spend Again?** is an AI-assisted expense tracking app designed for Singaporeans. Log expenses via natural language in Telegram ("$10 chicken rice at Maxwell"), snap a receipt, or forward a bank SMS — the AI handles categorization automatically. View your spending trends on a beautiful web dashboard.

## Core Features

| Feature | Description | Status |
|---|---|---|
| **Telegram Bot** | Primary input via grammY — text logging, commands, AI chat | 🔜 Planned |
| **NLP Parsing** | Regex + Gemini hybrid to extract (Amount, Category, Item, Date) | 🔜 Planned |
| **Receipt OCR** | Gemini Vision extracts transaction data from receipt photos | 🔜 Planned |
| **Transaction Dashboard** | React web-app with charts, history, and spending insights | 🔜 Planned |
| **SG Contextualization** | Tailored categories, item mappings, and Singlish bot personality | 🔜 Planned |
| **Forwarded SMS Parsing** | Forward bank notifications to the bot for auto-logging | 🔜 Planned |
| _Notification Scraping_ | _Automated push notification parsing_ | 📦 Archived |
| _Monetization_ | _Non-invasive ads in Telegram_ | 📦 Archived |

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | pnpm + Turborepo |
| **Language** | TypeScript (strict) |
| **Bot** | grammY |
| **API** | Hono |
| **Frontend** | React + Vite |
| **Charts** | Recharts |
| **Database** | PostgreSQL (Supabase free tier) |
| **ORM** | Drizzle |
| **LLM** | Google Gemini (free tier — `gemini-2.0-flash`) |
| **Auth** | Telegram Login Widget → JWT |
| **Dashboard Hosting** | Vercel |
| **Bot + API Hosting** | Railway |
| **Testing** | Vitest |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    User Interfaces                    │
│  📱 Telegram Bot (grammY)    📊 Dashboard (React)    │
└──────────┬───────────────────────────┬───────────────┘
           │ Webhook                   │ REST API
┌──────────▼───────────────────────────▼───────────────┐
│                  Backend (Railway)                    │
│  🤖 Bot Process    🔌 Hono API    🧠 Parser Engine   │
│                                   (Regex → DB → LLM) │
└──────────────────────┬───────────────────────────────┘
                       │
           ┌───────────▼───────────┐
           │   💾 PostgreSQL       │
           │   (Supabase)          │
           └───────────────────────┘
                       │
           ┌───────────▼───────────┐
           │   🔮 Google Gemini    │
           │   (Free Tier)         │
           └───────────────────────┘
```

## Category System

Hierarchical **Category → Sub-Category** structure:

| Category | Sub-Categories |
|---|---|
| **Food** | Hawker, Restaurant, Drinks, Alcohol, Snacks, Delivery |
| **Groceries** | Supermarket, Wet Market, Online Groceries, Convenience Store |
| **Transport** | MRT, Bus, Grab, Taxi, Fuel, Parking |
| **Shopping** | Clothes, Electronics, Gifts, Online, Personal Care |
| **Housing** | Rent, HDB Loan, Maintenance, Furniture |
| **Utilities** | Electricity, Water, Internet, Mobile, Gas |
| **School** | Tuition, Books, Supplies, Course Fees |
| **Investments** | Stocks, Crypto, Savings, Insurance |
| **Holiday** | Flights, Hotels, Activities, Souvenirs |
| **Entertainment** | Movies, Games, Subscriptions, Sports |
| **Healthcare** | Doctor, Pharmacy, Dental, Gym |
| **Other** | Miscellaneous |

## Dynamic Item Mapping (3-Tier Lookup)

When parsing an expense, the system resolves categories in order:

1. **Tier 1 — Static Map**: Hardcoded SG-specific mappings (e.g., "NTUC" → Groceries/Supermarket)
2. **Tier 2 — Learned Mappings**: Database lookup of previously categorized items
3. **Tier 3 — Gemini Fallback**: LLM classifies unknown items → user confirms → saved to DB

This gives learning behavior without ML infrastructure. The `learned_mappings` table becomes a future ML training dataset.

## Auth Flow

1. User creates account on **web-app**
2. Pop-up redirects to **Telegram bot** (deep link)
3. Bot links Telegram ID ↔ user account
4. **Same device**: "Go to Dashboard" button in bot → auto-login via token
5. **Different device**: Telegram Login Widget on dashboard
6. **Bot as AI chat**: Query spending conversationally ("How much I spend on food?")

## Project Structure

```
spend-again/
├── apps/
│   ├── bot/              # Telegram bot (grammY + webhook)
│   ├── api/              # REST API (Hono)
│   └── dashboard/        # Frontend (React + Vite)
├── packages/
│   ├── shared/           # Types, constants, SG mappings
│   ├── parser/           # 3-tier NLP parsing engine
│   └── db/               # Drizzle schema, queries, migrations
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Environment Variables

All environment variables live in `.env` at the monorepo root (git-ignored). A summary of what each variable does and which process reads it:

| Variable | Read by | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Supabase PostgreSQL connection string |
| `GEMINI_API_KEY` | API / Parser | Google Gemini LLM calls |
| `BOT_TOKEN` | **Bot + API** | Telegram bot token. Used by grammy to start the bot **and** by `apps/api/src/lib/telegram-auth.ts` to verify Telegram auth hashes. Both processes must have this value — do **not** rename it. |
| `JWT_SECRET` | API | Signs and verifies all user JWTs (HS256, 30-day expiry). **Must be set explicitly** — the API crashes at startup if missing or shorter than 32 characters. Generate with: `openssl rand -hex 32`. |
| `WEBHOOK_SECRET_TOKEN` | Bot | Secret token Telegram includes in every webhook POST (`X-Telegram-Bot-Api-Secret-Token` header). Required in production; must be 32–256 chars (`[A-Za-z0-9_-]`). Generate with: `openssl rand -hex 32`. |
| `NODE_ENV` | API + Bot | Must be set to `production` on Railway. Both services crash at startup if this var is missing. In dev it should be `development`; Vitest sets it to `test` automatically. |
| `DASHBOARD_URL` | Bot | URL the bot uses when generating the dashboard deep-link (e.g. `http://localhost:5175` in dev, `https://your-app.vercel.app` in prod). |
| `API_URL` | Bot | Base URL the bot uses for all API calls (e.g. `http://localhost:3001`). |

> **Note:** `TELEGRAM_BOT_TOKEN` was previously a duplicate of `BOT_TOKEN` in some env files. It is not read by any code — use `BOT_TOKEN` only.

## Development

```bash
# Install dependencies
pnpm install

# Run all apps in dev mode
pnpm turbo run dev

# Run tests
pnpm turbo run test

# Lint
pnpm turbo run lint

# Add a dependency to a specific package
pnpm add <dep> --filter <package_name>

# Run DB migrations
pnpm --filter db migrate
```

## Roadmap

| Phase | Scope | Timeline |
|---|---|---|
| **1. Foundation** | Monorepo scaffold, DB schema, basic bot commands | Week 1–2 |
| **2. AI Parsing** | Regex parser, Gemini integration, 3-tier lookup, SMS parsing | Week 3–4 |
| **3. API + Auth** | Hono routes, Telegram Login Widget, JWT, account linking | Week 5–6 |
| **4. Dashboard** | React UI, charts, transaction history, auth flow | Week 7–8 |
| **5. Receipt OCR** | Gemini Vision, image handling, confirmation flow | Week 9–10 |
| **6. Polish** | Singlish bot personality, error handling, deploy | Week 11+ |

## For Public Deployment

Tasks that must be completed before this project goes live for real users.

### Bot & Auth

- [ ] Register the production Telegram bot via @BotFather and update `VITE_TELEGRAM_BOT_NAME` (currently `spend_again_dev_bot`) to the public bot username in all environment configs
- [ ] Remove the **"Skip login (test user)"** button — set `VITE_DEV_MODE=false` (or remove the env var) in the production dashboard deployment; ensure the dev-login API route is disabled or guarded server-side

### API & Backend (localhost → Railway)

- [ ] Provision a Railway project and link the monorepo; configure the `apps/api` and `apps/bot` services
- [ ] Set all production environment variables in Railway for the **API service**: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `BOT_TOKEN`, `GEMINI_API_KEY`, `DASHBOARD_URL`, `NODE_ENV=production`
- [ ] Set all production environment variables in Railway for the **Bot service**: `BOT_TOKEN`, `WEBHOOK_URL`, `WEBHOOK_SECRET_TOKEN` (≥32 chars, `[A-Za-z0-9_-]` only), `API_URL`, `DASHBOARD_URL`, `NODE_ENV=production`
- [ ] Register the Telegram webhook URL pointing to the Railway deployment (`POST /webhook`)
- [ ] Replace `VITE_API_URL=http://localhost:3001` in the dashboard with the public Railway API URL
- [ ] Enable CORS on the Hono API to allow requests from the Vercel dashboard domain
- [ ] Set up Railway health checks and auto-restart policies

### Database (Supabase)

- [ ] Provision a production Supabase project (separate from any dev instance)
- [ ] Run all Drizzle migrations against the production database
- [ ] Set up Supabase row-level security (RLS) policies to scope data by `userId`
- [ ] Configure connection pooling (PgBouncer) for Railway → Supabase connections

### Dashboard (localhost → Vercel)

- [ ] Connect the repository to Vercel and configure the dashboard build (`apps/dashboard`)
- [ ] Set Vercel environment variables: `VITE_API_URL`, `VITE_TELEGRAM_BOT_NAME`, ensure `VITE_DEV_MODE` is unset or `false`
- [ ] Configure Vercel to serve `index.html` for all routes (SPA fallback)
- [ ] Point a custom domain at the Vercel deployment and update the Telegram Login Widget's allowed domain in @BotFather settings

### Security & Hardening

- [ ] Verify Telegram HMAC signature validation is enforced on the API's `/api/auth/telegram-login` route
- [ ] Rotate `JWT_SECRET` to a cryptographically random production value (`openssl rand -hex 32`)
- [ ] Audit all API routes for missing auth guards before going live

#### Deferred — before ~50 users

- [ ] **Enable Supabase RLS** — Enable row-level security on `users`, `transactions`, `spaces`, `transaction_spaces`, `recurring_payments`, `people`, `debts`, `debt_payments`, `user_custom_categories`. Scope all policies to `auth.uid()` matching `user_id`. Required before the platform grows beyond a small trusted group or if DB credentials are ever rotated.
- [ ] **Per-user learned mappings** — Add a `user_id` column to `learned_mappings` with a unique index on `(user_id, item_name)`. Currently any authenticated user can write global category mappings, which skews auto-categorisation for all users.
- [ ] **Shorten bot-issued JWT / one-time code exchange** — The bot sends a full 30-day JWT in a `/auth?token=<JWT>` URL, exposing the token in browser history, referrer headers, and Telegram message previews. Replace with a short-lived (≤5 min) one-time code that the dashboard exchanges server-side for a session token.

## License

Private — All rights reserved.
