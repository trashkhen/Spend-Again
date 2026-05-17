# Spend Again?

> A low-friction, Singapore-centric expense tracker powered by Telegram and AI.

![Spend Again? Logo](./Spend%20Again%3F.png)

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
| `JWT_SECRET` | API | Signs and verifies all user JWTs (HS256, 30-day expiry). Falls back to `'dev-secret-change-in-prod'` if unset — always set this explicitly, even in dev. |
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
- [ ] Set all production environment variables in Railway: `DATABASE_URL`, `JWT_SECRET`, `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `DASHBOARD_URL`, `API_URL`
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
- [ ] Rotate `JWT_SECRET` to a cryptographically random production value
- [ ] Audit all API routes for missing auth guards before going live

## License

Private — All rights reserved.
