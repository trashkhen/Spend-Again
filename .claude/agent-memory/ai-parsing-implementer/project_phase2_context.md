---
name: Spend Again? Phase 2 Context
description: Project layout, current work phase, task IDs, and key architecture decisions for the AI parsing phase
type: project
---

This is a Singapore-centric expense tracker (pnpm + Turborepo monorepo).

Current active work: Task 2.1 — Regex Parser (Tier 1), part of a 3-tier parsing system:
- Tier 1 = regex (Task 2.1, in progress)
- Tier 2 = learned mappings DB lookup (Task 2.3)
- Tier 3 = Gemini LLM (Task 2.2)
- Task 2.4 = unified parse() orchestrator combining all three tiers
- Task 2.5 = forwarded SMS parser

**Why:** Tasks 1.x (scaffolding) are complete. Phase 2 implements the AI/parsing layer.

**How to apply:** When picking up Task 2.1, the regex.ts and test files are already written and just need the test runner issue resolved (see vitest memory entry). Then build the remaining 2.x tasks in order.

Key package locations:
- `packages/parser/` — the parser package (Task 2.1 target)
- `packages/shared/src/sg-mappings.ts` — SG_ITEM_MAP (81 merchant entries)
- `packages/shared/src/categories.ts` — Category and SubCategory types
- ParseResult type is defined in `packages/parser/src/regex.ts` (exported from index.ts too)
