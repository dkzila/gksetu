# GKSetu on Vercel — the complete environment-variable and go-live guide

(Written by the P-SEC audit session; updated by REBRAND-S1 — the platform
rename GlobIQ → GKSetu changed the env-var names to `GKSETU_*`, the repo to
`dkzila/gksetu`, and the domain plan to `gksetu.vercel.app` (free subdomain,
now) → `gksetu.com` (custom domain, when attached). Updated by DEPLOY-S1 —
the first live deployment failed with `Database connection failed`; §5 is
the troubleshooting playbook for exactly that, and `/api/health` now names
the cause. Everything here was
verified against the live codebase — every variable the app actually reads,
nothing copied from a template. `docs/sessions/P-SEC.md` is the audit this
accompanies.)

---

## 1. The complete list of environment variables the app reads

The entire env surface of this codebase is **three variables**. This was
verified by scanning every `process.env` read in `src/`, `prisma/`,
`scripts/` and `next.config.ts`.

### 1.1 `GKSETU_DATABASE_URL` — REQUIRED, add manually in Vercel

| | |
|---|---|
| What it is | The PostgreSQL connection string. Prisma's datasource is wired to this exact name (`prisma/schema.prisma` → `url = env("GKSETU_DATABASE_URL")`). |
| Where it's read | Every database call in the app (via `src/lib/db.ts` → `@prisma/client`); `/api/health` also displays its host. |
| Value on Vercel (Production) | `postgresql://postgres.kbezlaqsvvlmgllkvszn:<DB-PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` |
| Why this exact URL | **The runtime adapter (`src/lib/db-url.ts`, DEPLOY-S2) rewrites Supabase pooler URLs to the TRANSACTION pooler (port 6543) with `pgbouncer=true`** before the Prisma client connects — the session pooler's per-project ceiling of 15 clients was exhausted live by serverless bursts (§5.4). The value above (session form) is still the right thing to PASTE: it also serves the Prisma CLI (`db:push`/migrate), which must not go through pgbouncer. Either port works in the env var — the adapter normalizes at runtime. The direct host `db.<ref>.supabase.co` stays wrong (IPv6-only). |
| Security | The password never enters git (`.env` is gitignored); on Vercel it lives only in the dashboard. |

### 1.2 `GKSETU_PUBLIC_BASE_URL` — strongly recommended, add manually

| | |
|---|---|
| What it is | The public origin of the site, used for SEO: `metadataBase` (`src/app/layout.tsx`) and canonical/sitemap/robots absolute URLs (`src/modules/seo/page-seo.ts`). |
| Fallback if unset | `resolveSiteOrigin` falls back to the request's `x-forwarded-host`/`host` header (sitemaps still resolve), but `metadataBase` falls back to `http://localhost:3000` — wrong canonicals in production. Set it. |
| Value on Vercel | Now (free subdomain): `https://gksetu.vercel.app`. Once `gksetu.com` is attached as the custom domain: `https://gksetu.com`. Update it whenever the domain changes — the value must always be the URL visitors actually use. |

### 1.3 `NODE_ENV` — automatic, never add manually

Vercel sets `NODE_ENV=production` for Production deployments (and
`development` for local). It drives the security-header split in
`next.config.ts`: production serves the full set (CSP without `unsafe-eval`,
HSTS, `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`); development
serves the preview-safe variant. **Do not define it yourself** — Vercel
injects it.

### 1.4 What you do NOT need (and why)

- **`DATABASE_URL`** — the app deliberately does not read this name. Some
  platforms inject a stale `DATABASE_URL`; that is exactly why the dedicated
  `GKSETU_DATABASE_URL` name exists (P1-S1 decision, documented in
  `prisma/schema.prisma`). If Vercel or another integration happens to create
  a `DATABASE_URL`, it is inert — safe to delete, safe to ignore.
- **Any Supabase SDK variable** — see §2. This codebase contains no
  supabase-js usage at all: authentication is the app's own token-based
  identity layer; data access is Prisma over PostgreSQL.

---

## 2. Supabase → Vercel auto-integration: what it injects, and why you still add variables manually

Connecting Supabase to Vercel (Supabase dashboard → Integrations → Vercel)
auto-creates variables like:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- sometimes a `SUPABASE_DB_URL` / direct-URL variant, depending on integration version

**None of these are read by GKSetu.** The app has no supabase-js client, no
Supabase Auth usage, no Storage usage — it is a Prisma + PostgreSQL app. So
the direct answer to "does the auto-connect make manual variables
unnecessary?" is:

> **No.** The auto-integration injects *its* standard names; the app reads
> *its own* names. You must manually add `GKSETU_DATABASE_URL` (and
> `GKSETU_PUBLIC_BASE_URL`) in the Vercel dashboard regardless of whether
> Supabase's integration is connected.

Connecting the integration is still harmless and mildly useful (it keeps the
project linked and would pre-provide the SDK variables if Supabase
Auth/Storage is ever adopted) — but it is **not sufficient** and not
required. If you skip the integration entirely and add the two variables by
hand, everything works identically.

For completeness — the full manual list, so you can add anything by hand:

| Variable | Add to Vercel? | Value |
|---|---|---|
| `GKSETU_DATABASE_URL` | **Yes (Production + Preview)** | `postgresql://postgres.kbezlaqsvvlmgllkvszn:<DB-PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` |
| `GKSETU_PUBLIC_BASE_URL` | **Yes (Production)** | `https://gksetu.vercel.app` now → `https://gksetu.com` once the custom domain is attached |
| `NODE_ENV` | No — Vercel injects it | — |
| `NEXT_PUBLIC_SUPABASE_URL` | Not used by this app | optional (integration) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Not used by this app | optional (integration) |
| `SUPABASE_SERVICE_ROLE_KEY` | Not used — keep it out entirely (least exposure) | optional |
| `DATABASE_URL` | Not used — ignore/delete if anything creates it | — |

> Keeping the Supabase **secret key / service-role key out of Vercel
> entirely** is the audit's recommendation: no code path reads them, so
> carrying them only adds exposure surface.

---

## 3. Go-live steps (verified order)

1. **Repo:** GitHub `dkzila/gksetu` `main` is the source of truth (this
   session pushed through P-SEC).
2. **Database:** already live and verified — Supabase project
   `kbezlaqsvvlmgllkvszn` (ap-south-1) carries the full current state
   (schema in sync; FR/IN ACTIVE; no `db:push` or `db:seed` needed — both
   were verified idempotent-current in the audit).
3. **Vercel:** Add New Project → Import `dkzila/gksetu` (framework
   auto-detected: Next.js). **Name the project `gksetu` at import time** —
   the free subdomain is derived from the project name, so this step makes
   it `gksetu.vercel.app` (the name can be changed later in Settings, but
   getting it right at import is the clean path).
4. **Environment variables** (before the first build): the two from §1 —
   `GKSETU_DATABASE_URL` = the pooler URL from §1.1,
   `GKSETU_PUBLIC_BASE_URL` = `https://gksetu.vercel.app` — for Production
   and Preview.
5. **Deploy.** The build is `next build && bash scripts/postbuild.sh` — the
   postbuild step detects the standard (non-standalone) output and exits 0;
   this is the P-SEC fix (the old unconditional `cp` chain would have failed
   every Vercel build).
6. **Post-deploy verification:**
   - `GET /api/health` → `database.connected: true, host: "Supabase (session pooler)"`.
     (If it fails, the response now names the cause — see §5.)
   - `GET /robots.txt` and `/sitemap.xml` (rewrites onto the seo module).
   - One knowledge page + one exam page render.
   - Response headers now show the production variant: HSTS,
     `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, CSP without
     `unsafe-eval`.
7. **Custom domain (`gksetu.com`):** when the domain is bought, add it in
   Vercel (Project → Settings → Domains → Add `gksetu.com`; follow the DNS
   instructions Vercel shows — point the domain's records at Vercel). Then
   update `GKSETU_PUBLIC_BASE_URL` to `https://gksetu.com` and redeploy.
   Both `gksetu.vercel.app` and `gksetu.com` keep serving; the env var must
   carry the one visitors are expected to use (the custom domain).

---

## 4. Launch hardening checklist (pre-real-traffic)

- **Demo accounts:** the §45 seed state includes staff accounts with
  documented passwords (e.g. `admin@gksetu.dev`). Before real public traffic:
  rotate or disable them (they exist for the demo state by design; the
  credential model is the app's own scrypt-hashed token identity).
- **Registration:** public account creation is open by design; add rate
  limits + email verification when traffic warrants (documented roadmap gap).
- **Secrets:** the DB password lives only in the Supabase dashboard /
  Vercel env — never in git (`.gitignore` covers `.env`; verified by the
  audit).

---

## 5. Troubleshooting the first deployment (DEPLOY-S1 — seen live; DEPLOY-S2 found the real cause of the intermittent form)

### 5.1 The symptom

The site loads at `gksetu.vercel.app` (header, footer, styling all fine) but
the content area shows:

> Could not load the country configuration. Refresh the page to retry.

and `GET /api/health` answers `503` with a database error. **This is always a
database-configuration problem, not a code problem** — the page shell is
static and loads regardless; the moment its JavaScript asks `/api/countries`
for data, the API needs `GKSETU_DATABASE_URL` and the call fails.

DEPLOY-S1 diagnosed the steady form (the variable never reaching the
deployment). DEPLOY-S2 then reproduced and fixed the **intermittent** form
the user hit live — India loaded once, then the France switch failed and
everything after it too: **connection-pool exhaustion** (see §5.4).

### 5.2 The checklist — in order of how often each is the cause

1. **Redeploy after changing environment variables.** Vercel variables apply
   only to deployments **created after the change** — the running deployment
   never picks them up. After adding or editing a variable:
   Project → **Deployments** → latest deployment → **⋯ → Redeploy**.
   This is the most commonly missed step.
2. **Environment scope.** The variable must exist for **Production** (that is
   the environment `gksetu.vercel.app` serves). When adding it, check
   *Production* (Preview/Development optional). A variable added only as
   Preview/Development leaves production broken.
3. **Exact name and raw value.** `GKSETU_DATABASE_URL` — no quotes around the
   value (Vercel stores it literally), no `[YOUR-PASSWORD]` placeholder from
   the Supabase dashboard left in.
4. **The right host.** Use the **session pooler**:
   `postgresql://postgres.kbezlaqsvvlmgllkvszn:<DB-PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   — not the direct host `db.kbezlaqsvvlmgllkvszn.supabase.co` (IPv6-only;
   serverless connects over IPv4) and not port `6543` (transaction mode;
   the app needs session mode for advisory locks).
5. **Verify:** open `https://gksetu.vercel.app/api/health` — the expected
   response has `"status": "ok"` and
   `"database": { "connected": true, "host": "Supabase (session pooler)" }`.

### 5.3 What the health endpoint says when it fails

Since DEPLOY-S1, `/api/health` names the cause; DEPLOY-S2 added the
auth/exhaustion split (deployments built before each change show the older,
less specific messages — redeploy to get the current diagnostics):

| `error.code` / `details.hint` | Meaning | Fix |
|---|---|---|
| `DATABASE_NOT_CONFIGURED` / `missing-env-var` | The variable never reached this deployment — missing, empty, wrong scope, or no redeploy since adding it | Add for Production, redeploy (§5.2 steps 1–2) |
| `DATABASE_MISCONFIGURED` / `quoted-value` | Value wrapped in quotes | Re-paste without quotes, redeploy |
| `DATABASE_MISCONFIGURED` / `password-placeholder` | `[YOUR-PASSWORD]` still in the string | Replace with the real password, redeploy |
| `DATABASE_MISCONFIGURED` / `unparseable-url` | Not a valid connection string | Re-copy from §1.1 |
| `DATABASE_MISCONFIGURED` / `supabase-direct-ipv6` | Direct host `db.<ref>.supabase.co` — IPv6-only | Switch to the session pooler URL (§1.1) |
| `DATABASE_MISCONFIGURED` / `supabase-transaction-pooler` | Port 6543 (transaction mode) | Switch to port 5432 (session mode) |
| `DATABASE_AUTH_FAILED` / `auth-failed` | The database rejected the credentials (wrong password, or username not in the `postgres.<project-ref>` pooler form) | Fix the value per §1.1, redeploy |
| `DATABASE_POOL_EXHAUSTED` / `pool-exhausted` | The database refused NEW connections — the free-tier 60-connection ceiling was hit (see §5.4) | Redeploy from the latest main (region + pool caps); check for idle dev servers holding slots |
| `DATABASE_UNREACHABLE` / `supabase-pooler-unreachable` | URL shape is right, connection still failed — Supabase project paused (free tier pauses after ~1 week idle) or the network path is blocked | Restore the project from the Supabase dashboard |
| `DATABASE_UNREACHABLE` / `connection-failed` | Other host, connection failed | Verify host/port/password |

The connection string itself is never echoed in any response — only the
matched pattern (the hint) and the fix.

### 5.4 The intermittent form: connection-pool exhaustion (DEPLOY-S2 — reproduced live)

**What was observed:** the user's first deployment served India once, then
the France switch failed and India failed after it. A burst test of 12
parallel `/api/home` calls against the live deployment returned **9 × 500**.

**The arithmetic:** the Supabase free tier caps the database at
**60 connections** (`SHOW max_connections`, verified live) — but the wall
that actually triggers is far lower: **the session pooler allows only 15
client connections per project** (`FATAL: (EMAXCONNSESSION) max clients
reached in session mode - max clients are limited to pool_size: 15` —
captured live when the sandbox itself was refused). On Vercel,
EVERY API route runs as its own serverless function, each with its own
Prisma client pool (default: CPUs × 2 + 1 ≈ 3 connections). The deployment
was also running in the default **US region (iad1)** against a **Mumbai**
database — ~200ms per query — so a single `/api/home` held its connections
for ~9 seconds. One market switch = 5–6 concurrent functions × 3 connections
× 9s hold ≈ the ceiling. New connections get refused until idle ones time
out — which is why everything recovered by itself later.

**The fixes (all in the repo — a redeploy from the latest `main` applies them):**

1. **Function region → Mumbai (`bom1`)** via `vercel.json` → `regions` — next
   to the database; queries drop from ~200ms to ~2–5ms and connections are
   held for milliseconds instead of seconds. (Manual path if ever needed:
   Vercel → Project → Settings → Functions → Region → Mumbai.) Verify after
   deploy: `curl -sI https://gksetu.vercel.app/api/health | grep -i x-vercel-id`
   → should contain `bom1` (not `iad1`).
2. **The TRANSACTION pooler at runtime** (`src/lib/db-url.ts`) — the adapter
   rewrites Supabase pooler URLs to port 6543 with `pgbouncer=true`, which
   multiplexes ~200 clients over the same 15 server connections: the wall
   stops existing for serverless. The session-mode dependency was audited
   before switching: the platform's only advisory lock is
   `pg_advisory_xact_lock` INSIDE a Prisma transaction (transaction-scoped;
   transaction pooling pins one server connection per transaction, so the
   lock's atomicity holds — verified live through 6543), and the search
   engine's readiness DDL is single-statement `CREATE INDEX IF NOT EXISTS`
   (no CONCURRENTLY). The Prisma CLI keeps the session URL (schema work
   never goes through the adapter).
3. **Per-function pool cap** in `src/lib/db.ts` — on Vercel each Prisma
   client is capped at `connection_limit=2` with `pool_timeout=30`: burst
   traffic queues instead of multiplying connections.
4. **Health diagnostics** name the exhaustion (`DATABASE_POOL_EXHAUSTED` —
   the Supavisor `max clients`/`pool_size` message is matched) instead of
   the misleading generic "verify the password".

If exhaustion ever recurs after these fixes, look for long-lived clients
holding idle slots (a local `next dev` server pointed at the same Supabase
project holds up to 5) — restart them.
