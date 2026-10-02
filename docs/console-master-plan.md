# GKSetu Console — Master Plan (the company's internal operating system)

> Session family: **CONSOLE-S1, S2, S3…** (kicks off after INDIA-CORPUS-S1)
> Owner surface: `/console/*` — staff-only, token-gated, `noindex`.
> The public site (country homepages, topic hubs, exams directory, knowledge
> pages) keeps its own header/footer — the console never reuses them.

## 1. Why

The P1→P10 sessions built a complete API-first backend (49 Prisma models,
~37 API route groups, 90+ write endpoints with role-based permissions) but the
staff surface for it was a single scrolling page — the Foundation Console —
where every module demo lived as one section. Operating a real company
(content team, exam ops, support) needs a **proper console**: separate pages,
WordPress-simple management (list → edit → publish), analytics, and settings —
including the code-injection settings (Analytics, Search Console, ads.txt, FB
pixel, API keys) that previously required redeploying.

## 2. What the old console becomes

The Foundation Console (`ConsoleView`) is **preserved, not deleted**, at
**`/dev-track`** (the build-verification surface: health, module map, phase
roadmap, every §-referenced demo). The header's "Console" link now goes to
`/console` (the new operating console). `/console/dev-track` sidebar entry
links there too. Nothing is lost.

## 3. Information architecture (the sidebar)

| Group | Page | Path | Permission (nav visibility) | Backing API |
|---|---|---|---|---|
| Overview | Dashboard | `/console` | any authenticated | `/api/health`, `/api/analytics/*`, `/api/audit` |
| Overview | Analytics | `/console/analytics` | `analytics:read` | `/api/analytics/product`, `/api/analytics/insights` |
| Overview | Audit log | `/console/audit` | `audit:read` | `/api/audit` |
| Content | Posts | `/console/posts` | `content:manage` | `/api/content/admin/items` (+ transitions, sources) |
| Content | Current Affairs | `/console/current-affairs` | `current-affairs:manage` | `/api/current-affairs/admin/events` (+ links, transitions) |
| Content | Knowledge Units | `/console/knowledge` | `knowledge:manage` | `/api/knowledge/admin/units` |
| Content | Sources | `/console/sources` | `source:manage` | `/api/content/admin/sources` |
| Content | Entities | `/console/entities` | `entities:manage` | `/api/entities/admin` |
| Content | Translations | `/console/translations` | `translations:manage` | `/api/translations` |
| Assessment | Questions (MCQ) | `/console/questions` | `question:manage` | `/api/questions/admin` |
| Assessment | Q&A | `/console/qna` | `qna:manage` | `/api/qna/admin` |
| Assessment | Mock Tests | `/console/mock-tests` | `mocktest:manage` | `/api/mock-tests/admin` |
| Exams | Exams | `/console/exams` (+ `/{id}` detail) | `exam:manage` | `/api/exams/admin/exams` (+ versions, nodes, mappings, import) |
| Exams | Taxonomy | `/console/taxonomy` | `taxonomy:manage` | `/api/taxonomy/admin/*` |
| Site | Pages | `/console/pages` | `pages:manage` (new) | `/api/pages/admin` (new) |
| Site | Settings | `/console/settings` | `settings:manage` (new) | `/api/settings` (new) + `/api/countries`, `/api/languages` |
| People | Editorial | `/console/editorial` | `editorial:work` | `/api/editorial/*` |
| People | Staff | `/console/staff` | `staff:manage` | `/api/workspaces/*/staff` |
| System | Account | `/console/account` | any authenticated | `/api/auth/*`, `/api/profile` |
| System | Dev Track | `/dev-track` | any staff (link) | the preserved Foundation Console |

Nav items a role cannot use are hidden — and the server re-checks every
operation anyway (§20: the UI is affordance, never the gate).

## 4. New backend (the only schema additions this family)

### 4.1 `SiteSetting` — editable platform/market settings (the no-redeploy settings)

- `countryId` (null = platform-global) + `key` + `value (Text)` — composite
  unique `(countryId, key)`.
- **Public-facing keys** (served unauthenticated by `GET /api/settings/public`,
  injected into the site): `integration.ga.measurementId`,
  `integration.gtm.containerId`, `integration.gsc.verificationToken`,
  `integration.bing.verificationToken`, `integration.facebook.pixelId`,
  `integration.headCode`, `integration.bodyStartCode`, `ads.txt`,
  `robots.extraDirectives`.
- **Private keys** (admin-only read — never public): anything else the team
  adds (search-engine API keys, third-party tokens…) — the Settings page has a
  free-form key/value section exactly like WordPress.
- Injection points:
  - `layout.tsx` `generateMetadata` → Google/Bing verification metas (server,
    per-request, DB read).
  - `SiteIntegrations` client component (mounted once in the app shell) →
    GA gtag, GTM, FB pixel, head/body-start custom HTML.
  - `/ads.txt` route handler → the `ads.txt` value (text/plain).
  - `/api/seo/robots` → appends `robots.extraDirectives`.

### 4.2 `SitePage` — managed static pages (About / Contact / Privacy / custom)

- `slug` (unique), `title`, `body` (working copy), `status`
  (DRAFT/PUBLISHED), `publishedTitle`/`publishedBody` (the publish snapshot —
  the ContentItem revision pattern, simplified), `showInFooter`,
  `sortOrder`, `seoTitle`, `seoDescription`.
- Public rendering: top-level reserved slugs (`/about`, `/contact`,
  `/privacy-policy`, `/terms`, `/disclaimer`) + `/p/{slug}` for custom pages.
  The footer lists every PUBLISHED page with `showInFooter` (live from
  `GET /api/pages`).
- Admin: `GET/POST /api/pages/admin`, `PATCH/DELETE /api/pages/admin/{id}`,
  `POST /api/pages/admin/{id}/transition` (`publish`/`unpublish`).

### 4.3 New permissions

`settings:manage`, `pages:manage` — ADMIN-only in v1 (both are platform-level
objects; market-scoped settings/pages are a later iteration).

## 5. Console shell & design language

- **Own chrome**: fixed dark sidebar (zinc-950, emerald accent — the GKSetu
  brand), compact header (page title + breadcrumb, view-site link, account
  menu), compact footer (build info, DB status, session). Mobile: sidebar
  becomes a Sheet. The root site's header/footer are never used here.
- **Design**: world-class, modern, energetic, professional, compact —
  12–13px body text in tables, tight paddings, emerald/amber status accents,
  dark sidebar, light canvas, Framer-Motion-grade transitions kept subtle.
- **Auth gate**: token-based (the same `useAuth` Bearer contract); an inline
  sign-in panel (email + password) replaces the console for anonymous
  visitors. Roles: READER sees only Account; WRITER sees their content
  surfaces; COUNTRY_ADMIN their market's; ADMIN everything.
- **Shared toolkit** (`src/components/console/ui/`): `consoleFetch` (envelope
  + Bearer), `ResourceTable` (columns, skeletons, empty states, pagination),
  `FormDialog` + field primitives, `StatusBadge`, `ConsolePageHeader`,
  `useResourceList`. Every management page is built from these — the
  WordPress-simple loop: **list → search/filter → create/edit dialog →
  publish/transition → delete**.

## 6. Session plan

- **CONSOLE-S1 (this session) — the full operating console.**
  Foundation: schema + settings/pages APIs + ads.txt/robots/verification
  injection + `/console/*` router + shell + toolkit. Then every management
  page wired to the existing admin APIs (Dashboard, Analytics, Audit,
  Posts, Current Affairs, Knowledge, Sources, Entities, Translations,
  Questions, Q&A, Mock Tests, Exams + detail, Taxonomy, Pages, Settings
  incl. Integrations & Country/Language config, Editorial, Staff, Account).
  Seed: default settings + About/Contact/Privacy published. Push to GitHub.
- **CONSOLE-S2 — operations depth.** Bulk actions (bulk publish/retire),
  saved filters, dashboard activity feed, keyboard command palette (⌘K),
  per-surface deep QA, exam-import UX, revision history for pages.
- **CONSOLE-S3 — reach.** Rich-text/markdown editor upgrade for posts and
  pages, media library, scheduled-publishing calendar, notification center
  for staff, RBAC narrowing QA pass per role.

## 7. Non-goals (v1)

- No separate Next.js route-per-page: the console renders through the same
  optional catch-all + client router as the public site (one deployable).
- No real-time collaboration; polling/refresh is enough.
- No market-scoped settings pages (global + per-country override data model
  exists, UI is global-first).
