# DLang Basketball — Club Operating System (Web App)

Production scaffold: **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Supabase**.

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in Supabase + Stripe + Resend keys
npm run dev                     # http://localhost:3000
```

The database lives in the companion `supabase/` migrations (separate deliverable).
After deploying that schema, regenerate types:

```bash
npm run types                   # supabase gen types -> src/types/database.ts
```

## How it's organized

```
middleware.ts                  Auth gate + Supabase session refresh (runs on every request)
tailwind.config.ts             Theme tokens -> utilities (bg-surface, text-ink, text-maroon …)
src/
  app/
    globals.css                Design tokens (from the prototype) + base styles + grain
    layout.tsx                 Root layout; wires Fraunces / Geist / Geist Mono to CSS vars
    page.tsx                   Sends each user to their role home
    (auth)/login               Magic-link sign in
    (admin)/                   Group: requireRole(['admin','finance']) -> sidebar shell
      admin/dashboard          Starter dashboard (KPIs, activity feed, quick actions)
      admin/{families,athletes,programs,registrations,invoices,payments,attendance,bookings,settings}
    (coach)/                   Group: requireRole(['coach']) -> bottom-tab shell
      coach/{schedule,attendance}
    (parent)/                  Group: requireRole(['parent']) -> bottom-tab shell
      parent/{home,children,invoices,bookings,documents}
    register/[programSlug]     Public program landing + registration entry
    auth/callback              Magic-link code exchange
    auth/signout               POST -> sign out
  components/
    ui/                        Reusable primitives: button, card, badge, input, stat-card,
                               page-header, empty-state, data-table  (barrel: index.ts)
    layout/                    app-shell (responsive), nav-config, brand-mark
  lib/
    supabase/{client,server,middleware}.ts   @supabase/ssr clients for each context
    auth/{roles,get-user}.ts                  AppRole, requireRole(), getSessionUser()
    utils.ts                                  cn(), formatCHF(), formatDate()
  types/database.ts            Hand-written subset; regenerate with `npm run types`
```

## Auth & role protection (two layers + RLS)

1. **`middleware.ts`** refreshes the session and bounces signed-out users to `/login`.
2. **Group layouts** call `requireRole([...])` (server-side) to keep each role in its own area.
3. **Supabase RLS** is the real boundary — even if routing were bypassed, the database
   returns only rows the user is entitled to. The `service_role` key (server-only, used by
   the Stripe webhook) is the sole path that bypasses RLS.

## Design system

All colors/spacing/shadows come from the prototype, declared once in `globals.css`
(`--bg-main #0A0A0A`, `--red-primary #DA2627`, the surface/ink/line ramps, semantic
success/warning/danger) and exposed as Tailwind utilities via `tailwind.config.ts`.
Typography: **Fraunces** (display), **Geist** (UI), **Geist Mono** (numbers via `.tnum`).

## What's stubbed vs. wired

- **Wired:** auth (magic link), session refresh, role routing, layout/navigation,
  theme, the full route tree, and an interactive coach attendance demo.
- **Stubbed with sample data + `// NOTE:` pointers:** the dashboard KPIs and each list page.
  Each file shows exactly where to drop the Supabase query. RLS means a `select *` from a
  page returns only the caller's permitted rows, so wiring is mostly deleting sample arrays.
