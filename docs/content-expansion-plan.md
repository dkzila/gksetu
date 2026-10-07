# The Content Expansion Wave — Multi-Language GK Content Pipeline

**Status:** SITE-S24 planned (kickoff). S25, S26, S27, S28 follow.
**Wave goal:** Scrape GK MCQ content from reference sites (gk-hindi.in + others), translate into all 10 Indian languages, seed into the platform's existing Question + QnA + KnowledgeUnit models, and flip all 8 PLANNED languages to LIVE.

**Governing principle (unchanged):** unified systems only — every new content rides the existing spine (the Question/QnA/KnowledgeUnit models, the §19 publish workflow, the §35 language-fallback chain, the §14 country-scoping, the existing /mcq/ + /qna/ + tutorial surfaces). No parallel content systems.

---

## The source: gk-hindi.in

### Site structure (from search analysis)

**Subject-wise GK pages (MCQ format — Hindi + English):**
- Physics GK (`/physics-gk`, `/physics-mcq-in-hindi`, `/physics-gk-in-english`) — 179+ pages of MCQs
- Chemistry GK (`/chemistry-gk`) — 14+ pages
- Biology GK (`/biology-gk`, `/gk-question/sub/biology`) — 371+ pages
- History GK (visible on the homepage sidebar)
- Polity / Political GK (visible on the homepage)
- Geography GK (visible on the homepage)
- Economics GK (visible on the homepage)
- Sports GK
- Books & Authors
- Awards & Honours
- Science & Technology
- Computer GK
- Current Affairs

**India GK (state-wise):**
- India GK (`/india-gk`)
- Bihar GK (visible on the homepage)
- UP GK (visible on the homepage)
- Rajasthan GK (visible on the homepage)
- Delhi GK
- Maharashtra GK
- MP GK
- Andhra Pradesh GK
- And more state-wise pages

**World GK:**
- World GK questions (visible on the homepage sidebar)
- International organisations
- Countries & capitals

**Format:** Each page has MCQ-style questions — a question, 4 options (a/b/c/d), and the correct answer. The format is already structured (not prose) — ideal for scraping into the Question model.

**Volume estimate:** Based on the page counts (Physics 179 pages, Biology 371 pages, etc.), the total MCQ count is likely 5,000-10,000+ questions across all subjects.

---

## The target: GKSetu's existing content model

### The Question model (MCQs — the scored assessment objects)

```prisma
model Question {
  id                  String        @id @default(cuid())
  knowledgeUnitId     String        // §7 anchor — links to a canonical unit
  examVersionId       String?       // §6 exam anchor (optional — authoring context)
  languageId          String        // the language of THIS question
  status              ContentStatus @default(DRAFT)
  questionText        String        // working copy
  correctAnswer       String        // server-side — NEVER shipped to the client listing
  optionA, optionB, optionC, optionD  String  // the 4 options
  explanation         String?       // the "why" (the worked-MCQ pattern)
  publishedRevisionId String?       // the live immutable revision
  ...
}
```

Each Question has:
- A language (the `languageId`) — one Question row per language.
- A knowledgeUnit anchor (links the question to a canonical topic — §7/§13).
- An optional examVersionId (the exam context — links to the syllabus tree).
- An immutable publishedRevision (the §36 snapshot).

### The QnA model (explanatory question-and-answer content)

```prisma
model QnA {
  knowledgeUnitId     String        // §7 anchor
  languageId          String
  status              ContentStatus @default(DRAFT)
  questionText        String        // the question
  answerBody          String        // the answer (the explanation — ships inline)
  publishedRevisionId String?
  ...
}
```

QnA is the "why" layer — long-form explanations. The MCQ format from gk-hindi.in maps to the Question model (the scored objects with options + correct answer), not QnA (which is unscored explanations).

### The KnowledgeUnit model (the canonical topic anchor)

Each Question links to a KnowledgeUnit (§7 — "one canonical unit, many representations"). The unit links to a Topic (the taxonomy node — §13). The question is anchored to the unit, the unit to the topic, the topic to the taxonomy tree.

### The Translation model (the multi-language pipeline)

```prisma
model Translation {
  sourceType     TranslationSourceType  // CONTENT_ITEM | QNA | QUESTION
  sourceId       String
  targetLanguageId String
  status         TranslationStatus      // DRAFT → IN_REVIEW → APPROVED → PUBLISHED
  draftBody      String?                @db.Text
  ...
}
```

The platform already has a full translation pipeline (P9-S1) — the `aiTranslateDraft` function uses the z-ai-web-dev-sdk to translate content. The Translation model tracks the workflow (DRAFT → IN_REVIEW → APPROVED → PUBLISHED).

### The CountryLanguage model (the language activation)

```prisma
model CountryLanguage {
  countryId     String
  languageId    String
  contentStatus LanguageContentStatus  // LIVE | PLANNED
}
```

Currently India has: en (LIVE) + hi (LIVE) + 8 PLANNED languages (bn, mr, te, ta, gu, kn, or, ml). Flipping a language to LIVE is a one-line DB update.

---

## The plan — 5 sessions

### SITE-S24 — Content scraping pipeline + taxonomy mapping

**Goal:** Build a scraper that crawls gk-hindi.in, extracts MCQs (question + 4 options + correct answer), and maps them to GKSetu's taxonomy (the existing Topic tree).

**Steps:**
1. Build a Node.js scraper (`scripts/s24-scrape-gk-hindi.ts`) that:
   - Fetches each subject/category page from gk-hindi.in.
   - Parses the HTML to extract MCQs (question text, 4 options, correct answer, subject category).
   - Outputs a JSON file per subject (`scripts/s24-data/physics-mcqs.json`, etc.).
   - Handles pagination (each subject has many pages — the `?page=N` query).
   - Rate-limited (1 request per 2 seconds — respectful crawling).

2. Map the scraped subjects to GKSetu's taxonomy:
   - Physics → the `science-technology` topic (or a new `physics` sub-topic).
   - Chemistry → the `science-technology` topic (or a new `chemistry` sub-topic).
   - Biology → the `science-technology` topic (or a new `biology` sub-topic).
   - History → the `history` topic.
   - Polity → the `constitutional-framework` topic.
   - Geography → existing geography topics.
   - Economics → a new `economics` topic (if not present).
   - Sports → the `awards-honours` topic (or a new `sports` topic).
   - India GK → existing India-specific topics.
   - State GK → state-specific topics (created under the state's jurisdiction).
   - World GK → existing international topics.

3. Create new Topic nodes as needed (§13 — the taxonomy is extensible). New topics are created as `COUNTRY` scope under India (§14).

**Output:** JSON files with scraped MCQs + a taxonomy mapping table.

### SITE-S25 — English + Hindi seed (the 2 LIVE languages)

**Goal:** Seed the scraped MCQs into the Question model in English + Hindi. The source site is Hindi — the Hindi content is the scraped text; the English version is translated via the `aiTranslateDraft` function.

**Steps:**
1. Build a seed script (`scripts/s25-seed-questions-en-hi.ts`) that:
   - Reads the scraped JSON files.
   - For each MCQ: creates a KnowledgeUnit (if one doesn't exist for this topic + question) → creates a Question row in Hindi (the scraped text) → creates a Question row in English (AI-translated).
   - Sets the correct answer + the 4 options.
   - Publishes the question (status = PUBLISHED + creates a QuestionRevision).
   - Links the question to the exam syllabus (via ExamMapping — the exam's version's syllabus node → the knowledge unit).
   - Idempotent — skips questions that already exist (by questionText + languageId).

2. AI translation: uses the existing `aiTranslateDraft` function (z-ai-web-dev-sdk) to translate the Hindi question + options + explanation into English. The translation is stored as a separate Question row (languageId = English).

3. Volume management: the scraper may produce 5,000-10,000+ MCQs. The seed script processes them in batches (100 per run — re-runnable for the rest).

**Output:** 5,000-10,000 PUBLISHED Questions in Hindi + English, linked to taxonomy topics.

### SITE-S26 — 8-language translation (flip PLANNED → LIVE)

**Goal:** Translate the seeded Questions into all 8 PLANNED languages (Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Odia, Malayalam). Flip all 8 languages to LIVE.

**Steps:**
1. Build a translation script (`scripts/s26-translate-questions.ts`) that:
   - Reads the PUBLISHED Questions in Hindi (or English — the canonical source).
   - For each question: calls `aiTranslateDraft` to translate into each of the 8 languages.
   - Creates a Question row per language (with the translated questionText + options + explanation).
   - Publishes each translated question.
   - Rate-limited (the AI translation API has limits — 1 translation per 2 seconds, batched).

2. Flip the CountryLanguage rows: `contentStatus = 'LIVE'` for all 8 languages.

3. Update the homepage's language switcher: the "Soon" chips become active links (the existing UI already handles this — when contentStatus is LIVE, the chip is a link; when PLANNED, it shows "Soon").

**Output:** Every PUBLISHED Question exists in all 10 languages. All 8 PLANNED languages are now LIVE. The /hi/, /bn/, /mr/, /te/, /ta/, /gu/, /kn/, /or/, /ml/ prefixes serve real content.

### SITE-S27 — Per-language homepage + UI fixes

**Goal:** Ensure every language has a working homepage + all surfaces render correctly in that language.

**Steps:**
1. Per-language homepage: the existing homepage already uses the §35 language-fallback chain (the `home-strings.ts` file carries translations for en/hi/fr/bn/mr/te/ta/gu/kn/or/ml). Verify each language renders correctly.

2. UI fixes: check the /mcq/, /qna/, /tutorials/, /exams/ pages in each language. Fix any layout issues (RTL for Urdu if added later, font rendering for Bengali/Tamil/Telugu, etc.).

3. SEO: the sitemap already generates hreflang alternates for all LIVE languages. Once the 8 languages flip to LIVE, the sitemap will include all 10 language variants. Verify the canonical URLs are correct.

4. The language switcher in the header: all 10 languages now show as active links (no "Soon" chips).

### SITE-S28 — Exam linking + content gaps + polish

**Goal:** Link the seeded Questions to exams (via ExamMapping — the §8 requirement layer). Fill content gaps. Polish.

**Steps:**
1. Exam linking: for each exam in the platform (138 exams), check which seeded Questions are relevant (by topic). Create ExamMapping rows linking the Question's KnowledgeUnit to the exam's syllabus node. This makes the Questions appear in the exam's /mcq/ + /qna/ + tutorial chapter pages.

2. Content gaps: identify subjects/topics where the scraped content is thin (e.g., some state GK pages may have only 10-20 MCQs). Flag these for manual authoring or additional scraping.

3. Quality review: spot-check the AI translations for accuracy (especially the Tamil/Telugu/Kannada/Malayalam translations — the AI may struggle with technical terms).

4. The store + books: the content expansion means more value for the premium tier (more questions = more practice = more reason to buy). Update the book compilations to include the new content.

---

## Execution order & dependency notes

- **S24 is the foundation** — the scraper + taxonomy mapping. No translation or seeding can happen without the scraped data.
- **S25 builds on S24** — seeds the scraped data in English + Hindi (the 2 LIVE languages).
- **S26 builds on S25** — translates the seeded content into 8 more languages + flips them LIVE.
- **S27 builds on S26** — the per-language homepage + UI fixes (once the content is live in all languages).
- **S28 builds on S25** — exam linking (independent of the translation, but better to do after the content is seeded).

---

## What is NOT in this wave

- Scraping from multiple sites (only gk-hindi.in in v1 — the user can add more sources later).
- Audio/video content (text MCQs only).
- User-generated content (the scraped content is editorial-curated).
- Real-time current affairs (the scraped content is static GK — current affairs is the existing P6 feed).

---

## The pipeline state after this wave

- 5,000-10,000+ PUBLISHED MCQs across all subjects (Physics, Chemistry, Biology, History, Polity, Geography, Economics, Sports, India GK, State GK, World GK).
- Every MCQ exists in all 10 Indian languages (English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Odia, Malayalam).
- All 10 languages are LIVE (no "Soon" chips — every language link in the switcher is active).
- The /mcq/ page shows thousands of questions in every language.
- The /qna/ page shows the explanatory answers.
- The tutorials + exam pages show the linked questions in every language.
- The sitemap includes all 10 language variants for every URL.
- The store's book compilations include the expanded content.

**The user's ask:** "India की सभी भाषाओं में content publishing शुरू करना है" — this wave delivers exactly that.
