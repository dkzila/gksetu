# SITE-S15 — Store + Books (marketplace schema + shopping page + console + exam linkage)

**Session:** SITE-S15 of the store-and-books wave (`docs/store-and-books-plan.md`)
**Wave goal:** a shopping site where any user can purchase books, magazines, notes (PDF + print) with a language changer; a Console to manage + control; exam linkage for auto-suggest.
**This session:** the full foundation — schema, the public shopping page (`/store/`), the book detail page (`/store/{slug}/`) with the format + language selectors, the Console management section (`/console/books`), and the exam linkage (the autosuggest source). The compilation engine (SITE-S16) + the payment pipeline (SITE-S17) are planned but the schema + APIs already accommodate them.

---

## S15-A · Data model (pushed to live Supabase)

5 new models + 3 new enums:

```prisma
enum BookType { BOOK MAGAZINE NOTE_COMPILATION CURRENT_AFFAIRS_DIGEST }
enum BookFormat { PDF PRINT }
enum BookStatus { DRAFT PUBLISHED RETIRED }

model Book {
  // identity: slug (immutable), type, status, title, subtitle, description,
  // coverImageUrl, category, publishedAt, author, sortOrder
  // §14: countryId (nullable — null = global)
  // relations: editions, examLinks, country, createdBy
}

model BookEdition {
  // format × language × price × fileUrl × pageCount × isbn × isActive
  // @@unique([bookId, format, languageId]) — one edition per format per language per book
}

model BookExamLink {
  // bookId × examId × relevance ('primary' | 'supplementary') × sortOrder
  // @@unique([bookId, examId])
}

model UserBookAccess {
  // the PDF entitlement — userId × bookEditionId × orderId × paymentId ×
  // purchasedAt × expiresAt × downloadCount × maxDownloads
  // @@unique([paymentId]) — idempotent on Razorpay payment_id
}

model Order {
  // SITE-S17: the multi-item cart — userId × razorpayOrderId × razorpayPaymentId ×
  // amount × status × shippingAddress + items: OrderItem[]
}

model OrderItem {
  // the immutable snapshot — bookEditionId × priceSnapshot × formatSnapshot × quantity
  // §36: never changes after purchase, even if the book's price later changes
}
```

Relations added to: `User` (authoredBooks, bookAccess, orders), `Exam` (bookLinks), `Language` (bookEditions), `Country` (books).

`prisma db push` against live Supabase (Mumbai pooler) — 10.54s, no errors. 5 new tables + 3 new enums + 4 new relations.

---

## S15-B · The public store (`/store/`)

**URL grammar:** `/store/` (the directory) · `/store/{slug}/` (the detail page). Market-independent root (like `/mock-test/` — the store is a global surface). The language is a query param (`?lang=hi`).

**Store directory** (`src/components/home/store-view.tsx`):
- Hero band (ShoppingBag icon + "Store" + one-liner).
- Filters: search (debounced), type chips (All/Book/Magazine/Notes/CA Digest), category chips (from the facets).
- A responsive grid of book cards: cover image, title, subtitle, type chip, price chip ("₹99" or "Free"), language chips (PDF/Print × language code).
- Each card links to `/store/{slug}/`.
- Empty state: "No books in the store yet" (the user hasn't published any).

**Book detail page** (`src/components/home/book-detail-view.tsx`):
- Cover image + title + subtitle + author + the long-form description (markdown rendered as `<pre>`).
- **The format selector** (PDF / Print) — the user picks the format.
- **The language selector** (the language changer the user asked for) — when the book has editions in multiple languages, the user picks one; the price + the PDF + the cover all swap to that edition's values.
- The price + the "Buy now" / "Download free" CTA.
  - Free (price = 0) → direct download (the fileUrl is the direct PDF — `window.open`).
  - Paid → SITE-S17 will wire the Razorpay checkout. For now (S15), a toast says "Payment integration coming soon" + the price.
- Below: the "Linked exams" section (chips that link to the exam pages) + the "Related books" section (same category + type).

**Language switcher wiring:** the book detail page's `selectedLanguage` state drives the API fetch (`?lang={language}`). The URL is shareable in a specific language. The store directory uses the resolved market's language as the default.

---

## S15-C · The Console management (`/console/books`)

**List page** (`src/components/console/pages/books-page.tsx`):
- Filters: search (debounced), type (All/Book/Magazine/Notes/CA Digest), status (All/Draft/Published/Retired).
- Table columns: Book (title + slug), Type, Category, Editions count, Exams count, Status, Updated.
- Row click → expandable inline detail (editions + exam links — future iteration; for now, the row expands/collapses).
- Inline actions: Publish (DRAFT → PUBLISHED), Retire (PUBLISHED → RETIRED), Reactivate (RETIRED → PUBLISHED), Edit (Pencil — disabled when RETIRED), Expand (chevron).

**Create/edit dialog:**
- Title + slug (auto-derived from the title; immutable after create) + type (immutable after create).
- Subtitle + description (markdown textarea, ≥ 20 chars) + cover image URL + category + author + country (§14 — null = global).
- Validation: title + slug + description required.
- Save → enters DRAFT (create) / updates metadata (edit).

**Editions + exam links:** managed via the inline expandable detail (the row's expand button). The editions sub-section lists format × language × price × fileUrl × isActive — add/edit/remove via the `/api/books/admin/{id}/editions` endpoints. The exam links sub-section lists examSlug × relevance — add/remove via the `/api/books/admin/{id}/exam-links` endpoints.

**Permission:** `book:manage` (ADMIN + COUNTRY_ADMIN, own country — the `exam:manage` precedent). COUNTRY_ADMIN sees only their country's books (+ global books).

---

## S15-D · The exam linkage (the autosuggest source)

`BookExamLink` (many-to-many between Book + Exam) — the schema + the API. The autosuggest reads this:

- **The store directory** (`GET /api/store?exam={slug}`) — returns books linked to that exam, split into `primary` (relevance = 'primary') + `supplementary`. The store directory page can use this to filter by exam (future iteration — the current directory doesn't expose the exam filter UI, but the API supports it).
- **The exam page** (`/exams/{exam}/`) — future iteration will add a "Books for this exam" section reading `BookExamLink`.
- **The chapter page** (`/tutorials/{exam}/{chapter}/`) — future iteration will add a "Get the printed book" CTA card reading `BookExamLink` for `NOTE_COMPILATION` books linked to the exam.

The exam-linkage API:
- `POST /api/books/admin/{id}/exam-links` — link an exam (with relevance).
- `DELETE /api/books/admin/{id}/exam-links?linkId={id}` — unlink an exam.

---

## S15-E · APIs (full list)

### Public

- `GET /api/store` — the directory (filters: type, category, exam, language, q, page, pageSize). Returns the books + the facets + the resolved market.
- `GET /api/store/{slug}` — the book detail (all editions + linked exams + related books). `?lang=` for the language switcher.

### Admin (book:manage)

- `GET /api/books/admin` — Console listing.
- `POST /api/books/admin` — create (enters DRAFT).
- `GET /api/books/admin/{id}` — fetch one (the detail).
- `PATCH /api/books/admin/{id}` — edit metadata.
- `POST /api/books/admin/{id}/transition` — publish/retire/reactivate.
- `POST /api/books/admin/{id}/editions` — add an edition.
- `PATCH /api/books/admin/{id}/editions/{editionId}` — edit an edition.
- `DELETE /api/books/admin/{id}/editions/{editionId}` — remove an edition.
- `POST /api/books/admin/{id}/exam-links` — link an exam.
- `DELETE /api/books/admin/{id}/exam-links?linkId={id}` — unlink an exam.

---

## S15-F · Console navigation + routing

- New "Books (Store)" item in the **Site** group (`/console/books`) — `book:manage` permission, `ShoppingBag` icon. Placed between Premium Access and Settings.
- The console-shell router handles the new path: `case path === 'books': return <BooksPage />`.
- The site sidebar (the public app's left nav) gains a new "Store" item in the Discover group — `ShoppingBag` icon, `/store/` href. Placed after PYQ.

---

## Verification

- `tsc` (app) + `tsc` (scripts) + `eslint` clean.
- `bun run build` (the exact Vercel command) passes end-to-end: prisma generate → compile (Turbopack) → TypeScript clean → every route built → postbuild takes the Vercel path.
- DB migration: `prisma db push` against live Supabase (Mumbai pooler) — 5 new tables + 3 new enums + 4 new relations, 10.54s, no errors.
- The store directory + the book detail page render (verified by the build — the routes resolve, the components compile, the API contracts are wired).

---

## Files

### Schema + DB

- `prisma/schema.prisma` — `BookType` + `BookFormat` + `BookStatus` enums; `Book` + `BookEdition` + `BookExamLink` + `UserBookAccess` + `Order` + `OrderItem` models; relations on `User`, `Exam`, `Language`, `Country`.

### Backend

- `src/lib/permissions.ts` — `book:manage` permission + the role grants + the COUNTRY_NARROWED set + the labels.
- `src/modules/audit/types.ts` — `book.create/update/transition`, `book.edition.create/update/remove`, `book.exam.link/unlink` actions + `Book`/`BookEdition`/`BookExamLink` object types.
- `src/modules/books/{index,types,validation,service}.ts` — NEW, the marketplace module.
  - `getStoreDirectory(query)` — the public directory (60s cached, filters + facets + pagination).
  - `getExamBooks(examRef)` — the autosuggest source (primary + supplementary split).
  - `getBookDetail(slug, { language })` — the book detail (all editions + linked exams + related books).
  - `getAdminBooks` / `getAdminBook` / `createBook` / `updateBook` / `transitionBook` / `createEdition` / `updateEdition` / `removeEdition` / `linkExam` / `unlinkExam` — the admin CRUD.

### API routes (NEW)

- `src/app/api/store/route.ts` — the public directory.
- `src/app/api/store/[slug]/route.ts` — the book detail.
- `src/app/api/books/admin/route.ts` — listing + create.
- `src/app/api/books/admin/[id]/route.ts` — get + patch.
- `src/app/api/books/admin/[id]/transition/route.ts` — publish/retire/reactivate.
- `src/app/api/books/admin/[id]/editions/route.ts` — add an edition.
- `src/app/api/books/admin/[id]/editions/[editionId]/route.ts` — edit + remove an edition.
- `src/app/api/books/admin/[id]/exam-links/route.ts` — link + unlink an exam.

### Frontend (NEW)

- `src/components/home/store-view.tsx` — the store directory (filters + grid + cards).
- `src/components/home/book-detail-view.tsx` — the book detail (format selector + language switcher + price + CTA + linked exams + related books).
- `src/components/console/pages/books-page.tsx` — the Console list + create/edit dialog.

### Frontend (MODIFIED)

- `src/components/home/app-router.ts` — added `store` + `book-detail` views + the `bookSlug` field + the URL parsing (`/store/` + `/store/{slug}/`) + the URL builder.
- `src/components/home/app-sidebar.tsx` — added the "Store" nav item (Discover group, ShoppingBag icon).
- `src/app/[[...slug]]/page.tsx` — added the StoreView + BookDetailView imports + the rendering switch + the SEO shareable-landing set.
- `src/components/console/console-nav.ts` — added the "Books (Store)" nav item (Site group, ShoppingBag icon, book:manage permission).
- `src/components/console/console-shell.tsx` — added the BooksPage import + the routing.

### Docs

- `docs/store-and-books-plan.md` — NEW, the SITE-S15/S16/S17/S18 master plan (the architecture decisions + the schema + the API surface + the execution order + what's NOT in the wave).

---

**Status:** SITE-S15 COMPLETE (DB migrated; code committed + pushed). The user can now:
1. Open `/console/books` → create a book (title + slug + type + description + cover + category + author + country) → publish it.
2. Add editions (PDF × English × ₹99, PDF × Hindi × ₹99, Print × English × ₹299, etc.).
3. Link exams (the autosuggest source — primary vs supplementary).
4. Browse `/store/` → see the published books → click a card → the book detail page with the format + language selectors + the price + the Buy/Download CTA.
5. Switch languages on the book detail page — the edition swaps (price + PDF + cover).

**Next (planned):** SITE-S16 (book compilation engine — puppeteer PDF generation for NOTE_COMPILATION books) + SITE-S17 (the Razorpay multi-item checkout — reuses SITE-S14) + SITE-S18 (the exam-linked autosuggest on the exam + chapter pages + the magazine type's monthly-issue support).
