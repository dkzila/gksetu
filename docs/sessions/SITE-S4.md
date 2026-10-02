# SITE-S4 — The design overhaul

**Date:** 2025-10-02 · **Plan:** docs/site-overhaul-plan.md §3 Task 6 (user pages + polish)
**Status:** COMPLETE — committed `c1883e9`, pushed to `dkzila/gksetu`.

## Delivered

### The 7 user pages (SITE-S4-A + SITE-S4-B) — "only what helps the user"
All redesigned to one compact professional standard: H1 + one-line subtitle + actions header,
plain words, no technical badges, 44px targets, 390/1440px clean, all actions verified
round-trip.

- **Dashboard**: the §11 combined queue + §22 revision table merged into ONE due-first
  "Your study queue" (title · subject · plain due state · summary · mastery bar · "For {exam}
  +N"); compact plan summary; removed the label/market/ISO diagnostics, onboarding badge,
  tier/depth/mode vocabulary, exam badge walls.
- **Saved**: plain-words types + icons (BookOpen/Newspaper/CircleHelp/ListChecks/Timer),
  clean rows, mono badges/difficulty/raw codes gone; collections + share intact.
- **Following**: plain-language cards (exam = name + organiser; topic = name + type; entity =
  name + plain type + aliases), ISO codes and "coming soon" notes gone.
- **Notifications**: per-channel status strips, dispatch diagnostics and technical notes
  removed; quiet icon tiles, clean feed, preferences grid with "Coming soon" for reserved
  channels.
- **Profile**: decluttered — basics form + compact learning-goal card; metadata lines gone.
- **Settings** (was the personalisation debug-explainer): rebuilt as a real settings page —
  five clear rows (goal / follows / saved / notifications / feedback) with live summaries +
  the reset danger zone.
- **Feedback**: plain status pills; the missing SEO head added (was the only user page
  without one).

### Public page polish (SITE-S4-C)
- `/exams/`: tight breadcrumb, compact hero ("Exams — every exam with a real syllabus, 136
  exams…"), de-teched cards (code folded into the organiser line, subtle level chips).
- `/{subject}/`: breadcrumb gaps fixed (the user's complaint), header → compact hero with
  Share + Follow INLINE on one row, "GK category"/ISO badges removed ("India-focused" plain
  pill for COUNTRY scope), sections tightened.

### Critical fix (found by the S4-C agent's parse-route harness)
The exams tree ran AFTER the generic subject fallback in `parseRoute` — since SITE-S1,
`/exams/{exam}/`, `/exams/{exam}/syllabus/{topic}/` and exam-scoped mock-test paths
mis-parsed as topic/unit pages ("Topic not available here"). Reordered; exam pages render
again (verified: UPSC CSE page + syllabus view + exam-scoped test routing).

## Verification
- Full title sweep: all 18 surfaces (home, hi/fr homes, exams directory + detail,
  current-affairs, subjects, mock-test, mcq, qna, subject page, 7 user pages) — correct
  titles, zero console errors, tsc + eslint clean.
- Agent round-trips: queue scope select, collection move, unfollow/refollow, preference
  toggle persistence, profile save, mark-read, reset-dialog cancel.

## The SITE series is complete
All 8 user tasks delivered across SITE-S1..S4 (see docs/site-overhaul-plan.md §7). Commits:
`ac24b71` (S1), `470adfc` (S2), `d18d74b` (S3), `c1883e9` (S4) + docs — all pushed to
`dkzila/gksetu`.
