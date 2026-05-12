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

## License

Private — All rights reserved.
