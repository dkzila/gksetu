# SITE-S15 — Book Compilation + Upsell (planned, not yet built)

**Session:** SITE-S15 of the premium-learning wave (`docs/premium-learning-plan.md`)
**Status:** planned — the architecture is documented in `docs/premium-learning-plan.md` (SITE-S15 section). Implementation deferred until the ExamNotes corpus is meaningfully authored (target: 5+ exams × all 4 kinds = 20+ notes per exam).

---

## What it will be

### S15-A · PDF compilation

A `BookCompilationService` (`src/modules/books/`) — given an examId (or a set of exams), generates a print-ready PDF from the published ExamNotes + the underlying tutorial chapters. Two rendering paths considered:

1. **puppeteer** (heavier — bundles Chromium) — renders the existing HTML/CSS, so the book looks like the website. Recommended for v1.
2. **pdfkit** (lighter, pure-JS) — manual layout. More work, smaller bundle.

The PDF carries the GKSetu branding + the exam name + a per-chapter table of contents. Used by:
- The Console (an editor can download a PDF of any exam's notes for review).
- entitled users (a one-click "Download as PDF" button on the chapter page).

### S15-B · Upsell

On every premium ExamNote card, a secondary CTA: "Get this as a printed book →" → opens a modal explaining the book option + an Amazon KDP link (or a self-fulfillment checkout — TBD).

### S15-C · Physical book selling (Phase 2 — out of this wave's scope)

- Amazon KDP integration (self-publishing — zero inventory).
- OR self-fulfillment via Shiprocket/Delhivery (the user prints on demand).
- This is a separate revenue stream — the digital premium tier is the primary product; books are the upsell.

---

## Why deferred

The book compilation only makes sense once the ExamNotes corpus has enough published content to fill a book. Targeting ~20 notes per exam (5 chapters × 4 kinds) = ~20-30 pages per exam book. The SITE-S13 schema + the SITE-S14 payment pipeline are ready; the SITE-S15 compilation is the LAST mile — a pure rendering concern with no schema/payment dependencies.

When the user is ready to ship books, the SITE-S15 implementation is a ~1-day module: the puppeteer render + the Console "Download PDF" button + the chapter-page "Get as printed book" CTA.

---

**Status:** SITE-S15 PLANNED — schema + payment dependencies are satisfied by SITE-S13 + SITE-S14. Implementation deferred until the ExamNotes corpus is meaningfully authored.
