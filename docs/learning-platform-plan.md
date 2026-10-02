# The Learning-Platform Wave — Design Unification, PYQ, Tutorials

**Status:** CONFIRMED by the user (all four decisions + the tutorials-personalisation addition).
**Sessions:** SITE-S6 (design) → SITE-S7 (PYQ) → SITE-S8 (tutorials core) → SITE-S9 (combined + console + polish).
**Governing principle:** unified systems only — every feature rides the existing spine (taxonomy, knowledge units, exam mappings, practice engine, §11 union engine, console toolkit). No parallel content systems.

**Confirmed decisions (user, this wave):**
1. URLs: `/tutorials/{exam}/{chapter}/`, `/tutorials/combined/`, `/pyq/{exam}/{year}/`.
2. MCQ/QNA + private pages go FULL WIDTH (identical frame to Dashboard/CA/Exams).
3. Tutorials auto-derive (computed) — 136 exams get tutorials day-one, zero per-exam config; console manages the parts, not the tutorial.
4. PYQ v1 covers both MCQ and QnA provenance.
5. **Tutorials index is personalised** — the signed-in user's goal exams (UserGoal → UserGoalExam) appear first in a "Your exams" section with progress; then the full directory.

---

## SITE-S6 — Design unification (Task 1)

### The hero standard (extracted from current-affairs-view.tsx / exam-directory-view.tsx / topic-landing-view.tsx)

```
container:      <div className="space-y-5">        // NO max-w, NO mx-auto — fills the shell column
breadcrumb:     <nav aria-label="Breadcrumb" className="py-1 text-xs">
                  <ol className="flex items-center gap-1.5">
                    <li><button className="min-h-[32px] text-zinc-500 hover:text-emerald-700">Home</button></li>
                    <li className="text-zinc-300" aria-hidden>/</li>
                    <li aria-current="page" className="font-medium text-zinc-900">…</li>
                  </ol>
                </nav>
hero band:      <motion.section className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg
                                       border border-emerald-100 bg-white text-emerald-600 sm:flex"><Icon/></span>
                      <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">…</h1>
                        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">one-liner (counts folded in)</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">…actions…</div>
                  </div>
                </motion.section>
stat pills:     <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                    <icon className="h-3.5 w-3.5 text-emerald-600"/> label
                  </span>
                </div>
```
Actions are semantic, not mandatory: CA = Share+Follow · subject = Share+Follow · Exams directory = none. Loading skeletons mirror the band (h-28 band skeleton).

### S6 changes
- **/subjects/** (`home/subjects-view.tsx`): standard band + breadcrumb + tile; container `space-y-6 → space-y-5`; counts folded into the one-liner; no actions (directory, like Exams); skeleton updated.
- **/mock-test/** (`assessment/mock-test-view.tsx`): standard band + breadcrumb (`py-1`, ol/li); H1 `text-3xl sm:text-4xl → text-2xl sm:text-3xl`; old h-11 tile → standard h-10 tile; bare stats row → stat pills; container `space-y-8 → space-y-5`; no actions; stat skeletons adjusted.
- **/mcq/ + /qna/** (`home/mcq-view.tsx`, `home/qna-view.tsx`): standard band + breadcrumb (+ drop the stray `text-zinc-400` on nav) + Share button (`ShareButton`, path `/mcq/` / `/qna/`); **drop `mx-auto max-w-3xl`** in ALL THREE return branches (loading/error/loaded) of each; container `space-y-5`; skeletons updated (band).
- **Private pages width** (`notifications/notifications-view.tsx` L488, `personalisation/profile-view.tsx` L267, `personalisation/controls-view.tsx` L259 (preserve the `dir` RTL wrapper!), `feedback/my-feedback-view.tsx` L127): drop `mx-auto max-w-3xl` → `space-y-8` like Dashboard/Saved/Following. Wide-stretching single-column forms get responsive multi-col grids (`sm:grid-cols-2/3`) so the full-width frame stays professional. The emerald band stays PUBLIC-only; private pages keep their SITE-S4 plain headers.
- NOT in scope: onboarding, CMS site pages, sign-in (intentional widths).

---

## SITE-S7 — PYQ (Task 2): provenance layer, not a new content type

### Data (prisma)
```prisma
model QuestionProvenance {
  id             String   @id @default(cuid())
  questionId     String
  question       Question @relation(fields: [questionId], references: [id], onDelete: Cascade)
  examId         String
  exam           Exam     @relation(fields: [examId], references: [id])
  year           Int
  paper          String   @default("")   // "" = unspecified · "Prelims" · "Paper-II"…
  questionNumber String?                 // "Q.14"
  notes          String?
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([questionId, examId, year, paper])   // paper non-null default avoids the NULLs-DISTINCT pitfall
  @@index([examId, year])
  @@index([questionId])
}
model QnAProvenance { …identical shape, qnaId → QnA… }
```
Question/QnA identity, revisions, translations, lifecycle — all untouched. A question can carry many appearances (exam × year).

### Public surfaces
- Badges everywhere a question/QnA card renders: "Asked in UPSC CSE · 2021 (Prelims)" — practice listings (`/api/questions`, `/api/qna`), unit-page practice + QnA layers, MCQ/QNA views, PYQ views. Multiple appearances → up to 2 shown + "+N more".
- **`/pyq/` directory (SEO surface):** `/pyq/` (exam cards with PYQ counts) → `/pyq/{exam}/` (year-wise groups) → `/pyq/{exam}/{year}/` (practice list with inline reveal — the existing stateless POST `/api/questions/practice` reused verbatim).
- New APIs: `GET /api/pyq` (index: exams + counts), `?exam=` (years), `?exam=&year=&page=` (practice cards). Services in `src/modules/pyq/`. Practice machinery (visibility gates, §35 language honesty + English fallback, 60s payload cache, server pagination) reused from the SITE-S3 pattern.
- SEO: per-page title/description targeting "previous year questions" queries; sitemap entries for index + per-exam + per-year (only exams that have PYQs); market-scoped URLs with hreflang via `buildPageSeo`.

### Console
- **PYQ section** (nav under Content): exam/year filters, provenance table (question text, type MCQ/QnA, exam, year, paper, Q-no, target status), create dialog (search question/QnA → exam + year + paper), edit/delete, coverage stats header. Permission: rides `questions:manage` (decided, no new permission). Audit: `PYQ_PROVENANCE` object type + create/update/delete actions.
- APIs: `/api/pyq/admin` (GET list + POST), `/api/pyq/admin/[id]` (PATCH/DELETE). Both scoping-checked server-side.
- Questions/QnA console pages: read-only "Asked in" chips on rows (link to PYQ section).

### Seed (`scripts/site-s7-pyq-seed.ts`)
~30 REAL previous-year questions (UPSC CSE Prelims, SSC CGL — verifiable, factual), anchored to matching existing knowledge units (honest anchoring), published with immutable revisions, each with real provenance rows (exam, year, paper). Idempotent; no fabricated provenance on non-PYQ content (§ honesty).

---

## SITE-S8 — Tutorials core (Task 3): the computed learning path

### Concept
A tutorial is NOT stored — it is COMPUTED from the exam's frozen syllabus tree (TOC) + ExamMapping (chapter content) + practice/PYQ/QnA/mock layers + user progress. 136/138 exams already carry trees + mappings (1,007 nodes, 920 mappings) → tutorials exist day-one.

### URLs & router
- `CONTENT_ROOTS += 'tutorials'` (and 'pyq' in S7); view union += `tutorials` (+ `tutorials-exam`, `tutorials-chapter` or fields on one view — implementation choice); new fields `chapterSlug`; branches inserted between `qna` and the exams tree (the SITE-S4 lesson: above the generic subject fallback); `buildPath` uses the market-scoped `segments.push` pattern (NOT the mock-test fixed-path pattern) → `/hi/tutorials/…` hreflang for free; `openPath` branches; reserved-word hygiene (topicSlugSchema refine + refresh stale RESERVED_SLUGS).
- `/tutorials/` index · `/tutorials/{exam}/` TOC · `/tutorials/{exam}/{chapter}/` chapter (chapter = syllabus node slug — node slugs? nodes have no slug field! **Chapter ref = `priority-path` or id-based slug**: use the node's position path (e.g. `1-2`) or add a `slug` field to SyllabusNode. DECISION: add optional `slug String?` to SyllabusNode + service-generated kebab slug on create/import (append-only safe, frozen trees keep their slugs); URL falls back to node id when null. SEO-clean chapter URLs.)
- `/tutorials/combined/?exams=a,b` in S9.

### Reading experience (w3schools-like, inside the public shell)
- **Chapter view:** tight breadcrumb (Home / Tutorials / {exam} / {chapter}) + compact hero (chapter title, exam + version line, "Mark as learned" toggle + Share inline) → **sticky sub-header under the app header on mobile/tablet** (prev · chapter title · next + "Chapters" button → drawer with the full TOC + progress ticks) → content: lessons (mapped KU cards: title + summary + type/difficulty + link to the knowledge page), **Practice block** (inline MCQ reveal — reuse the SITE-S3 inline practice; EXTRACT the inline-practice component from mcq-view into a shared `src/components/practice/` module and reuse in both — regression-check /mcq/), **PYQ block** ("Asked in previous years" — provenance-filtered cards), **Q&A block**, **Mock tests block**, prev/next footer nav. **Desktop: sticky RIGHT chapter rail** (TOC tree + progress ticks + coverage dots) inside the view (`grid lg:grid-cols-[1fr_240px]`, `sticky top-24` aside) — the app's left sidebar stays.
- **TOC view:** exam hero (band, "N chapters · M lessons · your progress X%"), chapter rows (number, title, coverage dots — lesson/practice/PYQ presence, learned tick), CTA "Continue where you left".
- **Index view (personalised):** signed-in + goal exams → "Your exams" cards first (progress %, Continue CTA); then all-exams directory (Exams-page style cards with chapter/lesson counts).

### Data
- `TutorialProgress { userId, nodeId (→ SyllabusNode, cascade), examId (denormalised for fast per-exam %), completedAt }`, `@@unique([userId, nodeId])`, `@@index([userId, examId])`. Toggle API `POST /api/tutorials/progress` (auth). NOT MasteryState (that is attempt-fed only) and NOT SavedItem (bookmarks, not progress).
- Services `src/modules/tutorials/tutorial-service.ts`: `getTutorialsIndex` (per current version per exam: chapters/lessons/practice/pyq counts — 60s cached), `getTutorialExam` (TOC + counts + progress merge), `getTutorialChapter` (node chain, mapped VERIFIED+visible KUs with §35 labels, practice/pyq/qna/mock blocks, prev/next). Reuses `loadVersionNodes`, `loadVersionMappings`, `mappingInEffect`, `resolveTopicLabels`, `getPublicTree`, practice-layer shapers.
- APIs: `GET /api/tutorials` · `/api/tutorials/[examRef]` · `/api/tutorials/[examRef]/[chapterRef]` · `POST /api/tutorials/progress`. Console APIs in S9.

### Nav/SEO
- Sidebar Discover + footer Explore: **Tutorials** (after Subjects) — PYQ added in S7 (after Q&A).
- Sitemap: tutorials index + per-exam TOC pages (+ chapter pages if crawl-budget sane — index TOC + index, noindex chapter reading pages? NO — chapters are the SEO asset ("UPSC polity chapter"); include chapter URLs for exams with real lesson content). `useSeoHead` per view with server seo blocks.

---

## SITE-S9 — Combined tutorials + Tutorials console + polish

- **`/tutorials/combined/?exams=a,b`:** §11 union engine reuse — union of mapped KUs across selected exams, grouped by canonical SUBJECT (topic tree), each group showing per-exam depth ("Core for UPSC CSE · Supporting for SSC CGL"), lesson + practice blocks, progress per exam. Nothing persisted (§46.3).
- **Tutorials console section:** per-exam dashboard (chapters, coverage %, gaps: nodes without lessons/practice/PYQ), one-click gap-fill deep-links into the existing editors (KU editor prefilled, mapping manager), progress stats. No new editor — the parts are already manageable; this is the cockpit.
- Polish sweep: topic-landing PYQ aggregate lines, cross-links (exam page ↔ tutorial, subject page ↔ tutorials), responsive QA across all new surfaces, parse-route harness re-run.

---

## Verification standard (every session)
`tsc --noEmit` + `tsc -p tsconfig.scripts.json` + `eslint` clean · agent-browser at 390/768/1440 (zero horizontal overflow, zero console errors, sticky footer intact) · API E2E for new endpoints (auth guards, §35 fallback, honest empty states) · commit + push (Vercel deploy green) · worklog + session doc.
