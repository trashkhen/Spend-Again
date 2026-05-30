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

## Database Migrations
- **Always apply migrations via the Supabase MCP `apply_migration` tool, not `pnpm --filter db migrate`.**
  - The local machine's outbound port 5432 is blocked, so direct pg connections (drizzle-kit, pg_dump, `pnpm migrate`) time out.
  - Supabase MCP `apply_migration` goes over HTTPS to the Management API and records the run in `supabase_migrations.schema_migrations` so it stays visible in the dashboard.
  - Workflow: edit `packages/db/src/schema.ts`, run `pnpm --filter @spend-again/db generate` to produce the SQL file in `packages/db/drizzle/`, then paste the SQL into `apply_migration` with a snake_case name.
- One past incident (2026-05-28) shipped Phase 4's `DROP COLUMN date` without the prior `ADD COLUMN occurred_on` + backfill, because `pnpm migrate` had never reached the DB. Don't repeat: verify column/table existence with `list_tables` or `execute_sql` before any DDL.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- **Before invoking any superpowers skill OR when gathering requirements for any task**, run `graphify query "<topic>"` first to identify which specific files are relevant. Use this to narrow down what to read rather than browsing broadly.
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
