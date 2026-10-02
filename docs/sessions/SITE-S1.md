# SITE-S1 — Navigation, URL grammar & the marquee pages

**Date:** 2025-10-02 · **Plan:** docs/site-overhaul-plan.md (§1, §2, §3, §7 session table)
**Status:** COMPLETE — committed `ac24b71`, pushed to `dkzila/gksetu`.

## Scope delivered (user's tasks 1, 3, 4, 5, 6-URL/SEO, 8-URL)

1. **URL grammar v2** (app-router + server builders + sitemap + search):
   - Subjects at the root: `/{subject}/`, `/{subject}/{unit}/`, `/{subject}/mock-tests/{slug}/`
     (legacy `/gk/…` keeps parsing — tolerant, never built).
   - `/current-affairs/` — dedicated listing view (was the `/gk/current-affairs/` topic hub).
   - `/mock-test/` — renamed from `/quick-mock` from the base (no redirects), with optional
     `/mock-test/{exam}/` deep link.
   - New surfaces: `/subjects/`, `/mcq/`, `/qna/`.
   - Server path builders migrated: composition-helpers, search query-service (query-time —
     no reindex needed), topic-landing pathFor, share/notification/feedback/mastery/save/
     personalisation/mapping services.
   - Sitemap: listing surfaces added to the `home` segment set; topic/unit paths v2.
2. **One-navigation shell**:
   - Header: brand + country/language switchers + notifications/account. The four duplicated
     nav items removed; hamburger at `<lg` (the 640–1023px dead zone is gone — tablets now
     get the drawer with the full nav + market switchers).
   - Sidebar Discover: Home, Current Affairs, Exams, Subjects, Mock Tests, MCQ Practice,
     Q&A — all real paths (no callback indirection, no `#home-exams` scroll hack).
     Library/Account hrefs cleaned to paths.
   - Footer Explore mirrors Discover.
3. **Home quick wins**: stat-counting pills removed (with their row); "Live in {Country}"
   badge removed for ACTIVE markets (kept "Launching soon…" for COMING_SOON);
   Current Affairs "View all" → `/current-affairs/`.
4. **The marquee pages** (three parallel page agents + main integration):
   - `/current-affairs/` — public events listing API (`GET /api/current-affairs`, topic chips,
     pagination, §35-honest summaries) + compact hero view (inline share+follow, tight
     breadcrumb, scrollable chips, clean cards) — SITE-S1-A.
   - `/subjects/` — directory API (batched exam counts over the 136-exam corpus, §35 label
     chain) + searchable grid view — SITE-S1-B.
   - `/mock-test/` — public landing (hero with live stats, published-test directory via
     existing public API, exam chips) + the personalised quick-mock flow intact below;
     sign-in ask demoted to a compact card inside that section — SITE-S1-C.
5. **SEO**: subject title template `{Subject} GK — Notes, Q&A & Mock Tests | GKSetu`;
   exams directory indexable with a keyword-bearing title; mock-test/CA/subjects/mcq/qna
   titles set (mock-test stays noindex until its public sections prove out).

## Critical fix found in QA (production bug since the India corpus)

`resolveExamRelevance` (event page + feed) ran **2 queries × every ACTIVE exam** — 272
queries over the 136-exam corpus — starving the 3-connection dev pool (P2024) and 500ing
every event page. Batched to 3 queries (exams+versions, all nodes, all mappings grouped
in-memory); also dropped the heavy `_count` join. Also terminated stale Supabase pooler
connections (one 6.5-day-old socket) that were squeezing the 15-client session ceiling.

## Verification

- tsc + eslint clean; dev server stable.
- Browser E2E: homepage (no Live badge, no stat pills, 2 language chips), /current-affairs/
  (hero, 4 honest events, topic chips, pagination), /subjects/ (search + cards + counts),
  /mock-test/ (public sections + signed-in flow), /mcq/, /qna/, /exams/ (indexable title),
  /polity-governance/ + /gk/polity-governance/ (same page, v2 + legacy), /hi/current-affairs/,
  event page end-to-end after the N+1 fix.
- Responsive: 768px (hamburger + drawer with 7 Discover items + Market block; no dead zone),
  390px (CA hero 182px, no horizontal overflow), 1440px (clean header, sidebar rail).
- SPA navigation + browser titles verified on every surface; zero console/page errors after
  the post-compile settles.

## Carried forward

- SITE-S2: 20-subject corpus + 8 PLANNED languages (contentStatus migration) + homepage
  UI translation (10 languages, EN keywords preserved).
- SITE-S3: MCQ/QNA public APIs + practice UI + seeded question banks (the /mcq/ + /qna/
  shells and nav are live with honest states).
- SITE-S4: user-page redesign (Dashboard/Saved/Following/Notifications/Profile/Settings/
  Feedback), /exams/ + subject-page hero polish, responsive sweep.
- /mock-test/ noindex flip when the public sections prove out (Vercel check).
