# S9-B — Tutorials console cockpit (write agent record)

Task ID: S9-B · Agent: full-stack subagent (tutorials console) · Status: COMPLETE (type-check + lint clean, API + browser E2E green)

## What was built

The read-only Tutorials cockpit at `/console/tutorials` (SITE-S9 slice B): per-exam coverage %, the three
content gaps (chapters without lessons / practice / PYQ) with one-click deep-links into the EXISTING editors,
and learner-progress aggregates. No new editor, nothing persisted.

## Files created
- `src/modules/tutorials/admin-service.ts` — `getTutorialsAdminOverview` (whole-market, 60s cached, batched 2-query
  nodes+mappings walk + 3 groupBy content counts + 2 groupBy progress aggregates) and `getTutorialsAdminExamDetail`
  (reuses the PUBLIC `getTutorialExam` for the gap chapters — console gaps can never disagree with /tutorials/),
  plus `tutorialsAdminQuerySchema`, `TUTORIALS_ADMIN_GAP_CAP` (25), `TUTORIALS_ADMIN_PAGE_SIZE` (20).
- `src/app/api/tutorials/admin/route.ts` — GET-only, `requirePermission('exam:manage')`, `ok({ overview })` /
  `ok({ detail })` envelope (NOTE for consumers: the payload rides `data.overview` / `data.detail`), typed
  COUNTRY_NOT_FOUND mapping. Static `admin` segment correctly wins over `[examRef]` (verified live).
- `src/components/console/pages/tutorials-console-page.tsx` — the cockpit page (5 stat cards, ResourceTable with
  client-side search/pagination, coverage bar emerald≥60/amber≥30/rose<30, gap dialog with 3 sections + per-row
  deep-links: `/console/exams/{exam.id}` (mapping manager, by exam ID — the exams-page link format),
  `/console/questions`, `/console/pyq`).

## Files edited (all additive)
- `src/modules/tutorials/types.ts` — appended the four admin DTOs AFTER S9-A's combined types (no overlap).
- `src/modules/tutorials/index.ts` — added the admin-service exports + admin type exports around S9-A's combined
  exports (no overlap).
- `src/components/console/console-nav.ts` — `tutorials` item (BookOpenCheck, exam:manage) between `exams` and
  `taxonomy` in 'Exams & Structure'.
- `src/components/console/console-shell.tsx` — `case path === 'tutorials'` in renderConsolePage + import.

## Key decisions (for later agents)
1. **Did NOT edit service.ts** (S9-A owns it). S9-A had ALREADY exported `resolveReaderContext`,
   `loadLanguagePair`, `loadSubjectMaps`, `isUnitVisible`, `loadUnitContentCounts` — admin-service.ts imports them
   instead of replicating (read-only import = zero edit conflict). If those exports disappear, admin-service breaks
   at type-check — they are documented as "exported for the combined service (SITE-S9 sibling)", stable.
2. Overview mapping bulk select = loadTutorialsIndex's select + `syllabusNodeId` (coverage % / empty-chapter count
   need per-node lesson presence, which the public index never computes). Node select stays lean `{id, examVersionId}`.
3. Progress aggregates: two groupBys (by examId with _count; by examId×userId) for the overview — groupBy can't
   count distinct; single-exam detail uses ONE groupBy by userId with _count (learnerCount = rows, completionCount =
   sum). RAW all-time walk counts (superseded-version marks included) — honest totals, documented in the service.
4. Counts parity verified live: admin overview == public /api/tutorials index, 136/136 exams, 0 mismatches on
   chapters/lessons/practice/pyq. The DETAIL exam block mirrors the public TOC totals instead (per-chapter sums —
   units mapped to several chapters count once per chapter; the pre-existing index-vs-TOC nuance, kept so the
   detail's numbers agree with its own gap lists).
5. Overview includes ALL ACTIVE exams (even tree-less ones: chapterCount 0, versionLabel null) — the honest gap;
   `avgCoveragePercent` averages only exams with ≥1 chapter.
6. Lint note: the repo's react-hooks v7 `set-state-in-effect` rule bans synchronous setState in effects — the page
   follows the exams-page pattern (every setState after the first await; page reset inside the search onChange;
   refresh = `setLoading(true)` + tick bump from event handlers only). pyq-page's identical-looking effects pass
   only because the compiler analysis bails out on that larger file — do NOT copy pyq's effect shape for new pages.
7. Route envelope: `ok({ overview })` / `ok({ detail })` (per spec) — client unwraps `data.overview` / `data.detail`.

## Verification log
- `bun run type-check` + `bun run lint` — clean.
- Anonymous GET → 401 UNAUTHORIZED; invalid ?exam → 400; ?country=ZZ → typed COUNTRY_NOT_FOUND 404; unknown exam
  → ok envelope with exam:null.
- Login as admin@gksetu.dev → overview IN: 136 exams / 1001 chapters / 738 lessons / 1442 practice / 586 PYQ /
  55% avg coverage; per-exam counts identical to the public index (0 mismatches).
- Detail afcat: 5 ch / 4 les / 80% cov, lessonGaps=["General Awareness & Reasoning"], practice/pyq sections honest
  empty; appsc-group-1 shows a chapter in BOTH practiceGaps and pyqGaps (1 lesson, 0 practice, 0 pyq) — correct.
- Progress round-trip: marked a chapter via POST /api/tutorials/progress → (after the 60s cache TTL) learnerCount=1,
  completionCount=1 in detail + overview row + totals → unmarked (state restored).
- Browser (isolated agent-browser session): sign-in → cockpit renders (stats, market line, 136-row table with
  pagination); afcat Gaps dialog renders summary tiles + Version line + 3 sections + honest empty hints; the gap
  row deep-link navigated to `/console/exams/{id}` (the exam detail page); search "ssc" filters correctly; 390px
  viewport — zero horizontal overflow; zero browser console errors.

## Environment notes (for the orchestrator)
- The sandbox dev server was OOM-killed at ~16:01 (dmesg: next-server anon-rss 2.2GB, 4GB box) mid-E2E, and
  plain background restarts were reaped between tool commands. Restarted with `(setsid bun run dev &)` — survives;
  health 200 at handoff. dev.log is TRUNCATED by each `bun run dev` (tee) — history lives in this record.
- The default agent-browser session is SHARED between concurrent agents (stale refs mid-QA came from the sibling
  agent driving the same browser) — use `--session <name>` for isolated QA.
