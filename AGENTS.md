# AI Agent Instructions (Spend Again?)

## Core Tech Stack
- Monorepo: Turborepo / pnpm
- Frontend: React + Vite + TypeScript
- Backend: Hono (API server)
- Bot: grammY (Telegram bot framework)
- Database: PostgreSQL + Drizzle ORM (hosted on Supabase)
- AI/LLM: Google Gemini (free tier)
- Testing: Vitest
- Logic: AI-assisted natural language parsing (Singapore context)

## Development Workflow
- **Package Management:** Always use `pnpm`. Do not use `npm` or `yarn`.
- **Filtering:** When running commands, always use the `--filter` flag to target specific packages (e.g., `pnpm --filter web dev`).
- **Turbo:** Use `pnpm turbo run <script>` for monorepo-wide commands.
- **Scaffolding:** Use `pnpm create vite@latest <name> --template react-ts` for new modules.

## Technical Constraints
- **Singapore Context:** Currency is SGD. Dates should default to DD/MM/YYYY.
- **Parsing Logic:** Expense entries are natural language. Prioritize accuracy in extracting (Amount, Category, Item, Date).
- **Categories:** Use hierarchical Category → Sub-Category system. See `packages/shared/src/categories.ts`.
- **Type Safety:** No `any`. Strict TypeScript rules apply. If a type is missing, generate it in the `packages/types` (if applicable) or the local `types.ts`.
- **Currency Storage:** Store currency as integer cents (`amount_cents`) in PostgreSQL. Display as decimal in the UI.

## Testing & Quality
- **Pre-Commit:** Run `pnpm lint` and `pnpm test` on the specific package before suggesting a final code block.
- **Test Focus:** Use `pnpm vitest run -t "<name>"` to isolate unit tests for the parsing engine.
- **Environment:** Check the CI plan in `.github/workflows` to ensure proposed changes won't break the build.

## Project Structure
- `apps/bot` — Telegram bot (grammY)
- `apps/api` — REST API (Hono)
- `apps/dashboard` — Frontend (React + Vite)
- `packages/shared` — Types, constants, SG mappings
- `packages/parser` — NLP parsing engine (regex + Gemini)
- `packages/db` — Drizzle schema, queries, migrations