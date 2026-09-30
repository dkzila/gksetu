// ============================================================================
// GlobIQ — Content Feedback service (P8-S3, Master Plan §25)
// ----------------------------------------------------------------------------
// The §25 quality loop, end to end:
//   1. SUBMIT — a public "Report an issue" action on any of the five §25
//      object types (anonymous-friendly, the §21 ShareEvent precedent), with
//      per-reporter duplicate folding (one OPEN report per object+reason).
//   2. ROUTE — every report opens a CORRECTION EditorialTask (§19 step 9)
//      in ONE transaction with the report row (the P8-S2 atomicity lesson),
//      scoped to the reported object's workspace (the §38 split), priority
//      seeded from the report type (§25 "prioritised by traffic/importance"
//      — traffic weighting joins with §32 analytics, P8-S4/S5 — stated).
//   3. NOTIFY — the workspace's editors hear about the report (§27
//      FEEDBACK_REPORT_RECEIVED, wired here from its P8-S2 modeled state).
//   4. RESOLVE — editors transition the report (IN_REVIEW / RESOLVED /
//      DISMISSED, the note mandatory on terminal states); resolving the
//      linked task cascades back (and vice versa) so the loop always closes
//      on both sides. Every transition is audited (§44: "auditable to
//      resolution").
//
// §25 honesty rules enforced here: report counts are NEVER public (the
// queue is editorial-only; the reporter sees only their own reports — §31),
// and reports are a quality signal, never personalisation input (§9).
// ============================================================================
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
  type AuditRequestMeta,
} from '@/modules/audit'
import { resolveLocaleContext } from '@/modules/country-locale'
import { notifyFeedbackReceived } from '@/modules/notifications'

import {
  FEEDBACK_EDITOR_TRANSITIONS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  FeedbackError,
  feedbackTypeInfo,
  type FeedbackObjectTypePublic,
  type FeedbackStatusPublic,
  type FeedbackQueue,
  type FeedbackReport,
  type FeedbackRow,
  type FeedbackStats,
  type FeedbackSubmitResult,
  type FeedbackTypePublic,
  type MyFeedbackReport,
} from './feedback-types'
import type { FeedbackQueueInput, FeedbackSubmitInput, FeedbackTransitionInput } from './feedback-validation'

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** §36-public unit statuses (the save module's rule, verbatim): VERIFIED is
 * the live truth, OUTDATED stays publicly visible while flagged for
 * correction — both are exactly the states a reader can be reading (and
 * reporting on). */
const UNIT_REPORTABLE_STATUSES: ReadonlySet<string> = new Set(['VERIFIED', 'OUTDATED'])

const REPORT_INCLUDE = {
  user: { select: { name: true, email: true } },
  resolvedBy: { select: { name: true, email: true } },
  task: { select: { id: true, status: true, resolutionNote: true, assignee: { select: { name: true } } } },
} satisfies Prisma.ContentFeedbackInclude

// ---------- Reported-object resolution (the save module's §10/§36 rules) ----------

interface ResolvedReportable {
  objectType: FeedbackObjectTypePublic
  /** The canonical row id (the SavedItem precedent — the public ref that was
   * submitted resolves to this once, at submission). */
  objectId: string
  /** Display snapshot (§36-honest — survives later edits, like a task label). */
  objectLabel: string
  languageCode: string | null
  /** The §16 canonical path in the object's OWN market (§14: country-scoped
   * objects live in their own market; GLOBAL objects in the default root). */
  objectPath: string
  /** The §38 workspace scope inherited from the anchor (null = platform). */
  countryId: string | null
  /** The task's language dimension (the representation's language). */
  languageId: string | null
}

/** §14 market prefix for an object's canonical home — the share module's
 * prefixForMarket, read-only projection (no dependency on the sharer). */
async function objectMarketPrefix(countryIso: string | undefined, languageCode: string | undefined): Promise<string> {
  const resolution = await resolveLocaleContext({ country: countryIso, language: languageCode })
  const parts: string[] = []
  if (!resolution.country.isDefault) parts.push(resolution.country.slug)
  if (!resolution.isDefaultLanguage) parts.push(resolution.language.code)
  return parts.length > 0 ? `/${parts.join('/')}` : ''
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

async function resolveReportable(input: FeedbackSubmitInput): Promise<ResolvedReportable> {
  const ref = input.objectRef.trim()

  if (input.objectType === 'KNOWLEDGE_UNIT') {
    const unit = await db.knowledgeUnit.findFirst({
      where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
      include: {
        topic: { select: { slug: true, scope: true } },
        country: { select: { isoCode: true } },
      },
    })
    if (!unit) throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'This knowledge unit does not exist', 404)
    if (!UNIT_REPORTABLE_STATUSES.has(unit.status)) {
      throw new FeedbackError(
        'FEEDBACK_OBJECT_NOT_REPORTABLE',
        unit.status === 'ARCHIVED'
          ? 'This knowledge unit is archived (end-of-life) — reports are closed on it (§36).'
          : `This knowledge unit is not publicly available yet (status: ${unit.status}).`
      )
    }
    const prefix = await objectMarketPrefix(
      unit.topic.scope === 'COUNTRY' ? unit.country?.isoCode : undefined,
      input.languageCode
    )
    return {
      objectType: 'KNOWLEDGE_UNIT',
      objectId: unit.id,
      objectLabel: unit.canonicalName,
      languageCode: input.languageCode ?? null,
      objectPath: `${prefix}/gk/${unit.topic.slug}/${unit.slug}/`,
      countryId: unit.topic.scope === 'COUNTRY' ? unit.countryId : null,
      languageId: null,
    }
  }

  if (input.objectType === 'CONTENT_ITEM') {
    // Content items have no slug (§7 identity: unit × language × format) —
    // the public representation id is the ref (the same id every knowledge
    // page exposes). Event representations are excluded (the P6-S2 save
    // rule): their public surface is the §16 event page, reported as
    // CURRENT_EVENT.
    if (!CUID_PATTERN.test(ref)) {
      throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'Content items are reported by their representation id', 404)
    }
    const item = await db.contentItem.findFirst({
      where: { id: ref, knowledgeUnitId: { not: null } },
      include: {
        language: { select: { id: true, code: true } },
        knowledgeUnit: {
          include: {
            topic: { select: { slug: true, scope: true } },
            country: { select: { isoCode: true } },
          },
        },
      },
    })
    if (!item || !item.knowledgeUnit) {
      throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'This content item does not exist', 404)
    }
    if (item.status !== 'PUBLISHED') {
      throw new FeedbackError(
        'FEEDBACK_OBJECT_NOT_REPORTABLE',
        item.status === 'RETIRED'
          ? 'This representation is retired — the report would target withdrawn content (§36).'
          : 'This representation is not published yet — it goes live through the §19 workflow first.'
      )
    }
    const unit = item.knowledgeUnit
    if (!UNIT_REPORTABLE_STATUSES.has(unit.status)) {
      throw new FeedbackError('FEEDBACK_OBJECT_NOT_REPORTABLE', 'The knowledge page behind this representation is not publicly available.')
    }
    const prefix = await objectMarketPrefix(
      unit.topic.scope === 'COUNTRY' ? unit.country?.isoCode : undefined,
      item.language.code
    )
    return {
      objectType: 'CONTENT_ITEM',
      objectId: item.id,
      objectLabel: `${unit.canonicalName} \u00b7 ${item.language.code}/${item.format}`,
      languageCode: item.language.code,
      objectPath: `${prefix}/gk/${unit.topic.slug}/${unit.slug}/`,
      countryId: unit.topic.scope === 'COUNTRY' ? unit.countryId : null,
      languageId: item.languageId,
    }
  }

  if (input.objectType === 'CURRENT_EVENT') {
    const event = await db.currentEvent.findFirst({
      where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
      include: {
        topic: { select: { slug: true, scope: true } },
        country: { select: { isoCode: true } },
      },
    })
    if (!event) throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'This current event does not exist', 404)
    // The P6-S2 page gate: an event's §16 page exists iff ≥1 published
    // representation — a report on an unrendered event has no surface.
    const publishedCount = await db.contentItem.count({
      where: { currentEventId: event.id, status: 'PUBLISHED', publishedRevisionId: { not: null } },
    })
    if (publishedCount === 0) {
      throw new FeedbackError(
        'FEEDBACK_OBJECT_NOT_REPORTABLE',
        'This event has no published coverage yet — its page goes live the moment an update publishes (§19).'
      )
    }
    const prefix = await objectMarketPrefix(
      event.topic.scope === 'COUNTRY' ? event.country?.isoCode : undefined,
      input.languageCode
    )
    return {
      objectType: 'CURRENT_EVENT',
      objectId: event.id,
      objectLabel: event.title,
      languageCode: input.languageCode ?? null,
      objectPath: `${prefix}/current-affairs/${event.slug}/`,
      countryId: event.topic.scope === 'COUNTRY' ? event.countryId : null,
      languageId: null,
    }
  }

  if (input.objectType === 'QNA') {
    if (!CUID_PATTERN.test(ref)) {
      throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'QnA entries are reported by their id', 404)
    }
    const qna = await db.qnA.findFirst({
      where: { id: ref },
      include: {
        language: { select: { id: true, code: true } },
        publishedRevision: { select: { questionText: true } },
        knowledgeUnit: {
          include: {
            topic: { select: { slug: true, scope: true } },
            country: { select: { isoCode: true } },
          },
        },
      },
    })
    if (!qna) throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'This QnA entry does not exist', 404)
    if (qna.status !== 'PUBLISHED' || !qna.publishedRevision) {
      throw new FeedbackError('FEEDBACK_OBJECT_NOT_REPORTABLE', 'This QnA entry is not published yet — it goes live through the §19 workflow first.')
    }
    const unit = qna.knowledgeUnit
    if (!UNIT_REPORTABLE_STATUSES.has(unit.status)) {
      throw new FeedbackError('FEEDBACK_OBJECT_NOT_REPORTABLE', 'The knowledge page behind this QnA entry is not publicly available.')
    }
    const prefix = await objectMarketPrefix(
      unit.topic.scope === 'COUNTRY' ? unit.country?.isoCode : undefined,
      qna.language.code
    )
    return {
      objectType: 'QNA',
      objectId: qna.id,
      objectLabel: `QnA: ${truncate(qna.publishedRevision.questionText, 90)}`,
      languageCode: qna.language.code,
      objectPath: `${prefix}/gk/${unit.topic.slug}/${unit.slug}/`,
      countryId: unit.topic.scope === 'COUNTRY' ? unit.countryId : null,
      languageId: qna.languageId,
    }
  }

  // QUESTION
  if (!CUID_PATTERN.test(ref)) {
    throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'Practice questions are reported by their id', 404)
  }
  const question = await db.question.findFirst({
    where: { id: ref },
    include: {
      language: { select: { id: true, code: true } },
      publishedRevision: { select: { questionText: true } },
      knowledgeUnit: {
        include: {
          topic: { select: { slug: true, scope: true } },
          country: { select: { isoCode: true } },
        },
      },
    },
  })
  if (!question) throw new FeedbackError('FEEDBACK_OBJECT_NOT_FOUND', 'This practice question does not exist', 404)
  if (question.status !== 'PUBLISHED' || !question.publishedRevision) {
    throw new FeedbackError(
      'FEEDBACK_OBJECT_NOT_REPORTABLE',
      question.status === 'RETIRED'
        ? 'This practice question is retired — the report would target withdrawn practice (§36).'
        : 'This practice question is not published yet — it goes live through the §19 workflow first.'
    )
  }
  const unit = question.knowledgeUnit
  if (!UNIT_REPORTABLE_STATUSES.has(unit.status)) {
    throw new FeedbackError('FEEDBACK_OBJECT_NOT_REPORTABLE', 'The knowledge page behind this question is not publicly available.')
  }
  const prefix = await objectMarketPrefix(
    unit.topic.scope === 'COUNTRY' ? unit.country?.isoCode : undefined,
    question.language.code
  )
  const unitPath = `${prefix}/gk/${unit.topic.slug}/${unit.slug}/`
  return {
    objectType: 'QUESTION',
    objectId: question.id,
    objectLabel: `Practice: ${truncate(question.publishedRevision.questionText, 90)}`,
    languageCode: question.language.code,
    objectPath: `${unitPath}?q=${question.id}`,
    countryId: unit.topic.scope === 'COUNTRY' ? unit.countryId : null,
    languageId: question.languageId,
  }
}

// ---------- DTO mapping ----------

function reporterLabel(row: FeedbackRow): string | null {
  return row.user ? row.user.name ?? row.user.email : null
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000))
}

function toReportDto(row: FeedbackRow, objectPath: string | null): FeedbackReport {
  const type = row.feedbackType as FeedbackTypePublic
  const status = row.status as FeedbackStatusPublic
  return {
    id: row.id,
    objectType: row.objectType as FeedbackObjectTypePublic,
    objectId: row.objectId,
    objectLabel: row.objectLabel,
    objectPath,
    languageCode: row.languageCode,
    feedbackType: type,
    feedbackTypeLabel: feedbackTypeInfo(type).label,
    description: row.description,
    status,
    statusLabel: FEEDBACK_STATUSES.find((entry) => entry.key === status)?.label ?? status,
    task: row.task
      ? {
          id: row.task.id,
          status: row.task.status,
          assigneeLabel: row.task.assignee?.name ?? null,
          resolutionNote: row.task.resolutionNote,
        }
      : null,
    resolutionNote: row.resolutionNote,
    reporterLabel: reporterLabel(row),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedByLabel: row.resolvedBy ? row.resolvedBy.name ?? row.resolvedBy.email : null,
    minutesToResolution: row.resolvedAt ? minutesBetween(row.createdAt, row.resolvedAt) : null,
  }
}

function toMyReportDto(row: FeedbackRow, objectPath: string | null): MyFeedbackReport {
  const type = row.feedbackType as FeedbackTypePublic
  const status = row.status as FeedbackStatusPublic
  const statusInfo = FEEDBACK_STATUSES.find((entry) => entry.key === status)
  return {
    id: row.id,
    objectType: row.objectType as FeedbackObjectTypePublic,
    objectLabel: row.objectLabel,
    feedbackType: type,
    feedbackTypeLabel: feedbackTypeInfo(type).label,
    description: row.description,
    status,
    statusLabel: statusInfo?.label ?? status,
    statusDescription: statusInfo?.description ?? '',
    resolutionNote: row.resolutionNote,
    objectPath,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }
}

/** The report's §16 path for editor/reporter jump-offs — recomputed from the
 * reported object (units/events by their slug; items/QnA/questions by id →
 * their owning unit), the honest live link. Falls back to null when the
 * object has since left public life (§36). */
async function liveObjectPath(objectType: string, objectId: string): Promise<string | null> {
  try {
    if (objectType === 'KNOWLEDGE_UNIT') {
      const unit = await db.knowledgeUnit.findUnique({
        where: { id: objectId },
        include: { topic: { select: { slug: true, scope: true } }, country: { select: { isoCode: true } } },
      })
      if (!unit || !UNIT_REPORTABLE_STATUSES.has(unit.status)) return null
      const prefix = await objectMarketPrefix(
        unit.topic.scope === 'COUNTRY' ? unit.country?.isoCode : undefined,
        undefined
      )
      return `${prefix}/gk/${unit.topic.slug}/${unit.slug}/`
    }
    if (objectType === 'CURRENT_EVENT') {
      const event = await db.currentEvent.findUnique({
        where: { id: objectId },
        include: { topic: { select: { slug: true, scope: true } }, country: { select: { isoCode: true } } },
      })
      if (!event) return null
      const prefix = await objectMarketPrefix(
        event.topic.scope === 'COUNTRY' ? event.country?.isoCode : undefined,
        undefined
      )
      return `${prefix}/current-affairs/${event.slug}/`
    }
    // Content items / QnA / Question → the owning unit's page (the question
    // adds its ?q= focus — the P8-S1 pattern).
    const [item, qna, question] = await Promise.all([
      objectType === 'CONTENT_ITEM'
        ? db.contentItem.findUnique({
            where: { id: objectId },
            include: {
              language: { select: { code: true } },
              knowledgeUnit: {
                include: { topic: { select: { slug: true, scope: true } }, country: { select: { isoCode: true } } },
              },
            },
          })
        : null,
      objectType === 'QNA'
        ? db.qnA.findUnique({
            where: { id: objectId },
            include: {
              language: { select: { code: true } },
              knowledgeUnit: {
                include: { topic: { select: { slug: true, scope: true } }, country: { select: { isoCode: true } } },
              },
            },
          })
        : null,
      objectType === 'QUESTION'
        ? db.question.findUnique({
            where: { id: objectId },
            include: {
              language: { select: { code: true } },
              knowledgeUnit: {
                include: { topic: { select: { slug: true, scope: true } }, country: { select: { isoCode: true } } },
              },
            },
          })
        : null,
    ])
    const anchor = item ?? qna ?? question
    const unit = anchor?.knowledgeUnit
    if (!anchor || !unit) return null
    if (!UNIT_REPORTABLE_STATUSES.has(unit.status)) return null
    const prefix = await objectMarketPrefix(
      unit.topic.scope === 'COUNTRY' ? unit.country?.isoCode : undefined,
      anchor.language.code
    )
    const unitPath = `${prefix}/gk/${unit.topic.slug}/${unit.slug}/`
    return objectType === 'QUESTION' ? `${unitPath}?q=${objectId}` : unitPath
  } catch {
    return null
  }
}

// ---------- 1. Submit (§25 — the public "Report an issue" action) ----------

export interface FeedbackReporterRef {
  userId: string
  email: string
  /** The reporter's role at submission time (audit honesty — an editor can
   * report too; the audit trail says who did). */
  role: string | null
}

export async function submitFeedback(
  reporter: FeedbackReporterRef | null,
  input: FeedbackSubmitInput,
  meta: AuditRequestMeta = {}
): Promise<FeedbackSubmitResult> {
  const target = await resolveReportable(input)

  // Duplicate folding (signed-in reporters): one OPEN report per reporter ×
  // object × reason. Re-reporting the same issue is a receipt, not an error
  // — the queue stays clean without punishing a concerned reader.
  // Anonymous submissions have no stable identity to fold on: the route's
  // per-IP rate limit is the honest guard there.
  if (reporter) {
    const existing = await db.contentFeedback.findFirst({
      where: {
        userId: reporter.userId,
        objectType: target.objectType,
        objectId: target.objectId,
        feedbackType: input.feedbackType,
        status: { in: ['OPEN', 'IN_REVIEW'] },
      },
      include: REPORT_INCLUDE,
    })
    if (existing) {
      return { report: toMyReportDto(existing, target.objectPath), created: false, taskOpened: false }
    }
  }

  const typeInfo = feedbackTypeInfo(input.feedbackType)
  const taskTitle = `Correction report: ${truncate(target.objectLabel, 140)}`

  // ONE transaction: the report AND its §19 CORRECTION task exist together
  // or not at all (the P8-S2 atomicity lesson — a routed report can never
  // dangle without its work item).
  const created = await db.$transaction(async (tx) => {
    const report = await tx.contentFeedback.create({
      data: {
        userId: reporter?.userId ?? null,
        objectType: target.objectType,
        objectId: target.objectId,
        objectLabel: target.objectLabel,
        languageCode: target.languageCode,
        feedbackType: input.feedbackType,
        description: input.description,
        status: 'OPEN',
      },
    })
    const task = await tx.editorialTask.create({
      data: {
        type: 'CORRECTION',
        status: 'OPEN',
        priority: typeInfo.taskPriority,
        countryId: target.countryId,
        languageId: target.languageId,
        objectType: 'ContentFeedback',
        objectId: report.id,
        objectLabel: truncate(`${target.objectLabel} \u00b7 ${typeInfo.label}`, 180),
        title: taskTitle,
        notes: `Reported by ${reporter ? reporter.email : 'an anonymous reader'}: ${truncate(input.description, 900)}`,
        createdById: null,
      },
    })
    const linked = await tx.contentFeedback.update({
      where: { id: report.id },
      data: { taskId: task.id },
      include: REPORT_INCLUDE,
    })
    return { report: linked, task }
  })

  await recordAudit({
    actor: reporter ? { userId: reporter.userId, email: reporter.email, role: reporter.role } : null,
    action: AUDIT_ACTIONS.feedbackReportCreate,
    objectType: AUDIT_OBJECT_TYPES.contentFeedback,
    objectId: created.report.id,
    objectLabel: created.report.objectLabel,
    after: {
      objectType: created.report.objectType,
      objectId: created.report.objectId,
      feedbackType: created.report.feedbackType,
      taskId: created.task.id,
      anonymous: !reporter,
    },
    metadata: { task: created.task.id, priority: created.task.priority, anonymous: !reporter },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // §27 FEEDBACK_REPORT_RECEIVED — the workspace editors hear about the
  // report (best-effort: a notification failure never fails the report).
  try {
    await notifyFeedbackReceived({
      id: created.report.id,
      objectLabel: created.report.objectLabel,
      feedbackType: created.report.feedbackType,
      feedbackTypeLabel: feedbackTypeInfo(input.feedbackType).label,
      description: created.report.description,
      taskCountryId: created.task.countryId,
      reporterUserId: reporter?.userId ?? null,
    })
  } catch (notificationError) {
    console.error('[feedback:submit] notification trigger failed (report stands):', notificationError)
  }

  return {
    report: toMyReportDto(created.report, target.objectPath),
    created: true,
    taskOpened: true,
  }
}

// ---------- 2. The editorial queue (feedback:manage, §38-scoped) ----------

function isEditor(actor: Actor): boolean {
  return actor.role === 'ADMIN' || actor.role === 'COUNTRY_ADMIN'
}

/** §38 workspace scoping for the queue read: ADMIN sees the platform; a
 * COUNTRY_ADMIN sees their country workspace only (global-anchor reports are
 * platform-admin work — the GLOBAL_TASK_ADMIN_ONLY precedent). */
function queueWhere(actor: Actor, filters: FeedbackQueueInput): Prisma.ContentFeedbackWhereInput {
  const where: Prisma.ContentFeedbackWhereInput = {}
  if (actor.role === 'COUNTRY_ADMIN') {
    where.task = { countryId: actor.countryId ?? '__none__' }
  }
  if (filters.status) where.status = filters.status
  if (filters.feedbackType) where.feedbackType = filters.feedbackType
  return where
}

const STATUS_ORDER: Record<string, number> = { OPEN: 0, IN_REVIEW: 1, RESOLVED: 2, DISMISSED: 3 }
const QUEUE_ROW_CAP = 120

export async function getFeedbackQueue(
  actor: Actor,
  filters: FeedbackQueueInput = {}
): Promise<FeedbackQueue> {
  if (!isEditor(actor)) {
    throw new FeedbackError('FEEDBACK_EDITOR_ONLY', 'The feedback queue is an editorial surface (§25/§38)', 403)
  }

  const [rows, statusCounts, typeCounts] = await Promise.all([
    db.contentFeedback.findMany({
      where: queueWhere(actor, filters),
      orderBy: { createdAt: 'desc' },
      take: QUEUE_ROW_CAP,
      include: REPORT_INCLUDE,
    }),
    db.contentFeedback.groupBy({
      by: ['status'],
      where: queueWhere(actor, {}),
      _count: { _all: true },
    }),
    db.contentFeedback.groupBy({
      by: ['feedbackType'],
      where: queueWhere(actor, {}),
      _count: { _all: true },
    }),
  ])

  // Live §16 paths for the queue's jump-offs (one read per row, capped).
  const paths = await Promise.all(rows.map((row) => liveObjectPath(row.objectType, row.objectId)))

  // Work-first ordering: OPEN before IN_REVIEW before terminal states.
  const reports = rows
    .map((row, index) => toReportDto(row, paths[index]))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.createdAt.localeCompare(a.createdAt))

  const stats = buildStats(statusCounts, typeCounts, reports)
  return { reports, stats }
}

function buildStats(
  statusCounts: Array<{ status: string; _count: { _all: number } }>,
  typeCounts: Array<{ feedbackType: string; _count: { _all: number } }>,
  reports: FeedbackReport[]
): FeedbackStats {
  const statusMap = new Map(statusCounts.map((row) => [row.status, row._count._all]))
  const byType = FEEDBACK_TYPES.map((type) => ({
    type: type.key,
    label: type.label,
    count: typeCounts.find((row) => row.feedbackType === type.key)?._count._all ?? 0,
  }))
  const resolutionTimes = reports
    .filter((report) => report.minutesToResolution != null)
    .map((report) => report.minutesToResolution as number)
    .sort((a, b) => a - b)
  const median =
    resolutionTimes.length > 0
      ? resolutionTimes.length % 2 === 1
        ? resolutionTimes[(resolutionTimes.length - 1) / 2]!
        : Math.round((resolutionTimes[resolutionTimes.length / 2 - 1]! + resolutionTimes[resolutionTimes.length / 2]!) / 2)
      : null
  return {
    total: statusCounts.reduce((sum, row) => sum + row._count._all, 0),
    open: statusMap.get('OPEN') ?? 0,
    inReview: statusMap.get('IN_REVIEW') ?? 0,
    resolved: statusMap.get('RESOLVED') ?? 0,
    dismissed: statusMap.get('DISMISSED') ?? 0,
    byType,
    medianMinutesToResolution: median,
    note: 'Priority seeds from the report reason (§25); traffic/importance weighting joins with the §32 analytics (P8-S4/S5). Time-to-correct is computed over the reports currently in the queue\u2019s window.',
  }
}

// ---------- 3. The reporter's own reports (§31 own-data visibility) ----------

export async function getMyFeedbackReports(userId: string): Promise<MyFeedbackReport[]> {
  const rows = await db.contentFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: REPORT_INCLUDE,
  })
  const paths = await Promise.all(rows.map((row) => liveObjectPath(row.objectType, row.objectId)))
  return rows.map((row, index) => toMyReportDto(row, paths[index]))
}

// ---------- 4. Editorial transitions (auditable to resolution, §44) ----------

export async function transitionFeedback(
  actor: Actor,
  id: string,
  input: FeedbackTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<FeedbackReport> {
  if (!isEditor(actor)) {
    throw new FeedbackError('FEEDBACK_EDITOR_ONLY', 'Resolving feedback reports is editorial work (§25)', 403)
  }
  if (!CUID_PATTERN.test(id)) {
    throw new FeedbackError('FEEDBACK_NOT_FOUND', 'Unknown feedback report', 404)
  }

  const report = await db.contentFeedback.findUnique({ where: { id }, include: { task: true } })
  if (!report) throw new FeedbackError('FEEDBACK_NOT_FOUND', 'Unknown feedback report', 404)

  // §38 workspace guard: a COUNTRY_ADMIN acts inside their workspace only —
  // a global (platform) report is admin-only work.
  if (actor.role === 'COUNTRY_ADMIN') {
    const taskCountryId = report.task?.countryId ?? null
    if (taskCountryId === null || taskCountryId !== actor.countryId) {
      throw new FeedbackError(
        'FEEDBACK_COUNTRY_MISMATCH',
        taskCountryId === null
          ? 'Reports on global content are platform-admin work (§38)'
          : 'This report belongs to another country workspace (§38)',
        403
      )
    }
  }

  const current = report.status as FeedbackStatusPublic
  const allowed = FEEDBACK_EDITOR_TRANSITIONS[current] ?? []
  if (!allowed.includes(input.status)) {
    throw new FeedbackError(
      'FEEDBACK_TRANSITION_INVALID',
      `A ${current.toLowerCase()} report cannot move to ${String(input.status).toLowerCase()} (terminal states are final — file a new report if the issue returns, §36)`
    )
  }

  const now = new Date()
  const isTerminal = input.status === 'RESOLVED' || input.status === 'DISMISSED'
  const updated = await db.$transaction(async (tx) => {
    // The §19 link stays honest: closing the report closes its work item.
    // (The task updates run FIRST so the report row returned below carries
    // the task's post-cascade state — same transaction, fresh include.)
    if (report.task && ['OPEN', 'IN_PROGRESS'].includes(report.task.status)) {
      if (input.status === 'IN_REVIEW') {
        await tx.editorialTask.update({
          where: { id: report.task.id },
          data: { status: 'IN_PROGRESS', startedAt: report.task.startedAt ?? now },
        })
      } else if (input.status === 'RESOLVED') {
        await tx.editorialTask.update({
          where: { id: report.task.id },
          data: {
            status: 'RESOLVED',
            resolutionNote: input.resolutionNote!.trim(),
            resolvedById: actor.userId,
            resolvedAt: now,
          },
        })
      } else if (input.status === 'DISMISSED') {
        await tx.editorialTask.update({
          where: { id: report.task.id },
          data: {
            status: 'CANCELLED',
            resolutionNote: input.resolutionNote!.trim(),
            resolvedById: actor.userId,
            resolvedAt: now,
          },
        })
      }
    }

    return tx.contentFeedback.update({
      where: { id },
      data: {
        status: input.status,
        resolutionNote: isTerminal ? input.resolutionNote!.trim() : report.resolutionNote,
        resolvedById: isTerminal ? actor.userId : report.resolvedById,
        resolvedAt: isTerminal ? now : report.resolvedAt,
      },
      include: REPORT_INCLUDE,
    })
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.feedbackReportTransition,
    objectType: AUDIT_OBJECT_TYPES.contentFeedback,
    objectId: updated.id,
    objectLabel: updated.objectLabel,
    before: { status: report.status },
    after: { status: updated.status, resolutionNote: updated.resolutionNote },
    metadata: { action: input.status },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const objectPath = await liveObjectPath(updated.objectType, updated.objectId)
  return toReportDto(updated, objectPath)
}

// ---------- 5. The task→report cascades (§19 → §25, one-way boundary) ----------
// Called by the editorial service when a ContentFeedback-keyed task moves —
// the loop closes on both sides without double bookkeeping. These hooks are
// best-effort BY CONTRACT: a cascade failure never fails the task transition.

async function cascadeUpdate(
  taskId: string,
  data: Prisma.ContentFeedbackUpdateArgs['data'],
  audit: { action: string; note: string }
): Promise<void> {
  const report = await db.contentFeedback.findUnique({ where: { taskId }, include: { task: true } })
  if (!report) return
  if (report.status === 'RESOLVED' || report.status === 'DISMISSED') return
  const updated = await db.contentFeedback.update({ where: { id: report.id }, data, include: REPORT_INCLUDE })
  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.feedbackReportTransition,
    objectType: AUDIT_OBJECT_TYPES.contentFeedback,
    objectId: updated.id,
    objectLabel: updated.objectLabel,
    before: { status: report.status },
    after: { status: updated.status, resolutionNote: updated.resolutionNote },
    metadata: { auto: audit.action, task: taskId, note: audit.note },
  })
}

/** The linked task started — the report is in review. */
export async function onFeedbackTaskStarted(taskId: string): Promise<void> {
  await cascadeUpdate(taskId, { status: 'IN_REVIEW' }, { action: 'task_started', note: 'The linked correction task was started' })
}

/** The linked task was resolved — the report resolves WITH it, carrying the
 * task's resolution note (§44: auditable to resolution on both sides). */
export async function onFeedbackTaskResolved(
  taskId: string,
  resolutionNote: string,
  resolvedById: string
): Promise<void> {
  await cascadeUpdate(
    taskId,
    {
      status: 'RESOLVED',
      resolutionNote: `Closed with the linked correction task: ${truncate(resolutionNote, 800)}`,
      resolvedById,
      resolvedAt: new Date(),
    },
    { action: 'task_resolved', note: truncate(resolutionNote, 300) }
  )
}

/** The linked task was cancelled — the report stays open, honestly: a
 * cancelled work item is not a dismissed report; the queue still shows it
 * awaiting an editorial decision. (Implemented as an explicit no-op so the
 * contract is visible where the caller looks for it.) */
export async function onFeedbackTaskCancelled(_taskId: string): Promise<void> {
  void _taskId
}

// ---------- Audit actor helper (the notifications precedent) ----------

export function toFeedbackActorRef(userId: string, email: string, role: string): AuditActorRef {
  return { userId, email, role }
}
