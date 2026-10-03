# SITE-S10 — The unbroken tutorial reading flow

**Date:** 2026-10-03 · **Plan:** docs/learning-flow-plan.md SITE-S10 · **Status:** COMPLETE — problems 1 + 2 of the user's five closed.

## Delivered

### S10-A · Inline lessons — the AJAX-expand pattern (the user's exact model)

- **Root cause fixed:** lesson cards were whole-card `<a>` navigations to the §16 knowledge page — Back landed on the topic hub and the tutorial reading flow was destroyed (user-reported on `/tutorials/afcat/general-awareness-history-geography-polity/`).
- **`InlineLessonCard`** (`src/components/tutorials/inline-lesson-card.tsx`): "Read the lesson" is now a **toggle button** that fetches `GET /api/knowledge/page/{unitSlug}` (the EXISTING public endpoint — zero new API surface) and expands the lesson **in place**: quick fact (emerald layer) + every representation (format badge, title, `Rev N · date` meta, body) + the honest "Sources, practice questions and translations live on the full page" pointer with an explicit **Open the full page →** link.
  - The title stays a link (SEO + no-JS fallback); an explicit "Full page ↗" affordance sits beside the toggle.
  - Payloads cache in a **module-level capped Map** (24 entries, insertion-order eviction) shared by the chapter reader AND the combined view — re-expanding the same unit anywhere is instant (verified: Ashoka expanded in the chapter reader, then instantly in the combined view).
  - States: skeletons while loading, inline retry on error (never a toast wall), `aria-expanded`/`aria-controls`, chevron rotation, `AnimatePresence` height animation (the QnaCard pattern), `scrollIntoView(block:'nearest')` on open, 44px touch targets.
- **Shared renderer extraction** (`src/components/reader/representation-body.tsx`): the §23 format-aware body renderers (prose / timeline / comparison / profile / revision-note / current-event-update), `FORMAT_META` + fallback, `formatDate` and the representation API mirrors moved out of `knowledge-page-view.tsx` — the knowledge page and the inline lesson render through **ONE** `RepresentationBody` (verified: the knowledge page renders identically after the extraction; TIMELINE renders in the inline card).
- **Chapter reader** (`chapter-reader.tsx`): the lessons block switched from a 2-col grid of link-cards to a single-column list of `InlineLessonCard`s (the w3schools reading layout — full width when expanded).
- **Combined view** (`combined-view.tsx`): the united lesson rows adopt the same card via slots — `titleExtra` (Shared badge), `chipsExtra` (per-exam depth chips), `metaExtra` (practice/PYQ counts); `SubjectGroupSection` now receives the route's country/language.

### S10-B · Combined tutorials discoverability (3 entry points)

The combined plan was live since S9 but had ZERO entry points (the user's "ऐसा कुछ नहीं है"):
1. `/tutorials/` **"Your exams"** section — with ≥2 goal exams, a "One combined study plan" CTA card links to `/tutorials/combined/?exams={their slugs}` (capped at 8, the §11 cap rides the page's own guard).
2. `/tutorials/` **"All exams"** header — the permanent, anonymous-friendly "Combine exams into one plan" link (opens the picker's honest empty surface).
3. **Per-exam TOC hero** — "Combine exams" outline button → `/tutorials/combined/?exams={exam}` prefilled with this one exam.

All links are market-scoped via the payload's server canonical (`/hi/tutorials/combined/…` stays in-market). No router/sitemap changes (query-state surface — the S9 decision holds; the 1,137 tutorials URLs are untouched).

## Verified

tsc (app + scripts) + eslint clean · API E2E: the AFCAT chapter payload (the user's exact chapter — both reported lessons), the knowledge-page payload for both units (REVISION_NOTE + TIMELINE formats) · browser E2E at 1440 + 390:
- Chapter: expand in place (URL unchanged — the flow never breaks), collapse, instant cached re-expand, TIMELINE body via the shared renderer, practice reveal regression (your answer + correct answer markers), zero console errors.
- Index anonymous: the permanent combined link; signed-in (fresh test account, goal = AFCAT + SSC CGL): "Your exams" cards + the combined CTA landing on `/tutorials/combined/?exams=afcat,ssc-cgl` with subject groups and inline lessons.
- TOC hero CTA → `?exams=afcat` prefilled; combined-view lesson expands instantly from the cross-surface cache.
- 390px: scrollWidth == clientWidth == 390 (zero overflow), inline expansion + full body render on mobile.
- Knowledge page regression after the extraction: identical rendering (quick fact + revision note + report buttons).

## Environment notes (for future sessions)

- The sandbox `.env` had been reset to the template (`DATABASE_URL=file:…` only) — `GKSETU_DATABASE_URL` (Supabase) + `GKSETU_PUBLIC_BASE_URL` were re-appended and the dev daemon restarted before E2E. If API 500s with "You must provide a nonempty URL", check `.env` first.
- Test account `s10-flow-test@gksetu.test` (password `TestFlow123!`, home IN/en, goal: AFCAT + SSC CGL, BEGINNER) exists for future flow tests; it carries no editorial state.
