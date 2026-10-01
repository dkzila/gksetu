# GKSetu on Vercel — the complete environment-variable and go-live guide

(Written by the P-SEC audit session; updated by REBRAND-S1 — the platform
rename GlobIQ → GKSetu changed the env-var names to `GKSETU_*`, the repo to
`dkzila/gksetu`, and the domain plan to `gksetu.vercel.app` (free subdomain,
now) → `gksetu.com` (custom domain, when attached). Everything here was
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
| Why the session pooler | The direct host `db.kbezlaqsvvlmgllkvszn.supabase.co:5432` is IPv6-only. The app requires **session mode** (port 5432, username `postgres.<project-ref>`) — NOT the transaction pooler (port 6543) — because the revision-digest ensure (P8-S2 follow-up) holds advisory locks that must stay on one connection. The same URL is already proven live from this build (the sandbox runs it against Supabase). |
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
   - `GET /api/health` → `database.connected: true, host: "Supabase"`.
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
