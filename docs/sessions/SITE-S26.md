# SITE-S26 — Translation Scale-Up

**Date:** 2026-10-08
**Goal:** Scale up the translation pipeline from SITE-S25's ~1,000 translations to cover all 61 subjects × 9 languages.

## Summary

SITE-S26 improved the translation infrastructure with a robust per-invocation translator (`s26-translate-one.ts`) and a Node.js wrapper (`s26-run-translator.ts`) that spawns child processes for each subject × language combination. This approach is crash-resistant — each child process is short-lived and saves its own progress.

## What was done

### 1. Per-invocation translator (`scripts/s26-translate-one.ts`)

The SITE-S25 translator was a long-running process that crashed when the LLM SDK threw 400 (content-filter) or 429 (rate-limit) errors. The new S26 translator processes ONE subject × ONE language per invocation:

- Each invocation does at most ~50 LLM calls (a few minutes).
- A crash only loses the current batch, not the whole run.
- Progress is saved to the JSON cache file after each batch.
- 400 content-filter errors are soft-failed (logged + skipped, not retried).
- 429 rate-limit errors trigger exponential backoff (5s/10s/15s/20s, 4 attempts).
- `unhandledRejection` and `uncaughtException` handlers prevent process death.

### 2. Node.js wrapper (`scripts/s26-run-translator.ts`)

Spawns `bun scripts/s26-translate-one.ts` for each subject × language combination using `child_process.spawn`. Features:

- Handles child crashes gracefully (the loop continues).
- SIGHUP handler for background execution.
- Progress heartbeat every 3 subjects.
- Final summary with per-language counts.

### 3. Translation progress

- **agriculture-gk**: fully translated across all 9 languages (50 MCQs each = 450 translations).
- **gk-quiz**: partially translated (some batches hit content-filter).
- Total cached translations: 1,486 (up from 1,222 at session start).

### 4. DB seeding

All available translations were seeded into the database. Current DB state:

| Language | Code | Questions |
|----------|------|-----------|
| Hindi | hi | 10,948 |
| English | en | 347 |
| Bengali | bn | 235 |
| Gujarati | gu | 215 |
| Kannada | kn | 170 |
| Malayalam | ml | 165 |
| Marathi | mr | 139 |
| Odia | or | 115 |
| Tamil | ta | 100 |
| Telugu | te | 95 |
| **Total** | | **~12,529** |

## Challenges

### LLM API rate limiting (429)

The LLM API throttled after ~100 calls, significantly limiting translation throughput in this session. The pipeline is fully built and idempotent — when the API rate limit resets, future sessions can continue by running:

```bash
bun scripts/s26-run-translator.ts --limit 50
```

### Content filter (400)

Some MCQs (especially those touching sensitive political, military, or religious topics) are rejected by the LLM's content filter. These are soft-failed — the translator logs them and moves on to the next batch. This is expected behavior; not all content can be machine-translated.

### Background process stability

The bash wrapper (`s26-run-translator.sh`) kept dying when child processes crashed. The Node.js wrapper (`s26-run-translator.ts`) with `child_process.spawn` + SIGHUP handling is more robust.

## Files created

- `scripts/s26-translate-one.ts` — per-invocation translator (ONE subject × ONE language)
- `scripts/s26-run-translator.ts` — Node.js wrapper (spawns children for all subjects × languages)
- `scripts/s26-run-translator.sh` — bash wrapper (alternative)

## How to continue (SITE-S27)

When the LLM API rate limit resets, run:

```bash
# Translate all subjects (50 MCQs each × 9 languages)
bun scripts/s26-run-translator.ts --limit 50

# Or one language at a time
bun scripts/s26-run-translator.ts --lang en --limit 50

# Then seed the new translations
bun scripts/s25-seed-translations.ts
```

The pipeline is fully idempotent — re-running only translates what's missing.
