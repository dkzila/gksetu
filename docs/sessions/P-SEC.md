# Session Report — P-SEC: production security audit + Vercel readiness

**Status:** ✅ Complete
**Type:** Security/launch-readiness session (the direct user request after PROD-S1; no Master Plan feature stage — the §43 session counter does not advance)

## Context

The user asked (translated): audit the site's security, confirm everything is
correct, fix any problems/errors/bugs found — then document exactly what is
needed to go live on Vercel (environment variables), including whether the
Supabase→Vercel auto-integration makes manual variables unnecessary, and a
complete list so variables can be added manually if wanted.

An earlier P-SEC window (the unpushed UUID-titled commit) had already landed
the next.config.ts security-header split, audit screenshots and the
self-healing dev-daemon before the session was cut. This session completed the
audit, fixed the one real bug found, and wrote the deployment documentation.

## 1. GitHub + Supabase verification (the precondition)

- **GitHub:** remote `github` (dkzila/globiq, public) verified with the
  re-supplied token; `github/main` at `fd7b58e` (PROD-S1) — the local `main`
  was exactly **1 commit ahead** (the earlier P-SEC window). No lost work;
  the P8-S2→P9-S3 recovery promised by the P9-S3-followup session is fully
  landed (57 commits at audit time).
- **Supabase** (project `kbezlaqsvvlmgllkvszn`, ap-south-1): direct `db.*:5432`
  is IPv6-only (the documented expectation from this IPv4 sandbox); the IPv4
  session pooler is open. Verified live via REST + `prisma migrate diff`:
  schema **in sync** (the only diff — 4 SearchDocument indexes — is the search
  engine's raw-SQL readiness step, by design outside schema.prisma). Cloud
  data verified at the FULL current repo state: **FR ACTIVE**
  (launchedAt 2026-09-30T17:13:08 — the P9-S5 launch landed on the cloud),
  IN ACTIVE, GB COMING_SOON, AE INACTIVE; 48 search documents, 13 QnA,
  73 users. The P9-S4→P10 sessions ran live on the pooler; only the final
  P-SEC window had fallen back to local PostgreSQL after a sandbox reset.
- `.env` restored to the Supabase session pooler; dev server restarted via
  the self-healing daemon; `/api/health` → `database.connected: true,
  host: "Supabase"` verified live.

## 2. The audit — every check, with its live evidence

| # | Check | Result |
|---|---|---|
| 1 | Security headers (dev variant) | ✅ Live `curl -D`: CSP (default-src 'self' closure, no exfil channel), X-Content-Type-Options, Referrer-Policy, Permissions-Policy; `X-Powered-By` absent. The production variant (HSTS + X-Frame-Options + frame-ancestors 'self', no unsafe-eval) activates on Vercel where `NODE_ENV=production`. |
| 2 | Secrets in git | ✅ `git grep` across all tracked files: zero occurrences of the DB password, service-role key, `sb_secret_`, or the GitHub token. `.env` is gitignored (only `.env.example` is tracked); `.env.example` carries placeholders only. |
| 3 | Server-only code in the client bundle | ✅ All 49 script bundles actually served to the browser (fetched from the running app) scanned: no Prisma, no DB connection strings, no z-ai SDK, no scrypt/createHash. (The P9-S1/P9-S3 SDK-leak class stays fixed.) |
| 4 | API auth guards | ✅ Live matrix tested: signed-out → **401** on /api/analytics/insights, /api/audit, /api/seo/market-ops, POST /api/countries/FR/launch, /api/editorial/tasks, /api/translations. Fresh READER (public register → 201) → **403** with the permission-scoped message ("requires analytics:read"). ADMIN login → **200**. |
| 5 | ESLint + TypeScript | ✅ `bun run lint` and `bun run type-check` both clean. |
| 6 | dev.log runtime errors | ✅ Clean — all routes 200; the 401/403 lines are this session's own guard tests. |
| 7 | Browser E2E (agent-browser) | ✅ Zero page errors, zero app console errors. Homepage renders the PROD-S1 learner-first shell with live Supabase data; hero search → inline results → in-app knowledge page (`#/gk/fundamental-rights/right-to-constitutional-remedies-article-32/`); #/signin + a real sign-in flow (login 200 → token persisted → signed-in header bell → dashboard with honest empty states); footer = the quiet Staff-console link only, © GlobIQ, no engineering vocabulary; 390px mobile and 1440px desktop both `scrollWidth == clientWidth` (no overflow); sticky-bottom footer structurally guaranteed (`min-h-screen flex-col` root + `flex-1` content + `mt-auto` footer) and verified both ways (short-page stick + long-page natural push). |
| 8 | Public registration spam surface | ✅ POST /api/auth/register is open by design (the product's account creation); rate limits and email verification are the documented pre-launch gaps on the roadmap, noted below. |

## 3. Bugs found and fixed (1)

**The Vercel-blocking build script.** `package.json`'s `build` chained
`next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`
unconditionally — but `.next/standalone` only exists when
`output: "standalone"` is set, which next.config.ts deliberately does NOT set
("Vercel manages builds itself", the P1-S1 decision). Every Vercel build would
have died at the first `cp`. Fixed with `scripts/postbuild.sh`: assembles the
standalone tree ONLY when `.next/standalone` exists (the documented sandbox
recovery path), otherwise exits 0 (the Vercel path). `build` is now
`next build && bash scripts/postbuild.sh`. Verified both ways.

## 4. Deliberate, documented risks (accepted — recorded honestly)

- **Demo accounts** (§45): the seed creates staff accounts with documented
  passwords (admin@globiq.dev etc.). This is the demo state by design; the
  launch hardening step (rotate/disable before real public traffic) is in
  `docs/vercel-deployment.md`.
- **`unsafe-inline` on script/style in CSP**: the pragmatic Next.js form
  (no nonce infrastructure at this scale); the win is the `default-src 'self'`
  / `connect-src 'self'` closure.
- **Supabase latency** (~240–400ms/round-trip) is the known P10-S1 baseline,
  not a defect.

## 5. Deliverables

- This report; `docs/vercel-deployment.md` (the complete environment-variable
  documentation + the Supabase→Vercel auto-integration answer + the go-live
  steps); `scripts/postbuild.sh`; `package.json` build fix; the earlier
  window's next.config.ts headers and dev-daemon; the audit screenshot
  (`docs/screenshots/p-sec-audit-desktop.png`); `.env` restored to the
  pooler (gitignored); `worklog.md` recreated.

## Next

Vercel go-live per `docs/vercel-deployment.md`; then the roadmap continues
from the §43 handoffs.
