---
name: Monorepo Structure
description: Package names, directory paths, workspace conventions, TypeScript config, and toolchain decisions for the Spend Again? monorepo
type: project
---

## Workspace Package Names and Paths

| Package name | Directory | Role |
|---|---|---|
| `@spend-again/bot` | `apps/bot/` | Telegram bot (grammY) — implemented in Task 1.4 |
| `@spend-again/api` | `apps/api/` | REST API (Hono) — implemented in Task 1.5 |
| `@spend-again/dashboard` | `apps/dashboard/` | React + Vite frontend — implemented in Task 1.6 |
| `@spend-again/shared` | `packages/shared/` | Types, constants, categories — implemented in Task 1.2 |
| `@spend-again/db` | `packages/db/` | Drizzle ORM schema + Supabase client — implemented in Task 1.3 |
| `@spend-again/parser` | `packages/parser/` | 3-tier NLP parsing engine — implemented in Task 2.1+ |

Root workspace name: `spend-again` (private, no package scope).

## TypeScript Config Strategy

- Root `tsconfig.base.json` sets strict mode, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.
- All packages extend `../../tsconfig.base.json` (or `../..` relative to their location).
- Node packages (`bot`, `api`, `shared`, `db`, `parser`) use `module: NodeNext`, `moduleResolution: NodeNext`.
- Dashboard overrides: `module: ESNext`, `moduleResolution: Bundler`, adds `DOM` lib and `jsx: react-jsx`.
- Dashboard build script uses `tsc --noEmit` only (no Vite build until Task 1.6 adds `index.html`).

## Turbo Pipeline

Tasks defined in `turbo.json`:
- `build`: depends on `^build` (upstream packages), outputs `dist/**`
- `dev`: no cache, persistent, depends on `^build`
- `test`: depends on `^build`, outputs `coverage/**`
- `lint`: no inter-package deps
- `type-check`: depends on `^build`

## ESLint Config

Using ESLint v9 flat config (`eslint.config.js`). Rules:
- `@typescript-eslint/no-explicit-any: error` — enforces zero `any`
- `@typescript-eslint/consistent-type-imports: error` — enforces `import type`

## Key Conventions

- Currency: SGD, stored as integer cents (`amount_cents` NUMERIC in DB)
- Dates: DD/MM/YYYY display format
- Import alias pattern: `@spend-again/<package>` (e.g., `@spend-again/shared`)
- Workspace inter-dependencies use `workspace:*` protocol

**Why:** Project uses pnpm workspaces + Turborepo for monorepo orchestration, strict TypeScript for correctness, and no `any` as a hard rule.
**How to apply:** All new packages must extend `tsconfig.base.json`, use `@spend-again/<name>` naming, and declare workspace deps with `workspace:*`.
