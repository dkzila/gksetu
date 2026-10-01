/**
 * GKSetu — Notifications: the §27 domain engine (P8-S2)
 * Master Plan §27 (the expanded notifications contract): channel-agnostic
 * fan-out (one NotificationEvent row per enabled channel, batched by a
 * per-notification batchId), the four reader triggers + the editorial pair
 * (the feedback trigger stays modeled-but-unwired until P8-S3), a
 * queued → sent/failed → read lifecycle, and per-category × per-channel
 * preference resolution — never all-or-nothing. §9 (the personalisation
 * philosophy §27 explicitly invokes: every notification carries its
 * EXPLAINABLE reason and its one-tap mute — the matched follow's removal
 * request, the §9 inventory's own contract), §10 (follows are the audience
 * signal for exam/topic coverage; saves are the audience signal for
 * corrections — a save is retrieval, and it never feeds ranking, but the
 * saver is exactly who a §25 correction must reach), §11/§8 (the
 * event→unit→mapping→in-effect-version→exam chain reuses the SAME
 * predicates the combination engine and the exam-aware feed apply —
 * windowContains + mappingInEffect — so notification matching can never
 * drift from queue matching), §14 (country-scoped objects resolve their
 * canonical paths in their OWN market; GLOBAL objects resolve in the
 * recipient's home market), §22 (the revision-due trigger derives from
 * MasteryState's spaced-review schedule and is ensured lazily/idempotently
 * — at most one unread digest per user), §25/§36 (corrections are never
 * silent: a republished representation notifies savers with the change
 * summary; the context is an honest snapshot at trigger time), §31
 * (preferences are account settings kept by the reset; notification
 * history is the user's own data — also kept), §37 (typed errors,
 * client-agnostic DTOs), §39 (MOBILE_PUSH is modeled: preferences and
 * events carry it, but no transport exists — those rows stay QUEUED,
 * honestly held for the app).
 *
 * Trigger wiring is one-way (§28): the knowledge/content and editorial
 * services call the exported notify* functions after their own audited
 * mutations — best-effort by contract (a notification failure NEVER fails
 * the publish; the §19/§25 moment is the source of truth). Audience reads
 * query UserFollow/SavedItem rows directly — the read-only projection
 * precedent the sharing module set (one implementation per summary lives
 * in follow-save; a reverse fan-out query is this module's own).
 */
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
  type AuditRequestMeta,
} from '@/modules/audit'
import { LocaleError, resolveLocaleContext } from '@/modules/country-locale'
import { mappingInEffect, resolveTopicLabels } from '@/modules/exam-mapping'
import { windowContains } from '@/modules/exams-syllabus'

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_DEFAULT_ENABLED,
  NotificationError,
  categoryOfTrigger,
  type MarkReadResult,
  type NotificationChannel,
  type NotificationContext,
  type NotificationDispatchCounts,
  type NotificationDispatchResult,
  type NotificationItem,
  type NotificationPreferenceCategory,
  type NotificationPreferenceReceipt,
  type NotificationPreferences,
  type NotificationStats,
  type NotificationsFeed,
  type NotificationTriggerType,
  type NotificationObjectType,
} from './notification-types'
import type {
  MarkReadInput,
  NotificationPreferenceInput,
} from './notification-validation'

// ---------- Constants ----------

/** §19 review-type tasks — assignment of one of these is a "review requested". */
const REVIEW_TASK_TYPES: ReadonlySet<string> = new Set([
  'EDITORIAL_REVIEW',
  'FACT_CHECK',
  'LOCALISATION_REVIEW',
  'SEO_REVIEW',
  'EXAM_MAPPING_REVIEW',
])

/** Hard caps (§37 honesty): the feed renders at most 50 notifications / 200 rows. */
const FEED_BATCH_CAP = 50
const FEED_ROW_CAP = 200
/** One dispatch pass processes at most this many queued rows (the sweep cap). */
const DISPATCH_CAP = 500

// ---------- Market resolution (§14/§16/§35 — the sharing module's twin) ----------

interface MarketPrefix {
  prefix: string
  languageCode: string
}

/**
 * The §16 market prefix for a country + requested language (lenient: a
 * language the market does not configure falls back to the market default —
 * the sharing module's prefixForMarket contract, reused verbatim in shape).
 */
async function marketPrefix(
  countryInput: string | undefined,
  languageInput: string | null | undefined
): Promise<MarketPrefix> {
  try {
    const resolution = await resolveLocaleContext({
      country: countryInput,
      language: languageInput ?? undefined,
    })
    const parts: string[] = []
    if (!resolution.country.isDefault) parts.push(resolution.country.slug)
    if (!resolution.isDefaultLanguage) parts.push(resolution.language.code)
    return {
      prefix: parts.length > 0 ? `/${parts.join('/')}` : '',
      languageCode: resolution.language.code,
    }
  } catch (error) {
    if (error instanceof LocaleError && languageInput) {
      return marketPrefix(countryInput, undefined)
    }
    throw error
  }
}

/** The recipient-side user facts the fan-out needs (§14 market + §31 active check). */
interface RecipientUser {
  id: string
  status: string
  homeCountryIso: string | null
  preferredLanguageCode: string | null
}

const RECIPIENT_INCLUDE = {
  user: {
    select: {
      id: true,
      status: true,
      homeCountry: { select: { isoCode: true } },
      preferredLanguage: { select: { code: true } },
    },
  },
} as const

type WithRecipient<T> = T & {
  user: {
    id: string
    status: string
    homeCountry: { isoCode: string } | null
    preferredLanguage: { code: string } | null
  }
}

function toRecipientUser(row: WithRecipient<unknown>): RecipientUser {
  return {
    id: row.user.id,
    status: row.user.status,
    homeCountryIso: row.user.homeCountry?.isoCode ?? null,
    preferredLanguageCode: row.user.preferredLanguage?.code ?? null,
  }
}

/** §35 topic label in the resolved market language (the sharing module's chain). */
async function topicLabelIn(
  topicId: string,
  canonicalName: string,
  languageCode: string
): Promise<string> {
  const labels = await resolveTopicLabels([topicId], languageCode, languageCode)
  return labels.get(topicId)?.label ?? canonicalName
}

// ---------- Channel resolution (§27 per-category × per-channel, sparse) ----------

/**
 * The channels a notification of `category` creates for each user: an
 * explicit preference row wins (either way — re-enabling stores enabled
 * true, the honest explicit state); no row means the §27 default (email +
 * web-push on, mobile-push reserved off). A user who opted out of every
 * channel of a category gets NO rows — their choice, honored.
 */
async function enabledChannelsByUser(
  userIds: string[],
  category: string,
  tx: Prisma.TransactionClient = db
): Promise<Map<string, NotificationChannel[]>> {
  const result = new Map<string, NotificationChannel[]>()
  if (userIds.length === 0) return result
  const rows = await tx.notificationPreference.findMany({
    where: { userId: { in: userIds }, category },
    select: { userId: true, channel: true, enabled: true },
  })
  const explicit = new Map<string, boolean>()
  for (const row of rows) explicit.set(`${row.userId}:${row.channel}`, row.enabled)
  const channels = Object.keys(NOTIFICATION_DEFAULT_ENABLED) as NotificationChannel[]
  for (const userId of userIds) {
    result.set(
      userId,
      channels.filter(
        (channel) => explicit.get(`${userId}:${channel}`) ?? NOTIFICATION_DEFAULT_ENABLED[channel]
      )
    )
  }
  return result
}

// ---------- The fan-out core (§27 one row per enabled channel, batched) ----------

interface FanoutRecipient {
  userId: string
  context: NotificationContext
}

/**
 * Creates one notification for each recipient: a fresh batchId, one
 * NotificationEvent row per enabled channel, all QUEUED with the context
 * frozen at trigger time (§36 snapshot). Returns the rows created (0 when
 * every recipient opted out of the category — an honest no-op).
 */
async function fanOut(
  triggerType: NotificationTriggerType,
  objectType: NotificationObjectType,
  objectRef: string,
  recipients: FanoutRecipient[],
  tx: Prisma.TransactionClient = db
): Promise<number> {
  const active = recipients.filter(
    (recipient, index) =>
      recipients.findIndex((other) => other.userId === recipient.userId) === index
  )
  if (active.length === 0) return 0
  const category = categoryOfTrigger(triggerType)
  const channelsByUser = await enabledChannelsByUser(
    active.map((recipient) => recipient.userId),
    category,
    tx
  )
  const rows: Array<{
    userId: string
    batchId: string
    triggerType: NotificationTriggerType
    objectType: NotificationObjectType
    objectRef: string
    channel: NotificationChannel
    status: 'QUEUED'
    contextJson: NotificationContext
  }> = []
  for (const recipient of active) {
    const batchId = crypto.randomUUID()
    for (const channel of channelsByUser.get(recipient.userId) ?? []) {
      rows.push({
        userId: recipient.userId,
        batchId,
        triggerType,
        objectType,
        objectRef,
        channel,
        status: 'QUEUED',
        contextJson: recipient.context,
      })
    }
  }
  if (rows.length === 0) return 0
  await tx.notificationEvent.createMany({
    data: rows.map((row) => ({ ...row, contextJson: row.contextJson as object })),
  })
  return rows.length
}

// ---------- Trigger: CA_ITEM_FOLLOWED (§27 — new current-affairs coverage) ----------

/**
 * A current-affairs item went publicly live (its FIRST published
 * representation — the P6-S2 page gate). Audience: followers of the exams
 * whose in-effect syllabus maps one of the event's VERIFIED-linked units
 * (the §12 step 5 / §11 match chain, same predicates as the feed) plus
 * followers of the event's topics (primary + cross-filed). Each recipient's
 * context lists the follows that matched — the §27 explainable reason and
 * its one-tap mute targets.
 */
export async function notifyEventPublished(eventId: string): Promise<number> {
  const event = await db.currentEvent.findUnique({
    where: { id: eventId },
    include: {
      topic: { select: { id: true, slug: true, canonicalName: true } },
      country: { select: { isoCode: true } },
      additionalTopics: { select: { topic: { select: { id: true, slug: true, canonicalName: true } } } },
      knowledgeUnits: {
        select: {
          knowledgeUnit: { select: { id: true, status: true, scope: true, countryId: true } },
        },
      },
    },
  })
  if (!event) return 0

  // The §27 trigger is the event GOING PUBLICLY LIVE — its first published
  // representation (the P6-S2 page gate). By the time this runs, the item
  // that just published is already PUBLISHED: exactly one published
  // representation means it was the first; more means another language was
  // already live and the moment already notified.
  const publishedRepresentations = await db.contentItem.count({
    where: { currentEventId: event.id, status: 'PUBLISHED', publishedRevisionId: { not: null } },
  })
  if (publishedRepresentations > 1) return 0

  // Audience A — mapped exams (§11 chain: VERIFIED units → in-effect mappings
  // → in-effect versions of ACTIVE exams, §14 unit visibility per exam country).
  const linkedUnits = event.knowledgeUnits
    .map((link) => link.knowledgeUnit)
    .filter((unit) => unit.status === 'VERIFIED')
  const unitById = new Map(linkedUnits.map((unit) => [unit.id, unit]))
  const examIds = new Set<string>()
  if (linkedUnits.length > 0) {
    const mappings = await db.examMapping.findMany({
      where: { knowledgeUnitId: { in: linkedUnits.map((unit) => unit.id) } },
      include: {
        examVersion: { include: { exam: { select: { id: true, status: true, countryId: true } } } },
      },
    })
    for (const mapping of mappings) {
      const exam = mapping.examVersion.exam
      const unit = unitById.get(mapping.knowledgeUnitId)
      if (!unit || exam.status !== 'ACTIVE') continue
      if (!windowContains(mapping.examVersion)) continue
      if (!mappingInEffect(mapping, false)) continue
      if (unit.scope !== 'GLOBAL' && unit.countryId !== exam.countryId) continue
      examIds.add(exam.id)
    }
  }

  // Audience B — the event's topics (primary + cross-filed, P6-S3).
  const topicIds = [event.topicId, ...event.additionalTopics.map((link) => link.topic.id)]

  const follows = (await db.userFollow.findMany({
    where: {
      OR: [
        ...(examIds.size > 0 ? [{ objectType: 'EXAM' as const, objectId: { in: [...examIds] } }] : []),
        { objectType: 'TOPIC' as const, objectId: { in: topicIds } },
      ],
    },
    include: RECIPIENT_INCLUDE,
  })) as Array<WithRecipient<{ id: string; objectType: string; objectId: string }>>

  const activeFollows = follows.filter((follow) => follow.user.status === 'ACTIVE')
  if (activeFollows.length === 0) return 0

  // Labels: exam names (language-independent) + §35 topic labels per market language.
  const examIdsMatched = [
    ...new Set(
      activeFollows.filter((f) => f.objectType === 'EXAM').map((f) => f.objectId)
    ),
  ]
  const exams =
    examIdsMatched.length > 0
      ? await db.exam.findMany({
          where: { id: { in: examIdsMatched } },
          select: { id: true, name: true },
        })
      : []
  const examNameById = new Map(exams.map((exam) => [exam.id, exam.name]))

  const recipientsByUser = new Map<string, { user: RecipientUser; examFollows: typeof activeFollows; topicFollows: typeof activeFollows }>()
  for (const follow of activeFollows) {
    const entry = recipientsByUser.get(follow.user.id) ?? {
      user: toRecipientUser(follow),
      examFollows: [],
      topicFollows: [],
    }
    if (follow.objectType === 'EXAM') entry.examFollows.push(follow)
    else entry.topicFollows.push(follow)
    recipientsByUser.set(follow.user.id, entry)
  }

  // §35 labels resolve per distinct market language (one resolution per language).
  const labelCache = new Map<string, string>()
  const topicLabelFor = async (
    topicId: string,
    canonicalName: string,
    languageCode: string
  ): Promise<string> => {
    const key = `${topicId}:${languageCode}`
    const cached = labelCache.get(key)
    if (cached !== undefined) return cached
    const label = await topicLabelIn(topicId, canonicalName, languageCode)
    labelCache.set(key, label)
    return label
  }

  const recipients: FanoutRecipient[] = []
  for (const { user, examFollows, topicFollows } of recipientsByUser.values()) {
    // §14: a COUNTRY-scoped event's page lives in ITS market; a GLOBAL event
    // resolves in the recipient's home market.
    const market =
      event.scope === 'COUNTRY' && event.country
        ? await marketPrefix(event.country.isoCode, user.preferredLanguageCode)
        : await marketPrefix(user.homeCountryIso ?? undefined, user.preferredLanguageCode)
    const canonicalPath = `${market.prefix}/current-affairs/${event.slug}/`

    const matchedFollows: NotificationContext['matchedFollows'] = []
    const reasons: string[] = []
    for (const follow of examFollows) {
      const label = examNameById.get(follow.objectId) ?? 'an exam you follow'
      matchedFollows.push({ id: follow.id, objectType: 'EXAM' as const, label, removalPath: `/api/follows/${follow.id}` })
      reasons.push(label)
    }
    for (const follow of topicFollows) {
      const topic = event.topicId === follow.objectId
        ? { id: event.topicId, canonicalName: event.topic.canonicalName }
        : event.additionalTopics.map((link) => link.topic).find((t) => t.id === follow.objectId)
      const label = topic
        ? await topicLabelFor(topic.id, topic.canonicalName, market.languageCode)
        : 'a subject you follow'
      matchedFollows.push({ id: follow.id, objectType: 'TOPIC' as const, label, removalPath: `/api/follows/${follow.id}` })
      reasons.push(`the subject ${label}`)
    }
    const reasonList = reasons.slice(0, 2).join(' and ') + (reasons.length > 2 ? ` (and ${reasons.length - 2} more)` : '')
    const context: NotificationContext = {
      title: event.title,
      reason: `Because you follow ${reasonList} — this current-affairs item maps into their coverage (§12).`,
      body: event.summary.length > 220 ? `${event.summary.slice(0, 217)}…` : event.summary,
      objectLabel: `Current affairs · ${event.slug}`,
      canonicalPath,
      appPath: null,
      actionLabel: 'Open the event',
      matchedFollows,
      matchedSave: null,
    }
    recipients.push({ userId: user.id, context })
  }

  return fanOut('CA_ITEM_FOLLOWED', 'CURRENT_EVENT', event.slug, recipients)
}

// ---------- Trigger: UNIT_ADDED_FOLLOWED_EXAM (§27 — new syllabus coverage) ----------

/**
 * A KnowledgeUnit became VERIFIED (public, §7). Audience: followers of the
 * exams whose in-effect syllabus maps the unit — "New Knowledge Unit added
 * to a followed exam's syllabus coverage", spec-exact (topic followers are
 * deliberately NOT this trigger's audience — §27 names exams only).
 */
export async function notifyUnitVerified(unitId: string): Promise<number> {
  const unit = await db.knowledgeUnit.findUnique({
    where: { id: unitId },
    include: {
      topic: { select: { id: true, slug: true, canonicalName: true, scope: true } },
      country: { select: { isoCode: true } },
    },
  })
  if (!unit) return 0

  const mappings = await db.examMapping.findMany({
    where: { knowledgeUnitId: unit.id },
    include: { examVersion: { include: { exam: { select: { id: true, name: true, status: true, countryId: true } } } } },
  })
  const matchedExams = new Map<string, { name: string }>()
  for (const mapping of mappings) {
    const exam = mapping.examVersion.exam
    if (exam.status !== 'ACTIVE') continue
    if (!windowContains(mapping.examVersion)) continue
    if (!mappingInEffect(mapping, false)) continue
    if (unit.scope !== 'GLOBAL' && unit.countryId !== exam.countryId) continue
    matchedExams.set(exam.id, { name: exam.name })
  }
  if (matchedExams.size === 0) return 0

  const follows = (await db.userFollow.findMany({
    where: { objectType: 'EXAM', objectId: { in: [...matchedExams.keys()] } },
    include: RECIPIENT_INCLUDE,
  })) as Array<WithRecipient<{ id: string; objectType: string; objectId: string }>>
  const activeFollows = follows.filter((follow) => follow.user.status === 'ACTIVE')
  if (activeFollows.length === 0) return 0

  const recipients: FanoutRecipient[] = []
  for (const follow of activeFollows) {
    const user = toRecipientUser(follow)
    const market =
      unit.topic.scope === 'COUNTRY' && unit.country
        ? await marketPrefix(unit.country.isoCode, user.preferredLanguageCode)
        : await marketPrefix(user.homeCountryIso ?? undefined, user.preferredLanguageCode)
    const canonicalPath = `${market.prefix}/gk/${unit.topic.slug}/${unit.slug}/`
    const examName = matchedExams.get(follow.objectId)?.name ?? 'an exam you follow'
    const context: NotificationContext = {
      title: `${unit.canonicalName} joined your syllabus coverage`,
      reason: `Because you follow ${examName} — this unit is verified into its syllabus coverage (§8/§11).`,
      body:
        unit.canonicalSummary && unit.canonicalSummary.length > 0
          ? unit.canonicalSummary.length > 220
            ? `${unit.canonicalSummary.slice(0, 217)}…`
            : unit.canonicalSummary
          : null,
      objectLabel: `Knowledge unit · ${unit.slug}`,
      canonicalPath,
      appPath: null,
      actionLabel: 'Open the unit',
      matchedFollows: [
        { id: follow.id, objectType: 'EXAM', label: examName, removalPath: `/api/follows/${follow.id}` },
      ],
      matchedSave: null,
    }
    recipients.push({ userId: user.id, context })
  }

  return fanOut('UNIT_ADDED_FOLLOWED_EXAM', 'KNOWLEDGE_UNIT', unit.slug, recipients)
}

// ---------- Trigger: CORRECTION_PUBLISHED (§27/§25 — savers hear first) ----------

/**
 * A correction went live: a NEW revision published on an already-live unit
 * representation (§25/§36 — the change summary is mandatory there).
 * Audience: the users who saved the unit (any of its saves — KNOWLEDGE_UNIT
 * rows or CONTENT_ITEM rows of its representations; one notification per
 * user, the first matched save carries the unsave control). "Previously
 * read" is not a tracked signal on this platform (§31 — reading is not
 * recorded per user), so saves are the honest audience, stated as such.
 */
export async function notifyCorrectionPublished(
  unitId: string,
  payload: { languageCode: string; changeSummary: string; revisionNumber: number }
): Promise<number> {
  const unit = await db.knowledgeUnit.findUnique({
    where: { id: unitId },
    include: {
      topic: { select: { id: true, slug: true, canonicalName: true, scope: true } },
      country: { select: { isoCode: true } },
    },
  })
  if (!unit) return 0

  const items = await db.contentItem.findMany({
    where: { knowledgeUnitId: unit.id },
    select: { id: true },
  })
  const saves = (await db.savedItem.findMany({
    where: {
      OR: [
        { objectType: 'KNOWLEDGE_UNIT', objectId: unit.id },
        ...(items.length > 0
          ? [{ objectType: 'CONTENT_ITEM' as const, objectId: { in: items.map((item) => item.id) } }]
          : []),
      ],
    },
    include: RECIPIENT_INCLUDE,
  })) as Array<WithRecipient<{ id: string }>>
  const activeSaves = saves.filter((save) => save.user.status === 'ACTIVE')
  if (activeSaves.length === 0) return 0

  const seen = new Set<string>()
  const recipients: FanoutRecipient[] = []
  for (const save of activeSaves) {
    if (seen.has(save.user.id)) continue // one notification per saver
    seen.add(save.user.id)
    const user = toRecipientUser(save)
    const market =
      unit.topic.scope === 'COUNTRY' && unit.country
        ? await marketPrefix(unit.country.isoCode, user.preferredLanguageCode)
        : await marketPrefix(user.homeCountryIso ?? undefined, user.preferredLanguageCode)
    const canonicalPath = `${market.prefix}/gk/${unit.topic.slug}/${unit.slug}/`
    const context: NotificationContext = {
      title: `Correction published: ${unit.canonicalName}`,
      reason: `Because you saved ${unit.canonicalName} — §25 corrections are never silent, and savers hear first.`,
      body: `Revision ${payload.revisionNumber} (${payload.languageCode}): ${payload.changeSummary}`,
      objectLabel: `Knowledge unit · ${unit.slug}`,
      canonicalPath,
      appPath: null,
      actionLabel: 'Open the corrected page',
      matchedFollows: [],
      matchedSave: {
        id: save.id,
        label: unit.canonicalName,
        removalPath: `/api/saves/${save.id}`,
      },
    }
    recipients.push({ userId: user.id, context })
  }

  return fanOut('CORRECTION_PUBLISHED', 'KNOWLEDGE_UNIT', unit.slug, recipients)
}

// ---------- Trigger: editorial assignments (§27 editorial pair) ----------

/** The loaded task shape the assignment trigger needs. */
export interface EditorialAssignmentTask {
  id: string
  type: string
  title: string
  notes: string | null
  assigneeId: string | null
}

/**
 * An editorial task was assigned (created-with-assignee or reassigned).
 * Review-type tasks (§19) are EDITORIAL_REVIEW_REQUESTED; everything else
 * is EDITORIAL_TASK_ASSIGNED. Self-assignment never notifies (the actor
 * knows). FEEDBACK_REPORT_RECEIVED stays modeled-but-unwired until P8-S3.
 */
export async function notifyEditorialAssignment(
  task: EditorialAssignmentTask,
  actorUserId: string | null
): Promise<number> {
  if (!task.assigneeId || task.assigneeId === actorUserId) return 0
  const assignee = await db.user.findUnique({
    where: { id: task.assigneeId },
    select: { id: true, status: true },
  })
  if (!assignee || assignee.status !== 'ACTIVE') return 0

  const isReview = REVIEW_TASK_TYPES.has(task.type)
  const context: NotificationContext = {
    title: task.title,
    reason: isReview
      ? 'A review was requested of you (§19 editorial workflow).'
      : 'This work item was assigned to you (§19 editorial workflow).',
    body: task.notes,
    objectLabel: `Editorial task · ${task.type.replaceAll('_', ' ').toLowerCase()}`,
    canonicalPath: null, // the editorial workspace is the console — an in-app surface
    appPath: '#/console',
    actionLabel: 'Open the editorial workspace',
    matchedFollows: [],
    matchedSave: null,
  }

  return fanOut(
    isReview ? 'EDITORIAL_REVIEW_REQUESTED' : 'EDITORIAL_TASK_ASSIGNED',
    'EDITORIAL_TASK',
    task.id,
    [{ userId: assignee.id, context }]
  )
}

// ---------- Trigger: FEEDBACK_REPORT_RECEIVED (§27/§25 — wired P8-S3) ----------

/** The loaded report shape the feedback trigger needs (P8-S3 handoff). */
export interface FeedbackNotificationReport {
  id: string
  objectLabel: string
  feedbackType: string
  feedbackTypeLabel: string
  description: string
  /** The routed CORRECTION task's workspace scope (null countryId = platform). */
  taskCountryId: string | null
  /** The reporter (null = anonymous) — never notified about their own report. */
  reporterUserId: string | null
}

/**
 * A ContentFeedback report arrived (§25): the owning workspace's editors
 * hear about it — ADMINs for platform (global-anchor) reports, the country's
 * COUNTRY_ADMINs for country-workspace reports (the §38 workspace split).
 * The reporter is never a recipient (the self-notification honesty rule).
 * Best-effort by contract: a notification failure never fails the report.
 */
export async function notifyFeedbackReceived(report: FeedbackNotificationReport): Promise<number> {
  const editors = await db.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(report.taskCountryId
        ? { role: 'COUNTRY_ADMIN', countryId: report.taskCountryId }
        : { role: 'ADMIN' }),
      id: report.reporterUserId ? { not: report.reporterUserId } : undefined,
    },
    select: { id: true },
  })
  if (editors.length === 0) return 0

  const excerpt =
    report.description.length > 160
      ? `${report.description.slice(0, 157)}\u2026`
      : report.description
  const recipients = editors.map((editor) => ({
    userId: editor.id,
    context: {
      title: `Feedback report: ${report.objectLabel}`,
      reason: `A reader reported a ${report.feedbackTypeLabel.toLowerCase()} on ${report.objectLabel} (§25) \u2014 routed into the editorial workflow as a correction task.`,
      body: excerpt,
      objectLabel: `Feedback report \u00b7 ${report.feedbackTypeLabel}`,
      canonicalPath: null, // the editorial workspace is the console — an in-app surface
      appPath: '#/console',
      actionLabel: 'Open the editorial workspace',
      matchedFollows: [],
      matchedSave: null,
    } satisfies NotificationContext,
  }))

  return fanOut('FEEDBACK_REPORT_RECEIVED', 'CONTENT_FEEDBACK', report.id, recipients)
}

// ---------- Trigger: REVISION_DUE (§27/§22 — the spaced-review digest) ----------

/**
 * Ensures the user has AT MOST ONE unread revision-due digest: created
 * lazily when units are due and no unread digest exists (idempotent — the
 * §22 lazy-materialisation precedent). The check-then-create runs inside a
 * transaction under a per-user advisory lock, so concurrent feed reads (the
 * center mount + the bell's store refresh) can never double-create. The
 * counts are honest at creation time; the live queue always lives on the
 * dashboard.
 */
export async function ensureRevisionDueNotification(userId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // The lazy ensure runs on EVERY feed read, and the center's mount + the
    // bell's store refresh can land concurrently (observed in verification:
    // two digests 38ms apart). An advisory xact lock — held to COMMIT — makes
    // the check-then-create atomic per user: the loser of the race re-checks
    // only after the winner's rows are visible, so the at-most-one-unread
    // rule holds even across server instances (§27; the applyMasteryFromAttempt
    // transaction precedent, §22).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gksetu:notify:revision:${userId}`}))`

    const unread = await tx.notificationEvent.findFirst({
      where: { userId, triggerType: 'REVISION_DUE', status: { not: 'READ' } },
      select: { id: true },
    })
    if (unread) return false

    const due = await tx.masteryState.findMany({
      where: { userId, nextReviewAt: { lte: new Date() } },
      orderBy: { nextReviewAt: 'asc' },
      take: 25,
      include: { knowledgeUnit: { select: { canonicalName: true } } },
    })
    if (due.length === 0) return false

    const sample = due
      .slice(0, 3)
      .map((row) => row.knowledgeUnit.canonicalName)
      .join(' · ')
    const context: NotificationContext = {
      title: `${due.length} ${due.length === 1 ? 'unit is' : 'units are'} due for revision`,
      reason: `Your spaced-review schedule (§22) — ${due.length} ${
        due.length === 1 ? 'unit has' : 'units have'
      } reached the next review date.`,
      body:
        due.length > 3
          ? `${sample} · +${due.length - 3} more`
          : sample.length > 0
            ? sample
            : null,
      objectLabel: 'Your revision queue',
      canonicalPath: null, // the dashboard is a private surface — no §16 public path
      appPath: '#/dashboard',
      actionLabel: 'Open your revision queue',
      matchedFollows: [],
      matchedSave: null,
    }

    await fanOut('REVISION_DUE', 'USER_MASTERY', userId, [{ userId, context }], tx)
    return true
  })
}

// ---------- Dispatch (§27 queued → sent/failed; §39 the held channel) ----------

/**
 * The §27 delivery abstraction. This build ships the DEV TRANSPORT: it
 * records the delivery attempt in the server log — honestly labeled, never
 * pretending an email left the building. Real email/web-push transports
 * land with infrastructure (the swap point is this map); MOBILE_PUSH has no
 * entry at all (§39 — those rows stay QUEUED, held for the app).
 */
const TRANSPORTS: Partial<
  Record<NotificationChannel, (row: { userId: string; triggerType: string; objectRef: string; contextJson: unknown }) => Promise<void>>
> = {
  EMAIL: async (row) => {
    console.log(
      `[notifications:transport] EMAIL → user ${row.userId} · ${row.triggerType} · ${row.objectRef} — dev transport: delivery recorded, no message sent (§27 — the real transport arrives with infrastructure)`
    )
  },
  WEB_PUSH: async (row) => {
    console.log(
      `[notifications:transport] WEB_PUSH → user ${row.userId} · ${row.triggerType} · ${row.objectRef} — dev transport: delivery recorded, no message sent (§27)`
    )
  },
}

async function dispatchRows(
  rows: Array<{
    id: string
    userId: string
    channel: NotificationChannel
    triggerType: string
    objectRef: string
    contextJson: unknown
  }>
): Promise<NotificationDispatchCounts> {
  let sent = 0
  let failed = 0
  let held = 0
  for (const row of rows) {
    const transport = TRANSPORTS[row.channel]
    if (!transport) {
      held += 1 // MOBILE_PUSH — §39: no transport exists; the row stays queued
      continue
    }
    try {
      await transport(row)
      await db.notificationEvent.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date() },
      })
      sent += 1
    } catch (error) {
      console.error('[notifications:transport] delivery failed:', error)
      await db.notificationEvent
        .update({ where: { id: row.id }, data: { status: 'FAILED', sentAt: new Date() } })
        .catch(() => undefined)
      failed += 1
    }
  }
  return { sent, failed, held }
}

/** Dispatches one user's queued rows (the opportunistic per-user path). */
export async function dispatchUserNotifications(userId: string): Promise<NotificationDispatchCounts> {
  const queued = await db.notificationEvent.findMany({
    where: { userId, status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: DISPATCH_CAP,
    select: { id: true, userId: true, channel: true, triggerType: true, objectRef: true, contextJson: true },
  })
  return dispatchRows(queued)
}

/**
 * The batch sweep (the admin console action — the freshness-sweep pattern):
 * ensures every due user's revision digest, then dispatches every queued
 * row platform-wide. Audited by the route with these counts (§30).
 */
export async function dispatchAllNotifications(): Promise<NotificationDispatchResult> {
  const dueUsers = await db.masteryState.findMany({
    where: { nextReviewAt: { lte: new Date() } },
    select: { userId: true },
    distinct: ['userId'],
  })
  let ensuredRevisionDue = 0
  for (const { userId } of dueUsers) {
    if (await ensureRevisionDueNotification(userId)) ensuredRevisionDue += 1
  }

  const queued = await db.notificationEvent.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: DISPATCH_CAP,
    select: { id: true, userId: true, channel: true, triggerType: true, objectRef: true, contextJson: true },
  })
  const dispatched = await dispatchRows(queued)

  const heldUsers = await db.notificationEvent.findMany({
    where: { status: 'QUEUED', channel: 'MOBILE_PUSH' },
    select: { userId: true },
    distinct: ['userId'],
  })

  return {
    ensuredRevisionDue,
    dispatched,
    usersWithHolds: heldUsers.length,
    computedAt: new Date().toISOString(),
  }
}

// ---------- The notification-center feed (GET /api/notifications) ----------

/**
 * The caller's notifications: lazy ensure (revision digest) + opportunistic
 * dispatch (their queued rows → sent, so opening the center IS delivery in
 * this build — stated honestly in the note) + the grouped feed. Rows group
 * by batchId (one logical notification = its channel rows, newest first).
 */
export async function getMyNotifications(userId: string): Promise<NotificationsFeed> {
  const ensuredRevisionDue = await ensureRevisionDueNotification(userId)
  const dispatched = await dispatchUserNotifications(userId)

  const rows = await db.notificationEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: FEED_ROW_CAP,
  })

  const batches = new Map<string, typeof rows>()
  for (const row of rows) {
    const batch = batches.get(row.batchId)
    if (batch) batch.push(row)
    else batches.set(row.batchId, [row])
  }

  const items: NotificationItem[] = []
  let unreadCount = 0
  for (const batchRows of batches.values()) {
    if (items.length >= FEED_BATCH_CAP) break
    const first = batchRows[0]!
    const context = first.contextJson as unknown as NotificationContext
    const isRead = batchRows.some((row) => row.status === 'READ')
    if (!isRead) unreadCount += 1
    items.push({
      batchId: first.batchId,
      triggerType: first.triggerType,
      category: categoryOfTrigger(first.triggerType),
      objectType: first.objectType,
      objectRef: first.objectRef,
      title: context?.title ?? first.objectRef,
      reason: context?.reason ?? '',
      body: context?.body ?? null,
      objectLabel: context?.objectLabel ?? first.objectRef,
      canonicalPath: context?.canonicalPath ?? null,
      appPath: context?.appPath ?? null,
      actionLabel: context?.actionLabel ?? 'Open',
      matchedFollows: context?.matchedFollows ?? [],
      matchedSave: context?.matchedSave ?? null,
      channels: batchRows.map((row) => ({
        channel: row.channel,
        status: row.status,
        sentAt: row.sentAt?.toISOString() ?? null,
      })),
      isRead,
      createdAt: first.createdAt.toISOString(),
      readAt:
        batchRows.find((row) => row.readAt != null)?.readAt?.toISOString() ?? null,
    })
  }

  return {
    items,
    unreadCount,
    ensured: { revisionDue: ensuredRevisionDue },
    dispatched,
    note: 'Each notification says why you get it, with a one-tap mute for the follow that caused it (§27). Delivery in this build is the modeled dev transport — opening this center dispatches your queued notifications; email/web-push integrations arrive with infrastructure, mobile push with the app (§39).',
    computedAt: new Date().toISOString(),
  }
}

/** POST /api/notifications/read — one batch or everything unread → READ. */
export async function markNotificationsRead(
  userId: string,
  input: MarkReadInput
): Promise<MarkReadResult> {
  let updated = 0
  if (input.batchId) {
    const result = await db.notificationEvent.updateMany({
      where: { userId, batchId: input.batchId, status: { not: 'READ' } },
      data: { status: 'READ', readAt: new Date() },
    })
    updated = result.count
    if (updated === 0) {
      const exists = await db.notificationEvent.findFirst({
        where: { userId, batchId: input.batchId },
        select: { id: true },
      })
      if (!exists) {
        throw new NotificationError(
          'NOTIFICATION_NOT_FOUND',
          'That notification does not exist — it may have been removed with your account data (§31).'
        )
      }
      // Already read — the idempotent no-op receipt (honest, no second row).
    }
  } else {
    const result = await db.notificationEvent.updateMany({
      where: { userId, status: { not: 'READ' } },
      data: { status: 'READ', readAt: new Date() },
    })
    updated = result.count
  }
  return { updated, unreadCount: await countUnread(userId) }
}

async function countUnread(userId: string): Promise<number> {
  const rows = await db.notificationEvent.findMany({
    where: { userId, status: { not: 'READ' } },
    select: { batchId: true },
    distinct: ['batchId'],
  })
  return rows.length
}

/** The bell's number — unread notification batches (§37 lean stats). */
export async function getMyNotificationStats(userId: string): Promise<NotificationStats> {
  return { unreadCount: await countUnread(userId) }
}

// ---------- The preferences surface (§27 per-category × per-channel) ----------

/** GET /api/notifications/preferences — the full effective matrix. */
export async function getMyNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const rows = await db.notificationPreference.findMany({
    where: { userId },
    select: { channel: true, category: true, enabled: true },
  })
  const explicit = new Map<string, boolean>()
  for (const row of rows) explicit.set(`${row.channel}:${row.category}`, row.enabled)

  const categories: NotificationPreferenceCategory[] = NOTIFICATION_CATEGORIES.map(
    (category) => ({
      ...category,
      channels: NOTIFICATION_CHANNELS.map((info) => ({
        channel: info.channel,
        label: info.label,
        deliveryNote: info.deliveryNote,
        reserved: info.reserved,
        enabled:
          explicit.get(`${info.channel}:${category.key}`) ??
          NOTIFICATION_DEFAULT_ENABLED[info.channel],
      })),
    })
  )

  return {
    categories,
    defaultsNote:
      'No stored choice means the default: email and web push on, mobile push off (§27/§39). Storing a choice — either way — makes it explicit.',
    note: 'Notifications are never all-or-nothing (§27): every category is separate, every channel is separate, and each notification says why you get it with a one-tap mute for the follow that caused it.',
    computedAt: new Date().toISOString(),
  }
}

/**
 * PUT /api/notifications/preferences — one channel × category opt state per
 * request (one coherent audited operation, the collection-PATCH precedent).
 * Idempotent: setting the already-effective state is an honest no-op
 * receipt (no audit row — nothing changed).
 */
export async function setMyNotificationPreference(
  userId: string,
  input: NotificationPreferenceInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<NotificationPreferenceReceipt> {
  const unique = {
    userId_channel_category: {
      userId,
      channel: input.channel,
      category: input.category,
    },
  }
  const existing = await db.notificationPreference.findUnique({ where: unique })

  if (existing?.enabled === input.enabled) {
    return { channel: input.channel, category: input.category, enabled: input.enabled }
  }

  const row = await db.notificationPreference.upsert({
    where: unique,
    update: { enabled: input.enabled },
    create: {
      userId,
      channel: input.channel,
      category: input.category,
      enabled: input.enabled,
    },
  })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.notificationPreferenceSet,
    objectType: AUDIT_OBJECT_TYPES.notificationPreference,
    objectId: row.id,
    objectLabel: `${input.channel} · ${input.category}`,
    before: existing ? { enabled: existing.enabled } : null,
    after: { enabled: input.enabled },
    metadata: { channel: input.channel, category: input.category },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return { channel: input.channel, category: input.category, enabled: input.enabled }
}
