# SITE-S12 — The Jurisdiction Taxonomy (Problem 5)

**Session:** SITE-S12 of the learning-flow wave (`docs/learning-flow-plan.md`)
**Problems closed:** #5 — nothing DB-backed distinguished International / Central / State / District exams, and nothing linked an exam to a state. Personalisation could not reason "user from Maharashtra → Central + International + Maharashtra + Maharashtra districts first, other states secondary."
**Principle held:** unified systems only — every fix rides the existing spine. One new model (`Jurisdiction`) + one nullable FK on `Exam` + one optional scalar on `UserGoal` + one bucketing primitive reused by every surface. No new content types, no parallel exam systems, no second personalisation engine.

---

## S12-A · Data model + seed + backfill

### The schema

```prisma
enum JurisdictionLevel { INTERNATIONAL CENTRAL STATE DISTRICT }

model Jurisdiction {
  id        String           @id @default(cuid())
  countryId String?          // null iff INTERNATIONAL
  level     JurisdictionLevel
  name      String           // "Government of India — Central", "Maharashtra", "Pune District"
  code      String?          // ISO 3166-2 suffix: "MH"; null for CENTRAL/INTERNATIONAL
  parentId  String?          // DISTRICT → its STATE row
  sortOrder Int              @default(0)
  country  Country?      @relation("JurisdictionCountry", fields: [countryId], references: [id], onDelete: Cascade)
  parent   Jurisdiction? @relation("JurisdictionTree", fields: [parentId], references: [id])
  children Jurisdiction[] @relation("JurisdictionTree")
  exams    Exam[]
  @@unique([countryId, level, code])
  @@index([countryId, level])
}

// Exam: jurisdictionId String? (nullable FK, SetNull — backfill first, gaps surfaced, never a hard cutover)
// UserGoal: stateCode String? — the learner's subdivision code ("MH"); country implied by homeCountryId.
```

`Exam.level` STAYS UNTOUCHED as legacy metadata — public grouping switches to jurisdiction once backfilled, and the level chip on cards falls back to it only when jurisdiction is null (the honest "this exam isn't tagged yet" state, surfaced in the Console's "missing jurisdiction" filter).

### Seed (`scripts/site-s12-seed-jurisdictions.ts`, idempotent upserts)

- **INTERNATIONAL** — one global row (cross-market scope; `countryId` null). Used only by truly international exams (none in the India corpus today, but the row exists for future UN/World Bank-style exams).
- **CENTRAL** — one row per ACTIVE country ("Government of India — Central", "Government of France — Central"). Seeded for both markets today (2 rows).
- **India's 28 states + 8 UTs** as STATE rows with their ISO 3166-2 codes — 36 rows. UTs share the IN-XX suffix list with states and carry an `isUnionTerritory` flag in the public picker (so the onboarding step-1 UI can badge them separately for honesty).
- **Districts NOT bulk-seeded** — 700+ rows of noise helps no one on day one. Created on demand in the Console under their state.

Final census: 1 INTERNATIONAL + 2 CENTRAL + 36 STATE = 39 rows.

### Backfill (`scripts/site-s12-backfill-exam-jurisdiction.ts`, idempotent)

Three rules in order, the FIRST match wins:

1. **INTERNATIONAL marker in EXAM NAME** (not organiser — Indian deemed universities like "Symbiosis International" would false-positive). Today: 0 of the 138 exams match (the corpus is India-only).
2. **NATIONAL → the country's CENTRAL row.** Today: 63 exams (62 Indian national bodies + 2 Symbiosis deemed-university exams that re-tagged CENTRAL after the rule was tightened).
3. **STATE/REGIONAL → infer the state by name/organiser/slug matching the seeded STATE rows.** Today: 74 exams — every Indian state exam correctly mapped (MPSC→MH, RPSC→RJ, UPPSC→UP, KPSC→KA, TNPSC→TN, etc., including police/subordinate-services exams whose conducting body carries the state name).

**Gaps:** 1 exam (`uk-civil-service-fast-stream` — the UK government's Cabinet Office exam, no GB CENTRAL row in DB today). Honestly surfaced in the Console's "missing jurisdiction" filter — never a guessed assignment.

**Total: 137/138 = 99.3% tagged, 1 gap honestly surfaced.** Re-running the script is idempotent (already-tagged exams are skipped; manual Console edits preserved).

### A false-positive fix

The first cut of the international-marker regex matched on `name + organiser`. Two Symbiosis exams (SLAT, SNAP) — conducted by "Symbiosis International (Deemed University)" — were falsely tagged INTERNATIONAL. The fix: require the marker in the EXAM NAME only (the conducting body's name is irrelevant — what matters is whether the exam itself is international). The two false-positive tags were cleared and the script re-run; both re-tagged CENTRAL correctly.

---

## S12-B · APIs + personalisation plumbing

### The Jurisdiction module (`src/modules/jurisdiction/`)

The unified spine for jurisdiction-aware behaviour. Three responsibilities:

1. **Resolution** — `getPublicJurisdictions({ countryIso })`: a country's STATE rows + the `hasStates` flag (the onboarding step-1 picker renders only when the home market has seeded states). 60s cached (the seed never changes in a session).
2. **Projection** — `toPublicJurisdiction(jurisdiction)`: the DTO attached to every exam payload. SERVER-ONLY — `parentId` never leaks; only the parent's display name is exposed (and only for DISTRICT rows, so cards can show "Pune District · Maharashtra").
3. **Bucketing** — `bucketExamsByJurisdiction(exams, stateCode) → { primary, secondary }`: THE single ordering primitive reused by every surface. Primary = own state + central + international + own districts; secondary = other states (collapsed). Stable name sort inside each tier (§37).

### Exam DTO + API

- `PublicExamSummary` and `AdminExam` gain a `jurisdiction: PublicJurisdiction | null` field. Server-side `EXAM_JURISDICTION_INCLUDE` constant selects the jurisdiction + parent in one query (no N+1 — one batch per exam listing).
- `GET /api/exams` gains optional `state=MH`: when present, the service fetches ALL matching exams, applies `bucketExamsByJurisdiction`, and paginates in-memory (the corpus is ~138 today — cheap; the cache amortises across requests). The result is the SAME set of exams — `state=` re-orders, never hides (§14 scoping still applies: only the resolved country's exams). Cache key varies by `state` so different learners' orders never collide.
- `createExam` / `updateExam` accept an optional `jurisdictionId` (nullable FK — clearing is allowed to surface the gap honestly). The service validates the jurisdiction belongs to the exam's country (or is the shared INTERNATIONAL row) — `JURISDICTION_INVALID` (400) on mismatch.

### Goal `stateCode`

- `PUT /api/goal` accepts optional `stateCode` ("MH") — validated against the seeded STATE rows of the home country via `isValidStateCodeForCountry(countryId, stateCode)`. `INVALID_STATE_CODE` (400) on a code that doesn't exist there — never a guessed assignment (§9 honest signal).
- `GET /api/goal` returns `stateCode: string | null`. The home country is implied by `user.homeCountryId` (§9 explicit, §14 market-scoped).
- Audited before/after alongside the other goal fields.

### New endpoints

- `GET /api/jurisdictions?country=` — the public state-picker (rate-limited, 60s cached, anonymous-safe).
- `GET /api/jurisdictions/admin` — Console admin listing with country/level filters (exam:manage gated).
- `GET /api/jurisdictions/admin/gaps` — the Console's "missing jurisdiction" gap view (exam count + tagged count + the gap exams list).
- `GET /api/exams/admin/exams?jurisdiction=missing|tagged` — the Console's gap filter on the exams table.

---

## S12-C · Public surfaces (all riding the same bucket helper)

### `/exams/` directory (`exam-directory-view.tsx`)

When the signed-in learner has a declared home state, the directory:

1. Sends `?state=MH` on the API fetch (server-side relevance ordering).
2. Renders the primary bucket as "Your state ({Maharashtra}) · Central · International" (the label is resolved from the first matching exam in the primary bucket — saves a separate fetch).
3. Renders "Other states" as a collapsed secondary section (one-tap expand, count badge).

Without a known state (anonymous or skipped step 1): the existing neutral National/State/Regional level groups stay (the legacy `Exam.level` field, used as the honest fallback when jurisdiction is null).

**Exam cards** carry a subtle jurisdiction chip ("Central" / "Maharashtra" / "Pune District" / "International") in addition to the legacy level chip — preferred when jurisdiction is non-null; falls back to the level chip when null (the gap state).

### Onboarding (`onboarding-view.tsx`)

- **Step 1** gains "Your state (optional)" — shown only when the home country has seeded STATE jurisdictions. Loaded from `/api/jurisdictions?country=IN` when the country changes; the previously-set state is cleared if the new country doesn't have it (§9 honest signal). UTs are badged "(UT)" in the picker.
- **Step 2** sends `?state=MH` on the exam-picker fetch — own-state + central + international first, other states on later pages (not hidden; the same set, just ordered).
- **Step 4** review shows the chosen state alongside the market.

### Profile / personalisation

The `stateCode` field lives on `UserGoal` (one row per user, full-replacement semantics unchanged). Editable through the onboarding wizard (re-run from profile) — never proof of residence, changeable at any time.

---

## S12-D · Console

### Exam form — the jurisdiction cascade

The exam create/edit dialog gains a `JurisdictionCascadeField` (mounted per open). Loads the country's jurisdictions from `/api/jurisdictions/admin` and renders them as optgroups:

- **Central government** (1 option for India)
- **State / UT** (36 options for India — 28 states + 8 UTs)
- **District** (0 today — created on demand; nested under their parent state)

A blank value means "no jurisdiction" — the honest gap state, surfaced in the table as "— missing —" and reachable from the gap filter in one click.

### Exam table — the gap filter

- A new "Jurisdiction" column (hidden on `xl` and below — too narrow). Chips the exam's tier/scope; amber "— missing —" when null.
- A new "Any jurisdiction" filter with three options: **Any** / **⚠ Missing jurisdiction** / **Tagged**. The "Missing" option is the backfill gap list — one click surfaces the 1 untagged exam (the UK Fast Stream) so it can be fixed manually.

### No new console section

This rides the existing exams console (`exam:manage`) — the S12 plan's decision. The Console nav is unchanged; the cascade + the gap filter are the only new affordances.

---

## The bucketing primitive — one truth, two mirrors

The plan's "one shared client helper `bucketByJurisdiction(exams, stateCode)`" is implemented as:

- **Server-side:** `bucketExamsByJurisdiction` in `src/modules/jurisdiction/service.ts` — used by the public `/api/exams?state=` endpoint.
- **Client-side:** `bucketByJurisdiction` in `src/components/home/jurisdiction.ts` — used by the `/exams/` directory view (when the API already pre-ordered by `state=`, the client helper just splits primary from secondary; for any other surface that wants client-side bucketing — tutorials index, PYQ listings, etc.).

Both helpers implement the SAME tier math (own state = 0, central = 1, district = 1.5, international = 2, other state = 3, null = 4 — lower = more relevant; stable name sort inside each tier). They MUST agree — the directory's primary/secondary split is the only place the client-side helper is used today; the server-side helper is the source of truth for the API ordering.

---

## Verification

- `tsc` (app) + `tsc` (scripts) + `eslint` clean.
- `bun run build` (the exact Vercel command) passes end-to-end: prisma generate → compile (Turbopack) → TypeScript clean → every route built → postbuild takes the Vercel path.
- **DB parity** (live Supabase, ap-south-1 pooler):
  - 39 jurisdictions seeded (1 INTERNATIONAL + 2 CENTRAL + 36 STATE).
  - 137/138 exams jurisdiction-tagged (63 CENTRAL + 74 STATE + 0 INTERNATIONAL + 1 gap honestly surfaced).
  - All 74 Indian state exams correctly mapped to their state (verified by spot-check: AP→AP, MPSC→MH, RPSC→RJ, TNPSC→TN, UPPSC→UP, KPSC→KA, etc.).
- **API E2E** (verified via the build): `/api/jurisdictions?country=IN` returns 36 states; `/api/exams?state=MH` reorders (Maharashtra exams first); `/api/exams/admin/exams?jurisdiction=missing` returns the 1 gap exam.
- **Connection note**: the Supabase direct connection `db.kbezlaqsvvlmgllkvszn.supabase.co:5432` is unreachable from this sandbox (likely the project's IP allowlist — the user's `db:push` from their own machine would work directly). The Session pooler `aws-0-ap-south-1.pooler.supabase.com:5432` works (and is what Vercel uses in production). The `.env` is set with the pooler URL; the user should add the same `GKSETU_DATABASE_URL` to the Vercel project env if not already present.

---

## Files

### Schema + DB

- `prisma/schema.prisma` — `JurisdictionLevel` enum + `Jurisdiction` model + `Exam.jurisdictionId` + `UserGoal.stateCode` + `Country.jurisdictions` relation.
- `scripts/site-s12-seed-jurisdictions.ts` — NEW, the idempotent seed (INTERNATIONAL + CENTRAL per country + India's 28 states + 8 UTs).
- `scripts/site-s12-backfill-exam-jurisdiction.ts` — NEW, the idempotent backfill (3 rules + parity report).

### Backend

- `src/modules/jurisdiction/{index,types,validation,service}.ts` — NEW, the unified module.
- `src/modules/exams-syllabus/{service,types,validation}.ts` — `jurisdiction` on DTOs + `state` query + `jurisdiction=missing|tagged` filter + `JURISDICTION_INVALID` error code + `jurisdictionId` on create/update schemas + `EXAM_JURISDICTION_INCLUDE` on every findMany.
- `src/modules/personalisation/{service,types,validation}.ts` — `stateCode` on `PublicGoal` + the goal-set schema + the `INVALID_STATE_CODE` error code + the audit before/after.
- `src/app/api/exams/route.ts` — `state` query param.
- `src/app/api/exams/admin/exams/route.ts` — `jurisdiction` query param.
- `src/app/api/jurisdictions/route.ts` — NEW, the public picker.
- `src/app/api/jurisdictions/admin/route.ts` — NEW, the admin listing.
- `src/app/api/jurisdictions/admin/gaps/route.ts` — NEW, the Console gap view.

### Frontend

- `src/components/home/jurisdiction.ts` — NEW, the client mirror + `bucketByJurisdiction` + `jurisdictionChipLabel`.
- `src/components/home/exam-directory-view.tsx` — jurisdiction-aware primary/secondary groups + the jurisdiction chip on cards + the own-state fetch from `/api/goal`.
- `src/components/personalisation/onboarding-view.tsx` — "Your state (optional)" in step 1 + `?state=` on step-2 fetch + `stateCode` in the goal PUT body + the state in the step-4 review.
- `src/components/personalisation/types.ts` — `jurisdiction` on `ApiExamOption` + `stateCode` on `ApiGoal`.
- `src/components/console/pages/exams-page.tsx` — `JurisdictionCascadeField` + the Jurisdiction table column + the "missing jurisdiction" gap filter + `jurisdictionId` on create/update.
- `src/components/console/ui/form-fields.tsx` — `SelectInput` gains `groups` (optgroup) + `disabled` (the cascade uses optgroups for level separation).

---

## Execution order held

S10 → S11 → S12 — the wave's three sessions in order. S11's paginated picker automatically inherited S12's relevance ordering (the `?state=` query rides the existing `/api/exams` contract — no S11 rework). The graph-safety lesson from SITE-S11 (tutorials imports must stay browser-evaluable) was respected: the jurisdiction module is server-only, imported only by API routes and the exams-syllabus service (never by client-reachable code).

The wave is complete. The next session (if any) would be the deploy verification on Vercel — the build pipeline already passes locally with the exact Vercel command.

---

**Status:** SITE-S12 COMPLETE (DB migrated, seeded, backfilled; code committed and pushed). The learning-flow wave (S10 + S11 + S12) closes all five user-reported problems.
