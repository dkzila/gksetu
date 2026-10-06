# The Store + Books Wave — Marketplace, Compilation, Exam-Linked Upsell

**Status:** SITE-S15 planned (kickoff this wave). S16, S17, S18 follow.
**Sessions:** SITE-S15 (book schema + store + console) → SITE-S16 (compilation engine) → SITE-S17 (purchases + orders) → SITE-S18 (exam-linked autosuggest + magazine type).
**Governing principle (unchanged):** unified systems only — every new feature rides the existing spine (taxonomy, exams, ExamNotes, premium access, country-locale, console toolkit). No parallel content systems, no second payment engine (reuses SITE-S14 Razorpay), no second permission layer (reuses the existing `note:manage` / `premium:manage` style).

**The user's three asks (this wave's inputs):**
1. **A shopping site** — a dedicated public page where any user can purchase books, magazines, notes (PDF + print versions) with a language changer (so a book available in another language is switchable from the same page).
2. **Console management + control** — create/edit/delete books + magazines + notes listings, attach PDFs + cover images, set prices + editions + languages, link exams (so the autosuggest fires).
3. **Exam linkage + autosuggest** — when a user is on an exam's chapter page (or browsing exam tutorials), the store surfaces the books/magazines/notes that match that exam — auto-suggested, no manual surfacing per page.

---

## Architecture decisions (held for the wave)

### A. ONE `Book` model, MANY `BookEdition` rows

A single `Book` row carries the identity (slug, title, description, type, cover image, category). Multiple `BookEdition` rows carry the per-language + per-format variants — same book, different language (Hindi/English) or different format (PDF vs Print) or different price.

**Why one book with editions (not many books):**
- The user's "language changer on the same page" requires this — the user is on one book's page, picks a different language, the page swaps to that edition (same book, different edition's PDF/price).
- Amazon's pattern (the user's mental model): one product page, format + language selectors.
- SEO: one canonical URL per book (`/store/{book-slug}/`), with the language as a query param (`?lang=hi`) or a path segment under the same canonical. No duplicate-content penalty.

### B. The book type: `BOOK` / `MAGAZINE` / `NOTE_COMPILATION` / `CURRENT_AFFAIRS_DIGEST`

Four content types share the same `Book` model + the same shopping page + the same console. The user mentioned "books, magazines, notes" — the `NOTE_COMPILATION` is the SITE-S15 book-compilation use case (a printed/PDF compilation of an exam's ExamNotes); `CURRENT_AFFAIRS_DIGEST` is the monthly CA magazine use case (a future lever — not built in this wave, but the schema accommodates it).

### C. The exam linkage: `BookExamLink` (many-to-many)

A book can be linked to 0-N exams. The autosuggest on the chapter page reads this — when the user is on `/tutorials/upsc-civil-services/{chapter}/`, the store surfaces books linked to `upsc-civil-services`. The same linkage drives the "Books for this exam" section on the exam page (`/exams/upsc-civil-services/`).

### D. Payment reuses SITE-S14 (Razorpay)

The checkout flow is the same Razorpay scaffold. A new `Order` model carries the line items (book + edition + format + price) + the Razorpay order/payment ids. The webhook grants a `UserBookAccess` row (the entitlement that unlocks the PDF download + ships the print version).

### E. The "free for now" lever reuses the gating pattern

Like the ExamNotes gating, books can be free or paid. A book's `price` is 0 = free (the PDF is downloadable by anyone); non-zero = paid (the PDF is gated + the print version is shipped on payment). The `premiumGatingEnabled` site-setting flag is NOT used here (books have their own per-book price); the user can set any book's price to 0 to make it free.

---

## SITE-S15 — Book schema + store + console (the foundation)

### S15-A · Data model

```prisma
enum BookType {
  BOOK                 // a full-length book (e.g. "Indian Polity by Laxmikanth — the GKSetu edition")
  MAGAZINE             // a periodic issue (e.g. "GKSetu Monthly — October 2026")
  NOTE_COMPILATION    // a compiled set of ExamNotes (e.g. "UPSC CSE Polity — all chapters' notes")
  CURRENT_AFFAIRS_DIGEST  // a monthly CA compilation (future — schema accommodates)
}

enum BookFormat {
  PDF     // digital download
  PRINT   // physical shipped
}

enum BookStatus {
  DRAFT
  PUBLISHED
  RETIRED  // end-of-life, no longer purchasable but historical orders preserved
}

model Book {
  id           String     @id @default(cuid())
  slug         String     @unique // URL-stable, lowercase kebab
  type         BookType   @default(BOOK)
  status       BookStatus @default(DRAFT)
  // The canonical (English) title — used for SEO + the canonical URL.
  title        String
  // A short tagline (the card subtitle).
  subtitle     String?
  description  String     @db.Text  // the long-form marketing copy (markdown)
  // Cover image — a public URL (the user uploads via the Console; stored on Supabase Storage).
  coverImageUrl String?
  // The category — for the store's filter chips (Polity, History, CA, Quant, etc.).
  category     String?
  // The publication date — for magazines + digests (the issue month).
  publishedAt  DateTime?
  // Author / publisher — free-text (e.g. "GKSetu Editorial Board").
  author       String?
  // Sort order — for the Console's manual ordering of featured books.
  sortOrder    Int        @default(0)
  // §14: the home-market country (a book belongs to one country — for §14 scoping; magazines can be country-specific).
  countryId    String?
  // Audit.
  createdById  String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  editions     BookEdition[]
  examLinks    BookExamLink[]
  country      Country?   @relation("BookCountry", fields: [countryId], references: [id], onDelete: SetNull)
  createdBy    User?      @relation("BookAuthor", fields: [createdById], references: [id], onDelete: SetNull)

  @@index([status, type])
  @@index([countryId, status])
  @@index([category])
}

model BookEdition {
  id          String     @id @default(cuid())
  bookId      String
  // The format (PDF vs Print).
  format      BookFormat
  // The language of this edition (links to the Language table — §35).
  languageId  String
  // The price in paise (₹99 = 9900). 0 = free.
  price       Int        @default(0)
  // For PDF: the file URL (Supabase Storage). For PRINT: the print-on-demand SKU / weight.
  fileUrl     String?
  // The page count (for the metadata + the print shipping cost calc).
  pageCount   Int?
  // The ISBN (for print editions — optional).
  isbn        String?
  // Whether this edition is currently purchasable (a published book can have a "PDF available, print coming soon" state).
  isActive    Boolean    @default(true)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  book        Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  language    Language   @relation("BookEditionLanguage", fields: [languageId], references: [id])

  @@unique([bookId, format, languageId])  // one edition per format per language per book
  @@index([bookId])
  @@index([languageId])
}

// The exam linkage — many-to-many between Book + Exam.
model BookExamLink {
  id        String   @id @default(cuid())
  bookId    String
  examId    String
  // The relevance — "primary" (the book is THE book for this exam) vs "supplementary" (relevant but not the main resource).
  relevance String   @default("supplementary")  // "primary" | "supplementary"
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())

  book      Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  exam      Exam     @relation("BookExamLinkExam", fields: [examId], references: [id], onDelete: Cascade)

  @@unique([bookId, examId])
  @@index([examId])
}

// The entitlement that unlocks a purchased book's PDF (the print version ships separately).
// Reuses the UserPremiumAccess pattern — idempotent on Razorpay payment_id.
model UserBookAccess {
  id            String   @id @default(cuid())
  userId        String
  bookEditionId String
  // SITE-S14: the Razorpay order + payment ids (idempotency on payment_id).
  orderId       String?
  paymentId     String?
  // The purchase date + the download-expiry (null = lifetime for PDF; set for time-limited magazines).
  purchasedAt   DateTime @default(now())
  expiresAt     DateTime?
  // The download count (the user can download the PDF N times — anti-piracy).
  downloadCount Int      @default(0)
  maxDownloads  Int      @default(5)  // 5 downloads by default; configurable per book

  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookEdition   BookEdition  @relation(fields: [bookEditionId], references: [id], onDelete: Cascade)

  @@unique([paymentId])
  @@index([userId])
  @@index([bookEditionId])
}
```

### S15-B · The public store (`/store/`)

- **URL grammar:** `/store/` (the directory) · `/store/{book-slug}/` (the detail page). The language is a query param `?lang=hi` (the user's locale context resolves the default).
- **Store directory** (`store-view.tsx`): the hero band + filter chips (type = All/Book/Magazine/Notes · category = Polity/History/CA/Quant · language = the active language) + a searchable grid of book cards. Each card: cover image, title, subtitle, type chip, price chip ("₹99" or "Free"), language chip.
- **Book detail page** (`book-detail-view.tsx`): cover image + title + subtitle + long description + the format selector (PDF / Print) + the language selector (the language changer the user asked for — picks the edition) + the price + the "Buy now" / "Download free" CTA. Below: the "Linked exams" section (the exams this book is for) + the "Related books" section (same category).
- **Language switcher:** a Select in the book detail page's action row. Picking a different language swaps the edition (the price + the PDF + the cover may all differ). The `?lang=` query updates so the URL is shareable.

### S15-C · The Console management (`/console/books`)

- **List page** (`books-page.tsx`): filters (type, status, category, language) + table (title, type, category, editions count, status, updated). Row click → detail page.
- **Create/edit dialog**: title + subtitle + description (markdown) + type + category + cover image URL + country + author + status. Save → enters DRAFT.
- **Editions sub-section** (on the detail page): list of editions (format × language × price × file URL × active). Add/edit/remove.
- **Exam links sub-section**: search an exam → link it (primary / supplementary). The autosuggest reads this.
- **Transition**: DRAFT → PUBLISHED → RETIRED.

### S15-D · The exam-page integration

The exam page (`/exams/{exam}/`) gains a "Books for this exam" section — reads `BookExamLink` for the exam, renders the linked books as cards (with the "primary" badge for primary links). Clicking a card → the book detail page.

### S15-E · The chapter-page integration

The tutorial chapter page (`/tutorials/{exam}/{chapter}/`) — the existing ExamNotes section already renders there (SITE-S13). Below it: a "Get the printed book" CTA card (links to the book detail page for the exam's linked NOTE_COMPILATION books).

---

## SITE-S16 — Book Compilation Engine (PDF generation)

### S16-A · The compilation service

A `BookCompilationService` (`src/modules/books/compilation-service.ts`) that, given an examId + a kind (NOTE_COMPILATION), generates a print-ready PDF from the exam's PUBLISHED ExamNotes + the underlying tutorial chapter content. Uses **puppeteer** (renders the existing HTML/CSS — the book looks like the website; the user's mental model).

- Input: `{ examId, languageId, kind: 'NOTE_COMPILATION' }`
- Output: a signed download URL (Supabase Storage) + the page count (for the print shipping cost).
- The compilation runs as a background job (the `BookEdition.fileUrl` is null until the compilation finishes; the Console shows the progress).
- The compiled PDF is cached — re-compilation only happens when an ExamNote is published/updated (a `compilationStaleAt` timestamp on the `BookEdition`).

### S16-B · The Console "Compile" action

On the book detail page (for `NOTE_COMPILATION` type), a "Compile PDF" button triggers the compilation. The button is disabled while a compilation is in progress; the result is a fresh `fileUrl` on the edition.

---

## SITE-S17 — Purchases + Orders (the payment pipeline)

### S17-A · The Order model

```prisma
model Order {
  id              String   @id @default(cuid())
  userId          String
  // The Razorpay order id + payment id (idempotency).
  razorpayOrderId String?
  razorpayPaymentId String?  @unique
  // The total amount in paise.
  amount          Int
  currency        String   @default("INR")
  // The order status (pending → paid → fulfilled → refunded).
  status          String   @default("pending")  // pending | paid | fulfilled | refunded
  // The shipping address (for PRINT orders).
  shippingAddress Json?
  // Audit.
  createdAt       DateTime @default(now())
  paidAt          DateTime?
  fulfilledAt     DateTime?

  items           OrderItem[]
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
}

model OrderItem {
  id            String   @id @default(cuid())
  orderId       String
  bookEditionId String
  // The price snapshot (the price at the time of purchase — never changes after).
  priceSnapshot Int
  // The format snapshot (PDF/PRINT — for the fulfilment pipeline).
  formatSnapshot String
  quantity      Int      @default(1)

  order          Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  bookEdition    BookEdition  @relation(fields: [bookEditionId], references: [id], onDelete: Restrict)

  @@index([orderId])
}
```

### S17-B · The checkout

The store's "Buy now" button → POST /api/store/checkout → creates a Razorpay order (multi-item — the cart) → the Razorpay modal → the webhook grants `UserBookAccess` per line item (idempotent on `paymentId`).

For PRINT orders: the fulfilment pipeline is manual in v1 (the Console's `/console/orders` shows the paid PRINT orders + the shipping address; the operator ships + marks "fulfilled").

---

## SITE-S18 — Exam-Linked Autosuggest + Magazine Type

### S18-A · The autosuggest

The chapter page (`/tutorials/{exam}/{chapter}/`) — the existing ExamNotes section + the "Get the printed book" CTA (SITE-S15-E) — surfaces the linked books automatically. No per-page configuration needed.

The exam page (`/exams/{exam}/`) — the "Books for this exam" section (SITE-S15-D) does the same.

The store directory (`/store/`) — when the user is signed in + has goal exams, the "Books for your exams" section surfaces the user's goal-exam-linked books first (the personalisation precedent).

### S18-B · Magazine type — monthly issues

The `MAGAZINE` type + the `publishedAt` field (the issue month). The store directory has a "Magazines" filter chip; the magazine detail page shows the issue month + the "Subscribe" CTA (a future lever — subscription is OUT OF SCOPE for this wave; one-time purchase only).

### S18-C · Current Affairs Digest

The `CURRENT_AFFAIRS_DIGEST` type — a monthly CA compilation (the platform's own current-affairs feed + the events of the month). Compiled via the SITE-S16 engine (puppeteer) — a different content source but the same compilation pipeline. OUT OF SCOPE for this wave's compilation engine (the NOTE_COMPILATION is the v1 use case); the schema accommodates it.

---

## Execution order & dependency notes

- **S15 is the foundation** — schema + store + console. No payment dependency.
- **S16 builds on S15** — the compilation engine generates the `BookEdition.fileUrl` for NOTE_COMPILATION books.
- **S17 builds on S15 + reuses SITE-S14** — the Razorpay scaffold already exists; S17 wires the multi-item checkout.
- **S18 builds on S15** — the autosuggest reads the BookExamLink; the magazine type is a schema-only addition in S15 (the store + console already handle it).

---

## What is NOT in this wave

- A shopping cart (multi-item before checkout) — the v1 checkout is single-item (one book → one Razorpay order). The Order model supports multi-item for the future, but the UI is single-item.
- A subscription model (monthly magazine subscription) — one-time purchase only in v1.
- A fulfilment integration (Shiprocket/Delhivery) — manual fulfilment via the Console in v1.
- Print-on-demand integration (Amazon KDP) — the user uploads the print PDF manually; the Console's "Compile PDF" generates it.
- Affiliate/referral commissions — out of scope.

---

## The pipeline state after this wave

- The user can author books/magazines/notes via the Console (`/console/books`).
- The user can attach PDFs + cover images + prices + editions + languages.
- The user can link books to exams (the autosuggest fires on the exam + chapter pages).
- Any user can browse `/store/`, pick a book, pick a format + language, and "Buy now" (when Razorpay is configured) or "Download free" (when the price is 0).
- The "free for now" lever is per-book (price = 0); the user can flip any book to paid whenever they're ready (no global gating switch needed for books — the per-book price is the lever).
