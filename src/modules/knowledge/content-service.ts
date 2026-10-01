/**
 * GKSetu — Knowledge: ContentItem + revision domain service (P2-S2)
 * Master Plan §6 (ContentItem row), §7 (representation of a canonical record —
 * the fact is NEVER re-entered, only rendered), §19 (published content is
 * immutable at the revision level; corrections create new revisions), §22
 * (knowledge-page rendering layers), §23 (representation formats with
 * per-format rules), §25/§36 (corrections carry provenance — changeSummary —
 * and preserve previous versions; no silent edits), §35 (language exposure is
 * per-country, enforced server-side), §14/§15 (country scope inherited from
 * the KnowledgeUnit — a representation is never more visible than its
 * canonical record), §37 (service-boundary authorization, deterministic
 * ordering), §38 (scoped admin), §43 (P2-S2 scope).
 *
 * Architecture: title/body on ContentItem are the WORKING COPY (editorial
 * staging). Public reads ALWAYS serve the live ContentRevision snapshot — so
 * staged corrections are invisible until a new revision is published. The
 * full editorial workflow (review roles, SCHEDULED state) lands in P2-S4.
 *
 * Caching note (§29): same decision as KnowledgeUnit — indexed DB queries
 * now; no snapshot cache for unbounded content volume.
 */
import type { Prisma, KnowledgeUnit } from '@prisma/client'

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
  getPublicCountry,
  isLanguageConfiguredForCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { getPublicTopic, getTopicIdentity, TaxonomyError } from '@/modules/taxonomy'
import { onEventChanged, onUnitChanged } from '@/modules/search'
import { notifyCorrectionPublished, notifyEventPublished } from '@/modules/notifications'

import {
  anchorLabel,
  anchorOfItem,
  anchorTarget,
  type ItemAnchor,
} from './content-anchors'
import type {
  AdminContentItem,
  AdminContentListResult,
  AdminContentRevisionListResult,
  ContentFormatPublic,
  ContentRevisionRef,
  ContentStatusPublic,
  ContentTransitionAction,
  PublicContentItemDetail,
  PublicContentItemSummary,
  PublicContentListResult,
} from './content-types'
import { CONTENT_EDITABILITY, CONTENT_TRANSITIONS, PUBLISH_GATED_ACTIONS } from './content-types'
import { getPublicSourcesForItem } from './source-service'
import type {
  AdminContentListQuery,
  ContentTransitionInput,
  CreateContentItemInput,
  PublicContentListQuery,
  UpdateContentItemInput,
} from './content-validation'
import { bodyFitsFormat } from './content-validation'
import { wireContentWorkflow, type ContentWorkflowEvent } from '@/modules/editorial'
import { onRepresentationPublished } from '@/modules/translations' // P9-S1 §36 drift/sync hook

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type ContentErrorCode =
  | 'CONTENT_NOT_FOUND'
  | 'CONTENT_NOT_VISIBLE'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_ARCHIVED'
  | 'UNIT_NOT_VERIFIED'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_ARCHIVED'
  | 'REPRESENTATION_EXISTS'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'NO_CHANGES'
  | 'FORMAT_BODY_INVALID'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_CONTENT_ADMIN_ONLY'
  | 'LANGUAGE_SCOPE'
  | 'PUBLISH_NOT_PERMITTED'
  | 'SCHEDULED_FOR_REQUIRED'

const ERROR_STATUS: Record<ContentErrorCode, number> = {
  CONTENT_NOT_FOUND: 404,
  CONTENT_NOT_VISIBLE: 404,
  UNIT_NOT_FOUND: 404,
  UNIT_ARCHIVED: 400,
  UNIT_NOT_VERIFIED: 409,
  EVENT_NOT_FOUND: 404,
  EVENT_ARCHIVED: 409,
  REPRESENTATION_EXISTS: 409,
  LANGUAGE_NOT_FOUND: 404,
  LANGUAGE_NOT_AVAILABLE: 400,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  CHANGE_SUMMARY_REQUIRED: 400,
  NO_CHANGES: 409,
  FORMAT_BODY_INVALID: 400,
  COUNTRY_MISMATCH: 403,
  GLOBAL_CONTENT_ADMIN_ONLY: 403,
  LANGUAGE_SCOPE: 403,
  PUBLISH_NOT_PERMITTED: 403,
  SCHEDULED_FOR_REQUIRED: 400,
}

export class ContentError extends Error {
  readonly code: ContentErrorCode
  readonly status: number

  constructor(code: ContentErrorCode, message: string) {
    super(message)
    this.name = 'ContentError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown ContentError to envelope data (§37); null for others. */
export function toContentErrorResponse(
  error: unknown
): { message: string; code: ContentErrorCode; status: number } | null {
  if (error instanceof ContentError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

type ItemRow = Prisma.ContentItemGetPayload<{
  include: {
    knowledgeUnit: true
    currentEvent: true
    language: true
    publishedRevision: { include: { publishedBy: true } }
    _count: { select: { revisions: true; sourceLinks: true } }
  }
}>

/** The provenance-bearing include used by every item read (§24). */
const ITEM_INCLUDE = {
  knowledgeUnit: true,
  currentEvent: true,
  language: true,
  publishedRevision: { include: { publishedBy: true } },
  _count: { select: { revisions: true, sourceLinks: true } },
} satisfies Prisma.ContentItemInclude

async function loadUnitByRef(ref: string): Promise<KnowledgeUnit | null> {
  return db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
}

/** P6-S2: loads a CurrentEvent by public ref (slug or id) — §12 step 4. */
async function loadEventByRef(ref: string) {
  return db.currentEvent.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
}

async function loadItem(id: string): Promise<ItemRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.contentItem.findUnique({
    where: { id },
    include: ITEM_INCLUDE,
  })
}

/** The item's resolved anchor — every downstream decision flows through it. */
function anchorOf(item: ItemRow): ItemAnchor {
  const anchor = anchorOfItem(item)
  if (!anchor) {
    // Unreachable through the validated create path (XOR invariant); a
    // defensive fallback that fails closed rather than leaking scope.
    throw new ContentError('CONTENT_NOT_FOUND', 'Content item has no canonical anchor')
  }
  return anchor
}

/**
 * A representation's permission target: the OWNING anchor's country scope (§14)
 * plus the item's language (the §20 WRITER language-scope dimension — ignored
 * by roles without a language scope). Works identically for unit- and
 * event-anchored representations (P6-S2).
 */
function targetOfItem(
  anchor: ItemAnchor,
  languageId?: string | null
): { countryId: string | null; languageId?: string | null } {
  return {
    ...anchorTarget(anchor),
    ...(languageId !== undefined ? { languageId } : {}),
  }
}

/** The §19 workflow event payload for an item (task wiring) — P6-S2: the
 * anchor is whichever canonical record the item represents. */
function workflowItemOf(item: ItemRow): ContentWorkflowEvent['item'] {
  const anchor = anchorOf(item)
  return {
    id: item.id,
    anchorKind: anchor.kind,
    unitSlug: anchor.kind === 'unit' ? anchor.slug : null,
    eventSlug: anchor.kind === 'event' ? anchor.slug : null,
    countryId: anchor.countryId,
    languageId: item.languageId,
    languageCode: item.language.code,
    format: item.format,
    title: item.title,
  }
}

/** Working-copy snapshot for audit before/after (redaction truncates bodies). */
function snapshotOf(item: ItemRow) {
  const anchor = anchorOf(item)
  return {
    anchorKind: anchor.kind,
    anchorSlug: anchor.slug,
    languageCode: item.language.code,
    format: item.format,
    status: item.status,
    title: item.title,
    body: item.body,
    aiAssisted: item.aiAssisted,
    liveRevision: item.publishedRevision
      ? { number: item.publishedRevision.revisionNumber, title: item.publishedRevision.title }
      : null,
  }
}

/** Object-level permission check + denial audit (§20 signal — KU pattern). */
function assertCanManageContent(
  actor: Actor,
  item: ItemRow,
  operation: string,
  meta?: AuditRequestMeta
): void {
  const anchor = anchorOf(item)
  if (can(actor, 'content:manage', targetOfItem(anchor, item.languageId))) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentDenied,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: anchorLabel(anchor, item.language.code, item.format),
    before: { status: item.status, anchorKind: anchor.kind, anchorScope: anchor.scope },
    metadata: {
      attemptedOperation: operation,
      reason: contentDenialReason(actor, anchor, item.languageId),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (anchor.scope === 'GLOBAL') {
      throw new ContentError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country-scoped staff cannot manage representations of global records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      item.languageId !== actor.languageScopeId
    ) {
      throw new ContentError(
        'LANGUAGE_SCOPE',
        'This representation is outside your language scope (§20 explicit staff scopes)'
      )
    }
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only manage content for your own country'
    )
  }
  throw new ContentError('COUNTRY_MISMATCH', 'You do not have permission to manage this content')
}

function contentDenialReason(
  actor: Actor,
  anchor: ItemAnchor,
  languageId?: string | null
): string {
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (anchor.scope === 'GLOBAL') return 'GLOBAL_CONTENT_ADMIN_ONLY'
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      languageId != null &&
      languageId !== actor.languageScopeId
    ) {
      return 'LANGUAGE_SCOPE'
    }
    return 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/**
 * Admin read access (taxonomy/KU parity): ADMIN sees all; COUNTRY_ADMIN and
 * WRITER (P2-S4 §18) see global (read-only) + own-country content — a writer's
 * language scope narrows only what they may MANAGE, not what they may read
 * (seeing the board's context is part of working it). P6-S2: identical for
 * unit- and event-anchored representations.
 */
function canReadContent(actor: Actor, anchor: ItemAnchor): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    return anchor.scope === 'GLOBAL' || anchor.countryId === actor.countryId
  }
  return false
}

function toRevisionRef(
  revision: Prisma.ContentRevisionGetPayload<{ include: { publishedBy: true } }>
): ContentRevisionRef {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    body: revision.body,
    changeSummary: revision.changeSummary,
    aiAssisted: revision.aiAssisted,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy?.email ?? null,
  }
}

async function toAdminItem(actor: Actor, item: ItemRow): Promise<AdminContentItem> {
  const anchor = anchorOf(item)
  const topic = item.knowledgeUnit ? await getTopicIdentity(item.knowledgeUnit.topicId) : null
  const canManage = can(actor, 'content:manage', targetOfItem(anchor, item.languageId))
  // §18 editorial gate: publish-class affordances only for content:publish
  // holders (ADMIN + COUNTRY_ADMIN — writers never see them).
  const canPublish = can(actor, 'content:publish', targetOfItem(anchor))
  const editability = CONTENT_EDITABILITY[item.status as ContentStatusPublic]
  const machineTransitions = Object.keys(
    CONTENT_TRANSITIONS[item.status as ContentStatusPublic]
  ) as ContentTransitionAction[]
  const transitions = machineTransitions.filter(
    (action) => !PUBLISH_GATED_ACTIONS.has(action) || canPublish
  )
  return {
    id: item.id,
    status: item.status as ContentStatusPublic,
    format: item.format as ContentFormatPublic,
    language: { code: item.language.code, name: item.language.name, nativeName: item.language.nativeName },
    title: item.title,
    body: item.body,
    unit: item.knowledgeUnit
      ? {
          id: item.knowledgeUnit.id,
          slug: item.knowledgeUnit.slug,
          canonicalName: item.knowledgeUnit.canonicalName,
          status: item.knowledgeUnit.status,
          scope: item.knowledgeUnit.scope as 'GLOBAL' | 'COUNTRY',
          countryIso:
            item.knowledgeUnit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
          topicSlug: topic?.slug ?? null,
        }
      : null,
    event: item.currentEvent
      ? {
          id: item.currentEvent.id,
          slug: item.currentEvent.slug,
          title: item.currentEvent.title,
          lifecycleState: item.currentEvent.lifecycleState,
          scope: item.currentEvent.scope as 'GLOBAL' | 'COUNTRY',
          countryIso:
            item.currentEvent.scope === 'COUNTRY' && item.currentEvent.countryId
              ? (await db.country.findUnique({
                  where: { id: item.currentEvent.countryId },
                  select: { isoCode: true },
                }))?.isoCode ?? null
              : null,
          editable: item.currentEvent.lifecycleState !== 'ARCHIVED',
        }
      : null,
    liveRevision: item.publishedRevision ? toRevisionRef(item.publishedRevision) : null,
    revisionCount: item._count.revisions,
    aiAssisted: item.aiAssisted,
    sourceCount: item._count.sourceLinks,
    scheduledFor: item.scheduledForAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    // Affordances from server truth (§20) — non-managers see none; writers
    // never see publish-class actions (§18).
    allowedTransitions: canManage ? transitions : [],
    // P6-S2: the anchor publish gate — VERIFIED unit (§7) or non-ARCHIVED
    // event (§36); the reason string explains every blocked case (§37).
    anchorPublishable: anchor.publishable,
    anchorBlockReason: anchor.blockReason,
  }
}

function toPublicSummary(item: ItemRow): PublicContentItemSummary | null {
  // Defense in depth: a PUBLISHED item must have a live revision to serve.
  if (!item.publishedRevision) return null
  return {
    id: item.id,
    format: item.format as ContentFormatPublic,
    language: {
      code: item.language.code,
      name: item.language.name,
      nativeName: item.language.nativeName,
    },
    title: item.publishedRevision.title,
    revision: {
      number: item.publishedRevision.revisionNumber,
      publishedAt: item.publishedRevision.publishedAt.toISOString(),
      changeSummary: item.publishedRevision.changeSummary,
    },
    updatedAt: item.updatedAt.toISOString(),
  }
}

/**
 * Resolves the locale + the country's configured language ids (§35 — content
 * in a language the country does not configure is never exposed there).
 */
async function resolveCountryLanguages(input: {
  country?: string
  language?: string
}): Promise<{ languageIds: string[]; requestedLanguageId: string | null }> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new ContentError('CONTENT_NOT_VISIBLE', error.message)
    }
    throw error
  }
  const country = await getPublicCountry(resolution.country.isoCode)
  if (!country) throw new ContentError('CONTENT_NOT_VISIBLE', 'Country not available')
  const languageIds: string[] = []
  for (const ref of country.languages) {
    const language = await findActiveLanguageByCode(ref.code)
    if (language) languageIds.push(language.id)
  }
  // When the caller asked for a specific language, the resolver has already
  // validated it is configured + active for this country.
  const requestedLanguageId = input.language
    ? (await findActiveLanguageByCode(resolution.language.code))?.id ?? null
    : null
  return { languageIds, requestedLanguageId }
}

/** Public visibility chain: unit VERIFIED + country-visible + topic-visible
 * (§14/§15) — a representation is never more visible than its record. */
async function assertUnitPubliclyVisible(
  unit: KnowledgeUnit,
  countryId: string,
  country?: string
): Promise<void> {
  if (unit.status !== 'VERIFIED') {
    throw new ContentError('CONTENT_NOT_VISIBLE', 'This content is not available')
  }
  if (unit.scope === 'COUNTRY' && unit.countryId !== countryId) {
    throw new ContentError('CONTENT_NOT_VISIBLE', 'This content is not available in the selected country')
  }
  try {
    await getPublicTopic(unit.topicId, { country })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      throw new ContentError('CONTENT_NOT_VISIBLE', 'This content is not available in the selected country')
    }
    throw error
  }
}

// ---------- §19 step 7: scheduled-release materialization (P2-S4) ----------

/**
 * Publishes ONE due SCHEDULED item atomically. The conditional claim
 * (`updateMany` on status + time) makes concurrent reads safe: exactly one
 * materialization wins; the losers see count 0 and skip. The published body
 * is the locked working copy — exactly what review approved (§19).
 */
async function materializeScheduledItem(itemId: string): Promise<void> {
  const item = await loadItem(itemId)
  if (
    !item ||
    item.status !== 'SCHEDULED' ||
    !item.scheduledForAt ||
    item.scheduledForAt.getTime() > Date.now()
  ) {
    return
  }
  // §14 guard: a representation is never more visible than its record — the
  // anchor must still permit publishing (VERIFIED unit / non-ARCHIVED event).
  // An anchor that went read-only between approval and release holds the
  // item in SCHEDULED until the anchor reopens — the honest §36 behaviour.
  const anchor = anchorOfItem(item)
  if (!anchor || !anchor.publishable) return

  const nextNumber = await db.$transaction(async (tx) => {
    const claimed = await tx.contentItem.updateMany({
      where: {
        id: item.id,
        status: 'SCHEDULED',
        scheduledForAt: { lte: new Date() },
      },
      data: { status: 'PUBLISHED', scheduledForAt: null },
    })
    if (claimed.count === 0) return null // a concurrent read materialized it
    const aggregate = await tx.contentRevision.aggregate({
      where: { contentItemId: item.id },
      _max: { revisionNumber: true },
    })
    const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
    const revision = await tx.contentRevision.create({
      data: {
        contentItemId: item.id,
        revisionNumber,
        title: item.title,
        body: item.body,
        aiAssisted: item.aiAssisted,
        changeSummary: 'Scheduled release (§19 step 7) — published automatically at the scheduled time',
        publishedById: null, // system publish
      },
    })
    await tx.contentItem.update({
      where: { id: item.id },
      data: { publishedRevisionId: revision.id },
    })
    await wireContentWorkflow(tx, {
      action: 'publish',
      actorId: null,
      item: workflowItemOf(item),
    })
    return revisionNumber
  })
  if (nextNumber == null) return

  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.contentItemTransition,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: anchorLabel(anchor, item.language.code, item.format),
    before: { status: 'SCHEDULED', scheduledFor: item.scheduledForAt.toISOString() },
    after: { status: 'PUBLISHED', revision: nextNumber },
    metadata: { action: 'publish', scheduled: true, materialized: 'lazy-read' },
  })

  // P4-S1 §17/§19: the scheduled release just became a public surface — its
  // language variant joins the search index now, not on the next full reindex
  // (unit documents for unit items; event documents for event items, P6-S2).
  if (anchor?.kind === 'event') {
    await onEventChanged(anchor.slug)
  } else if (item.knowledgeUnit) {
    await onUnitChanged(item.knowledgeUnit.slug)
  }

  // P8-S2 §27: a scheduled event representation materializing is the SAME
  // "current-affairs item goes publicly live" moment as an immediate publish
  // — the followers of its mapped exams/topics hear about it here too. A
  // scheduled unit release is a first publish (no correction cycle), so no
  // correction trigger fires. Best-effort, like the immediate-publish path.
  try {
    if (anchor?.kind === 'event' && item.currentEventId) {
      await notifyEventPublished(item.currentEventId)
    }
  } catch (notificationError) {
    console.error('[content:materialize] notification trigger failed (publish stands):', notificationError)
  }
}

/**
 * Publishes due SCHEDULED items lazily — the modular monolith's scheduler is
 * "the first read after the scheduled time" (no background jobs needed).
 * Public and admin reads both call this, scoped to what they are reading so
 * per-request work stays bounded (§37).
 */
export async function materializeDueScheduledContent(
  scope?: { unitId?: string; eventId?: string; itemId?: string }
): Promise<void> {
  const due = await db.contentItem.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledForAt: { lte: new Date() },
      ...(scope?.unitId ? { knowledgeUnitId: scope.unitId } : {}),
      ...(scope?.eventId ? { currentEventId: scope.eventId } : {}),
      ...(scope?.itemId ? { id: scope.itemId } : {}),
    },
    select: { id: true },
    take: 25, // bounded per read
  })
  for (const row of due) await materializeScheduledItem(row.id)
}

// ---------- Public reads ----------

/** Lists the PUBLISHED representations of one unit in the resolved country
 * (§7 — one record, many renderings; §35 — only languages the country configures). */
export async function getPublicContentItems(
  query: PublicContentListQuery
): Promise<PublicContentListResult> {
  const unit = await loadUnitByRef(query.unit)
  if (!unit) throw new ContentError('UNIT_NOT_FOUND', 'Knowledge unit not found')

  const { languageIds, requestedLanguageId } = await resolveCountryLanguages({
    country: query.country,
    language: query.language,
  })

  // Country id for the scope check (§14/§15).
  const resolution = await resolveLocaleContext({ country: query.country })
  const countryRow = await db.country.findFirst({
    where: { isoCode: resolution.country.isoCode },
    select: { id: true },
  })
  if (!countryRow) throw new ContentError('CONTENT_NOT_VISIBLE', 'Country not available')
  await assertUnitPubliclyVisible(unit, countryRow.id, query.country)

  // §19 step 7: due scheduled releases go live before serving the list.
  await materializeDueScheduledContent({ unitId: unit.id })

  const items = await db.contentItem.findMany({
    where: {
      knowledgeUnitId: unit.id,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: { in: requestedLanguageId ? [requestedLanguageId] : languageIds },
    },
    include: ITEM_INCLUDE,
  })

  // All configured languages that carry at least one published representation
  // (informational — powers "also available in …" affordances).
  const allCountryItems = requestedLanguageId
    ? await db.contentItem.findMany({
        where: {
          knowledgeUnitId: unit.id,
          status: 'PUBLISHED',
          publishedRevisionId: { not: null },
          languageId: { in: languageIds },
        },
        select: { languageId: true },
      })
    : items
  const languagesAvailable = [...new Set(allCountryItems.map((row) => row.languageId))].map(
    (id) => items.find((row) => row.languageId === id)?.language.code ?? null
  ).filter((code): code is string => code != null)

  const topic = await getTopicIdentity(unit.topicId)

  return {
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      type: unit.type,
      difficulty: unit.difficulty,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso: unit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
    },
    items: items
      .map(toPublicSummary)
      .filter((entry): entry is PublicContentItemSummary => entry != null)
      .sort(
        (a, b) =>
          a.language.code.localeCompare(b.language.code) || a.format.localeCompare(b.format)
      ),
    languagesAvailable: languagesAvailable.sort(),
  }
}

/** Public detail by id — ALWAYS the live revision snapshot, never the working copy. */
export async function getPublicContentItem(
  id: string,
  input: { country?: string }
): Promise<PublicContentItemDetail> {
  // §19 step 7: a due scheduled release goes live before serving the detail.
  await materializeDueScheduledContent({ itemId: id })
  const item = await loadItem(id)
  if (!item || item.status !== 'PUBLISHED' || !item.publishedRevision) {
    throw new ContentError('CONTENT_NOT_FOUND', 'Content not found')
  }
  // P6-S2: an event representation's public surface is the §16 event page
  // (/current-affairs/{slug}/) — the standalone item read is the unit
  // representation's surface. Redirecting clients to the event page is the
  // honest answer, not serving a decontextualised event update.
  if (item.currentEventId) {
    throw new ContentError(
      'CONTENT_NOT_VISIBLE',
      'This is a current-affairs representation — read it on its event page (/current-affairs/{slug}/, §16)'
    )
  }
  const unit = item.knowledgeUnit!

  const resolution = await resolveLocaleContext({ country: input.country })
  const countryRow = await db.country.findFirst({
    where: { isoCode: resolution.country.isoCode },
    select: { id: true },
  })
  if (!countryRow) throw new ContentError('CONTENT_NOT_VISIBLE', 'Country not available')
  await assertUnitPubliclyVisible(unit, countryRow.id, input.country)

  const summary = toPublicSummary(item)
  if (!summary) throw new ContentError('CONTENT_NOT_FOUND', 'Content not found')

  const topic = await getTopicIdentity(unit.topicId)
  // §24 provenance surface: current evidence links with verification states.
  // Provenance rides the already-verified visibility chain above.
  const sources = await getPublicSourcesForItem(item.id)

  return {
    ...summary,
    body: item.publishedRevision.body,
    revisionCount: item._count.revisions,
    // §24/§26 — the live revision's immutable AI-provenance snapshot.
    aiAssisted: item.publishedRevision.aiAssisted,
    sources,
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      type: unit.type,
      difficulty: unit.difficulty,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso: unit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
    },
  }
}

// ---------- Admin reads ----------

export async function getAdminContentItems(
  actor: Actor,
  query: AdminContentListQuery
): Promise<AdminContentListResult> {
  assertCan(actor, 'content:manage')

  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledContent()

  let unitId: string | undefined
  if (query.unit) {
    const unit = await loadUnitByRef(query.unit)
    if (!unit) throw new ContentError('UNIT_NOT_FOUND', `Unknown unit "${query.unit}"`)
    unitId = unit.id
  }

  // P6-S2: the event filter — one event's representations (§12 step 4).
  let eventId: string | undefined
  if (query.event) {
    const event = await loadEventByRef(query.event)
    if (!event) throw new ContentError('EVENT_NOT_FOUND', `Unknown current event "${query.event}"`)
    eventId = event.id
  }

  let languageId: string | undefined
  if (query.language) {
    const language = await findActiveLanguageByCode(query.language)
    if (!language) throw new ContentError('LANGUAGE_NOT_FOUND', `Unknown language "${query.language}"`)
    languageId = language.id
  }

  // COUNTRY_ADMIN + WRITER (P2-S4 §18): global (read-only) + own-country
  // content — KU parity. The scope lives on the owning anchor (unit OR event,
  // P6-S2), so the filter rides both relations.
  const anchorScope: Prisma.ContentItemWhereInput | undefined =
    actor.role === 'ADMIN'
      ? undefined
      : {
          OR: [
            { knowledgeUnit: { OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }] } },
            { currentEvent: { OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }] } },
          ],
        }

  const where: Prisma.ContentItemWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(unitId ? { knowledgeUnitId: unitId } : {}),
    ...(eventId ? { currentEventId: eventId } : {}),
    ...(languageId ? { languageId } : {}),
    ...(query.format ? { format: query.format } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { knowledgeUnit: { canonicalName: { contains: query.q, mode: 'insensitive' } } },
            { currentEvent: { title: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(anchorScope ? anchorScope : {}),
  }

  const [rows, total] = await Promise.all([
    db.contentItem.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: ITEM_INCLUDE,
    }),
    db.contentItem.count({ where }),
  ])

  const items: AdminContentItem[] = []
  for (const row of rows) {
    const anchor = anchorOfItem(row)
    if (anchor && canReadContent(actor, anchor)) items.push(await toAdminItem(actor, row))
  }

  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getAdminContentItem(actor: Actor, id: string): Promise<AdminContentItem> {
  assertCan(actor, 'content:manage')
  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledContent({ itemId: id })
  const item = await loadItem(id)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  const anchor = anchorOf(item)
  if (!canReadContent(actor, anchor)) {
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only view global content and your own country content'
    )
  }
  return toAdminItem(actor, item)
}

/** Full revision history of one item — the §36 preserved versions (admin). */
export async function listContentRevisions(
  actor: Actor,
  itemId: string
): Promise<AdminContentRevisionListResult> {
  assertCan(actor, 'content:manage')
  const item = await loadItem(itemId)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  const anchor = anchorOf(item)
  if (!canReadContent(actor, anchor)) {
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only view revisions of global content and your own country content'
    )
  }

  const revisions = await db.contentRevision.findMany({
    where: { contentItemId: item.id },
    orderBy: { revisionNumber: 'desc' }, // deterministic (§37)
    include: { publishedBy: true },
  })

  return {
    itemId: item.id,
    anchor: { kind: anchor.kind, slug: anchor.slug, name: anchor.name },
    language: { code: item.language.code, name: item.language.name },
    format: item.format as ContentFormatPublic,
    revisions: revisions.map(toRevisionRef),
  }
}

// ---------- Admin writes ----------

export async function createContentItem(
  actor: Actor,
  input: CreateContentItemInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentItem> {
  assertCan(actor, 'content:manage')

  // ---------- The canonical anchor (§7 unit OR §12 step 4 event, P6-S2) ----------
  // Representations attach to their canonical record, never re-enter it.
  let anchor: ItemAnchor
  let unitId: string | null = null
  let eventId: string | null = null
  if (input.event) {
    const event = await loadEventByRef(input.event)
    if (!event) throw new ContentError('EVENT_NOT_FOUND', `Unknown current event "${input.event}"`)
    if (event.lifecycleState === 'ARCHIVED') {
      throw new ContentError(
        'EVENT_ARCHIVED',
        'Archived events are read-only (§36) — reopen the event via a lifecycle transition before adding representations'
      )
    }
    eventId = event.id
    anchor = {
      kind: 'event',
      slug: event.slug,
      name: event.title,
      scope: event.scope as 'GLOBAL' | 'COUNTRY',
      countryId: event.scope === 'COUNTRY' ? event.countryId : null,
      archived: false,
      publishable: true,
      blockReason: null,
    }
  } else {
    const unit = await loadUnitByRef(input.unit!)
    if (!unit) throw new ContentError('UNIT_NOT_FOUND', `Unknown knowledge unit "${input.unit}"`)
    if (unit.status === 'ARCHIVED') {
      throw new ContentError(
        'UNIT_ARCHIVED',
        'Archived units cannot receive new representations — create a new unit instead (§36)'
      )
    }
    unitId = unit.id
    anchor = {
      kind: 'unit',
      slug: unit.slug,
      name: unit.canonicalName,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryId: unit.scope === 'COUNTRY' ? unit.countryId : null,
      archived: false,
      publishable: unit.status === 'VERIFIED',
      blockReason:
        unit.status === 'VERIFIED'
          ? null
          : `The owning unit is ${unit.status} — content can only be published on VERIFIED units (§7)`,
    }
  }

  // Language (§35): must be ACTIVE; for country-scoped anchors it must be
  // configured for that anchor's country (enforced server-side, never by UI).
  const language = await findActiveLanguageByCode(input.language.toLowerCase())
  if (!language) {
    throw new ContentError('LANGUAGE_NOT_FOUND', `Unknown or inactive language "${input.language}"`)
  }
  if (anchor.scope === 'COUNTRY' && anchor.countryId) {
    const configured = await isLanguageConfiguredForCountry(anchor.countryId, language.id)
    if (!configured) {
      throw new ContentError(
        'LANGUAGE_NOT_AVAILABLE',
        `Language "${language.code}" is not configured for this anchor's country market (§35 — per-country language exposure)`
      )
    }
  }

  // Object-level scope: a representation inherits its anchor's country scope,
  // and a language-scoped WRITER may only create in their language (§20).
  if (!can(actor, 'content:manage', targetOfItem(anchor, language.id))) {
    const reason = contentDenialReason(actor, anchor, language.id)
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentDenied,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: null,
      objectLabel: `${anchor.slug}/${language.code}/${input.format}`,
      before: { anchorKind: anchor.kind, anchorSlug: anchor.slug, anchorScope: anchor.scope },
      metadata: { attemptedOperation: 'create', reason },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    if ((actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') && anchor.scope === 'GLOBAL') {
      throw new ContentError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country-scoped staff can only create content for their own country\u2019s records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      language.id !== actor.languageScopeId
    ) {
      throw new ContentError(
        'LANGUAGE_SCOPE',
        'You are language-scoped to your assigned language (§20 explicit staff scopes) — this representation is outside it'
      )
    }
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only create content for your own country\u2019s records'
    )
  }

  // §7/§11 identity: one representation per (anchor, language, format). The
  // DB constraint covers unit anchors; event anchors are checked here (NULLs
  // are distinct in Postgres unique indexes — see the schema note).
  const existing = await db.contentItem.findFirst({
    where: {
      ...(eventId ? { currentEventId: eventId } : { knowledgeUnitId: unitId }),
      languageId: language.id,
      format: input.format,
    },
    select: { id: true, status: true },
  })
  if (existing) {
    throw new ContentError(
      'REPRESENTATION_EXISTS',
      `A ${input.format} representation in "${language.code}" already exists for this ${anchor.kind === 'event' ? 'event' : 'unit'} (status: ${existing.status}) — one rendering per anchor + language + format (§7)`
    )
  }

  const created = await db.contentItem.create({
    data: {
      knowledgeUnitId: unitId,
      currentEventId: eventId,
      languageId: language.id,
      format: input.format,
      status: 'DRAFT',
      title: input.title,
      body: input.body,
      aiAssisted: input.aiAssisted ?? false,
      createdById: actor.userId,
    },
    include: ITEM_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemCreate,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: created.id,
    objectLabel: anchorLabel(anchor, language.code, input.format),
    after: snapshotOf(created),
    metadata: {
      anchorKind: anchor.kind,
      anchorSlug: anchor.slug,
      languageCode: language.code,
      format: input.format,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminItem(actor, created)
}

export async function updateContentItem(
  actor: Actor,
  id: string,
  input: UpdateContentItemInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentItem> {
  const item = await loadItem(id)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  assertCanManageContent(actor, item, 'update', meta)

  const editability = CONTENT_EDITABILITY[item.status as ContentStatusPublic]
  if (editability === 'none') {
    throw new ContentError(
      'STATE_LOCKED',
      'Retired items are read-only (§36) — create a new representation if the content is needed again'
    )
  }

  // Working-copy merge + per-format rules (§23 — the item's format is immutable).
  const title = input.title ?? item.title
  const body = input.body ?? item.body
  const formatCheck = bodyFitsFormat(item.format as ContentFormatPublic, body)
  if (!formatCheck.ok) {
    throw new ContentError('FORMAT_BODY_INVALID', formatCheck.message)
  }

  const before = snapshotOf(item)
  const updated = await db.contentItem.update({
    where: { id: item.id },
    data: {
      ...(input.title !== undefined ? { title } : {}),
      ...(input.body !== undefined ? { body } : {}),
      ...(input.aiAssisted !== undefined ? { aiAssisted: input.aiAssisted } : {}),
    },
    include: ITEM_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemUpdate,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: anchorLabel(anchorOf(item), item.language.code, item.format),
    before,
    after: snapshotOf(updated),
    metadata: {
      changedFields: Object.keys(input),
      note:
        item.status === 'PUBLISHED'
          ? 'Working-copy edit — staged, not public. Public reads serve the live revision until a new revision is published (§36).'
          : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminItem(actor, updated)
}

export async function transitionContentItem(
  actor: Actor,
  id: string,
  input: ContentTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentItem> {
  const item = await loadItem(id)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  assertCanManageContent(actor, item, `transition:${input.action}`, meta)
  const anchor = anchorOf(item)

  // §18 editorial gate: publish/schedule/retire are editorial decisions —
  // writers create, edit and submit, but never publish (§18 "cannot publish
  // unless granted"). Denied here with an audit trail (§20/§30).
  if (
    PUBLISH_GATED_ACTIONS.has(input.action) &&
    !can(actor, 'content:publish', targetOfItem(anchor))
  ) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentDenied,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: item.id,
      objectLabel: anchorLabel(anchor, item.language.code, item.format),
      before: { status: item.status },
      metadata: {
        attemptedOperation: `transition:${input.action}`,
        reason: 'PUBLISH_NOT_PERMITTED',
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new ContentError(
      'PUBLISH_NOT_PERMITTED',
      'Writers create and edit content but cannot publish (§18) — ask an editor to publish, schedule or retire'
    )
  }

  const status = item.status as ContentStatusPublic
  const target = CONTENT_TRANSITIONS[status][input.action]
  if (!target) {
    throw new ContentError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${status}`
    )
  }

  // ---------- publish: append an immutable revision (§19/§36) ----------
  if (input.action === 'publish') {
    // P6-S2: the anchor publish gate — VERIFIED unit (§7) or non-ARCHIVED
    // event (§36; an EMERGING event publishes — breaking news is the point
    // of current affairs, §12).
    if (anchor.kind === 'event') {
      if (anchor.archived) {
        throw new ContentError(
          'EVENT_ARCHIVED',
          'This event is archived and read-only (§36) — reopen it via a lifecycle transition before publishing its representations'
        )
      }
    } else if (!anchor.publishable) {
      throw new ContentError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${item.knowledgeUnit?.status} — content can only be published on VERIFIED units (a representation is never more visible than its record)`
      )
    }
    const formatCheck = bodyFitsFormat(item.format as ContentFormatPublic, item.body)
    if (!formatCheck.ok) {
      throw new ContentError('FORMAT_BODY_INVALID', formatCheck.message)
    }

    const isRepublish = item.publishedRevisionId != null
    if (isRepublish) {
      if (!input.changeSummary?.trim()) {
        throw new ContentError(
          'CHANGE_SUMMARY_REQUIRED',
          'Publishing a new revision of live content requires a change summary (§25/§36 — corrections are never silent)'
        )
      }
      if (
        item.title === item.publishedRevision?.title &&
        item.body === item.publishedRevision?.body
      ) {
        throw new ContentError(
          'NO_CHANGES',
          'The working copy is identical to the live revision — nothing to publish'
        )
      }
    }

    // Append revision N+1 and move the live pointer atomically. The unique
    // (contentItemId, revisionNumber) guards against concurrent double-publish.
    const nextNumber = await db.$transaction(async (tx) => {
      const aggregate = await tx.contentRevision.aggregate({
        where: { contentItemId: item.id },
        _max: { revisionNumber: true },
      })
      const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
      const revision = await tx.contentRevision.create({
        data: {
          contentItemId: item.id,
          revisionNumber,
          title: item.title,
          body: item.body,
          // §24/§26 — the revision freezes the AI-provenance flag at publish time.
          aiAssisted: item.aiAssisted,
          changeSummary: input.changeSummary?.trim() ?? null,
          publishedById: actor.userId,
        },
      })
      await tx.contentItem.update({
        where: { id: item.id },
        data: {
          status: 'PUBLISHED',
          publishedRevisionId: revision.id,
          scheduledForAt: null, // publishing (incl. publish-now from SCHEDULED) clears the marker
        },
      })
      // §19 wiring: resolve the item's open work items inside the same
      // transaction so board state never lags content state.
      await wireContentWorkflow(tx, {
        action: 'publish',
        actorId: actor.userId,
        item: workflowItemOf(item),
      })
      // P9-S1 §36 translation wiring (same transaction): if this item is a
      // SOURCE with synced translations they go OUTDATED (drift); if it is a
      // TARGET its link re-syncs to the source's current live revision.
      await onRepresentationPublished(tx, {
        type: 'CONTENT_ITEM',
        id: item.id,
        revisionNumber,
      })
      return revisionNumber
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentItemTransition,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: item.id,
      objectLabel: anchorLabel(anchor, item.language.code, item.format),
      before: { status: item.status, liveRevision: item.publishedRevision?.revisionNumber ?? null },
      after: { status: 'PUBLISHED', revision: nextNumber },
      metadata: {
        action: 'publish',
        anchorKind: anchor.kind,
        revisionNumber: nextNumber,
        changeSummary: input.changeSummary?.trim() ?? null,
        republished: isRepublish,
        aiAssisted: item.aiAssisted,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    // P4-S1 §17 / P6-S2: a published/republished representation re-projects
    // its anchor's documents (new language variant, new title/body text, new
    // freshness) — unit documents for unit items, event documents for event
    // items (the event page is the public surface).
    if (anchor.kind === 'event') {
      await onEventChanged(anchor.slug)
    } else {
      await onUnitChanged(anchor.slug)
    }

    // P8-S2 §27 notification triggers — best-effort by contract (a
    // notification failure NEVER fails the publish; the §19/§25 moment is
    // the source of truth, recorded above):
    //  - an event's FIRST published representation = the current-affairs
    //    item going publicly live → followers of the mapped exams/topics
    //    (the §12 step 5 chain) hear about it;
    //  - a unit representation's REPUBLISH (isRepublish — the mandatory
    //    change summary is the §25 correction cycle) → the unit's savers
    //    hear first (§27 "Correction published to a previously saved item").
    try {
      if (anchor.kind === 'event' && item.currentEventId && !isRepublish) {
        await notifyEventPublished(item.currentEventId)
      } else if (anchor.kind === 'unit' && item.knowledgeUnitId && isRepublish) {
        await notifyCorrectionPublished(item.knowledgeUnitId, {
          languageCode: item.language.code,
          changeSummary: input.changeSummary?.trim() ?? 'A corrected revision went live.',
          revisionNumber: nextNumber,
        })
      }
    } catch (notificationError) {
      console.error('[content:publish] notification trigger failed (publish stands):', notificationError)
    }

    const refreshed = await loadItem(item.id)
    return toAdminItem(actor, refreshed!)
  }

  // ---------- schedule: approve for future release (§19 step 7) ----------
  if (input.action === 'schedule') {
    const when = input.scheduledFor ? new Date(input.scheduledFor) : null
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new ContentError(
        'SCHEDULED_FOR_REQUIRED',
        'A valid future release time is required to schedule content (§19 step 7)'
      )
    }
    // P6-S2: the same anchor publish gate as publish (§36/§7).
    if (anchor.kind === 'event') {
      if (anchor.archived) {
        throw new ContentError(
          'EVENT_ARCHIVED',
          'This event is archived and read-only (§36) — reopen it via a lifecycle transition before scheduling its representations'
        )
      }
    } else if (!anchor.publishable) {
      throw new ContentError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${item.knowledgeUnit?.status} — only VERIFIED units' content can be scheduled (a representation is never more visible than its record)`
      )
    }
    const formatCheck = bodyFitsFormat(item.format as ContentFormatPublic, item.body)
    if (!formatCheck.ok) {
      throw new ContentError('FORMAT_BODY_INVALID', formatCheck.message)
    }

    const updatedSchedule = await db.$transaction(async (tx) => {
      const row = await tx.contentItem.update({
        where: { id: item.id },
        data: { status: 'SCHEDULED', scheduledForAt: when },
        include: ITEM_INCLUDE,
      })
      // §19 wiring: the review cycle is complete (approval happened here);
      // open work items resolve as "scheduled".
      await wireContentWorkflow(tx, {
        action: 'schedule',
        actorId: actor.userId,
        item: workflowItemOf(item),
      })
      return row
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentItemTransition,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: item.id,
      objectLabel: anchorLabel(anchor, item.language.code, item.format),
      before: { status: item.status },
      after: { status: 'SCHEDULED', scheduledFor: when.toISOString() },
      metadata: { action: 'schedule', scheduledFor: when.toISOString() },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    return toAdminItem(actor, updatedSchedule)
  }

  // ---------- simple transitions (submit_review / send_back / retire) ----------
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.contentItem.update({
      where: { id: item.id },
      data: {
        status: target,
        // send_back from SCHEDULED cancels the pending release (§19).
        ...(input.action === 'send_back' ? { scheduledForAt: null } : {}),
      },
      include: ITEM_INCLUDE,
    })
    // §19 wiring: submit_review opens the review task; send_back resolves the
    // cycle; retire cancels open work — all inside the same transaction.
    await wireContentWorkflow(tx, {
      action: input.action,
      actorId: actor.userId,
      item: workflowItemOf(item),
    })
    return row
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemTransition,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: anchorLabel(anchor, item.language.code, item.format),
    before: { status: item.status },
    after: {
      status: target,
      ...(input.action === 'send_back' && item.scheduledForAt
        ? { scheduledForCleared: item.scheduledForAt.toISOString() }
        : {}),
    },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17/§19 step 10: retiring withdraws a public representation — the
  // anchor's documents are re-projected (and an anchor whose last
  // representation in a language retired loses that language's document, §35).
  if (input.action === 'retire') {
    if (anchor.kind === 'event') {
      await onEventChanged(anchor.slug)
    } else {
      await onUnitChanged(anchor.slug)
    }
  }

  return toAdminItem(actor, updated)
}
