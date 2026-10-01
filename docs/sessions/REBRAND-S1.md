# Session Report — REBRAND-S1: GlobIQ → GKSetu (full platform rename)

**Status:** ✅ Complete
**Type:** Rebrand session (the direct user request; no Master Plan feature
stage — the §43 session counter does not advance)

## Context

The user set the platform's name: **GKSetu** (gksetu.com is available and
will be the domain; for now the Vercel free subdomain stays). The rename had
to cover every branding surface — names, wordmark/logo, env vars, the demo
credentials — with the logo specified precisely: "GK" and "Setu" written
together as one word, two different colours, looking right.

## What was done

### 1. The rename sweep (code + configs)

- **267 files** sed-swept in one pass (`src/`, `prisma/`, `scripts/`,
  `README.md`, `package.json`, `next.config.ts`, `.env.example`,
  `docs/vercel-deployment.md`, `.github/workflows/ci.yml`) with the ordered
  rules `GLOBIQ_DATABASE_URL→GKSETU_DATABASE_URL`,
  `GLOBIQ_PUBLIC_BASE_URL→GKSETU_PUBLIC_BASE_URL`, `GlobIQ→GKSetu`,
  `GLOBIQ→GKSETU`, `globiq→gksetu`. Verified: zero old-brand references
  remain in the sweep set.
- What the lowercase rule deliberately catches and renames: the auth token
  prefix `globiq_` → `gksetu_` (token.ts — validation is a SHA-256 hash
  lookup, so existing sessions survive; only new tokens carry the prefix),
  the localStorage keys (`gksetu-auth`, `gksetu-market` — one-time re-login
  for anyone mid-session), the `gksetu:locale-config-changed` event name,
  `package.json` name → `gksetu`.
- **Env vars renamed:** `GLOBIQ_DATABASE_URL` → `GKSETU_DATABASE_URL` and
  `GLOBIQ_PUBLIC_BASE_URL` → `GKSETU_PUBLIC_BASE_URL` — schema.prisma
  `env()` regenerated (`db:generate`), `.env` + `.env.example` updated. The
  timing is deliberate: nothing is deployed yet, so no Vercel variables had
  to be migrated.
- **Master plan doc:** `git mv GlobIQ_Master_Plan.md GKSetu_Master_Plan.md`
  with the title block rebranded and an explicit rename note. Its body is
  the historical plan record — not rewritten (the rename changed the
  platform's name, not its history). Every code reference
  (`GKSetu_Master_Plan.md`, health `spec`, README link) follows the new name.
- **Historical records untouched by design:** `docs/sessions/*`,
  `worklog.md`, historical DB audit rows — they record what happened under
  the name that existed then.

### 2. The logo + brand assets (the user's precise spec)

- **Wordmark:** "GK" and "Setu" set together as one word in two tones —
  **GK in emerald-700, Setu in zinc-900**, extrabold, tight tracking —
  applied in the site header (with the "GK · Current Affairs · Exams"
  tagline) and the site footer. Verified in the live DOM via computed
  colours.
- **The badge mark:** the emerald→teal rounded square now carries a **bridge
  glyph** (deck + arch + three pillars, custom SVG) — *setu* means bridge;
  the mark says the name in the language the audience thinks in.
- **og.png (1216×640) + icon.png (1024×1024) regenerated** by rendering
  purpose-built HTML at exact viewport sizes in the browser (Geist verified
  loaded — the app's own typeface): the OG card is the badge + two-tone
  wordmark + tagline + `gksetu.com`; the icon is the white bridge on the
  emerald gradient. Both serve 200; real PNGs at exact dimensions.

### 3. Database migration (one-time, `scripts/rebrand-to-gksetu.ts`)

The seed never overwrites existing users (`update: {}` — "never overwrite a
manually-changed password on re-seed"), so the rebrand did it explicitly:

- The **seven §45 demo/staff accounts**: emails moved to `@gksetu.dev` AND
  passwords re-hashed to the new `GKSetu-Dev-*` scheme (scrypt via the app's
  own `hashPassword`).
- **23 emails moved in total** across two runs (the second run's fix: the
  `@e2e.globiq.dev` variant escaped the first `@globiq.` pattern — the
  matcher now uses the bare brand token; census enforces 0 leftovers).
- Idempotency proven: re-running skips everything ("already migrated").
- Seed constants (sed'd) now match the migrated DB exactly — future seed
  runs stay no-op creates.

### 4. GitHub + domain plan

- **Repo renamed:** `dkzila/globiq` → **`dkzila/gksetu`** (PATCH via API;
  GitHub auto-redirects the old URLs; local remote updated; `ls-remote`
  verified). `docs/vercel-deployment.md` updated for the full domain plan:
  name the Vercel project `gksetu` at import → free subdomain
  **`gksetu.vercel.app`**; when `gksetu.com` is bought, add it in Vercel
  Domains and update `GKSETU_PUBLIC_BASE_URL` → `https://gksetu.com`.

### 5. Verification (live, not assumed)

- `/api/health` → `service.name: "GKSetu"`, `spec: "GKSetu_Master_Plan.md
  v2.0"`, database connected on Supabase through the renamed
  `GKSETU_DATABASE_URL`.
- **Login with the new credentials** `admin@gksetu.dev` /
  `GKSetu-Dev-Admin-1` → 200, role ADMIN, token carries the `gksetu_`
  prefix; token persisted under the `gksetu-auth` localStorage key.
- Agent-browser: homepage, header wordmark (two tones verified via computed
  colours), footer, #/signin flow, **console via footer** ("Foundation
  console | GKSetu", admin email visible in the console), `og.png`/`icon.png`
  200; zero page/console errors; 390px mobile and 1280px desktop both
  `scrollWidth == clientWidth`; screenshots
  (`docs/screenshots/rebrand-*.png`).
- `tsc` + `eslint` clean; `dev.log` all 200s.

## Files

Sweep: 267 files (see §1). New: `scripts/rebrand-to-gksetu.ts`,
`/home/z/gksetu-og.html` + `/home/z/gksetu-icon.html` (render sources, kept
outside the repo), regenerated `public/og.png` + `public/icon.png`,
`docs/sessions/REBRAND-S1.md` (this file). Renamed: the master plan doc, the
GitHub repo. Local-only: `.env` (var renamed, gitignored).

## Test credentials (the live set, post-rename)

| Account | Email | Password | Role / reach |
|---|---|---|---|
| Platform owner | `admin@gksetu.dev` | `GKSetu-Dev-Admin-1` | ADMIN — the whole console, every market |
| India admin | `in-admin@gksetu.dev` | `GKSetu-Dev-INAdmin-1` | COUNTRY_ADMIN — IN market |
| France admin | `fr-admin@gksetu.dev` | `GKSetu-Dev-Fr-Admin-1` | COUNTRY_ADMIN — FR market |
| UK admin | `uk-admin@gksetu.dev` | `GKSetu-Dev-Uk-Admin-1` | COUNTRY_ADMIN — GB (announced market) |
| Writer (IN, all languages) | `writer-in@gksetu.dev` | `GKSetu-Dev-Writer-1` | WRITER — IN workspace |
| Writer (IN, Hindi) | `writer-hi@gksetu.dev` | `GKSetu-Dev-Writer-Hi-1` | WRITER — IN, Hindi-scoped |
| Writer (FR) | `writer-fr@gksetu.dev` | `GKSetu-Dev-Writer-Fr-1` | WRITER — FR workspace |
| Test reader | `audit-reader@gksetu.test` | `Audit-Reader-1` | READER — public account (anyone can also self-register at #/signin) |

## Next

Vercel go-live per the updated `docs/vercel-deployment.md` (project name
`gksetu` → `gksetu.vercel.app`; the two `GKSETU_*` variables; custom domain
`gksetu.com` when bought).
