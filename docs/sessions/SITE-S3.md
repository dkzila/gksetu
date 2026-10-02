# SITE-S3 — The practice layer (MCQ + Q&A)

**Date:** 2025-10-02 · **Plan:** docs/site-overhaul-plan.md §3 Task 7
**Status:** COMPLETE — committed `d18d74b`, pushed to `dkzila/gksetu`.

## Delivered

### Public practice APIs (SITE-S3-A)
- `src/modules/assessment/practice-listing-service.ts` + `GET /api/questions` +
  `GET /api/qna` — PUBLISHED-only listings reading the LIVE revision text (post-publish
  edits never leak), §35 language honesty (reader language → English fallback with a
  `fallback` flag), §14 market scoping (GLOBAL or reader-country units), subject filter
  over the topic subtree, deterministic order, server-side pagination, subject chips with
  counts, honest seo blocks (PLANNED languages excluded per the SITE-S2 rule).
- The questions payload ships option **labels only** — `correctAnswer` never leaves the
  server (verified by payload inspection); the existing stateless
  `POST /api/questions/practice` reveals it after an answer.

### The seeded bank (SITE-S3-A)
- One VERIFIED overview knowledge unit per subject — **all 20 subjects now carry
  knowledge pages** (subjects grids show real counts).
- 67 PUBLISHED MCQs (60 English across the 20 subjects + Hindi for the big subjects)
  with immutable QuestionRevision snapshots; 37 published Q&As with revisions — real,
  fact-checked exam-style GK content. Idempotent seed: `scripts/site-s3-practice-seed.ts`.

### The views (SITE-S3-B)
- `/mcq/`: subject chips with counts (All + 20), question cards with A/B/C/D rows,
  one-tap reveal (correct/incorrect marking + explanation + card lock), running score
  chip, pagination (view-local page state), §35 fallback notice, empty/error/skeleton
  states — no sign-in required.
- `/qna/`: same skeleton; question + "Show answer" toggle (animated expand), subject
  chips, knowledge-page links (`/{subject}/{unit}/`), pagination.

## Verification
- API: 67 questions / 37 Q&As live; no `correctAnswer` leak; subject filter + pagination
  + `/bn/` fallback verified.
- Browser: option-reveal POST round-trip (wrong answer → correct row highlighted +
  explanation + lock + score chip), subject refetch, Q&A expand, 390px + 1440px clean,
  zero console errors; tsc + eslint clean.

## Follow-ups
- The bank grows via the console (Questions/QnA pages) or a seed re-run.
- Personalised practice strip (followed subjects/exams) — the views' general browse
  covers the golden path; the personalised mode can ride on the follow signals later.
