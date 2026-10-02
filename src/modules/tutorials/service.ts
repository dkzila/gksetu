/**
 * GKSetu — Tutorials module: the computed tutorial service (SITE-S8)
 * docs/learning-platform-plan.md SITE-S8 — a tutorial is NOT stored: it is
 * COMPUTED from the exam's frozen syllabus tree (the TOC — loadVersionNodes,
 * §36), its in-effect ExamMappings (the lessons — loadVersionMappings +
 * mappingInEffect, §8) and the existing practice/PYQ/QnA/mock layers.
 * 136 exams already carry trees + mappings → tutorials exist day-one, zero
 * per-exam config. Nothing is persisted here except user progress (the
 * sibling progress-service).
 *
 * Disciplines mirrored from the family (the SITE-S3/SITE-S7 patterns):
 *   §19  PUBLISHED + a live revision is the public gate — every served
 *        question/QnA/mock text comes from the immutable revision snapshot.
 *   §22  scored discipline — the correctAnswer NEVER ships on any tutorial
 *        payload (option labels only; the key is revealed per-question by
 *        POST /api/questions/practice).
 *   §14  market scoping — a mapped unit is tutorial-visible iff VERIFIED,
 *        GLOBAL or the reader country's own, and anchored to a topic visible
 *        in the market's tree (a chapter is never more visible than its
 *        parts; the practice-listing gate, applied uniformly so lesson and
 *        practice counts can never disagree).
 *   §35  reader-language content with the honest, labelled English fallback:
 *        all language-scoped counts/cards load in the reader's language;
 *        when that language carries NO content for the surface's pool and
 *        English does, the WHOLE payload swaps to English + fallback:true
 *        (the practice-listing "both lists swap together" rule, documented
 *        per getter below). Lessons are canonical units (language-free) and
 *        never swap.
 *   §16  canonical /tutorials/… paths via buildCanonicalUrl + buildPageSeo.
 *   §29  60s cachedPayload for the three anonymous getters (never progress).
 *   §37  deterministic ordering (DFS reading order, priority-then-name
 *        lessons, newest-published cards), typed errors, client-agnostic DTOs.
 *   §38  public surface — everyone, no auth.
 *
 * Query discipline (no per-node N+1, designed for 138 exams): the index
 * batch-loads every current version's nodes+mappings in TWO queries and
 * aggregates in memory; the TOC/chapter load one version's rows once and
 * derive every count from per-unit groupBys (three queries per language
 * attempt, shared by every chapter row).
 */
import { z } from 'zod'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import {
  buildCanonicalUrl,
  findConfiguredCountryStatusByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import type { PublicCountry } from '@/modules/country-locale'
import { buildPageSeo } from '@/modules/seo'
import { getPublicTree } from '@/modules/taxonomy'
import type { PublicTopicNode } from '@/modules/taxonomy'
import { loadQuestionProvenanceMap, loadQnaProvenanceMap } from '@/modules/pyq'
import { loadVersionMappings, loadVersionNodes, mappingInEffect, resolveTopicLabels } from '@/modules/exam-mapping'
import type { MappingRow, NodeRow } from '@/modules/exam-mapping'
import { windowContains } from '@/modules/exams-syllabus'

import type {
  TutorialChapter,
  TutorialChapterInfo,
  TutorialChapterSummary,
  TutorialExam,
  TutorialExamRef,
  TutorialLesson,
  TutorialMockTestCard,
  TutorialsIndex,
  TutorialsIndexExam,
} from './types'

// ---------- Typed errors (mapped to HTTP by the route handlers, §37) ----------

export type TutorialsErrorCode = 'COUNTRY_NOT_FOUND'

export class TutorialsError extends Error {
  readonly code: TutorialsErrorCode
  readonly status: number

  constructor(code: TutorialsErrorCode, message: string) {
    super(message)
    this.name = 'TutorialsError'
    this.code = code
    this.status = 404
  }
}

/** Maps a thrown TutorialsError to envelope data (§37); null for others. */
export function toTutorialsErrorResponse(
  error: unknown
): { message: string; code: TutorialsErrorCode; status: number } | null {
  if (error instanceof TutorialsError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Constants + query schemas ----------

/** The platform's canonical language — the §35 honest fallback target. */
const CANONICAL_LANGUAGE_CODE = 'en'
/** MappingPriority → sort rank for lesson ordering (CORE first, LOW last). */
const MAPPING_PRIORITY_RANK: Record<string, number> = { CORE: 0, SUPPORTING: 1, LOW: 2 }
/** Node ids are cuids — a chapterRef that matches resolves by id (slug otherwise). */
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** The shared ?country=&language= of every public tutorials GET. */
export const tutorialsQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type TutorialsQuery = z.infer<typeof tutorialsQuerySchema>

// ---------- Shared reader-context helpers (the practice-listing pattern) ----------

/** The resolved reader context of one public tutorials request. */
interface TutorialsContext {
  publicCountry: PublicCountry
  countryRow: { id: string; status: string }
  language: { code: string; name: string }
  defaultLanguageCode: string
}

/** Resolves the reader context, surfacing locale failures as the typed
 * COUNTRY_NOT_FOUND (the practice-listing precedent). */
async function resolveReaderContext(input: {
  country?: string
  language?: string
}): Promise<TutorialsContext> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new TutorialsError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }

  const [publicCountry, countryRow] = await Promise.all([
    getPublicCountry(resolution.country.isoCode),
    findConfiguredCountryStatusByIso(resolution.country.isoCode),
  ])
  if (!publicCountry || !countryRow) {
    throw new TutorialsError('COUNTRY_NOT_FOUND', 'Country not available')
  }

  return {
    publicCountry,
    countryRow,
    language: { code: resolution.language.code, name: resolution.language.name },
    defaultLanguageCode: publicCountry.defaultLanguage.code,
  }
}

/**
 * Resolves the reader-language row plus the canonical English row — the
 * §35 exposure pair (the practice-listing precedent, verbatim).
 */
async function loadLanguagePair(readerCode: string): Promise<{
  readerLanguageId: string
  englishLanguageId: string | null
}> {
  const codes = readerCode === CANONICAL_LANGUAGE_CODE
    ? [readerCode]
    : [readerCode, CANONICAL_LANGUAGE_CODE]
  const rows = await db.language.findMany({
    where: { code: { in: codes }, status: 'ACTIVE' },
    select: { id: true, code: true },
  })
  const reader = rows.find((row) => row.code === readerCode)
  if (!reader) {
    // Unreachable through resolveLocaleContext (it only resolves configured
    // ACTIVE languages) — a loud invariant, never a silent fallback.
    throw new Error(`Reader language "${readerCode}" resolved but not ACTIVE — §35 invariant breach`)
  }
  return {
    readerLanguageId: reader.id,
    englishLanguageId: rows.find((row) => row.code === CANONICAL_LANGUAGE_CODE)?.id ?? null,
  }
}

/**
 * The market's visible tree resolved into the maps the tutorial surfaces
 * need (root-subject labels for cards, topic slugs for unit links, and the
 * visible-topic-slug set of the §14 unit gate). The taxonomy snapshot is
 * cache-served — no extra database round-trips.
 */
async function loadSubjectMaps(input: { country?: string; language?: string }): Promise<{
  subjectByTopicId: Map<string, { slug: string; label: string }>
  topicSlugById: Map<string, string>
  visibleTopicSlugs: Set<string>
}> {
  const tree = await getPublicTree({ country: input.country, language: input.language })
  const subjectByTopicId = new Map<string, { slug: string; label: string }>()
  const topicSlugById = new Map<string, string>()
  const visibleTopicSlugs = new Set<string>()
  const walk = (nodes: PublicTopicNode[], root: PublicTopicNode) => {
    for (const node of nodes) {
      subjectByTopicId.set(node.id, { slug: root.slug, label: root.label })
      topicSlugById.set(node.id, node.slug)
      visibleTopicSlugs.add(node.slug)
      walk(node.children, root)
    }
  }
  for (const root of tree) walk([root], root)
  return { subjectByTopicId, topicSlugById, visibleTopicSlugs }
}

/**
 * The §16 /tutorials/ path family: …/tutorials/, …/tutorials/{exam}/,
 * …/tutorials/{exam}/{chapter}/ (market-scoped, the pyq path precedent).
 */
function tutorialsPath(context: TutorialsContext, languageCode: string, segments: string[]): string {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: languageCode },
    context.defaultLanguageCode,
    segments
  )
}

// ---------- The §14 tutorial unit gate + content-count aggregates ----------

/** The unit fields the §14 gate reads (satisfied by both the MappingRow
 * include and the index's slim bulk select). */
interface TutorialUnitLike {
  status: string
  scope: string
  countryId: string | null
  topic: { slug: string }
}

/**
 * A mapped unit is tutorial-visible iff its canonical record is VERIFIED,
 * GLOBAL or the reader country's own, and its topic is visible in the
 * market's tree — the practice-listing §14 clause (applied uniformly to
 * lessons AND their questions so the counts can never disagree).
 */
function isUnitVisible(
  unit: TutorialUnitLike,
  context: TutorialsContext,
  visibleTopicSlugs: Set<string>
): boolean {
  return (
    unit.status === 'VERIFIED' &&
    (unit.scope === 'GLOBAL' || unit.countryId === context.countryRow.id) &&
    visibleTopicSlugs.has(unit.topic.slug)
  )
}

/** Per-unit PUBLISHED content counts of one language (three groupBys, no N+1). */
interface UnitContentCounts {
  questionsByUnit: Map<string, number>
  /** The provenance-bearing subset (PYQ — SITE-S7). */
  pyqByUnit: Map<string, number>
  qnaByUnit: Map<string, number>
}

async function loadUnitContentCounts(unitIds: string[], languageId: string): Promise<UnitContentCounts> {
  if (unitIds.length === 0) {
    return { questionsByUnit: new Map(), pyqByUnit: new Map(), qnaByUnit: new Map() }
  }
  const unitIn = { id: { in: unitIds } }
  const published = {
    status: 'PUBLISHED' as const,
    publishedRevisionId: { not: null },
    languageId,
  }
  const [questionGroups, pyqGroups, qnaGroups] = await Promise.all([
    db.question.groupBy({
      by: ['knowledgeUnitId'],
      where: { ...published, knowledgeUnit: unitIn },
      _count: { _all: true },
    }),
    db.question.groupBy({
      by: ['knowledgeUnitId'],
      where: { ...published, knowledgeUnit: unitIn, provenance: { some: {} } },
      _count: { _all: true },
    }),
    db.qnA.groupBy({
      by: ['knowledgeUnitId'],
      where: { ...published, knowledgeUnit: unitIn },
      _count: { _all: true },
    }),
  ])
  return {
    questionsByUnit: new Map(questionGroups.map((group) => [group.knowledgeUnitId, group._count._all])),
    pyqByUnit: new Map(pyqGroups.map((group) => [group.knowledgeUnitId, group._count._all])),
    qnaByUnit: new Map(qnaGroups.map((group) => [group.knowledgeUnitId, group._count._all])),
  }
}

/** PUBLISHED EXAM-scoped mock tests of many versions in one language —
 * versionId → count (the index/TOC aggregate). */
async function loadMockTestCountsByVersion(
  versionIds: string[],
  languageId: string
): Promise<Map<string, number>> {
  if (versionIds.length === 0) return new Map()
  const rows = await db.mockTest.findMany({
    where: {
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      scopeType: 'EXAM',
      examVersionId: { in: versionIds },
      languageId,
    },
    select: { examVersionId: true },
  })
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.examVersionId == null) continue // EXAM-scoped rows always carry one — defense in depth
    counts.set(row.examVersionId, (counts.get(row.examVersionId) ?? 0) + 1)
  }
  return counts
}

/** Parses a stored questionIdsJson into its length (the card's questionCount). */
function questionCountOf(questionIdsJson: string): number {
  try {
    const parsed: unknown = JSON.parse(questionIdsJson)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0 // a malformed row never surfaces a half-parsed count
  }
}

/** Parses a stored optionsJson into the option LABELS only (§22 — no keys,
 * the practice-listing parser verbatim). */
function optionLabels(optionsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(optionsJson)
    if (!Array.isArray(parsed)) return []
    return parsed.map((option) => {
      if (typeof option === 'string') return option
      if (option != null && typeof option === 'object' && 'text' in option) {
        return String((option as { text: unknown }).text)
      }
      return String(option)
    })
  } catch {
    return [] // a malformed row is filtered out by the revision gate, never surfaced half-parsed
  }
}

/** The newest live-revision publication among the visible questions/Q&As of
 * a unit scope (the honest lastmod, the practice-listing precedent). */
async function loadScopeLastModified(unitIds: string[], languageId: string): Promise<Date | null> {
  if (unitIds.length === 0) return null
  const where = {
    status: 'PUBLISHED' as const,
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: { id: { in: unitIds } },
  }
  const [latestQuestion, latestQna] = await Promise.all([
    db.question.findFirst({
      where,
      orderBy: { publishedRevision: { publishedAt: 'desc' } },
      select: { publishedRevision: { select: { publishedAt: true } } },
    }),
    db.qnA.findFirst({
      where,
      orderBy: { publishedRevision: { publishedAt: 'desc' } },
      select: { publishedRevision: { select: { publishedAt: true } } },
    }),
  ])
  const dates = [
    latestQuestion?.publishedRevision?.publishedAt ?? null,
    latestQna?.publishedRevision?.publishedAt ?? null,
  ].filter((at): at is Date => at != null)
  return dates.length > 0 ? dates.reduce((newest, at) => (at > newest ? at : newest)) : null
}

// ---------- The tree walk (DFS reading order — shared with progress-service) ----------

/** The minimum a tree-walkable node carries (both NodeRow and the progress
 * service's slim rows satisfy it — the walk never needs more). */
export interface TreeNodeLike {
  id: string
  parentId: string | null
  name: string
}

/** A version's nodes indexed for the reading-order walks. */
export interface NodeTree<T extends TreeNodeLike = TreeNodeLike> {
  /** Every node in DFS reading order (roots by priority, each parent
   * immediately followed by its subtree by priority — §37 deterministic). */
  dfs: T[]
  nodeById: Map<string, T>
  /** Ancestor titles, root first. */
  parentTitlesOf: (node: T) => string[]
}

export function buildNodeTree<T extends TreeNodeLike>(nodes: T[]): NodeTree<T> {
  // loadVersionNodes orders priority asc, id asc — the per-parent buckets
  // inherit that order, so no re-sort is needed.
  const childrenOf = new Map<string | null, T[]>()
  const nodeById = new Map<string, T>()
  for (const node of nodes) {
    nodeById.set(node.id, node)
    const bucket = childrenOf.get(node.parentId)
    if (bucket) bucket.push(node)
    else childrenOf.set(node.parentId, [node])
  }

  const dfs: T[] = []
  const visit = (parentId: string | null) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      dfs.push(node)
      visit(node.id)
    }
  }
  visit(null)

  const parentTitlesOf = (node: T): string[] => {
    const titles: string[] = []
    let current = node.parentId != null ? nodeById.get(node.parentId) : undefined
    while (current) {
      titles.push(current.name)
      current = current.parentId != null ? nodeById.get(current.parentId) : undefined
    }
    return titles.reverse()
  }

  return { dfs, nodeById, parentTitlesOf }
}

/** The chapter's public ref — the slug when present, the node id otherwise
 * (legacy pre-backfill nodes stay reachable, §37). */
function chapterRefOf(node: { slug: string | null; id: string }): string {
  return node.slug ?? node.id
}

/** The chapter's ancestor chain root → self (each entry's ref + title). */
function nodeChainOf(tree: NodeTree<NodeRow>, node: NodeRow): Array<{ slug: string; title: string }> {
  const chain: NodeRow[] = []
  let current: NodeRow | undefined = node
  while (current) {
    chain.push(current)
    current = current.parentId != null ? tree.nodeById.get(current.parentId) : undefined
  }
  return chain
    .reverse()
    .map((row) => ({ slug: chapterRefOf(row), title: row.name }))
}

// ---------- The chapter summaries (TOC rows + the chapter rail tree) ----------

/**
 * Builds the chapter rows of a version: every node in DFS order with the
 * units mapped TO THAT node (in-effect + VERIFIED + visible, §8/§14) and
 * their question/PYQ/QnA counts in the payload language. `mockTestCount`
 * is the exam-level EXAM-scoped count (mock tests are version-scoped, never
 * node-scoped — the types.ts note).
 */
function toChapterSummaries(params: {
  tree: NodeTree<NodeRow>
  mappingsByNode: Map<string, MappingRow[]>
  unitCounts: UnitContentCounts
  mockTestCount: number
}): TutorialChapterSummary[] {
  const { tree, mappingsByNode, unitCounts, mockTestCount } = params
  return tree.dfs.map((node) => {
    const mappings = mappingsByNode.get(node.id) ?? []
    const unitIds = new Set(mappings.map((mapping) => mapping.knowledgeUnitId))
    let practice = 0
    let pyq = 0
    let qna = 0
    for (const unitId of unitIds) {
      practice += unitCounts.questionsByUnit.get(unitId) ?? 0
      pyq += unitCounts.pyqByUnit.get(unitId) ?? 0
      qna += unitCounts.qnaByUnit.get(unitId) ?? 0
    }
    return {
      id: node.id,
      slug: chapterRefOf(node),
      title: node.name,
      depth: node.depth,
      parentTitles: tree.parentTitlesOf(node),
      lessonCount: unitIds.size,
      practiceCount: practice,
      pyqCount: pyq,
      qnaCount: qna,
      mockTestCount,
    }
  })
}

// ---------- The one-exam aggregate (TOC + chapter share this) ----------

/** One exam's computed tutorial skeleton — everything except the §35 counts. */
interface ExamTutorialData {
  exam: TutorialExamRef & { id: string }
  version: { id: string; label: string }
  tree: NodeTree<NodeRow>
  /** In-effect + VERIFIED + visible mappings, grouped per node. */
  mappingsByNode: Map<string, MappingRow[]>
  /** DISTINCT visible mapped units across the version. */
  distinctUnitIds: string[]
}

const EXAM_SELECT = {
  id: true,
  slug: true,
  name: true,
  organiser: true,
  level: true,
  countryId: true,
  status: true,
} as const

/**
 * Loads one exam's tutorial skeleton: ACTIVE exam of the reader's country
 * (§14) with a current (in-effect) version — the nulls are the honest empty
 * states (unknown/inactive exam, or no current version).
 */
async function loadExamTutorial(
  examSlug: string,
  context: TutorialsContext,
  visibleTopicSlugs: Set<string>
): Promise<ExamTutorialData | null> {
  const exam = await db.exam.findUnique({
    where: { slug: examSlug.toLowerCase() },
    select: {
      ...EXAM_SELECT,
      versions: { select: { id: true, label: true, effectiveFrom: true, effectiveTo: true } },
    },
  })
  if (!exam || exam.status !== 'ACTIVE' || exam.countryId !== context.countryRow.id) return null

  const version = exam.versions.find((row) => windowContains(row)) ?? null
  if (!version) return null

  const [nodes, mappings] = await Promise.all([
    loadVersionNodes(version.id),
    loadVersionMappings(version.id),
  ])

  const mappingsByNode = new Map<string, MappingRow[]>()
  const distinctUnits = new Set<string>()
  for (const mapping of mappings) {
    // §8 effective period + §14 unit visibility (the coverage precedent).
    if (!mappingInEffect(mapping, false)) continue
    if (!isUnitVisible(mapping.knowledgeUnit, context, visibleTopicSlugs)) continue
    const bucket = mappingsByNode.get(mapping.syllabusNodeId)
    if (bucket) bucket.push(mapping)
    else mappingsByNode.set(mapping.syllabusNodeId, [mapping])
    distinctUnits.add(mapping.knowledgeUnitId)
  }

  return {
    exam: {
      id: exam.id,
      slug: exam.slug,
      name: exam.name,
      organiser: exam.organiser,
      level: exam.level as TutorialExamRef['level'],
    },
    version: { id: version.id, label: version.label },
    tree: buildNodeTree(nodes),
    mappingsByNode,
    distinctUnitIds: [...distinctUnits],
  }
}

// ---------- GET /api/tutorials — the index ----------

/**
 * The /tutorials/ directory for one country × language (60s cached): every
 * ACTIVE exam whose current version carries ≥1 node, examName asc, with the
 * computed chapter/lesson/practice/PYQ/mock counts.
 *
 * §35 decision (documented): all language-scoped counts (practice/PYQ/mock)
 * load in the reader's language; when that language carries NO practice
 * question, Q&A or mock test anywhere in the market's tutorial surface and
 * English does, every count recomputes over English + fallback:true (the
 * practice-listing whole-listing rule — a mixed per-exam fallback would be
 * unlabellable at directory level). Lessons/chapters are canonical counts
 * and never swap.
 */
export async function getTutorialsIndex(input: TutorialsQuery): Promise<TutorialsIndex> {
  const cacheKey = ['tutorials:index', input.country ?? 'default', input.language ?? 'default'].join(':')
  return cachedPayload(cacheKey, () => loadTutorialsIndex(input))
}

async function loadTutorialsIndex(input: TutorialsQuery): Promise<TutorialsIndex> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { visibleTopicSlugs } = await loadSubjectMaps(input)

  // ---------- Every ACTIVE exam of the market with its current version ----------
  const exams = await db.exam.findMany({
    where: { status: 'ACTIVE', countryId: context.countryRow.id },
    select: {
      ...EXAM_SELECT,
      versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
    },
  })
  const currentVersionIdByExam = new Map<string, string>()
  for (const exam of exams) {
    const version = exam.versions.find((row) => windowContains(row))
    if (version) currentVersionIdByExam.set(exam.id, version.id)
  }
  const examIdByVersionId = new Map<string, string>()
  for (const [examId, versionId] of currentVersionIdByExam) examIdByVersionId.set(versionId, examId)
  const versionIds = [...examIdByVersionId.keys()]

  // ---------- The whole market's trees + mappings in TWO queries (no N+1) ----------
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

  const nodeCountByVersion = new Map<string, number>()
  for (const row of nodeRows) {
    nodeCountByVersion.set(row.examVersionId, (nodeCountByVersion.get(row.examVersionId) ?? 0) + 1)
  }

  // Visible mappings per version → per-exam unit sets (in-memory §8/§14 gate).
  const unitsByExam = new Map<string, Set<string>>()
  for (const mapping of mappingRows) {
    if (!mappingInEffect(mapping, false)) continue
    if (!isUnitVisible(mapping.knowledgeUnit, context, visibleTopicSlugs)) continue
    const examId = examIdByVersionId.get(mapping.examVersionId)
    if (!examId) continue // defense in depth — only current versions were loaded
    const set = unitsByExam.get(examId) ?? new Set<string>()
    set.add(mapping.knowledgeUnit.id)
    unitsByExam.set(examId, set)
  }

  // ---------- §35: the language pool of the whole directory ----------
  const allUnitIds = [...new Set([...unitsByExam.values()].flatMap((units) => [...units]))]
  let unitCounts = await loadUnitContentCounts(allUnitIds, readerLanguageId)
  let mockCounts = await loadMockTestCountsByVersion(versionIds, readerLanguageId)
  let languageId = readerLanguageId
  let fallback = false
  const poolEmpty = unitCounts.questionsByUnit.size === 0 && mockCounts.size === 0
  if (poolEmpty && language.code !== CANONICAL_LANGUAGE_CODE && englishLanguageId != null) {
    const englishCounts = await loadUnitContentCounts(allUnitIds, englishLanguageId)
    const englishMocks = await loadMockTestCountsByVersion(versionIds, englishLanguageId)
    if (englishCounts.questionsByUnit.size > 0 || englishMocks.size > 0) {
      unitCounts = englishCounts
      mockCounts = englishMocks
      languageId = englishLanguageId
      fallback = true
    }
  }

  // ---------- The exam cards (chapterCount ≥1 — the honest gate) ----------
  const tutorialExams: TutorialsIndexExam[] = []
  for (const exam of exams) {
    const versionId = currentVersionIdByExam.get(exam.id)
    if (!versionId) continue
    const chapterCount = nodeCountByVersion.get(versionId) ?? 0
    if (chapterCount === 0) continue // no tree — no tutorial yet
    const units = unitsByExam.get(exam.id) ?? new Set<string>()
    let practice = 0
    let pyq = 0
    for (const unitId of units) {
      practice += unitCounts.questionsByUnit.get(unitId) ?? 0
      pyq += unitCounts.pyqByUnit.get(unitId) ?? 0
    }
    tutorialExams.push({
      examSlug: exam.slug,
      examName: exam.name,
      organiser: exam.organiser,
      level: exam.level as TutorialsIndexExam['level'],
      chapterCount,
      lessonCount: units.size,
      practiceCount: practice,
      pyqCount: pyq,
      mockTestCount: mockCounts.get(versionId) ?? 0,
    })
  }
  tutorialExams.sort((a, b) => a.examName.localeCompare(b.examName) || a.examSlug.localeCompare(b.examSlug))

  // ---------- lastmod: the newest live revision in the visible set ----------
  const lastModified = await loadScopeLastModified(allUnitIds, languageId)

  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => tutorialsPath(context, code, ['tutorials']),
    lastModified,
  })

  const index: TutorialsIndex = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exams: tutorialExams,
    seo,
    seoTitle: 'Tutorials — Structured GK & Current Affairs Courses by Exam | GKSetu',
    seoDescription:
      'Complete exam-wise tutorials — every syllabus chapter with notes, practice questions, PYQs and mock tests. Coaching ke baghair, ek hi platform par.',
  }
  if (fallback) index.fallback = true
  return index
}

// ---------- GET /api/tutorials/[examRef] — the TOC ----------

/**
 * One exam's tutorial TOC (60s cached): the full chapter list in DFS reading
 * order with per-chapter counts + the exam totals. Unknown/inactive exam or
 * no current version → exam:null, the honest empty state (canonical falls
 * back to /tutorials/).
 *
 * §35 decision (documented): the language pool is this exam's whole tutorial
 * surface (its mapped units' questions + Q&As + its mock tests); empty in
 * the reader's language → the whole payload swaps to English + fallback.
 */
export async function getTutorialExam(examSlug: string, input: TutorialsQuery): Promise<TutorialExam> {
  const cacheKey = [
    'tutorials:exam',
    input.country ?? 'default',
    input.language ?? 'default',
    examSlug,
  ].join(':')
  return cachedPayload(cacheKey, () => loadTutorialExam(examSlug, input))
}

async function loadTutorialExam(examSlug: string, input: TutorialsQuery): Promise<TutorialExam> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { visibleTopicSlugs } = await loadSubjectMaps(input)

  const data = await loadExamTutorial(examSlug, context, visibleTopicSlugs)
  if (!data) {
    // The honest empty state — an ok envelope, canonical /tutorials/, noindex.
    const seo = buildPageSeo({
      country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
      defaultLanguageCode,
      languageCode: language.code,
      languages: publicCountry.languages,
      pathFor: (code) => tutorialsPath(context, code, ['tutorials']),
      noindexReason: 'Unknown exam — no tutorial page exists for this slug',
    })
    return {
      country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
      language,
      exam: null,
      versionLabel: null,
      chapters: [],
      totals: { chapters: 0, lessons: 0, practice: 0, pyq: 0, qna: 0, mockTests: 0 },
      seo,
      seoTitle: 'Tutorials — Structured GK & Current Affairs Courses by Exam | GKSetu',
      seoDescription:
        'Complete exam-wise tutorials — every syllabus chapter with notes, practice questions, PYQs and mock tests. Coaching ke baghair, ek hi platform par.',
    }
  }

  // ---------- §35: the exam's language pool ----------
  let unitCounts = await loadUnitContentCounts(data.distinctUnitIds, readerLanguageId)
  let mockCounts = await loadMockTestCountsByVersion([data.version.id], readerLanguageId)
  let languageId = readerLanguageId
  let fallback = false
  const poolEmpty = unitCounts.questionsByUnit.size === 0 && unitCounts.qnaByUnit.size === 0 && mockCounts.size === 0
  if (poolEmpty && language.code !== CANONICAL_LANGUAGE_CODE && englishLanguageId != null) {
    const englishCounts = await loadUnitContentCounts(data.distinctUnitIds, englishLanguageId)
    const englishMocks = await loadMockTestCountsByVersion([data.version.id], englishLanguageId)
    if (englishCounts.questionsByUnit.size > 0 || englishCounts.qnaByUnit.size > 0 || englishMocks.size > 0) {
      unitCounts = englishCounts
      mockCounts = englishMocks
      languageId = englishLanguageId
      fallback = true
    }
  }
  const mockTestCount = mockCounts.get(data.version.id) ?? 0

  const chapters = toChapterSummaries({
    tree: data.tree,
    mappingsByNode: data.mappingsByNode,
    unitCounts,
    mockTestCount,
  })
  const totals = {
    chapters: chapters.length,
    lessons: data.distinctUnitIds.length,
    practice: chapters.reduce((sum, chapter) => sum + chapter.practiceCount, 0),
    pyq: chapters.reduce((sum, chapter) => sum + chapter.pyqCount, 0),
    qna: chapters.reduce((sum, chapter) => sum + chapter.qnaCount, 0),
    mockTests: mockTestCount, // exam-scoped — counted once, not per chapter
  }

  const lastModified = await loadScopeLastModified(data.distinctUnitIds, languageId)
  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => tutorialsPath(context, code, ['tutorials', data.exam.slug]),
    lastModified,
  })

  const payload: TutorialExam = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exam: { slug: data.exam.slug, name: data.exam.name, organiser: data.exam.organiser, level: data.exam.level },
    versionLabel: data.version.label,
    chapters,
    totals,
    seo,
    seoTitle: `${data.exam.name} Tutorial — Complete Syllabus Course | GKSetu`,
    seoDescription: `${data.exam.name} tutorial — the complete ${data.version.label} as ${chapters.length} structured chapters with notes, practice questions, PYQs and mock tests. Free on GKSetu.`,
  }
  if (fallback) payload.fallback = true
  return payload
}

// ---------- GET /api/tutorials/[examRef]/[chapterRef] — the chapter ----------

/**
 * One chapter page (60s cached): the node's chain + lessons (mapped units in
 * priority order), the practice/PYQ/Q&A blocks (PracticeQuestionCard shapes
 * — labels only, §22) and the exam's EXAM-scoped mock tests, plus the full
 * TOC tree (the navigation rail) and prev/next siblings in DFS order.
 *
 * §35 decision (documented): the language pool is THIS chapter's mapped
 * units' questions + Q&As plus the exam's mock tests (mock tests are
 * exam-scoped and ride the payload language); empty in the reader's
 * language → every language-scoped block (practice/pyq/qna/mockTests AND the
 * tree's counts) swaps to English together + fallback.
 *
 * Unknown chapter → chapter:null with the exam still resolved (canonical
 * falls back to the exam's TOC page); unknown exam → exam:null (canonical
 * /tutorials/) — both ok envelopes, never errors.
 */
export async function getTutorialChapter(
  examSlug: string,
  chapterRef: string,
  input: TutorialsQuery
): Promise<TutorialChapter> {
  const cacheKey = [
    'tutorials:chapter',
    input.country ?? 'default',
    input.language ?? 'default',
    examSlug,
    chapterRef,
  ].join(':')
  return cachedPayload(cacheKey, () => loadTutorialChapter(examSlug, chapterRef, input))
}

async function loadTutorialChapter(
  examSlug: string,
  chapterRef: string,
  input: TutorialsQuery
): Promise<TutorialChapter> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId, topicSlugById, visibleTopicSlugs } = await loadSubjectMaps(input)

  const data = await loadExamTutorial(examSlug, context, visibleTopicSlugs)
  if (!data) {
    // Unknown/inactive exam or no current version — the honest empty state.
    return {
      country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
      language,
      exam: null,
      versionLabel: null,
      chapter: null,
      lessons: [],
      practice: { total: 0, questions: [] },
      pyq: { total: 0, questions: [] },
      qna: [],
      mockTests: [],
      siblings: { prev: null, next: null },
      tree: [],
      seo: buildPageSeo({
        country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
        defaultLanguageCode,
        languageCode: language.code,
        languages: publicCountry.languages,
        pathFor: (code) => tutorialsPath(context, code, ['tutorials']),
        noindexReason: 'Unknown exam — no tutorial page exists for this slug',
      }),
      seoTitle: 'Tutorials — Structured GK & Current Affairs Courses by Exam | GKSetu',
      seoDescription:
        'Complete exam-wise tutorials — every syllabus chapter with notes, practice questions, PYQs and mock tests. Coaching ke baghair, ek hi platform par.',
    }
  }

  // ---------- Resolve the chapter (slug first, node id for legacy rows) ----------
  const node = CUID_PATTERN.test(chapterRef)
    ? data.tree.nodeById.get(chapterRef)
    : data.tree.dfs.find((row) => (row.slug ?? row.id) === chapterRef)
  if (!node) {
    // Unknown chapter — the honest empty state; the exam stays resolved and
    // the canonical falls back to the exam's TOC page.
    return {
      country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
      language,
      exam: { slug: data.exam.slug, name: data.exam.name, organiser: data.exam.organiser, level: data.exam.level },
      versionLabel: data.version.label,
      chapter: null,
      lessons: [],
      practice: { total: 0, questions: [] },
      pyq: { total: 0, questions: [] },
      qna: [],
      mockTests: [],
      siblings: { prev: null, next: null },
      tree: [],
      seo: buildPageSeo({
        country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
        defaultLanguageCode,
        languageCode: language.code,
        languages: publicCountry.languages,
        pathFor: (code) => tutorialsPath(context, code, ['tutorials', data.exam.slug]),
        noindexReason: 'Unknown chapter — no tutorial chapter exists for this ref',
      }),
      seoTitle: `${data.exam.name} Tutorial — Complete Syllabus Course | GKSetu`,
      seoDescription: `${data.exam.name} tutorial — the complete ${data.version.label} as structured chapters with notes, practice questions, PYQs and mock tests. Free on GKSetu.`,
    }
  }

  // ---------- The chapter's mapped units (lessons, §7) ----------
  const mappings = data.mappingsByNode.get(node.id) ?? []
  const nodeUnitIds = [...new Set(mappings.map((mapping) => mapping.knowledgeUnitId))]

  // ---------- §35: the chapter's language pool ----------
  // The chapter's own questions/Q&As on its mapped units, plus the exam's
  // mock tests (exam-scoped, riding the payload language).
  const chapterHasContent = (counts: UnitContentCounts, mockCount: number): boolean =>
    nodeUnitIds.some(
      (unitId) => (counts.questionsByUnit.get(unitId) ?? 0) > 0 || (counts.qnaByUnit.get(unitId) ?? 0) > 0
    ) || mockCount > 0

  let unitCounts = await loadUnitContentCounts(data.distinctUnitIds, readerLanguageId)
  let languageId = readerLanguageId
  let fallback = false
  let mockTestCount = (await loadMockTestCountsByVersion([data.version.id], readerLanguageId)).get(data.version.id) ?? 0
  if (
    !chapterHasContent(unitCounts, mockTestCount) &&
    language.code !== CANONICAL_LANGUAGE_CODE &&
    englishLanguageId != null
  ) {
    const englishCounts = await loadUnitContentCounts(data.distinctUnitIds, englishLanguageId)
    const englishMockCount =
      (await loadMockTestCountsByVersion([data.version.id], englishLanguageId)).get(data.version.id) ?? 0
    if (chapterHasContent(englishCounts, englishMockCount)) {
      unitCounts = englishCounts
      languageId = englishLanguageId
      mockTestCount = englishMockCount
      fallback = true
    }
  }

  // ---------- The tree (navigation rail) in the payload language ----------
  const tree = toChapterSummaries({
    tree: data.tree,
    mappingsByNode: data.mappingsByNode,
    unitCounts,
    mockTestCount,
  })

  // ---------- Lessons: the node's units, mapping priority then unit name ----------
  const unitRows =
    nodeUnitIds.length > 0
      ? await db.knowledgeUnit.findMany({
          where: { id: { in: nodeUnitIds } },
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
  const unitById = new Map(unitRows.map((row) => [row.id, row]))
  // §35 topic labels for the lessons (requested → country default → canonical).
  const topicLabels = await resolveTopicLabels(
    [...new Set(unitRows.map((row) => row.topicId))],
    language.code,
    defaultLanguageCode
  )
  const mappingRankOf = (mapping: MappingRow) => MAPPING_PRIORITY_RANK[mapping.priority] ?? 1
  const lessons: TutorialLesson[] = [...mappings]
    .filter(
      (mapping, index, all) =>
        // DISTINCT units — defense in depth (@@unique([unit, node]) already
        // guarantees one mapping per unit per node).
        all.findIndex((other) => other.knowledgeUnitId === mapping.knowledgeUnitId) === index
    )
    .sort(
      (a, b) =>
        mappingRankOf(a) - mappingRankOf(b) ||
        a.knowledgeUnit.canonicalName.localeCompare(b.knowledgeUnit.canonicalName) ||
        a.knowledgeUnit.id.localeCompare(b.knowledgeUnit.id)
    )
    .flatMap((mapping) => {
      const unit = unitById.get(mapping.knowledgeUnitId)
      if (!unit) return []
      return [
        {
          unitSlug: unit.slug,
          title: unit.canonicalName,
          summary: unit.canonicalSummary,
          type: unit.type,
          difficulty: unit.difficulty,
          path: buildCanonicalUrl(
            { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
            { code: language.code },
            defaultLanguageCode,
            [unit.topic.slug, unit.slug]
          ),
          topicSlug: unit.topic.slug,
          topicLabel: topicLabels.get(unit.topicId)?.label ?? unit.topic.canonicalName,
        },
      ]
    })

  // ---------- Practice + Q&A blocks (labels only, §22 — unpaginated: a
  // chapter's units carry a bounded handful in practice; totals are the
  // ground truth of exactly what ships) ----------
  const chapterUnitsIn = { id: { in: nodeUnitIds } } // in: [] matches nothing — honest empty
  const publishedWhere = {
    status: 'PUBLISHED' as const,
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: chapterUnitsIn,
  }
  const [questionRows, qnaRows] = await Promise.all([
    db.question.findMany({
      where: publishedWhere,
      orderBy: [{ publishedRevision: { publishedAt: 'desc' } }, { id: 'asc' }],
      select: {
        id: true,
        knowledgeUnit: { select: { slug: true, canonicalName: true, topicId: true } },
        publishedRevision: {
          select: { questionText: true, optionsJson: true, difficulty: true, publishedAt: true },
        },
      },
    }),
    db.qnA.findMany({
      where: publishedWhere,
      orderBy: [{ publishedRevision: { publishedAt: 'desc' } }, { id: 'asc' }],
      select: {
        id: true,
        knowledgeUnit: { select: { slug: true, canonicalName: true, topicId: true } },
        publishedRevision: { select: { questionText: true, answerBody: true, publishedAt: true } },
      },
    }),
  ])

  // SITE-S7: the batched provenance badges (ONE query per kind — no N+1).
  const [questionProvenance, qnaProvenance] = await Promise.all([
    loadQuestionProvenanceMap(
      questionRows.filter((row) => row.publishedRevision != null).map((row) => row.id)
    ),
    loadQnaProvenanceMap(qnaRows.filter((row) => row.publishedRevision != null).map((row) => row.id)),
  ])

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
  // PYQ = the provenance-bearing subset (each card carries its full badge array).
  const pyqQuestions = questions.filter((card) => card.provenance.length > 0)

  const qna = qnaRows
    .filter((row) => row.publishedRevision != null)
    .map((row) => {
      const unit = row.knowledgeUnit
      return {
        id: row.id,
        questionText: row.publishedRevision!.questionText,
        answerBody: row.publishedRevision!.answerBody,
        subject: subjectByTopicId.get(unit.topicId) ?? null,
        unit: {
          slug: unit.slug,
          canonicalName: unit.canonicalName,
          topicSlug: topicSlugById.get(unit.topicId) ?? unit.slug,
        },
        provenance: qnaProvenance.get(row.id) ?? [],
      }
    })

  // ---------- Mock tests (exam-scoped, payload language) ----------
  const mockTestRows = await db.mockTest.findMany({
    where: {
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      scopeType: 'EXAM',
      examVersionId: data.version.id,
      languageId,
    },
    orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }, { id: 'asc' }],
    select: {
      slug: true,
      publishedRevision: { select: { title: true, durationMinutes: true, questionIdsJson: true } },
    },
  })
  const mockTests: TutorialMockTestCard[] = mockTestRows
    .filter((row) => row.publishedRevision != null)
    .map((row) => ({
      slug: row.slug,
      title: row.publishedRevision!.title,
      durationMinutes: row.publishedRevision!.durationMinutes,
      questionCount: questionCountOf(row.publishedRevision!.questionIdsJson),
    }))

  // ---------- Siblings + node chain (DFS reading order) ----------
  const dfsIndex = data.tree.dfs.findIndex((row) => row.id === node.id)
  const previous = dfsIndex > 0 ? data.tree.dfs[dfsIndex - 1] : undefined
  const next =
    dfsIndex >= 0 && dfsIndex < data.tree.dfs.length - 1 ? data.tree.dfs[dfsIndex + 1] : undefined
  const chapterInfo: TutorialChapterInfo = {
    id: node.id,
    slug: chapterRefOf(node),
    title: node.name,
    nodeChain: nodeChainOf(data.tree, node),
  }

  // ---------- lastmod: the newest live revision on this chapter ----------
  const publishedDates = [
    ...questionRows.map((row) => row.publishedRevision?.publishedAt ?? null),
    ...qnaRows.map((row) => row.publishedRevision?.publishedAt ?? null),
  ].filter((at): at is Date => at != null)
  const lastModified =
    publishedDates.length > 0
      ? publishedDates.reduce((newest, at) => (at > newest ? at : newest))
      : null

  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => tutorialsPath(context, code, ['tutorials', data.exam.slug, chapterRefOf(node)]),
    lastModified,
  })

  const payload: TutorialChapter = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exam: { slug: data.exam.slug, name: data.exam.name, organiser: data.exam.organiser, level: data.exam.level },
    versionLabel: data.version.label,
    chapter: chapterInfo,
    lessons,
    practice: { total: questions.length, questions },
    pyq: { total: pyqQuestions.length, questions: pyqQuestions },
    qna,
    mockTests,
    siblings: {
      prev: previous ? { slug: chapterRefOf(previous), title: previous.name } : null,
      next: next ? { slug: chapterRefOf(next), title: next.name } : null,
    },
    tree,
    seo,
    seoTitle: `${node.name} — ${data.exam.name} Tutorial | GKSetu`,
    seoDescription: `Study ${node.name} for ${data.exam.name} — ${lessons.length} lesson${lessons.length === 1 ? '' : 's'}, ${questions.length} practice question${questions.length === 1 ? '' : 's'}${pyqQuestions.length > 0 ? `, ${pyqQuestions.length} previous year question${pyqQuestions.length === 1 ? '' : 's'}` : ''} and ${mockTests.length} mock test${mockTests.length === 1 ? '' : 's'}. Free on GKSetu.`,
  }
  if (fallback) payload.fallback = true
  return payload
}
