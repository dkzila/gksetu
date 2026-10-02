/**
 * GKSetu — Tutorials module: the combined tutorial service (SITE-S9)
 * docs/learning-platform-plan.md SITE-S9 — /tutorials/combined/?exams=a,b:
 * the §11 union engine's building blocks re-applied under this module's
 * STRICTER §14 gate. A combined tutorial is NOT stored (§46.3): it is
 * COMPUTED as the union of several exams' tutorials —
 *   · per exam: loadExamTutorial (ACTIVE exam of the market, current §36
 *     version, in-effect §8 mappings onto VERIFIED §14-visible units — the
 *     same loader as the exam tutorial pages, so per-exam counts can never
 *     disagree with them);
 *   · the union: canonical unit id (strictly canonical dedup, never title
 *     similarity — §11 step 6), each united unit keeping the STRONGEST
 *     per-exam mapping priority (CORE > SUPPORTING > LOW) plus the exam's
 *     syllabus-node titles that carry it (≤3, deterministic DFS order);
 *   · grouping by canonical SUBJECT (loadSubjectMaps' root-subject map),
 *     subject label asc (§37);
 *   · practice: the group's PUBLISHED questions in the payload language
 *     (PracticeQuestionCard shape — option LABELS only, §22; the correctAnswer
 *     NEVER ships) with the PYQ subset marked by provenance badges only —
 *     the practice block IS the PYQ block, never duplicated.
 *
 * §35 decision (documented): the language pool is the union's questions; when
 * the reader's language carries none and English does, the WHOLE payload
 * swaps to English + fallback:true (the index rule) — lessons are canonical
 * units (language-free) and never swap.
 *
 * §16 SEO: /tutorials/combined/ is INDEXABLE — the picker state (no ?exams=)
 * is the canonical content and every query variant shares the same canonical,
 * so no noindexReason is ever set here.
 *
 * §29 60s cachedPayload (the anonymous getter rule — the empty-picker payload
 * caches under its own ':empty' suffix). §37 deterministic ordering, typed
 * errors (TOO_MANY_EXAMS = 400). §38 public surface — everyone, no auth.
 */
import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { buildCanonicalUrl } from '@/modules/country-locale'
import { buildPageSeo } from '@/modules/seo'
import { loadQuestionProvenanceMap } from '@/modules/pyq'
import { MAX_COMBINED_EXAMS, resolveTopicLabels } from '@/modules/exam-mapping'
import { windowContains } from '@/modules/exams-syllabus'

import type {
  CombinedSubjectGroup,
  CombinedTutorials,
  CombinedTutorialExam,
  CombinedTutorialUnit,
  CombinedUnitDepth,
} from './types'
import {
  CANONICAL_LANGUAGE_CODE,
  MAPPING_PRIORITY_RANK,
  TutorialsError,
  loadExamTutorial,
  loadLanguagePair,
  loadScopeLastModified,
  loadSubjectMaps,
  loadUnitContentCounts,
  optionLabels,
  resolveReaderContext,
  tutorialsPath,
} from './service'
import type { ExamTutorialData } from './service'

// ---------- Constants ----------

/** The surface's own SEO identity — shared by the picker state and every
 * exam-set variant (one canonical, §16). */
const COMBINED_SEO_TITLE = 'Combined Exam Tutorials — One Study Plan across Exams | GKSetu'
const COMBINED_SEO_DESCRIPTION =
  'Combine multiple exam syllabi into one study plan — shared lessons, per-exam depth, practice questions and previous year questions in one place. Free on GKSetu.'

/** The §11 engine's honest note, verbatim — an exam that resolved but carries
 * no current version contributed nothing and says why. */
const NO_VERSION_NOTE = 'No syllabus version is in effect yet — nothing to combine for this exam.'

/** Mapping-priority sort rank → priority (the MAPPING_PRIORITY_RANK inverse;
 * CORE first — the strongest mapping of an exam onto a unit wins its chip). */
const PRIORITY_BY_RANK = new Map<number, CombinedUnitDepth['priority']>(
  (Object.keys(MAPPING_PRIORITY_RANK) as CombinedUnitDepth['priority'][]).map((priority) => [
    MAPPING_PRIORITY_RANK[priority] ?? 1,
    priority,
  ])
)

/** The maximum chapter titles a depth chip carries (deterministic cap). */
const DEPTH_CHIP_CHAPTER_CAP = 3

// ---------- Union accumulation (§11 steps 3–6 under the §14 gate) ----------

/** One exam's contribution to a united unit — the chip seed. */
interface DepthSeed {
  /** Position of the exam in the resolved request order (§37 deterministic). */
  examIndex: number
  examSlug: string
  examName: string
  /** The STRONGEST mapping priority rank of this exam onto this unit. */
  priorityRank: number
  /** The exam's syllabus-node titles carrying this unit — DFS order, deduped. */
  chapters: string[]
}

/** One united unit's accumulator — per-exam seeds keyed by exam id. */
interface UnitAccumulator {
  depths: Map<string, DepthSeed>
}

// ---------- Public service ----------

/**
 * The combined tutorial (SITE-S9): the computed union of 0–8 exams'
 * tutorials, grouped by canonical subject (60s cached). An EMPTY exam set is
 * the picker state — the honest empty payload, never an error; more than
 * MAX_COMBINED_EXAMS refs is a typed TOO_MANY_EXAMS 400. Refs are deduplicated
 * case-insensitively (first occurrence wins) exactly like the API route's
 * parseCombinedExamRefs — direct callers get the same semantics defensively.
 */
export async function getCombinedTutorials(input: {
  country?: string
  language?: string
  exams: string[]
}): Promise<CombinedTutorials> {
  // Defensive dedup (the route already ran parseCombinedExamRefs — the §11
  // step 1 collect-a-set rule, mirrored verbatim).
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

  if (refs.length > MAX_COMBINED_EXAMS) {
    throw new TutorialsError(
      'TOO_MANY_EXAMS',
      `Combine at most ${MAX_COMBINED_EXAMS} exams at once — you sent ${refs.length}`
    )
  }

  // §29: 60s cache — the exam set sorted lowercase so every request order of
  // the same set shares one entry; the empty picker payload caches separately.
  const cacheKey = [
    'tutorials:combined',
    input.country ?? 'default',
    input.language ?? 'default',
    refs.length > 0 ? [...refs].map((ref) => ref.toLowerCase()).sort().join(',') : 'empty',
  ].join(':')
  return cachedPayload(cacheKey, () => loadCombinedTutorials(input, refs))
}

async function loadCombinedTutorials(
  input: { country?: string; language?: string },
  refs: string[]
): Promise<CombinedTutorials> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId, topicSlugById, visibleTopicSlugs } = await loadSubjectMaps(input)

  // ---------- Resolve every ref (parallel; request order preserved) ----------
  // loadExamTutorial answers null for unknown/inactive/out-of-market exams and
  // for exams with no current version — the two honest outcomes below.
  const settled = await Promise.allSettled(
    refs.map((ref) => loadExamTutorial(ref, context, visibleTopicSlugs))
  )

  // A REJECTED load is a database failure, not an unknown exam — rethrow (a
  // half-union must never render as if it were the whole truth).
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason
  }

  const unknownRefs: string[] = []
  const examDtos: CombinedTutorialExam[] = []
  const resolved: Array<{ examIndex: number; data: ExamTutorialData }> = []
  const seenExamIds = new Set<string>()

  // First pass: the fulfilled non-null resolutions, deduplicated by exam id
  // (first occurrence wins — the union is over exams, not strings, §11).
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index]
    if (result.status !== 'fulfilled' || result.value == null) continue
    const data = result.value
    if (seenExamIds.has(data.exam.id)) continue // a later dupe ref — silently dropped
    seenExamIds.add(data.exam.id)
    resolved.push({ examIndex: resolved.length, data })
    examDtos.push({
      slug: data.exam.slug,
      name: data.exam.name,
      organiser: data.exam.organiser,
      level: data.exam.level,
      versionLabel: data.version.label,
      note: null,
      unitCount: data.distinctUnitIds.length,
    })
  }

  // Second pass over the nulls: separate "resolved but no current version"
  // (an honest exams[] entry with a note — the DTO's documented state) from
  // the truly unknown/inactive/out-of-market refs (unknownRefs). ONE batched
  // probe, only when some refs resolved to nothing.
  const nullRefs = settled
    .map((result, index) => ({ result, ref: refs[index] }))
    .filter((entry): entry is { result: PromiseFulfilledResult<ExamTutorialData | null>; ref: string } => {
      if (entry.result.status !== 'fulfilled') return false // rejections rethrew above
      return entry.result.value == null
    })
    .map((entry) => entry.ref)

  if (nullRefs.length > 0) {
    const probeRows = await db.exam.findMany({
      where: { slug: { in: nullRefs.map((ref) => ref.toLowerCase()) } },
      select: {
        id: true,
        slug: true,
        name: true,
        organiser: true,
        level: true,
        status: true,
        countryId: true,
        versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
      },
    })
    const probeBySlug = new Map(probeRows.map((row) => [row.slug, row]))
    for (const ref of nullRefs) {
      const row = probeBySlug.get(ref.toLowerCase())
      // An ACTIVE exam of THIS market whose only problem is the missing
      // current version stays in exams[] with the honest note; everything
      // else (unknown slug, inactive, another market's exam — no enumeration,
      // §14/§15) lands in unknownRefs under the ref the client sent.
      if (
        row &&
        row.status === 'ACTIVE' &&
        row.countryId === context.countryRow.id &&
        !row.versions.some((version) => windowContains(version)) &&
        !seenExamIds.has(row.id)
      ) {
        seenExamIds.add(row.id)
        examDtos.push({
          slug: row.slug,
          name: row.name,
          organiser: row.organiser,
          level: row.level as CombinedTutorialExam['level'],
          versionLabel: null,
          note: NO_VERSION_NOTE,
          unitCount: 0,
        })
      } else {
        unknownRefs.push(ref)
      }
    }
  }

  // ---------- The union: per exam, walk the tree DFS (§11 steps 3–6) ----------
  // Chapter titles collect in the tree's DFS order (priority asc, id asc per
  // level — deterministic, §37); per (exam, unit) the STRONGEST mapping
  // priority wins the chip.
  const union = new Map<string, UnitAccumulator>()
  for (const { examIndex, data } of resolved) {
    for (const node of data.tree.dfs) {
      const mappings = data.mappingsByNode.get(node.id) ?? []
      for (const mapping of mappings) {
        const rank = MAPPING_PRIORITY_RANK[mapping.priority] ?? 1
        let accumulator = union.get(mapping.knowledgeUnitId)
        if (!accumulator) {
          accumulator = { depths: new Map() }
          union.set(mapping.knowledgeUnitId, accumulator)
        }
        const existing = accumulator.depths.get(data.exam.id)
        if (!existing) {
          accumulator.depths.set(data.exam.id, {
            examIndex,
            examSlug: data.exam.slug,
            examName: data.exam.name,
            priorityRank: rank,
            chapters: [node.name],
          })
        } else {
          if (rank < existing.priorityRank) existing.priorityRank = rank
          if (!existing.chapters.includes(node.name)) existing.chapters.push(node.name)
        }
      }
    }
  }
  const unionUnitIds = [...union.keys()]

  // ---------- §35: the union's language pool ----------
  // The whole surface's questions; empty in the reader's language → the whole
  // payload swaps to English + fallback (the index rule — lessons are
  // canonical and never swap).
  let unitCounts = await loadUnitContentCounts(unionUnitIds, readerLanguageId)
  let languageId = readerLanguageId
  let fallback = false
  const poolEmpty = unitCounts.questionsByUnit.size === 0
  if (poolEmpty && language.code !== CANONICAL_LANGUAGE_CODE && englishLanguageId != null) {
    const englishCounts = await loadUnitContentCounts(unionUnitIds, englishLanguageId)
    if (englishCounts.questionsByUnit.size > 0) {
      unitCounts = englishCounts
      languageId = englishLanguageId
      fallback = true
    }
  }

  // ---------- The union's unit rows (one batched query, the chapter pattern) ----------
  const unitRows =
    unionUnitIds.length > 0
      ? await db.knowledgeUnit.findMany({
          where: { id: { in: unionUnitIds } },
          select: {
            id: true,
            slug: true,
            canonicalName: true,
            canonicalSummary: true,
            type: true,
            difficulty: true,
            topicId: true,
            topic: { select: { slug: true, canonicalName: true } },
          },
        })
      : []
  // §35 topic labels for the lessons (requested → country default → canonical).
  const topicLabels = await resolveTopicLabels(
    [...new Set(unitRows.map((row) => row.topicId))],
    language.code,
    defaultLanguageCode
  )

  // ---------- The practice pool (final language, labels only §22) ----------
  // One query over the union's units — the chapter service's questionRows
  // pattern verbatim; PYQ = the provenance-bearing subset (badge-only, never
  // a duplicated list).
  const questionRows =
    unionUnitIds.length > 0
      ? await db.question.findMany({
          where: {
            status: 'PUBLISHED',
            publishedRevisionId: { not: null },
            languageId,
            knowledgeUnit: { id: { in: unionUnitIds } },
          },
          orderBy: [{ publishedRevision: { publishedAt: 'desc' } }, { id: 'asc' }],
          select: {
            id: true,
            knowledgeUnit: { select: { slug: true, canonicalName: true, topicId: true } },
            publishedRevision: {
              select: { questionText: true, optionsJson: true, difficulty: true, publishedAt: true },
            },
          },
        })
      : []
  const questionProvenance = await loadQuestionProvenanceMap(
    questionRows.filter((row) => row.publishedRevision != null).map((row) => row.id)
  )
  const questions = questionRows
    .filter((row) => row.publishedRevision != null)
    .map((row) => {
      const unit = row.knowledgeUnit
      return {
        id: row.id,
        questionText: row.publishedRevision!.questionText,
        options: optionLabels(row.publishedRevision!.optionsJson),
        difficulty: row.publishedRevision!.difficulty as 'BASIC' | 'INTERMEDIATE' | 'ADVANCED',
        subject: subjectByTopicId.get(unit.topicId) ?? null,
        unit: {
          slug: unit.slug,
          canonicalName: unit.canonicalName,
          topicSlug: topicSlugById.get(unit.topicId) ?? unit.slug,
        },
        provenance: questionProvenance.get(row.id) ?? [],
      }
    })

  // ---------- Group by canonical subject (§37: label asc, tie by slug) ----------
  const groupSeeds = new Map<
    string,
    { subjectSlug: string; subjectLabel: string; units: CombinedTutorialUnit[]; strongestRanks: number[] }
  >()
  const questionsBySubject = new Map<string, typeof questions>()
  for (const row of unitRows) {
    const subject = subjectByTopicId.get(row.topicId)
    if (!subject) continue // defense in depth — the §14 gate guarantees membership
    const accumulator = union.get(row.id)
    if (!accumulator) continue // unreachable (the row set IS the union id set)

    // Per-exam chips in request order (the seeds' insertion order), capped titles.
    const depths: CombinedUnitDepth[] = [...accumulator.depths.values()]
      .sort((a, b) => a.examIndex - b.examIndex)
      .map((seed) => ({
        examSlug: seed.examSlug,
        examName: seed.examName,
        priority: PRIORITY_BY_RANK.get(seed.priorityRank) ?? 'SUPPORTING',
        chapters: seed.chapters.slice(0, DEPTH_CHIP_CHAPTER_CAP),
      }))
    const strongestRank = depths.reduce(
      (strongest, depth) => Math.min(strongest, MAPPING_PRIORITY_RANK[depth.priority] ?? 1),
      2
    )
    const unit: CombinedTutorialUnit = {
      unitSlug: row.slug,
      title: row.canonicalName,
      summary: row.canonicalSummary,
      type: row.type,
      difficulty: row.difficulty,
      lessonPath: buildCanonicalUrl(
        { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
        { code: language.code },
        defaultLanguageCode,
        [row.topic.slug, row.slug]
      ),
      topicSlug: row.topic.slug,
      topicLabel: topicLabels.get(row.topicId)?.label ?? row.topic.canonicalName,
      depths,
      practiceCount: unitCounts.questionsByUnit.get(row.id) ?? 0,
      pyqCount: unitCounts.pyqByUnit.get(row.id) ?? 0,
      isShared: depths.length > 1,
    }

    const group = groupSeeds.get(subject.slug) ?? {
      subjectSlug: subject.slug,
      subjectLabel: subject.label,
      units: [],
      strongestRanks: [],
    }
    group.units.push(unit)
    group.strongestRanks.push(strongestRank)
    groupSeeds.set(subject.slug, group)
  }
  // Bucket the practice pool per group by each question's unit subject.
  for (const question of questions) {
    if (!question.subject) continue // defense in depth (same gate as the units)
    const bucket = questionsBySubject.get(question.subject.slug) ?? []
    bucket.push(question)
    questionsBySubject.set(question.subject.slug, bucket)
  }

  const groups: CombinedSubjectGroup[] = [...groupSeeds.values()]
    .map((group) => {
      const bucket = questionsBySubject.get(group.subjectSlug) ?? []
      return {
        subjectSlug: group.subjectSlug,
        subjectLabel: group.subjectLabel,
        // Strongest overall priority first (CORE via MAPPING_PRIORITY_RANK),
        // then canonicalName asc, then unitSlug (§37 deterministic).
        units: group.units
          .map((unit, index) => ({ unit, rank: group.strongestRanks[index] ?? 1 }))
          .sort(
            (a, b) =>
              a.rank - b.rank ||
              a.unit.title.localeCompare(b.unit.title) ||
              a.unit.unitSlug.localeCompare(b.unit.unitSlug)
          )
          .map((entry) => entry.unit),
        practiceCount: bucket.length,
        pyqCount: bucket.filter((question) => question.provenance.length > 0).length,
        questions: bucket,
      }
    })
    .sort(
      (a, b) =>
        a.subjectLabel.localeCompare(b.subjectLabel) || a.subjectSlug.localeCompare(b.subjectSlug)
    )

  // ---------- Stats (the honest totals of exactly what ships) ----------
  const stats = {
    examCount: examDtos.length,
    subjectCount: groups.length,
    unitCount: union.size,
    sharedUnitCount: [...union.values()].filter((accumulator) => accumulator.depths.size > 1).length,
    practiceCount: groups.reduce((total, group) => total + group.practiceCount, 0),
    pyqCount: groups.reduce((total, group) => total + group.pyqCount, 0),
  }

  // ---------- SEO (§16 — INDEXABLE: the picker state is the content) ----------
  const lastModified = await loadScopeLastModified(unionUnitIds, languageId)
  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => tutorialsPath(context, code, ['tutorials', 'combined']),
    lastModified,
  })

  const payload: CombinedTutorials = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exams: examDtos,
    unknownRefs,
    groups,
    stats,
    seo,
    seoTitle: COMBINED_SEO_TITLE,
    seoDescription: COMBINED_SEO_DESCRIPTION,
  }
  if (fallback) payload.fallback = true
  return payload
}
