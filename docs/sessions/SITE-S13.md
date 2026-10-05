# SITE-S13 — Exam Notes + Premium Gating (the overlay architecture)

**Session:** SITE-S13 of the premium-learning wave (`docs/premium-learning-plan.md`)
**Wave goal:** coaching-style exam-pattern notes per exam, free now + premium later, replace coaching/books.
**Architecture decision (held):** premium content is an OVERLAY on the tutorial chapter page — NOT a parallel system. The base lesson (knowledge-unit projection) stays free and shared. The premium editorial layer sits on top.

---

## S13-A · Schema + the editorial layer

### The data model

```prisma
enum ExamNoteKind {
  PATTERN_BRIEF    // exam-specific weightage + question style (~200 words)
  CHEAT_SHEET      // 1-page condensed revision — articles/dates/formulas
  WORKED_MCQ       // real PYQ + step-by-step explanation + trap + pattern alert
  REVISION_NOTES   // chapter-summary mind-map, last-minute tips
}

enum ExamNoteStatus { DRAFT PUBLISHED INACTIVE }

model ExamNote {
  id             String         @id @default(cuid())
  examId         String         // §14: home-market exam
  syllabusNodeId String         // the chapter (P3-S2 SyllabusNode)
  kind           ExamNoteKind
  body           String         @db.Text  // the published body (denormalised for fast read)
  status         ExamNoteStatus @default(DRAFT)
  publishedRevisionId String?   // the revision currently live (§36 audit)
  authoredById   String?
  // relations: exam, syllabusNode, revisions, authoredBy
  @@unique([examId, syllabusNodeId, kind])  // one note per chapter per kind per exam
}

model ExamNoteRevision {
  id            String   @id @default(cuid())
  noteId        String
  body          String   @db.Text  // immutable after create (§36)
  publishedById String?
  publishedAt   DateTime @default(now())
}

enum PremiumScope { SINGLE_EXAM ALL_EXAMS }
enum PremiumSource { PURCHASE REDEEM GRANT }

model UserPremiumAccess {
  id            String        @id @default(cuid())
  userId        String
  scope         PremiumScope @default(SINGLE_EXAM)
  examId        String?       // null when scope = ALL_EXAMS
  startsAt      DateTime      @default(now())
  expiresAt     DateTime?     // null = lifetime (₹99 single-exam)
  source        PremiumSource @default(PURCHASE)
  orderId       String?       // SITE-S14: Razorpay order id
  paymentId     String?       // SITE-S14: Razorpay payment id (UNIQUE — idempotency)
  grantedById   String?
  grantedReason String?
  // relations: user, exam, grantedBy
  @@unique([paymentId])
}
```

`Exam.level` and the existing tutorial chapter are UNTOUCHED — the notes are an overlay, not a parallel system. The chapter page now renders 6 blocks: the existing 5 (Lessons → Practice → PYQs → Q&A → Mocks) PLUS the new "Exam Notes" block (4 sub-cards: Pattern Brief → Cheat Sheet → Worked MCQs → Revision Notes).

### The "free for now" lever

`site-settings.premium.gatingEnabled` (default `false`). When false, every PUBLISHED note's full body is visible to everyone (anonymous + signed-in). When true, only entitled users see the full body; others see a 100-char blurred preview + the paywall CTA. Flipping is a Console edit (`/console/premium` → "Premium gating" toggle), NOT a deploy.

### The 4 kinds — what they are

| Kind | What it carries | ~Length | Authoring cost |
|---|---|---|---|
| PATTERN_BRIEF | Exam-specific weightage + question style ("UPSC Polity: ~15 questions, FR=2-3 direct, DPSP=1-2 conceptual") | ~200 words | Low — one-time per exam-chapter |
| CHEAT_SHEET | 1-page condensed revision (articles, dates, formulas) | ~500 words | Medium — annual refresh |
| WORKED_MCQ | Real PYQ + step-by-step explanation + common trap + pattern alert | ~300 words per question | High — research-heavy |
| REVISION_NOTES | Chapter-summary mind-map + last-minute tips | ~300 words | Medium |

**Cost math for the full corpus:** 138 exams × ~15 chapters × 4 kinds = 8,280 editorial pieces. ~200 words average = 1.6M words total. AI-assisted drafting (the existing ai-assist module) + editor review = ~1 year for 1-2 editors. This is 1/10th the cost of authoring 138 parallel tutorial systems.

---

## S13-B · The premium module (entitlement + gating)

`src/modules/premium/`:

- `hasAccessToExam(userId, examId)` — the gating primitive. Returns true when ANY active entitlement covers the exam (SINGLE_EXAM for this examId, OR ALL_EXAMS, within [startsAt, expiresAt]).
- `canAccessExamNotes(userId, examId)` — the combined check: gating-on AND has-access. When gating is OFF (the default "free for now" state), short-circuits to `{ gatingEnabled: false, hasAccess: true }`.
- `grantAccess({ userId, scope, examId, expiresAt, source, orderId, paymentId })` — creates a UserPremiumAccess row. Idempotent on `paymentId` (Razorpay retries are safe).
- `revokeAccess(accessId, reason)` — sets `expiresAt = now()` (audit-logged).
- `getMyPremiumAccess(userId)` — the caller's own entitlement summary (GET /api/premium/access).
- `getAdminPremiumList(actor, query)` — Console listing with filters + stats.
- `grantManualAccess(actor, input)` — the support path (ADMIN-only manual grant).

The gating helper is **the single primitive** reused by every surface — the chapter page's payload builder, the Console's manual grant, the Razorpay webhook (SITE-S14). One truth.

---

## S13-C · The ExamNotes module (the editorial overlay)

`src/modules/exam-notes/`:

- `getExamNotesForChapter({ examRef, syllabusNodeId, userId })` — the public chapter-page payload. Returns PUBLISHED notes with the body unlocked (or a 100-char preview when gated) + the gating state. 60s cached on the gating-OFF path (the common case today — every learner sees the same payload).
- `getAdminExamNotes(actor, query)` — Console listing with filters (exam/chapter/kind/status/q).
- `getAdminExamNote(actor, id)` — detail view with revision history.
- `createExamNote(actor, input)` / `updateExamNote(actor, id, input)` / `transitionExamNote(actor, id, input)` — the editorial workflow (DRAFT → PUBLISHED → INACTIVE → PUBLISHED; revisions are append-only §36; the publish transition creates a new revision + snapshots the body).
- `EXAM_NOTE_TRANSITIONS` + `EXAM_NOTE_EDITABILITY` — the §36 state machine (PUBLISHED body is immutable; unpublish+edit+republish creates a new revision).

### §19 workflow

- DRAFT → PUBLISHED (note:publish — editor+ only, never WRITER).
- PUBLISHED → INACTIVE (note:publish — soft-disable without losing the body).
- INACTIVE → PUBLISHED (note:publish — re-publish creates a new revision).

Publishing is a separate permission (`note:publish`) from authoring (`note:manage`) — the editorial gate. WRITERs author; COUNTRY_ADMIN/ADMIN publish. The content:publish precedent.

### New permissions

- `note:manage` — author/edit exam notes (WRITER+ in scope, the content:manage precedent).
- `note:publish` — publish/schedule/retire exam notes (ADMIN + COUNTRY_ADMIN, never WRITER).
- `premium:manage` — manage UserPremiumAccess rows + the gating switch (ADMIN only in v1).

### New audit actions

- `examnote.create` / `examnote.update` / `examnote.transition`.
- `premium.grant` / `premium.revoke`.
- Object types: `ExamNote`, `UserPremiumAccess`.

---

## S13-D · APIs

- `GET /api/exams/{ref}/notes?chapter={nodeId}` — public chapter-page payload (rate-limited, anonymous-safe). The body is full text when unlocked; a 100-char preview when gated.
- `GET /api/exam-notes/admin` — Console listing (note:manage).
- `POST /api/exam-notes/admin` — create (enters DRAFT).
- `GET /api/exam-notes/admin/{id}` — detail view.
- `PATCH /api/exam-notes/admin/{id}` — edit body (DRAFT/INACTIVE only — §36).
- `POST /api/exam-notes/admin/{id}/transition` — publish/unpublish.
- `GET /api/premium/access` — the caller's own entitlement summary (Bearer-authenticated).
- `GET /api/premium/admin` — Console listing (premium:manage).
- `POST /api/premium/admin/grant` — manual grant (ADMIN only).
- `POST /api/premium/admin/{id}/revoke` — revoke (premium:manage).
- `POST /api/premium/admin/gating` — flip the gating switch (settings:manage).

---

## S13-E · The chapter page overlay

`src/components/premium/exam-notes-section.tsx` — the new 6th block on the tutorial chapter page:

1. Renders BELOW the existing 5 blocks (Lessons → Practice → PYQs → Q&A → Mocks → **Exam Notes**).
2. Fetches `/api/exams/{ref}/notes?chapter={nodeId}` once per chapter mount.
3. 4 sub-cards (Pattern Brief → Cheat Sheet → Worked MCQs → Revision Notes) — each with an icon, label, description, body (or a blurred preview + paywall CTA when locked).
4. When gating is OFF: shows a "Free preview" badge + every card's full body.
5. When gating is ON and the user lacks access: shows a "Locked" badge + a blurred preview + an "Unlock for ₹99" CTA that opens the paywall modal.
6. When gating is ON and the user has access: shows every card's full body (no badge).
7. When no notes exist for the chapter yet: shows a "coming soon" card (the pipeline is ready, the editor just hasn't authored).

`src/components/payments/paywall-modal.tsx` — the pricing table + checkout trigger:

- Two pricing tiers: ₹99 single-exam (lifetime) + ₹499 annual pass (1 year).
- The "Pay ₹99" / "Pay ₹499" buttons trigger the Razorpay checkout (SITE-S14). When Razorpay keys are not configured (the default), the buttons show a "Payments not configured yet" message + a pointer to `docs/payment-integration.md`.
- The parent (chapter-reader) owns the modal state — opened when the user taps "Unlock for ₹99" on a locked card.

The chapter-reader (`src/components/tutorials/chapter-reader.tsx`) wires the two: renders `<ExamNotesSection>` after the existing blocks, and `<PaywallModal>` at the bottom. No other surface is touched (the existing free content + UI is unchanged).

---

## Verification

- `tsc` (app) + `tsc` (scripts) + `eslint` clean.
- `bun run build` (the exact Vercel command) passes end-to-end: prisma generate → compile (Turbopack) → TypeScript clean → every route built → postbuild takes the Vercel path.
- DB migration: `prisma db push` against live Supabase (Mumbai pooler) — 4 new tables (`ExamNote`, `ExamNoteRevision`, `UserPremiumAccess`) + 3 new enums + 3 new relations on `User`, `Exam`, `SyllabusNode`, `Country`.
- The gating switch defaults to OFF (the "free for now" state) — every PUBLISHED note is visible to everyone today. The user can flip it from the Console whenever they're ready.

---

## Files

### Schema + DB

- `prisma/schema.prisma` — `ExamNoteKind` + `ExamNoteStatus` + `PremiumScope` + `PremiumSource` enums; `ExamNote` + `ExamNoteRevision` + `UserPremiumAccess` models; relations on `User` (authoredExamNotes, publishedExamNoteRevisions, premiumAccess, grantedPremiumAccess), `Exam` (examNotes, premiumAccess), `SyllabusNode` (examNotes).

### Backend

- `src/lib/permissions.ts` — `note:manage`, `note:publish`, `premium:manage` permissions + the role grants.
- `src/modules/audit/types.ts` — `examNote.create/update/transition`, `premium.grant/revoke` actions + `ExamNote`/`UserPremiumAccess` object types.
- `src/modules/site-settings/{service,index}.ts` — `isPremiumGatingEnabled()`, `setPremiumGatingEnabled()` (the "free for now" lever).
- `src/modules/exam-notes/{index,types,validation,service}.ts` — NEW, the editorial overlay module.
- `src/modules/premium/{index,types,validation,service}.ts` — NEW, the entitlement + gating module.
- `src/config/pricing.ts` — NEW, the single source of truth for prices (₹99 single-exam, ₹499 annual pass).

### API routes (NEW)

- `src/app/api/exams/[ref]/notes/route.ts` — public chapter-page payload.
- `src/app/api/exam-notes/admin/route.ts` — Console listing + create.
- `src/app/api/exam-notes/admin/[id]/route.ts` — get + patch.
- `src/app/api/exam-notes/admin/[id]/transition/route.ts` — publish/unpublish.
- `src/app/api/premium/access/route.ts` — the caller's own entitlements.
- `src/app/api/premium/admin/route.ts` — Console listing.
- `src/app/api/premium/admin/grant/route.ts` — manual grant.
- `src/app/api/premium/admin/[id]/revoke/route.ts` — revoke.
- `src/app/api/premium/admin/gating/route.ts` — flip the gating switch.

### Frontend (NEW)

- `src/components/premium/exam-notes-section.tsx` — the chapter-page overlay (4 sub-cards + locked/unlocked states).
- `src/components/payments/paywall-modal.tsx` — the pricing table + checkout trigger.
- `src/components/tutorials/chapter-reader.tsx` — wires the two (renders ExamNotesSection after the existing blocks; PaywallModal at the bottom).

---

**Status:** SITE-S13 COMPLETE (DB migrated; code committed + pushed). The pipeline is end-to-end ready with gating OFF (free for everyone). The user can flip the gating switch from `/console/premium` whenever they choose to go live with payments.

**Next:** SITE-S14 (Razorpay payment integration — scaffold in place, keys plug in when ready) + SITE-S15 (book compilation + upsell — planned).
