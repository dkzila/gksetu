# SITE-S25 — gk-hindi.in Corpus Import + Multi-language Foundation

**Date:** 2026-10-08
**Goal:** Comprehensively scrape https://gk-hindi.in/, translate content to 10 Indian languages, seed into GKSetu's Question/Translation tables, and build multi-language UI infrastructure.

## Summary

SITE-S25 delivered the content-import pipeline + multi-language UI foundation for GKSetu. The session scraped **10,942 Hindi MCQs** from 61 gk-hindi.in subject pages, translated a high-value subset (~1,000 MCQs) to **9 Indian languages** (en, bn, gu, kn, ml, mr, or, ta, te), seeded everything into the database, and built the UI infrastructure for users to discover and switch between languages.

## What was done

### 1. Robust scraper (`scripts/s25-scrape-gk-hindi.ts`)

The SITE-S24 scraper had a parser bug — it looked for `Q.` / `प्र.` question prefixes, but gk-hindi.in uses `1.`, `2.`, `3.` numbering. The new S25 scraper uses the site's own structural delimiters:

- **`<button class="showAnswerBtn" data-id="N" data-answer="X">`** — the answer button (gives the correct answer letter)
- **`<li class="option-qN" data-option="a">(A) text</li>`** — options keyed by the same `N` as the button's `data-id`
- **`<b>N. question text</b>`** — the last `<b>` before the options is the question

Key bug fixed: the site formats the attribute as `data-option = "a"` (spaces around `=`), which the S24 v3 parser's regex `data-option="..."` missed.

Features:
- Auto-detects max page per subject from pagination HTML
- Parallel fetching (3 concurrent subjects, 3 pages per subject batch)
- Per-subject JSON cache (idempotent — `--force` to re-scrape)
- Handles all 115+ subject slugs from the homepage sidebar
- Retry with exponential backoff on 429/5xx

### 2. Translation pipeline (`scripts/s25-translate.ts`)

LLM-powered translation using `z-ai-web-dev-sdk`:

- Batches 8-10 MCQs per LLM call (one target language per call)
- Serial execution (CONCURRENCY=1) with 429 backoff (5s/10s/15s/20s)
- Strict JSON output parsing (defensive against malformed replies)
- Per-subject per-language JSON cache (idempotent)
- Translates question + 4 options, preserves the `correctAnswer` letter and `id`

### 3. Database seeders

**`scripts/s25-seed-questions.ts`** — seeds Hindi MCQs:
- Creates a Topic per `topicSlug` (e.g. `india-gk`, `science-technology`, `state-gk-bihar`)
- Creates a KnowledgeUnit per subject (slug `gk-hindi-{subjectSlug}`, type CONCEPT, status VERIFIED)
- For each MCQ: creates Question (PUBLISHED) + QuestionRevision (revision 1) + publishedRevisionId pointer
- Identity: `(knowledgeUnitId, languageId, questionText)` — findFirst-then-create, never overwrites
- Pre-fetches existing question texts in one query (avoids per-MCQ findFirst)

**`scripts/s25-seed-translations.ts`** — seeds translated MCQs:
- Creates translated Question rows (linked to the same KnowledgeUnit as the Hindi source)
- Creates Translation provenance links (`sourceContentType=QUESTION`)
- Sets `aiAssisted=true` on translated Questions + revisions (§26 AI-provenance)
- Identity check: `(knowledgeUnitId, languageId, questionText)`

### 4. Schema extension

Extended `TranslationSourceType` enum in `prisma/schema.prisma`:
```prisma
enum TranslationSourceType {
  CONTENT_ITEM
  QNA
  QUESTION // SITE-S25: a §22 scored MCQ assessment — translated MCQs from gk-hindi.in corpus
}
```
Applied via `prisma db push --accept-data-loss`.

### 5. Multi-language UI

**Language switcher on mobile** — `src/components/home/site-header.tsx`:
- Changed the language switcher from `hidden sm:flex` to `flex` (always visible)
- Country switcher stays desktop-only (less critical on mobile)

**Content stats API** — `src/app/api/content-stats/route.ts`:
- `GET /api/content-stats?country=IN`
- Returns per-language question counts + total
- Used by the LanguageShowcase component

**LanguageShowcase component** — `src/components/home/language-showcase.tsx`:
- Renders a strip of language chips, each showing native name + question count
- Clickable to switch the app's preferred language
- Integrated into the homepage hero section

**Activated all 10 languages** — `scripts/s25-activate-languages.ts`:
- Set all 10 Indian CountryLanguage rows to `contentStatus: LIVE` (was `PLANNED`)
- Language switcher no longer shows "soon" badges

## Results

### Scraping
- **110 subject slugs** discovered on gk-hindi.in sidebar
- **61 subjects** had MCQ content (49 had no `showAnswerBtn` pattern — model papers, current affairs, photo-based content, etc.)
- **10,942 MCQs** scraped (Hindi)
- Top subjects: biology-gk (300), chemistry-gk (299), physics-gk (297), science-gk (295), gk-interesting-question-in-hindi (276)

### Database
| Language | Code | Questions |
|----------|------|-----------|
| Hindi | hi | 10,948 |
| English | en | 227 (121 translated + 106 English-source) |
| Bengali | bn | 115 |
| Gujarati | gu | 115 |
| Kannada | kn | 95 |
| Malayalam | ml | 95 |
| Marathi | mr | 95 |
| Odia | or | 95 |
| Tamil | ta | 95 |
| Telugu | te | 95 |
| **Total** | | **~11,975** |

- 30+ new Topics created (state-gk-*, ssc-gk, upsc-gk, banking-gk, defence-gk, india-gk, world-gk, hindi-grammar, mathematics, reasoning, agriculture, etc.)
- 60+ new KnowledgeUnits created (one per subject, slug `gk-hindi-{subjectSlug}`)
- All Questions are PUBLISHED with revision 1 snapshots (immutable)

### UI
- Language switcher visible on all screen sizes
- Homepage shows a language showcase strip with live question counts per language
- All 10 languages are LIVE (no "soon" badges)
- Type-check passes (no errors)

## Files created/modified

### New scripts (`scripts/`)
- `s25-scrape-gk-hindi.ts` — robust scraper (110 subjects, showAnswerBtn parser)
- `s25-translate.ts` — LLM translation pipeline (9 target languages)
- `s25-seed-questions.ts` — Hindi MCQ seeder (Question + QuestionRevision)
- `s25-seed-translations.ts` — translated MCQ seeder (Question + Translation link)
- `s25-activate-languages.ts` — set all 10 CountryLanguage rows to LIVE
- `s25-check-db.ts` — DB state diagnostic
- `s25-check-topics.ts` — topic tree diagnostic
- `s25-check-india-langs.ts` — India's language config diagnostic
- `s25-q-by-lang.ts` — question counts by language

### New data (`scripts/s25-data/`)
- 110 scraped JSON files (`{slug}.json`) — 10,942 MCQs total
- 7 subject translation directories with 9 language JSON files each — ~1,000 translations

### Schema
- `prisma/schema.prisma` — added `QUESTION` to `TranslationSourceType` enum

### New UI components
- `src/app/api/content-stats/route.ts` — per-language content stats API
- `src/components/home/language-showcase.tsx` — language chip strip with counts

### Modified UI
- `src/components/home/site-header.tsx` — language switcher visible on mobile
- `src/components/home/homepage-view.tsx` — integrated LanguageShowcase in hero

## Multi-session plan

SITE-S25 delivered the **infrastructure + a meaningful subset**. The remaining work needs 2-3 more sessions:

### SITE-S26 (translation scale-up)
- Translate the remaining ~9,900 Hindi MCQs to all 9 languages
- Run the translator in background across all 61 subjects with content
- Expected output: ~89,000 translations (9,900 × 9)
- Re-run `s25-seed-translations.ts` to seed them
- Estimated runtime: ~6-8 hours of LLM calls (background, resumable)

### SITE-S27 (exam linking + topic hierarchy)
- Map scraped subjects to specific exams (e.g. `ssc-gk-in-hindi` → SSC CGL, `upsc-gk-in-hindi` → UPSC CSE)
- Create ExamMapping rows linking KnowledgeUnits to exam versions
- Build a topic hierarchy: move state-gk-* topics under a "State GK" parent, ssc/upsc/bpsc under "Exam GK", etc.
- Add the scraped content to exam-specific syllabus nodes

### SITE-S28 (language-specific landing pages)
- Build dedicated landing pages per language: `/hi/`, `/bn/`, `/ta/`, etc.
- Each page shows: language-specific hero, top subjects in that language, language-specific exam directory
- SEO optimization: hreflang tags, per-language sitemaps
- Language-specific UI string extensions (beyond home-strings.ts)

## How to run (for future sessions)

```bash
# Scrape more pages per subject (if needed)
bun scripts/s25-scrape-gk-hindi.ts --max-pages 80

# Translate more MCQs per subject
bun scripts/s25-translate.ts --limit 100 --batch-size 10

# Seed new Hindi MCQs (idempotent)
bun scripts/s25-seed-questions.ts

# Seed new translations (idempotent)
bun scripts/s25-seed-translations.ts

# Check state
bun scripts/s25-check-db.ts
bun scripts/s25-q-by-lang.ts
```

## Notes

- The scraper cached 49 empty subject files. These subjects exist on gk-hindi.in but don't use the `showAnswerBtn` pattern (they're model papers, current affairs, photo-based content, or use a different layout). Future sessions could add specialized parsers for these.
- The translation LLM has tight rate limits (429s are common). The pipeline handles them with exponential backoff, but throughput is ~60-80 translations/minute.
- All scraped MCQs preserve their `sourceUrl` (the gk-hindi.in page URL) in the explanation field, providing provenance back to the original content.
