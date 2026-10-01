# DEPLOY-S2 — The intermittent 503s (pool exhaustion) + clean URLs (the '#' removed)

**Date:** 2026-10-01 · **Stage:** deployment support 2 · **Trigger:** the user reported (1) India loaded once after deploy, then the France switch failed and India after it — `/api/health` showing `DATABASE_UNREACHABLE / supabase-pooler-unreachable` ("verify the password"); (2) the `#` in URLs (`/#/fr/`) is unwanted — remove it everywhere.

## 1. The database problem — root cause found by live measurement

The health message was misleading (the user re-sent all Supabase credentials
believing the password was wrong). The evidence trail:

- **The password was never wrong:** the same URL + password worked from the
  sandbox all along; and Vercel itself served India content once — proof the
  variable in Vercel is correct.
- **`SHOW max_connections` → 60** (Supabase free tier; queried live through
  the pooler, with ~15 idle Supavisor server connections parked).
- **`x-vercel-id: hkg1::iad1::…`** — the Vercel functions run in the default
  **US region (iad1)**, ~200ms RTT from the Mumbai database. A single
  `/api/home` took **8.7s** (measured live).
- **Reproduced:** a burst of 12 parallel `/api/home?country=FR` calls against
  the live deployment → **9 of 12 returned HTTP 500**. The failure mode is
  capacity, not credentials: every API route is its own serverless function,
  each with its own Prisma pool (~3 connections), each holding them ~9s
  (the US↔Mumbai latency) — one market switch (5–6 concurrent calls)
  exhausted the 60-connection ceiling; new connections were refused until
  idle ones reaped — matching "recovered by itself later".

### The fixes (in the repo — a redeploy applies them)

1. **`vercel.json` → `"regions": ["bom1"]`** — functions in Mumbai, next to
   the database: queries ~2–5ms instead of ~200ms; connections held for
   milliseconds. Verify after deploy via the `x-vercel-id` response header.
2. **`src/lib/db.ts`** — on Vercel (`VERCEL` env), each Prisma client's pool
   is capped: `connection_limit=2&pool_timeout=30&connect_timeout=15`
   appended to the datasource URL (never in the env var itself). Bursts
   queue at the client instead of exhausting the shared database.
3. **`database-diagnostics.ts`** now classifies the CAUGHT ERROR, not just
   the URL shape: `DATABASE_AUTH_FAILED/auth-failed` (Prisma P1000 /
   "Authentication failed"), `DATABASE_POOL_EXHAUSTED/pool-exhausted`
   ("too many clients…", P2024), alongside the DEPLOY-S1 shape codes. The
   health endpoint passes the error through — the next failure says what
   actually happened.

## 2. Clean URLs — the '#' removed (the user's direct request)

The §16 URL space moved from after-the-hash to real paths, same grammar:
`/` (IN/en), `/fr/`, `/hi/`, `/gk/{topic}/{unit}/`,
`/current-affairs/{slug}/`, `/exams/{exam}/…`, `/signin`, `/console`,
`/dashboard`, `/collections/{id}/` ….

- **`src/components/home/app-router.ts`** (new) replaces `hash-router.ts`:
  `parseRoute`/`buildPath`/`navigateRoute`/`navigateToPath`/`useAppRoute` —
  History-API navigation (pushState + a synthetic popstate; back/forward on
  real popstate). **Legacy `#/…` URLs keep working**: `currentAppPath()`
  prefers the hash when a legacy hash-route is present, and `useAppRoute`
  upgrades the address bar via replaceState (verified: `/#/fr/` → `/fr/`
  with FR content, no reload).
- **`src/app/[[...slug]]/page.tsx`** (git-mv from `page.tsx`) — the optional
  catch-all serves the shell for every path; API routes and public files
  keep precedence.
- **`src/components/home/app-router-links.ts`** (new) — ONE root click
  interceptor routes every plain `<a href="/…">` (sidebar, footer,
  dashboard, profile) through the router: SPA navigation without a reload;
  modified clicks / new tabs / downloads / `/api/*` keep browser defaults.
- **`next.config.ts`** — `trailingSlash: true` + `skipTrailingSlashRedirect:
  true`: §16-shaped URLs (with trailing slash) serve directly AND the
  slash-less forms too — zero 308s anywhere, so every `fetch('/api/…')`
  stays single-hop (the redirect variant measured: /api would have 308'd).
  `robots.txt`/`sitemap.xml` rewrites moved to **beforeFiles** (an
  afterFiles rewrite would never run — the catch-all page matches first).
- **Sweep:** every `href="#/…"` → `href="/…"` (sidebar, footer, header-auth,
  dashboard/profile/controls/teaser, notifications); programmatic nav
  (`window.location.hash = …`, `location.assign('#/…')`) → `navigateToPath`
  in follow-button, save-button, dashboard-teaser, notifications-view
  (legacy `appPath` values from old DB rows still parse — the leading '#'
  is stripped), saved-view (server canonicalPath used as-is), sign-in-view,
  and the app shell's beacons (`currentAppPath()`); ShareButton callers and
  ShareDialog now build **clean share URLs** (`origin + /gk/…/`) — real
  deep links; the notifications service emits `appPath: '/console'`,
  `'/dashboard'` for new rows.

## 3. Verification

- Server: `/`, `/fr/`, `/fr`, `/signin`, `/console`, deep `/gk/…/` — all
  200, **no redirects**; `/api/health`, `/api/countries` — 200 direct;
  `/robots.txt`, `/sitemap.xml` — 200 via beforeFiles rewrite; `/og.png`
  200; sitemap URLs contain no '#'.
- Browser (agent-browser): homepage on live Supabase data; **country
  switcher → France → URL `/fr/` + FR content** (the user's exact failure
  scenario, now clean); browser back → India home; sidebar Dashboard link →
  SPA nav to `/dashboard` (no reload); legacy `/#/fr/` → address bar
  upgraded to `/fr/` + FR content; deep link `/gk/fundamental-rights/…/`
  renders the knowledge page; `#/signin`-equivalent `/signin` + real
  sign-in (admin@gksetu.dev → `/dashboard`, `gksetu-auth` token persisted);
  footer Staff console → `/console` ("Foundation console | GKSetu"); mobile
  390px scrollWidth == clientWidth; `window.location.hash` empty; **zero
  page/console errors throughout**; dev.log all 200s.
- `tsc` + `eslint` clean. Screenshots: `docs/screenshots/deploy-s2-*.png`.

## 4. The operator's part

Push to `main` auto-deploys (the Vercel project is GitHub-connected). After
the deploy finishes, verify: `https://gksetu.vercel.app/api/health` → ok,
and `curl -sI …/api/health | grep -i x-vercel-id` → `bom1`. If the region
ever shows `iad1`, set it manually once: Vercel → Project → Settings →
Functions → Region → Mumbai. Environment variables need NO changes
(`GKSETU_DATABASE_URL` stays exactly as documented in §1.1).

## 5. Files

New: `src/components/home/app-router.ts`, `src/components/home/app-router-links.ts`,
`vercel.json`, `docs/sessions/DEPLOY-S2.md` (this file).
Renamed: `src/app/page.tsx` → `src/app/[[...slug]]/page.tsx`.
Deleted: `src/components/home/hash-router.ts`.
Modified: `src/lib/db.ts`, `src/lib/api/database-diagnostics.ts`,
`src/app/api/health/route.ts`, `next.config.ts`, the component sweep
(site-header, site-footer, app-sidebar, exam-view, event-view, unit-view,
topic-landing-view, knowledge-page-view (unchanged — canonicalPath already
clean), practice-layer, header-auth, sign-in-view, dashboard-view,
dashboard-teaser, profile-view, controls-view, notifications-view,
follow-button, save-button, saved-view, collection-share-control,
share-button, share-dialog), `src/modules/notifications/notification-service.ts`
(+ types comment), `docs/vercel-deployment.md` (§5.3 table + §5.4).


## 7. Addendum — the burst re-test on the bom1 build found the REAL wall: the 15-client session pool (same session, same day)

After the first DEPLOY-S2 push went live (verified: `x-vercel-id` → `bom1`,
`/fr/` → 200, `/api/home` 8.7s → 0.68s), the burst re-test still returned
2×500 out of 12 — and minutes later even `/api/health` went 503 with the
sandbox ITSELF refused at connect time:

```
FATAL: (EMAXCONNSESSION) max clients reached in session mode
       - max clients are limited to pool_size: 15
```

**The real ceiling is not the database's 60 connections — it is Supavisor's
per-project SESSION-mode client limit of 15.** Warm serverless instances
(each holding their pool) plus the sandbox dev server's idle pool had filled
all 15 slots.

**The structural fix (this addendum's commit): the runtime now connects
through the TRANSACTION pooler.** `src/lib/db-url.ts` (new) rewrites any
`*.pooler.supabase.com` URL to port 6543 with `pgbouncer=true` (+ per-function
`connection_limit=2` on Vercel); `src/lib/db.ts` connects through the adapter.
Transaction mode multiplexes ~200 clients over the same 15 server
connections — the wall stops existing for serverless.

**The session-mode dependency was audited before switching (and verified
live through 6543):** the platform's ONLY advisory lock is
`pg_advisory_xact_lock` inside `db.$transaction` (notification-service) —
transaction-scoped, and transaction pooling pins one server connection per
transaction, so the check-then-create atomicity holds (tested live: the
exact call through 6543 + pgbouncer). The search engine's readiness DDL is
single-statement `CREATE INDEX IF NOT EXISTS` (no CONCURRENTLY — safe;
idempotent no-ops on the live DB). No LISTEN/NOTIFY, no session SQL state.
The Prisma CLI (db:push/migrate) reads the env var directly — schema work
keeps the session URL, untouched by the adapter.

Also: `DATABASE_POOL_EXHAUSTED` now matches the Supavisor message
(`max clients` / `pool_size` / `EMAXCONN`), the "transaction pooler =
misconfigured" branch was removed (6543 is now the app's own runtime
choice), and `/api/health` reports the RUNTIME host
("Supabase (transaction pooler)") via the adapter.

Verified locally on transaction mode: health 200 with the new label,
`/api/home?country=FR` 200, France switch through the UI (`/fr/`, FR
content, zero console errors), a real sign-in (the advisory-lock path)
→ `/dashboard`, adapter unit cases (session→transaction, no-port, 6543
kept, existing params preserved, local Postgres untouched), lint + tsc
clean.

## 6. Honest state at session close

The first DEPLOY-S2 push went live mid-session (bom1 verified, latency
13× better, burst 9×500 → 2×500); the §7 addendum's transaction-pooler fix
addresses the remaining 15-client wall and goes live with THIS push. The
final live verification (health ok + the 12-parallel burst all-200) is the
acceptance gate recorded below; the verification steps for the operator stay
in §4.
