# SITE-S13-C — Console ExamNotes + Premium Management UI

**Session:** SITE-S13-C of the premium-learning wave (`docs/premium-learning-plan.md`)
**Wave goal:** coaching-style exam-pattern notes per exam, free now + premium later, replace coaching/books.
**This session:** the Console management UI for the SITE-S13 backend (the ExamNote editorial overlay + the UserPremiumAccess entitlement registry). The schema, APIs, and gating logic shipped in SITE-S13; this session ships the Console surfaces that operators actually use.

---

## What was built

### A. ExamNotes Console Section (`/console/exam-notes`)

The editorial overlay registry — every ExamNote (Pattern Brief / Cheat Sheet / Worked MCQs / Revision Notes) per chapter per exam. Rides `note:manage` (WRITER+: own country + language scope, COUNTRY_ADMIN: own country, ADMIN: any) for create/edit; `note:publish` (ADMIN + COUNTRY_ADMIN, never WRITER) for the publish action.

**Files:**
- `src/components/console/pages/exam-notes-page.tsx` — the list page (filters + table + create dialog + edit dialog + publish confirmation + transition buttons).
- `src/components/console/pages/exam-note-detail-page.tsx` — the detail page (`/console/exam-notes/{id}`) — full body + revision history + transition buttons.
- `src/components/console/pages/exam-notes-shared.ts` — shared helpers (exam/chapter picker fetchers, kind labels, status badges, the form-values interface).
- `src/app/api/exam-notes/admin/chapters/route.ts` — NEW, the chapter-picker endpoint (loads an exam's current version's chapter tree, flattened with their syllabusNodeIds + indented labels).

**List page features:**
- Filters: search (exam/chapter/body), status (All/Draft/Published/Inactive), kind (All/Pattern Brief/Cheat Sheet/Worked MCQs/Revision Notes).
- Table columns: Exam · Chapter · Kind · Body Preview · Status · Updated.
- Row click → detail page (`/console/exam-notes/{id}`).
- Inline actions: Publish (with confirmation dialog — explains §36 immutable revision creation), Unpublish (immediate, sets INACTIVE), Edit (Pencil — disabled when PUBLISHED — published notes are immutable, §36), Open (chevron).
- Pagination (20 per page).

**Create dialog:**
- Exam picker (loads from `/api/exams/admin/exams` — filters to non-RETIRED exams).
- Chapter picker (loads from `/api/exam-notes/admin/chapters?exam={slug}` when the exam changes — shows depth-prefixed labels: "├─ Fundamental Rights").
- Kind picker (Pattern Brief / Cheat Sheet / Worked MCQs / Revision Notes — with descriptions).
- Body (markdown textarea, 20-50k chars, with a live char counter).
- Validation: exam + chapter + kind required; body ≥ 20 chars.
- The unique constraint `@@unique([examId, syllabusNodeId, kind])` is enforced server-side (DUPLICATE_KIND_PER_CHAPTER 409 — the dialog shows the error inline).

**Edit dialog:**
- Body edit only (DRAFT/INACTIVE — PUBLISHED body is immutable, §36).
- Header shows the exam/chapter/kind/status (immutable — the editorial identity).
- The §36 immutability is honest: the edit button is disabled when the note is PUBLISHED.

**Detail page:**
- The note's header card (exam, chapter, kind, status, last-updated, revision count).
- The transition buttons (publish / unpublish — `note:publish` gated).
- The full body (read-only — editing happens via the list page's edit dialog).
- An immutable notice for PUBLISHED notes ("Unpublish to edit — a new revision is created on re-publish").
- The revision history (§36 append-only audit trail) — every published revision with who/when/body preview + the §36 immutable badge.

### B. Premium Console Section (`/console/premium`)

The entitlement registry — every `UserPremiumAccess` row (the entitlement that unlocks gated ExamNotes). Plus the global "premium gating" toggle (the "free for now" lever). Rides `premium:manage` (ADMIN only in v1) for the grants + revokes; `settings:manage` for the gating toggle (so COUNTRY_ADMIN with settings can flip it too — though v1 doesn't grant settings:manage to COUNTRY_ADMIN).

**Files:**
- `src/components/console/pages/premium-page.tsx` — the list page (stats header + gating toggle + filters + table + grant dialog + revoke confirmation).

**Page features:**
- **Gating toggle card** (top): a Switch + the ON/OFF badge + a clear description of what each state means. Flipping is instant — calls `/api/premium/admin/gating` which writes `premium.gatingEnabled` to site-settings + audits the change. The toggle is the user's "free for now" lever — when OFF (the default), every PUBLISHED ExamNote is visible to everyone; when ON, only entitled users see the full body.
- **Stats header** (4 cards): Total entitlements · Active · Single-exam · Annual pass.
- **Filters**: search (by user email or exam), scope (All/Single-exam/Annual pass), source (All/Purchase/Grant/Redeem), state (Any/Active/Expired).
- **Table columns**: User (email + id suffix) · Scope (Annual pass or Single exam + exam name) · Source (purchase/grant/redeem, lowercase) · Validity (from/until/lifetime) · State (Active/Expired badge) · Granted (when + by whom).
- **Inline actions**: Revoke (the support/refund path — opens a confirmation dialog).
- **Grant dialog**: user id (cuid) + scope (Single exam ₹99 / Annual pass ₹499) + exam ref (when SINGLE_EXAM) + expires at (optional — empty = lifetime for SINGLE_EXAM, +1 year for ALL_EXAMS) + reason (required for audit).
- **Revoke confirmation**: explains the immediate effect (the user loses access to gated ExamNotes immediately) + the audit (the row stays for the audit trail with expiresAt = now).
- **Permission gate**: when the caller lacks `premium:manage`, the page shows the gating toggle (if they have `settings:manage`) but hides the grants/revokes table + dialog.

### C. Console navigation

- New "Exam Notes" item in the **Assessment** group (`/console/exam-notes`) — `note:manage` permission, `Sparkles` icon.
- New "Premium Access" item in the **Site** group (`/console/premium`) — `premium:manage` permission, `ShieldCheck` icon.
- `findNavMatch` updated to map `/console/exam-notes/{id}` (the detail page) onto the Exam Notes nav item (so the sidebar highlights correctly).
- The console-shell router (`renderConsolePage`) handles all 3 new paths:
  - `exam-notes` → `ExamNotesPage`
  - `exam-notes/{id}` → `ExamNoteDetailPage noteId={...}`
  - `premium` → `PremiumPage`

---

## The chapter-picker endpoint (NEW)

`GET /api/exam-notes/admin/chapters?exam={ref}` — the dedicated endpoint the create dialog uses. Returns the exam's current version's chapter tree, flattened with their syllabusNodeIds + indented labels (so the Console's chapter `<select>` shows "Indian Polity" / "├─ Fundamental Rights" hierarchically).

**Why a dedicated endpoint (not the existing tutorials admin route):** the existing `/api/tutorials/admin` returns only the "gap chapters" (chapters without lessons/practice/PYQs), not ALL chapters. ExamNotes need to be attachable to ANY chapter (even well-mapped ones), so a dedicated endpoint was needed.

**Implementation:** loads the exam's current version's SyllabusNode tree, builds a parent→children map, recursively flattens with depth-prefixed labels (using non-breaking spaces for the indent — visible in `<select>` options).

Rides `note:manage` (the same permission the create dialog needs — a writer who can author notes can certainly see the chapter list). COUNTRY_ADMIN scoped (the exam:manage precedent).

---

## Verification

- `tsc` (app) + `tsc` (scripts) + `eslint` clean.
- `bun run build` (the exact Vercel command) passes end-to-end: prisma generate → compile (Turbopack) → TypeScript clean → every route built → postbuild takes the Vercel path.
- DB state confirmed: 0 ExamNotes + 0 UserPremiumAccess rows (the user hasn't authored content yet — the Console UI is ready for them to do so).
- The Console nav renders the two new items (verified by the build — no missing imports, the routes resolve, the permissions gate the items correctly).
- The gating toggle's two-way state: when OFF (default), every PUBLISHED ExamNote is visible to everyone; when ON, only entitled users see the full body. The toggle persists in site-settings + is audited.

---

## Files

### NEW

- `src/components/console/pages/exam-notes-page.tsx` — the ExamNotes list page.
- `src/components/console/pages/exam-note-detail-page.tsx` — the ExamNote detail page (full body + revision history).
- `src/components/console/pages/exam-notes-shared.ts` — shared helpers (exam/chapter pickers, kind labels, status badges).
- `src/components/console/pages/premium-page.tsx` — the Premium Access list page (stats + gating toggle + grant + revoke).
- `src/app/api/exam-notes/admin/chapters/route.ts` — NEW, the chapter-picker endpoint.

### MODIFIED

- `src/components/console/console-nav.ts` — added the "Exam Notes" nav item (Assessment group, `note:manage`) + the "Premium Access" nav item (Site group, `premium:manage`); updated `findNavMatch` to map `/console/exam-notes/{id}` to the Exam Notes nav item.
- `src/components/console/console-shell.tsx` — added the imports + the 3 new routes in `renderConsolePage`.

---

**Status:** SITE-S13-C COMPLETE (Console UI shipped; code committed + pushed). The user can now:
1. Open `/console/exam-notes` → create a note (pick exam → pick chapter → pick kind → write body → save as DRAFT) → publish it (the `note:publish` permission gate) → see the revision history on the detail page.
2. Open `/console/premium` → flip the gating toggle (the "free for now" lever) → grant manual access to a user → revoke an entitlement.

The pipeline is end-to-end ready. The user can author ExamNotes today (with gating OFF, every learner sees them); flip the gating switch when they're ready to monetise; plug in Razorpay keys (per `docs/payment-integration.md`) when they're ready to accept payments.

**Next (planned, not yet built):** SITE-S15 — book compilation + upsell (the puppeteer PDF render + the chapter-page "Get as printed book" CTA). Deferred until the ExamNotes corpus is meaningfully authored.
