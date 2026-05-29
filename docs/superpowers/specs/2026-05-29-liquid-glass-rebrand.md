# Spend Again? — Liquid Glass UI & Brand Redesign

**Date:** 2026-05-29  
**Scope:** Web dashboard only (`apps/dashboard`). No API, bot, schema, or auth changes.  
**Approach:** CSS token overhaul + targeted component edits. No new dependencies.

---

## 1. Design Decisions

### Navigation chrome
- **Icon-only sidebar:** 60px wide, fixed left, forest green background (`#136B4C`). Always compact — no expand-on-hover.
- Active nav item: rounded pill background at `rgba(255,255,255,0.18)`.
- Inactive icons: `rgba(255,255,255,0.40)` stroke.
- Sidebar logo slot: `Logo_v2.png` at 40×40px, `border-radius: 12px`.
- User avatar at sidebar bottom: 32px circle, `rgba(255,255,255,0.15)` background.
- **Frosted glass top bar:** `background: rgba(255,247,230,0.72); backdrop-filter: blur(16px)`, 56px tall, cream-tinted. Contains search pill + user actions.
- Mobile: sidebar slides in/out as before; hamburger toggle remains.

### Glass surface system
Cards use **Level 2** glass throughout:
```
background: rgba(255, 255, 255, 0.68)
backdrop-filter: blur(12px)
-webkit-backdrop-filter: blur(12px)
border: 1px solid rgba(255, 255, 255, 0.80)
box-shadow: 0 4px 16px rgba(19,107,76,0.07), 0 1px 3px rgba(0,0,0,0.04)
border-radius: 20px  (main cards) / 16px (KPI cards)
```

### Login page
- Layout: centred glass card, max-width 400px.
- Top of card: banner strip housing `Banner.png` at full width (landscape format, natural fit).
- Below banner: prompt text → Telegram CTA button → 3-step instructions (unchanged logic).
- Background: cream `#FFF7E6`.
- No circular logo — replaced entirely by the banner image.

### Welcome page
- Same glass card treatment as login.
- Replace circular logo with `Logo_v2.png` (compact cat icon, 80×80px, rounded square).

---

## 2. Colour Token System

Replace all existing CSS variables in `index.css`:

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#FFF7E6` | Page background (Cream) |
| `--color-surface` | `rgba(255,255,255,0.68)` | Glass card base |
| `--color-surface-solid` | `#FFFFFF` | Modals, drawers (non-glass) |
| `--color-surface-2` | `rgba(255,255,255,0.85)` | Hover states on glass |
| `--color-border` | `rgba(255,255,255,0.80)` | Glass card borders |
| `--color-border-subtle` | `rgba(19,107,76,0.09)` | Dividers, row separators |
| `--color-border-hover` | `rgba(19,107,76,0.18)` | Hover border tint |
| `--color-accent` | `#136B4C` | Forest Green — primary, sidebar, headings |
| `--color-accent-mid` | `#27AE60` | Leaf Green — secondary, success, positive |
| `--color-accent-dim` | `rgba(19,107,76,0.10)` | Icon backgrounds, tinted areas |
| `--color-coral` | `#FF6B6B` | Coral — CTA buttons, "Again?" wordmark, alerts |
| `--color-coral-dim` | `rgba(255,107,107,0.10)` | Coral icon backgrounds |
| `--color-gold` | `#FFC857` | Golden Sun — top-category KPI accent |
| `--color-gold-dim` | `rgba(255,200,87,0.15)` | Gold icon backgrounds |
| `--color-text` | `#1A2E22` | Primary text (dark forest) |
| `--color-text-muted` | `#6B8C7A` | Secondary text |
| `--color-text-dim` | `#A8C4B4` | Placeholder, disabled |
| `--color-success` | `#27AE60` | Positive amounts, safe budget |
| `--color-error` | `#EF4444` | Errors, exceeded budget |
| `--color-warning` | `#F97316` | Warning budget tier |
| `--color-sidebar` | `#136B4C` | Sidebar background |
| `--color-sidebar-active` | `rgba(255,255,255,0.18)` | Active nav pill |
| `--color-sidebar-icon` | `rgba(255,255,255,0.90)` | Active icon |
| `--color-sidebar-icon-muted` | `rgba(255,255,255,0.40)` | Inactive icon |

### Additional tokens

```css
/* Shadows */
--shadow-sm:  0 1px 3px rgba(0,0,0,0.04);
--shadow-md:  0 4px 16px rgba(19,107,76,0.07), 0 1px 3px rgba(0,0,0,0.04);
--shadow-lg:  0 12px 40px rgba(19,107,76,0.12), 0 2px 8px rgba(0,0,0,0.06);
--shadow-xl:  0 24px 80px rgba(19,107,76,0.14), 0 4px 16px rgba(0,0,0,0.08);

/* Blur */
--blur-sm:  blur(8px)
--blur-md:  blur(12px)
--blur-lg:  blur(16px)

/* Radii */
--radius-sm:  10px
--radius-md:  14px
--radius-lg:  20px
--radius-xl:  24px
--radius-pill: 99px

/* Motion */
--transition-fast: 150ms ease
--transition-base: 250ms ease
--transition-spring: 160ms cubic-bezier(0.23, 1, 0.32, 1)
```

---

## 3. Component Changes

### `src/index.css` — Full rewrite of all CSS variables + glass utilities
- Swap all tokens per Section 2.
- `.sidebar` → `background: var(--color-sidebar); width: 60px`.
- `.sidebar-logo` → remove border-bottom, just padding for icon.
- `.nav-item` → icon-only pill, no label, centered icon.
- `.nav-item--active` → `background: var(--color-sidebar-active)`.
- `.app-header` → frosted glass: `background: rgba(255,247,230,0.72); backdrop-filter: var(--blur-lg)`.
- `.kpi-card` → glass card Level 2 + thin top-edge accent via `border-top: 2px solid <accent>`.
- `.chart-wrapper` → glass card Level 2.
- `.tx-list-card` → glass card Level 2.
- `.filter-bar` → glass card Level 2, `border-radius: var(--radius-md)`.
- `.modal-backdrop` → `background: rgba(0,0,0,0.35); backdrop-filter: var(--blur-sm)`.
- `.modal` → glass card with `--shadow-xl`.
- `.drawer` → `background: var(--color-surface-solid)` (non-glass — drawer slides over content so backdrop-filter won't show through).
- `.btn-add-transaction`, `.btn-save`, `.drawer-confirm` → `background: var(--color-coral); border-radius: var(--radius-pill)` (pill shape, coral CTA).
- `.btn-budget` → keep error red (budget exceeded signal, intentional).
- `.header-avatar` → `background: linear-gradient(135deg, #136B4C, #27AE60)`.
- `.spinner` → `border-top-color: var(--color-accent)`.
- `.login-card`, `.welcome-card` → glass Level 2, `border-radius: var(--radius-xl)`.
- `.budget-toast` → keep red background (alert intent preserved).
- KPI budget tier classes → keep existing `kpi-budget--*` border-left colors (unchanged logic, visual signal preserved).
- All `--color-accent` references that were steel-blue → now map to `--color-accent` (forest green).
- Focus rings: `box-shadow: 0 0 0 3px rgba(19,107,76,0.15)`.

### `src/components/Sidebar.tsx` — Icon-only rebuild
- Remove `sidebar-logo-name`, `sidebar-logo-sub` (text labels gone).
- Logo slot: `<img src="/logo_v2.png" ... style="width:40px;height:40px;border-radius:12px" />`.
- Each `<Link>` becomes icon-only — remove label text, keep `aria-label` on the link.
- `sidebar-footer`: remove copyright text; replace with user avatar circle (initial letter).
- Sidebar width changes from 240px to 60px → update `.app-content { margin-left: 60px }`.

### `src/components/Header.tsx` — Frosted glass
- Add `page-title` span to left of header showing current page name (Dashboard / Analytics).
- Keep search input and user section as-is; just CSS token swap.
- No structural changes.

### `src/pages/Login.tsx` — Glass card + Banner
- Replace `<img src="/logo.png" className="login-logo-img">` with `<img src="/banner.png" className="login-banner-img">`.
- New CSS class `.login-banner-img`: `width: 100%; border-radius: 0; object-fit: contain; max-height: 120px`.
- Banner sits inside a `.login-banner-strip` div at the top of the card (subtle cream background, bottom border).
- Remove `login-title` and `login-subtitle` (wordmark is now in the banner image).
- Rest of form content (prompt, Telegram link, steps, dev section, error) stays identical.
- New CSS classes `.login-banner-strip` and `.login-banner-img` added to `index.css` under the login section.

### `src/pages/Welcome.tsx` — Logo swap
- Replace circular `logo.png` with `Logo_v2.png` at 80×80px, `border-radius: 16px` (rounded square, not circle).
- Keep welcome-check, title, subtitle, options as-is.

### `src/pages/Auth.tsx` — Token-only
- No structural changes; CSS token swap covers it.

### `src/components/charts/CategoryBreakdown.tsx` — Brand palette
- Replace `PALETTE` array with brand colours:
  ```ts
  const PALETTE = [
    '#136B4C', '#27AE60', '#FF6B6B', '#FFC857',
    '#2A9D8F', '#E9C46A', '#F4A261', '#264653',
    '#6B8C7A', '#A8C4B4', '#E76F51', '#023047',
  ]
  ```
- Keep `cornerRadius` and `paddingAngle` on `<Pie>` unchanged (preserves rounded-arc donut style).

### `src/components/charts/MonthlySpendChart.tsx` — Brand palette
- Bar fill: `#136B4C` (forest green) with hover `#27AE60`.
- Grid lines: `rgba(19,107,76,0.08)`.
- Axis text: `var(--color-text-muted)` equivalent (`#6B8C7A`).

### `src/components/charts/DailyTrend.tsx` — Brand palette
- Line stroke: `#136B4C`.
- Area fill: `rgba(19,107,76,0.10)`.
- Dot fill: `#27AE60`.
- Grid lines: `rgba(19,107,76,0.08)`.

---

## 4. Asset Changes

| Action | From | To |
|---|---|---|
| Copy | `Logo_v2.png` (project root) | `apps/dashboard/public/logo_v2.png` |
| Copy | `Banner.png` (project root) | `apps/dashboard/public/banner.png` |
| Keep | `apps/dashboard/public/logo.png` | Unchanged (fallback, referenced nowhere new) |
| Update | `apps/dashboard/index.html` | Add `<link rel="icon" href="/logo_v2.png">` |

No SVG generation needed — PNG assets are production-quality from the brand direction.

---

## 5. What Does NOT Change

- All routes, API calls, auth flows, data fetching — zero changes.
- `FilterBar.tsx` — kept, just CSS token update.
- `TransactionTable.tsx` — kept, just CSS token update.
- `TransactionModal.tsx` — kept, just CSS token update.
- Budget modal, budget KPI tiers, budget toast — all logic and copy preserved.
- Donut chart `cornerRadius` + `paddingAngle` — preserved exactly.
- Telegram login widget integration — untouched.
- All `apps/bot`, `apps/api`, `packages/db`, `packages/shared` — untouched.

---

## 6. File Change Summary

| File | Change type |
|---|---|
| `apps/dashboard/src/index.css` | Full rewrite (tokens + all glass classes) |
| `apps/dashboard/src/components/Sidebar.tsx` | Structural rebuild (icon-only) |
| `apps/dashboard/src/components/Header.tsx` | Minor (token swap, page title label) |
| `apps/dashboard/src/pages/Login.tsx` | Moderate (banner strip, remove title) |
| `apps/dashboard/src/pages/Welcome.tsx` | Minor (logo swap) |
| `apps/dashboard/src/pages/Auth.tsx` | CSS-only (token swap via index.css) |
| `apps/dashboard/src/components/charts/CategoryBreakdown.tsx` | Minor (palette array) |
| `apps/dashboard/src/components/charts/MonthlySpendChart.tsx` | Minor (colour props) |
| `apps/dashboard/src/components/charts/DailyTrend.tsx` | Minor (colour props) |
| `apps/dashboard/public/logo_v2.png` | New (copied from root) |
| `apps/dashboard/public/banner.png` | New (copied from root) |
| `apps/dashboard/index.html` | Minor (favicon link) |
