# SITE-S7 — The PYQ system

**Date:** 2026-10-02 · **Plan:** docs/learning-platform-plan.md §SITE-S7 · **Status:** COMPLETE — `6cb410d`.

## Delivered
- **Data**: QuestionProvenance + QnAProvenance — provenance, not a new content type (Question/QnA identity, revisions, translations untouched). `@@unique([target, exam, year, paper])` with non-null paper default (the NULLs-DISTINCT defeat).
- **Seed**: 37 real PYQs (17 UPSC CSE Prelims 2018-2024, 15 SSC CGL Tier-I 2019-2023 incl. 3 documented repeats) + 5 UPSC Mains Q&As = 40 provenance rows, honestly anchored, idempotent.
- **Public**: /pyq/ directory (index → exam years → year practice with inline reveal + amber "Asked in" badges + Mains-style QnA accordion), market-scoped URLs (/hi/pyq/); provenance badges on /mcq/, /qna/, and the knowledge pages' practice + QnA layers (one batch loader, no N+1); topicSlugSchema reserved-word guard; sitemap pyq entries + the pre-existing sitemap-check crash fixed (11/11 now).
- **Console**: the PYQ section (question:manage) — stats, filters, create (kind toggle + question/QnA picker + exam/year/paper/Q-no), sitting-details edit, two-step delete, audited under PYQ_PROVENANCE.

## Verified
API E2E (guards, dup 409, fallback, zero correctAnswer leakage) · browser E2E (badges, reveal, console create→edit→delete round-trip with state restored). Known UX note: the create dialog's target picker requires clicking a search-result option (submit with an unpicked target correctly does nothing).
