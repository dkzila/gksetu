# CONSOLE-S1 — The GKSetu Operating Console

**Session family:** CONSOLE (docs/console-master-plan.md) · **After:** INDIA-CORPUS-S1
**Scope:** the user's direct brief — a proper multi-page console where the company's whole
internal work happens (edit/publish/delete everything, WordPress-simple), the current
single-page console preserved as Dev Track, managed About/Contact/Privacy pages, and a
no-redeploy integrations/settings page (Analytics, Search Console, ads.txt, FB code, API
keys). World-class, modern, energetic, professional, compact design with its own sidebar,
header and footer.

## What was built

### 1. Foundation (schema + backend)

- **Prisma:** `SiteSetting` (global + per-country key/value registry) and `SitePage`
  (managed static pages with a publish-snapshot model) — pushed to Supabase.
- **Permissions:** `settings:manage`, `pages:manage` (ADMIN-only in v1) added to the RBAC
  vocabulary + audit actions for both.
- **APIs:** `/api/settings` (GET/PUT/DELETE, admin) + `/api/settings/public`
  (whitelisted public payload); `/api/pages` + `/api/pages/{slug}` (public) +
  `/api/pages/admin*` (CRUD + publish/unpublish transition); `/ads.txt` served from
  settings; `/api/seo/robots` appends settings-managed extra directives; root layout
  `generateMetadata` reads GSC/Bing verification tokens server-side.
- **Injection:** `SiteIntegrations` client component — GA gtag, GTM, Meta pixel, custom
  head/body HTML (script-execution-safe materialisation), mounted once in the app shell.

### 2. The shell

- `/console` + 18 sub-pages through the existing catch-all router (`consolePath`); the
  old Foundation Console preserved verbatim at **`/dev-track`** (own dark chrome, never
  deleted); `/account` and legacy `#account` map to `/console/account`.
- Dark fixed sidebar — 7 permission-filtered groups, 20 items — plus the console's own
  compact header (title, View site, account menu with role/permissions) and its own
  sticky footer. Mobile: sidebar becomes a Sheet. Anonymous visitors get a dark
  console-grade sign-in panel (token-based identity, same Bearer contract).

### 3. The 20 management pages (6 parallel agents)

| Group | Pages |
|---|---|
| Overview | Dashboard (health, counts, quick access, recent audit), Analytics (§32 families), Audit log (facets, before/after) |
| Content | Posts (content items + lifecycle + sources links), Current Affairs (events + 4-tab links manager), Knowledge Units, Sources, Entities, Translations |
| Assessment | Questions (MCQ), Q&A, Mock Tests |
| Exams | Exams list (138-exam corpus, server-side search), Exam detail (versions, syllabus tree, mappings, import), Taxonomy (tree + labels/aliases) |
| Site | Pages (About/Contact/Privacy + custom), Settings (Integrations / Custom keys / Countries & languages) |
| People | Editorial Board (task board), Staff (workspace invites with one-time passwords) |
| System | Account (profile, sessions, permissions), Dev Track link |

### 4. Managed public pages

- About, Contact, Privacy Policy seeded PUBLISHED with real content; the site footer's
  "Company" column is live from `GET /api/pages` (publish a page → it appears, no
  redeploy). Reserved slugs render at `/{slug}`; custom pages at `/p/{slug}`.

### 5. QA-found fixes (worth remembering)

- **`useConsoleApi` referential instability** — the hook returned a fresh object per
  render; pages with `api` in effect deps refetched infinitely (644× 429s on
  /api/settings, dev server crash). Fixed by memoising on `token`.
- **Settings key regex vs camelCase** — `integration.ga.measurementId` (the registry's
  own vocabulary) failed the lowercase-only key pattern. Fixed (segments allow camelCase
  after the first lowercase char).

## Verification (agent-browser E2E)

- Admin login → dashboard command center renders (health, 136-exam catalog count, quick
  access, recent audit).
- All 18 sub-pages render with live data via SPA navigation.
- UPSC CSE detail: 2 versions, 2026 current (15 nodes, 5 mappings), full syllabus tree
  + mappings management render.
- **Integrations golden path END-TO-END:** GA `G-TEST123456` saved in Console → Settings
  → served by `/api/settings/public` → **gtag.js + dataLayer actually injected on the
  public site** → test value cleared.
- `/about` + footer Company links live; `/dev-track` intact; mobile 390px sign-in OK;
  public homepage unaffected; lint + `tsc --noEmit` clean; no console errors.

## Git

- Committed as `CONSOLE-S1` and pushed to `github.com/dkzila/globiq`.

## Next sessions

- **CONSOLE-S2:** bulk actions, saved filters, ⌘K palette, dashboard activity feed,
  per-surface deep QA, exam-import UX polish, page revision history.
- **CONSOLE-S3:** rich-text editor for posts/pages, media library, scheduling calendar,
  staff notification center, per-role RBAC QA pass.
