/**
 * GlobIQ — Assessment: MockTest + TestAttempt domain service (P7-S3)
 * Master Plan §6 (MockTest row: title, scope, question_ids[],
 * duration_minutes, pass_criteria, exam_version_id optional, status;
 * TestAttempt row: user_id, mock_test_id, started_at, submitted_at,
 * answers[], score, per-question correctness), §7 (a MockTest is a composed
 * REPRESENTATION of canonical Questions — the facts are never re-entered,
 * only re-assembled and timed), §19 (the editorial workflow: submit →
 * review → publish/schedule, every transition audited, published tests
 * immutable at the revision level), §22 (the scored, timed, composed
 * assessment layer — the runner; TestAttempt history is the mastery signal
 * P7-S4 consumes), §23 ("MockTest (scored, timed, composed of Questions)" —
 * the v2.0 three-way QnA/Question/MockTest split, §46.14), §24/§26
 * (AI-provenance: an AI-suggested composition freezes the flag onto each
 * published revision), §35 (language exposure is per-country, enforced
 * server-side — a test is a representation product; every composed Question
 * must match its language), §14/§15 (country scope: the test inherits its
 * SCOPE's country — an EXAM test from the exam, a TOPIC test from the topic;
 * composed questions may only sit on GLOBAL units or the test's own
 * country's units — a test is never more visible than its questions), §36
 * (revisions preserve previous compositions; corrections carry
 * changeSummary; RETIRED is read-only end-of-life; SUBMITTED attempts are
 * immutable history), §37 (service-boundary authorization, deterministic
 * ordering, explicit typed errors, the …/mock-tests/{slug}/ URL identity),
 * §38 (scoped admin reads), §43 (P7-S3 scope).
 *
 * Architecture (the ContentItem/QnA/Question twin, NOT a clone — §46.14):
 * title/scope/language are CREATE-TIME identity (§11 — re-titling or
 * re-scoping is a new test); questionIdsJson/durationMinutes/passPercent are
 * the WORKING COPY (editorial staging); public reads ALWAYS serve the live
 * MockTestRevision snapshot. The correctAnswer/explanation NEVER ship on the
 * running surface: they are revealed per-question only in the post-submit
 * attempt result (§22 scored discipline — the Question twin's practice
 * reveal, now timed and composed). TestAttempt carries the deal it was
 * started under (served composition, duration, pass criteria — deadlineAt is
 * server-side truth; the client timer is only presentation).
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  findActiveLanguageByCode,
  isLanguageConfiguredForCountry,
} from '@/modules/country-locale'
import { wireMockTestWorkflow } from '@/modules/editorial'

import type {
  AdminMockTestDetail,
  AdminMockTestEntry,
  AdminMockTestListResult,
  AdminMockTestQuestionRef,
  AdminMockTestRevisionListResult,
  AttemptAnswerRecord,
  AttemptResult,
  AttemptResultQuestion,
  AttemptStateResponse,
  MockTestRevisionRef,
  MockTestScopeRef,
  MockTestStatusPublic,
  MockTestTransitionAction,
  PublicAttemptState,
  PublicMockTestCard,
  PublicMockTestDetail,
  PublicMockTestQuestion,
} from './mocktest-types'
import {
  MOCK_TEST_EDITABILITY,
  MOCK_TEST_PUBLISH_GATED_ACTIONS,
  MOCK_TEST_RULES,
  MOCK_TEST_TRANSITIONS,
} from './mocktest-types'
import type {
  AdminMockTestListQuery,
  AttemptSubmitInput,
  CreateMockTestInput,
  MockTestTransitionInput,
  PublicMockTestListQuery,
  UpdateMockTestInput,
} from './mocktest-validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type MockTestErrorCode =
  | 'MOCK_TEST_NOT_FOUND'
  | 'MOCK_TEST_NOT_PUBLISHED'
  | 'TEST_STALE' // the composition references non-published questions — editorial must fix it
  | 'MOCK_TEST_EXISTS'
  | 'TOPIC_NOT_FOUND'
  | 'EXAM_VERSION_NOT_FOUND'
  | 'EXAM_NOT_ACTIVE'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'LANGUAGE_MISMATCH' // a composed question is in another language
  | 'COUNTRY_MISMATCH' // a composed question sits on another country's unit (§14)
  | 'QUESTION_NOT_FOUND' // a composed question id does not resolve
  | 'QUESTION_NOT_PUBLISHED' // publish-time gate: composition has unpublished questions
  | 'ATTEMPT_NOT_FOUND'
  | 'ATTEMPT_ALREADY_SUBMITTED'
  | 'ATTEMPT_DEADLINE_PASSED'
  | 'INVALID_OPTION'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'NO_CHANGES'
  | 'GLOBAL_TEST_ADMIN_ONLY'
  | 'LANGUAGE_SCOPE'
  | 'PUBLISH_NOT_PERMITTED'
  | 'SCHEDULED_FOR_REQUIRED'

const ERROR_STATUS: Record<MockTestErrorCode, number> = {
  MOCK_TEST_NOT_FOUND: 404,
  MOCK_TEST_NOT_PUBLISHED: 409,
  TEST_STALE: 409,
  MOCK_TEST_EXISTS: 409,
  TOPIC_NOT_FOUND: 404,
  EXAM_VERSION_NOT_FOUND: 404,
  EXAM_NOT_ACTIVE: 400,
  LANGUAGE_NOT_FOUND: 404,
  LANGUAGE_NOT_AVAILABLE: 400,
  LANGUAGE_MISMATCH: 400,
  COUNTRY_MISMATCH: 403,
  QUESTION_NOT_FOUND: 400,
  QUESTION_NOT_PUBLISHED: 409,
  ATTEMPT_NOT_FOUND: 404,
  ATTEMPT_ALREADY_SUBMITTED: 409,
  ATTEMPT_DEADLINE_PASSED: 409,
  INVALID_OPTION: 400,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  CHANGE_SUMMARY_REQUIRED: 400,
  NO_CHANGES: 409,
  GLOBAL_TEST_ADMIN_ONLY: 403,
  LANGUAGE_SCOPE: 403,
  PUBLISH_NOT_PERMITTED: 403,
  SCHEDULED_FOR_REQUIRED: 400,
}

export class MockTestError extends Error {
  readonly code: MockTestErrorCode
  readonly status: number

  constructor(code: MockTestErrorCode, message: string) {
    super(message)
    this.name = 'MockTestError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown MockTestError to envelope data (§37); null for others. */
export function toMockTestErrorResponse(
  error: unknown
): { message: string; code: MockTestErrorCode; status: number } | null {
  if (error instanceof MockTestError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** The §37 submit grace: submissions inside this window after deadlineAt are
 * accepted (network + clock skew); beyond it the attempt lapses (ABANDONED). */
const SUBMIT_GRACE_MS = 60 * 1000

type MockTestRow = Prisma.MockTestGetPayload<{
  include: {
    language: true
    topic: { include: { country: { select: { isoCode: true } } } }
    examVersion: { include: { exam: { include: { country: { select: { isoCode: true } } } } } }
    publishedRevision: { include: { publishedBy: true } }
    _count: { select: { revisions: true; attempts: true } }
  }
}>

const MOCK_TEST_INCLUDE = {
  language: true,
  topic: { include: { country: { select: { isoCode: true } } } },
  examVersion: { include: { exam: { include: { country: { select: { isoCode: true } } } } } },
  publishedRevision: { include: { publishedBy: true } },
  _count: { select: { revisions: true, attempts: true } },
} satisfies Prisma.MockTestInclude

async function loadMockTestByRef(ref: string): Promise<MockTestRow | null> {
  return db.mockTest.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: MOCK_TEST_INCLUDE,
  })
}

/** Parses a stored questionIdsJson into the ordered composition. Invalid
 * JSON is a data-integrity breach — a hard error, never a silent fallback. */
function parseQuestionIds(questionIdsJson: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(questionIdsJson)
  } catch {
    throw new MockTestError(
      'TEST_STALE',
      'This mock test carries a malformed composition — editorial must correct it before it can be used'
    )
  }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new MockTestError('TEST_STALE', 'This mock test carries a malformed composition')
  }
  return parsed as string[]
}

function serializeQuestionIds(ids: string[]): string {
  return JSON.stringify(ids)
}

/** Parses an optionsJson snapshot into the DTO shape (the question-service twin). */
function parseOptionsOf(optionsJson: string): { key: string; text: string }[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(optionsJson)
  } catch {
    throw new MockTestError(
      'TEST_STALE',
      'A composed question carries malformed option data — editorial must correct it before it can be served'
    )
  }
  if (!Array.isArray(parsed)) {
    throw new MockTestError('TEST_STALE', 'A composed question carries malformed option data')
  }
  return parsed.map((option, index) => {
    if (option != null && typeof option === 'object' && 'key' in option && 'text' in option) {
      const record = option as { key: unknown; text: unknown }
      return { key: String(record.key), text: String(record.text) }
    }
    return { key: String.fromCharCode(65 + index), text: String(option) }
  })
}

/** Slugifies a title into its §37 URL identity (kebab-case). */
function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base.length > 0 ? base : 'mock-test'
}

/** Resolves a unique slug from the title (deterministic -2, -3… suffixes). */
async function uniqueSlugFor(title: string): Promise<string> {
  const base = slugifyTitle(title)
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    const taken = await db.mockTest.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!taken) return candidate
  }
  // Practically unreachable — fall back to a time-suffixed slug.
  return `${base}-${Date.now().toString(36)}`
}

/** The test's §14 country: EXAM scope → the exam's country; TOPIC scope →
 * the topic's country (null = a GLOBAL topic → a global test). */
function targetOfMockTest(test: MockTestRow): { countryId: string | null; languageId: string } {
  return {
    countryId:
      test.scopeType === 'EXAM'
        ? test.examVersion?.exam.countryId ?? null
        : test.topic?.countryId ?? null,
    languageId: test.languageId,
  }
}

/** The scope descriptor every DTO carries (§6 scope display). */
function toScopeRef(test: MockTestRow): MockTestScopeRef {
  return {
    type: test.scopeType,
    topic: test.topic ? { slug: test.topic.slug, canonicalName: test.topic.canonicalName } : null,
    exam: test.examVersion
      ? {
          slug: test.examVersion.exam.slug,
          name: test.examVersion.exam.name,
          code: test.examVersion.exam.code,
          versionId: test.examVersion.id,
          versionLabel: test.examVersion.label,
        }
      : null,
  }
}

/** The §19 workflow event payload for a MockTest (task wiring). */
function workflowMockTestOf(test: MockTestRow) {
  return {
    id: test.id,
    slug: test.slug,
    countryId: targetOfMockTest(test).countryId,
    languageId: test.languageId,
    languageCode: test.language.code,
    title: test.title,
  }
}

/** Working-copy snapshot for audit before/after (§30 data minimisation). */
function snapshotOf(test: MockTestRow) {
  const questionIds = parseQuestionIds(test.questionIdsJson)
  return {
    slug: test.slug,
    languageCode: test.language.code,
    status: test.status,
    scopeType: test.scopeType,
    scope:
      test.scopeType === 'EXAM'
        ? test.examVersion
          ? { examSlug: test.examVersion.exam.slug, versionLabel: test.examVersion.label }
          : null
        : test.topic
          ? { topicSlug: test.topic.slug }
          : null,
    title: test.title,
    questionCount: questionIds.length,
    durationMinutes: test.durationMinutes,
    passPercent: test.passPercent,
    aiAssisted: test.aiAssisted,
    liveRevision: test.publishedRevision
      ? {
          number: test.publishedRevision.revisionNumber,
          questionCount: parseQuestionIds(test.publishedRevision.questionIdsJson).length,
        }
      : null,
  }
}

/** Stable object label for audit rows (§36 accountability). */
function mockTestLabel(test: MockTestRow): string {
  return `${test.slug}/${test.language.code}/MockTest`
}

/** Object-level permission check + denial audit (§20 signal — the content pattern). */
function assertCanManageMockTest(
  actor: Actor,
  test: MockTestRow,
  operation: string,
  meta?: AuditRequestMeta
): void {
  const target = targetOfMockTest(test)
  if (can(actor, 'mocktest:manage', target)) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.mocktestDenied,
    objectType: AUDIT_OBJECT_TYPES.mockTest,
    objectId: test.id,
    objectLabel: mockTestLabel(test),
    before: { status: test.status, scopeType: test.scopeType },
    metadata: {
      attemptedOperation: operation,
      reason: mockTestDenialReason(actor, test),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (target.countryId === null) {
      throw new MockTestError(
        'GLOBAL_TEST_ADMIN_ONLY',
        'Country-scoped staff cannot manage tests scoped to global topics or other countries\u2019 exams'
      )
    }
    if (actor.role === 'WRITER' && actor.languageScopeId && test.languageId !== actor.languageScopeId) {
      throw new MockTestError(
        'LANGUAGE_SCOPE',
        'This test is outside your language scope (§20 explicit staff scopes)'
      )
    }
    throw new MockTestError(
      'COUNTRY_MISMATCH',
      'You can only manage mock tests for your own country\u2019s exams and topics'
    )
  }
  throw new MockTestError('COUNTRY_MISMATCH', 'You do not have permission to manage this mock test')
}

function mockTestDenialReason(actor: Actor, test: MockTestRow): string {
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (targetOfMockTest(test).countryId === null) return 'GLOBAL_TEST_ADMIN_ONLY'
    if (actor.role === 'WRITER' && actor.languageScopeId && test.languageId !== actor.languageScopeId) {
      return 'LANGUAGE_SCOPE'
    }
    return 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/**
 * Admin read access (content parity): ADMIN sees all; COUNTRY_ADMIN and
 * WRITER see global-scope (read-only) + own-country tests — a writer's
 * language scope narrows only what they may MANAGE, not what they may read.
 */
function canReadMockTest(actor: Actor, test: MockTestRow): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    const countryId = targetOfMockTest(test).countryId
    return countryId === null || countryId === actor.countryId
  }
  return false
}

function toRevisionRef(
  revision: Prisma.MockTestRevisionGetPayload<{ include: { publishedBy: true } }>
): MockTestRevisionRef {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    questionIds: parseQuestionIds(revision.questionIdsJson),
    durationMinutes: revision.durationMinutes,
    passPercent: revision.passPercent,
    changeSummary: revision.changeSummary,
    aiAssisted: revision.aiAssisted,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy?.email ?? null,
  }
}

// ---------- Composition resolution + health (§6/§14/§35/§36) ----------

/**
 * The full composed-question projection: live revision (question + options +
 * difficulty), its language and its owning unit (for the §14 country rule +
 * the post-submit learning link). The health checks (below) reuse the same
 * rows — one load per surface, never N+1.
 */
type CompositionQuestion = Prisma.QuestionGetPayload<{
  include: {
    language: { select: { code: true } }
    knowledgeUnit: {
      select: {
        slug: true
        canonicalName: true
        scope: true
        countryId: true
        topic: { select: { slug: true; canonicalName: true } }
      }
    }
    publishedRevision: {
      select: { questionText: true; optionsJson: true; difficulty: true }
    }
  }
}>

const COMPOSITION_INCLUDE = {
  language: { select: { code: true } },
  knowledgeUnit: {
    select: {
      slug: true,
      canonicalName: true,
      scope: true,
      countryId: true,
      topic: { select: { slug: true, canonicalName: true } },
    },
  },
  publishedRevision: { select: { questionText: true, optionsJson: true, difficulty: true } },
} satisfies Prisma.QuestionInclude

/**
 * Loads a composition's questions (ONE batched query) and checks the §35
 * language rule + the §14 country rule (a test is never more visible than
 * its questions). When `requirePublished` is set (the publish + runner
 * gate), every question must be PUBLISHED with a live revision. Returns the
 * questions keyed by id, ordered lookups by the caller.
 */
async function loadComposition(
  questionIds: string[],
  options: {
    languageId: string
    countryId: string | null
    requirePublished: boolean
  }
): Promise<Map<string, CompositionQuestion>> {
  if (questionIds.length < MOCK_TEST_RULES.questions.minCount) {
    throw new MockTestError(
      'TEST_STALE',
      `A mock test needs at least ${MOCK_TEST_RULES.questions.minCount} questions (§6 question_ids[])`
    )
  }
  const rows = await db.question.findMany({
    where: { id: { in: questionIds } },
    include: COMPOSITION_INCLUDE,
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of questionIds) {
    const question = byId.get(id)
    if (!question) {
      throw new MockTestError(
        'QUESTION_NOT_FOUND',
        'A composed question no longer exists — remove it from the composition before continuing'
      )
    }
    if (question.languageId !== options.languageId) {
      throw new MockTestError(
        'LANGUAGE_MISMATCH',
        `The composed question “${question.publishedRevision?.questionText ?? question.questionText}” is in ${question.language.code.toUpperCase()} — every question in a test must match the test\u2019s language (§35)`
      )
    }
    const unitCountryId =
      question.knowledgeUnit.scope === 'COUNTRY' ? question.knowledgeUnit.countryId : null
    if (unitCountryId !== null && unitCountryId !== options.countryId) {
      throw new MockTestError(
        'COUNTRY_MISMATCH',
        `The composed question “${question.publishedRevision?.questionText ?? question.questionText}” sits on another country\u2019s record — a test is never more visible than its questions (§14)`
      )
    }
    if (options.requirePublished && (question.status !== 'PUBLISHED' || !question.publishedRevision)) {
      throw new MockTestError(
        'QUESTION_NOT_PUBLISHED',
        `The composed question “${question.publishedRevision?.questionText ?? question.questionText}” is ${question.status} — publish every question before publishing or attempting the test (§19)`
      )
    }
  }
  return byId
}

/** Computes a test's publishability + the honest §37 reason when blocked. */
async function compositionHealth(
  test: MockTestRow
): Promise<{ publishable: true; reason: null } | { publishable: false; reason: string }> {
  try {
    await loadComposition(parseQuestionIds(test.questionIdsJson), {
      languageId: test.languageId,
      countryId: targetOfMockTest(test).countryId,
      requirePublished: true,
    })
    return { publishable: true, reason: null }
  } catch (error) {
    if (error instanceof MockTestError) {
      return { publishable: false, reason: error.message }
    }
    throw error
  }
}

// ---------- §19 step 7: scheduled-release materialization ----------

/**
 * Publishes ONE due SCHEDULED MockTest atomically — the
 * ContentItem/QnA/Question twin. The conditional claim (`updateMany` on
 * status + time) makes concurrent reads safe; the published test is the
 * locked working copy — exactly what review approved (§19).
 */
async function materializeScheduledMockTest(mockTestId: string): Promise<void> {
  const test = await loadMockTestByRef(mockTestId)
  if (
    !test ||
    test.status !== 'SCHEDULED' ||
    !test.scheduledForAt ||
    test.scheduledForAt.getTime() > Date.now()
  ) {
    return
  }
  // The publish gate re-checked at release time: the composition must still
  // be healthy (all questions published, §14/§35 consistent). A stale
  // composition holds the test in SCHEDULED until editorial fixes it (§36).
  const health = await compositionHealth(test)
  if (!health.publishable) return

  const nextNumber = await db.$transaction(async (tx) => {
    const claimed = await tx.mockTest.updateMany({
      where: {
        id: test.id,
        status: 'SCHEDULED',
        scheduledForAt: { lte: new Date() },
      },
      data: { status: 'PUBLISHED', scheduledForAt: null },
    })
    if (claimed.count === 0) return null // a concurrent read materialized it
    const aggregate = await tx.mockTestRevision.aggregate({
      where: { mockTestId: test.id },
      _max: { revisionNumber: true },
    })
    const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
    const revision = await tx.mockTestRevision.create({
      data: {
        mockTestId: test.id,
        revisionNumber,
        title: test.title,
        questionIdsJson: test.questionIdsJson,
        durationMinutes: test.durationMinutes,
        passPercent: test.passPercent,
        aiAssisted: test.aiAssisted,
        changeSummary: 'Scheduled release (§19 step 7) — published automatically at the scheduled time',
        publishedById: null, // system publish
      },
    })
    await tx.mockTest.update({
      where: { id: test.id },
      data: { publishedRevisionId: revision.id },
    })
    await wireMockTestWorkflow(tx, {
      action: 'publish',
      actorId: null,
      mockTest: workflowMockTestOf(test),
    })
    return revisionNumber
  })
  if (nextNumber == null) return

  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.mocktestTransition,
    objectType: AUDIT_OBJECT_TYPES.mockTest,
    objectId: test.id,
    objectLabel: mockTestLabel(test),
    before: { status: 'SCHEDULED', scheduledFor: test.scheduledForAt.toISOString() },
    after: { status: 'PUBLISHED', revision: nextNumber },
    metadata: { action: 'publish', scheduled: true, materialized: 'lazy-read' },
  })
}

/**
 * Publishes due SCHEDULED MockTests lazily — the modular monolith's
 * scheduler is "the first read after the scheduled time". Public and admin
 * reads both call this, scoped to what they are reading (§37).
 */
export async function materializeDueScheduledMockTests(
  scope?: { mockTestId?: string }
): Promise<void> {
  const due = await db.mockTest.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledForAt: { lte: new Date() },
      ...(scope?.mockTestId ? { id: scope.mockTestId } : {}),
    },
    select: { id: true },
    take: 25, // bounded per read
  })
  for (const row of due) await materializeScheduledMockTest(row.id)
}

// ---------- Public reads (the §22 runner surface) ----------

/** The public §22 card projection — live revision only, deterministic order. */
function toPublicCard(test: MockTestRow): PublicMockTestCard {
  const revision = test.publishedRevision!
  return {
    id: test.id,
    slug: test.slug,
    title: revision.title,
    questionCount: parseQuestionIds(revision.questionIdsJson).length,
    durationMinutes: revision.durationMinutes,
    passPercent: revision.passPercent,
    scope: toScopeRef(test),
    language: {
      code: test.language.code,
      name: test.language.name,
      nativeName: test.language.nativeName,
    },
    revision: { number: revision.revisionNumber, publishedAt: revision.publishedAt.toISOString() },
    aiAssisted: revision.aiAssisted,
  }
}

/** The §22 discovery list: published tests for one exam or topic hub. */
export async function getPublicMockTests(
  query: PublicMockTestListQuery
): Promise<{ items: PublicMockTestCard[] }> {
  await materializeDueScheduledMockTests()

  let languageId: string | undefined
  if (query.language) {
    const language = await findActiveLanguageByCode(query.language.toLowerCase())
    if (!language) throw new MockTestError('LANGUAGE_NOT_FOUND', `Unknown language "${query.language}"`)
    languageId = language.id
  }

  const where: Prisma.MockTestWhereInput = {
    status: 'PUBLISHED',
    publishedRevisionId: { not: null },
    ...(languageId ? { languageId } : {}),
    ...(query.exam
      ? { scopeType: 'EXAM' as const, examVersion: { exam: { slug: query.exam.toLowerCase() } } }
      : {}),
    ...(query.topic
      ? { scopeType: 'TOPIC' as const, topic: { slug: query.topic.toLowerCase() } }
      : {}),
  }

  const rows = await db.mockTest.findMany({
    where,
    include: MOCK_TEST_INCLUDE,
    // Deterministic (§37): newest first, then title.
    orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }, { id: 'asc' }],
    take: 50, // a hub surface never paginates in v1
  })

  return { items: rows.filter((row) => row.publishedRevision != null).map(toPublicCard) }
}

/** Serves one runner question — the live revision, NEVER the key (§22). */
function toRunnerQuestion(question: CompositionQuestion): PublicMockTestQuestion {
  const revision = question.publishedRevision!
  return {
    id: question.id,
    question: revision.questionText,
    options: parseOptionsOf(revision.optionsJson),
    difficulty: revision.difficulty as PublicMockTestQuestion['difficulty'],
  }
}

/** The signed-in viewer's attempt summary for one test (best/last + resume). */
async function summarizeMyAttempts(
  userId: string,
  mockTestId: string,
  servedQuestionIds: string[]
): Promise<NonNullable<PublicMockTestDetail['myAttempts']>> {
  // Lapse this user's expired in-flight attempts first (§6 attempt lifecycle).
  await abandonExpiredAttempts(userId, mockTestId)

  const [rows, active] = await Promise.all([
    db.testAttempt.findMany({
      where: { userId, mockTestId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      select: { scorePercent: true },
    }),
    db.testAttempt.findFirst({
      where: { userId, mockTestId, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
      include: { mockTest: true },
    }),
  ])
  const scores = rows.map((row) => row.scorePercent).filter((score): score is number => score != null)
  return {
    total: rows.length + (active ? 1 : 0),
    submitted: rows.length,
    bestScorePercent: scores.length > 0 ? Math.max(...scores) : null,
    lastScorePercent: scores.length > 0 ? scores[0] : null,
    active: active ? await toAttemptState(active, servedQuestionIds) : null,
  }
}

/**
 * Lapses this user's expired IN_PROGRESS attempts on a test (deadline +
 * grace in the past) — the §6 ABANDONED lifecycle. System-audited.
 */
async function abandonExpiredAttempts(userId: string, mockTestId: string): Promise<void> {
  const expired = await db.testAttempt.findMany({
    where: {
      userId,
      mockTestId,
      status: 'IN_PROGRESS',
      deadlineAt: { lt: new Date(Date.now() - SUBMIT_GRACE_MS) },
    },
    select: { id: true },
  })
  for (const row of expired) {
    const claimed = await db.testAttempt.updateMany({
      where: { id: row.id, status: 'IN_PROGRESS' },
      data: { status: 'ABANDONED' },
    })
    if (claimed.count === 0) continue
    await recordAudit({
      actor: null,
      action: AUDIT_ACTIONS.attemptAbandon,
      objectType: AUDIT_OBJECT_TYPES.testAttempt,
      objectId: row.id,
      objectLabel: `${mockTestId}/Attempt`,
      before: { status: 'IN_PROGRESS' },
      after: { status: 'ABANDONED' },
      metadata: { reason: 'deadline-passed', graceMs: SUBMIT_GRACE_MS },
    }).catch(() => undefined)
  }
}

/** Projects a TestAttempt row into the public state DTO (the runner's
 * source of truth). `servedQuestionIdsOverride` re-serves the attempt's own
 * frozen composition — a later test correction never rewrites a running deal. */
async function toAttemptState(
  attempt: Prisma.TestAttemptGetPayload<{ include: { mockTest: true } }>,
  servedQuestionIdsOverride?: string[]
): Promise<PublicAttemptState> {
  const served = servedQuestionIdsOverride ?? parseQuestionIds(attempt.servedQuestionsJson)
  // While IN_PROGRESS the questions serve from the CURRENT live revisions
  // (the composition was re-validated at start); after SUBMITTED the result
  // carries the frozen review — the state's question list is then a
  // convenience re-serve for retake context, still keyless.
  const composition = await db.question.findMany({
    where: { id: { in: served }, publishedRevisionId: { not: null } },
    include: COMPOSITION_INCLUDE,
  })
  const byId = new Map(composition.map((row) => [row.id, row]))
  const questions: PublicMockTestQuestion[] = served
    .map((id) => byId.get(id))
    .filter((question): question is CompositionQuestion => question != null && question.publishedRevision != null)
    .map(toRunnerQuestion)
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    deadlineAt: attempt.deadlineAt.toISOString(),
    durationMinutes: attempt.durationMinutes,
    passPercent: attempt.passPercent,
    questionCount: served.length,
    mockTest: { id: attempt.mockTestId, slug: attempt.mockTest.slug, title: attempt.mockTest.title },
    questions,
  }
}

/** The public runner detail: meta + the ordered live-revision composition
 * (no keys) + the signed-in user's attempt history on this test. */
export async function getPublicMockTest(
  ref: string,
  viewer: { userId: string } | null
): Promise<PublicMockTestDetail> {
  await materializeDueScheduledMockTests()

  const test = await loadMockTestByRef(ref)
  if (!test) throw new MockTestError('MOCK_TEST_NOT_FOUND', 'Mock test not found')
  if (test.status !== 'PUBLISHED' || !test.publishedRevision) {
    throw new MockTestError(
      'MOCK_TEST_NOT_PUBLISHED',
      test.status === 'RETIRED'
        ? 'This mock test has been withdrawn (§36) — it can no longer be attempted.'
        : 'This mock test is not published yet (§19).'
    )
  }
  const revision = test.publishedRevision
  const questionIds = parseQuestionIds(revision.questionIdsJson)

  // The served composition — every question must still be PUBLISHED with a
  // live revision; a stale composition is an honest 409 (editors see the
  // health on the workspace; in-flight attempts still complete).
  const composition = await loadComposition(questionIds, {
    languageId: test.languageId,
    countryId: targetOfMockTest(test).countryId,
    requirePublished: true,
  })
  const questions: PublicMockTestQuestion[] = questionIds
    .map((id) => composition.get(id))
    .filter((question): question is CompositionQuestion => question != null)
    .map(toRunnerQuestion)

  const myAttempts = viewer
    ? await summarizeMyAttempts(viewer.userId, test.id, questionIds)
    : null

  return {
    id: test.id,
    slug: test.slug,
    title: revision.title,
    questionCount: questionIds.length,
    durationMinutes: revision.durationMinutes,
    passPercent: revision.passPercent,
    scope: toScopeRef(test),
    language: {
      code: test.language.code,
      name: test.language.name,
      nativeName: test.language.nativeName,
    },
    revision: {
      number: revision.revisionNumber,
      publishedAt: revision.publishedAt.toISOString(),
      changeSummary: revision.changeSummary,
    },
    aiAssisted: revision.aiAssisted,
    questions,
    myAttempts,
  }
}

// ---------- TestAttempt engine (§6: start → timed run → submit → result) ----------

/**
 * Starts (or resumes) an attempt at a published test (§22). The attempt
 * snapshot-carries the deal: the served composition, the duration and the
 * pass criteria as of NOW — a later correction of the test never rewrites a
 * running attempt. One IN_PROGRESS attempt per user × test: an existing
 * live attempt resumes (refresh-safe), expired ones lapse to ABANDONED.
 */
export async function startAttempt(
  user: { userId: string; email: string },
  ref: string,
  meta: AuditRequestMeta = {}
): Promise<PublicAttemptState> {
  await materializeDueScheduledMockTests()

  const test = await loadMockTestByRef(ref)
  if (!test) throw new MockTestError('MOCK_TEST_NOT_FOUND', 'Mock test not found')
  if (test.status !== 'PUBLISHED' || !test.publishedRevision) {
    throw new MockTestError(
      'MOCK_TEST_NOT_PUBLISHED',
      test.status === 'RETIRED'
        ? 'This mock test has been withdrawn (§36) — it can no longer be attempted.'
        : 'This mock test is not published yet (§19).'
    )
  }
  const revision = test.publishedRevision
  const questionIds = parseQuestionIds(revision.questionIdsJson)

  // The §14/§35/§19 composition gate — the same one the detail enforces:
  // new attempts open only on a healthy composition.
  await loadComposition(questionIds, {
    languageId: test.languageId,
    countryId: targetOfMockTest(test).countryId,
    requirePublished: true,
  })

  // Lapse this user's expired attempts, then resume-or-create (§6).
  await abandonExpiredAttempts(user.userId, test.id)
  const existing = await db.testAttempt.findFirst({
    where: { userId: user.userId, mockTestId: test.id, status: 'IN_PROGRESS' },
    orderBy: { startedAt: 'desc' },
    include: { mockTest: true },
  })
  if (existing) {
    return toAttemptState(existing, questionIds)
  }

  const startedAt = new Date()
  const deadlineAt = new Date(startedAt.getTime() + revision.durationMinutes * 60 * 1000)
  const created = await db.testAttempt.create({
    data: {
      userId: user.userId,
      mockTestId: test.id,
      status: 'IN_PROGRESS',
      startedAt,
      deadlineAt,
      servedQuestionsJson: serializeQuestionIds(questionIds),
      durationMinutes: revision.durationMinutes,
      passPercent: revision.passPercent,
      answersJson: '[]',
    },
    include: { mockTest: true },
  })

  await recordAudit({
    actor: { userId: user.userId, email: user.email, role: 'READER' },
    action: AUDIT_ACTIONS.attemptStart,
    objectType: AUDIT_OBJECT_TYPES.testAttempt,
    objectId: created.id,
    objectLabel: `${test.slug}/Attempt`,
    after: {
      mockTestSlug: test.slug,
      questionCount: questionIds.length,
      durationMinutes: revision.durationMinutes,
      deadlineAt: deadlineAt.toISOString(),
    },
    metadata: { mockTestId: test.id, revisionNumber: revision.revisionNumber },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAttemptState(created, questionIds)
}

/** Rebuilds the full post-submit review from the frozen attempt row. */
async function toAttemptResult(
  attempt: Prisma.TestAttemptGetPayload<{ include: { mockTest: true } }>,
  answers: AttemptAnswerRecord[]
): Promise<AttemptResult> {
  const served = parseQuestionIds(attempt.servedQuestionsJson)
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))
  // The review needs the full revision surface (key + explanation + AI flag)
  // — the §36 post-submit teaching moment.
  const questions = await db.question.findMany({
    where: { id: { in: served } },
    include: {
      language: { select: { code: true } },
      knowledgeUnit: {
        select: {
          slug: true,
          canonicalName: true,
          scope: true,
          countryId: true,
          topic: { select: { slug: true, canonicalName: true } },
        },
      },
      publishedRevision: {
        select: {
          questionText: true,
          optionsJson: true,
          difficulty: true,
          correctAnswer: true,
          explanation: true,
          aiAssisted: true,
          revisionNumber: true,
        },
      },
    },
  })
  const byId = new Map(questions.map((row) => [row.id, row]))
  const review: AttemptResultQuestion[] = served.map((id) => {
    const question = byId.get(id)
    const answer = answerByQuestion.get(id)
    // The frozen correctAnswer comes from the answer record (§6 answers[]);
    // the re-projected question/explanation/options come from the question's
    // live revision — by §36 immutability the graded snapshot still exists,
    // and if the question was corrected AFTER the submit, the newer teaching
    // prose serves the retake loop (the honest §36 behaviour).
    const revision = question?.publishedRevision
    const unit = question?.knowledgeUnit
    return {
      id,
      question: revision?.questionText ?? '',
      options: revision ? parseOptionsOf(revision.optionsJson) : [],
      difficulty: (revision?.difficulty ?? 'BASIC') as AttemptResultQuestion['difficulty'],
      unit: unit ? { slug: unit.slug, canonicalName: unit.canonicalName } : null,
      selected: answer?.selected ?? null,
      correct: answer?.correct ?? false,
      correctAnswer: answer?.correctAnswer ?? '',
      explanation: revision?.explanation ?? '',
      revisionNumber: answer?.revisionNumber ?? 0,
      aiAssisted: revision?.aiAssisted ?? false,
    }
  })
  return {
    attemptId: attempt.id,
    status: 'SUBMITTED',
    submittedAt: attempt.submittedAt!.toISOString(),
    durationMinutes: attempt.durationMinutes,
    passPercent: attempt.passPercent,
    correctCount: attempt.correctCount ?? 0,
    totalCount: attempt.totalCount ?? served.length,
    scorePercent: attempt.scorePercent ?? 0,
    passed: attempt.passed ?? false,
    questions: review,
    mockTest: { id: attempt.mockTestId, slug: attempt.mockTest.slug, title: attempt.mockTest.title },
  }
}

/**
 * Submits an attempt (§22 timed, scored): the server is the only judge.
 * Deadline enforcement is server-side truth (a 60s grace absorbs network +
 * clock skew); unanswered questions score as incorrect (exam semantics);
 * per-question correctness is frozen into the immutable §6 answers[] record
 * together with the derived score — then the full review (keys +
 * explanations + unit links) ships, per-question, post-submit only.
 */
export async function submitAttempt(
  user: { userId: string; email: string },
  attemptId: string,
  input: AttemptSubmitInput,
  meta: AuditRequestMeta = {}
): Promise<AttemptResult> {
  const attempt = await db.testAttempt.findUnique({
    where: { id: attemptId },
    include: { mockTest: true },
  })
  if (!attempt || attempt.userId !== user.userId) {
    // Owner-scoped 404 — never a 403 that leaks attempt existence (§30).
    throw new MockTestError('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }
  if (attempt.status === 'SUBMITTED') {
    throw new MockTestError(
      'ATTEMPT_ALREADY_SUBMITTED',
      'This attempt was already submitted — §6 attempts are immutable once scored. Start a new attempt to try again.'
    )
  }
  if (attempt.status === 'ABANDONED') {
    throw new MockTestError(
      'ATTEMPT_DEADLINE_PASSED',
      'This attempt\u2019s deadline passed — it lapsed without submission (§6). Start a new attempt to try again.'
    )
  }

  const now = Date.now()
  if (now > attempt.deadlineAt.getTime() + SUBMIT_GRACE_MS) {
    // Past the grace window: the attempt lapses (§6 ABANDONED), honestly.
    await db.testAttempt.updateMany({
      where: { id: attempt.id, status: 'IN_PROGRESS' },
      data: { status: 'ABANDONED' },
    })
    await recordAudit({
      actor: { userId: user.userId, email: user.email, role: 'READER' },
      action: AUDIT_ACTIONS.attemptAbandon,
      objectType: AUDIT_OBJECT_TYPES.testAttempt,
      objectId: attempt.id,
      objectLabel: `${attempt.mockTest.slug}/Attempt`,
      before: { status: 'IN_PROGRESS' },
      after: { status: 'ABANDONED' },
      metadata: { reason: 'late-submit', graceMs: SUBMIT_GRACE_MS },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    throw new MockTestError(
      'ATTEMPT_DEADLINE_PASSED',
      'The attempt\u2019s time is up — the submission window closed (server-enforced deadline). Start a new attempt to try again.'
    )
  }

  // ---------- Server-side scoring against the live revisions ----------
  const served = parseQuestionIds(attempt.servedQuestionsJson)
  const answerByQuestion = new Map<string, { questionId: string; selected: string }>()
  for (const answer of input.answers) {
    if (!served.includes(answer.questionId)) {
      throw new MockTestError(
        'INVALID_OPTION',
        'The submission references a question that was not part of this attempt'
      )
    }
    if (answerByQuestion.has(answer.questionId)) {
      throw new MockTestError(
        'INVALID_OPTION',
        'The submission answers one question twice — one answer per question'
      )
    }
    answerByQuestion.set(answer.questionId, answer)
  }

  const questions = await db.question.findMany({
    where: { id: { in: served } },
    include: {
      ...COMPOSITION_INCLUDE,
      publishedRevision: {
        select: {
          questionText: true,
          optionsJson: true,
          difficulty: true,
          correctAnswer: true,
          explanation: true,
          aiAssisted: true,
          revisionNumber: true,
        },
      },
    },
  })
  const byId = new Map(questions.map((row) => [row.id, row]))

  const answers: AttemptAnswerRecord[] = []
  let correctCount = 0
  for (const id of served) {
    const question = byId.get(id)
    const revision = question?.publishedRevision
    if (!question || !revision) {
      // §36 defensive: the graded revision always exists (attempts open only
      // on healthy compositions; revisions are never deleted).
      throw new MockTestError(
        'TEST_STALE',
        'A served question lost its published revision — this attempt can no longer be scored. Editorial has been notified by the audit trail.'
      )
    }
    const submitted = answerByQuestion.get(id)
    let selected: string | null = null
    if (submitted) {
      selected = submitted.selected.trim().toUpperCase()
      const options = parseOptionsOf(revision.optionsJson)
      if (!options.some((option) => option.key === selected)) {
        throw new MockTestError(
          'INVALID_OPTION',
          `"${submitted.selected}" is not one of the options of question ${answers.length + 1}`
        )
      }
    }
    const correct = selected !== null && selected === revision.correctAnswer
    if (correct) correctCount += 1
    answers.push({
      questionId: id,
      selected,
      correct,
      correctAnswer: revision.correctAnswer,
      revisionNumber: revision.revisionNumber,
    })
  }

  const totalCount = served.length
  const scorePercent = Math.round((correctCount / totalCount) * 10000) / 100
  const passed = scorePercent >= attempt.passPercent
  const submittedAt = new Date()
  const answersJson = JSON.stringify(answers)

  // The conditional claim makes double-submits safe: only an IN_PROGRESS
  // attempt may transition to SUBMITTED (§6 immutability thereafter).
  const claimed = await db.testAttempt.updateMany({
    where: { id: attempt.id, status: 'IN_PROGRESS' },
    data: {
      status: 'SUBMITTED',
      submittedAt,
      answersJson,
      correctCount,
      totalCount,
      scorePercent,
      passed,
    },
  })
  if (claimed.count === 0) {
    throw new MockTestError(
      'ATTEMPT_ALREADY_SUBMITTED',
      'This attempt was already submitted — §6 attempts are immutable once scored.'
    )
  }

  await recordAudit({
    actor: { userId: user.userId, email: user.email, role: 'READER' },
    action: AUDIT_ACTIONS.attemptSubmit,
    objectType: AUDIT_OBJECT_TYPES.testAttempt,
    objectId: attempt.id,
    objectLabel: `${attempt.mockTest.slug}/Attempt`,
    before: { status: 'IN_PROGRESS' },
    after: {
      status: 'SUBMITTED',
      correctCount,
      totalCount,
      scorePercent,
      passed,
    },
    metadata: { mockTestId: attempt.mockTestId, answered: answerByQuestion.size },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const submitted = (await db.testAttempt.findUnique({
    where: { id: attempt.id },
    include: { mockTest: true },
  }))!
  return toAttemptResult(submitted, answers)
}

/** One attempt's current state (owner-only; result when SUBMITTED). */
export async function getAttempt(
  user: { userId: string },
  attemptId: string
): Promise<AttemptStateResponse> {
  const attempt = await db.testAttempt.findUnique({
    where: { id: attemptId },
    include: { mockTest: true },
  })
  if (!attempt || attempt.userId !== user.userId) {
    throw new MockTestError('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }
  const state = await toAttemptState(attempt)
  if (attempt.status === 'SUBMITTED') {
    const answers = ((): AttemptAnswerRecord[] => {
      try {
        const parsed = JSON.parse(attempt.answersJson)
        return Array.isArray(parsed) ? (parsed as AttemptAnswerRecord[]) : []
      } catch {
        return []
      }
    })()
    return { attempt: state, result: await toAttemptResult(attempt, answers) }
  }
  return { attempt: state, result: null }
}

// ---------- Admin reads ----------

/** The §38 scope filter: country staff see global-scope tests + their own
 * country's tests (an EXAM test inherits the exam's country; a TOPIC test
 * the topic's). */
function adminScopeFilter(actor: Actor): Prisma.MockTestWhereInput | undefined {
  if (actor.role === 'ADMIN') return undefined
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    // Every exam owns a country (§14 — never null), so country staff without
    // a resolved home country see only global-topic tests.
    if (actor.countryId == null) {
      return { scopeType: 'TOPIC', topic: { scope: 'GLOBAL' } }
    }
    return {
      OR: [
        { scopeType: 'EXAM', examVersion: { exam: { countryId: actor.countryId } } },
        { scopeType: 'TOPIC', topic: { scope: 'GLOBAL' } },
        { scopeType: 'TOPIC', topic: { countryId: actor.countryId } },
      ],
    }
  }
  return { id: 'none' } // unreachable (assertCan gates READER out first)
}

/** Projects one admin row (no per-question load — health computed by the
 * caller with one batched composition query per page). */
async function toAdminMockTest(
  actor: Actor,
  test: MockTestRow,
  health: { publishable: boolean; reason: string | null }
): Promise<AdminMockTestEntry> {
  const target = targetOfMockTest(test)
  const canManage = can(actor, 'mocktest:manage', target)
  // §18 editorial gate: publish-class affordances only for mocktest:publish
  // holders (ADMIN + COUNTRY_ADMIN — writers never see them).
  const canPublish = can(actor, 'mocktest:publish', { countryId: target.countryId })
  const editability = MOCK_TEST_EDITABILITY[test.status as MockTestStatusPublic]
  const machineTransitions = Object.keys(
    MOCK_TEST_TRANSITIONS[test.status as MockTestStatusPublic]
  ) as MockTestTransitionAction[]
  const transitions = machineTransitions.filter(
    (action) => !MOCK_TEST_PUBLISH_GATED_ACTIONS.has(action) || canPublish
  )
  return {
    id: test.id,
    slug: test.slug,
    status: test.status as MockTestStatusPublic,
    language: {
      code: test.language.code,
      name: test.language.name,
      nativeName: test.language.nativeName,
    },
    title: test.title,
    scope: toScopeRef(test),
    questionIds: parseQuestionIds(test.questionIdsJson),
    questionCount: parseQuestionIds(test.questionIdsJson).length,
    durationMinutes: test.durationMinutes,
    passPercent: test.passPercent,
    liveRevision: test.publishedRevision ? toRevisionRef(test.publishedRevision) : null,
    revisionCount: test._count.revisions,
    attemptCount: test._count.attempts,
    aiAssisted: test.aiAssisted,
    scheduledFor: test.scheduledForAt?.toISOString() ?? null,
    createdAt: test.createdAt.toISOString(),
    updatedAt: test.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    // Affordances from server truth (§20) — non-managers see none; writers
    // never see publish-class actions (§18).
    allowedTransitions: canManage ? transitions : [],
    // The composition publish gate (§6/§14/§35/§19).
    anchorPublishable: health.publishable,
    anchorBlockReason: health.publishable ? null : health.reason,
  }
}

/** ONE batched composition-health query for a whole admin page. */
async function healthForRows(
  rows: MockTestRow[]
): Promise<Map<string, { publishable: boolean; reason: string | null }>> {
  const allIds = new Set<string>()
  const perTest = rows.map((test) => {
    let ids: string[]
    try {
      ids = parseQuestionIds(test.questionIdsJson)
    } catch {
      ids = []
    }
    ids.forEach((id) => allIds.add(id))
    return { test, ids }
  })
  const questions = allIds.size
    ? await db.question.findMany({
        where: { id: { in: [...allIds] } },
        select: {
          id: true
          , status: true
          , publishedRevisionId: true
          , languageId: true
          , knowledgeUnit: { select: { scope: true, countryId: true } }
          , publishedRevision: { select: { questionText: true } }
        },
      })
    : []
  const byId = new Map(questions.map((row) => [row.id, row]))
  const result = new Map<string, { publishable: boolean; reason: string | null }>()
  for (const { test, ids } of perTest) {
    if (ids.length < MOCK_TEST_RULES.questions.minCount) {
      result.set(test.id, {
        publishable: false,
        reason: `A mock test needs at least ${MOCK_TEST_RULES.questions.minCount} questions (§6 question_ids[])`,
      })
      continue
    }
    const countryId = targetOfMockTest(test).countryId
    let blocked: string | null = null
    for (const id of ids) {
      const question = byId.get(id)
      if (!question) {
        blocked = 'A composed question no longer exists — remove it from the composition'
        break
      }
      if (question.languageId !== test.languageId) {
        blocked = `A composed question (“${question.publishedRevision?.questionText ?? id}”) is in another language — every question must match the test\u2019s language (§35)`
        break
      }
      const unitCountryId =
        question.knowledgeUnit.scope === 'COUNTRY' ? question.knowledgeUnit.countryId : null
      if (unitCountryId !== null && unitCountryId !== countryId) {
        blocked = 'A composed question sits on another country\u2019s record (§14) — a test is never more visible than its questions'
        break
      }
      if (question.status !== 'PUBLISHED' || !question.publishedRevisionId) {
        blocked = `A composed question (“${question.publishedRevision?.questionText ?? id}”) is ${question.status} — publish every question before publishing the test (§19)`
        break
      }
    }
    result.set(test.id, blocked === null ? { publishable: true, reason: null } : { publishable: false, reason: blocked })
  }
  return result
}

export async function getAdminMockTests(
  actor: Actor,
  query: AdminMockTestListQuery
): Promise<AdminMockTestListResult> {
  assertCan(actor, 'mocktest:manage')

  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledMockTests()

  let languageId: string | undefined
  if (query.language) {
    const language = await findActiveLanguageByCode(query.language.toLowerCase())
    if (!language) throw new MockTestError('LANGUAGE_NOT_FOUND', `Unknown language "${query.language}"`)
    languageId = language.id
  }

  let examVersionIds: string[] | undefined
  if (query.exam) {
    const exam = await db.exam.findUnique({ where: { slug: query.exam.toLowerCase() } })
    if (!exam) throw new MockTestError('EXAM_VERSION_NOT_FOUND', `Unknown exam "${query.exam}"`)
    const versions = await db.examVersion.findMany({ where: { examId: exam.id }, select: { id: true } })
    examVersionIds = versions.map((version) => version.id)
  }

  let topicId: string | undefined
  if (query.topic) {
    const topic = await db.topic.findUnique({ where: { slug: query.topic.toLowerCase() } })
    if (!topic) throw new MockTestError('TOPIC_NOT_FOUND', `Unknown topic "${query.topic}"`)
    topicId = topic.id
  }

  const scopeFilter = adminScopeFilter(actor)
  const where: Prisma.MockTestWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(languageId ? { languageId } : {}),
    ...(query.scope ? { scopeType: query.scope } : {}),
    ...(examVersionIds ? { scopeType: 'EXAM', examVersionId: { in: examVersionIds } } : {}),
    ...(topicId ? { scopeType: 'TOPIC', topicId } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(scopeFilter ?? {}),
  }

  const [rows, total, summaryRows] = await Promise.all([
    db.mockTest.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: MOCK_TEST_INCLUDE,
    }),
    db.mockTest.count({ where }),
    db.mockTest.groupBy({
      by: ['status'],
      where: scopeFilter,
      _count: { _all: true },
    }),
  ])

  const summary = { total: 0, DRAFT: 0, IN_REVIEW: 0, SCHEDULED: 0, PUBLISHED: 0, RETIRED: 0 }
  for (const row of summaryRows) {
    summary.total += row._count._all
    summary[row.status as keyof typeof summary] = row._count._all
  }

  const health = await healthForRows(rows)
  const items: AdminMockTestEntry[] = []
  for (const row of rows) {
    if (canReadMockTest(actor, row)) {
      items.push(await toAdminMockTest(actor, row, health.get(row.id) ?? { publishable: false, reason: 'Composition health unavailable' }))
    }
  }

  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary,
  }
}

export async function getAdminMockTest(actor: Actor, id: string): Promise<AdminMockTestDetail> {
  assertCan(actor, 'mocktest:manage')
  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledMockTests({ mockTestId: id })
  const test = await loadMockTestByRef(id)
  if (!test) throw new MockTestError('MOCK_TEST_NOT_FOUND', 'Mock test not found')
  if (!canReadMockTest(actor, test)) {
    throw new MockTestError(
      'COUNTRY_MISMATCH',
      'You can only view global mock tests and your own country\u2019s mock tests'
    )
  }
  const health = await compositionHealth(test)
  const entry = await toAdminMockTest(actor, test, health)

  // The composed questions — authors must see what they are publishing.
  const questionIds = parseQuestionIds(test.questionIdsJson)
  const composition = await db.question.findMany({
    where: { id: { in: questionIds } },
    include: COMPOSITION_INCLUDE,
  })
  const byId = new Map(composition.map((row) => [row.id, row]))
  const questions: AdminMockTestQuestionRef[] = questionIds
    .map((id) => byId.get(id))
    .filter((question): question is CompositionQuestion => question != null)
    .map((question) => ({
      id: question.id,
      status: question.status,
      questionText: question.publishedRevision?.questionText ?? question.questionText ?? '',
      difficulty: (question.publishedRevision?.difficulty ?? 'BASIC') as AdminMockTestQuestionRef['difficulty'],
      languageCode: question.language.code,
      unit: {
        slug: question.knowledgeUnit.slug,
        canonicalName: question.knowledgeUnit.canonicalName,
        scope: question.knowledgeUnit.scope as 'GLOBAL' | 'COUNTRY',
        countryIso: null,
      },
    }))

  return { ...entry, questions }
}

/** Full revision history of one MockTest — the §36 preserved versions (admin). */
export async function listMockTestRevisions(
  actor: Actor,
  mockTestId: string
): Promise<AdminMockTestRevisionListResult> {
  assertCan(actor, 'mocktest:manage')
  const test = await loadMockTestByRef(mockTestId)
  if (!test) throw new MockTestError('MOCK_TEST_NOT_FOUND', 'Mock test not found')
  if (!canReadMockTest(actor, test)) {
    throw new MockTestError(
      'COUNTRY_MISMATCH',
      'You can only view revisions of global mock tests and your own country\u2019s mock tests'
    )
  }

  const revisions = await db.mockTestRevision.findMany({
    where: { mockTestId: test.id },
    orderBy: { revisionNumber: 'desc' }, // deterministic (§37)
    include: { publishedBy: true },
  })

  return {
    mockTestId: test.id,
    slug: test.slug,
    title: test.title,
    revisions: revisions.map(toRevisionRef),
  }
}

// ---------- Admin writes ----------

export async function createMockTest(
  actor: Actor,
  input: CreateMockTestInput,
  meta: AuditRequestMeta = {}
): Promise<AdminMockTestDetail> {
  assertCan(actor, 'mocktest:manage')

  // ---------- The scope (§6: exactly one of TOPIC / EXAM) ----------
  let topicId: string | null = null
  let examVersionId: string | null = null
  let scopeCountryId: string | null = null
  if (input.scopeType === 'TOPIC') {
    const topic = await db.topic.findUnique({
      where: { slug: (input.topicSlug ?? '').toLowerCase() },
      include: { country: { select: { isoCode: true } } },
    })
    if (!topic) throw new MockTestError('TOPIC_NOT_FOUND', `Unknown topic "${input.topicSlug}"`)
    topicId = topic.id
    scopeCountryId = topic.countryId
  } else {
    const exam = await db.exam.findUnique({
      where: { slug: (input.examSlug ?? '').toLowerCase() },
      include: { country: { select: { isoCode: true } } },
    })
    if (!exam) throw new MockTestError('EXAM_VERSION_NOT_FOUND', `Unknown exam "${input.examSlug}"`)
    const version = await db.examVersion.findFirst({
      where: { examId: exam.id, label: input.examVersionLabel },
    })
    if (!version) {
      throw new MockTestError(
        'EXAM_VERSION_NOT_FOUND',
        `Exam "${exam.slug}" has no version labelled "${input.examVersionLabel}"`
      )
    }
    if (exam.status !== 'ACTIVE') {
      throw new MockTestError(
        'EXAM_NOT_ACTIVE',
        `Exam "${exam.name}" is ${exam.status} — tests can only be scoped to ACTIVE exams`
      )
    }
    examVersionId = version.id
    scopeCountryId = exam.countryId
  }
  const target = { countryId: scopeCountryId, languageId: null as string | null }

  // Language (§35): must be ACTIVE; a country-scoped test must be in a
  // language that country configures (enforced server-side, never by UI).
  const language = await findActiveLanguageByCode(input.language.toLowerCase())
  if (!language) {
    throw new MockTestError('LANGUAGE_NOT_FOUND', `Unknown or inactive language "${input.language}"`)
  }
  if (scopeCountryId) {
    const configured = await isLanguageConfiguredForCountry(scopeCountryId, language.id)
    if (!configured) {
      throw new MockTestError(
        'LANGUAGE_NOT_AVAILABLE',
        `Language "${language.code}" is not configured for this test\u2019s country market (§35 — per-country language exposure)`
      )
    }
  }
  target.languageId = language.id

  // Object-level scope: country staff may only author for their own market;
  // a language-scoped WRITER only in their language (§20).
  if (!can(actor, 'mocktest:manage', target)) {
    const reason =
      actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER'
        ? scopeCountryId === null
          ? 'GLOBAL_TEST_ADMIN_ONLY'
          : actor.role === 'WRITER' && actor.languageScopeId && language.id !== actor.languageScopeId
            ? 'LANGUAGE_SCOPE'
            : 'COUNTRY_MISMATCH'
        : 'ROLE'
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.mocktestDenied,
      objectType: AUDIT_OBJECT_TYPES.mockTest,
      objectId: null,
      objectLabel: `${slugifyTitle(input.title)}/${language.code}/MockTest`,
      before: { scopeType: input.scopeType },
      metadata: { attemptedOperation: 'create', reason },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    if ((actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') && scopeCountryId === null) {
      throw new MockTestError(
        'GLOBAL_TEST_ADMIN_ONLY',
        'Country-scoped staff can only author tests for their own country\u2019s exams and topics'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      language.id !== actor.languageScopeId
    ) {
      throw new MockTestError(
        'LANGUAGE_SCOPE',
        'You are language-scoped to your assigned language (§20 explicit staff scopes) — this test is outside it'
      )
    }
    throw new MockTestError(
      'COUNTRY_MISMATCH',
      'You can only author mock tests for your own country\u2019s exams and topics'
    )
  }

  // ---------- The composition (§6 question_ids[] — §14/§35 checked) ----------
  // DRAFT tests may compose not-yet-published questions (the normal editorial
  // flow: author questions → author the test → publish questions → publish
  // the test); the publish gate re-checks publishability.
  await loadComposition(input.questionIds, {
    languageId: language.id,
    countryId: scopeCountryId,
    requirePublished: false,
  })

  // §7/§11 identity: one title per scope × language. The service check is
  // authoritative (the nullable scope columns make a DB composite unique
  // unreliable in Postgres — see the schema note).
  const existing = await db.mockTest.findFirst({
    where: {
      scopeType: input.scopeType,
      topicId,
      examVersionId,
      languageId: language.id,
      title: input.title,
    },
    select: { id: true, status: true, slug: true },
  })
  if (existing) {
    throw new MockTestError(
      'MOCK_TEST_EXISTS',
      `A mock test with this exact title already exists for this scope in "${language.code}" (status: ${existing.status}) — one test per scope + language + title (§11). Re-title the test or edit the existing entry.`
    )
  }

  const slug = await uniqueSlugFor(input.title)
  const created = await db.mockTest.create({
    data: {
      slug,
      title: input.title,
      scopeType: input.scopeType,
      topicId,
      examVersionId,
      languageId: language.id,
      status: 'DRAFT',
      questionIdsJson: serializeQuestionIds(input.questionIds),
      durationMinutes: input.durationMinutes,
      passPercent: input.passPercent,
      aiAssisted: input.aiAssisted ?? false,
      createdById: actor.userId,
    },
    include: MOCK_TEST_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.mocktestCreate,
    objectType: AUDIT_OBJECT_TYPES.mockTest,
    objectId: created.id,
    objectLabel: mockTestLabel(created),
    after: snapshotOf(created),
    metadata: {
      slug,
      scopeType: input.scopeType,
      languageCode: language.code,
      questionCount: input.questionIds.length,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return getAdminMockTest(actor, created.id)
}

export async function updateMockTest(
  actor: Actor,
  id: string,
  input: UpdateMockTestInput,
  meta: AuditRequestMeta = {}
): Promise<AdminMockTestDetail> {
  const test = await loadMockTestByRef(id)
  if (!test) throw new MockTestError('MOCK_TEST_NOT_FOUND', 'Mock test not found')
  assertCanManageMockTest(actor, test, 'update', meta)

  const editability = MOCK_TEST_EDITABILITY[test.status as MockTestStatusPublic]
  if (editability === 'none') {
    if (test.status === 'RETIRED') {
      throw new MockTestError(
        'STATE_LOCKED',
        'Retired mock tests are read-only (§36) — create a new test if the product is needed again'
      )
    }
    throw new MockTestError(
      'STATE_LOCKED',
      'Scheduled mock tests are locked — what was reviewed is what publishes (§19). Send it back to draft to edit.'
    )
  }

  // Working-copy merge (title + scope + language are identity — immutable;
  // anchors are create-time decisions, §7).
  const questionIds = input.questionIds ?? parseQuestionIds(test.questionIdsJson)
  const durationMinutes = input.durationMinutes ?? test.durationMinutes
  const passPercent = input.passPercent ?? test.passPercent

  // §14/§35 composition re-check on the merged working copy.
  await loadComposition(questionIds, {
    languageId: test.languageId,
    countryId: targetOfMockTest(test).countryId,
    requirePublished: false,
  })

  const before = snapshotOf(test)
  const updated = await db.mockTest.update({
    where: { id: test.id },
    data: {
      ...(input.questionIds !== undefined
        ? { questionIdsJson: serializeQuestionIds(input.questionIds) }
        : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes } : {}),
      ...(input.passPercent !== undefined ? { passPercent } : {}),
      ...(input.aiAssisted !== undefined ? { aiAssisted: input.aiAssisted } : {}),
    },
    include: MOCK_TEST_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.mocktestUpdate,
    objectType: AUDIT_OBJECT_TYPES.mockTest,
    objectId: test.id,
    objectLabel: mockTestLabel(test),
    before,
    after: snapshotOf(updated),
    metadata: {
      changedFields: Object.keys(input),
      note:
        test.status === 'PUBLISHED'
          ? 'Working-copy edit — staged, not public. Public reads serve the live revision until a new revision is published (§36).'
          : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return getAdminMockTest(actor, updated.id)
}

export async function transitionMockTest(
  actor: Actor,
  id: string,
  input: MockTestTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminMockTestDetail> {
  const test = await loadMockTestByRef(id)
  if (!test) throw new MockTestError('MOCK_TEST_NOT_FOUND', 'Mock test not found')
  assertCanManageMockTest(actor, test, `transition:${input.action}`, meta)

  // §18 editorial gate: publish/schedule/retire are editorial decisions —
  // the Question/Test-Author class creates, edits and submits, but never
  // publishes. Denied here with an audit trail (§20/§30).
  if (
    MOCK_TEST_PUBLISH_GATED_ACTIONS.has(input.action) &&
    !can(actor, 'mocktest:publish', { countryId: targetOfMockTest(test).countryId })
  ) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.mocktestDenied,
      objectType: AUDIT_OBJECT_TYPES.mockTest,
      objectId: test.id,
      objectLabel: mockTestLabel(test),
      before: { status: test.status },
      metadata: {
        attemptedOperation: `transition:${input.action}`,
        reason: 'PUBLISH_NOT_PERMITTED',
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new MockTestError(
      'PUBLISH_NOT_PERMITTED',
      'Test authors create and edit mock tests but cannot publish (§18) — ask an editor to publish, schedule or retire'
    )
  }

  const status = test.status as MockTestStatusPublic
  const targetStatus = MOCK_TEST_TRANSITIONS[status][input.action]
  if (!targetStatus) {
    throw new MockTestError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${status}`
    )
  }

  // ---------- publish: append an immutable revision (§19/§36) ----------
  if (input.action === 'publish') {
    // The composition publish gate (§6/§14/§35/§19): every question must be
    // PUBLISHED with a live revision.
    await loadComposition(parseQuestionIds(test.questionIdsJson), {
      languageId: test.languageId,
      countryId: targetOfMockTest(test).countryId,
      requirePublished: true,
    })

    const isRepublish = test.publishedRevisionId != null
    if (isRepublish && test.publishedRevision) {
      if (!input.changeSummary?.trim()) {
        throw new MockTestError(
          'CHANGE_SUMMARY_REQUIRED',
          'Publishing a new revision of a live mock test requires a change summary (§25/§36 — corrections are never silent)'
        )
      }
      const unchanged =
        test.questionIdsJson === test.publishedRevision.questionIdsJson &&
        test.durationMinutes === test.publishedRevision.durationMinutes &&
        test.passPercent === test.publishedRevision.passPercent
      if (unchanged) {
        throw new MockTestError(
          'NO_CHANGES',
          'The working copy is identical to the live revision — nothing to publish'
        )
      }
    }

    // Append revision N+1 and move the live pointer atomically. The unique
    // (mockTestId, revisionNumber) guards against concurrent double-publish.
    const nextNumber = await db.$transaction(async (tx) => {
      const aggregate = await tx.mockTestRevision.aggregate({
        where: { mockTestId: test.id },
        _max: { revisionNumber: true },
      })
      const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
      const revision = await tx.mockTestRevision.create({
        data: {
          mockTestId: test.id,
          revisionNumber,
          title: test.title,
          questionIdsJson: test.questionIdsJson,
          durationMinutes: test.durationMinutes,
          passPercent: test.passPercent,
          // §24/§26 — the revision freezes the AI-provenance flag at publish time.
          aiAssisted: test.aiAssisted,
          changeSummary: input.changeSummary?.trim() ?? null,
          publishedById: actor.userId,
        },
      })
      await tx.mockTest.update({
        where: { id: test.id },
        data: {
          status: 'PUBLISHED',
          publishedRevisionId: revision.id,
          scheduledForAt: null, // publishing (incl. publish-now from SCHEDULED) clears the marker
        },
      })
      // §19 wiring: resolve the MockTest's open work items inside the same
      // transaction so board state never lags content state.
      await wireMockTestWorkflow(tx, {
        action: 'publish',
        actorId: actor.userId,
        mockTest: workflowMockTestOf(test),
      })
      return revisionNumber
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.mocktestTransition,
      objectType: AUDIT_OBJECT_TYPES.mockTest,
      objectId: test.id,
      objectLabel: mockTestLabel(test),
      before: {
        status: test.status,
        liveRevision: test.publishedRevision?.revisionNumber ?? null,
      },
      after: { status: 'PUBLISHED', revision: nextNumber },
      metadata: {
        action: 'publish',
        revisionNumber: nextNumber,
        changeSummary: input.changeSummary?.trim() ?? null,
        republished: isRepublish,
        aiAssisted: test.aiAssisted,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    const refreshed = await loadMockTestByRef(test.id)
    return getAdminMockTest(actor, refreshed!.id)
  }

  // ---------- schedule: approve for future release (§19 step 7) ----------
  if (input.action === 'schedule') {
    const when = input.scheduledFor ? new Date(input.scheduledFor) : null
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new MockTestError(
        'SCHEDULED_FOR_REQUIRED',
        'A valid future release time is required to schedule a mock test (§19 step 7)'
      )
    }
    // The same composition publish gate as publish (§6/§36).
    await loadComposition(parseQuestionIds(test.questionIdsJson), {
      languageId: test.languageId,
      countryId: targetOfMockTest(test).countryId,
      requirePublished: true,
    })

    await db.$transaction(async (tx) => {
      await tx.mockTest.update({
        where: { id: test.id },
        data: { status: 'SCHEDULED', scheduledForAt: when },
      })
      // §19 wiring: the review cycle is complete (approval happened here);
      // open work items resolve as "scheduled".
      await wireMockTestWorkflow(tx, {
        action: 'schedule',
        actorId: actor.userId,
        mockTest: workflowMockTestOf(test),
      })
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.mocktestTransition,
      objectType: AUDIT_OBJECT_TYPES.mockTest,
      objectId: test.id,
      objectLabel: mockTestLabel(test),
      before: { status: test.status },
      after: { status: 'SCHEDULED', scheduledFor: when.toISOString() },
      metadata: { action: 'schedule', scheduledFor: when.toISOString() },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    return getAdminMockTest(actor, test.id)
  }

  // ---------- simple transitions (submit_review / send_back / retire) ----------
  await db.$transaction(async (tx) => {
    await tx.mockTest.update({
      where: { id: test.id },
      data: {
        status: targetStatus,
        // send_back from SCHEDULED cancels the pending release (§19).
        ...(input.action === 'send_back' ? { scheduledForAt: null } : {}),
      },
    })
    // §19 wiring: submit_review opens the review task; send_back resolves the
    // cycle; retire cancels open work — all inside the same transaction.
    await wireMockTestWorkflow(tx, {
      action: input.action,
      actorId: actor.userId,
      mockTest: workflowMockTestOf(test),
    })
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.mocktestTransition,
    objectType: AUDIT_OBJECT_TYPES.mockTest,
    objectId: test.id,
    objectLabel: mockTestLabel(test),
    before: { status: test.status },
    after: {
      status: targetStatus,
      ...(input.action === 'send_back' && test.scheduledForAt
        ? { scheduledForCleared: test.scheduledForAt.toISOString() }
        : {}),
    },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return getAdminMockTest(actor, test.id)
}
