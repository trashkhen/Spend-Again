# Receipt Paper Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Spend Again? dashboard and all current pages so they feel more authored and brand-specific while preserving the current feature set, route structure, and page layout.

**Architecture:** This is a CSS-first visual refresh. Shared surface classes in `apps/dashboard/src/index.css` will be rethemed from generic frosted glass to warm receipt-paper cards, ledger dividers, stronger typography, and integrated banner/logo treatment. JSX changes are limited to small class/asset hooks where needed, with no data-flow, API, or route changes.

**Tech Stack:** React, Vite, TypeScript, CSS, pnpm.

---

### Task 1: Shared Visual System

**Files:**
- Modify: `apps/dashboard/src/index.css`

- [ ] **Step 1: Add receipt-paper tokens**

Add tokens for paper surfaces, dashed dividers, stronger text hierarchy, and custom easing. Keep the existing brand palette values: cream, forest green, leaf green, coral, and gold.

- [ ] **Step 2: Retheme shared page surfaces**

Update `page-header`, `chart-wrapper`, `tx-list-card`, `filter-bar`, `modal`, `drawer`, `table-state`, `space-card`, `iou-card`, and `debt-item` so every existing page inherits the same paper-led visual language.

- [ ] **Step 3: Preserve behavior**

Do not remove or reorder dashboard features. Dashboard must still show KPIs, transaction list, category chart, Spaces, and IOUs on the home screen.

### Task 2: Page-Specific Polish

**Files:**
- Modify: `apps/dashboard/src/index.css`
- Modify if needed: `apps/dashboard/src/pages/Dashboard.tsx`
- Modify if needed: `apps/dashboard/src/pages/Login.tsx`

- [ ] **Step 1: Dashboard**

Keep the existing hero, KPI grid, transaction list, category chart, Spaces, and IOUs. Restyle the hero banner so it is integrated rather than a separate generic glass card.

- [ ] **Step 2: Analytics**

Keep existing analytics charts and summary cards. Apply the shared paper surface and typography rules.

- [ ] **Step 3: Recurring, Spaces, People/IOUs**

Keep all lists, tabs, detail pages, edit controls, and buttons. Apply consistent paper cards, dashed dividers, tab styles, and ledger-like rows.

- [ ] **Step 4: Auth, Login, Welcome**

Keep login flow and CTA behavior. Make the banner feel intentional, use paper card styling, and improve font hierarchy.

### Task 3: Verification

**Files:**
- Check: `apps/dashboard/src/index.css`
- Check: `apps/dashboard/src/pages/*.tsx`

- [ ] **Step 1: Run package checks**

Run `pnpm --filter dashboard lint` and `pnpm --filter dashboard test` if those scripts exist.

- [ ] **Step 2: Build dashboard**

Run `pnpm --filter dashboard build`.

- [ ] **Step 3: Visual smoke check**

Start `pnpm --filter dashboard dev`, open the app locally, and inspect the main dashboard plus representative secondary pages where possible.

---

## Self-Review

- Scope preserves existing features, especially Spaces and IOUs on the home screen.
- Plan avoids route, API, parser, database, and bot changes.
- CSS-first approach fits the user request: card styles, banners, and fonts.
- Verification uses package-filtered pnpm commands per project instructions.
