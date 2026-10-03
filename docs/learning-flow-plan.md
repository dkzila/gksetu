# The Learning-Flow Wave — Inline Tutorials, Onboarding UX, Jurisdiction

**Status:** SITE-S10 COMPLETE (deployed) — S11 + S12 planned, awaiting confirmation.
**Sessions:** SITE-S10 (tutorial flow + combined discoverability) → SITE-S11 (onboarding overhaul) → SITE-S12 (jurisdiction taxonomy).
**Governing principle (unchanged):** unified systems only — every fix rides the existing spine. No new content types, no parallel exam systems, no second practice engine.

**The five user-reported problems (this wave's inputs):**
1. **Tutorial flow break** — on `/tutorials/{exam}/{chapter}/`, lesson cards ("Read the lesson") navigate AWAY to the knowledge page `/​{topic}/{unit}/`; pressing Back lands on the topic hub, not the tutorial. The reading flow is destroyed. (User's proposed direction: load content in place, AJAX-style, with a show/hide button — never redirect.)
2. **Combined tutorials invisible** — `/tutorials/combined/?exams=a,b` IS built and live (verified on production: page 200, API ok), but there is ZERO entry point on `/tutorials/` — the user created an account, tested, and rightly concluded "ऐसा कुछ नहीं है".
3. **Onboarding step 2 loads every exam at once** (`pageSize=300`, all rows rendered) — with 1000 exams this becomes an unusable scroll-wall. Needs search + pagination (10 per page).
4. **Onboarding step 3 subjects are generic** — the full taxonomy tree loads regardless of chosen exams. Subjects should derive from the selected exams' syllabi (pre-selected, untickable, others addable).
5. **No jurisdiction taxonomy** — nothing DB-backed distinguishes International / Central Govt / State Govt / District exams, and nothing links an exam to a state. Personalisation cannot reason "user from Maharashtra → Central + International + Maharashtra + Maharashtra districts first, other states secondary."

---

## SITE-S10 — The unbroken reading flow (Problems 1 + 2)

### S10-A · Inline lessons (chapter reader + combined view)

**Root cause (verified):** `chapter-reader.tsx` L771–812 — each lesson card is one whole-card `<a href={lesson.path}>` to the §16 knowledge page. Practice / PYQ / Q&A blocks are already inline; only lessons eject the reader from the page.

**Fix — `InlineLessonCard` (new, `src/components/tutorials/inline-lesson-card.tsx`), the AJAX expand pattern the user asked for:**
- Card structure: title becomes an `<a href={path}>` (SEO + no-JS fallback unchanged — the knowledge page stays the canonical indexed surface), and "Read the lesson" becomes a **button** that expands the lesson IN PLACE:
  - First expand → `fetch('/api/knowledge/page/{unitSlug}?country={c}&language={l}')` — the EXISTING public knowledge-page endpoint; zero new API surface. Payload cached client-side in a `Map<unitSlug, payload>` (re-expand is instant; the cache lives in the reader's state).
  - Inline rendering (compact, NOT a clone of the whole page): quick fact + representation bodies (EXPLAINER / FACT_CARD / PROFILE / COMPARISON / TIMELINE / REVISION_NOTE with their parsed structured renderers) + revision meta line. Sources / translations / related units / practice stay on the full page — a subtle "Open the full page →" link at the bottom of the expanded body.
  - States: skeleton while loading, inline retry on error (never a toast wall), `aria-expanded` / `aria-controls`, chevron rotation, auto-scroll the expanded card into view on mobile.
  - Second click collapses (content stays cached — show/hide only, exactly the user's model).
- **Shared renderer extraction:** the representation body renderer (string body + `parsed` timeline/comparison/profile tables) is extracted from `reader/knowledge-page-view.tsx` into `src/components/reader/representation-body.tsx` — the knowledge page and the inline lesson render IDENTICALLY (one component, no forked rendering).
- **Reuse:** `combined-view.tsx` lesson rows adopt the same `InlineLessonCard` (they link to the same knowledge pages today).
- SEO/no change: chapter page title/meta unchanged; knowledge pages remain canonical; sitemap untouched (1,137 tutorials URLs unchanged).
- Regression guard: /mcq/, /pyq/ share nothing here (inline-practice untouched).

### S10-B · Combined tutorials discoverability (3 entry points)

1. **`/tutorials/` index — "Your exams" section:** when the signed-in learner has **≥2 goal exams**, render a "Combined study plan" CTA card (emerald outline, `Layers` icon) linking to `/tutorials/combined/?exams=a,b` prefilled with THEIR goal exam slugs — one tap from the personalised strip into the union plan.
2. **`/tutorials/` index — all-exams section header:** a permanent "Combine exams →" secondary link (anonymous-friendly; opens the combined picker empty — its honest empty surface already renders fully).
3. **Per-exam TOC page (`/tutorials/{exam}/`):** a "Combine with another exam" action in the TOC hero → `/tutorials/combined/?exams={exam}` prefilled with this one exam.

No router changes (`combined` reserved segment already wired), no sitemap changes (query-state surface stays out — the S9 decision holds).

### S10 QA
Browser E2E on production-parity local: expand/collapse a real lesson (first-load fetch + cached re-expand), combined CTAs (2 goal exams → prefilled URL; anonymous → empty picker), chapter reader regressions (mark-learned, rail, drawer, prev/next), 390px zero-overflow, zero console errors. `tsc` + eslint clean. Session doc + worklog + commit + push.

---

## SITE-S11 — Onboarding that scales (Problems 3 + 4)

### S11-A · Step 2 (exam selection): server-driven search + pagination

**Verified:** `onboarding-view.tsx` L169–181 fetches `/api/exams?country=..&pageSize=300` and renders ALL rows. The public API ALREADY supports `q` (name/code/organiser, case-insensitive contains) + `page`/`pageSize` + `total`/`totalPages` — this is UI-only work.

**Fix:**
- State: `{ query, page, result: { exams, total, totalPages } }`; debounce search input 300ms → reset to page 1; **10 rows per page**.
- Pagination footer: Prev / "Page X of Y" / Next + "N exams" total; buttons `min-h-[44px]` touch targets.
- **Selected chips row pinned above the list** (removable, always visible regardless of pagination — the selection survives page changes; the row card shows the tick when the exam is on the current page).
- Selected-exam summary line (existing "N selected — intent signal" copy) stays.
- The skeleton/error/empty states mirror the current ones (3 row skeletons → 10).
- Nice-to-have (only if trivial): default first page ordered by content-richness (has current version). NOT required for v1 — alphabetical server sort is today's honest behaviour.

### S11-B · Step 3 (subjects): derived from the chosen exams' syllabi

**User's decision (confirmed direction):** once exams are chosen, subjects should come from those exams' syllabi — pre-selected, untickable, with other subjects still addable.

**New endpoint — `GET /api/exams/subjects?exams=a,b&country=IN&language=en`** (public, rate-limited, 60s-cached, ≤10 exam refs = MAX_GOAL_EXAMS):
- For each exam: current version → syllabus nodes → ExamMappings (the tutorials §14 gate: VERIFIED units, topic-visible) → KnowledgeUnits → **distinct Topics** with §35 labels (reader language → country default → canonical name).
- Response: `{ subjects: [{ slug, label, examSlugs: string[] }] }` (examSlugs = which of the chosen exams' syllabi contain it — the UI shows these as provenance chips).
- Honest fallbacks: unknown exam refs skipped; exam without mappings contributes nothing; a §35-style note ships when zero subjects derive.

**Step 3 UI (two groups):**
- **"From your exams' syllabus"** — the derived subjects, ALL pre-ticked (merged with any prefilled goal topics), each row showing the contributing exam names as tiny chips; untick freely. Derived-rows fetch runs on entering step 3 (only when selectedExams.size > 0; else skip straight to the plain tree with a quiet note).
- **"All subjects"** — the existing taxonomy tree, now collapsed behind a toggle ("Browse all subjects"), same tick behaviour, MAX_TOPICS=25 cap logic unchanged.
- Save semantics UNCHANGED: one `PUT /api/goal` full replacement with the union (no new goal fields).

### S11 QA
Onboarding E2E: search "ssc" → server-filtered page 1; paginate; select across pages; chips remove; step 3 derives from 2 real exams (AFCAT + a state PSC); untick one derived subject; add one from All subjects; save → `/api/goal` round-trip → dashboard reflects; 1000-exam simulation is not needed (the contract is page-based — verified via API math). 390px + 1440px passes. Session doc + worklog + commit + push.

---

## SITE-S12 — The jurisdiction taxonomy (Problem 5)

**User's decision (confirmed direction):** a DB-backed taxonomy — International / Central Govt / State Govt / District — attached to exams, consumed by personalisation (state selection → Central + International + own state + own districts first; other states secondary), on the Exams page and everywhere exam lists appear.

### S12-A · Data model + seed + backfill

```prisma
enum JurisdictionLevel { INTERNATIONAL CENTRAL STATE DISTRICT }

model Jurisdiction {
  id        String   @id @default(cuid())
  countryId String?  // null iff INTERNATIONAL (cross-market scope; Exam.countryId untouched — §14 holds)
  level     JurisdictionLevel
  name      String   // "Government of India — Central", "Maharashtra", "Pune District"
  code      String?  // subdivision code (ISO 3166-2 suffix: "MH"), null for CENTRAL/INTERNATIONAL
  parentId  String?  // DISTRICT → its STATE row
  sortOrder Int      @default(0)
  country Country?     @relation("JurisdictionCountry", fields: [countryId], references: [id], onDelete: Cascade)
  parent  Jurisdiction? @relation("JurisdictionTree", fields: [parentId], references: [id])
  children Jurisdiction[] @relation("JurisdictionTree")
  exams   Exam[]
  @@unique([countryId, level, code])
  @@index([countryId, level])
}

// Exam: jurisdictionId String? (nullable FK, SetNull — backfill first, gaps surfaced, never a hard cutover)
// UserGoal: stateCode String? — the learner's subdivision code ("MH"); country implied by home market (§9 explicit signal, §14 market-scoped)
```
- **`Exam.level` stays untouched** (legacy metadata; public grouping switches to jurisdiction once backfilled — honest `level`-based fallback only when jurisdiction is null). No destructive migration.
- **Seed (`scripts/seed-jurisdictions.ts`, idempotent upserts):** INTERNATIONAL (one global row) · CENTRAL per country ("Government of India — Central") · India's 28 states + 8 UTs (STATE, ISO codes) · districts NOT bulk-seeded (created on demand in Console under their state — 700+ rows of noise helps no one on day one).
- **Backfill (`scripts/backfill-exam-jurisdiction.ts`):** NATIONAL → the country's CENTRAL row · STATE/REGIONAL → infer the state by name/organiser matching the state list (e.g. "Maharashtra Public Service Commission" → MH) · explicit "International" in name/organiser → INTERNATIONAL · everything unresolved stays NULL and surfaces in the Console gap list (never a guessed assignment).

### S12-B · APIs + personalisation plumbing

- `Exam` public DTOs gain `jurisdiction: { level, stateCode, stateName, districtName } | null`.
- `GET /api/exams` gains optional `state=MH`: when present, the service relevance-sorts — CENTRAL + INTERNATIONAL first, then own STATE + its DISTRICTs, then everything else (stable name sort inside tiers). `q`/`page`/`pageSize` semantics unchanged (S11's paginated picker inherits the ordering for free).
- `PUT/GET /api/goal` gains `stateCode` (validated against the seeded STATE rows of the home country; cleared like the other optional scalars).
- Onboarding **step 1** gains "Your state" (shown only when the home country has seeded STATE rows; optional, skippable) → saved with the goal. Editable in `/personalisation` (the same field in the goal-edit surface).
- One shared client helper `bucketByJurisdiction(exams, stateCode)` → `{ primary, secondary }` — THE single ordering primitive reused by every surface (no per-page bespoke logic).

### S12-C · Public surfaces (all riding the same bucket helper)

1. **`/exams/` directory:** jurisdiction-aware groups — "Central government exams" · "International" · "Your state ({Maharashtra})" (+ its districts inline) · **"Other states" as a collapsed secondary section** (state name on each card). Without a known state: neutral level groups (Central / State / District / International). Level chips row upgrades to jurisdiction chips.
2. **Onboarding step 2:** server-side relevance ordering via `state=` (own-state + central + international first — other states appear on later pages, not hidden).
3. **`/tutorials/` index directory · `/pyq/` index · `/mock-test/` listings:** same bucket helper for exam ordering (own-state first, secondary collapsed).
4. **Exam cards:** a subtle jurisdiction chip ("Central" / "Maharashtra" / "Pune District" / "International") replacing today's plain level chip where shown.

### S12-D · Console

- Exam form: jurisdiction cascade (level → state → district; district options = children of the chosen state; ADMIN can create a district inline). Exam table: jurisdiction column + "missing jurisdiction" filter (the backfill gap list becomes one click).
- No new console section — this rides the existing exams console (`exam:manage`).

### S12 QA
Seed + backfill parity reports (N exams jurisdiction-tagged, N gaps listed); API E2E (state relevance ordering, unknown state honesty, goal stateCode round-trip); browser E2E on /exams/ groups (with + without a known state), onboarding state select → step 2 ordering, tutorials/PYQ ordering; 390px + 1440px; session doc + worklog + commit + push.

---

## Execution order & dependency notes

- S10 is independent of S11/S12 (ship first — it fixes the most-reported pain).
- S11-A is UI-only (API ready); S11-B adds one new read-only endpoint.
- S12 is the only schema-touching session → `bun run db:push` + seed + backfill; S11's paginated picker automatically inherits S12's relevance ordering (no rework).
- Every session: worklog append + `docs/sessions/SITE-S*.md` + commit + push (Vercel auto-deploys; `postinstall`/`build` pipeline already fixed in SITE-S5).
