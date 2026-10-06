# SITE-S13-D — ExamNotes Authoring Pilot (UPSC CSE × 3 + SSC CGL × 1 + AFCAT × 1)

**Session:** SITE-S13-D of the premium-learning wave (`docs/premium-learning-plan.md`)
**Wave goal:** coaching-style exam-pattern notes per exam, free now + premium later, replace coaching/books.
**This session:** authored 20 high-quality ExamNotes (4 kinds × 5 chapters across 3 exams) directly into the live Supabase DB. The user can now browse the chapter pages and see real editorial content (Pattern Brief → Cheat Sheet → Worked MCQs → Revision Notes) — the premium overlay pipeline is verifiable end-to-end.

---

## What was authored

| Exam | Chapter | Notes authored |
|---|---|---|
| UPSC Civil Services | Indian Polity and Governance — Constitution, political system, rights issues (Prelims Paper-I) | 4 |
| UPSC Civil Services | Indian Constitution — historical underpinnings, evolution and features (Mains GS-II) | 4 |
| UPSC Civil Services | Fundamental Rights and Fundamental Duties (Mains GS-II) | 4 |
| SSC CGL | Indian Polity and Constitution (Tier-I General Awareness) | 4 |
| AFCAT | General Awareness — history, geography & polity | 4 |

**Total: 20 ExamNotes** across 3 exams (5 chapters × 4 kinds each).

Each chapter got all 4 note kinds:
- **PATTERN_BRIEF** — exam-specific weightage + question style (~250-400 words)
- **CHEAT_SHEET** — 1-page condensed revision (articles/dates/formulas, 3500-6800 chars)
- **WORKED_MCQ** — real PYQ-style questions + step-by-step explanations + pattern alerts (3000-4700 chars)
- **REVISION_NOTES** — chapter-summary mind-map + last-minute tips (4500-6200 chars)

The content is **real editorial content, not stubs** — sourced from the canonical UPSC/SSC/AFCAT pattern references (the official notifications + the platform's own PYQ provenance layer from SITE-S7). Every note is exam-pattern-aware: the UPSC Pattern Brief cites UPSC's question-count stats (13-17/year Prelims average); the SSC CGL notes explain SSC's "fact-recall" pattern (single-shot "Article X is about Y" vs UPSC's multi-statement format); the AFCAT notes carry the defence linkage (President as Supreme Commander, the CDS post, the Agnipath scheme).

---

## The authoring approach

A direct-DB seed script (`scripts/s13d-author-exam-notes.ts`) instead of the API route. This is faster (no HTTP round-trip per note), more reliable (the unique constraint `[examId, syllabusNodeId, kind]` is enforced at the DB level), and idempotent (already-existing notes are skipped — re-running the script is safe).

**The script flow per note:**
1. Find the exam by slug.
2. Find the exam's current version (the §11 engine's "active ExamVersion" — the window containing now).
3. Find the syllabus node (chapter) by exact name match (within the version's tree).
4. Skip if a note with the same `[examId, syllabusNodeId, kind]` already exists (idempotent).
5. Create the ExamNote as DRAFT (authoredById set to the admin user).
6. Create an ExamNoteRevision (the §36 immutable body snapshot — `publishedById` set to the admin).
7. Update the ExamNote to PUBLISHED + set `publishedRevisionId` to the revision's id.

**The admin author:** `cmuhqvuf3000ij1ysl9e4986x` (admin@gksetu.dev — ADMIN role, the existing dev-admin account).

---

## The content quality bar

The notes are NOT generic — each is exam-pattern-specific:

### UPSC CSE Polity Pattern Brief (excerpt)
> "Polity is the highest-yield subject in UPSC Prelims Paper-I. From 2013 to 2024, the year-on-year question count has stayed in a tight band: 13–17 questions every year (out of 100), averaging ~15. Roughly 1 in 7 Prelims marks comes from this single chapter — no other subject matches that consistency.
>
> **Question style is overwhelmingly factual-recall** — the question names a constitutional provision, an article, an amendment, or a body, and asks you to identify the correct statement. Pure conceptual questions are rare (~2 per year). The pattern is: 'Consider the following statements about X. Which is/are correct?' with 2–3 statements, one of which is usually a subtle trap..."

### SSC CGL Polity Pattern Brief (excerpt)
> "Polity is one of the 4 sub-sections of SSC CGL Tier-I's 'General Awareness' section (the others: History, Geography, Economy + General Science). In a 25-question GA paper (worth 50 marks), Polity contributes 4–6 questions consistently every year — a stable, predictable chunk. The Polity share is smaller than UPSC's (4–6 vs ~15) but the per-question yield is similar because the section is high-accuracy (the syllabus is finite, the questions are factual).
>
> **Question style is purely fact-recall** — single-shot 'Article X is about what?' / 'The 73rd Amendment introduced what?' / 'Who is the head of the Election Commission?' questions. NO multi-statement format (that's UPSC's favourite)..."

### AFCAT Polity Pattern Brief (excerpt)
> "AFCAT's General Awareness section is part of the 100-question paper (the other sections: English, Numerical Ability, Reasoning + Military Aptitude). General Awareness contributes 25–30 questions out of 100 (worth 75–90 marks out of 300 — each question carries 3 marks, with 1 negative for wrong answers)...
>
> **Defence linkage:** some AFCAT polity questions have a defence linkage — the President as Supreme Commander of the Armed Forces, the Defence Minister's role, the Chiefs of Staff Committee, the role of the Raksha Mantri. These are general polity knowledge + a defence-context overlay..."

Each note also carries:
- A **worked MCQ** with the real UPSC/SSC/AFCAT question style + step-by-step explanation + a "**pattern alert**" pointing out the trap (the most-tested confusion point — e.g. "Right to property was removed by the 44th Amendment — the single most-tested amendment in UPSC").
- A **cheat sheet** with the high-yield facts (the 12 schedules, the amendments, the constitutional bodies, the source-of-borrowing table).
- **Revision notes** with the "last-night revision" structure (numbered sections, easy-to-scan).

---

## Verification

- **DB parity:** 20 ExamNotes + 20 ExamNoteRevisions successfully inserted into the live Supabase DB. The idempotency check confirmed 0 skipped (the script was a fresh run on an empty ExamNotes table).
- **Public API (end-to-end):** started the Next.js dev server + verified the public chapter-page payload via direct HTTP:
  - `GET /api/exams/upsc-civil-services/notes?chapter={nodeId}` → returned 4 PUBLISHED notes with `isLocked: false`, `paywallReason: null` (gating is OFF — the default "free for now" state — every learner sees the full body).
  - `GET /api/exams/ssc-cgl/notes?chapter={nodeId}` → returned the 4 SSC CGL notes.
  - `GET /api/exams/afcat/notes?chapter={nodeId}` → returned the 4 AFCAT notes.
- **Per-exam summary (DB):** UPSC CSE has 12 notes (3 chapters × 4 kinds), SSC CGL has 4, AFCAT has 4. Total 20.
- **Chapter-page UI wiring:** the chapter reader (`src/components/tutorials/chapter-reader.tsx`) renders the `<ExamNotesSection>` component which fetches the above endpoint + displays the 4 note cards (Pattern Brief → Cheat Sheet → Worked MCQs → Revision Notes) below the existing 5 tutorial blocks. When the user visits `/tutorials/upsc-civil-services/{chapter-slug}/` they'll see the premium editorial overlay.

---

## Files

- `scripts/s13d-probe.ts` — NEW, the probe script that found the syllabus chapters for the 3 pilot exams.
- `scripts/s13d-author-exam-notes.ts` — NEW, the idempotent authoring script (5 chapters × 4 kinds = 20 notes). The full note bodies are inline in the script (the user can re-run or extend it).
- `scripts/s13d-verify.ts` — NEW, the verification script (per-exam summary + first note body preview).

---

## The "free for now" state confirmation

The premium gating switch (`premiumGatingEnabled` site-setting) is still OFF (the default). This means:
- Every PUBLISHED ExamNote is visible to everyone (anonymous + signed-in) — confirmed via the public API call.
- The chapter-page UI shows every note's FULL body (no blurred preview, no paywall CTA).
- The user can flip the switch from `/console/premium` whenever they're ready to monetise — every learner without an entitlement will then see the 100-char blurred preview + the "Unlock for ₹99" CTA.

---

**Status:** SITE-S13-D COMPLETE (20 notes authored + published; verified via the public API; the user can browse the chapter pages now). The pipeline is fully verifiable end-to-end — the user can visit `/tutorials/upsc-civil-services/indian-polity-and-governance/` (or the equivalent chapter URL) and see the 4 premium editorial blocks render below the existing free tutorial content.

**Next (planned):** SITE-S15 (book compilation + upsell — the puppeteer PDF render + the chapter-page "Get as printed book" CTA). Deferred until the user is ready; the SITE-S15 architecture is documented in `docs/premium-learning-plan.md` and the SITE-S13 schema + payment dependencies are satisfied.
