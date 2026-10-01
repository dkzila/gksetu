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

## 6. Honest state at session close

The Vercel deployment still runs the pre-DEPLOY-S2 build at session close —
the fixes go live with the next deploy from `main` (automatic on push). The
burst failure (9/12 × 500) is proven on the OLD build; the region + pool-cap
fixes are verified in code and locally, but their effect on Vercel can only
be confirmed after the user's next deployment (the verification steps are in
§4 above).
