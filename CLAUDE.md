# Spend Again? | Agent Rules

## Project Context
- **Product:** A Singapore-centric expense tracker.
- **Core Goal:** Low-friction logging via Telegram + AI parsing.
- **Tech Stack:** Monorepo (pnpm + Turbo), React, Hono, grammY, Drizzle, TypeScript, Vitest.

## Development Standards
- **Localization:** Always use **SGD** for currency, however currency can be converted in future versions and **DD/MM/YYYY** for dates.
- **Parsing Logic:** Use natural language processing to extract (Amount, Category, Item, Date) from strings like "8.50 for lunch at Amoy".
- **Code Quality:** No `any`. Use strict TypeScript. Always run `pnpm lint` before finishing a task.
- **Currency Storage:** Store amounts as integer cents in PostgreSQL (`NUMERIC` type via Drizzle). Display as decimal in UI. Future versions will support multi-currency conversion.
- **AI Provider:** Use Google Gemini (free tier) for NLP parsing and Receipt OCR (Vision). Abstract behind an interface for future provider swaps.
- **Categories:** Hierarchical system — top-level Categories (Food, Groceries, Transport, Shopping, etc.) with Sub-Categories. See `packages/shared/src/categories.ts` for canonical list.

## Command Shortcuts
- Dev: `pnpm turbo run dev`
- Test: `pnpm turbo run test`
- Lint: `pnpm turbo run lint`
- Add Package: `pnpm add <dep> --filter <package_name>`
- DB Migrate: `pnpm --filter db migrate`