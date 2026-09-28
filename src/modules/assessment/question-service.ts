/**
 * GlobIQ — Assessment: Question domain service (P7-S2)
 * Master Plan §6 (Question row: knowledge_unit_id, exam_version_id,
 * difficulty, type, options, correct_answer, explanation), §7 (a Question
 * REPRESENTS a canonical KnowledgeUnit — the fact is never re-entered, only
 * ASSESSED), §19 (the editorial workflow: submit → review → publish/schedule,
 * every transition audited, published content immutable at the revision
 * level), §22 (the knowledge page's scored practice layer — standalone
 * practice: answer, get judged server-side, read the explanation), §23
 * ("Question (scored, MCQ)" — options + correct answer + explanation; the
 * QnA/Question split is §46.14), §24/§26 (AI-provenance: Question is a §26
 * AI-candidate format — the flag rides the working copy and freezes onto
 * each published revision), §35 (language exposure is per-country, enforced
 * server-side), §14/§15 (country scope inherited from the owning unit — a
 * Question is never more visible than its record; the OPTIONAL exam anchor
 * follows the §14 country rule), §36 (revisions preserve previous versions;
 * corrections carry changeSummary; RETIRED is read-only end-of-life), §37
 * (service-boundary authorization, deterministic ordering, explicit typed
 * errors), §38 (scoped admin reads), §17 (search: published Question text
 * folds into the unit's documents via onUnitChanged — the P6-S3/QnA fold
 * precedent), §43 (P7-S2 scope).
 *
 * Architecture (the ContentItem/QnA twin, NOT a clone — §46.14):
 * questionText/optionsJson/correctAnswer/explanation/difficulty on Question
 * are the WORKING COPY (editorial staging); public reads ALWAYS serve the
 * live QuestionRevision snapshot — staged corrections stay invisible until a
 * new revision publishes. The correctAnswer NEVER ships on the public
 * practice layer: it is revealed per-question by checkPracticeAnswer, the
 * scored discipline of §22. The question text is create-time identity (§11):
 * re-wording a question is a NEW Question, never a silent edit of a live one.
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
import { getTopicIdentity } from '@/modules/taxonomy'
import { onUnitChanged } from '@/modules/search'
import { wireQuestionWorkflow } from '@/modules/editorial'

import type {
  AdminQuestionEntry,
  AdminQuestionListResult,
  AdminQuestionRevisionListResult,
  PracticeAnswerResult,
  PublicPracticeLayer,
  PublicPracticeQuestion,
  QuestionOptionRef,
  QuestionRevisionRef,
  QuestionStatusPublic,
  QuestionTransitionAction,
} from './question-types'
import { QUESTION_EDITABILITY, QUESTION_PUBLISH_GATED_ACTIONS, QUESTION_TRANSITIONS } from './question-types'
import type {
  AdminQuestionListQuery,
  CreateQuestionInput,
  QuestionTransitionInput,
  UpdateQuestionInput,
} from './question-validation'
import { explanationFitsQuestion, mcqShapeFits, questionFitsQuestion } from './question-validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type QuestionErrorCode =
  | 'QUESTION_NOT_FOUND'
  | 'QUESTION_NOT_PUBLISHED'
  | 'INVALID_OPTION'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_ARCHIVED'
  | 'UNIT_NOT_VERIFIED'
  | 'QUESTION_EXISTS'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'EXAM_VERSION_NOT_FOUND'
  | 'EXAM_COUNTRY_MISMATCH'
  | 'EXAM_NOT_ACTIVE'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'NO_CHANGES'
  | 'OPTIONS_INVALID'
  | 'EXPLANATION_INVALID'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_QUESTION_ADMIN_ONLY'
  | 'LANGUAGE_SCOPE'
  | 'PUBLISH_NOT_PERMITTED'
  | 'SCHEDULED_FOR_REQUIRED'

const ERROR_STATUS: Record<QuestionErrorCode, number> = {
  QUESTION_NOT_FOUND: 404,
  QUESTION_NOT_PUBLISHED: 409,
  INVALID_OPTION: 400,
  UNIT_NOT_FOUND: 404,
  UNIT_ARCHIVED: 400,
  UNIT_NOT_VERIFIED: 409,
  QUESTION_EXISTS: 409,
  LANGUAGE_NOT_FOUND: 404,
  LANGUAGE_NOT_AVAILABLE: 400,
  EXAM_VERSION_NOT_FOUND: 404,
  EXAM_COUNTRY_MISMATCH: 400,
  EXAM_NOT_ACTIVE: 400,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  CHANGE_SUMMARY_REQUIRED: 400,
  NO_CHANGES: 409,
  OPTIONS_INVALID: 400,
  EXPLANATION_INVALID: 400,
  COUNTRY_MISMATCH: 403,
  GLOBAL_QUESTION_ADMIN_ONLY: 403,
  LANGUAGE_SCOPE: 403,
  PUBLISH_NOT_PERMITTED: 403,
  SCHEDULED_FOR_REQUIRED: 400,
}

export class QuestionError extends Error {
  readonly code: QuestionErrorCode
  readonly status: number

  constructor(code: QuestionErrorCode, message: string) {
    super(message)
    this.name = 'QuestionError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown QuestionError to envelope data (§37); null for others. */
export function toQuestionErrorResponse(
  error: unknown
): { message: string; code: QuestionErrorCode; status: number } | null {
  if (error instanceof QuestionError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

/** Parses a stored optionsJson into the §37 DTO shape. Invalid JSON is a
 * data-integrity breach — a hard error, never a silent fallback. */
function parseOptions(optionsJson: string): QuestionOptionRef[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(optionsJson)
  } catch {
    throw new QuestionError(
      'OPTIONS_INVALID',
      'This question carries malformed option data — editorial must correct it before it can be used'
    )
  }
  if (!Array.isArray(parsed)) {
    throw new QuestionError('OPTIONS_INVALID', 'This question carries malformed option data')
  }
  return parsed.map((option, index) => {
    if (typeof option === 'string') {
      return { key: OPTION_KEYS[index] ?? String(index), text: option }
    }
    if (option != null && typeof option === 'object' && 'key' in option && 'text' in option) {
      const record = option as { key: unknown; text: unknown }
      return {
        key: String(record.key),
        text: String(record.text),
      }
    }
    return { key: OPTION_KEYS[index] ?? String(index), text: String(option) }
  })
}

/** Serializes plain option strings into the stored JSON (keys by position). */
function serializeOptions(options: string[]): string {
  return JSON.stringify(
    options.map((text, index) => ({ key: OPTION_KEYS[index] ?? String(index), text }))
  )
}

type QuestionRow = Prisma.QuestionGetPayload<{
  include: {
    knowledgeUnit: true
    language: true
    examVersion: { include: { exam: true } }
    publishedRevision: { include: { publishedBy: true } }
    _count: { select: { revisions: true } }
  }
}>

const QUESTION_INCLUDE = {
  knowledgeUnit: true,
  language: true,
  examVersion: { include: { exam: true } },
  publishedRevision: { include: { publishedBy: true } },
  _count: { select: { revisions: true } },
} satisfies Prisma.QuestionInclude

async function loadUnitByRef(ref: string) {
  return db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
}

async function loadQuestion(id: string): Promise<QuestionRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.question.findUnique({
    where: { id },
    include: QUESTION_INCLUDE,
  })
}

/** A Question's permission target: the OWNING unit's country scope (§14)
 * plus the Question's language (the §20 WRITER language-scope dimension). */
function targetOfQuestion(
  question: QuestionRow
): { countryId: string | null; languageId: string } {
  return {
    countryId: question.knowledgeUnit.scope === 'COUNTRY' ? question.knowledgeUnit.countryId : null,
    languageId: question.languageId,
  }
}

/** The §19 workflow event payload for a Question (task wiring). */
function workflowQuestionOf(question: QuestionRow) {
  return {
    id: question.id,
    unitSlug: question.knowledgeUnit.slug,
    countryId:
      question.knowledgeUnit.scope === 'COUNTRY' ? question.knowledgeUnit.countryId : null,
    languageId: question.languageId,
    languageCode: question.language.code,
    questionText: question.questionText,
  }
}

/** Working-copy snapshot for audit before/after (options parsed for shape,
 * texts truncated — the §30 data-minimisation precedent). */
function snapshotOf(question: QuestionRow) {
  return {
    unitSlug: question.knowledgeUnit.slug,
    languageCode: question.language.code,
    status: question.status,
    type: question.type,
    difficulty: question.difficulty,
    questionText: question.questionText,
    options: parseOptions(question.optionsJson).map((option) => ({
      key: option.key,
      text: option.text.length > 80 ? `${option.text.slice(0, 77)}…` : option.text,
    })),
    correctAnswer: question.correctAnswer,
    explanationExcerpt:
      question.explanation.length > 120 ? `${question.explanation.slice(0, 117)}…` : question.explanation,
    aiAssisted: question.aiAssisted,
    examAnchor: question.examVersion
      ? { examSlug: question.examVersion.exam.slug, versionLabel: question.examVersion.label }
      : null,
    liveRevision: question.publishedRevision
      ? { number: question.publishedRevision.revisionNumber, question: question.publishedRevision.questionText }
      : null,
  }
}

/** Stable object label for audit rows (§36 accountability). */
function questionLabel(question: QuestionRow): string {
  return `${question.knowledgeUnit.slug}/${question.language.code}/Question`
}

/** Object-level permission check + denial audit (§20 signal — the content pattern). */
function assertCanManageQuestion(
  actor: Actor,
  question: QuestionRow,
  operation: string,
  meta?: AuditRequestMeta
): void {
  const target = targetOfQuestion(question)
  if (can(actor, 'question:manage', target)) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.questionDenied,
    objectType: AUDIT_OBJECT_TYPES.question,
    objectId: question.id,
    objectLabel: questionLabel(question),
    before: { status: question.status, unitScope: question.knowledgeUnit.scope },
    metadata: {
      attemptedOperation: operation,
      reason: questionDenialReason(actor, question),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (question.knowledgeUnit.scope === 'GLOBAL') {
      throw new QuestionError(
        'GLOBAL_QUESTION_ADMIN_ONLY',
        'Country-scoped staff cannot manage questions on global records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      question.languageId !== actor.languageScopeId
    ) {
      throw new QuestionError(
        'LANGUAGE_SCOPE',
        'This question is outside your language scope (§20 explicit staff scopes)'
      )
    }
    throw new QuestionError(
      'COUNTRY_MISMATCH',
      'You can only manage questions for your own country'
    )
  }
  throw new QuestionError('COUNTRY_MISMATCH', 'You do not have permission to manage this question')
}

function questionDenialReason(actor: Actor, question: QuestionRow): string {
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (question.knowledgeUnit.scope === 'GLOBAL') return 'GLOBAL_QUESTION_ADMIN_ONLY'
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      question.languageId !== actor.languageScopeId
    ) {
      return 'LANGUAGE_SCOPE'
    }
    return 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/**
 * Admin read access (content parity): ADMIN sees all; COUNTRY_ADMIN and
 * WRITER see global (read-only) + own-country questions — a writer's
 * language scope narrows only what they may MANAGE, not what they may read.
 */
function canReadQuestion(actor: Actor, question: QuestionRow): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    return (
      question.knowledgeUnit.scope === 'GLOBAL' ||
      question.knowledgeUnit.countryId === actor.countryId
    )
  }
  return false
}

function toRevisionRef(
  revision: Prisma.QuestionRevisionGetPayload<{ include: { publishedBy: true } }>
): QuestionRevisionRef {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    questionText: revision.questionText,
    options: parseOptions(revision.optionsJson),
    correctAnswer: revision.correctAnswer,
    explanation: revision.explanation,
    difficulty: revision.difficulty as QuestionRevisionRef['difficulty'],
    changeSummary: revision.changeSummary,
    aiAssisted: revision.aiAssisted,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy?.email ?? null,
  }
}

async function toAdminQuestion(actor: Actor, question: QuestionRow): Promise<AdminQuestionEntry> {
  const topic = await getTopicIdentity(question.knowledgeUnit.topicId)
  const target = targetOfQuestion(question)
  const canManage = can(actor, 'question:manage', target)
  // §18 editorial gate: publish-class affordances only for question:publish
  // holders (ADMIN + COUNTRY_ADMIN — writers never see them).
  const canPublish = can(actor, 'question:publish', { countryId: target.countryId })
  const editability = QUESTION_EDITABILITY[question.status as QuestionStatusPublic]
  const machineTransitions = Object.keys(
    QUESTION_TRANSITIONS[question.status as QuestionStatusPublic]
  ) as QuestionTransitionAction[]
  const transitions = machineTransitions.filter(
    (action) => !QUESTION_PUBLISH_GATED_ACTIONS.has(action) || canPublish
  )
  const anchorPublishable = question.knowledgeUnit.status === 'VERIFIED'
  return {
    id: question.id,
    status: question.status as QuestionStatusPublic,
    language: {
      code: question.language.code,
      name: question.language.name,
      nativeName: question.language.nativeName,
    },
    type: 'MCQ',
    difficulty: question.difficulty as AdminQuestionEntry['difficulty'],
    questionText: question.questionText,
    options: parseOptions(question.optionsJson),
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    examAnchor: question.examVersion
      ? {
          examVersionId: question.examVersion.id,
          exam: {
            slug: question.examVersion.exam.slug,
            name: question.examVersion.exam.name,
            code: question.examVersion.exam.code,
            status: question.examVersion.exam.status,
          },
          versionLabel: question.examVersion.label,
        }
      : null,
    unit: {
      id: question.knowledgeUnit.id,
      slug: question.knowledgeUnit.slug,
      canonicalName: question.knowledgeUnit.canonicalName,
      status: question.knowledgeUnit.status,
      scope: question.knowledgeUnit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso:
        question.knowledgeUnit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
      topicSlug: topic?.slug ?? null,
    },
    liveRevision: question.publishedRevision ? toRevisionRef(question.publishedRevision) : null,
    revisionCount: question._count.revisions,
    aiAssisted: question.aiAssisted,
    scheduledFor: question.scheduledForAt?.toISOString() ?? null,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    // Affordances from server truth (§20) — non-managers see none; writers
    // never see publish-class actions (§18).
    allowedTransitions: canManage ? transitions : [],
    // The anchor publish gate — VERIFIED unit (§7): a Question is never more
    // visible than its record.
    anchorPublishable,
    anchorBlockReason: anchorPublishable
      ? null
      : `The owning unit is ${question.knowledgeUnit.status} — questions can only be published on VERIFIED units (§7)`,
  }
}

// ---------- §19 step 7: scheduled-release materialization ----------

/**
 * Publishes ONE due SCHEDULED Question atomically — the ContentItem/QnA twin.
 * The conditional claim (`updateMany` on status + time) makes concurrent
 * reads safe; the published question is the locked working copy — exactly
 * what review approved (§19).
 */
async function materializeScheduledQuestion(questionId: string): Promise<void> {
  const question = await loadQuestion(questionId)
  if (
    !question ||
    question.status !== 'SCHEDULED' ||
    !question.scheduledForAt ||
    question.scheduledForAt.getTime() > Date.now()
  ) {
    return
  }
  // §14 guard: a Question is never more visible than its record — the owning
  // unit must still be VERIFIED. A unit that lost verification between
  // approval and release holds the Question in SCHEDULED until the anchor
  // reopens (§36).
  if (question.knowledgeUnit.status !== 'VERIFIED') return

  const nextNumber = await db.$transaction(async (tx) => {
    const claimed = await tx.question.updateMany({
      where: {
        id: question.id,
        status: 'SCHEDULED',
        scheduledForAt: { lte: new Date() },
      },
      data: { status: 'PUBLISHED', scheduledForAt: null },
    })
    if (claimed.count === 0) return null // a concurrent read materialized it
    const aggregate = await tx.questionRevision.aggregate({
      where: { questionId: question.id },
      _max: { revisionNumber: true },
    })
    const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
    const revision = await tx.questionRevision.create({
      data: {
        questionId: question.id,
        revisionNumber,
        questionText: question.questionText,
        optionsJson: question.optionsJson,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        difficulty: question.difficulty,
        aiAssisted: question.aiAssisted,
        changeSummary: 'Scheduled release (§19 step 7) — published automatically at the scheduled time',
        publishedById: null, // system publish
      },
    })
    await tx.question.update({
      where: { id: question.id },
      data: { publishedRevisionId: revision.id },
    })
    await wireQuestionWorkflow(tx, {
      action: 'publish',
      actorId: null,
      question: workflowQuestionOf(question),
    })
    return revisionNumber
  })
  if (nextNumber == null) return

  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.questionTransition,
    objectType: AUDIT_OBJECT_TYPES.question,
    objectId: question.id,
    objectLabel: questionLabel(question),
    before: { status: 'SCHEDULED', scheduledFor: question.scheduledForAt.toISOString() },
    after: { status: 'PUBLISHED', revision: nextNumber },
    metadata: { action: 'publish', scheduled: true, materialized: 'lazy-read' },
  })

  // §17: the scheduled release just enriched a public surface — the unit's
  // documents re-project now (Question text folds into bodyText), not on the
  // next full reindex.
  await onUnitChanged(question.knowledgeUnit.slug)
}

/**
 * Publishes due SCHEDULED Questions lazily — the modular monolith's
 * scheduler is "the first read after the scheduled time". Public and admin
 * reads both call this, scoped to what they are reading (§37).
 */
export async function materializeDueScheduledQuestions(
  scope?: { unitId?: string; questionId?: string }
): Promise<void> {
  const due = await db.question.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledForAt: { lte: new Date() },
      ...(scope?.unitId ? { knowledgeUnitId: scope.unitId } : {}),
      ...(scope?.questionId ? { id: scope.questionId } : {}),
    },
    select: { id: true },
    take: 25, // bounded per read
  })
  for (const row of due) await materializeScheduledQuestion(row.id)
}

// ---------- Public reads (the §22 knowledge-page scored practice layer) ----------

const DIFFICULTY_ORDER: Record<string, number> = { BASIC: 0, INTERMEDIATE: 1, ADVANCED: 2 }

/**
 * The published practice questions of one unit in one language — ALWAYS live
 * revision snapshots, deterministically ordered (§37): difficulty first (the
 * learner's natural progression), then publication, then text. The
 * correctAnswer/explanation are deliberately ABSENT — they ship per-question
 * only through checkPracticeAnswer (§22 scored discipline). Called by the
 * knowledge render-service after its own visibility chain has already
 * validated the unit + locale; the layer never bypasses that chain.
 */
export async function getPublicPracticeLayer(input: {
  unitId: string
  languageId: string
}): Promise<PublicPracticeLayer> {
  // §19 step 7: due scheduled releases go live before assembling the layer.
  await materializeDueScheduledQuestions({ unitId: input.unitId })

  const rows = await db.question.findMany({
    where: {
      knowledgeUnitId: input.unitId,
      languageId: input.languageId,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
    },
    include: QUESTION_INCLUDE,
  })

  const entries: PublicPracticeQuestion[] = rows
    .filter((row) => row.publishedRevision != null)
    .map((row) => ({
      id: row.id,
      question: row.publishedRevision!.questionText,
      options: parseOptions(row.publishedRevision!.optionsJson),
      type: 'MCQ' as const,
      difficulty: row.publishedRevision!.difficulty as PublicPracticeQuestion['difficulty'],
      examAnchor: row.examVersion
        ? {
            exam: {
              slug: row.examVersion.exam.slug,
              name: row.examVersion.exam.name,
              code: row.examVersion.exam.code,
            },
            versionLabel: row.examVersion.label,
          }
        : null,
      revision: {
        number: row.publishedRevision!.revisionNumber,
        publishedAt: row.publishedRevision!.publishedAt.toISOString(),
        changeSummary: row.publishedRevision!.changeSummary,
      },
      aiAssisted: row.publishedRevision!.aiAssisted,
      language: {
        code: row.language.code,
        name: row.language.name,
        nativeName: row.language.nativeName,
      },
    }))
    // Deterministic (§37): difficulty ladder, then first publication, then text.
    .sort(
      (a, b) =>
        DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] ||
        a.revision.publishedAt.localeCompare(b.revision.publishedAt) ||
        a.question.localeCompare(b.question)
    )

  return entries.length > 0
    ? { available: true, entries, note: null }
    : {
        available: false,
        entries: [],
        note: 'No published practice questions for this unit in this language yet — scored MCQs appear here the moment they are published (§22).',
      }
}

/**
 * Standalone practice, scored (§22): checks ONE answer against the live
 * revision — the ONLY public path where correctAnswer + explanation ship,
 * and only for the question that was just answered. No persistence by design:
 * TestAttempt (the §6 attempt record feeding P7-S4 mastery) is P7-S3's
 * engine; this session's practice is judged in the moment, server-side.
 */
export async function checkPracticeAnswer(input: {
  questionId: string
  selected: string
}): Promise<PracticeAnswerResult> {
  // §19 step 7: a just-due SCHEDULED question materializes before answering.
  await materializeDueScheduledQuestions({ questionId: input.questionId })

  const question = await loadQuestion(input.questionId)
  if (!question) {
    throw new QuestionError('QUESTION_NOT_FOUND', 'Practice question not found')
  }
  if (question.status !== 'PUBLISHED' || !question.publishedRevision) {
    throw new QuestionError(
      'QUESTION_NOT_PUBLISHED',
      question.status === 'RETIRED'
        ? 'This question has been withdrawn (§36) — it can no longer be practised.'
        : 'This question is not published yet (§19).'
    )
  }

  const revision = question.publishedRevision
  const options = parseOptions(revision.optionsJson)
  const selected = input.selected.trim().toUpperCase()
  if (!options.some((option) => option.key === selected)) {
    throw new QuestionError(
      'INVALID_OPTION',
      `"${input.selected}" is not one of this question's options`
    )
  }

  return {
    questionId: question.id,
    selected,
    correct: selected === revision.correctAnswer,
    correctAnswer: revision.correctAnswer,
    explanation: revision.explanation,
    revision: {
      number: revision.revisionNumber,
      publishedAt: revision.publishedAt.toISOString(),
    },
    aiAssisted: revision.aiAssisted,
  }
}

// ---------- Admin reads ----------

export async function getAdminQuestions(
  actor: Actor,
  query: AdminQuestionListQuery
): Promise<AdminQuestionListResult> {
  assertCan(actor, 'question:manage')

  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledQuestions()

  let unitId: string | undefined
  if (query.unit) {
    const unit = await loadUnitByRef(query.unit)
    if (!unit) throw new QuestionError('UNIT_NOT_FOUND', `Unknown unit "${query.unit}"`)
    unitId = unit.id
  }

  let languageId: string | undefined
  if (query.language) {
    const language = await findActiveLanguageByCode(query.language)
    if (!language) throw new QuestionError('LANGUAGE_NOT_FOUND', `Unknown language "${query.language}"`)
    languageId = language.id
  }

  let examVersionIds: string[] | undefined
  if (query.exam) {
    const exam = await db.exam.findUnique({ where: { slug: query.exam.toLowerCase() } })
    if (!exam) throw new QuestionError('EXAM_VERSION_NOT_FOUND', `Unknown exam "${query.exam}"`)
    const versions = await db.examVersion.findMany({
      where: { examId: exam.id },
      select: { id: true },
    })
    examVersionIds = versions.map((version) => version.id)
  }

  // COUNTRY_ADMIN + WRITER: global (read-only) + own-country questions —
  // content parity.
  const scopeFilter: Prisma.QuestionWhereInput | undefined =
    actor.role === 'ADMIN'
      ? undefined
      : {
          knowledgeUnit: {
            OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }],
          },
        }

  const where: Prisma.QuestionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(unitId ? { knowledgeUnitId: unitId } : {}),
    ...(languageId ? { languageId } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(examVersionIds ? { examVersionId: { in: examVersionIds } } : {}),
    ...(query.q
      ? {
          OR: [
            { questionText: { contains: query.q, mode: 'insensitive' } },
            { explanation: { contains: query.q, mode: 'insensitive' } },
            { knowledgeUnit: { canonicalName: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(scopeFilter ? scopeFilter : {}),
  }

  const [rows, total, summaryRows] = await Promise.all([
    db.question.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: QUESTION_INCLUDE,
    }),
    db.question.count({ where }),
    db.question.groupBy({
      by: ['status'],
      where: scopeFilter
        ? {
            knowledgeUnit: {
              OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }],
            },
          }
        : undefined,
      _count: { _all: true },
    }),
  ])

  const summary = { total: 0, DRAFT: 0, IN_REVIEW: 0, SCHEDULED: 0, PUBLISHED: 0, RETIRED: 0 }
  for (const row of summaryRows) {
    summary.total += row._count._all
    summary[row.status as keyof typeof summary] = row._count._all
  }

  const items: AdminQuestionEntry[] = []
  for (const row of rows) {
    if (canReadQuestion(actor, row)) items.push(await toAdminQuestion(actor, row))
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

export async function getAdminQuestion(actor: Actor, id: string): Promise<AdminQuestionEntry> {
  assertCan(actor, 'question:manage')
  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledQuestions({ questionId: id })
  const question = await loadQuestion(id)
  if (!question) throw new QuestionError('QUESTION_NOT_FOUND', 'Question not found')
  if (!canReadQuestion(actor, question)) {
    throw new QuestionError(
      'COUNTRY_MISMATCH',
      'You can only view global questions and your own country questions'
    )
  }
  return toAdminQuestion(actor, question)
}

/** Full revision history of one Question — the §36 preserved versions (admin). */
export async function listQuestionRevisions(
  actor: Actor,
  questionId: string
): Promise<AdminQuestionRevisionListResult> {
  assertCan(actor, 'question:manage')
  const question = await loadQuestion(questionId)
  if (!question) throw new QuestionError('QUESTION_NOT_FOUND', 'Question not found')
  if (!canReadQuestion(actor, question)) {
    throw new QuestionError(
      'COUNTRY_MISMATCH',
      'You can only view revisions of global questions and your own country questions'
    )
  }

  const revisions = await db.questionRevision.findMany({
    where: { questionId: question.id },
    orderBy: { revisionNumber: 'desc' }, // deterministic (§37)
    include: { publishedBy: true },
  })

  return {
    questionId: question.id,
    unit: { slug: question.knowledgeUnit.slug, canonicalName: question.knowledgeUnit.canonicalName },
    language: { code: question.language.code, name: question.language.name },
    revisions: revisions.map(toRevisionRef),
  }
}

// ---------- Admin writes ----------

export async function createQuestion(
  actor: Actor,
  input: CreateQuestionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminQuestionEntry> {
  assertCan(actor, 'question:manage')

  // ---------- The canonical anchor (§7 — KnowledgeUnit only, §6) ----------
  const unit = await loadUnitByRef(input.unit)
  if (!unit) throw new QuestionError('UNIT_NOT_FOUND', `Unknown knowledge unit "${input.unit}"`)
  if (unit.status === 'ARCHIVED') {
    throw new QuestionError(
      'UNIT_ARCHIVED',
      'Archived units cannot receive new questions — create a new unit instead (§36)'
    )
  }
  const anchorScope: 'GLOBAL' | 'COUNTRY' =
    unit.scope === 'COUNTRY' && unit.countryId ? 'COUNTRY' : 'GLOBAL'
  const target = {
    countryId: anchorScope === 'COUNTRY' ? unit.countryId : null,
    languageId: null as string | null,
  }

  // Language (§35): must be ACTIVE; for COUNTRY-scoped units it must be
  // configured for that unit's country (enforced server-side, never by UI).
  const language = await findActiveLanguageByCode(input.language.toLowerCase())
  if (!language) {
    throw new QuestionError('LANGUAGE_NOT_FOUND', `Unknown or inactive language "${input.language}"`)
  }
  if (anchorScope === 'COUNTRY' && unit.countryId) {
    const configured = await isLanguageConfiguredForCountry(unit.countryId, language.id)
    if (!configured) {
      throw new QuestionError(
        'LANGUAGE_NOT_AVAILABLE',
        `Language "${language.code}" is not configured for this unit's country market (§35 — per-country language exposure)`
      )
    }
  }
  target.languageId = language.id

  // ---------- The OPTIONAL §6 exam anchor (authoring context, not identity) ----------
  let examVersionId: string | null = null
  let examAnchorLabel: string | null = null
  if (input.examSlug && input.examVersionLabel) {
    const exam = await db.exam.findUnique({
      where: { slug: input.examSlug.toLowerCase() },
      include: { country: true },
    })
    if (!exam) {
      throw new QuestionError('EXAM_VERSION_NOT_FOUND', `Unknown exam "${input.examSlug}"`)
    }
    const version = await db.examVersion.findFirst({
      where: { examId: exam.id, label: input.examVersionLabel },
    })
    if (!version) {
      throw new QuestionError(
        'EXAM_VERSION_NOT_FOUND',
        `Exam "${exam.slug}" has no version labelled "${input.examVersionLabel}"`
      )
    }
    if (exam.status !== 'ACTIVE') {
      throw new QuestionError(
        'EXAM_NOT_ACTIVE',
        `Exam "${exam.name}" is ${exam.status} — questions can only be anchored to ACTIVE exams`
      )
    }
    // §14 country rule: a COUNTRY-scoped unit may only anchor to its OWN
    // country's exams (an Indian unit assessed by a UK exam is a scope
    // breach). GLOBAL units may anchor to any country's exam — global
    // knowledge serves every market's syllabi.
    if (anchorScope === 'COUNTRY' && exam.countryId !== unit.countryId) {
      throw new QuestionError(
        'EXAM_COUNTRY_MISMATCH',
        `This unit is scoped to the unit's own country — its questions cannot anchor to another country's exam (§14)`
      )
    }
    examVersionId = version.id
    examAnchorLabel = `${exam.slug}/${version.label}`
  }

  // Object-level scope: the Question inherits its unit's country scope, and a
  // language-scoped WRITER may only author in their language (§20).
  if (!can(actor, 'question:manage', target)) {
    const reason =
      actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER'
        ? anchorScope === 'GLOBAL'
          ? 'GLOBAL_QUESTION_ADMIN_ONLY'
          : actor.role === 'WRITER' && actor.languageScopeId && language.id !== actor.languageScopeId
            ? 'LANGUAGE_SCOPE'
            : 'COUNTRY_MISMATCH'
        : 'ROLE'
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.questionDenied,
      objectType: AUDIT_OBJECT_TYPES.question,
      objectId: null,
      objectLabel: `${unit.slug}/${language.code}/Question`,
      before: { unitScope: anchorScope },
      metadata: { attemptedOperation: 'create', reason },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    if ((actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') && anchorScope === 'GLOBAL') {
      throw new QuestionError(
        'GLOBAL_QUESTION_ADMIN_ONLY',
        'Country-scoped staff can only author questions for their own country\u2019s records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      language.id !== actor.languageScopeId
    ) {
      throw new QuestionError(
        'LANGUAGE_SCOPE',
        'You are language-scoped to your assigned language (§20 explicit staff scopes) — this question is outside it'
      )
    }
    throw new QuestionError(
      'COUNTRY_MISMATCH',
      'You can only author questions for your own country\u2019s records'
    )
  }

  // §23 shape re-check on the exact strings (zod validated the schema; this
  // is the domain rule with the §37 friendly message).
  const questionCheck = questionFitsQuestion(input.questionText)
  if (!questionCheck.ok) throw new QuestionError('OPTIONS_INVALID', questionCheck.message)
  const shapeCheck = mcqShapeFits(input.options, input.correctIndex)
  if (!shapeCheck.ok) throw new QuestionError('OPTIONS_INVALID', shapeCheck.message)
  const explanationCheck = explanationFitsQuestion(input.explanation)
  if (!explanationCheck.ok) throw new QuestionError('EXPLANATION_INVALID', explanationCheck.message)

  // §7/§11 identity: within one unit × language, the QUESTION TEXT identifies
  // exactly one Question. The DB constraint is authoritative; this check
  // gives the friendly §37 error.
  const existing = await db.question.findFirst({
    where: {
      knowledgeUnitId: unit.id,
      languageId: language.id,
      questionText: input.questionText,
    },
    select: { id: true, status: true },
  })
  if (existing) {
    throw new QuestionError(
      'QUESTION_EXISTS',
      `This exact question already exists for this unit in "${language.code}" (status: ${existing.status}) — one Question per unit + language + question text (§11). Re-word the question or edit the existing entry.`
    )
  }

  const created = await db.question.create({
    data: {
      knowledgeUnitId: unit.id,
      examVersionId,
      languageId: language.id,
      status: 'DRAFT',
      type: 'MCQ',
      difficulty: input.difficulty,
      questionText: input.questionText,
      optionsJson: serializeOptions(input.options),
      correctAnswer: OPTION_KEYS[input.correctIndex] ?? String(input.correctIndex),
      explanation: input.explanation,
      aiAssisted: input.aiAssisted ?? false,
      createdById: actor.userId,
    },
    include: QUESTION_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.questionCreate,
    objectType: AUDIT_OBJECT_TYPES.question,
    objectId: created.id,
    objectLabel: `${unit.slug}/${language.code}/Question`,
    after: snapshotOf(created),
    metadata: {
      unitSlug: unit.slug,
      languageCode: language.code,
      examAnchor: examAnchorLabel,
      difficulty: input.difficulty,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminQuestion(actor, created)
}

export async function updateQuestion(
  actor: Actor,
  id: string,
  input: UpdateQuestionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminQuestionEntry> {
  const question = await loadQuestion(id)
  if (!question) throw new QuestionError('QUESTION_NOT_FOUND', 'Question not found')
  assertCanManageQuestion(actor, question, 'update', meta)

  const editability = QUESTION_EDITABILITY[question.status as QuestionStatusPublic]
  if (editability === 'none') {
    if (question.status === 'RETIRED') {
      throw new QuestionError(
        'STATE_LOCKED',
        'Retired questions are read-only (§36) — create a new entry if the content is needed again'
      )
    }
    throw new QuestionError(
      'STATE_LOCKED',
      'Scheduled questions are locked — what was reviewed is what publishes (§19). Send it back to draft to edit.'
    )
  }

  // Working-copy merge + §23 rules (the question is identity — immutable;
  // anchors are create-time decisions, §7).
  const options = input.options ?? parseOptions(question.optionsJson).map((option) => option.text)
  const correctIndex =
    input.correctIndex ??
    Math.max(
      0,
      parseOptions(question.optionsJson).findIndex((option) => option.key === question.correctAnswer)
    )
  const shapeCheck = mcqShapeFits(options, correctIndex)
  if (!shapeCheck.ok) throw new QuestionError('OPTIONS_INVALID', shapeCheck.message)
  const explanation = input.explanation ?? question.explanation
  const explanationCheck = explanationFitsQuestion(explanation)
  if (!explanationCheck.ok) {
    throw new QuestionError('EXPLANATION_INVALID', explanationCheck.message)
  }

  const before = snapshotOf(question)
  const updated = await db.question.update({
    where: { id: question.id },
    data: {
      ...(input.options !== undefined ? { optionsJson: serializeOptions(input.options) } : {}),
      ...(input.options !== undefined || input.correctIndex !== undefined
        ? { correctAnswer: OPTION_KEYS[correctIndex] ?? String(correctIndex) }
        : {}),
      ...(input.explanation !== undefined ? { explanation: input.explanation } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.aiAssisted !== undefined ? { aiAssisted: input.aiAssisted } : {}),
    },
    include: QUESTION_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.questionUpdate,
    objectType: AUDIT_OBJECT_TYPES.question,
    objectId: question.id,
    objectLabel: questionLabel(question),
    before,
    after: snapshotOf(updated),
    metadata: {
      changedFields: Object.keys(input),
      note:
        question.status === 'PUBLISHED'
          ? 'Working-copy edit — staged, not public. Public reads serve the live revision until a new revision is published (§36).'
          : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminQuestion(actor, updated)
}

export async function transitionQuestion(
  actor: Actor,
  id: string,
  input: QuestionTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminQuestionEntry> {
  const question = await loadQuestion(id)
  if (!question) throw new QuestionError('QUESTION_NOT_FOUND', 'Question not found')
  assertCanManageQuestion(actor, question, `transition:${input.action}`, meta)

  // §18 editorial gate: publish/schedule/retire are editorial decisions —
  // the Question/Test-Author class creates, edits and submits, but never
  // publishes. Denied here with an audit trail (§20/§30).
  if (
    QUESTION_PUBLISH_GATED_ACTIONS.has(input.action) &&
    !can(actor, 'question:publish', { countryId: targetOfQuestion(question).countryId })
  ) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.questionDenied,
      objectType: AUDIT_OBJECT_TYPES.question,
      objectId: question.id,
      objectLabel: questionLabel(question),
      before: { status: question.status },
      metadata: {
        attemptedOperation: `transition:${input.action}`,
        reason: 'PUBLISH_NOT_PERMITTED',
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new QuestionError(
      'PUBLISH_NOT_PERMITTED',
      'Question authors create and edit entries but cannot publish (§18) — ask an editor to publish, schedule or retire'
    )
  }

  const status = question.status as QuestionStatusPublic
  const target = QUESTION_TRANSITIONS[status][input.action]
  if (!target) {
    throw new QuestionError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${status}`
    )
  }

  // ---------- publish: append an immutable revision (§19/§36) ----------
  if (input.action === 'publish') {
    // The anchor publish gate — VERIFIED unit (§7): a Question is never more
    // visible than its record.
    if (question.knowledgeUnit.status !== 'VERIFIED') {
      throw new QuestionError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${question.knowledgeUnit.status} — questions can only be published on VERIFIED units`
      )
    }
    const explanationCheck = explanationFitsQuestion(question.explanation)
    if (!explanationCheck.ok) {
      throw new QuestionError('EXPLANATION_INVALID', explanationCheck.message)
    }

    const isRepublish = question.publishedRevisionId != null
    if (isRepublish && question.publishedRevision) {
      if (!input.changeSummary?.trim()) {
        throw new QuestionError(
          'CHANGE_SUMMARY_REQUIRED',
          'Publishing a new revision of a live question requires a change summary (§25/§36 — corrections are never silent)'
        )
      }
      const unchanged =
        question.optionsJson === question.publishedRevision.optionsJson &&
        question.correctAnswer === question.publishedRevision.correctAnswer &&
        question.explanation === question.publishedRevision.explanation &&
        question.difficulty === question.publishedRevision.difficulty
      if (unchanged) {
        throw new QuestionError(
          'NO_CHANGES',
          'The working copy is identical to the live revision — nothing to publish'
        )
      }
    }

    // Append revision N+1 and move the live pointer atomically. The unique
    // (questionId, revisionNumber) guards against concurrent double-publish.
    const nextNumber = await db.$transaction(async (tx) => {
      const aggregate = await tx.questionRevision.aggregate({
        where: { questionId: question.id },
        _max: { revisionNumber: true },
      })
      const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
      const revision = await tx.questionRevision.create({
        data: {
          questionId: question.id,
          revisionNumber,
          questionText: question.questionText,
          optionsJson: question.optionsJson,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          difficulty: question.difficulty,
          // §24/§26 — the revision freezes the AI-provenance flag at publish time.
          aiAssisted: question.aiAssisted,
          changeSummary: input.changeSummary?.trim() ?? null,
          publishedById: actor.userId,
        },
      })
      await tx.question.update({
        where: { id: question.id },
        data: {
          status: 'PUBLISHED',
          publishedRevisionId: revision.id,
          scheduledForAt: null, // publishing (incl. publish-now from SCHEDULED) clears the marker
        },
      })
      // §19 wiring: resolve the Question's open work items inside the same
      // transaction so board state never lags content state.
      await wireQuestionWorkflow(tx, {
        action: 'publish',
        actorId: actor.userId,
        question: workflowQuestionOf(question),
      })
      return revisionNumber
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.questionTransition,
      objectType: AUDIT_OBJECT_TYPES.question,
      objectId: question.id,
      objectLabel: questionLabel(question),
      before: { status: question.status, liveRevision: question.publishedRevision?.revisionNumber ?? null },
      after: { status: 'PUBLISHED', revision: nextNumber },
      metadata: {
        action: 'publish',
        revisionNumber: nextNumber,
        changeSummary: input.changeSummary?.trim() ?? null,
        republished: isRepublish,
        aiAssisted: question.aiAssisted,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    // §17: a published/republished Question re-projects the unit's documents —
    // its question + options text folds into the unit's per-language
    // bodyText (the QnA-fold precedent), so question-phrased queries find
    // the unit page.
    await onUnitChanged(question.knowledgeUnit.slug)

    const refreshed = await loadQuestion(question.id)
    return toAdminQuestion(actor, refreshed!)
  }

  // ---------- schedule: approve for future release (§19 step 7) ----------
  if (input.action === 'schedule') {
    const when = input.scheduledFor ? new Date(input.scheduledFor) : null
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new QuestionError(
        'SCHEDULED_FOR_REQUIRED',
        'A valid future release time is required to schedule a question (§19 step 7)'
      )
    }
    // The same anchor publish gate as publish (§7/§36).
    if (question.knowledgeUnit.status !== 'VERIFIED') {
      throw new QuestionError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${question.knowledgeUnit.status} — only VERIFIED units' questions can be scheduled`
      )
    }
    const explanationCheck = explanationFitsQuestion(question.explanation)
    if (!explanationCheck.ok) {
      throw new QuestionError('EXPLANATION_INVALID', explanationCheck.message)
    }

    const updatedSchedule = await db.$transaction(async (tx) => {
      const row = await tx.question.update({
        where: { id: question.id },
        data: { status: 'SCHEDULED', scheduledForAt: when },
        include: QUESTION_INCLUDE,
      })
      // §19 wiring: the review cycle is complete (approval happened here);
      // open work items resolve as "scheduled".
      await wireQuestionWorkflow(tx, {
        action: 'schedule',
        actorId: actor.userId,
        question: workflowQuestionOf(question),
      })
      return row
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.questionTransition,
      objectType: AUDIT_OBJECT_TYPES.question,
      objectId: question.id,
      objectLabel: questionLabel(question),
      before: { status: question.status },
      after: { status: 'SCHEDULED', scheduledFor: when.toISOString() },
      metadata: { action: 'schedule', scheduledFor: when.toISOString() },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    return toAdminQuestion(actor, updatedSchedule)
  }

  // ---------- simple transitions (submit_review / send_back / retire) ----------
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.question.update({
      where: { id: question.id },
      data: {
        status: target,
        // send_back from SCHEDULED cancels the pending release (§19).
        ...(input.action === 'send_back' ? { scheduledForAt: null } : {}),
      },
      include: QUESTION_INCLUDE,
    })
    // §19 wiring: submit_review opens the review task; send_back resolves the
    // cycle; retire cancels open work — all inside the same transaction.
    await wireQuestionWorkflow(tx, {
      action: input.action,
      actorId: actor.userId,
      question: workflowQuestionOf(question),
    })
    return row
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.questionTransition,
    objectType: AUDIT_OBJECT_TYPES.question,
    objectId: question.id,
    objectLabel: questionLabel(question),
    before: { status: question.status },
    after: {
      status: target,
      ...(input.action === 'send_back' && question.scheduledForAt
        ? { scheduledForCleared: question.scheduledForAt.toISOString() }
        : {}),
    },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // §17/§19 step 10: retiring withdraws a public Question — the unit's
  // documents re-project (the folded question text leaves bodyText).
  if (input.action === 'retire') {
    await onUnitChanged(question.knowledgeUnit.slug)
  }

  return toAdminQuestion(actor, updated)
}
