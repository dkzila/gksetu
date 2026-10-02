/**
 * GKSetu — Tutorials module: the console admin service (SITE-S9)
 * docs/learning-platform-plan.md SITE-S9 — the tutorials console cockpit
 * (/console/tutorials). A READ-ONLY dashboard: no new editor, nothing
 * persisted — the parts are already manageable (the exam mapping manager,
 * the questions console, the PYQ console); this surface only computes
 * per-exam coverage, the content gaps (chapters without lessons / practice /
 * PYQ) and the learner-walk stats, with the console linking into those
 * existing editors.
 *
 * Discipline:
 *   §14  the SAME unit gate as the public tutorials — every count here is
 *        computed through resolveReaderContext + loadSubjectMaps +
 *        isUnitVisible + mappingInEffect (imported from './service'), so the
 *        console can never disagree with what /tutorials/ serves.
 *   §35  language-scoped counts (practice/PYQ) load in the requested reader
 *        language — the console requests 'en' and the counts match the public
 *        index (no fallback swap here: the page always passes an explicit
 *        language, and lessons/chapters are canonical counts that never swap).
 *   §37  deterministic ordering (examName asc, tie examSlug asc), typed
 *        errors (TutorialsError from './service'), client-agnostic DTOs.
 *   §29  60s cachedPayload for both getters — the cockpit is an expensive
 *        aggregate over the whole market, and a 60s staleness is acceptable
 *        for a read-only dashboard (the same TTL as the public index).
 *   §30  route-gated at `exam:manage` (the S9-0 decision — no new
 *        permission); per-user progress rows are only ever read as
 *        AGGREGATES here (counts, never identities).
 */
import { z } from 'zod'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { mappingInEffect } from '@/modules/exam-mapping'
import { windowContains } from '@/modules/exams-syllabus'

import { getTutorialExam, isUnitVisible, loadLanguagePair, loadSubjectMaps, loadUnitContentCounts, resolveReaderContext } from './service'
import type {
  TutorialChapterSummary,
  TutorialsAdminExamDetail,
  TutorialsAdminExamRow,
  TutorialsAdminGapChapter,
  TutorialsAdminOverview,
} from './types'

// ---------- Query schema ----------

/** GET /api/tutorials/admin?country=&language=&exam= — the console read. */
export const tutorialsAdminQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  /** Present → the per-exam gap detail instead of the market overview. */
  exam: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Exam must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
})

export type TutorialsAdminQuery = z.infer<typeof tutorialsAdminQuerySchema>

/** Each gap list of the exam detail is capped — an honest "first N" (the page
 * shows the cap note when a list reaches this size). */
export const TUTORIALS_ADMIN_GAP_CAP = 25

/** Client-side page size the console table paginates at (mirrors the admin
 * registries' default). */
export const TUTORIALS_ADMIN_PAGE_SIZE = 20

// ---------- Progress aggregates (aggregates only — never identities) ----------

/** Per-exam learner/completion aggregates over the denormalised
 * TutorialProgress rows. Raw all-time walk counts (rows pinned to superseded
 * versions' nodes included) — the honest totals of everything learners
 * marked, computed with TWO groupBys (by examId, then by examId×userId)
 * instead of one findMany: a groupBy row per user×exam bounds the result at
 * real usage scale (§37 — designed for 138 exams × real learners). */
async function loadProgressAggregates(examIds: string[]): Promise<{
  byExam: Map<string, { learnerCount: number; completionCount: number }>
  distinctLearners: number
  totalCompletions: number
}> {
  if (examIds.length === 0) {
    return { byExam: new Map(), distinctLearners: 0, totalCompletions: 0 }
  }
  const where = { examId: { in: examIds } }
  const [byExam, byExamUser] = await Promise.all([
    db.tutorialProgress.groupBy({
      by: ['examId'],
      where,
      _count: { _all: true },
    }),
    db.tutorialProgress.groupBy({
      by: ['examId', 'userId'],
      where,
    }),
  ])
  const learnersByExam = new Map<string, number>()
  const distinctLearners = new Set<string>()
  for (const row of byExamUser) {
    learnersByExam.set(row.examId, (learnersByExam.get(row.examId) ?? 0) + 1)
    distinctLearners.add(row.userId)
  }
  const out = new Map<string, { learnerCount: number; completionCount: number }>()
  let totalCompletions = 0
  for (const group of byExam) {
    out.set(group.examId, {
      learnerCount: learnersByExam.get(group.examId) ?? 0,
      completionCount: group._count._all,
    })
    totalCompletions += group._count._all
  }
  return { byExam: out, distinctLearners: distinctLearners.size, totalCompletions }
}

/** One exam's progress aggregates (one grouped query — a row per learner). */
async function loadExamProgress(examId: string): Promise<{ learnerCount: number; completionCount: number }> {
  const perUser = await db.tutorialProgress.groupBy({
    by: ['userId'],
    where: { examId },
    _count: { _all: true },
  })
  return {
    learnerCount: perUser.length,
    completionCount: perUser.reduce((sum, group) => sum + group._count._all, 0),
  }
}

// ---------- GET /api/tutorials/admin — the market overview ----------

/**
 * The console's per-market tutorials overview (60s cached): every ACTIVE exam
 * of the market — even tree-less ones, the honest gap — with its chapter /
 * lesson / practice / PYQ counts, the lesson coverage share, and the
 * learner-walk aggregates. examName asc, tie examSlug asc (§37).
 */
export async function getTutorialsAdminOverview(input: {
  country?: string
  language?: string
}): Promise<TutorialsAdminOverview> {
  const cacheKey = ['tutorials:admin:overview', input.country ?? 'default', input.language ?? 'default'].join(':')
  return cachedPayload(cacheKey, () => loadTutorialsAdminOverview(input))
}

async function loadTutorialsAdminOverview(input: {
  country?: string
  language?: string
}): Promise<TutorialsAdminOverview> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language } = context
  const { readerLanguageId } = await loadLanguagePair(language.code)
  const { visibleTopicSlugs } = await loadSubjectMaps(input)

  // ---------- Every ACTIVE exam of the market with its current version ----------
  const exams = await db.exam.findMany({
    where: { status: 'ACTIVE', countryId: context.countryRow.id },
    select: {
      id: true,
      slug: true,
      name: true,
      organiser: true,
      level: true,
      versions: { select: { id: true, label: true, effectiveFrom: true, effectiveTo: true } },
    },
  })
  const currentVersionByExam = new Map<string, { id: string; label: string }>()
  for (const exam of exams) {
    const version = exam.versions.find((row) => windowContains(row))
    if (version) currentVersionByExam.set(exam.id, { id: version.id, label: version.label })
  }
  const examIdByVersionId = new Map<string, string>()
  for (const [examId, version] of currentVersionByExam) examIdByVersionId.set(version.id, examId)
  const versionIds = [...examIdByVersionId.keys()]

  // ---------- The whole market's trees + mappings in TWO queries (no N+1) ----------
  // The mapping select is loadTutorialsIndex's bulk select + syllabusNodeId —
  // the overview additionally needs the per-NODE lesson presence (coverage %
  // and the empty-chapter gap), which the index never computes.
  const [nodeRows, mappingRows] =
    versionIds.length > 0
      ? await Promise.all([
          db.syllabusNode.findMany({
            where: { examVersionId: { in: versionIds } },
            select: { id: true, examVersionId: true },
          }),
          db.examMapping.findMany({
            where: { examVersionId: { in: versionIds } },
            select: {
              examVersionId: true,
              syllabusNodeId: true,
              knowledgeUnitId: true,
              effectiveFrom: true,
              effectiveTo: true,
              knowledgeUnit: {
                select: {
                  id: true,
                  status: true,
                  scope: true,
                  countryId: true,
                  topic: { select: { slug: true } },
                },
              },
            },
          }),
        ])
      : [[], []]

  const nodeIdsByVersion = new Map<string, string[]>()
  for (const row of nodeRows) {
    const bucket = nodeIdsByVersion.get(row.examVersionId)
    if (bucket) bucket.push(row.id)
    else nodeIdsByVersion.set(row.examVersionId, [row.id])
  }

  // Visible in-effect mappings → per-exam unit sets + per-node unit sets (the
  // §8/§14 gate, in memory — the index pattern).
  const unitsByExam = new Map<string, Set<string>>()
  const nodeUnitsByExam = new Map<string, Map<string, Set<string>>>()
  for (const mapping of mappingRows) {
    if (!mappingInEffect(mapping, false)) continue
    if (!isUnitVisible(mapping.knowledgeUnit, context, visibleTopicSlugs)) continue
    const examId = examIdByVersionId.get(mapping.examVersionId)
    if (!examId) continue // defense in depth — only current versions were loaded
    const units = unitsByExam.get(examId) ?? new Set<string>()
    units.add(mapping.knowledgeUnit.id)
    unitsByExam.set(examId, units)
    const nodeMap = nodeUnitsByExam.get(examId) ?? new Map<string, Set<string>>()
    const nodeSet = nodeMap.get(mapping.syllabusNodeId) ?? new Set<string>()
    nodeSet.add(mapping.knowledgeUnit.id)
    nodeMap.set(mapping.syllabusNodeId, nodeSet)
    nodeUnitsByExam.set(examId, nodeMap)
  }

  // ---------- Practice/PYQ counts over the market's whole visible pool ----------
  // The same loadUnitContentCounts the public index uses, in the reader
  // language — the console's numbers are the /tutorials/ numbers.
  const allUnitIds = [...new Set([...unitsByExam.values()].flatMap((units) => [...units]))]
  const unitCounts = await loadUnitContentCounts(allUnitIds, readerLanguageId)

  // ---------- Learner-walk aggregates (aggregates only) ----------
  const examIds = exams.map((exam) => exam.id)
  const progress = await loadProgressAggregates(examIds)

  // ---------- The rows ----------
  const rows: TutorialsAdminExamRow[] = exams.map((exam) => {
    const version = currentVersionByExam.get(exam.id) ?? null
    const nodeIds = version ? (nodeIdsByVersion.get(version.id) ?? []) : []
    const chapterCount = nodeIds.length
    const nodeMap = nodeUnitsByExam.get(exam.id) ?? new Map<string, Set<string>>()
    const nodesWithLesson = nodeIds.filter((nodeId) => (nodeMap.get(nodeId)?.size ?? 0) > 0).length
    const units = unitsByExam.get(exam.id) ?? new Set<string>()
    let practice = 0
    let pyq = 0
    for (const unitId of units) {
      practice += unitCounts.questionsByUnit.get(unitId) ?? 0
      pyq += unitCounts.pyqByUnit.get(unitId) ?? 0
    }
    const examProgress = progress.byExam.get(exam.id) ?? { learnerCount: 0, completionCount: 0 }
    return {
      examId: exam.id,
      examSlug: exam.slug,
      examName: exam.name,
      organiser: exam.organiser,
      level: exam.level as TutorialsAdminExamRow['level'],
      versionLabel: version?.label ?? null,
      chapterCount,
      lessonCount: units.size,
      practiceCount: practice,
      pyqCount: pyq,
      coveragePercent: chapterCount === 0 ? 0 : Math.round((100 * nodesWithLesson) / chapterCount),
      emptyChapterCount: chapterCount - nodesWithLesson,
      learnerCount: examProgress.learnerCount,
      completionCount: examProgress.completionCount,
    }
  })
  rows.sort((a, b) => a.examName.localeCompare(b.examName) || a.examSlug.localeCompare(b.examSlug))

  // ---------- The totals ----------
  const withChapters = rows.filter((row) => row.chapterCount > 0)
  const totals: TutorialsAdminOverview['totals'] = {
    examCount: rows.length,
    chapterCount: rows.reduce((sum, row) => sum + row.chapterCount, 0),
    lessonCount: rows.reduce((sum, row) => sum + row.lessonCount, 0),
    practiceCount: rows.reduce((sum, row) => sum + row.practiceCount, 0),
    pyqCount: rows.reduce((sum, row) => sum + row.pyqCount, 0),
    avgCoveragePercent:
      withChapters.length === 0
        ? 0
        : Math.round(withChapters.reduce((sum, row) => sum + row.coveragePercent, 0) / withChapters.length),
    learnerCount: progress.distinctLearners,
    completionCount: progress.totalCompletions,
  }

  return {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exams: rows,
    totals,
  }
}

// ---------- GET /api/tutorials/admin?exam= — the per-exam gap detail ----------

/** Maps a public TOC chapter row to the console gap-chapter shape. */
function toGapChapter(chapter: TutorialChapterSummary): TutorialsAdminGapChapter {
  return {
    nodeId: chapter.id,
    nodeSlug: chapter.slug,
    title: chapter.title,
    depth: chapter.depth,
    parentTitles: chapter.parentTitles,
    lessonCount: chapter.lessonCount,
    practiceCount: chapter.practiceCount,
    pyqCount: chapter.pyqCount,
    qnaCount: chapter.qnaCount,
  }
}

/**
 * One exam's gap detail (60s cached): the exam summary block plus the THREE
 * gap lists — chapters without lessons (map a unit), chapters with lessons
 * but no practice questions (add questions), and chapters with lessons but
 * no PYQs (record provenance) — each capped at TUTORIALS_ADMIN_GAP_CAP rows.
 *
 * The chapters come from the PUBLIC getTutorialExam (60s cached itself, the
 * same §8/§14 gate + §35 counts as /tutorials/{exam}/), so a gap listed here
 * is exactly a chapter the public TOC shows empty. Unknown/inactive/
 * out-of-market exam → exam:null, the honest empty state.
 */
export async function getTutorialsAdminExamDetail(
  examSlug: string,
  input: { country?: string; language?: string }
): Promise<TutorialsAdminExamDetail> {
  const cacheKey = [
    'tutorials:admin:exam',
    input.country ?? 'default',
    input.language ?? 'default',
    examSlug,
  ].join(':')
  return cachedPayload(cacheKey, () => loadTutorialsAdminExamDetail(examSlug, input))
}

async function loadTutorialsAdminExamDetail(
  examSlug: string,
  input: { country?: string; language?: string }
): Promise<TutorialsAdminExamDetail> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language } = context

  // The slim exam row — the internal id (the mapping-manager deep-link) and
  // the current version, gated exactly like loadExamTutorial (§14).
  const examRow = await db.exam.findUnique({
    where: { slug: examSlug.toLowerCase() },
    select: {
      id: true,
      slug: true,
      name: true,
      organiser: true,
      level: true,
      countryId: true,
      status: true,
      versions: { select: { id: true, label: true, effectiveFrom: true, effectiveTo: true } },
    },
  })
  const emptyDetail: TutorialsAdminExamDetail = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exam: null,
    lessonGaps: [],
    practiceGaps: [],
    pyqGaps: [],
  }
  if (!examRow || examRow.status !== 'ACTIVE' || examRow.countryId !== context.countryRow.id) {
    return emptyDetail
  }
  const version = examRow.versions.find((row) => windowContains(row)) ?? null

  // The public TOC — chapters carry the per-node counts under the SAME gate,
  // so console gaps can never disagree with the public tutorial pages.
  const tutorial = await getTutorialExam(examRow.slug, input)
  const chapters: TutorialChapterSummary[] = tutorial.exam ? tutorial.chapters : []
  const nodesWithLesson = chapters.filter((chapter) => chapter.lessonCount > 0).length

  const examProgress = await loadExamProgress(examRow.id)

  return {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exam: {
      id: examRow.id,
      slug: examRow.slug,
      name: examRow.name,
      organiser: examRow.organiser,
      level: examRow.level as NonNullable<TutorialsAdminExamDetail['exam']>['level'],
      versionId: version?.id ?? null,
      versionLabel: version?.label ?? null,
      chapterCount: tutorial.totals.chapters,
      lessonCount: tutorial.totals.lessons,
      practiceCount: tutorial.totals.practice,
      pyqCount: tutorial.totals.pyq,
      qnaCount: tutorial.totals.qna,
      coveragePercent:
        tutorial.totals.chapters === 0
          ? 0
          : Math.round((100 * nodesWithLesson) / tutorial.totals.chapters),
      learnerCount: examProgress.learnerCount,
      completionCount: examProgress.completionCount,
    },
    lessonGaps: chapters
      .filter((chapter) => chapter.lessonCount === 0)
      .slice(0, TUTORIALS_ADMIN_GAP_CAP)
      .map(toGapChapter),
    practiceGaps: chapters
      .filter((chapter) => chapter.lessonCount > 0 && chapter.practiceCount === 0)
      .slice(0, TUTORIALS_ADMIN_GAP_CAP)
      .map(toGapChapter),
    pyqGaps: chapters
      .filter((chapter) => chapter.lessonCount > 0 && chapter.pyqCount === 0)
      .slice(0, TUTORIALS_ADMIN_GAP_CAP)
      .map(toGapChapter),
  }
}
