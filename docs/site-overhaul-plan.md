# GKSetu — Public Site Overhaul Plan (SITE series)

**Status:** ACTIVE · **Requested:** 2025-10-02 · **Owner:** main agent + subagents
**Source:** the user's 8-point instruction (navigation cleanup, "Live in" removal + languages,
home badges, sidebar exams link, Quick Mock → Mock Test, Current Affairs page + redesigns,
MCQ/QNA pages, subjects expansion) — every point is covered below, mapped to sessions.

---

## 0. Principles (apply to every change)

1. **One primary navigation** — the left sidebar is the product's navigation. The header
   carries brand + market switchers + account only. No duplicated nav sets.
2. **URLs are the product** — short, honest, no platform jargon (`/gk/` prefix is
   platform-internal vocabulary; the whole site is GK, so the prefix says nothing).
3. **SEO everywhere** — every public page gets a meaningful, keyword-aware title +
   description (English SEO keywords like *GK, Current Affairs, Exam, Mock Test, Search*
   stay in English inside translated pages — per the user's instruction), a server-built
   canonical/hreflang block, and sitemap inclusion where indexable.
4. **Only what helps the user** — no technical badges, ISO codes, internal tier/depth
   vocabulary, dispatch diagnostics or "honest system" chips on user-facing pages.
5. **Edit from the base, no redirect crutches** — the site is pre-launch; we change the
   source of truth instead of adding redirect layers. (Legacy `/gk/…` URLs keep *parsing*
   for tolerance, but nothing ever links to or builds them again.)
6. **World-class, modern, compact** — hero sections for the big surfaces, tight spacing,
   consistent visual system (emerald/teal brand, zinc neutrals, existing shadcn/ui kit).

---

## 1. URL grammar v2 (the §16 update)

| Surface | Old | New |
|---|---|---|
| Subject (topic hub) | `/gk/{subject}/` | `/{subject}/` |
| Knowledge page | `/gk/{subject}/{unit}/` | `/{subject}/{unit}/` |
| Topic-scoped mock test | `/gk/{subject}/mock-tests/{slug}/` | `/{subject}/mock-tests/{slug}/` |
| Current Affairs listing | *(none — it was the `/gk/current-affairs/` topic hub)* | `/current-affairs/` (dedicated view) |
| Current Affairs event | `/current-affairs/{slug}/` | unchanged |
| Exam directory | `/exams/` | unchanged (becomes indexable) |
| Exam page / syllabus / exam mock test | `/exams/{exam}/…` | unchanged |
| Mock test landing | `/quick-mock`, `/quick-mock/{exam}/` | `/mock-test/`, `/mock-test/{exam}/` |
| Subjects directory | *(none)* | `/subjects/` (new) |
| MCQ practice | *(none)* | `/mcq/` (new) |
| Q&A | *(none)* | `/qna/` (new) |
| User pages | `/dashboard` … `/feedback` | unchanged |

**Parse order** (after the market/country/language prefix):
system paths (`console`, `account`, `dev-track`, `p/`, reserved page slugs, `signin`,
`following`, `saved`, `onboarding`, `profile`, `dashboard`, `personalisation`,
`notifications`, `feedback`, `collections`, `mock-test`) → `exams` tree →
`current-affairs` (listing vs event slug) → `subjects` → `mcq` → `qna` → legacy `gk`
tree (tolerant, never built) → **fallback: 1 segment = subject hub, 2 = knowledge page,
3 with `mock-tests` = test runner** (unknown slugs show the honest "not available" state,
never a dead 404 page).

**Builders to update (single sources of URL truth):**
- client: `src/components/home/app-router.ts` (`buildPath`)
- server: `src/modules/seo/composition-helpers.ts` (`topicHubPath`, `knowledgePath`)
- search: `src/modules/search/query-service.ts` (`resultPath` — paths are built at query
  time, so **no reindex is needed**)
- sitemap: `src/modules/seo/sitemap-service.ts`
- every internal link/callable that opens `/gk/…` or `/quick-mock` (header, sidebar,
  footer, homepage sections, dashboard, quick-mock view, exam page, search-box parser,
  event cards, follow/share payloads that embed paths).

---

## 2. Navigation v2

**Header** (`site-header.tsx`): brand · *(hamburger `<lg`)* · country switcher · language
switcher · notifications bell · account. The four desktop nav items (Home, Current
Affairs, Exams, Mock Tests) are **removed** — the sidebar owns discovery navigation
(user's decision; the duplication served no one).

**Tablet fix (the 640–1023px dead zone):** the hamburger button becomes `lg:hidden`
(was `sm:hidden`) so tablet users get the drawer — previously 640–767px had *no
navigation at all* (hamburger hidden, nav links hidden, no sidebar) and 768–1023px had
header nav but no sidebar.

**Sidebar Discover section** (rail ≥lg + drawer <lg) — 7 clean links, all real paths:
`Home /` · `Current Affairs /current-affairs/` · `Exams /exams/` · `Subjects /subjects/`
· `Mock Tests /mock-test/` · `MCQ Practice /mcq/` · `Q&A /qna/`.
My Library + Account groups unchanged but their legacy `#/…` hrefs become clean paths.

**Footer Explore column**: same destinations as Discover (Home, Current Affairs, Exams,
Subjects, Mock Tests) — footers conventionally repeat nav; the user only objected to the
header duplication.

---

## 3. Task-by-task decisions (all 8 user points)

### Task 1 — duplicate header nav + tablet view
Remove the 4 header nav items (§2 above); hamburger at `<lg` restores full navigation on
tablets; the header stays clean at every width. Verified at 390px / 768px / 1024px+.

### Task 2 — "Live in {Country}" + languages
- The status badge renders **only when `country.status === 'COMING_SOON'`** ("Launching
  soon in {country}") — ACTIVE markets (India, France) get a clean hero with no badge.
- India gains 8 languages: Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Odia,
  Malayalam — each a `Language` row + `CountryLanguage` link with
  **`contentStatus = 'PLANNED'`** (new field; `LIVE` is the default). "Soon" chips render
  on the homepage language row and the header/drawer language switchers; PLANNED
  languages are excluded from hreflang alternates (honest SEO — the page content is
  still English-fallback), remain clickable (§35 honest fallback).
- **Homepage translation**: a UI-strings dictionary (code, not DB — chrome strings are
  product surface, not content) translates the homepage (hero, section headings, search
  placeholder, buttons, language row) into `en, hi, bn, mr, te, ta, gu, kn, or, ml` (+
  `fr` for France). SEO keywords (GK, Current Affairs, Exam, Mock Test, Search) stay in
  English inside translated copy. Home `<title>`/description templates per language.

### Task 3 — home stat badges
The three counting pills (topics / knowledge pages / exams) under the search box are
removed together with their row (no leftover gap). Meta description keeps the counts
(SEO value stays, UI noise goes).

### Task 4 — sidebar Exams → `/exams/`
Exams in Discover (and footer) navigates to the exam directory page — the scroll-to-
`#home-exams` hack is retired.

### Task 5 — Quick Mock → Mock Test
Renamed **from the base**: view `quick-mock` → `mock-test`, path `/mock-test/`, component
`MockTestView` (was `QuickMockView`), all copy "Mock Test". The page becomes a real
public landing (hero + published mock-test directory from the existing
`GET /api/mock-tests` + the personalised quick-mock section for signed-in users) so it
earns its indexable SEO title/description:
`Mock Test — Free Timed Practice for GK & Current Affairs | GKSetu`.

### Task 6 — Current Affairs + page redesigns
- `/current-affairs/` is a **dedicated listing view** (not a topic hub): compact hero
  (title + description + GK-category chips + share/follow on one row), newest-events
  feed with pagination, category filter (by primary topic), honest empty states.
  SEO: `Current Affairs — Latest GK Updates & Daily News | GKSetu` (+ per-country
  variant), server-built seo block via a new public events listing service.
- Breadcrumbs across content pages get tight spacing (`py-1`, no double margins).
- `/exams/` gets the same hero treatment + becomes **indexable** (real content, real
  canonical): `Exams — Syllabus, GK & Current Affairs Coverage | GKSetu`.
- Subject pages (`/{subject}/`): title template `{Subject} GK — Notes, Q&A & Mock Tests |
  GKSetu`, description from the subject's TopicLabel (meaningful, exam-name-bearing).
- User pages (Dashboard, Saved, Following, Notifications, Profile, Settings, Feedback):
  professional compact redesign — one clear header per page, user-relevant content only;
  technical vocabulary (tier/depth chips, channel status badges, ISO codes, mode labels,
  dispatch diagnostics) removed. SITE-S4.

### Task 7 — MCQ + QNA pages
- `GET /api/questions?subject=&exam=&language=&page=` and `GET /api/qna?…` — public,
  PUBLISHED-only listings with the honest-fallback language rules.
- `/mcq/`: hero + "browse by subject/exam" (subject chips + exam search) + inline
  practice cards (answer reveal via the existing `POST /api/questions/practice`) +
  personalised strip (followed subjects/exams) for signed-in users + general GK mode.
- `/qna/`: same skeleton — Q&A accordion cards (question + expandable answer), subject/
  exam filters, personalised strip.
- Sidebar Discover entries added (§2). Seeded practice content so the pages launch with
  substance (SITE-S3).

### Task 8 — Subjects expansion
- Seed **17 new root subjects** (DB `Topic` DOMAIN rows) + keep the existing 3
  (polity-governance, history, science-technology); `current-affairs` stays in the
  taxonomy as the events anchor but is **excluded from subject grids** (it has its own
  page + nav item). Final set (20): Polity & Governance, History, Geography, Economy &
  Business, Environment & Ecology, Biology, Physics, Chemistry, Science & Technology,
  Computer & IT, Sports, Art & Culture, Books & Authors, Awards & Honours (promoted from
  a History branch to root), Schemes & Policies, Defence & Security, International
  Relations, Static GK, Agriculture, Disaster Management.
- Each subject: SEO-meaningful canonical description (English) + `hi` label +
  description + native labels for the 8 PLANNED languages + aliases + stable order.
- `/subjects/` directory page (like `/exams/`): hero + searchable/count-badged grid.
- Homepage "Explore by subject" shows the full grid (8+ icons), still capped rows.

---

## 4. Design system for the new/redesigned pages

- **PageHero** (new shared component, `src/components/home/page-hero.tsx`): compact
  gradient-tinted band — eyebrow chip row (context/category chips, max 3), H1, one-line
  description, one action row (primary button + ghost buttons: Share/Follow inline, never
  stacked), optional meta line (counts/date). Responsive: stacks cleanly at 390px,
  single row of actions at ≥sm.
- **Breadcrumb** (`text-xs`, `py-1`, `gap-1`) — tight, top of page, no wrapper margins.
- Cards keep the existing shadcn/ui + emerald/zinc language; motion limited to the
  existing fade/slide patterns (framer-motion, 0.3s).
- Every page: sticky-footer-safe (`min-h` content), 44px touch targets, semantic
  landmarks, skeletons for async loads, honest empty states.

---

## 5. Data / DB changes

| Change | Session | Migration |
|---|---|---|
| `CountryLanguage.contentStatus` (`LIVE` default / `PLANNED`) | SITE-S2 | `prisma db push` (additive column) |
| 8 new `Language` rows + India links (PLANNED) | SITE-S2 | seed script |
| 17 new subject `Topic` rows + labels (en/hi/8) + aliases | SITE-S2 | seed script |
| MCQ (~60) + QnA (~30) seed content across subjects | SITE-S3 | seed script |
| No schema change for MCQ/QNA/subjects directory | — | — |

---

## 6. SEO matrix (titles carry `\| GKSetu` via template where applicable)

| Page | Title | Index |
|---|---|---|
| Home (per language) | `{Country} — GK, Current Affairs & Exam Preparation \| GKSetu` (translated per language, EN keywords kept) | yes |
| `/current-affairs/` | `Current Affairs — Latest GK Updates & Daily News \| GKSetu` | yes |
| `/current-affairs/{slug}/` | `{event} — GKSetu Current Affairs` | yes (unchanged) |
| `/exams/` | `Exams — Syllabus, GK & Current Affairs Coverage \| GKSetu` | **yes (was noindex)** |
| `/exams/{exam}/` | existing exam-page titles | yes (unchanged) |
| `/subjects/` | `Subjects — Explore GK by Subject \| GKSetu` | yes |
| `/{subject}/` | `{Subject} GK — Notes, Q&A & Mock Tests \| GKSetu` | yes |
| `/{subject}/{unit}/` | existing unit titles | yes (unchanged) |
| `/mock-test/` | `Mock Test — Free Timed Practice for GK & Current Affairs \| GKSetu` | **yes (was noindex)** |
| `/mcq/` | `MCQ Practice — GK Questions with Answers \| GKSetu` | yes |
| `/qna/` | `GK Q&A — Questions & Answers with Explanations \| GKSetu` | yes |
| User pages | existing private titles | noindex (unchanged) |

Sitemap gains the six indexable listing surfaces. hreflang alternates cover LIVE
languages only (SITE-S2).

---

## 7. Session plan

| Session | Scope | Ships |
|---|---|---|
| **SITE-S1** — Navigation, URL grammar & the marquee pages | §1 + §2 + tasks 1, 3, 4, 5, 6-URL/SEO, 8-URL | new router grammar, clean header/sidebar/footer, home quick wins, `/current-affairs/` (hero, feed API), `/mock-test/` (landing), `/subjects/` (+ API), SEO strings, sitemap |
| **SITE-S2** — Subjects corpus + languages + homepage i18n | tasks 2, 8 | 20-subject corpus with translations, 8 PLANNED languages + Soon chips + hreflang honesty, homepage UI translation (10 languages) |
| **SITE-S3** — MCQ & QNA practice | task 7 | public question/QnA APIs, `/mcq/` + `/qna/` pages, seeded practice content |
| **SITE-S4** — Design overhaul | task 6 (user pages) | 7 user pages compact redesign, `/exams/` + subject-page polish, full responsive/tablet QA sweep |

Each session: implement → lint + type-check → agent-browser E2E (desktop + 390px +
768px) → worklog append → session doc `docs/sessions/SITE-Sx.md` → commit + push
GitHub (`dkzila/globiq`).

---

## 8. Verification checklist (per session)

- [ ] Lint + `tsc --noEmit` clean; dev server stable (memory ceiling).
- [ ] Agent-browser: every changed page renders + golden path works at 1440px, 768px,
      390px (sidebar drawer, hero stacking, footer sticky).
- [ ] No `/gk/` or `/quick-mock` link remains in built UI (grep + click-through).
- [ ] SEO head check: title/description/canonical per view; noindex only on private
      pages; sitemap contains the new listings.
- [ ] Old content pages (events, exams, units) still open from search + home + feeds.
