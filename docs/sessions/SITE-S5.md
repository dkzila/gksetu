# SITE-S5 — The deploy fix

**Date:** 2026-10-02 · **Plan:** the deployment blocker for everything SITE-S1…S4 built
**Status:** COMPLETE — committed `a2b6de9`, pushed to `dkzila/gksetu`.

## The problem

Every Vercel build since commit `375eb4e` (the SITE-plan docs commit — even a docs-only
commit runs the full build) failed in the TypeScript phase with the same error:

```
./scripts/console-s1-seed.ts:146:18
Type error: Property 'sitePage' does not exist on type
'PrismaClient<{ datasources: { db: { url: string; }; }; }, never, DefaultArgs>'.
```

That blocked **every** SITE session (S1–S4) from deploying — the entire 8-point overhaul
existed only on GitHub and in the sandbox, never on gksetu.vercel.app.

## Root cause

A **stale generated Prisma client in Vercel's build cache**:

1. `@prisma/client`'s types live in `node_modules/.prisma/client` — they only exist after
   `prisma generate` runs, and the only thing that ran it was `@prisma/client`'s own
   dependency `postinstall` hook.
2. Vercel restores `node_modules` from its build cache, and `bun install` with an unchanged
   lockfile is a no-op ("Checked 846 installs … no changes") — **dependency lifecycle
   scripts are not re-run**. So the client generated at first-install (whose schema
   predated CONSOLE-S1's `SitePage` model) was reused forever, across every build.
3. `schema.prisma` in the repo *does* define `model SitePage` — local dev always
   regenerated (tsc/eslint clean in every session), which is why this only surfaced on
   Vercel.
4. `scripts/*.ts` were inside the `next build` type-check program (tsconfig `include:
   **/*.ts`), so an **ops seed script** — code that never runs in production — was what
   failed the production build. (`src/modules/site-pages/service.ts` uses `db.sitePage`
   too; with the same stale client the app code would fall next.)

## The fix (double enforcement + structural hardening)

1. **`postinstall: prisma generate`** (package.json) — the root package's lifecycle
   scripts run on every `bun install`, **including no-op installs** (verified live: a
   no-change `bun install` still regenerates the client — exactly Vercel's cached path).
2. **`build: prisma generate && next build && bash scripts/postbuild.sh`** — the exact
   Vercel command regenerates the client itself, so a stale client is impossible even if
   postinstall were somehow skipped.
3. **Ops scripts can never block a deploy again**: `scripts/` added to tsconfig `exclude`
   (out of the `next build` type-check program) with a dedicated `tsconfig.scripts.json`;
   `bun run type-check` now checks BOTH (`tsc --noEmit` for the app +
   `tsc --noEmit -p tsconfig.scripts.json` for the ops scripts). An unrunnable seed script
   is an ops problem, not a production outage.
4. **`/s1b-probe` deleted** — the temporary CONSOLE-S1-B verification probe marked
   "DELETE AFTER USE" was still a live public route rendering internal console components.

## Verification

- `bun run build` — the exact Vercel command — passes locally end-to-end: prisma generate
  → Turbopack compile → **TypeScript clean** → all routes built (static + dynamic) →
  postbuild takes the Vercel path. (Local note: the build needs the dev daemon stopped —
  the type-check worker OOMs on the 4GB sandbox otherwise; not a Vercel issue, Vercel's
  log shows TypeScript completing there.)
- `bun run type-check` — both programs (app + scripts) clean.
- Dev daemon respawned after the build; preview healthy (`/api/health` 200).
- Pushed `a2b6de9` → Vercel redeploy verified live (freshness probe: `/api/qna` returns
  JSON from SITE-S3 code — the old deploy returned the catch-all HTML).

## Follow-ups

- None for this fix. The queued work (India exam publishing, console rebuild follow-ups)
  now deploys normally on push.
