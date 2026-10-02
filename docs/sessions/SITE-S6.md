# SITE-S6 — Design unification

**Date:** 2026-10-02 · **Plan:** docs/learning-platform-plan.md §SITE-S6 · **Status:** COMPLETE — `10637f6`.

## Delivered
- **Hero standard everywhere**: /subjects/ (band + counted one-liner "20 subjects and 9 subtopics"), /mock-test/ (de-oversized H1, stats → pills, CTA in the action slot), /mcq/ + /qna/ (band + Share + counted one-liners gated to the unfiltered state).
- **The width fix** (the user's blank-sides complaint): `mx-auto max-w-3xl` dropped on mcq/qna (all 3 return branches — no state jumps) + notifications/profile/settings/feedback (RTL wrapper preserved) — every page now shares Dashboard's 992px full-width frame; light wide-frame polish (profile form sm:2/lg:3 cols, preferences lg:3).
- Loading skeletons mirror the new heroes; private pages keep the SITE-S4 plain headers (the emerald band is public-only).

## Verified
tsc + eslint clean · 1440px (band 992px, zero overflow) · 390px (all 9 surfaces scrollWidth == clientWidth == 390) · inline reveal/CTA round-trips · slice agents S6-A/B/C worklog entries.
