/**
 * GKSetu — Tutorials module: the syllabus-derived goal subjects service
 * (SITE-S11, docs/learning-flow-plan.md S11-B).
 *
 * GET /api/exams/subjects?exams=a,b&country=&language= — which subjects
 * derive from the chosen exams' CURRENT syllabi, so onboarding step 3 can
 * pre-select them (the user's decision: subjects come from the exams'
 * syllabus, pre-ticked, untickable, others addable).
 *
 * The derivation is the tutorials §14 gate VERBATIM — per exam:
 * loadExamTutorial (ACTIVE exam of the market, current §36 version,
 * in-effect §8 mappings onto VERIFIED §14-visible units — the SAME loader as
 * the tutorial pages, so the derived subjects can never disagree with the
 * lessons a learner actually sees) → the mapped units' DISTINCT topics →
 * §35 labels from the same tree snapshot (loadSubjectMaps). Nothing is
 * stored (§46.3); nothing is guessed — an exam that resolves to nothing is
 * recorded in `skipped`, never silently dropped (the combined precedent).
 *
 * Disciplines: §14 market scoping · §35 reader-language labels · §29 60s
 * cachedPayload (public, user-independent) · §37 deterministic ordering
 * (label asc, slug asc; examSlugs in request order) · §38 public surface ·
 * §30 typed TOO_MANY_EXAMS 400 above the ref cap (the goal's own vocabulary
 * — this endpoint serves goal declaration).
 *
 * GRAPH SAFETY (the SITE-S11 lesson): the tutorials module is reachable from
 * the CLIENT bundle (a client view imports a module whose index re-exports
 * the seo sitemap walk, which imports tutorials/index). Anything tutorials
 * imports therefore evaluates in the browser — @/lib/db (Prisma) survives
 * Next's browser stub, but the personalisation module's index drags
 * identity-access (node:crypto scrypt + promisify at module scope) and
 * CRASHES the page. The cap is therefore declared HERE in lockstep with the
 * personalisation module's MAX_GOAL_EXAMS (10) instead of imported — the
 * API route (a server-only file, exempt from the client graph) re-checks
 * against the personalisation constant itself.
 */
import { cachedPayload } from '@/lib/payload-cache'

import type { DerivedSubjectRow, ExamSubjects } from './types'
import { TutorialsError, loadExamTutorial, loadSubjectMaps, resolveReaderContext } from './service'

/** The maximum exam refs one derivation accepts — the goal's own cap
 * (personalisation's MAX_GOAL_EXAMS, kept in lockstep BY HAND; see the graph
 * safety note above for why it is not imported). */
export const MAX_EXAM_SUBJECT_REFS = 10

// ---------- Public service ----------

/**
 * The syllabus-derived subjects of 0–10 exams (60s cached). An EMPTY exam
 * set is the honest empty payload (the UI skips the derived group), never an
 * error; more than MAX_GOAL_EXAMS refs is a typed TOO_MANY_EXAMS 400. Refs
 * are deduplicated case-insensitively, first occurrence wins (the §11 step 1
 * collect-a-set rule, mirrored defensively like the combined service).
 */
export async function getExamSubjects(input: {
  country?: string
  language?: string
  exams: string[]
}): Promise<ExamSubjects> {
  const seen = new Set<string>()
  const refs: string[] = []
  for (const ref of input.exams) {
    const trimmed = ref.trim()
    if (trimmed.length === 0) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(trimmed)
  }

  if (refs.length > MAX_EXAM_SUBJECT_REFS) {
    throw new TutorialsError(
      'TOO_MANY_EXAMS',
      `Derive subjects from at most ${MAX_EXAM_SUBJECT_REFS} exams at once — you sent ${refs.length}`
    )
  }

  // §29: 60s cache — the exam set sorted lowercase so every request order of
  // the same set shares one entry; the empty set caches separately (it is a
  // cheap honest empty, but consistency with the combined key grammar costs
  // nothing and keeps the cache walk predictable).
  const cacheKey = [
    'tutorials:exam-subjects',
    input.country ?? 'default',
    input.language ?? 'default',
    refs.length > 0 ? [...refs].map((ref) => ref.toLowerCase()).sort().join(',') : 'empty',
  ].join(':')

  return cachedPayload(cacheKey, () => deriveSubjects(refs, input))
}

// ---------- The derivation ----------

/** The §35-style honesty note shipped when nothing derived (never an error). */
const NOTHING_DERIVED_NOTE =
  "These exams' current syllabi carry no mapped verified content yet — nothing to derive. Browse all subjects instead."

async function deriveSubjects(
  refs: string[],
  input: { country?: string; language?: string }
): Promise<ExamSubjects> {
  const context = await resolveReaderContext(input)
  const { visibleTopicSlugs, labelBySlug } = await loadSubjectMaps(input)

  // slug → the accumulator (which exams carry it). Iterating the request
  // order keeps examSlugs deterministic (§37) with zero re-sorts.
  const bySlug = new Map<string, { label: string; examSlugs: string[] }>()
  const exams: ExamSubjects['exams'] = []
  const skipped: string[] = []

  for (const ref of refs) {
    // The SAME loader as the tutorial pages — the §14 gate (ACTIVE exam of
    // the market, current version, in-effect mappings onto VERIFIED
    // market-visible units) decides what "this exam's syllabus" means.
    const data = await loadExamTutorial(ref, context, visibleTopicSlugs)
    if (!data) {
      // Unknown/inactive/foreign exam, or no version in effect — honest
      // skip, never a guessed contribution (the combined precedent).
      skipped.push(ref)
      continue
    }

    exams.push({ slug: data.exam.slug, name: data.exam.name, code: data.exam.code })

    const seenUnits = new Set<string>()
    for (const mappings of data.mappingsByNode.values()) {
      for (const mapping of mappings) {
        // A mapping row appears under one node per ExamMapping row; the same
        // unit mapped to several nodes contributes its topic ONCE per exam.
        if (seenUnits.has(mapping.knowledgeUnitId)) continue
        seenUnits.add(mapping.knowledgeUnitId)

        const slug = mapping.knowledgeUnit.topic.slug
        const existing = bySlug.get(slug)
        if (existing) {
          if (!existing.examSlugs.includes(data.exam.slug)) existing.examSlugs.push(data.exam.slug)
        } else {
          // The §14 gate already required this slug to be in the visible
          // tree — labelBySlug carries its §35 label; the slug fallback is
          // defense in depth, never a rendered miss.
          bySlug.set(slug, { label: labelBySlug.get(slug) ?? slug, examSlugs: [data.exam.slug] })
        }
      }
    }
  }

  const subjects: DerivedSubjectRow[] = [...bySlug.entries()]
    .map(([slug, value]) => ({ slug, label: value.label, examSlugs: value.examSlugs }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.slug.localeCompare(b.slug)) // §37

  return {
    subjects,
    exams,
    skipped,
    note: refs.length > 0 && subjects.length === 0 ? NOTHING_DERIVED_NOTE : null,
  }
}
