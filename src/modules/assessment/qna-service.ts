/**
 * GlobIQ — Assessment: QnA domain service (P7-S1)
 * Master Plan §6 (QnA row), §7 (a QnA REPRESENTS a canonical KnowledgeUnit —
 * the fact is never re-entered, only rendered as question + explanatory
 * answer), §19 (the editorial workflow: submit → review → publish/schedule,
 * every transition audited, published content immutable at the revision
 * level), §22 (the knowledge page's QnA layer — the practice step between
 * learn and revise), §23 ("explanatory, unscored" — no options, no scoring,
 * no timing; that schema belongs to the Question entity, P7-S2), §24/§26
 * (AI-provenance: QnA is a named §26 AI candidate format — the flag rides
 * the working copy and freezes onto each published revision), §35 (language
 * exposure is per-country, enforced server-side), §14/§15 (country scope
 * inherited from the owning unit — a QnA is never more visible than its
 * record), §36 (revisions preserve previous versions; corrections carry
 * changeSummary; RETIRED is read-only end-of-life), §37 (service-boundary
 * authorization, deterministic ordering, explicit typed errors), §38
 * (scoped admin reads), §17 (search: published QnA text folds into the
 * unit's documents via onUnitChanged — the P6-S3 entity-fold precedent),
 * §43 (P7-S1 scope).
 *
 * Architecture (the ContentItem twin): questionText/answerBody on QnA are
 * the WORKING COPY (editorial staging); public reads ALWAYS serve the live
 * QnARevision snapshot — staged corrections stay invisible until a new
 * revision publishes. The question text is create-time identity (§11):
 * re-wording a question is a NEW QnA, never a silent edit of a live one.
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
import { wireQnaWorkflow } from '@/modules/editorial'

import type {
  AdminQnaEntry,
  AdminQnaListResult,
  AdminQnaRevisionListResult,
  PublicQnaEntry,
  PublicQnaLayer,
  QnaRevisionRef,
  QnaStatusPublic,
  QnaTransitionAction,
} from './qna-types'
import { QNA_EDITABILITY, QNA_PUBLISH_GATED_ACTIONS, QNA_TRANSITIONS } from './qna-types'
import type {
  AdminQnaListQuery,
  CreateQnaInput,
  QnaTransitionInput,
  UpdateQnaInput,
} from './qna-validation'
import { answerFitsQna } from './qna-validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type QnaErrorCode =
  | 'QNA_NOT_FOUND'
  | 'QNA_NOT_VISIBLE'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_ARCHIVED'
  | 'UNIT_NOT_VERIFIED'
  | 'QNA_EXISTS'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'NO_CHANGES'
  | 'ANSWER_BODY_INVALID'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_QNA_ADMIN_ONLY'
  | 'LANGUAGE_SCOPE'
  | 'PUBLISH_NOT_PERMITTED'
  | 'SCHEDULED_FOR_REQUIRED'

const ERROR_STATUS: Record<QnaErrorCode, number> = {
  QNA_NOT_FOUND: 404,
  QNA_NOT_VISIBLE: 404,
  UNIT_NOT_FOUND: 404,
  UNIT_ARCHIVED: 400,
  UNIT_NOT_VERIFIED: 409,
  QNA_EXISTS: 409,
  LANGUAGE_NOT_FOUND: 404,
  LANGUAGE_NOT_AVAILABLE: 400,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  CHANGE_SUMMARY_REQUIRED: 400,
  NO_CHANGES: 409,
  ANSWER_BODY_INVALID: 400,
  COUNTRY_MISMATCH: 403,
  GLOBAL_QNA_ADMIN_ONLY: 403,
  LANGUAGE_SCOPE: 403,
  PUBLISH_NOT_PERMITTED: 403,
  SCHEDULED_FOR_REQUIRED: 400,
}

export class QnaError extends Error {
  readonly code: QnaErrorCode
  readonly status: number

  constructor(code: QnaErrorCode, message: string) {
    super(message)
    this.name = 'QnaError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown QnaError to envelope data (§37); null for others. */
export function toQnaErrorResponse(
  error: unknown
): { message: string; code: QnaErrorCode; status: number } | null {
  if (error instanceof QnaError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

type QnaRow = Prisma.QnAGetPayload<{
  include: {
    knowledgeUnit: true
    language: true
    publishedRevision: { include: { publishedBy: true } }
    _count: { select: { revisions: true } }
  }
}>

const QNA_INCLUDE = {
  knowledgeUnit: true,
  language: true,
  publishedRevision: { include: { publishedBy: true } },
  _count: { select: { revisions: true } },
} satisfies Prisma.QnAInclude

async function loadUnitByRef(ref: string) {
  return db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
}

async function loadQna(id: string): Promise<QnaRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.qnA.findUnique({
    where: { id },
    include: QNA_INCLUDE,
  })
}

/** A QnA's permission target: the OWNING unit's country scope (§14) plus the
 * QnA's language (the §20 WRITER language-scope dimension). */
function targetOfQna(
  qna: QnaRow
): { countryId: string | null; languageId: string } {
  return {
    countryId: qna.knowledgeUnit.scope === 'COUNTRY' ? qna.knowledgeUnit.countryId : null,
    languageId: qna.languageId,
  }
}

/** The §19 workflow event payload for a QnA (task wiring). */
function workflowQnaOf(qna: QnaRow) {
  return {
    id: qna.id,
    unitSlug: qna.knowledgeUnit.slug,
    countryId:
      qna.knowledgeUnit.scope === 'COUNTRY' ? qna.knowledgeUnit.countryId : null,
    languageId: qna.languageId,
    languageCode: qna.language.code,
    questionText: qna.questionText,
  }
}

/** Working-copy snapshot for audit before/after (redaction truncates bodies). */
function snapshotOf(qna: QnaRow) {
  return {
    unitSlug: qna.knowledgeUnit.slug,
    languageCode: qna.language.code,
    status: qna.status,
    questionText: qna.questionText,
    answerBody: qna.answerBody,
    aiAssisted: qna.aiAssisted,
    liveRevision: qna.publishedRevision
      ? { number: qna.publishedRevision.revisionNumber, question: qna.publishedRevision.questionText }
      : null,
  }
}

/** Stable object label for audit rows (§36 accountability). */
function qnaLabel(qna: QnaRow): string {
  return `${qna.knowledgeUnit.slug}/${qna.language.code}/QnA`
}

/** Object-level permission check + denial audit (§20 signal — the content pattern). */
function assertCanManageQna(
  actor: Actor,
  qna: QnaRow,
  operation: string,
  meta?: AuditRequestMeta
): void {
  const target = targetOfQna(qna)
  if (can(actor, 'qna:manage', target)) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.qnaDenied,
    objectType: AUDIT_OBJECT_TYPES.qna,
    objectId: qna.id,
    objectLabel: qnaLabel(qna),
    before: { status: qna.status, unitScope: qna.knowledgeUnit.scope },
    metadata: {
      attemptedOperation: operation,
      reason: qnaDenialReason(actor, qna),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (qna.knowledgeUnit.scope === 'GLOBAL') {
      throw new QnaError(
        'GLOBAL_QNA_ADMIN_ONLY',
        'Country-scoped staff cannot manage Q&A on global records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      qna.languageId !== actor.languageScopeId
    ) {
      throw new QnaError(
        'LANGUAGE_SCOPE',
        'This Q&A entry is outside your language scope (§20 explicit staff scopes)'
      )
    }
    throw new QnaError(
      'COUNTRY_MISMATCH',
      'You can only manage Q&A for your own country'
    )
  }
  throw new QnaError('COUNTRY_MISMATCH', 'You do not have permission to manage this Q&A entry')
}

function qnaDenialReason(actor: Actor, qna: QnaRow): string {
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (qna.knowledgeUnit.scope === 'GLOBAL') return 'GLOBAL_QNA_ADMIN_ONLY'
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      qna.languageId !== actor.languageScopeId
    ) {
      return 'LANGUAGE_SCOPE'
    }
    return 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/**
 * Admin read access (content parity): ADMIN sees all; COUNTRY_ADMIN and
 * WRITER see global (read-only) + own-country Q&A — a writer's language
 * scope narrows only what they may MANAGE, not what they may read.
 */
function canReadQna(actor: Actor, qna: QnaRow): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    return (
      qna.knowledgeUnit.scope === 'GLOBAL' ||
      qna.knowledgeUnit.countryId === actor.countryId
    )
  }
  return false
}

function toRevisionRef(
  revision: Prisma.QnARevisionGetPayload<{ include: { publishedBy: true } }>
): QnaRevisionRef {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    questionText: revision.questionText,
    answerBody: revision.answerBody,
    changeSummary: revision.changeSummary,
    aiAssisted: revision.aiAssisted,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy?.email ?? null,
  }
}

async function toAdminQna(actor: Actor, qna: QnaRow): Promise<AdminQnaEntry> {
  const topic = await getTopicIdentity(qna.knowledgeUnit.topicId)
  const target = targetOfQna(qna)
  const canManage = can(actor, 'qna:manage', target)
  // §18 editorial gate: publish-class affordances only for qna:publish
  // holders (ADMIN + COUNTRY_ADMIN — writers never see them).
  const canPublish = can(actor, 'qna:publish', { countryId: target.countryId })
  const editability = QNA_EDITABILITY[qna.status as QnaStatusPublic]
  const machineTransitions = Object.keys(
    QNA_TRANSITIONS[qna.status as QnaStatusPublic]
  ) as QnaTransitionAction[]
  const transitions = machineTransitions.filter(
    (action) => !QNA_PUBLISH_GATED_ACTIONS.has(action) || canPublish
  )
  const anchorPublishable = qna.knowledgeUnit.status === 'VERIFIED'
  return {
    id: qna.id,
    status: qna.status as QnaStatusPublic,
    language: {
      code: qna.language.code,
      name: qna.language.name,
      nativeName: qna.language.nativeName,
    },
    questionText: qna.questionText,
    answerBody: qna.answerBody,
    unit: {
      id: qna.knowledgeUnit.id,
      slug: qna.knowledgeUnit.slug,
      canonicalName: qna.knowledgeUnit.canonicalName,
      status: qna.knowledgeUnit.status,
      scope: qna.knowledgeUnit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso:
        qna.knowledgeUnit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
      topicSlug: topic?.slug ?? null,
    },
    liveRevision: qna.publishedRevision ? toRevisionRef(qna.publishedRevision) : null,
    revisionCount: qna._count.revisions,
    aiAssisted: qna.aiAssisted,
    scheduledFor: qna.scheduledForAt?.toISOString() ?? null,
    createdAt: qna.createdAt.toISOString(),
    updatedAt: qna.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    // Affordances from server truth (§20) — non-managers see none; writers
    // never see publish-class actions (§18).
    allowedTransitions: canManage ? transitions : [],
    // The anchor publish gate — VERIFIED unit (§7): a QnA is never more
    // visible than its record.
    anchorPublishable,
    anchorBlockReason: anchorPublishable
      ? null
      : `The owning unit is ${qna.knowledgeUnit.status} — Q&A can only be published on VERIFIED units (§7)`,
  }
}

// ---------- §19 step 7: scheduled-release materialization ----------

/**
 * Publishes ONE due SCHEDULED QnA atomically — the ContentItem twin. The
 * conditional claim (`updateMany` on status + time) makes concurrent reads
 * safe; the published answer is the locked working copy — exactly what
 * review approved (§19).
 */
async function materializeScheduledQna(qnaId: string): Promise<void> {
  const qna = await loadQna(qnaId)
  if (
    !qna ||
    qna.status !== 'SCHEDULED' ||
    !qna.scheduledForAt ||
    qna.scheduledForAt.getTime() > Date.now()
  ) {
    return
  }
  // §14 guard: a QnA is never more visible than its record — the owning unit
  // must still be VERIFIED. A unit that lost verification between approval
  // and release holds the QnA in SCHEDULED until the anchor reopens (§36).
  if (qna.knowledgeUnit.status !== 'VERIFIED') return

  const nextNumber = await db.$transaction(async (tx) => {
    const claimed = await tx.qnA.updateMany({
      where: {
        id: qna.id,
        status: 'SCHEDULED',
        scheduledForAt: { lte: new Date() },
      },
      data: { status: 'PUBLISHED', scheduledForAt: null },
    })
    if (claimed.count === 0) return null // a concurrent read materialized it
    const aggregate = await tx.qnARevision.aggregate({
      where: { qnaId: qna.id },
      _max: { revisionNumber: true },
    })
    const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
    const revision = await tx.qnARevision.create({
      data: {
        qnaId: qna.id,
        revisionNumber,
        questionText: qna.questionText,
        answerBody: qna.answerBody,
        aiAssisted: qna.aiAssisted,
        changeSummary: 'Scheduled release (§19 step 7) — published automatically at the scheduled time',
        publishedById: null, // system publish
      },
    })
    await tx.qnA.update({
      where: { id: qna.id },
      data: { publishedRevisionId: revision.id },
    })
    await wireQnaWorkflow(tx, {
      action: 'publish',
      actorId: null,
      qna: workflowQnaOf(qna),
    })
    return revisionNumber
  })
  if (nextNumber == null) return

  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.qnaTransition,
    objectType: AUDIT_OBJECT_TYPES.qna,
    objectId: qna.id,
    objectLabel: qnaLabel(qna),
    before: { status: 'SCHEDULED', scheduledFor: qna.scheduledForAt.toISOString() },
    after: { status: 'PUBLISHED', revision: nextNumber },
    metadata: { action: 'publish', scheduled: true, materialized: 'lazy-read' },
  })

  // §17: the scheduled release just enriched a public surface — the unit's
  // documents re-project now (QnA text folds into bodyText), not on the
  // next full reindex.
  await onUnitChanged(qna.knowledgeUnit.slug)
}

/**
 * Publishes due SCHEDULED QnAs lazily — the modular monolith's scheduler is
 * "the first read after the scheduled time". Public and admin reads both
 * call this, scoped to what they are reading (§37).
 */
export async function materializeDueScheduledQna(
  scope?: { unitId?: string; qnaId?: string }
): Promise<void> {
  const due = await db.qnA.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledForAt: { lte: new Date() },
      ...(scope?.unitId ? { knowledgeUnitId: scope.unitId } : {}),
      ...(scope?.qnaId ? { id: scope.qnaId } : {}),
    },
    select: { id: true },
    take: 25, // bounded per read
  })
  for (const row of due) await materializeScheduledQna(row.id)
}

// ---------- Public reads (the §22 knowledge-page QnA layer) ----------

/**
 * The published Q&A of one unit in one language — ALWAYS live revision
 * snapshots, deterministically ordered (§37). Called by the knowledge
 * render-service after its own visibility chain has already validated the
 * unit + locale; the layer is additive and never bypasses that chain.
 */
export async function getPublicQnaLayer(input: {
  unitId: string
  languageId: string
}): Promise<PublicQnaLayer> {
  // §19 step 7: due scheduled releases go live before assembling the layer.
  await materializeDueScheduledQna({ unitId: input.unitId })

  const rows = await db.qnA.findMany({
    where: {
      knowledgeUnitId: input.unitId,
      languageId: input.languageId,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
    },
    include: QNA_INCLUDE,
  })

  const entries: PublicQnaEntry[] = rows
    .filter((row) => row.publishedRevision != null)
    .map((row) => ({
      id: row.id,
      question: row.publishedRevision!.questionText,
      answer: row.publishedRevision!.answerBody,
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
    // Deterministic (§37): by revision number, then question text.
    .sort(
      (a, b) =>
        a.revision.publishedAt.localeCompare(b.revision.publishedAt) ||
        a.question.localeCompare(b.question)
    )

  return entries.length > 0
    ? { available: true, entries, note: null }
    : {
        available: false,
        entries: [],
        note: 'No published Q&A for this unit in this language yet — editorial entries appear here the moment they are published (§22).',
      }
}

// ---------- Admin reads ----------

export async function getAdminQnas(
  actor: Actor,
  query: AdminQnaListQuery
): Promise<AdminQnaListResult> {
  assertCan(actor, 'qna:manage')

  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledQna()

  let unitId: string | undefined
  if (query.unit) {
    const unit = await loadUnitByRef(query.unit)
    if (!unit) throw new QnaError('UNIT_NOT_FOUND', `Unknown unit "${query.unit}"`)
    unitId = unit.id
  }

  let languageId: string | undefined
  if (query.language) {
    const language = await findActiveLanguageByCode(query.language)
    if (!language) throw new QnaError('LANGUAGE_NOT_FOUND', `Unknown language "${query.language}"`)
    languageId = language.id
  }

  // COUNTRY_ADMIN + WRITER: global (read-only) + own-country Q&A — content parity.
  const scopeFilter: Prisma.QnAWhereInput | undefined =
    actor.role === 'ADMIN'
      ? undefined
      : {
          knowledgeUnit: {
            OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }],
          },
        }

  const where: Prisma.QnAWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(unitId ? { knowledgeUnitId: unitId } : {}),
    ...(languageId ? { languageId } : {}),
    ...(query.q
      ? {
          OR: [
            { questionText: { contains: query.q, mode: 'insensitive' } },
            { answerBody: { contains: query.q, mode: 'insensitive' } },
            { knowledgeUnit: { canonicalName: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(scopeFilter ? scopeFilter : {}),
  }

  const [rows, total, summaryRows] = await Promise.all([
    db.qnA.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: QNA_INCLUDE,
    }),
    db.qnA.count({ where }),
    db.qnA.groupBy({
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

  const items: AdminQnaEntry[] = []
  for (const row of rows) {
    if (canReadQna(actor, row)) items.push(await toAdminQna(actor, row))
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

export async function getAdminQna(actor: Actor, id: string): Promise<AdminQnaEntry> {
  assertCan(actor, 'qna:manage')
  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledQna({ qnaId: id })
  const qna = await loadQna(id)
  if (!qna) throw new QnaError('QNA_NOT_FOUND', 'Q&A entry not found')
  if (!canReadQna(actor, qna)) {
    throw new QnaError(
      'COUNTRY_MISMATCH',
      'You can only view global Q&A and your own country Q&A'
    )
  }
  return toAdminQna(actor, qna)
}

/** Full revision history of one QnA — the §36 preserved versions (admin). */
export async function listQnaRevisions(
  actor: Actor,
  qnaId: string
): Promise<AdminQnaRevisionListResult> {
  assertCan(actor, 'qna:manage')
  const qna = await loadQna(qnaId)
  if (!qna) throw new QnaError('QNA_NOT_FOUND', 'Q&A entry not found')
  if (!canReadQna(actor, qna)) {
    throw new QnaError(
      'COUNTRY_MISMATCH',
      'You can only view revisions of global Q&A and your own country Q&A'
    )
  }

  const revisions = await db.qnARevision.findMany({
    where: { qnaId: qna.id },
    orderBy: { revisionNumber: 'desc' }, // deterministic (§37)
    include: { publishedBy: true },
  })

  return {
    qnaId: qna.id,
    unit: { slug: qna.knowledgeUnit.slug, canonicalName: qna.knowledgeUnit.canonicalName },
    language: { code: qna.language.code, name: qna.language.name },
    revisions: revisions.map(toRevisionRef),
  }
}

// ---------- Admin writes ----------

export async function createQna(
  actor: Actor,
  input: CreateQnaInput,
  meta: AuditRequestMeta = {}
): Promise<AdminQnaEntry> {
  assertCan(actor, 'qna:manage')

  // ---------- The canonical anchor (§7 — KnowledgeUnit only, §6) ----------
  const unit = await loadUnitByRef(input.unit)
  if (!unit) throw new QnaError('UNIT_NOT_FOUND', `Unknown knowledge unit "${input.unit}"`)
  if (unit.status === 'ARCHIVED') {
    throw new QnaError(
      'UNIT_ARCHIVED',
      'Archived units cannot receive new Q&A — create a new unit instead (§36)'
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
    throw new QnaError('LANGUAGE_NOT_FOUND', `Unknown or inactive language "${input.language}"`)
  }
  if (anchorScope === 'COUNTRY' && unit.countryId) {
    const configured = await isLanguageConfiguredForCountry(unit.countryId, language.id)
    if (!configured) {
      throw new QnaError(
        'LANGUAGE_NOT_AVAILABLE',
        `Language "${language.code}" is not configured for this unit's country market (§35 — per-country language exposure)`
      )
    }
  }
  target.languageId = language.id

  // Object-level scope: the QnA inherits its unit's country scope, and a
  // language-scoped WRITER may only author in their language (§20).
  if (!can(actor, 'qna:manage', target)) {
    const reason =
      actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER'
        ? anchorScope === 'GLOBAL'
          ? 'GLOBAL_QNA_ADMIN_ONLY'
          : actor.role === 'WRITER' && actor.languageScopeId && language.id !== actor.languageScopeId
            ? 'LANGUAGE_SCOPE'
            : 'COUNTRY_MISMATCH'
        : 'ROLE'
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.qnaDenied,
      objectType: AUDIT_OBJECT_TYPES.qna,
      objectId: null,
      objectLabel: `${unit.slug}/${language.code}/QnA`,
      before: { unitScope: anchorScope },
      metadata: { attemptedOperation: 'create', reason },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    if ((actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') && anchorScope === 'GLOBAL') {
      throw new QnaError(
        'GLOBAL_QNA_ADMIN_ONLY',
        'Country-scoped staff can only author Q&A for their own country\u2019s records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      language.id !== actor.languageScopeId
    ) {
      throw new QnaError(
        'LANGUAGE_SCOPE',
        'You are language-scoped to your assigned language (§20 explicit staff scopes) — this Q&A entry is outside it'
      )
    }
    throw new QnaError(
      'COUNTRY_MISMATCH',
      'You can only author Q&A for your own country\u2019s records'
    )
  }

  // §7/§11 identity: within one unit × language, the QUESTION TEXT identifies
  // exactly one QnA. The DB constraint is authoritative; this check gives the
  // friendly §37 error.
  const existing = await db.qnA.findFirst({
    where: {
      knowledgeUnitId: unit.id,
      languageId: language.id,
      questionText: input.questionText,
    },
    select: { id: true, status: true },
  })
  if (existing) {
    throw new QnaError(
      'QNA_EXISTS',
      `This exact question already exists for this unit in "${language.code}" (status: ${existing.status}) — one Q&A per unit + language + question (§11). Re-word the question or edit the existing entry.`
    )
  }

  const created = await db.qnA.create({
    data: {
      knowledgeUnitId: unit.id,
      languageId: language.id,
      status: 'DRAFT',
      questionText: input.questionText,
      answerBody: input.answerBody,
      aiAssisted: input.aiAssisted ?? false,
      createdById: actor.userId,
    },
    include: QNA_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.qnaCreate,
    objectType: AUDIT_OBJECT_TYPES.qna,
    objectId: created.id,
    objectLabel: `${unit.slug}/${language.code}/QnA`,
    after: snapshotOf(created),
    metadata: {
      unitSlug: unit.slug,
      languageCode: language.code,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminQna(actor, created)
}

export async function updateQna(
  actor: Actor,
  id: string,
  input: UpdateQnaInput,
  meta: AuditRequestMeta = {}
): Promise<AdminQnaEntry> {
  const qna = await loadQna(id)
  if (!qna) throw new QnaError('QNA_NOT_FOUND', 'Q&A entry not found')
  assertCanManageQna(actor, qna, 'update', meta)

  const editability = QNA_EDITABILITY[qna.status as QnaStatusPublic]
  if (editability === 'none') {
    if (qna.status === 'RETIRED') {
      throw new QnaError(
        'STATE_LOCKED',
        'Retired Q&A is read-only (§36) — create a new entry if the content is needed again'
      )
    }
    throw new QnaError(
      'STATE_LOCKED',
      'Scheduled Q&A is locked — what was reviewed is what publishes (§19). Send it back to draft to edit.'
    )
  }

  // Working-copy merge + §23 rules (the question is identity — immutable).
  const answer = input.answerBody ?? qna.answerBody
  const answerCheck = answerFitsQna(answer)
  if (!answerCheck.ok) {
    throw new QnaError('ANSWER_BODY_INVALID', answerCheck.message)
  }

  const before = snapshotOf(qna)
  const updated = await db.qnA.update({
    where: { id: qna.id },
    data: {
      ...(input.answerBody !== undefined ? { answerBody: input.answerBody } : {}),
      ...(input.aiAssisted !== undefined ? { aiAssisted: input.aiAssisted } : {}),
    },
    include: QNA_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.qnaUpdate,
    objectType: AUDIT_OBJECT_TYPES.qna,
    objectId: qna.id,
    objectLabel: qnaLabel(qna),
    before,
    after: snapshotOf(updated),
    metadata: {
      changedFields: Object.keys(input),
      note:
        qna.status === 'PUBLISHED'
          ? 'Working-copy edit — staged, not public. Public reads serve the live revision until a new revision is published (§36).'
          : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminQna(actor, updated)
}

export async function transitionQna(
  actor: Actor,
  id: string,
  input: QnaTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminQnaEntry> {
  const qna = await loadQna(id)
  if (!qna) throw new QnaError('QNA_NOT_FOUND', 'Q&A entry not found')
  assertCanManageQna(actor, qna, `transition:${input.action}`, meta)

  // §18 editorial gate: publish/schedule/retire are editorial decisions —
  // the Question/Test-Author class creates, edits and submits, but never
  // publishes. Denied here with an audit trail (§20/§30).
  if (
    QNA_PUBLISH_GATED_ACTIONS.has(input.action) &&
    !can(actor, 'qna:publish', { countryId: targetOfQna(qna).countryId })
  ) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.qnaDenied,
      objectType: AUDIT_OBJECT_TYPES.qna,
      objectId: qna.id,
      objectLabel: qnaLabel(qna),
      before: { status: qna.status },
      metadata: {
        attemptedOperation: `transition:${input.action}`,
        reason: 'PUBLISH_NOT_PERMITTED',
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new QnaError(
      'PUBLISH_NOT_PERMITTED',
      'Q&A authors create and edit entries but cannot publish (§18) — ask an editor to publish, schedule or retire'
    )
  }

  const status = qna.status as QnaStatusPublic
  const target = QNA_TRANSITIONS[status][input.action]
  if (!target) {
    throw new QnaError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${status}`
    )
  }

  // ---------- publish: append an immutable revision (§19/§36) ----------
  if (input.action === 'publish') {
    // The anchor publish gate — VERIFIED unit (§7): a QnA is never more
    // visible than its record.
    if (qna.knowledgeUnit.status !== 'VERIFIED') {
      throw new QnaError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${qna.knowledgeUnit.status} — Q&A can only be published on VERIFIED units`
      )
    }
    const answerCheck = answerFitsQna(qna.answerBody)
    if (!answerCheck.ok) {
      throw new QnaError('ANSWER_BODY_INVALID', answerCheck.message)
    }

    const isRepublish = qna.publishedRevisionId != null
    if (isRepublish) {
      if (!input.changeSummary?.trim()) {
        throw new QnaError(
          'CHANGE_SUMMARY_REQUIRED',
          'Publishing a new revision of live Q&A requires a change summary (§25/§36 — corrections are never silent)'
        )
      }
      if (qna.answerBody === qna.publishedRevision?.answerBody) {
        throw new QnaError(
          'NO_CHANGES',
          'The working copy is identical to the live revision — nothing to publish'
        )
      }
    }

    // Append revision N+1 and move the live pointer atomically. The unique
    // (qnaId, revisionNumber) guards against concurrent double-publish.
    const nextNumber = await db.$transaction(async (tx) => {
      const aggregate = await tx.qnARevision.aggregate({
        where: { qnaId: qna.id },
        _max: { revisionNumber: true },
      })
      const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
      const revision = await tx.qnARevision.create({
        data: {
          qnaId: qna.id,
          revisionNumber,
          questionText: qna.questionText,
          answerBody: qna.answerBody,
          // §24/§26 — the revision freezes the AI-provenance flag at publish time.
          aiAssisted: qna.aiAssisted,
          changeSummary: input.changeSummary?.trim() ?? null,
          publishedById: actor.userId,
        },
      })
      await tx.qnA.update({
        where: { id: qna.id },
        data: {
          status: 'PUBLISHED',
          publishedRevisionId: revision.id,
          scheduledForAt: null, // publishing (incl. publish-now from SCHEDULED) clears the marker
        },
      })
      // §19 wiring: resolve the QnA's open work items inside the same
      // transaction so board state never lags content state.
      await wireQnaWorkflow(tx, {
        action: 'publish',
        actorId: actor.userId,
        qna: workflowQnaOf(qna),
      })
      return revisionNumber
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.qnaTransition,
      objectType: AUDIT_OBJECT_TYPES.qna,
      objectId: qna.id,
      objectLabel: qnaLabel(qna),
      before: { status: qna.status, liveRevision: qna.publishedRevision?.revisionNumber ?? null },
      after: { status: 'PUBLISHED', revision: nextNumber },
      metadata: {
        action: 'publish',
        revisionNumber: nextNumber,
        changeSummary: input.changeSummary?.trim() ?? null,
        republished: isRepublish,
        aiAssisted: qna.aiAssisted,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    // §17: a published/republished QnA re-projects the unit's documents —
    // its question + answer text fold into the unit's per-language
    // bodyText (the P6-S3 entity-fold precedent), so question-phrased
    // queries find the unit page.
    await onUnitChanged(qna.knowledgeUnit.slug)

    const refreshed = await loadQna(qna.id)
    return toAdminQna(actor, refreshed!)
  }

  // ---------- schedule: approve for future release (§19 step 7) ----------
  if (input.action === 'schedule') {
    const when = input.scheduledFor ? new Date(input.scheduledFor) : null
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new QnaError(
        'SCHEDULED_FOR_REQUIRED',
        'A valid future release time is required to schedule Q&A (§19 step 7)'
      )
    }
    // The same anchor publish gate as publish (§7/§36).
    if (qna.knowledgeUnit.status !== 'VERIFIED') {
      throw new QnaError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${qna.knowledgeUnit.status} — only VERIFIED units' Q&A can be scheduled`
      )
    }
    const answerCheck = answerFitsQna(qna.answerBody)
    if (!answerCheck.ok) {
      throw new QnaError('ANSWER_BODY_INVALID', answerCheck.message)
    }

    const updatedSchedule = await db.$transaction(async (tx) => {
      const row = await tx.qnA.update({
        where: { id: qna.id },
        data: { status: 'SCHEDULED', scheduledForAt: when },
        include: QNA_INCLUDE,
      })
      // §19 wiring: the review cycle is complete (approval happened here);
      // open work items resolve as "scheduled".
      await wireQnaWorkflow(tx, {
        action: 'schedule',
        actorId: actor.userId,
        qna: workflowQnaOf(qna),
      })
      return row
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.qnaTransition,
      objectType: AUDIT_OBJECT_TYPES.qna,
      objectId: qna.id,
      objectLabel: qnaLabel(qna),
      before: { status: qna.status },
      after: { status: 'SCHEDULED', scheduledFor: when.toISOString() },
      metadata: { action: 'schedule', scheduledFor: when.toISOString() },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    return toAdminQna(actor, updatedSchedule)
  }

  // ---------- simple transitions (submit_review / send_back / retire) ----------
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.qnA.update({
      where: { id: qna.id },
      data: {
        status: target,
        // send_back from SCHEDULED cancels the pending release (§19).
        ...(input.action === 'send_back' ? { scheduledForAt: null } : {}),
      },
      include: QNA_INCLUDE,
    })
    // §19 wiring: submit_review opens the review task; send_back resolves the
    // cycle; retire cancels open work — all inside the same transaction.
    await wireQnaWorkflow(tx, {
      action: input.action,
      actorId: actor.userId,
      qna: workflowQnaOf(qna),
    })
    return row
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.qnaTransition,
    objectType: AUDIT_OBJECT_TYPES.qna,
    objectId: qna.id,
    objectLabel: qnaLabel(qna),
    before: { status: qna.status },
    after: {
      status: target,
      ...(input.action === 'send_back' && qna.scheduledForAt
        ? { scheduledForCleared: qna.scheduledForAt.toISOString() }
        : {}),
    },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // §17/§19 step 10: retiring withdraws a public QnA — the unit's documents
  // re-project (the folded question/answer text leaves bodyText).
  if (input.action === 'retire') {
    await onUnitChanged(qna.knowledgeUnit.slug)
  }

  return toAdminQna(actor, updated)
}
