# SITE-S2 — Subjects corpus, language roadmap & homepage i18n

**Date:** 2025-10-02 · **Plan:** docs/site-overhaul-plan.md §3 Tasks 2 & 8
**Status:** COMPLETE — committed `470adfc`, pushed to `dkzila/gksetu`.

## Delivered

### The 20-subject corpus (Task 8)
- `scripts/site-s2-subjects-seed.ts` (idempotent): 16 new root subjects (geography, economy,
  environment-ecology, biology, physics, chemistry, computer-it, sports, art-culture,
  books-authors, schemes, defence-security, international-relations, static-gk, agriculture,
  disaster-management) + `awards-honours` promoted from a branch to root — orders 5–21.
- Labels: 197 TopicLabel rows — SEO-meaningful English descriptions (120–200 chars,
  exam-register), Hindi names + descriptions, native-script names in all 8 planned languages
  (§35: label is the announcement; content falls back to English).
- 88 search aliases. `/api/subjects` serves all 20 (current-affairs excluded — it has its own
  page); `/subjects/` grid + homepage "Explore by subject" both show the corpus with a
  per-subject icon map (20 marks).

### The language roadmap (Task 2)
- Prisma `CountryLanguage.contentStatus` (`LIVE` default / `PLANNED`) — pushed to Supabase;
  plumbed snapshot → public payloads → client types.
- 8 Indian languages seeded as PLANNED for India: Bengali, Marathi, Telugu, Tamil, Gujarati,
  Kannada, Odia, Malayalam. English + Hindi stay LIVE (content today).
- "Soon" chips: homepage Read-in row (localized: जल्द / শীঘ্রই / விரைவில் / …), header +
  drawer language switchers.
- Honest SEO: PLANNED languages are excluded from hreflang alternates (buildPageSeo) and from
  sitemap segments; browsing a PLANNED language shows localized chrome with the §35 English
  content fallback.
- "Live in {Country}" stays removed for ACTIVE markets; "Launching soon…" kept for COMING_SOON.

### Homepage i18n (Task 2)
- `src/components/home/home-strings.ts` — the homepage chrome dictionary: en, hi, fr, bn, mr,
  te, ta, gu, kn, or, ml (per-key English fallback). English search keywords (GK, Current
  Affairs, Exam, Search, Syllabus) stay in English inside translated copy per the user's
  instruction.
- Translated: hero (prefix/highlight/suffix per-language word order), sub-copy, search
  placeholder (new SearchBox prop), Read-in label, section headings (Current affairs / Explore
  by subject / Prepare for your exam / Popular / Major topics), View-all buttons, CA empty
  states, count labels, and the SEO title/description templates.

## Verification
- /hi/ — "India — GK, Current Affairs और Exam Preparation | GKSetu", translated H1 + sections,
  8 "जल्द" chips; /bn/ — Bengali chrome with honest fallback; /fr/ — French chrome.
- hreflang alternates [en, hi] only; sitemap LIVE segments only.
- Subjects grid: 20 on India and France; tsc + eslint clean; zero console errors fresh-session.

## Follow-ups
- SITE-S3: public MCQ/QNA APIs + practice UI + seeded question banks (subject pages currently
  show honest zero counts — content arrives with the banks).
- Console UI for contentStatus management (flipping a language LIVE when content ships) —
  currently a seed/DB operation.
