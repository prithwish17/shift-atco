# CLAUDE.md — shift-atco (main app)

> Read the root `../CLAUDE.md` first for workspace-wide rules (read-first, ask-which-folder, **never commit/push without being told**). This file adds app-specific detail.

**ShiftBud / Shift ATCO** — employee shift-management & HR dashboard (ATC duty rosters, leave, licenses). This is the default folder for work in the workspace.

> This folder is its own git repository. Git commands run here, not from the workspace root. Commit/push only on explicit instruction.

## Stack
Vite · React 18 · TypeScript · shadcn/ui (Radix) · Tailwind CSS · React Router · TanStack Query · React Hook Form + Zod · Supabase (auth/DB/storage) · Upstash Redis (cache) · Sentry · PostHog · Vercel serverless functions · PWA (service worker).

## Layout
```
src/
  pages/         route pages — admin/ atc/ employee/ supervisor/ wso/ + auth pages
  components/    UI; components/ui = shadcn primitives, leave/, upload/
  contexts/      React contexts
  hooks/         custom hooks
  services/      app/business services
  domain/        domain logic
  data-access/   data layer
  integrations/  supabase/ (client.ts, types.ts)
  lib/  utils/
api/             Vercel serverless functions (upload/, functions/, supabase/, cache/, leave-*.ts, metrics.ts, working-hours.ts)
public/          static assets, PWA manifest, sw.js
supabase/        Supabase project config / migrations
```

## Commands
```sh
npm install
npm run dev          # Vite dev server
npm run build        # production build -> dist/
npm run build:dev    # development-mode build
npm run preview      # serve the built bundle locally
npm run lint         # eslint
npx tsc --noEmit     # type-check (do this before every build/deploy)
```

## Conventions
- TypeScript throughout (`.tsx`/`.ts`). Match existing patterns in neighbouring files.
- UI: compose shadcn/ui primitives from `components/ui`; style with Tailwind. Don't hand-roll components that already exist there.
- Data fetching via TanStack Query; forms via React Hook Form + Zod schemas.
- Supabase access goes through `src/integrations/supabase/client.ts`; keep generated types in `types.ts` in sync with schema changes.
- Keep secrets in `.env` (gitignored). Frontend env vars are prefixed `VITE_`.

## Env / deploy notes
- `VITE_APP_BASE_URL` — deployed app URL (e.g. `https://atcora.in`); used so auth emails (reset/confirm) link back correctly.
- `VITE_ROSTER_AUTOMATION_API_URL` — URL of the separate `roster_automation` controller API (the supervisor-suggestion feature). Defaults to `http://localhost:4000` in local dev.
- Deploy target: Vercel. `vercel.json` defines function `maxDuration`, cache headers (no-cache for `index.html`/`sw.js`/manifest, immutable for `/assets`), and SPA rewrites (everything non-`/api` → `index.html`).
- Before deploying: `npm run lint` → `npx tsc --noEmit` → `npm run build` → `npm run preview` smoke test. Commit/push only when told.

## Reference docs in this folder
`README.md`, `ENTERPRISE_RULE_ENGINE_PLAN.md`, `ROSTER_RULES_COMPILED.md`, `LEAVE_RULES_AND_SCHEMA_SUMMARY.txt`, `REDIS_CACHING.md`, `SECURITY.md`, and the various `*_IMPLEMENTATION_*` / `PHASE*` notes. Check these before changing roster, leave, or caching logic.
