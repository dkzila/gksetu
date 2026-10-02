# SITE-S9 — Combined tutorials + the Tutorials console + polish

**Date:** 2026-10-02 · **Plan:** docs/learning-platform-plan.md §SITE-S9 · **Status:** COMPLETE — the learning-platform wave closes.

## Delivered

### 1. `/tutorials/combined/?exams=a,b` — one study plan across exams
- The §11 union engine's semantics under the tutorials module's stricter §14 gate (topic-visible included — counts can never disagree with the exam tutorial pages): union of the selected exams' mapped VERIFIED market-visible units, **grouped by canonical subject**, shared lessons rendered once with **per-exam depth chips** ("Core for UPSC Civil Services Examination" / "Supporting for SSC CGL", chapter titles in the tooltip).
- Addressable state: `?exams=` read on mount + popstate, written via `history.replaceState`; removable-chip picker (Popover + search, max 8 — the §11 cap, typed 400 beyond); honest empty-picker surface (fully rendered, indexable, no fetch); unknown refs skipped with an honest note; "no current version" exams ride the DTO's `note` slot.
- Per subject group: lesson rows (knowledge-page links) + a collapsible **Practice this subject** block (the shared InlinePractice — one-tap reveal, provenance badges = the PYQ subset, no duplicated list); §35 whole-payload language swap; signed-in **per-exam progress strip** (parallel fail-silent reads of the existing progress endpoint).
- Router: `/tutorials/combined/` rides `examSlug === 'combined'` (no AppRoute interface change; buildPath needed none); `'combined'` is now a create-time reserved exam slug. Sitemap: zero combined URLs (query-state surface — the 1,137 tutorials URLs unchanged).

### 2. The Tutorials console cockpit — `/console/tutorials`
- Read-only dashboard riding `exam:manage`: 5 stat cards (136 exams · 1,001 chapters · 738 lessons · 55% avg coverage · learner completions), searchable paginated table (coverage bars emerald/amber/rose), and the per-exam **Gaps dialog**: chapters without lessons → *Open mapping manager* (`/console/exams/{id}`), without practice → *Add questions*, without PYQs → *Record provenance* — one-click deep-links into the EXISTING editors, nothing edited here. Gap lists cap at 25 (honest note); console counts verified identical to the public index (136/136 parity) and the detail's gaps equal the public TOC's empty chapters.
- `GET /api/tutorials/admin` (+`?exam=`) — requirePermission, 60s-cached, overview in 2 batched queries + 3 content groupBys + 2 progress groupBys (distinct learners via examId×userId reduction).

### 3. Polish sweep
- **Topic-landing PYQ aggregate**: amber "N previous-year questions" pill + the "Asked in real sittings: UPSC Civil Services Examination (2018–2021) · SSC CGL (2019–2022)" line, each exam linking into its `/pyq/{exam}/` page (reader-language count with the documented English-count fallback).
- **Cross-links**: exam page ↔ tutorial ("Tutorial" button in the exam hero · "Exam details" in the TOC hero), subjects → "Exam-wise tutorials" (market-scoped).
- Chapter reader + index + TOC regressions green.

## Verified
tsc (app+scripts) + eslint clean · API E2E (combined union/dedup/cap/fallback/unknown-refs, admin guard→overview→detail, topic aggregate) · parse-route harness 18/18 (incl. the reserved `combined` segment, `/hi/tutorials/combined/`, buildPath round-trips) · browser E2E at 1440/768/390 — one real bug caught and fixed: the combined view's progress grid stretched an implicit auto track to 424px at 390px → `grid-cols-1` (minmax(0,1fr)); zero overflow, zero console errors across all surfaces; sitemap 1,137 tutorials URLs with zero combined entries.

## Environment notes (for future sessions)
- The sandbox was RESET before this session: `.env` restored to Supabase, local main fast-forwarded to `a1ef0a9`, worklog.md recreated.
- The dev server was OOM-killed twice on the 4GB box (heavy sitemap census + agent-browser chrome) and once served STALE builds after a restart — if API output doesn't match edited source, clean-restart with `.next/cache` removed before debugging the code.
