/**
 * GKSetu — PYQ module: domain service (SITE-S7)
 * docs/learning-platform-plan.md SITE-S7 — PYQ is a provenance layer over
 * the existing practice machinery, never a new content type. This service
 * composes the SITE-S3 practice-listing discipline for the /pyq/ SEO
 * directory: §19 (PUBLISHED + a live revision is the public gate; public
 * reads always serve the immutable revision snapshot), §22 scored
 * discipline (the correctAnswer NEVER ships — option labels only), §14
 * (market scoping — the owning unit must be VERIFIED and GLOBAL or the
 * reader country's, anchored to a topic visible in the market's tree),
 * §35 (reader-language items with the honest, labelled English fallback),
 * §16 (canonical /pyq/… paths via buildCanonicalUrl + buildPageSeo blocks),
 * §29 (60s cached public payloads), §36 (lifecycle-aware reads), §37
 * (deterministic ordering, server-side pagination, typed errors,
 * client-agnostic DTOs), §38 (public surface — everyone, no auth).
 *
 * The admin half (console PYQ section) rides `question:manage` (the
 * user-confirmed decision — no new permission), re-asserted at the service
 * boundary (§20 defense in depth), with every mutation audited under the
 * PYQ_PROVENANCE object type (the sitePages precedent).
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  buildCanonicalUrl,
  findConfiguredCountryStatusByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit, type AuditRequestMeta } from '@/modules/audit'
import { buildPageSeo } from '@/modules/seo'
import { getPublicTree } from '@/modules/taxonomy'
import type { PublicTopicNode } from '@/modules/taxonomy'

import { CANONICAL_LANGUAGE_CODE, PYQ_QNA_TAKE } from './constants'
import { loadQuestionProvenanceMap, loadQnaProvenanceMap } from './provenance-loader'
import type {
  CreatePyqProvenanceInput,
  PyqAdminListQuery,
  UpdatePyqProvenanceInput,
} from './validation'
import type {
  PyqAdminProvenanceListResult,
  PyqAdminProvenanceRow,
  PyqExamYears,
  PyqIndex,
  PyqIndexExam,
  PyqProvenanceKind,
  PyqYear,
  PyqYearQuestion,
  PyqYearQna,
} from './types'

// ---------- Typed errors (mapped to HTTP by the route handlers, §37) ----------

export type PyqErrorCode =
  | 'COUNTRY_NOT_FOUND'
  | 'EXAM_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'DUPLICATE_PROVENANCE'
  | 'NOT_FOUND'

const ERROR_STATUS: Record<PyqErrorCode, number> = {
  COUNTRY_NOT_FOUND: 404,
  EXAM_NOT_FOUND: 404,
  TARGET_NOT_FOUND: 404,
  DUPLICATE_PROVENANCE: 409,
  NOT_FOUND: 404,
}

export class PyqError extends Error {
  readonly code: PyqErrorCode
  readonly status: number

  constructor(code: PyqErrorCode, message: string) {
    super(message)
    this.name = 'PyqError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown PyqError to envelope data (§37); null for others. */
export function toPyqErrorResponse(
  error: unknown
): { message: string; code: PyqErrorCode; status: number } | null {
  if (error instanceof PyqError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Shared reader-context helpers (the practice-listing pattern) ----------

/** The resolved reader context of one public pyq request. */
interface PyqContext {
  publicCountry: NonNullable<Awaited<ReturnType<typeof getPublicCountry>>>
  countryRow: { id: string; status: string }
  language: { code: string; name: string }
  defaultLanguageCode: string
}

/** Resolves the reader context, surfacing locale failures as the typed
 * COUNTRY_NOT_FOUND (the practice-listing precedent). */
async function resolveReaderContext(input: {
  country?: string
  language?: string
}): Promise<PyqContext> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new PyqError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }

  const [publicCountry, countryRow] = await Promise.all([
    getPublicCountry(resolution.country.isoCode),
    findConfiguredCountryStatusByIso(resolution.country.isoCode),
  ])
  if (!publicCountry || !countryRow) {
    throw new PyqError('COUNTRY_NOT_FOUND', 'Country not available')
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
 * The market's visible tree resolved into the topic maps the year page's
 * cards need (root-subject labels + topic slugs) — the taxonomy snapshot is
 * cache-served, no extra database round-trips (the practice-listing
 * precedent, minus the chip vocabulary).
 */
async function loadSubjectMaps(input: { country?: string; language?: string }): Promise<{
  subjectByTopicId: Map<string, { slug: string; label: string }>
  topicSlugById: Map<string, string>
}> {
  const tree = await getPublicTree({ country: input.country, language: input.language })
  const subjectByTopicId = new Map<string, { slug: string; label: string }>()
  const topicSlugById = new Map<string, string>()
  const walk = (nodes: PublicTopicNode[], root: PublicTopicNode) => {
    for (const node of nodes) {
      subjectByTopicId.set(node.id, { slug: root.slug, label: root.label })
      topicSlugById.set(node.id, node.slug)
      walk(node.children, root)
    }
  }
  for (const root of tree) walk([root], root)
  return { subjectByTopicId, topicSlugById }
}

/**
 * The §14/§36 unit visibility clause every public pyq read shares: VERIFIED
 * unit, GLOBAL or the reader country's own scope, anchored to a topic
 * visible in the market's tree (a Question/QnA is never more visible than
 * its record).
 */
function visibleUnitsWhere(
  context: PyqContext,
  topicIds: string[]
): Prisma.KnowledgeUnitWhereInput {
  return {
    status: 'VERIFIED',
    topicId: { in: topicIds },
    OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY' as const, countryId: context.countryRow.id }],
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

/** The §16 /pyq/ path family: …/pyq/, …/pyq/{exam}/, …/pyq/{exam}/{year}/. */
function pyqPath(context: PyqContext, languageCode: string, segments: string[]): string {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: languageCode },
    context.defaultLanguageCode,
    segments
  )
}

// ---------- The provenance aggregate (index + per-exam share this) ----------

/**
 * One exam-year cell of the aggregate: distinct questions and distinct Q&As
 * with provenance in that sitting (a question with two papers of one sitting
 * still counts once).
 */
interface YearCell {
  questions: Set<string>
  qnas: Set<string>
}

/** Loads the visible provenance aggregate for one language (optionally one
 * exam): examId × year → distinct item ids. One query per kind. */
async function loadProvenanceAggregate(params: {
  context: PyqContext
  topicIds: string[]
  languageId: string
  examId?: string
}): Promise<Map<string, YearCell>> {
  const { context, topicIds, languageId, examId } = params
  const [questionRows, qnaRows] = await Promise.all([
    db.questionProvenance.findMany({
      where: {
        ...(examId ? { examId } : {}),
        question: {
          status: 'PUBLISHED',
          publishedRevisionId: { not: null },
          languageId,
          knowledgeUnit: visibleUnitsWhere(context, topicIds),
        },
      },
      select: { examId: true, year: true, questionId: true },
    }),
    db.qnAProvenance.findMany({
      where: {
        ...(examId ? { examId } : {}),
        qna: {
          status: 'PUBLISHED',
          publishedRevisionId: { not: null },
          languageId,
          knowledgeUnit: visibleUnitsWhere(context, topicIds),
        },
      },
      select: { examId: true, year: true, qnaId: true },
    }),
  ])

  const cells = new Map<string, YearCell>()
  const cell = (examId: string, year: number) => {
    const key = `${examId}:${year}`
    const existing = cells.get(key)
    if (existing) return existing
    const fresh: YearCell = { questions: new Set(), qnas: new Set() }
    cells.set(key, fresh)
    return fresh
  }
  for (const row of questionRows) cell(row.examId, row.year).questions.add(row.questionId)
  for (const row of qnaRows) cell(row.examId, row.year).qnas.add(row.qnaId)
  return cells
}

/** The newest live-revision publication among the visible provenance-carrying
 * items of a scope (the honest lastmod, the practice-listing precedent). */
async function loadLastModified(params: {
  context: PyqContext
  topicIds: string[]
  languageId: string
  examId?: string
}): Promise<Date | null> {
  const { context, topicIds, languageId, examId } = params
  const shared = {
    status: 'PUBLISHED' as const,
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: visibleUnitsWhere(context, topicIds),
    ...(examId ? { provenance: { some: { examId } } } : { provenance: { some: {} } }),
  }
  const [latestQuestion, latestQna] = await Promise.all([
    db.question.findFirst({
      where: shared,
      orderBy: { publishedRevision: { publishedAt: 'desc' } },
      select: { publishedRevision: { select: { publishedAt: true } } },
    }),
    db.qnA.findFirst({
      where: shared,
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

/** Assembles the exam cards of the index from an aggregate — only exams with
 * ≥1 visible item, total count desc then name (§37 deterministic). The exam
 * card's counts are DISTINCT items (a question asked in two sittings is one
 * practice item, listed on both year pages). */
async function toIndexExams(cells: Map<string, YearCell>): Promise<PyqIndexExam[]> {
  const examIds = [...new Set([...cells.keys()].map((key) => key.split(':')[0]!))]
  const exams =
    examIds.length > 0
      ? await db.exam.findMany({
          where: { id: { in: examIds } },
          select: { id: true, slug: true, name: true, organiser: true },
        })
      : []
  const examById = new Map(exams.map((exam) => [exam.id, exam]))

  const byExam = new Map<
    string,
    { exam: (typeof exams)[number]; questions: Set<string>; qnas: Set<string>; years: Map<number, number> }
  >()
  for (const [key, cell] of cells) {
    const [examId, yearRaw] = key.split(':')
    const exam = examById.get(examId!)
    if (!exam) continue // a deleted exam leaves no rows (FK) — defense in depth
    if (cell.questions.size === 0 && cell.qnas.size === 0) continue
    const entry = byExam.get(exam.id) ?? { exam, questions: new Set<string>(), qnas: new Set<string>(), years: new Map<number, number>() }
    for (const id of cell.questions) entry.questions.add(id)
    for (const id of cell.qnas) entry.qnas.add(id)
    const year = Number(yearRaw)
    entry.years.set(year, (entry.years.get(year) ?? 0) + cell.questions.size + cell.qnas.size)
    byExam.set(exam.id, entry)
  }

  return [...byExam.values()]
    .map((entry) => ({
      examSlug: entry.exam.slug,
      examName: entry.exam.name,
      organiser: entry.exam.organiser,
      questionCount: entry.questions.size,
      qnaCount: entry.qnas.size,
      years: [...entry.years.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => b.year - a.year),
    }))
    .sort(
      (a, b) =>
        b.questionCount + b.qnaCount - (a.questionCount + a.qnaCount) ||
        a.examName.localeCompare(b.examName)
    )
}

// ---------- Public reads: the /pyq/ directory ----------

/**
 * The /pyq/ index for one country × language context (60s cached payload):
 * exam cards with PYQ counts + year groups — only exams with ≥1 published
 * question or Q&A visible in the reader's market, §35 fallback included.
 */
export async function getPyqIndex(input: { country?: string; language?: string }): Promise<PyqIndex> {
  const cacheKey = ['pyq:index', input.country ?? 'default', input.language ?? 'default'].join(':')
  return cachedPayload(cacheKey, () => loadPyqIndex(input))
}

async function loadPyqIndex(input: { country?: string; language?: string }): Promise<PyqIndex> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId } = await loadSubjectMaps(input)
  const topicIds = [...subjectByTopicId.keys()]

  // ---------- First pass: the reader's language ----------
  let cells = await loadProvenanceAggregate({ context, topicIds, languageId: readerLanguageId })
  let fallback = false
  let languageId = readerLanguageId

  // ---------- §35 honest fallback (the practice-listing rule, verbatim) ----------
  if (cells.size === 0 && language.code !== CANONICAL_LANGUAGE_CODE && englishLanguageId != null) {
    const englishCells = await loadProvenanceAggregate({
      context,
      topicIds,
      languageId: englishLanguageId,
    })
    if (englishCells.size > 0) {
      cells = englishCells
      languageId = englishLanguageId
      fallback = true
    }
  }

  const exams = await toIndexExams(cells)
  const lastModified = await loadLastModified({ context, topicIds, languageId })

  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => pyqPath(context, code, ['pyq']),
    lastModified,
  })

  const index: PyqIndex = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exams,
    seo,
    seoTitle: 'Previous Year Questions (PYQ) — GK & Current Affairs | GKSetu',
    seoDescription:
      'Solve previous year questions (PYQ) from UPSC, SSC and other exams — year-wise practice with answers and explanations, free on GKSetu.',
  }
  if (fallback) index.fallback = true
  return index
}

/**
 * The per-exam year groups for one country × language context (60s cached):
 * `exam: null` is the honest unknown-exam empty state (the practice-listing
 * unknown-subject behaviour — an ok envelope, never an error).
 */
export async function getPyqExam(
  examSlug: string,
  input: { country?: string; language?: string }
): Promise<PyqExamYears> {
  const cacheKey = [
    'pyq:exam',
    input.country ?? 'default',
    input.language ?? 'default',
    examSlug,
  ].join(':')
  return cachedPayload(cacheKey, () => loadPyqExam(examSlug, input))
}

async function loadPyqExam(
  examSlug: string,
  input: { country?: string; language?: string }
): Promise<PyqExamYears> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId } = await loadSubjectMaps(input)
  const topicIds = [...subjectByTopicId.keys()]

  // ---------- Unknown exam: the honest empty state ----------
  const exam = await db.exam.findUnique({
    where: { slug: examSlug },
    select: { id: true, slug: true, name: true, organiser: true },
  })
  if (!exam) {
    const seo = buildPageSeo({
      country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
      defaultLanguageCode,
      languageCode: language.code,
      languages: publicCountry.languages,
      pathFor: (code) => pyqPath(context, code, ['pyq']),
      noindexReason: 'Unknown exam — no PYQ page exists for this slug',
    })
    return {
      country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
      language,
      exam: null,
      years: [],
      total: 0,
      seo,
      seoTitle: 'Previous Year Questions (PYQ) — GK & Current Affairs | GKSetu',
      seoDescription:
        'Solve previous year questions (PYQ) from UPSC, SSC and other exams — year-wise practice with answers and explanations, free on GKSetu.',
    }
  }

  // ---------- First pass + §35 honest fallback ----------
  let cells = await loadProvenanceAggregate({
    context,
    topicIds,
    languageId: readerLanguageId,
    examId: exam.id,
  })
  let fallback = false
  let languageId = readerLanguageId
  if (cells.size === 0 && language.code !== CANONICAL_LANGUAGE_CODE && englishLanguageId != null) {
    const englishCells = await loadProvenanceAggregate({
      context,
      topicIds,
      languageId: englishLanguageId,
      examId: exam.id,
    })
    if (englishCells.size > 0) {
      cells = englishCells
      languageId = englishLanguageId
      fallback = true
    }
  }

  const yearEntries = [...cells.entries()]
    .map(([key, cell]) => ({
      year: Number(key.split(':')[1]),
      count: cell.questions.size + cell.qnas.size,
      questions: cell.questions,
      qnas: cell.qnas,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.year - a.year)
  // Distinct items across the years (a question asked in two sittings is
  // one practice item, listed on both year pages).
  const distinctQuestions = new Set(yearEntries.flatMap((entry) => [...entry.questions]))
  const distinctQnas = new Set(yearEntries.flatMap((entry) => [...entry.qnas]))
  const total = distinctQuestions.size + distinctQnas.size
  const years = yearEntries.map(({ year, count }) => ({ year, count }))
  const lastModified = await loadLastModified({ context, topicIds, languageId, examId: exam.id })

  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => pyqPath(context, code, ['pyq', exam.slug]),
    lastModified,
  })

  const payload: PyqExamYears = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exam: { slug: exam.slug, name: exam.name, organiser: exam.organiser },
    years,
    total,
    seo,
    seoTitle: `${exam.name} Previous Year Questions (PYQ) | GKSetu`,
    seoDescription: `${exam.name} previous year questions (PYQ), year-wise with answers and explanations — free practice on GKSetu.`,
  }
  if (fallback) payload.fallback = true
  return payload
}

/**
 * The year practice page for one exam × sitting (60s cached): practice MCQ
 * cards in the EXACT PracticeQuestionCard shape (labels only — the
 * correctAnswer NEVER ships) + mains-style Q&A cards, each carrying ALL its
 * provenance appearances. Questions are server-paginated newest-published
 * first; the Q&A list rides along bounded (§37).
 */
export async function getPyqYear(
  examSlug: string,
  year: number,
  input: { country?: string; language?: string; page?: number; pageSize?: number }
): Promise<PyqYear> {
  const cacheKey = [
    'pyq:year',
    input.country ?? 'default',
    input.language ?? 'default',
    examSlug,
    year,
    input.page ?? 1,
    input.pageSize ?? 12,
  ].join(':')
  return cachedPayload(cacheKey, () => loadPyqYear(examSlug, year, input))
}

async function loadPyqYear(
  examSlug: string,
  year: number,
  input: { country?: string; language?: string; page?: number; pageSize?: number }
): Promise<PyqYear> {
  const context = await resolveReaderContext(input)
  const { publicCountry, language, defaultLanguageCode } = context
  const { readerLanguageId, englishLanguageId } = await loadLanguagePair(language.code)
  const { subjectByTopicId, topicSlugById } = await loadSubjectMaps(input)
  const topicIds = [...subjectByTopicId.keys()]

  // ---------- Unknown exam: the honest empty state ----------
  const exam = await db.exam.findUnique({
    where: { slug: examSlug },
    select: { id: true, slug: true, name: true, organiser: true },
  })
  if (!exam) {
    const seo = buildPageSeo({
      country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
      defaultLanguageCode,
      languageCode: language.code,
      languages: publicCountry.languages,
      pathFor: (code) => pyqPath(context, code, ['pyq']),
      noindexReason: 'Unknown exam — no PYQ page exists for this slug',
    })
    return {
      country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
      language,
      exam: null,
      year,
      questions: [],
      qna: [],
      pagination: { page: 1, pageSize: input.pageSize ?? 12, total: 0, totalPages: 1 },
      seo,
      seoTitle: 'Previous Year Questions (PYQ) — GK & Current Affairs | GKSetu',
      seoDescription:
        'Solve previous year questions (PYQ) from UPSC, SSC and other exams — year-wise practice with answers and explanations, free on GKSetu.',
    }
  }

  // ---------- The visibility gate + the sitting filter ----------
  // Same clause as the practice listings (§19/§14), narrowed to items whose
  // provenance records THIS exam × year sitting.
  const questionsWhere = (languageId: string): Prisma.QuestionWhereInput => ({
    status: 'PUBLISHED',
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: visibleUnitsWhere(context, topicIds),
    provenance: { some: { examId: exam.id, year } },
  })
  const qnaWhere = (languageId: string): Prisma.QnAWhereInput => ({
    status: 'PUBLISHED',
    publishedRevisionId: { not: null },
    languageId,
    knowledgeUnit: visibleUnitsWhere(context, topicIds),
    provenance: { some: { examId: exam.id, year } },
  })

  // ---------- First pass + §35 honest fallback (BOTH lists swap together) ----------
  const countLists = async (languageId: string) =>
    Promise.all([db.question.count({ where: questionsWhere(languageId) }), db.qnA.count({ where: qnaWhere(languageId) })])
  let [totalQuestions, totalQna] = await countLists(readerLanguageId)
  let fallback = false
  let languageId = readerLanguageId
  if (
    totalQuestions === 0 &&
    totalQna === 0 &&
    language.code !== CANONICAL_LANGUAGE_CODE &&
    englishLanguageId != null
  ) {
    const [englishQuestions, englishQna] = await countLists(englishLanguageId)
    if (englishQuestions > 0 || englishQna > 0) {
      totalQuestions = englishQuestions
      totalQna = englishQna
      languageId = englishLanguageId
      fallback = true
    }
  }

  // ---------- Pagination (§37 deterministic: newest-published, id asc) ----------
  const pageSize = input.pageSize ?? 12
  const totalPages = Math.max(1, Math.ceil(totalQuestions / pageSize))
  const page = Math.min(input.page ?? 1, totalPages) // clamp into range

  const [questionRows, qnaRows] = await Promise.all([
    totalQuestions > 0
      ? db.question.findMany({
          where: questionsWhere(languageId),
          orderBy: [{ publishedRevision: { publishedAt: 'desc' } }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            knowledgeUnit: { select: { slug: true, canonicalName: true, topicId: true } },
            publishedRevision: { select: { questionText: true, optionsJson: true, difficulty: true } },
          },
        })
      : Promise.resolve([]),
    totalQna > 0
      ? db.qnA.findMany({
          where: qnaWhere(languageId),
          orderBy: [{ publishedRevision: { publishedAt: 'desc' } }, { id: 'asc' }],
          take: PYQ_QNA_TAKE,
          select: {
            id: true,
            knowledgeUnit: { select: { slug: true, canonicalName: true, topicId: true } },
            publishedRevision: { select: { questionText: true, answerBody: true } },
          },
        })
      : Promise.resolve([]),
  ])

  // ---------- The cards + the batched provenance badges (no N+1) ----------
  const questionIds = questionRows
    .filter((row) => row.publishedRevision != null)
    .map((row) => row.id)
  const qnaIds = qnaRows.filter((row) => row.publishedRevision != null).map((row) => row.id)
  const [questionProvenance, qnaProvenance] = await Promise.all([
    loadQuestionProvenanceMap(questionIds),
    loadQnaProvenanceMap(qnaIds),
  ])

  const questions: PyqYearQuestion[] = questionRows
    .filter((row) => row.publishedRevision != null)
    .map((row) => {
      const unit = row.knowledgeUnit
      return {
        id: row.id,
        questionText: row.publishedRevision!.questionText,
        options: optionLabels(row.publishedRevision!.optionsJson),
        difficulty: row.publishedRevision!.difficulty as PyqYearQuestion['difficulty'],
        subject: subjectByTopicId.get(unit.topicId) ?? null,
        unit: {
          slug: unit.slug,
          canonicalName: unit.canonicalName,
          topicSlug: topicSlugById.get(unit.topicId) ?? unit.slug,
        },
        provenance: questionProvenance.get(row.id) ?? [],
      }
    })

  const qna: PyqYearQna[] = qnaRows
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

  // ---------- lastmod: the newest live revision of this sitting ----------
  const lastModified = await loadLastModified({ context, topicIds, languageId, examId: exam.id })

  const seo = buildPageSeo({
    country: { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
    defaultLanguageCode,
    languageCode: language.code,
    languages: publicCountry.languages,
    pathFor: (code) => pyqPath(context, code, ['pyq', exam.slug, String(year)]),
    lastModified,
  })

  const payload: PyqYear = {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    exam: { slug: exam.slug, name: exam.name, organiser: exam.organiser },
    year,
    questions,
    qna,
    pagination: { page, pageSize, total: totalQuestions, totalPages },
    seo,
    seoTitle: `${exam.name} ${year} Previous Year Questions with Answers | GKSetu`,
    seoDescription: `Practice the ${exam.name} ${year} previous year questions (PYQ) with answers and explanations — free on GKSetu.`,
  }
  if (fallback) payload.fallback = true
  return payload
}

// ---------- Admin (console): the provenance registry ----------
//
// Rides `question:manage` (the user-confirmed decision — no new permission),
// re-asserted here at the service boundary (§20 defense in depth). The two
// provenance tables are unioned in memory: the console's registry is a
// curated few-hundred-row surface, so one filtered query per kind + a JS
// merge keeps the contract one shape (§37) without a cross-table SQL union.

/** Stable audit label for a provenance row. */
function provenanceLabel(kind: PyqProvenanceKind, examName: string, year: number, paper: string) {
  return `PYQ ${kind} · ${examName} ${year}${paper ? ` (${paper})` : ''}`
}

/** Truncates a question text for the table (~140 chars, the assessment
 * excerpt precedent). */
function excerpt(text: string, length = 140): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

/** The unit-scope clause of the console reads: ADMIN sees everything;
 * COUNTRY_ADMIN + WRITER see global + own-country targets (the questions
 * registry precedent, §20). */
function adminScopeFilter(actor: Actor): Prisma.QuestionWhereInput | Prisma.QnAWhereInput | undefined {
  if (actor.role === 'ADMIN') return undefined
  return {
    knowledgeUnit: {
      OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }],
    },
  }
}

/** GET /api/pyq/admin — the console's provenance table. */
export async function listProvenanceAdmin(
  actor: Actor,
  query: PyqAdminListQuery
): Promise<PyqAdminProvenanceListResult> {
  assertCan(actor, 'question:manage')

  let examId: string | undefined
  let examName = ''
  if (query.exam) {
    const exam = await db.exam.findUnique({ where: { slug: query.exam } })
    if (!exam) throw new PyqError('EXAM_NOT_FOUND', `Unknown exam "${query.exam}"`)
    examId = exam.id
    examName = exam.name
  }

  const questionWhere = {
    ...(examId ? { examId } : {}),
    ...(query.year ? { year: query.year } : {}),
    ...(query.q
      ? { question: { questionText: { contains: query.q, mode: 'insensitive' as const } } }
      : {}),
    ...(adminScopeFilter(actor) ? { question: adminScopeFilter(actor) as Prisma.QuestionWhereInput } : {}),
  }
  const qnaWhere = {
    ...(examId ? { examId } : {}),
    ...(query.year ? { year: query.year } : {}),
    ...(query.q ? { qna: { questionText: { contains: query.q, mode: 'insensitive' as const } } } : {}),
    ...(adminScopeFilter(actor) ? { qna: adminScopeFilter(actor) as Prisma.QnAWhereInput } : {}),
  }

  const [questionRows, qnaRows] = await Promise.all([
    query.kind === 'QNA'
      ? Promise.resolve([])
      : db.questionProvenance.findMany({
          where: questionWhere,
          select: {
            id: true,
            questionId: true,
            year: true,
            paper: true,
            questionNumber: true,
            notes: true,
            updatedAt: true,
            exam: { select: { slug: true, name: true } },
            question: { select: { questionText: true, status: true } },
          },
        }),
    query.kind === 'QUESTION'
      ? Promise.resolve([])
      : db.qnAProvenance.findMany({
          where: qnaWhere,
          select: {
            id: true,
            qnaId: true,
            year: true,
            paper: true,
            notes: true,
            updatedAt: true,
            exam: { select: { slug: true, name: true } },
            qna: { select: { questionText: true, status: true } },
          },
        }),
  ])

  const items: PyqAdminProvenanceRow[] = [
    ...questionRows.map(
      (row): PyqAdminProvenanceRow => ({
        id: row.id,
        kind: 'QUESTION',
        targetId: row.questionId,
        questionText: excerpt(row.question.questionText),
        targetStatus: row.question.status,
        examSlug: row.exam.slug,
        examName: row.exam.name,
        year: row.year,
        paper: row.paper,
        questionNumber: row.questionNumber,
        notes: row.notes,
        updatedAt: row.updatedAt.toISOString(),
      })
    ),
    ...qnaRows.map(
      (row): PyqAdminProvenanceRow => ({
        id: row.id,
        kind: 'QNA',
        targetId: row.qnaId,
        questionText: excerpt(row.qna.questionText),
        targetStatus: row.qna.status,
        examSlug: row.exam.slug,
        examName: row.exam.name,
        year: row.year,
        paper: row.paper,
        questionNumber: null, // QnA sittings carry no question number
        notes: row.notes,
        updatedAt: row.updatedAt.toISOString(),
      })
    ),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)) // newest first (§37)

  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, totalPages)
  const paged = items.slice((page - 1) * query.pageSize, page * query.pageSize)

  return {
    items: paged,
    pagination: { page, pageSize: query.pageSize, total, totalPages },
    summary: {
      total: questionRows.length + qnaRows.length,
      questions: questionRows.length,
      qnas: qnaRows.length,
    },
  }
}

// ---------- Admin writes (create / update / delete) ----------

/** Resolves the exam of a provenance write: must exist AND be ACTIVE (the
 * PYQ directory is a public surface — only live exams get new sittings). */
async function loadActiveExamBySlug(slug: string) {
  const exam = await db.exam.findUnique({ where: { slug } })
  if (!exam) {
    throw new PyqError('EXAM_NOT_FOUND', `Exam "${slug}" not found`)
  }
  if (exam.status !== 'ACTIVE') {
    throw new PyqError('EXAM_NOT_FOUND', `Exam "${exam.name}" is not an ACTIVE exam — provenance records only live exams`)
  }
  return exam
}

/** POST /api/pyq/admin — record one exam-sitting appearance. */
export async function createPyqProvenance(
  actor: Actor,
  input: CreatePyqProvenanceInput,
  meta: AuditRequestMeta
): Promise<PyqAdminProvenanceRow> {
  assertCan(actor, 'question:manage')

  const exam = await loadActiveExamBySlug(input.examSlug)

  // The target must exist (a cuid id — the console passes what it picked).
  const target =
    input.kind === 'QUESTION'
      ? await db.question.findUnique({
          where: { id: input.targetId },
          select: { id: true, questionText: true, status: true },
        })
      : await db.qnA.findUnique({
          where: { id: input.targetId },
          select: { id: true, questionText: true, status: true },
        })
  if (!target) {
    throw new PyqError(
      'TARGET_NOT_FOUND',
      input.kind === 'QUESTION' ? 'Question not found' : 'Q&A not found'
    )
  }

  // The honest duplicate check: (target × exam × year × paper) is unique —
  // a question never lists twice in the same sitting/paper (§ the schema's
  // NULLs-DISTINCT fix).
  const duplicate =
    input.kind === 'QUESTION'
      ? await db.questionProvenance.findFirst({
          where: {
            questionId: target.id,
            examId: exam.id,
            year: input.year,
            paper: input.paper,
          },
          select: { id: true },
        })
      : await db.qnAProvenance.findFirst({
          where: { qnaId: target.id, examId: exam.id, year: input.year, paper: input.paper },
          select: { id: true },
        })
  if (duplicate) {
    throw new PyqError(
      'DUPLICATE_PROVENANCE',
      `This ${input.kind === 'QUESTION' ? 'question' : 'Q&A'} is already recorded for ${exam.name} ${input.year}${input.paper ? ` (${input.paper})` : ''}`
    )
  }

  const row =
    input.kind === 'QUESTION'
      ? await db.questionProvenance.create({
          data: {
            questionId: target.id,
            examId: exam.id,
            year: input.year,
            paper: input.paper,
            questionNumber: input.questionNumber ?? null,
            notes: input.notes ?? null,
            createdById: actor.userId,
          },
          include: { exam: { select: { slug: true, name: true } } },
        })
      : await db.qnAProvenance.create({
          data: {
            qnaId: target.id,
            examId: exam.id,
            year: input.year,
            paper: input.paper,
            notes: input.notes ?? null,
            createdById: actor.userId,
          },
          include: { exam: { select: { slug: true, name: true } } },
        })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.pyqProvenanceCreate,
    objectType: AUDIT_OBJECT_TYPES.pyqProvenance,
    objectId: row.id,
    objectLabel: provenanceLabel(input.kind, row.exam.name, row.year, row.paper),
    before: null,
    after: {
      kind: input.kind,
      targetId: input.targetId,
      examSlug: row.exam.slug,
      year: row.year,
      paper: row.paper,
      questionNumber: 'questionNumber' in row ? row.questionNumber : null,
    },
    ...meta,
  })

  return {
    id: row.id,
    kind: input.kind,
    targetId: input.targetId,
    questionText: excerpt(target.questionText),
    targetStatus: target.status,
    examSlug: row.exam.slug,
    examName: row.exam.name,
    year: row.year,
    paper: row.paper,
    questionNumber: 'questionNumber' in row ? row.questionNumber : null,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** PATCH /api/pyq/admin/{id} — correct the sitting metadata (year/paper/
 * question number/notes; the target and the exam are create-time anchors). */
export async function updatePyqProvenance(
  actor: Actor,
  id: string,
  input: UpdatePyqProvenanceInput,
  meta: AuditRequestMeta
): Promise<PyqAdminProvenanceRow> {
  assertCan(actor, 'question:manage')

  const existing =
    (await db.questionProvenance.findUnique({
      where: { id },
      include: {
        exam: { select: { slug: true, name: true } },
        question: { select: { questionText: true, status: true } },
      },
    })) ??
    (await db.qnAProvenance.findUnique({
      where: { id },
      include: {
        exam: { select: { slug: true, name: true } },
        qna: { select: { questionText: true, status: true } },
      },
    }))
  if (!existing) {
    throw new PyqError('NOT_FOUND', 'Provenance record not found')
  }

  const kind: PyqProvenanceKind = 'questionId' in existing ? 'QUESTION' : 'QNA'
  const targetId =
    kind === 'QUESTION' ? (existing as { questionId: string }).questionId : (existing as { qnaId: string }).qnaId
  const target =
    kind === 'QUESTION' ? (existing as { question: { questionText: string; status: string } }).question : (existing as { qna: { questionText: string; status: string } }).qna

  const year = input.year ?? existing.year
  const paper = input.paper ?? existing.paper
  const questionNumber =
    kind === 'QUESTION' && 'questionNumber' in existing && input.questionNumber !== undefined
      ? input.questionNumber ?? null
      : kind === 'QUESTION'
        ? (existing as { questionNumber: string | null }).questionNumber
        : null
  const notes = input.notes !== undefined ? input.notes ?? null : existing.notes

  // A year/paper change can collide with another sitting of the same exam.
  if (input.year !== undefined || input.paper !== undefined) {
    const duplicate =
      kind === 'QUESTION'
        ? await db.questionProvenance.findFirst({
            where: {
              questionId: targetId,
              examId: existing.examId,
              year,
              paper,
              id: { not: id },
            },
            select: { id: true },
          })
        : await db.qnAProvenance.findFirst({
            where: { qnaId: targetId, examId: existing.examId, year, paper, id: { not: id } },
            select: { id: true },
          })
    if (duplicate) {
      throw new PyqError(
        'DUPLICATE_PROVENANCE',
        `This ${kind === 'QUESTION' ? 'question' : 'Q&A'} already has a record for ${existing.exam.name} ${year}${paper ? ` (${paper})` : ''}`
      )
    }
  }

  const row =
    kind === 'QUESTION'
      ? await db.questionProvenance.update({
          where: { id },
          data: { year, paper, questionNumber, notes },
          include: { exam: { select: { slug: true, name: true } } },
        })
      : await db.qnAProvenance.update({
          where: { id },
          data: { year, paper, notes },
          include: { exam: { select: { slug: true, name: true } } },
        })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.pyqProvenanceUpdate,
    objectType: AUDIT_OBJECT_TYPES.pyqProvenance,
    objectId: id,
    objectLabel: provenanceLabel(kind, row.exam.name, row.year, row.paper),
    before: {
      year: existing.year,
      paper: existing.paper,
      questionNumber: kind === 'QUESTION' ? (existing as { questionNumber: string | null }).questionNumber : null,
      notes: existing.notes,
    },
    after: { year: row.year, paper: row.paper, questionNumber: 'questionNumber' in row ? row.questionNumber : null, notes: row.notes },
    ...meta,
  })

  return {
    id: row.id,
    kind,
    targetId,
    questionText: excerpt(target.questionText),
    targetStatus: target.status,
    examSlug: row.exam.slug,
    examName: row.exam.name,
    year: row.year,
    paper: row.paper,
    questionNumber: 'questionNumber' in row ? row.questionNumber : null,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** DELETE /api/pyq/admin/{id} — remove one sitting record. */
export async function deletePyqProvenance(
  actor: Actor,
  id: string,
  meta: AuditRequestMeta
): Promise<void> {
  assertCan(actor, 'question:manage')

  const existing =
    (await db.questionProvenance.findUnique({
      where: { id },
      include: { exam: { select: { slug: true, name: true } } },
    })) ??
    (await db.qnAProvenance.findUnique({
      where: { id },
      include: { exam: { select: { slug: true, name: true } } },
    }))
  if (!existing) {
    throw new PyqError('NOT_FOUND', 'Provenance record not found')
  }

  const kind: PyqProvenanceKind = 'questionId' in existing ? 'QUESTION' : 'QNA'

  await (kind === 'QUESTION'
    ? db.questionProvenance.delete({ where: { id } })
    : db.qnAProvenance.delete({ where: { id } }))

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.pyqProvenanceDelete,
    objectType: AUDIT_OBJECT_TYPES.pyqProvenance,
    objectId: id,
    objectLabel: provenanceLabel(kind, existing.exam.name, existing.year, existing.paper),
    before: {
      kind,
      targetId: kind === 'QUESTION' ? (existing as { questionId: string }).questionId : (existing as { qnaId: string }).qnaId,
      examSlug: existing.exam.slug,
      year: existing.year,
      paper: existing.paper,
    },
    after: null,
    ...meta,
  })
}
