# SITE-S11 — Onboarding That Scales (Problems 3 + 4)

**Session:** SITE-S11 of the learning-flow wave (`docs/learning-flow-plan.md`)
**Problems closed:** #3 (onboarding step 2 loads every exam at once — the scroll-wall) · #4 (step 3 subjects are generic, detached from the chosen exams)
**Principle held:** unified systems only — both fixes ride the existing spine (the `/api/exams` list contract; the tutorials §14 gate; the single `PUT /api/goal` full-replacement save). One new read-only endpoint, zero schema changes.

---

## S11-A · Step 2 — the server-driven exam picker (UI-only)

The public `/api/exams` endpoint already supported `q` (name/code/organiser, case-insensitive contains) + `page`/`pageSize` + `total`/`totalPages`. The wizard simply never used it (`pageSize=300`, all rows rendered).

**The rewrite (`onboarding-view.tsx`):**
- **Debounced search** — 300ms after the last keystroke the committed `examSearch` changes and the page resets to 1. Searching "ssc" filters server-side (18 exams, 2 pages); "afcat" finds the one exam; "up police" finds both UP Police exams. Search even matches exam codes ("ssc" ⊂ "BPSSC").
- **10 rows per page** — the page-based contract means 138 exams today and 1,000 tomorrow render the same 10-row page.
- **Pagination footer** — `Prev` · "Page X of Y · N exams" · `Next` (`aria-live` on the counter, `h-11` touch targets, disabled states communicate ends).
- **Selected-chips row pinned above the list** — the selection (a `Set<string>` of slugs) survives searches and page changes; chips show full exam names (from `examMetaBySlug` — prefilled from the profile's goal exams + every row ever browsed) with a one-tap `Remove` button. The step-4 review renders names, never slugs.
- **Robustness** — a request-id guard drops stale responses (typing never renders an old page); inline error + "Try again"; 10-row skeletons; distinct empty states ("No exams match "xyz"" vs "No active exams in this market yet").
- Entering step 2 fresh (from step 1) resets the picker; Back-navigation from step 3 preserves it.

## S11-B · Step 3 — subjects derived from the chosen exams' syllabi

**New endpoint — `GET /api/exams/subjects?exams=a,b&country=&language=`** (`src/modules/tutorials/subjects-service.ts` + `src/app/api/exams/subjects/route.ts`, static segment beats `[ref]` — the `combined` precedent):
- Per exam: `loadExamTutorial` — the SAME loader as the tutorial pages (current §36 version → in-effect §8 mappings → VERIFIED §14-market-visible units). The derived subjects can therefore **never disagree with the lessons the learner actually sees**.
- → the mapped units' **distinct topics**, §35-labelled from the same `loadSubjectMaps` tree snapshot (now extended with `labelBySlug`).
- Response: `{ subjects: [{ slug, label, examSlugs }], exams: [{ slug, name, code }], skipped: [refs], note }` — `examSlugs` = which chosen exams' syllabi carry the subject (provenance); unknown/inactive/no-version refs are honestly `skipped`, never a 400; sorted label asc (§37); 60s `cachedPayload`; ≤ 10 refs (the goal's own cap); rate-limited on the exams-read class.

**Step 3 UI — two groups:**
- **"From your exams' syllabus"** (emerald box): every derived subject **pre-ticked**, each row carrying per-exam **code chips** (tooltip = full exam name; e.g. "ISRO Programmes `AFCAT` `SSC-CGL`"). Untick freely. A quiet amber note counts exams that contributed nothing.
  - **Rejection-respecting pre-tick**: `offeredSubjectsRef` remembers the previous offering, so going back to step 2 and returning never re-ticks a subject the user deliberately unticked — only NEW derivations are added.
- **"All subjects"** behind a "Browse all subjects" toggle — the existing taxonomy tree, collapsed by default; auto-expands when no exams are selected, nothing derived, or the derive call fails (never a dead end). Derived rows and tree rows share ONE selection state (ticking "World History" in either place ticks it in both).
- 0 selected exams → the plain tree with a quiet pointer note. Save semantics UNCHANGED — one full-replacement `PUT /api/goal`.

## The graph-safety lesson (a regression found and fixed)

The first cut imported `MAX_GOAL_EXAMS` from `@/modules/personalisation` — whose index re-exports the goal service, which imports `identity-access`, which runs `promisify(node:util scrypt)` **at module scope**. The tutorials module turned out to be reachable from the CLIENT bundle (a client view → `seo/index` → `sitemap-service` → `tutorials/index`) — so every page crashed in the browser with `TypeError: The "original" argument must be of type Function`.

**Fix:** the cap is declared in-lockstep locally (`MAX_EXAM_SUBJECT_REFS = 10`, loudly documented in `subjects-service.ts`); the API route — a server-only file, exempt from the client graph — re-checks against the personalisation constant. The lesson is documented in the file header: **tutorials imports must stay browser-evaluable** (no identity-access, no node builtins at module scope).

## Verification

- `tsc` (app) + `eslint` clean.
- Browser E2E (fresh account `s11-onboarding-test@gksetu.test`, fresh browser session, **0 console/page errors**):
  - Step 2: search "ssc" (18 → "Page 1 of 2 · 18 exams"), "afcat", "up police"; select SSC CGL (searched) + AFCAT (searched) — cross-page selection intact; chip remove → re-add; paginate to "Page 2 of 14"; footer totals live.
  - Step 3: 5 derived subjects **all pre-ticked** with correct provenance (ISRO Programmes + Mauryan Empire: both exams; Fundamental Rights: SSC-CGL only; UN + World History: AFCAT only); unticked Fundamental Rights; expanded "Browse all subjects"; added the History domain (shared state visible — World History checked in both groups).
  - Save → **`GET /api/goal` round-trip**: exams = AFCAT + SSC CGL; topics = History, ISRO Programmes, Mauryan Empire, United Nations, World History (**Fundamental Rights correctly excluded**); onboarding COMPLETED; the dashboard queue reflects the goal (units with "Because your goal includes SSC …" reasons).
  - Re-entry: "Update your learning profile"; step 2 chips prefilled with NAMES; step 3 derived group re-offered (6/25 = 5 derived + saved History).
  - **390px + 1440px**: zero horizontal overflow on every step (screenshots: `docs/sessions/assets/s11-step2-mobile.png`, `s11-step3-desktop.png`).

## Files

- `src/app/api/exams/subjects/route.ts` — NEW, the public endpoint (rate-limited, zod-validated, typed errors).
- `src/modules/tutorials/subjects-service.ts` — NEW, the derivation (§14 gate verbatim, §35 labels, §29 cache, §37 ordering, graph-safety note).
- `src/modules/tutorials/service.ts` — `loadSubjectMaps` + `labelBySlug`; `TutorialExamRef` + `code` (one construction site).
- `src/modules/tutorials/types.ts` — `DerivedSubjectRow` + `ExamSubjects` DTOs; `TutorialExamRef.code`.
- `src/modules/tutorials/index.ts` — `getExamSubjects` + the new types exported.
- `src/components/personalisation/onboarding-view.tsx` — the S11-A picker + the S11-B two-group step 3 + `DerivedSubjectRow`.
- `src/components/personalisation/types.ts` — client mirrors of the endpoint DTOs.

**Next:** SITE-S12 — the jurisdiction taxonomy (International / Central / State / District), the wave's only schema-touching session.
