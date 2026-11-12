# Club OS Design System

The production UI follows the V1 clickable prototype
(`docs/design/club-os-v1-prototype.html`, "V5 dark luxury" palette). This file
is the contract between the design system, the tenancy (white-label) work and
every page author.

- Token source: `src/app/globals.css` (`:root`)
- Tailwind mapping: `tailwind.config.ts`
- Primitives: `src/components/ui/*` (barrel: `@/components/ui`)
- App shell: `src/components/layout/app-shell.tsx`, `notification-bell.tsx`, `brand-mark.tsx`
- Fonts: `src/app/layout.tsx` (`next/font/google`)

---

## 1. Runtime theming contract (for the tenancy track)

All colours, fonts, radii and shadows are CSS custom properties holding
**plain CSS values** (hex colours, px, font stacks). To re-brand a tenant,
write the overrides onto `:root` (the `<html>` element), either server-side
in the root layout or with a `<style>` tag:

```html
<html data-theme="light" style="--brand-primary:#0B5FFF; --brand-primary-dark:#0847C2; --brand-primary-text:#0847C2;">
```

```css
/* or, emitted per tenant in a stylesheet. Use a selector at least as specific
   as the theme blocks (:root[data-theme="light"] is 0,2,0), for example: */
html:root[data-tenant] { --brand-primary: #0B5FFF; --brand-primary-dark: #0847C2; }
```

The inline `style` attribute on `<html>` is the simplest option because it
always wins over the theme blocks. A plain `:root { ... }` rule loses to the
light theme block on specificity.

Rules:

1. Set overrides on `:root`/`<html>`, not on a nested element. Derived tokens
   (`*-soft`, glows, focus ring) are computed on `:root` with `color-mix()`, so
   they follow automatically only when the base token changes on the same
   element.
2. Use hex (or any CSS colour). Do **not** use space-separated RGB channels.
3. Theme selection is the `data-theme` attribute on `<html>`:
   - absent / `"dark"`: dark luxury (default)
   - `"light"`: light theme
   - `"system"`: follows `prefers-color-scheme`
   Tenant brand overrides apply on top of whichever theme is active, provided
   they use the inline `style` or a selector as specific as the one above.
4. Whenever you override `--brand-primary`, also supply `--brand-primary-text`
   (the brand colour used as text on `--bg`), and check it reaches 4.5:1
   against `--bg` and `--surface`. If the brand colour is very light, also set
   `--brand-primary-contrast` (text placed on brand-primary) to a dark colour.

### 1.1 Overridable tokens

| Token | Dark default | Light default | Purpose |
|---|---|---|---|
| `--brand-primary` | `#DA2627` | `#B81E1F` | Primary buttons, active nav, KPI bar, badges |
| `--brand-primary-dark` | `#961F1F` | `#961F1F` | Hover / pressed |
| `--brand-primary-deep` | `#321615` | `#F6E7E5` | Banner surfaces (burgundy / soft tint) |
| `--brand-primary-contrast` | `#FFFFFF` | `#FFFFFF` | Text/icons on brand-primary |
| `--brand-primary-text` | `#F25555` | `#A51C1D` | Brand colour used as text (AA) |
| `--brand-accent` | `#C19A45` | `#A9832F` | Gold accent (premium, highlights) |
| `--brand-accent-dark` | `#9C7A35` | `#8A6A24` | Accent gradient end |
| `--brand-accent-contrast` | `#0A0A0A` | `#FFFFFF` | Text on accent |
| `--brand-accent-text` | `#C19A45` | `#7A5D1F` | Accent used as text (AA) |
| `--bg` | `#0A0A0A` | `#FAF8F5` | Page background |
| `--bg-secondary` | `#121212` | `#F3EFE9` | Sidebar, top bar, table heads, card footers |
| `--surface` | `#1A1A1A` | `#FFFFFF` | Cards |
| `--surface-elevated` | `#222222` | `#F7F4EF` | Hover rows, popovers, neutral pills |
| `--surface-input` | `#1F1F1F` | `#FFFFFF` | Form fields |
| `--border` | `#2A2A2A` | `#E4DFD8` | Borders, dividers |
| `--border-soft` | `#1F1F1F` | `#EEEAE4` | Row dividers |
| `--border-strong` | `#3A3A3A` | `#CFC8BE` | Hovered fields, scrollbars |
| `--text` | `#F1F1F1` | `#161414` | Primary text |
| `--text-secondary` | `#B8B8B8` | `#3F3B38` | Body copy in tables |
| `--text-muted` | `#9A999A` | `#5E5A57` | Labels, captions (AA) |
| `--text-subtle` | `#8F8E8F` | `#6E6A66` | Timestamps, placeholders (AA) |
| `--text-disabled` | `#636263` | `#A8A39D` | Decorative only (fails AA by design) |
| `--text-inverse` | `#FFFFFF` | `#FFFFFF` | Text on saturated fills |
| `--success` / `--success-text` | `#4FAE5F` | `#2E8540` / `#2A7339` | Paid, present, confirmed |
| `--warning` / `--warning-text` | `#D4A352` | `#B7791F` / `#8F5F0E` | Pending, due soon |
| `--danger` / `--danger-text` | `#DA2627` / `#F25555` | `#C42B2C` / `#A51C1D` | Overdue, failed, destructive |
| `--info` / `--info-text` | `#5B8DEF` / `#7FA6F2` | `#2F64D6` / `#2552B3` | Informational |
| `--font-display` | Fraunces | | Headings, KPI figures |
| `--font-ui` | Geist | | All UI text |
| `--font-mono` | Geist Mono | | Money, IDs, tabular numbers |
| `--radius-sm` / `--radius` / `--radius-md` / `--radius-lg` / `--radius-xl` | 4 / 6 / 8 / 14 / 20 px | | Corner radii |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | black-tuned | warm-grey tuned | Elevation |
| `--tap-target` | `44px` | | Minimum touch target |

Font tokens fall back to the `next/font` variables
(`--font-fraunces`, `--font-geist`, `--font-geist-mono`). A tenant that wants
another typeface must load it (for example a `<link>` to its stylesheet) and
then override `--font-display` / `--font-ui` with a full font stack.

### 1.2 Derived tokens (do not override)

`--brand-primary-soft`, `--brand-accent-soft`, `--success-soft`,
`--warning-soft`, `--danger-soft`, `--info-soft`, `--shadow-glow`,
`--shadow-glow-strong`, `--focus-ring`, `--page-glow`.

### 1.3 Legacy aliases

Older names still resolve (`--bg-main`, `--surface-card`, `--text-primary`,
`--ink-4`, `--red-primary`, `--red-dark`, `--red-deep`, `--burgundy-glow`,
`--maroon-soft`, `--glow-red`, `--glow-red-strong`, `--shadow-red`). New code
should use the canonical names.

---

## 2. Tailwind utilities

Colours are emitted as `var(--token)`. With an opacity modifier
(`bg-brand-primary/20`) they become
`color-mix(in srgb, var(--token) 20%, transparent)`, so modifiers work with
hex tokens.

| Utility root | Token |
|---|---|
| `brand-primary`, `-dark`, `-deep`, `-soft`, `-contrast` | brand |
| `brand-accent`, `-dark`, `-soft`, `-contrast` | accent |
| `bg`, `bg-secondary`, `surface`, `surface-elevated`, `surface-input` | surfaces |
| `border`, `border-soft`, `border-strong` | lines (`border-border`) |
| `text`, `text-secondary`, `text-muted`, `text-subtle` | text (`text-text-muted`) |
| `success`, `warning`, `danger`, `info` (+ `-soft`) | status |
| `text-on-brand`, `text-on-accent` | text on brand / accent fills |
| `shadow-glow`, `shadow-glow-strong`, `shadow-focus` | glows and focus ring |
| `font-display`, `font-sans`, `font-mono`, `.tnum` | type |
| `min-h-tap`, `min-w-tap`, `.touch-target` | 44px targets on touch devices |

**Text contrast rule:** `text-brand-primary`, `text-maroon`, `text-brand-accent`,
`text-success`, `text-warning`, `text-danger` and `text-info` are mapped to the
`*-text` tokens. Brand red `#DA2627` on `#0A0A0A` is about 4.0:1, which fails
AA, so text uses `#F25555` (5.1:1 or better on every dark surface). Fills
(`bg-*`) and borders keep the pure brand colour.

Legacy utility names used by existing pages keep working and map onto the
same tokens: `ink`, `ink-2`, `ink-3`, `ink-4`, `inverse`, `line`, `line-soft`,
`maroon`, `maroon-dark`, `maroon-deep`, `maroon-soft`, `surface-card`, `gold`.

Helper classes in `globals.css`: `.eyebrow` (uppercase overline label),
`.grain` (film-grain overlay), `.bg-brand-banner` (burgundy hero gradient),
`.bg-radial-brand` / `.bg-radial-maroon`, `.skip-link`, `.safe-bottom`.

---

## 3. Primitives (`@/components/ui`)

| Component | Prototype source | Notes |
|---|---|---|
| `Button` | `.btn` | variants `primary`, `secondary`, `ghost`, `danger`, `outline`, `accent`, `success`, `link`; sizes `sm`, `md`, `lg`, `icon`; `loading` prop (spinner + `aria-busy`) |
| `Card`, `CardHeader`, `CardTitle`, `CardMeta`, `CardBody`, `CardFooter` | `.card`, `.card-head`, `.card-foot` | title in Fraunces 18px |
| `Badge`, `statusTone()` | `.pill` | tones `neutral`, `success`, `warning`, `danger`, `maroon`/`brand`, `accent`, `info`, `premium`; `dot` prop |
| `Input`, `Textarea`, `Select`, `Label`, `FieldHint`, `fieldClass` | `.field` | uppercase eyebrow labels; `aria-invalid` turns the border red |
| `DataTable` | `.table` | eyebrow headers on `bg-secondary`; right-aligned columns use tabular numerics; focusable scroll region; optional `caption` |
| `StatCard`, `StatGrid` | `.kpi`, `.kpi-grid` | 3px left bar, `tone` (`brand`, `success`, `warning`, `danger`, `accent`), `accent` = gold treatment |
| `PageHeader` | `.page-head` | optional `eyebrow` (breadcrumbs) |
| `EmptyState`, `ErrorState` | | `ErrorState` is `role="alert"` |
| `Skeleton`, `SkeletonCard` | | shimmer, `aria-hidden`; card is `role="status"` |
| `Avatar` | `.avatar` | tones `brand`, `accent`, `neutral` |

## 4. App shell

- **Admin (`sidebar`)**: sticky 248px rail on `bg-secondary`, brand mark,
  nav items with a brand-tinted gradient and a glowing 3px bar for the active
  item (`aria-current="page"`), user footer with gold avatar. Sticky 60px top
  bar with a blurred background. Below `lg` the rail becomes a drawer
  (Escape and backdrop close it).
- **Coach / parent (`bottom`)**: compact sticky header and a 64px bottom tab
  bar respecting `safe-area-inset-bottom`. With more than 5 destinations the
  first 4 show as tabs and the rest open in a "More" sheet.
- A "Skip to content" link targets `#main`.

## 5. Accessibility baseline

- Text tokens meet WCAG AA (4.5:1) on `--bg`, `--bg-secondary`, `--surface`
  and `--surface-elevated` in both themes, except `--text-disabled`.
- One focus style everywhere: `--focus-ring` (2px page-coloured gap plus a 2px
  brand ring), applied with `:focus-visible`.
- Interactive controls carry `.touch-target`, which gives a 44x44px minimum
  on coarse pointers.
- `prefers-reduced-motion: reduce` turns off animations and transitions
  globally.
- Icons inside labelled controls are `aria-hidden`.

## 6. Adding to the system

1. Add new colours as tokens in `globals.css`, in both `:root` and the light
   blocks (`[data-theme="light"]` and the `system` media query), then map
   them in `tailwind.config.ts` using `token("name")`.
2. Never hard-code hex values in components. Use tokens so tenants can
   re-brand.
3. Check contrast for any token that is used as text.
