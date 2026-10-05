# The Premium-Learning Wave — Exam Notes, Payment, Books

**Status:** SITE-S13 planned (awaiting kickoff) · SITE-S14 planned · SITE-S15 planned.
**Sessions:** SITE-S13 (exam-notes overlay + premium gating) → SITE-S14 (Razorpay payment integration) → SITE-S15 (book compilation + upsell).
**Governing principle (unchanged):** unified systems only — every fix rides the existing spine. No new content systems, no parallel tutorials. Premium content is an OVERLAY on top of the existing tutorial chapter pages, not a separate surface.

**The three user-reported asks (this wave's inputs):**
1. **Coaching-style notes per exam** — today tutorials are a knowledge projection (the same Mauryan Empire lesson renders for UPSC and SSC; only the syllabus mapping differs). The user wants exam-pattern-specific editorial value: weightage briefs, cheat sheets, worked PYQs with explanations, revision notes. This is the layer that justifies a paid tier.
2. **Free now, premium later** — the user wants the entire pipeline ready so payment can be plugged in whenever they choose to flip the switch. No half-built scaffolds; the gating logic must work end-to-end with a "free for everyone" default that flips to "premium-only" with one config change.
3. **Replace coaching + books** — positioning is "₹99/exam beats ₹5,000 coaching and ₹400 books". Physical book selling is a natural upsell from premium notes (compilation = the book).

---

## The decision (confirmed by the user before this wave)

**Premium content is an OVERLAY on the tutorial chapter page, not a parallel system.**

The base lesson (knowledge-unit projection) stays free and shared — every exam sees the same canonical Mauryan Empire content. The premium editorial layer sits ON TOP of that lesson: 4 exam-specific blocks per chapter that a coaching institute would charge ₹5,000 for.

This is the only sustainable architecture:
- Base lesson: ~1,000 canonical units, written ONCE (already done — P2-S1 through SITE-S3).
- Premium overlay: 138 exams × ~15 chapters × 4 blocks = 8,280 editorial pieces (~200 words each = 1.6M words). AI-assisted drafting + editor review = 1 year of work for 1-2 editors. That is 1/10th the cost of authoring 138 parallel tutorial systems.

---

## SITE-S13 — Exam Notes + Premium Gating (overlay architecture)

### S13-A · Data model + the editorial layer

```prisma
enum ExamNoteKind {
  PATTERN_BRIEF     // exam-specific weightage + question style (~200 words)
  CHEAT_SHEET       // 1-page condensed revision — articles/dates/formulas
  WORKED_MCQ        // real PYQ + step-by-step explanation + trap + pattern alert
  REVISION_NOTES   // chapter-summary mind-map, last-minute tips
}

model ExamNote {
  id           String       @id @default(cuid())
  examId       String       // §14: home-market exam (one note per chapter per kind per exam)
  syllabusNodeId String     // the chapter (P3-S2 SyllabusNode) — links to the tutorial chapter
  kind         ExamNoteKind
  /** The current PUBLISHED revision's body (rich text — markdown-ish). */
  body         String
  status       ExamNoteStatus @default(DRAFT)
  /** §36: revisions are append-only. The published one is current. */
  revisions    ExamNoteRevision[]
  /** §19: authored by a content editor (writers+ for create, editors+ for publish). */
  authoredById String?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime    @updatedAt

  exam          Exam        @relation(fields: [examId], references: [id], onDelete: Cascade)
  syllabusNode  SyllabusNode @relation(fields: [syllabusNodeId], references: [id], onDelete: Cascade)
  authoredBy    User?       @relation("ExamNoteAuthor")
  revisions     ExamNoteRevision[]

  @@unique([examId, syllabusNodeId, kind])  // one note per chapter per kind per exam
  @@index([examId, syllabusNodeId])
  @@index([status])
}

enum ExamNoteStatus { DRAFT PUBLISHED INACTIVE }

model ExamNoteRevision {
  id        String   @id @default(cuid())
  noteId    String
  body      String   // immutable after create (§36)
  /** Who published this revision (audit trail). */
  publishedById String?
  publishedAt DateTime @default(now())
  note       ExamNote @relation(fields: [noteId], references: [id], onDelete: Cascade)
  publishedBy User?    @relation("ExamNoteRevisionPublisher")
  @@index([noteId])
}
```

- The chapter page (`/tutorials/{exam}/{chapter}/`) renders the existing 5 blocks (Lessons → Practice → PYQs → Q&A → Mocks) PLUS 4 new "Exam Notes" blocks (Pattern Brief → Cheat Sheet → Worked MCQs → Revision Notes). The order matters — pattern brief first (sets the context), revision notes last (last-minute recap).
- Revisions are append-only (§36). The published revision's body is denormalised onto `ExamNote.body` for the fast public read (no join needed for the chapter page).
- §19 workflow: DRAFT → PUBLISHED (editor+), PUBLISHED → INACTIVE (editor+), INACTIVE → PUBLISHED (editor+). The note:manage and note:publish permissions are new — see `src/lib/permissions.ts`.

### S13-B · Premium access model

```prisma
/** The premium entitlement for a user. ONE row per active entitlement. */
model UserPremiumAccess {
  id           String   @id @default(cuid())
  userId       String
  /** Scope: SINGLE_EXAM (one examId) or ALL_EXAMS (the annual pass). */
  scope        PremiumScope  @default(SINGLE_EXAM)
  examId       String?  // null when scope = ALL_EXAMS
  /** When the entitlement becomes effective (immediate by default). */
  startsAt     DateTime @default(now())
  /** When the entitlement expires (null = lifetime — for ₹99 single-exam). */
  expiresAt    DateTime?
  /** Source: PURCHASE (paid), REDEEM (coupon), GRANT (admin manual). */
  source       PremiumSource @default(PURCHASE)
  /** Razorpay order id + payment id (SITE-S14 — null until payment is wired). */
  orderId      String?
  paymentId    String?
  /** §36 audit: who granted this, when, why. */
  grantedById  String?
  grantedAt    DateTime @default(now())
  grantedReason String?  // "Razorpay payment #pay_xxx" / "manual admin grant" / "REDEEM: DIWALI50"
  createdAt    DateTime @default(now())

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  exam         Exam?    @relation(fields: [examId], references: [id], onDelete: Cascade)
  grantedBy    User?    @relation("PremiumGrantor")

  @@index([userId])
  @@index([examId])
  @@index([expiresAt])
}

enum PremiumScope { SINGLE_EXAM ALL_EXAMS }
enum PremiumSource { PURCHASE REDEEM GRANT }
```

- The gating helper `canAccessExamNote(user, examId)` returns true when ANY active entitlement covers the exam: `ALL_EXAMS` (annual pass) OR `SINGLE_EXAM` for this `examId` AND within `[startsAt, expiresAt]`.
- **The free-tier switch is one config flag.** `site-settings` carries `premiumGatingEnabled: boolean` (default `false`). When false, ALL ExamNote rows are visible to EVERYONE (including anonymous). When true, only entitled users see PUBLISHED notes above the free preview. This is the user's "free for now, premium later" lever — flip it from the Console without a deploy.

### S13-C · APIs + the chapter page overlay

- `GET /api/exams/{ref}/notes?chapter={nodeId}` — the public chapter-page payload: `{ notes: ExamNoteDTO[] }` where each note's `body` is the full text when the user is entitled (or gating is off), and `bodyPreview` (first 100 chars + a paywall CTA) otherwise.
- `GET /api/exam-notes/admin` — Console listing with exam/chapter/kind/status filters (content:manage gated).
- `POST /api/exam-notes/admin` — create (enters DRAFT).
- `PATCH /api/exam-notes/admin/{id}` — edit body (DRAFT or INACTIVE only — §36 immutable PUBLISHED).
- `POST /api/exam-notes/admin/{id}/transition` — DRAFT → PUBLISHED, PUBLISHED → INACTIVE, INACTIVE → PUBLISHED.
- `GET /api/premium/access` — the caller's entitlement list (Bearer-authenticated).
- `POST /api/premium/admin/grant` — manual grant (ADMIN only — for support/redemption).

### S13-D · Chapter page UI

The existing `chapter-reader.tsx` gains a 6th content block (between PYQs and Mocks): **"Exam Notes"** with 4 sub-cards:

1. **Pattern Brief** — exam-specific weightage, question style, ~200 words. Icon: `Gauge`.
2. **Cheat Sheet** — 1-page condensed revision (articles, dates, formulas). Icon: `FileText`. Print-friendly.
3. **Worked MCQs** — pulls existing PYQ provenance (SITE-S7) + adds the editorial explanation layer. Icon: `PenLine`.
4. **Revision Notes** — chapter-summary mind-map. Icon: `Brain`.

When a note is gated and the user lacks access: locked card with a blurred preview (first 100 chars) + "Unlock for ₹99" CTA → opens the paywall modal (SITE-S14 wires the actual payment).

### S13-E · Console

- New "Exam Notes" section in the ASSESSMENT group (`/console/exam-notes`) — `note:manage` permission. Lists notes with exam/chapter/kind/status filters. Create/edit dialog with markdown-ish editor (textarea + preview — keeps it simple; the existing ai-assist module can draft a starter).
- New "Premium" subsection in the WORKSPACES group (`/console/premium`) — `premium:manage` permission. Lists `UserPremiumAccess` rows + the manual grant dialog + the global `premiumGatingEnabled` toggle (the "free for now" lever).

### S13 QA

API E2E (anonymous sees preview + paywall CTA; entitled user sees full body; gating-off shows everything); Console create → publish → inactive → publish round-trip; chapter page render at 1440+390 with locked + unlocked cards. `tsc` + eslint clean; production build passes.

---

## SITE-S14 — Payment Integration (Razorpay)

**Status:** scaffold only — full integration happens when the user is ready to plug in their Razorpay keys. The schema, routes, and UI are all in place; the webhook signature verification + the actual order-creation are stubbed with a clear "ADD WHEN READY" marker. See `docs/payment-integration.md` for the full setup guide.

### S14-A · Razorpay scaffold

- New `RazorpayService` (`src/modules/payments/`) — `createOrder(amount, scope, examId)` returns the Razorpay order id (stubbed today — returns a placeholder). `verifyPaymentSignature razorpay_order_id | razorpay_payment_id | razorpay_signature` validates the HMAC (the actual key is read from env — see `docs/payment-integration.md`).
- `POST /api/payments/checkout` — creates a Razorpay order, returns the order details + the publishable key for the client-side Razorpay checkout modal.
- `POST /api/payments/webhook` — the Razorpay webhook receiver. Verifies the signature, then grants the `UserPremiumAccess` row (the entitlement that unlocks the notes). Idempotent on `payment_id`.
- Client-side `RazorpayCheckout` component — wraps the Razorpay JS SDK (loaded from `https://checkout.razorpay.com/v1/checkout.js`). Handles the modal open, payment success/failure, and the post-payment refresh (the user's `UserPremiumAccess` re-fetch).

### S14-B · Pricing

| Tier | Price (₹) | Scope | Validity | Notes |
|---|---|---|---|---|
| Single Exam | ₹99 | ONE exam | Lifetime | No expiry — simple, one-time purchase |
| Annual Pass | ₹499 | ALL exams | 1 year | Renewable; the "all-you-can-eat" option |

These prices are in `src/config/pricing.ts` (the single source of truth — the Console reads them, the checkout route validates against them). Changing a price is a config edit, not a deploy.

### S14-C · The paywall UI

- "Unlock Exam Notes for ₹99" button on every locked note card.
- Modal: pricing table (Single Exam ₹99 vs Annual Pass ₹499) + Razorpay checkout trigger.
- After successful payment: silent refresh, the locked cards unlock with a 200ms fade (no page reload).

---

## SITE-S15 — Book Compilation + upsell

### S15-A · PDF compilation

- New `BookCompilationService` (`src/modules/books/`) — given an examId (or a set of exams), generates a print-ready PDF from the published ExamNotes + the underlying tutorial chapters. Uses `pdfkit` or `puppeteer` (TBD — puppeteer is heavier but renders the existing HTML/CSS, which means the book looks like the website).
- `POST /api/books/compile` (ADMIN only initially; later a `/api/books/download` for entitled users) — kicks off the compilation, returns a signed download URL.
- The PDF carries the GKSetu branding + the exam name + a per-chapter table of contents.

### S15-B · Upsell

- On every premium ExamNote card, a secondary CTA: "Get this as a printed book →" → opens a modal explaining the book option + an Amazon KDP link (or a self-fulfillment checkout — TBD).
- The book compilation is also a one-click export for the Console (the editor can download a PDF of any exam's notes for review).

### S15-C · Physical book selling (Phase 2 — not in this wave's scope)

- Amazon KDP integration (self-publishing — zero inventory).
- OR self-fulfillment via Shiprocket/Delhivery (the user prints on demand).
- This is a separate revenue stream — the digital premium tier is the primary product; books are the upsell.

---

## Execution order & dependency notes

- **S13 is the foundation** — schema, gating, chapter overlay. No payment dependency.
- **S14 builds on S13** — payment grants the `UserPremiumAccess` rows that S13's gating reads.
- **S15 builds on S13 + S14** — book compilation uses the same published ExamNotes that the chapter page renders.
- The "free for now" lever (`premiumGatingEnabled: false` in site-settings) means S13 ships with all notes visible to everyone. Flipping the toggle later is a Console edit — no deploy, no migration.

---

## What is NOT in this wave

- A/B testing of pricing (₹49 vs ₹99 vs ₹199) — the user can experiment later via the Console.
- Affiliate/referral (the user mentioned ₹10/exam — referral discounts could be a future lever, but the unit economics at ₹10 don't survive gateway fees).
- Subscription tiers beyond the annual pass (no monthly/quarterly for now — keeps it simple).
- Multi-currency (INR only — international markets are P9-S2's planned-languages phase; when they go live, multi-currency becomes a concern).

---

**The wave's promise:** every learner gets the existing free tutorials unchanged. Learners who want the exam-pattern-specific editorial layer (cheat sheets, worked PYQs, pattern briefs) pay ₹99/exam or ₹499/year. The user can flip the gating switch whenever they're ready — the entire pipeline works end-to-end today with gating OFF.
