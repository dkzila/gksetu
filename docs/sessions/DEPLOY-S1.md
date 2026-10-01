# DEPLOY-S1 — First Vercel deployment support: the "Could not load the country configuration" incident

**Date:** 2026-10-01 · **Stage:** deployment support (post-REBRAND-S1) · **Trigger:** the user deployed `dkzila/gksetu` to Vercel (`https://gksetu.vercel.app`), added `GKSETU_DATABASE_URL` + `GKSETU_PUBLIC_BASE_URL`, and the site showed only *"Could not load the country configuration. Refresh the page to retry."*

## 1. Root cause — established from live evidence, not guesses

- **Deployed code is correct and current:** the live homepage carries the full
  GKSetu branding and title (`GKSetu — Next-Gen Global GK & Current Affairs
  Platform`) — i.e. the deployment was built from `main` at `6b72d3f`
  (REBRAND-S1).
- **Supabase is healthy:** the sandbox dev server (same session-pooler URL,
  same password) connects fine — project `kbezlaqsvvlmgllkvszn` is up,
  schema live, IN/FR ACTIVE. The database is NOT the problem.
- **The live API fails exactly at the database:** `GET
  https://gksetu.vercel.app/api/health` → `503
  {"code":"SERVICE_UNAVAILABLE","message":"Database connection failed"}`.
- **Diagnosis:** `GKSETU_DATABASE_URL` is not arriving at the Vercel
  *runtime* in a working form. The four candidate causes (in likelihood
  order): (1) no **Redeploy** after adding the variables — Vercel applies
  env vars only to deployments created after the change; (2) variable scoped
  to non-Production environments; (3) value pasted with quotes or the
  `[YOUR-PASSWORD]` placeholder; (4) the IPv6-only direct host
  `db.<ref>.supabase.co` instead of the session pooler. All four have
  different dashboard fixes — and the old health response could not tell
  them apart.

The homepage symptom is fully explained: the shell is static and renders;
`page.tsx` then fetches `/api/countries`, which needs the database, fails,
and sets `configError` → the message. No code bug.

## 2. What this session changed (the fix the operator + the platform needed)

### 2.1 `/api/health` now names the cause (code + docs/vercel-deployment.md §5.3)

New module `src/lib/api/database-diagnostics.ts` — a pure classifier over
the connection string's **shape** (never the value): missing/empty →
`DATABASE_NOT_CONFIGURED/missing-env-var`; quotes → `quoted-value`;
`[YOUR-PASSWORD]` → `password-placeholder`; unparseable → `unparseable-url`;
direct `db.<ref>.supabase.co` → `supabase-direct-ipv6`; pooler port 6543 →
`supabase-transaction-pooler`; pooler 5432 but failing →
`DATABASE_UNREACHABLE/supabase-pooler-unreachable`; other host →
`connection-failed`. Each message is the actionable fix (where to click,
what to paste). The health route's catch now returns
`fail(diagnosis.message, diagnosis.code, 503, diagnosis.details)`; the
success path additionally labels the host `Supabase (session pooler)` when
the pooler is in use. No secret ever leaves the server — only the matched
pattern.

### 2.2 `docs/vercel-deployment.md` §5 — troubleshooting the first deployment

The symptom explained (shell loads, data fails → always a database-config
problem), the checklist in cause-frequency order (redeploy after variable
changes first — the classic miss; Production scope; raw value; the session
pooler URL vs direct/transaction hosts), and the §5.3 table mapping every
health code/hint to its fix. §3 step 6 and the header updated to match.

## 3. Verification

- Classifier pure-function test: all 11 input cases → expected code + hint
  (`/tmp/test-diagnostics.ts`, one-off, not committed).
- **Real route handler end-to-end:** imported the actual
  `src/app/api/health/route` and called `GET()` with poisoned
  `GKSETU_DATABASE_URL` — wrong password on the pooler → live Prisma
  `Authentication failed` → `503 DATABASE_UNREACHABLE
  {"hint":"supabase-pooler-unreachable"}`; direct `db.*` host → `503
  DATABASE_MISCONFIGURED {"hint":"supabase-direct-ipv6"}`. The catch path is
  proven against real Prisma failures, not simulated ones.
- Dev server (3000, Supabase pooler): `/api/health` → `200 ok`, `host:
  "Supabase (session pooler)"` — success path unchanged.
- `tsc --noEmit` + `eslint .` clean.

## 4. The operator's fix (what was sent back, verbatim steps)

1. Vercel → Project **gksetu** → Settings → Environment Variables: confirm
   `GKSETU_DATABASE_URL` exists with value
   `postgresql://postgres.kbezlaqsvvlmgllkvszn:<DB-PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   (raw — no quotes), environments **Production** (at minimum), and
   `GKSETU_PUBLIC_BASE_URL = https://gksetu.vercel.app`.
2. **Deployments → latest → ⋯ → Redeploy** (mandatory — variables apply only
   to deployments created after the change).
3. Verify `https://gksetu.vercel.app/api/health` → `"status": "ok"`.
4. Supabase→Vercel integration: **not needed** (this app reads no
   `NEXT_PUBLIC_SUPABASE_*`/`SUPABASE_*` variables — pure Prisma+Postgres);
   it lives in Vercel → Integrations → Marketplace (or Supabase →
   Integrations) if ever wanted, and would not replace step 1.

Test credentials unchanged from REBRAND-S1 (see its table): platform owner
`admin@gksetu.dev` / `GKSetu-Dev-Admin-1`; console via the footer
"Staff console" link.

## 5. Files

- New: `src/lib/api/database-diagnostics.ts`,
  `docs/sessions/DEPLOY-S1.md` (this file).
- Modified: `src/app/api/health/route.ts`, `docs/vercel-deployment.md`.

## 6. Honest state at session close

The Vercel-side fix is in the user's hands (no Vercel credentials in this
session). The live deployment was still returning the generic
`SERVICE_UNAVAILABLE` at last check — it predates this commit. Once the
user redeploys from the updated `main`, the same health endpoint will either
turn green or say exactly which of the four causes remains.
