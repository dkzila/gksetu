# SITE-S8 — Tutorials core

**Date:** 2026-10-02 · **Plan:** docs/learning-platform-plan.md §SITE-S8 · **Status:** COMPLETE — `440b699`.

## Delivered
- **Computed learning path**: 138 exam tutorials from the frozen syllabus trees + mappings (SyllabusNode.slug backfilled 1007/1007; TutorialProgress the only new state).
- **Reading experience**: chapter page with sticky right rail (desktop) / sticky sub-header + Chapters drawer (mobile/tablet), Mark-as-learned toggle, 5 content blocks (Lessons → Practice → PYQs → Q&A → Mock tests), footer prev/next.
- **Personalised index** (the user's ask): "Your exams" first (goal exams + progress bars + Continue), then the searchable directory.
- **Unification**: inline-practice extracted to one shared component (mcq + pyq + chapters).
- Sitemap 'tutorials' type: 1,137 URLs market-scoped.

## Verified
All modes at 1280+390 · reveal on 3 surfaces · mark-learned round-trip (rail + TOC + restore) · /hi/tutorials/ · drawer · goal state restored after the personalisation test. Note: /api/goal PUT takes `exams`/`topics` keys (slugs), not `examSlugs`.

## Follow-ups (SITE-S9)
/tutorials/combined/ (§11 union grouped by subject) · tutorials console cockpit (per-exam coverage + gap deep-links) · topic-landing PYQ aggregate lines · cross-links + responsive sweep.
