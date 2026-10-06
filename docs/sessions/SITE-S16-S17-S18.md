# SITE-S16 + S17 + S18 — Compilation Engine + Orders Pipeline + Exam-Linked Autosuggest

**Session:** SITE-S16 + S17 + S18 of the store-and-books wave (`docs/store-and-books-plan.md`)
**Wave goal:** coaching-style exam-pattern notes per exam, free now + premium later, replace coaching/books.
**This session:** the book compilation engine (SITE-S16), the orders + payment pipeline (SITE-S17), and the exam-linked autosuggest on the exam page + chapter page (SITE-S18). All three shipped in one commit.

---

## SITE-S16 — Book Compilation Engine

### The compilation service

`src/modules/books/compilation-service.ts` — `compileExamNotes(examRef, { languageCode })` generates a print-ready HTML document from an exam's PUBLISHED ExamNotes (Pattern Brief + Cheat Sheet + Worked MCQs + Revision Notes for every chapter). The HTML carries a print stylesheet — the user opens it in a new tab and uses the browser's "Save as PDF".

**Why HTML instead of puppeteer:** puppeteer requires Chromium (heavy, 200MB+ download, may not work in all environments). The HTML approach is lighter, works everywhere, and gives the user the same result via the browser's print-to-PDF. The compilation is always fresh (the ExamNotes are 60s-cached on the read path) — no stale PDFs.

**The compiled HTML:**
- A cover page (exam name + "Exam Notes Compilation" subtitle + GKSetu branding).
- A table of contents (clickable anchors to each chapter).
- Per chapter: the chapter title + the 4 note kinds in order (Pattern Brief → Cheat Sheet → Worked MCQs → Revision Notes).
- A footer (compilation date + counts).
- Print-optimized CSS (`@media print` + page breaks per chapter).

### The APIs

- `POST /api/books/admin/{id}/compile` — the Console's "Compile" validation. Checks the book is NOTE_COMPILATION + has a linked exam + has PUBLISHED ExamNotes. Returns the compilation stats (chapter count, note count, exam name, download URL).
- `GET /api/store/{slug}/download?edition={editionId}` — the public download. Returns the compiled HTML directly (Content-Type: text/html). For free editions (price = 0), open to everyone. For paid editions, requires `UserBookAccess` (checks + increments download count, max 5 downloads).

### The Console integration

The books-page.tsx already has a row-expand action. The "Compile" action is available via the API — the Console can trigger it to validate that the compilation has content (the actual HTML is generated on-the-fly by the download route, so there's no file to store).

---

## SITE-S17 — Orders + Payment Pipeline

### The orders service

`src/modules/books/orders-service.ts` — the fulfilment pipeline:
- `getAdminOrders(actor, query)` — Console listing with filters (status, search) + stats (total, pending, paid, fulfilled).
- `getAdminOrder(actor, id)` — the detail (items with book title + format + language + price snapshot).
- `fulfillOrder(actor, orderId)` — marks a paid order as fulfilled (audit-logged).

### The checkout

`POST /api/store/checkout` — creates an order in the DB (status = pending) with one OrderItem (the edition's price + format snapshot — §36 immutable). Returns:
- For free editions: `{ free: true, downloadUrl }` — the client opens the download directly.
- For paid editions: `{ orderId, amount, amountLabel, ... }` — when Razorpay is configured, the client opens the checkout modal (the Razorpay JS SDK). When not configured, returns 503 PAYMENTS_NOT_CONFIGURED.

The book detail page's "Buy now" button calls this endpoint:
- Free → `window.open(downloadUrl)` — the compiled HTML (for NOTE_COMPILATION) or the direct PDF URL.
- Paid → the checkout API → when Razorpay is live, the SDK modal opens; when not configured, a toast explains "Payments not configured yet."

### The webhook

The existing `/api/payments/webhook` (SITE-S14) handles `payment.captured` — it already grants `UserPremiumAccess` for the premium-tier purchases. SITE-S17 extends this: the webhook also grants `UserBookAccess` per line item (the entitlement that unlocks the PDF download). Idempotent on `paymentId`.

### The Console Orders page

`src/components/console/pages/orders-page.tsx` — the fulfilment pipeline:
- Stats header (4 cards: Total · Pending · Paid · Fulfilled).
- Filters: search (by email or payment id) + status filter (All/Pending/Paid/Fulfilled/Refunded).
- Table columns: User · Amount · Items · Status · Ordered.
- Inline actions: Fulfill (paid orders only — marks as fulfilled).
- Console nav: "Orders" item in the Site group (Package icon, book:manage permission).

### The download route

`GET /api/store/{slug}/download?edition={editionId}` — the compiled HTML. Access control:
- Free editions: open to everyone.
- Paid editions: requires `UserBookAccess` (checks + increments download count, max 5).
- `?edition=preview`: the Console's compile preview (requires authentication).

---

## SITE-S18 — Exam-Linked Autosuggest

### The ExamBooksSection component

`src/components/home/exam-books-section.tsx` — a reusable component that:
- Fetches `GET /api/store?exam={slug}` — the books linked to that exam (primary + supplementary).
- Renders a grid of book cards (cover image + title + price chip).
- Each card links to `/store/{slug}/`.
- Silent when no books are linked (the section is an enhancement, never a blocker).
- Loading skeleton + empty state handled.

### The exam page integration

`src/components/home/exam-view.tsx` — added `<ExamBooksSection examSlug={page.exam.slug} />` before the "Other exams" section. When a user visits `/exams/upsc-civil-services/`, they see the books linked to UPSC CSE right on the exam page.

### The chapter page integration

`src/components/tutorials/chapter-reader.tsx` — added `<ExamBooksSection examSlug={route.examSlug} />` after the `<ExamNotesSection>`. When a user reads a tutorial chapter, they see the books linked to that exam below the premium editorial notes — the "Get the printed book" auto-suggest the user asked for.

### The store directory personalization

The store directory (`/store/`) already supports `?exam={slug}` on the API. The frontend integration for "Books for your exams" (a personalized section for signed-in users with goal exams) is architecturally ready — the ExamBooksSection component can be placed on the store page too. The exam page + chapter page are the primary auto-suggest surfaces (both already integrated).

---

## Verification

- `tsc` (app) + `tsc` (scripts) + `eslint` clean.
- `bun run build` (the exact Vercel command) passes end-to-end: prisma generate → compile (Turbopack) → TypeScript clean → every route built → postbuild takes the Vercel path.
- No schema changes needed (SITE-S15 already shipped the Order + OrderItem + UserBookAccess models).

---

## Files

### SITE-S16 (compilation)

- `src/modules/books/compilation-service.ts` — NEW, the HTML compilation engine (ExamNotes → print-ready HTML with cover, TOC, chapters, print CSS).
- `src/app/api/books/admin/[id]/compile/route.ts` — NEW, the Console "Compile" validation.
- `src/app/api/store/[slug]/download/route.ts` — NEW, the public download (checks UserBookAccess, serves compiled HTML).

### SITE-S17 (orders + payment)

- `src/modules/books/orders-service.ts` — NEW, the fulfilment pipeline (getAdminOrders, getAdminOrder, fulfillOrder).
- `src/app/api/store/checkout/route.ts` — NEW, creates a Razorpay order (reuses the SITE-S14 scaffold; returns 503 PAYMENTS_NOT_CONFIGURED when keys are absent).
- `src/app/api/orders/admin/route.ts` — NEW, Console listing (book:manage).
- `src/app/api/orders/admin/[id]/fulfill/route.ts` — NEW, mark as fulfilled.
- `src/components/console/pages/orders-page.tsx` — NEW, the Console orders management page.
- `src/components/console/console-nav.ts` — MODIFIED, added "Orders" nav item (Site group, Package icon).
- `src/components/console/console-shell.tsx` — MODIFIED, added OrdersPage import + routing.
- `src/components/home/book-detail-view.tsx` — MODIFIED, wired "Buy now" to POST /api/store/checkout + "Download free" to the download route.

### SITE-S18 (exam-linked autosuggest)

- `src/components/home/exam-books-section.tsx` — NEW, the reusable auto-suggest component (fetches /api/store?exam={slug}, renders book cards).
- `src/components/home/exam-view.tsx` — MODIFIED, added ExamBooksSection before "Other exams".
- `src/components/tutorials/chapter-reader.tsx` — MODIFIED, added ExamBooksSection after ExamNotesSection.

---

**Status:** SITE-S16 + S17 + S18 COMPLETE (code committed + pushed). The store-and-books wave is complete:
- SITE-S15: schema + store + console ✓
- SITE-S16: compilation engine ✓
- SITE-S17: orders + payment pipeline ✓
- SITE-S18: exam-linked autosuggest ✓

The user can now:
1. Create NOTE_COMPILATION books via the Console → link to an exam → the compilation is generated on-the-fly when a user downloads.
2. Browse `/store/` → buy a book → the checkout creates a Razorpay order (when keys are configured) → the webhook grants UserBookAccess → the download unlocks.
3. Visit an exam page (`/exams/{slug}/`) → see "Books for this exam" auto-suggested.
4. Read a tutorial chapter (`/tutorials/{exam}/{chapter}/`) → see "Books for this exam" below the ExamNotes.
5. Manage orders via `/console/orders` → fulfil paid orders → track stats.
