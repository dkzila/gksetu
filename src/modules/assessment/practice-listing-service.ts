/**
 * GKSetu — Assessment: the public practice listing service (SITE-S3)
 * Master Plan §22 (the practice layer — scored MCQs + explanatory Q&A),
 * §6/§7 (every Question/QnA REPRESENTS a canonical KnowledgeUnit), §14
 * (market scoping — the owning unit must be GLOBAL or reader-country
 * scoped, VERIFIED, and its topic visible in the market's tree), §16 (every
 * path built via buildCanonicalUrl — never from user input), §19 (PUBLISHED
 * with a live revision is the public gate — public reads ALWAYS serve the
 * immutable revision snapshot, never the working copy), §22 scored
 * discipline (the correctAnswer NEVER ships on the listing — option LABELS
 * only; the key is revealed per-question by checkPracticeAnswer), §35
 * (reader-language questions with the honest English fallback — never a
 * fake translation), §36 (lifecycle-aware reads), §37 (deterministic
 * ordering createdAt-desc/id-asc, server-side pagination, client-agnostic
 * DTO, typed errors), §38 (public surface — everyone, no auth), §29 (60s
 * public payload cache — the homepage/current-affairs precedent).
 *
 * The /mcq/ and /qna/ surfaces (site-overhaul plan Task 7): the market's
 * published practice content, newest first, with the root-subject chips
 * that drive the ?subject= filter and the §16 SEO block of the indexable
 * surface. Question and QnA ride the same composition (same chips, same
 * honesty rules) — one file, two entry points.
 */
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import {
  buildCanonicalUrl,
  findConfiguredCountryStatusByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { buildPageSeo } from '@/modules/seo'
import type { PageSeo } from '@/modules/seo'
import { getPublicTree } from '@/modules/taxonomy'
import type { PublicTopicNode } from '@/modules/taxonomy'
// SITE-S7: the batch "Asked in …" badge loader (type-only pyq import here —
// the runtime edge stays assessment → pyq, no cycle).
import { loadQuestionProvenanceMap, loadQnaProvenanceMap } from '@/modules/pyq'
import type { PyqProvenanceBadge } from '@/modules/pyq'

// ---------- Typed errors (mapped to HTTP by the route handlers, §37) ----------

export type PracticeListingErrorCode = 'COUNTRY_NOT_FOUND'

export class PracticeListingError extends Error {
  readonly code: PracticeListingErrorCode
  readonly status: number

  constructor(code: PracticeListingErrorCode, message: string) {
    super(message)
    this.name = 'PracticeListingError'
    this.code = code
    this.status = 404
  }
}

/** Maps a thrown PracticeListingError to envelope data (§37); null for others. */
export function toPracticeListingErrorResponse(
  error: unknown
): { message: string; code: PracticeListingErrorCode; status: number } | null {
  if (error instanceof PracticeListingError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Constants ----------

/** The views' page size (the API default). */
export const PRACTICE_PAGE_SIZE_DEFAULT = 12
/** The largest page a caller may ask for (§37 sane payload cap). */
export const PRACTICE_PAGE_SIZE_MAX = 48
/** The platform's canonical language — the §35 honest fallback target. */
const CANONICAL_LANGUAGE_CODE = 'en'
/** The events anchor (Task 8): never a subject chip (its page is /current-affairs/). */
const CURRENT_AFFAIRS_SLUG = 'current-affairs'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// ---------- DTO (§37 client-agnostic contract — the /mcq/ + /qna/ views build against this) ----------

/**
 * One practice MCQ card. `options` are the option LABELS only — the
 * correctAnswer and its key NEVER ship on the listing (§22 scored
 * discipline: the key is revealed per-question by checkPracticeAnswer).
 * SITE-S7: `provenance` carries the item's exam-sitting appearances (the
 * "Asked in UPSC CSE · 2021 (Prelims)" badges — [] = a practice-original).
 */
export interface PracticeQuestionCard {
  id: string
  questionText: string
  options: string[]
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  /** The ROOT subject of the unit's topic subtree (§35 label). */
  subject: { slug: string; label: string } | null
  /** The owning canonical unit (§7) — its own topic, not the root subject. */
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
  /** SITE-S7 — every recorded exam-sitting appearance, newest first. */
  provenance: PyqProvenanceBadge[]
}

/**
 * One Q&A card. Q&A is a study surface (§23 "explanatory, unscored") — the
 * answer ships inline (answers expand, nothing is scored), always from the
 * live revision. SITE-S7: `provenance` mirrors the MCQ card's badges.
 */
export interface PracticeQnaCard {
  id: string
  questionText: string
  answerBody: string
  /** The ROOT subject of the unit's topic subtree (§35 label). */
  subject: { slug: string; label: string } | null
  /** The owning canonical unit (§7) — its own topic, not the root subject. */
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
  /** SITE-S7 — every recorded exam-sitting appearance, newest first. */
  provenance: PyqProvenanceBadge[]
}

/** One subject chip — the ?subject= filter vocabulary (same set as /api/subjects). */
export interface PracticeSubjectChip {
  slug: string
  /** §35 label (reader language → country default → canonical name). */
  label: string
  /** PUBLISHED practice items of this surface in the reader's language. */
  count: number
}

/** GET /api/questions payload body — ok({ practice: this }). */
export interface QuestionsPractice {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  questions: PracticeQuestionCard[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  subjects: PracticeSubjectChip[]
  seo: PageSeo
  /**
   * §35 honesty marker: true when the reader's language carries no published
   * questions for this query and the listing fell back to the platform's
   * canonical English content — labelled, never a fake translation.
   */
  fallback?: boolean
}

/** GET /api/qna payload body — ok({ practice: this }). */
export interface QnaPractice {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  items: PracticeQnaCard[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  subjects: PracticeSubjectChip[]
  seo: PageSeo
  /** §35 honesty marker (same rule as the MCQ listing). */
  fallback?: boolean
}

// ---------- Query schemas ----------

/** GET /api/questions query — ?country=&language=&subject=&exam=&page=&pageSize=. */
export const questionsPracticeQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  /** Root-subject slug filter (a chip value; unknown slugs filter to an
   * honest empty list, never an error). */
  subject: z
    .string()
    .trim()
    .max(120)
    .regex(SLUG_PATTERN, 'Subject must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
  /** Exam slug filter (the question's exam anchor — authoring context, §6). */
  exam: z
    .string()
    .trim()
    .max(120)
    .regex(SLUG_PATTERN, 'Exam must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRACTICE_PAGE_SIZE_MAX)
    .default(PRACTICE_PAGE_SIZE_DEFAULT),
})

export type QuestionsPracticeQuery = z.infer<typeof questionsPracticeQuerySchema>

/** GET /api/qna query — ?country=&language=&subject=&exam=&page=&pageSize= (SITE-S21: exam filter added via ExamMapping). */
export const qnaPracticeQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  subject: z
    .string()
    .trim()
    .max(120)
    .regex(SLUG_PATTERN, 'Subject must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
  /** SITE-S21: exam slug filter — filters QnA to units mapped to this exam
   * via the ExamMapping table (the §8 requirement layer — same join the MCQ
   * listing uses via Question.examVersionId, but QnA has no examVersionId so
   * we join through the knowledgeUnit → ExamMapping → ExamVersion → Exam path). */
  exam: z
    .string()
    .trim()
    .max(120)
    .regex(SLUG_PATTERN, 'Exam must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRACTICE_PAGE_SIZE_MAX)
    .default(PRACTICE_PAGE_SIZE_DEFAULT),
})

export type QnaPracticeQuery = z.infer<typeof qnaPracticeQuerySchema>

// ---------- Public reads ----------

/**
 * The /mcq/ practice listing for one country × language context (60s cached
 * payload, the discovery precedent). Unknown/INACTIVE countries surface as
 * the typed 404; a subject/exam filter that matches nothing returns the
 * honest empty page.
 */
export async function getPublicQuestionsPractice(
  input: QuestionsPracticeQuery
): Promise<QuestionsPractice> {
  const cacheKey = [
    'practice:questions',
    input.country ?? 'default',
    input.language ?? 'default',
    input.subject ?? 'all',
    input.exam ?? 'all',
    input.page,
    input.pageSize,
  ].join(':')
  return cachedPayload(cacheKey, () => loadQuestionsPractice(input))
}

/**
 * The /qna/ practice listing for one country × language context — the same
 * composition with the Q&A card shape and the /qna/ canonical surface.
 */
export async function getPublicQnaPractice(input: QnaPracticeQuery): Promise<QnaPractice> {
  const cacheKey = [
    'practice:qna',
    input.country ?? 'default',
    input.language ?? 'default',
    input.subject ?? 'all',
    input.exam ?? 'all',
    input.page,
    input.pageSize,
  ].join(':')
  return cachedPayload(cacheKey, () => loadQnaPractice(input))
}

// ---------- Internal helpers ----------

/** The resolved reader context of one practice-listing request. */
interface PracticeContext {
  publicCountry: NonNullable<Awaited<ReturnType<typeof getPublicCountry>>>
  countryRow: { id: string; status: string }
  language: { code: string; name: string }
  defaultLanguageCode: string
}

/** Resolves the reader context, surfacing locale failures as the typed
 * COUNTRY_NOT_FOUND (the current-affairs listing precedent). */
async function resolveReaderContext(input: {
  country?: string
  language?: string
}): Promise<PracticeContext> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new PracticeListingError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }

  const [publicCountry, countryRow] = await Promise.all([
    getPublicCountry(resolution.country.isoCode),
    findConfiguredCountryStatusByIso(resolution.country.isoCode),
  ])
  if (!publicCountry || !countryRow) {
    throw new PracticeListingError('COUNTRY_NOT_FOUND', 'Country not available')
  }

  return {
    publicCountry,
    countryRow,
    language: { code: resolution.language.code, name: resolution.language.name },
    defaultLanguageCode: publicCountry.defaultLanguage.code,
  }
}

/** The §16 listing path for a language: …/mcq/ (or /qna/) under the prefix. */
function listingPathFor(context: PracticeContext, languageCode: string, segment: 'mcq' | 'qna') {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: languageCode },
    context.defaultLanguageCode,
    [segment]
  )
}

/** Flattens a tree the subjects-service way (walk order = deterministic §37). */
function flattenTree(nodes: PublicTopicNode[], ancestors: PublicTopicNode[]): Array<{
  node: PublicTopicNode
  root: PublicTopicNode
}> {
  const out: Array<{ node: PublicTopicNode; root: PublicTopicNode }> = []
  for (const node of nodes) {
    out.push({ node, root: ancestors[0] ?? node })
    out.push(...flattenTree(node.children, [...ancestors, node]))
  }
  return out
}

/**
 * The market's visible tree resolved into the two maps the listing needs:
 * every visible topic's ROOT subject (the card subject + the subject
 * filter's subtree vocabulary) and the topic-slug lookup for unit cards.
 * The taxonomy snapshot is cache-served — no extra database round-trips.
 */
async function loadSubjectMaps(input: { country?: string; language?: string }): Promise<{
  subjectByTopicId: Map<string, { slug: string; label: string }>
  topicSlugById: Map<string, string>
  subjectRoots: PublicTopicNode[]
}> {
  const tree = await getPublicTree({ country: input.country, language: input.language })
  const subjectByTopicId = new Map<string, { slug: string; label: string }>()
  const topicSlugById = new Map<string, string>()
  for (const root of tree) {
    for (const entry of flattenTree([root], [])) {
      subjectByTopicId.set(entry.node.id, { slug: root.slug, label: root.label })
      topicSlugById.set(entry.node.id, entry.node.slug)
    }
  }
  // Chips exclude the events anchor (the /subjects/ set, Task 8).
  const subjectRoots = tree.filter((root) => root.slug !== CURRENT_AFFAIRS_SLUG)
  return { subjectByTopicId, topicSlugById, subjectRoots }
}

/**
 * The §14/§36 unit visibility clause every practice read shares: VERIFIED
 * unit, GLOBAL or the reader country's own scope, anchored to a topic
 * visible in the market's tree. A Question/QnA is never more visible than
 * its record.
 */
function visibleUnitsWhere(
  context: PracticeContext,
  topicIds: string[]
): Prisma.KnowledgeUnitWhereInput {
  return {
    status: 'VERIFIED',
    topicId: { in: topicIds },
    OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY' as const, countryId: context.countryRow.id }],
  }
}

/**
 * Resolves the reader-language row plus the canonical English row — the
 * §35 exposure pair. resolveLocaleContext guarantees the reader's language
 * is configured and ACTIVE for the country; English is the platform's
 * canonical fallback.
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
 * The subject chips (both surfaces share them): the /subjects/ root set
 * with each subject's published practice count in the READER's language —
 * the honest "how much can I practise in my language" number (a zero-count
 * chip is the §35 signal; the English fallback still serves content behind
 * it, labelled `fallback`). Batched: one groupBy + one unit lookup.
 */
async function loadSubjectChips(params: {
  subjectRoots: PublicTopicNode[]
  subjectByTopicId: Map<string, { slug: string; label: string }>
  /** groupBy + unit lookup are model-specific — a small strategy pair
   * (the closures already bind the reader language + visibility gate). */
  countByUnit: () => Promise<Map<string, number>>
  unitsById: (unitIds: string[]) => Promise<Map<string, string>> // unitId → topicId
}): Promise<PracticeSubjectChip[]> {
  const { subjectRoots, subjectByTopicId, countByUnit, unitsById } = params

  const questionCounts = await countByUnit()
  const unitIds = [...questionCounts.keys()]
  const unitTopicById = unitIds.length > 0 ? await unitsById(unitIds) : new Map<string, string>()

  const countBySubject = new Map<string, number>()
  for (const [unitId, count] of questionCounts) {
    const topicId = unitTopicById.get(unitId)
    const subject = topicId != null ? subjectByTopicId.get(topicId) : undefined
    if (!subject) continue // a unit outside the visible tree is not a chip
    countBySubject.set(subject.slug, (countBySubject.get(subject.slug) ?? 0) + count)
  }

  return subjectRoots.map((root) => ({
    slug: root.slug,
    label: root.label,
    count: countBySubject.get(root.slug) ?? 0,
  }))
}

/** Parses a stored optionsJson into the option LABELS only (§22 — no keys). */
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

// ---------- The MCQ listing ----------

async function loadQuestionsPractice(input: QuestionsPracticeQuery): Promise<QuestionsPractice> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId, topicSlugById, subjectRoots } = await loadSubjectMaps(input)

  // ---------- The visibility gate ----------
  // PUBLISHED with a live revision (§19), on a VERIFIED unit that is GLOBAL
  // or the reader country's own (§14) and visible in the market's tree.
  // The BASE clause (no subject/exam narrowing) is also the chip-count
  // scope: like the current-affairs topic chips, counts are UNFILTERED —
  // they answer "how many questions can I practise under this subject",
  // stable across pages and the active filters.
  const allVisibleTopicIds = [...subjectByTopicId.keys()]
  const subjectRoot = input.subject ? subjectRoots.find((root) => root.slug === input.subject) : undefined
  // An unknown subject slug filters to the honest empty page — never an
  // error, never silently unfiltered (the current-affairs listing rule).
  const subjectTopicIds = input.subject
    ? subjectRoot
      ? flattenTree([subjectRoot], []).map((entry) => entry.node.id)
      : []
    : undefined

  const baseQuestionsWhere = (languageId: string): Prisma.QuestionWhereInput => ({
    status: 'PUBLISHED',
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: visibleUnitsWhere(context, allVisibleTopicIds),
  })

  // The LISTING scope: the subject filter narrows the anchor topic to ONE
  // root subject's subtree (the chip's own subtree — "match any topic in its
  // subtree"); the exam filter matches the question's exam anchor's exam
  // slug (§6 authoring context).
  const questionsWhere = (languageId: string): Prisma.QuestionWhereInput => ({
    ...baseQuestionsWhere(languageId),
    ...(subjectTopicIds ? { knowledgeUnit: visibleUnitsWhere(context, subjectTopicIds) } : {}),
    ...(input.exam ? { examVersion: { exam: { slug: input.exam.toLowerCase() } } } : {}),
  })

  // ---------- First pass: the reader's language ----------
  let total = await db.question.count({ where: questionsWhere(readerLanguageId) })
  let fallback = false
  let languageId = readerLanguageId

  // ---------- §35 honest fallback ----------
  // No published questions in the reader's language (and the reader did not
  // ask for English) → serve the platform's canonical English content and
  // label it — never a fake translation. An empty English pool stays an
  // honest empty page (fallback only marks content actually served).
  if (
    total === 0 &&
    language.code !== CANONICAL_LANGUAGE_CODE &&
    englishLanguageId != null
  ) {
    const englishTotal = await db.question.count({
      where: questionsWhere(englishLanguageId),
    })
    if (englishTotal > 0) {
      total = englishTotal
      languageId = englishLanguageId
      fallback = true
    }
  }

  // ---------- Pagination (§37 deterministic: createdAt desc, id asc) ----------
  const pageSize = input.pageSize
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(input.page, totalPages) // clamp into range — page 5 of 1 serves page 1

  const rows =
    total > 0
      ? await db.question.findMany({
          where: questionsWhere(languageId),
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            knowledgeUnit: {
              select: { slug: true, canonicalName: true, topicId: true },
            },
            publishedRevision: {
              select: { questionText: true, optionsJson: true, difficulty: true },
            },
          },
        })
      : []

  const questions: PracticeQuestionCard[] = rows
    .filter((row) => row.publishedRevision != null)
    .map((row) => {
      const unit = row.knowledgeUnit
      return {
        id: row.id,
        questionText: row.publishedRevision!.questionText,
        options: optionLabels(row.publishedRevision!.optionsJson),
        difficulty: row.publishedRevision!.difficulty as PracticeQuestionCard['difficulty'],
        subject: subjectByTopicId.get(unit.topicId) ?? null,
        unit: {
          slug: unit.slug,
          canonicalName: unit.canonicalName,
          topicSlug: topicSlugById.get(unit.topicId) ?? unit.slug,
        },
        provenance: [], // SITE-S7 — filled by the batched badge load below
      }
    })

  // ---------- SITE-S7: the batched provenance badges (ONE query — no N+1) ----------
  const provenanceById = await loadQuestionProvenanceMap(questions.map((card) => card.id))
  for (const card of questions) card.provenance = provenanceById.get(card.id) ?? []

  // ---------- Subject chips (reader-language counts, batched, UNFILTERED) ----------
  const subjects = await loadSubjectChips({
    subjectRoots,
    subjectByTopicId,
    countByUnit: async () => {
      const groups = await db.question.groupBy({
        by: ['knowledgeUnitId'],
        where: baseQuestionsWhere(readerLanguageId),
        _count: { _all: true },
      })
      return new Map(groups.map((group) => [group.knowledgeUnitId, group._count._all]))
    },
    unitsById: async (unitIds) => {
      const units = await db.knowledgeUnit.findMany({
        where: { id: { in: unitIds } },
        select: { id: true, topicId: true },
      })
      return new Map(units.map((unit) => [unit.id, unit.topicId]))
    },
  })

  // ---------- lastmod: the newest live revision in the visible set ----------
  const latest = await db.question.findFirst({
    where: questionsWhere(languageId),
    orderBy: { publishedRevision: { publishedAt: 'desc' } },
    select: { publishedRevision: { select: { publishedAt: true } } },
  })

  // ---------- §16 SEO block (structural indexable surface, /mcq/) ----------
  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => listingPathFor(context, code, 'mcq'),
    lastModified: latest?.publishedRevision?.publishedAt ?? null,
  })

  const practice: QuestionsPractice = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    questions,
    pagination: { page, pageSize, total, totalPages },
    subjects,
    seo,
  }
  if (fallback) practice.fallback = true
  return practice
}

// ---------- The Q&A listing ----------

async function loadQnaPractice(input: QnaPracticeQuery): Promise<QnaPractice> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId, topicSlugById, subjectRoots } = await loadSubjectMaps(input)

  // ---------- The visibility gate (same honesty as the MCQ listing; QnA
  // carries no exam anchor, §6 — the QnA row lists only knowledge_unit_id).
  // The BASE clause (no subject narrowing) is also the chip-count scope:
  // UNFILTERED counts, stable across the active filter (the CA-chips rule). ----------
  const allVisibleTopicIds = [...subjectByTopicId.keys()]
  const subjectRoot = input.subject ? subjectRoots.find((root) => root.slug === input.subject) : undefined
  // An unknown subject slug filters to the honest empty page — same rule as MCQ.
  const subjectTopicIds = input.subject
    ? subjectRoot
      ? flattenTree([subjectRoot], []).map((entry) => entry.node.id)
      : []
    : undefined

  const baseQnaWhere = (languageId: string): Prisma.QnAWhereInput => ({
    status: 'PUBLISHED',
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: visibleUnitsWhere(context, allVisibleTopicIds),
  })

  // SITE-S21: the exam filter for QnA. QnA has no examVersionId (unlike
  // Question), so we filter via the knowledgeUnit → ExamMapping → ExamVersion
  // → Exam path. The unit must be mapped to this exam's current version.
  let examUnitIds: Set<string> | null = null
  if (input.exam) {
    const exam = await db.exam.findUnique({
      where: { slug: input.exam.toLowerCase() },
      select: {
        id: true,
        versions: {
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    })
    if (exam?.versions[0]) {
      const mappings = await db.examMapping.findMany({
        where: { examVersionId: exam.versions[0].id },
        select: { knowledgeUnitId: true },
      })
      examUnitIds = new Set(mappings.map((m) => m.knowledgeUnitId))
    } else {
      // Unknown exam or no current version → honest empty page.
      examUnitIds = new Set()
    }
  }

  const qnaWhere = (languageId: string): Prisma.QnAWhereInput => ({
    ...baseQnaWhere(languageId),
    ...(subjectTopicIds ? { knowledgeUnit: visibleUnitsWhere(context, subjectTopicIds) } : {}),
    ...(examUnitIds !== null ? { knowledgeUnitId: { in: [...examUnitIds] } } : {}),
  })

  // ---------- First pass + §35 honest fallback (same rule as MCQ) ----------
  let total = await db.qnA.count({ where: qnaWhere(readerLanguageId) })
  let fallback = false
  let languageId = readerLanguageId
  if (
    total === 0 &&
    language.code !== CANONICAL_LANGUAGE_CODE &&
    englishLanguageId != null
  ) {
    const englishTotal = await db.qnA.count({ where: qnaWhere(englishLanguageId) })
    if (englishTotal > 0) {
      total = englishTotal
      languageId = englishLanguageId
      fallback = true
    }
  }

  // ---------- Pagination (§37 deterministic: createdAt desc, id asc) ----------
  const pageSize = input.pageSize
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(input.page, totalPages)

  const rows =
    total > 0
      ? await db.qnA.findMany({
          where: qnaWhere(languageId),
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            knowledgeUnit: {
              select: { slug: true, canonicalName: true, topicId: true },
            },
            publishedRevision: {
              select: { questionText: true, answerBody: true },
            },
          },
        })
      : []

  const items: PracticeQnaCard[] = rows
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
        provenance: [], // SITE-S7 — filled by the batched badge load below
      }
    })

  // ---------- SITE-S7: the batched provenance badges (ONE query — no N+1) ----------
  const provenanceById = await loadQnaProvenanceMap(items.map((card) => card.id))
  for (const card of items) card.provenance = provenanceById.get(card.id) ?? []

  // ---------- Subject chips (reader-language counts, batched, UNFILTERED) ----------
  const subjects = await loadSubjectChips({
    subjectRoots,
    subjectByTopicId,
    countByUnit: async () => {
      const groups = await db.qnA.groupBy({
        by: ['knowledgeUnitId'],
        where: baseQnaWhere(readerLanguageId),
        _count: { _all: true },
      })
      return new Map(groups.map((group) => [group.knowledgeUnitId, group._count._all]))
    },
    unitsById: async (unitIds) => {
      const units = await db.knowledgeUnit.findMany({
        where: { id: { in: unitIds } },
        select: { id: true, topicId: true },
      })
      return new Map(units.map((unit) => [unit.id, unit.topicId]))
    },
  })

  // ---------- lastmod: the newest live revision in the visible set ----------
  const latest = await db.qnA.findFirst({
    where: qnaWhere(languageId),
    orderBy: { publishedRevision: { publishedAt: 'desc' } },
    select: { publishedRevision: { select: { publishedAt: true } } },
  })

  // ---------- §16 SEO block (structural indexable surface, /qna/) ----------
  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => listingPathFor(context, code, 'qna'),
    lastModified: latest?.publishedRevision?.publishedAt ?? null,
  })

  const practice: QnaPractice = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    items,
    pagination: { page, pageSize, total, totalPages },
    subjects,
    seo,
  }
  if (fallback) practice.fallback = true
  return practice
}
