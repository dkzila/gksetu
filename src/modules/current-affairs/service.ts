/**
 * GlobIQ — Current Affairs domain service (P6-S1)
 * Master Plan §12 (Current Affairs Architecture — event-centric, not
 * article-centric: create ONE CurrentEvent for the real-world event, attach
 * one or more Source records, attach relevant KnowledgeUnits, keep lifecycle
 * states emerging → developing → stable → archived, allow corrections and
 * source updates with full audit history), §6 (CurrentEvent row), §7 (the
 * §12 step 3 links point at canonical units — facts are never re-entered),
 * §14/§20 (GLOBAL events are ADMIN-managed like all global objects;
 * COUNTRY events belong to exactly one market — enforced at the service
 * boundary, never by UI hiding), §16 (immutable, URL-stable slugs for
 * /current-affairs/{slug}/), §24 (aggregated evidence reuses the shared
 * Source registry — one record per URL), §36 (ARCHIVED is read-only;
 * reopenable via explicit transition; every mutation audited), §37
 * (deterministic ordering, stable ids, typed errors), §38 (scoped console).
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import { findActiveCountryByIso } from '@/modules/country-locale'
import { getTopicIdentity } from '@/modules/taxonomy'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import { normalizeSourceUrl } from '@/modules/knowledge'

import type {
  AdminCurrentEvent,
  AdminCurrentEventDetail,
  AdminCurrentEventListResult,
  AdminEventKnowledgeUnitLink,
  AdminEventSourceLink,
  AttachEventSourceResult,
  CurrentEventLifecyclePublic,
  EventScopePublic,
  EventTopicRef,
} from './types'
import { CURRENT_EVENT_TRANSITIONS } from './types'
import type { AdminCurrentEventListQuery } from './validation'
import type {
  AttachEventKnowledgeUnitInput,
  AttachEventSourceInput,
  CreateCurrentEventInput,
  CurrentEventTransitionInput,
  UpdateCurrentEventInput,
  UpdateEventSourceLinkInput,
} from './validation'
import { EVENT_SLUG_PATTERN } from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type CurrentAffairsErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_SLUG_TAKEN'
  | 'INVALID_SLUG'
  | 'EVENT_ARCHIVED'
  | 'INVALID_TRANSITION'
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_NOT_ATTACHABLE'
  | 'TOPIC_SCOPE_MISMATCH'
  | 'COUNTRY_NOT_FOUND'
  | 'COUNTRY_REQUIRED'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_EVENTS_ADMIN_ONLY'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_ALREADY_LINKED'
  | 'SOURCE_UNRELIABLE'
  | 'LINK_NOT_FOUND'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_NOT_VERIFIED'
  | 'UNIT_ALREADY_LINKED'
  | 'UNIT_LINK_NOT_FOUND'
  | 'EVENT_DENIED'

const ERROR_STATUS: Record<CurrentAffairsErrorCode, number> = {
  EVENT_NOT_FOUND: 404,
  EVENT_SLUG_TAKEN: 409,
  INVALID_SLUG: 400,
  EVENT_ARCHIVED: 409,
  INVALID_TRANSITION: 409,
  TOPIC_NOT_FOUND: 400,
  TOPIC_NOT_ATTACHABLE: 400,
  TOPIC_SCOPE_MISMATCH: 400,
  COUNTRY_NOT_FOUND: 400,
  COUNTRY_REQUIRED: 400,
  COUNTRY_MISMATCH: 403,
  GLOBAL_EVENTS_ADMIN_ONLY: 403,
  SOURCE_NOT_FOUND: 404,
  SOURCE_ALREADY_LINKED: 409,
  SOURCE_UNRELIABLE: 409,
  LINK_NOT_FOUND: 404,
  UNIT_NOT_FOUND: 404,
  UNIT_NOT_VERIFIED: 409,
  UNIT_ALREADY_LINKED: 409,
  UNIT_LINK_NOT_FOUND: 404,
  EVENT_DENIED: 403,
}

export class CurrentAffairsError extends Error {
  readonly code: CurrentAffairsErrorCode
  readonly status: number

  constructor(code: CurrentAffairsErrorCode, message: string) {
    super(message)
    this.name = 'CurrentAffairsError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown CurrentAffairsError to envelope data (§37); null for others. */
export function toCurrentAffairsErrorResponse(
  error: unknown
): { message: string; code: CurrentAffairsErrorCode; status: number } | null {
  if (error instanceof CurrentAffairsError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

type EventRow = Prisma.CurrentEventGetPayload<{
  include: {
    country: true
    topic: true
    createdBy: true
    sources: { include: { source: true } }
    knowledgeUnits: { include: { knowledgeUnit: { include: { topic: true } } } }
  }
}>

/** The single include shape used by every event read — one mapper. */
const EVENT_INCLUDE = {
  country: true,
  topic: true,
  createdBy: true,
  sources: {
    include: { source: true },
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
  },
  knowledgeUnits: {
    include: { knowledgeUnit: { include: { topic: true } } },
    orderBy: [{ createdAt: 'asc' as const }],
  },
}

async function loadEvent(id: string): Promise<EventRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.currentEvent.findUnique({ where: { id }, include: EVENT_INCLUDE })
}

/** §14 target for the shared permission layer: null = GLOBAL (ADMIN-only). */
function targetOfEvent(event: Pick<EventRow, 'scope' | 'countryId'>): { countryId: string | null } {
  return { countryId: event.scope === 'COUNTRY' ? event.countryId : null }
}

/** Visibility for reads: ADMIN everything; COUNTRY_ADMIN + WRITER (P6-S2 —
 * writers author event representations) global + own market. */
function canReadEvent(
  actor: Actor,
  event: Pick<EventRow, 'scope' | 'countryId'>
): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    return event.scope === 'GLOBAL' || event.countryId === actor.countryId
  }
  return false
}

/** Object-level mutation permission + denial audit (§20 signal — the
 *  knowledge/content/source pattern). WRITER never reaches here: the route
 *  guard already requires current-affairs:manage (ADMIN + COUNTRY_ADMIN). */
async function assertCanManageEvent(
  actor: Actor,
  event: EventRow,
  operation: string,
  meta?: AuditRequestMeta
): Promise<void> {
  if (can(actor, 'current-affairs:manage', targetOfEvent(event))) return
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventDenied,
    objectType: AUDIT_OBJECT_TYPES.currentEvent,
    objectId: event.id,
    objectLabel: event.slug,
    before: { lifecycleState: event.lifecycleState, scope: event.scope },
    metadata: {
      attemptedOperation: operation,
      reason:
        actor.role === 'COUNTRY_ADMIN'
          ? event.scope === 'GLOBAL'
            ? 'GLOBAL_EVENTS_ADMIN_ONLY'
            : 'COUNTRY_MISMATCH'
          : 'ROLE',
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined)
  if (actor.role === 'COUNTRY_ADMIN') {
    if (event.scope === 'GLOBAL') {
      throw new CurrentAffairsError(
        'GLOBAL_EVENTS_ADMIN_ONLY',
        'Country admins cannot modify global events — global current affairs is an admin-managed record'
      )
    }
    throw new CurrentAffairsError(
      'COUNTRY_MISMATCH',
      'You can only manage your own country\u2019s events'
    )
  }
  throw new CurrentAffairsError('EVENT_DENIED', 'You do not have permission to manage this event')
}

/** §36: ARCHIVED is end-of-life read-only — the explicit reopen transition is
 *  the only way forward from it. */
function assertEditable(event: EventRow): void {
  if (event.lifecycleState === 'ARCHIVED') {
    throw new CurrentAffairsError(
      'EVENT_ARCHIVED',
      'This event is archived and read-only (§36) — reopen it via a lifecycle transition before editing'
    )
  }
}

/** §16 slug hygiene: kebab-case from the title, deterministic, uniqueness via
 *  a numeric suffix. The router never concatenates arbitrary user input. */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '')
}

async function resolveUniqueSlug(desired: string): Promise<string> {
  const base = EVENT_SLUG_PATTERN.test(desired) ? desired : slugifyTitle(desired)
  if (!EVENT_SLUG_PATTERN.test(base)) {
    throw new CurrentAffairsError('INVALID_SLUG', 'Could not derive a kebab-case slug from this title')
  }
  let candidate = base
  let suffix = 2
  // Deterministic + bounded: suffix search, never arbitrary input (§16).
  while (suffix < 100) {
    const taken = await db.currentEvent.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!taken) return candidate
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  throw new CurrentAffairsError('EVENT_SLUG_TAKEN', 'Could not derive a free slug for this event')
}

function topicRefOf(event: EventRow): EventTopicRef {
  return { slug: event.topic.slug, name: event.topic.canonicalName }
}

function toAdminEvent(event: EventRow): AdminCurrentEvent {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    eventDate: event.eventDate.toISOString(),
    eventEndDate: event.eventEndDate?.toISOString() ?? null,
    location: event.location,
    summary: event.summary,
    significance: event.significance,
    lifecycleState: event.lifecycleState as CurrentEventLifecyclePublic,
    scope: event.scope as EventScopePublic,
    countryIso: event.country?.isoCode ?? null,
    topic: topicRefOf(event),
    notes: event.notes,
    sourceCount: event.sources.length,
    unitCount: event.knowledgeUnits.length,
    hasPrimarySource: event.sources.some((link) => link.isPrimary),
    createdByEmail: event.createdBy?.email ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  }
}

function toAdminEventDetail(event: EventRow): AdminCurrentEventDetail {
  const lifecycle = event.lifecycleState as CurrentEventLifecyclePublic
  return {
    ...toAdminEvent(event),
    sources: event.sources.map(
      (link): AdminEventSourceLink => ({
        id: link.id,
        isPrimary: link.isPrimary,
        note: link.note,
        linkedAt: link.createdAt.toISOString(),
        source: {
          id: link.source.id,
          title: link.source.title,
          publisher: link.source.publisher,
          url: link.source.url,
          type: link.source.type,
          verification: link.source.verification,
          publishedAt: link.source.publishedAt?.toISOString() ?? null,
          retrievedAt: link.source.retrievedAt.toISOString(),
          verifiedAt: link.source.verifiedAt?.toISOString() ?? null,
        },
      })
    ),
    knowledgeUnits: event.knowledgeUnits.map(
      (link): AdminEventKnowledgeUnitLink => ({
        id: link.id,
        note: link.note,
        linkedAt: link.createdAt.toISOString(),
        unit: {
          id: link.knowledgeUnit.id,
          slug: link.knowledgeUnit.slug,
          canonicalName: link.knowledgeUnit.canonicalName,
          status: link.knowledgeUnit.status,
          type: link.knowledgeUnit.type,
          topicSlug: link.knowledgeUnit.topic.slug,
        },
      })
    ),
    // Affordances from server truth (§20/§37) — the §12 step 6 state machine.
    allowedTransitions: CURRENT_EVENT_TRANSITIONS[lifecycle],
    editable: lifecycle !== 'ARCHIVED',
  }
}

/** Audit snapshot (§30 — summaries only, notes redacted to length). */
function eventSnapshot(event: EventRow) {
  return {
    slug: event.slug,
    title: event.title,
    eventDate: event.eventDate.toISOString(),
    eventEndDate: event.eventEndDate?.toISOString() ?? null,
    location: event.location,
    lifecycleState: event.lifecycleState,
    scope: event.scope,
    countryIso: event.country?.isoCode ?? null,
    topicSlug: event.topic.slug,
    summaryLength: event.summary.length,
    significanceLength: event.significance?.length ?? 0,
    sourceCount: event.sources.length,
    unitCount: event.knowledgeUnits.length,
  }
}

/** Resolve a §12 step 2 attach payload to a Source row — the §11 dedup
 *  philosophy applied to evidence: an already-registered URL reuses its
 *  record (with its verification state); otherwise a new UNVERIFIED record is
 *  registered (§24 — every new evidence record starts unverified). */
async function resolveSourceForAttach(
  actor: Actor,
  input: AttachEventSourceInput
): Promise<{ sourceId: string; created: boolean; reused: boolean }> {
  if (input.source) {
    if (!CUID_PATTERN.test(input.source)) {
      throw new CurrentAffairsError('SOURCE_NOT_FOUND', 'Source not found')
    }
    const existing = await db.source.findUnique({ where: { id: input.source } })
    if (!existing) throw new CurrentAffairsError('SOURCE_NOT_FOUND', 'Source not found')
    assertReliable(existing.verification)
    return { sourceId: existing.id, created: false, reused: false }
  }

  const url = normalizeSourceUrl(input.url!)
  if (!url) throw new CurrentAffairsError('SOURCE_NOT_FOUND', 'Enter a valid http(s) URL')

  const existing = await db.source.findUnique({ where: { url } })
  if (existing) {
    // The §24 trust rule rides the reuse path too: an already-registered URL
    // whose record was revoked cannot be aggregated onto NEW events.
    assertReliable(existing.verification)
    return { sourceId: existing.id, created: false, reused: true }
  }

  assertCan(actor, 'source:manage') // registering new evidence (§24 registry)
  const created = await db.source.create({
    data: {
      title: input.title!,
      publisher: input.publisher!,
      url,
      type: input.type!,
      verification: 'UNVERIFIED',
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
      retrievedAt: new Date(),
      createdById: actor.userId,
    },
  })
  return { sourceId: created.id, created: true, reused: false }
}

/** §24 trust rule, the P2-S3 link precedent: UNRELIABLE evidence cannot be
 *  attached to NEW objects — existing links remain as preserved provenance
 *  history (§36), which is why seeded/detached rows stay honest. */
function assertReliable(verification: string): void {
  if (verification === 'UNRELIABLE') {
    throw new CurrentAffairsError(
      'SOURCE_UNRELIABLE',
      'This source is marked UNRELIABLE — revoked evidence cannot be aggregated onto new events (§24). Existing links remain as preserved history.'
    )
  }
}

/** Swap the primary flag inside one event: at most one lead source (§12). */
async function applyPrimarySwap(
  eventId: string,
  linkId: string,
  makePrimary: boolean
): Promise<void> {
  if (!makePrimary) return
  await db.currentEventSource.updateMany({
    where: { currentEventId: eventId, isPrimary: true, id: { not: linkId } },
    data: { isPrimary: false },
  })
}

// ---------- Reads (admin) ----------

/** Admin list (§38): ADMIN sees everything; COUNTRY_ADMIN sees GLOBAL
 *  (read-only surface) + own-country events. Filters: search, lifecycle,
 *  scope, country, topic; deterministic eventDate-desc ordering (§37). */
export async function getAdminEvents(
  actor: Actor,
  query: AdminCurrentEventListQuery
): Promise<AdminCurrentEventListResult> {
  // P6-S2: writers read the event list too — they author event
  // representations (content:manage) and need the anchor directory. Mutations
  // still require current-affairs:manage (the route guards + service checks);
  // this is the same "see the board's context" read parity as unit content.
  if (
    !can(actor, 'current-affairs:manage') &&
    !can(actor, 'content:manage')
  ) {
    throw new CurrentAffairsError(
      'EVENT_DENIED',
      'Viewing the event workspace requires current-affairs or content permissions'
    )
  }

  // §14/§20 read visibility — country staff never see other markets' events.
  let ownCountryId: string | null = null
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') ownCountryId = actor.countryId

  const countryFilter: Prisma.CurrentEventWhereInput = {}
  if (query.country) {
    const country = await db.country.findUnique({ where: { isoCode: query.country } })
    countryFilter.countryId = country?.id ?? 'none'
  }

  // COUNTRY_ADMIN/WRITER visibility: GLOBAL events + own market's events.
  const visibility: Prisma.CurrentEventWhereInput | undefined = ownCountryId
    ? { OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: ownCountryId }] }
    : undefined

  const where: Prisma.CurrentEventWhereInput = {
    AND: [
      ...(visibility ? [visibility] : []),
      {
        ...(query.lifecycle ? { lifecycleState: query.lifecycle } : {}),
        ...(query.scope ? { scope: query.scope } : {}),
        ...(query.topic ? { topic: { slug: query.topic } } : {}),
        ...(query.country || query.scope === 'COUNTRY' ? countryFilter : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { summary: { contains: query.q, mode: 'insensitive' } },
                { slug: { contains: query.q, mode: 'insensitive' } },
                { location: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    ],
  }

  const [rows, total, grouped] = await Promise.all([
    db.currentEvent.findMany({
      where,
      orderBy: [{ eventDate: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: EVENT_INCLUDE,
    }),
    db.currentEvent.count({ where }),
    db.currentEvent.groupBy({
      by: ['lifecycleState'],
      _count: { _all: true },
      where: visibility,
    }),
  ])

  const summary: Record<CurrentEventLifecyclePublic, number> = {
    EMERGING: 0,
    DEVELOPING: 0,
    STABLE: 0,
    ARCHIVED: 0,
  }
  for (const group of grouped) {
    summary[group.lifecycleState as CurrentEventLifecyclePublic] = group._count._all
  }

  return {
    events: rows.map(toAdminEvent),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary,
  }
}

/** Admin detail — the full §12 aggregation surface (sources + canonical
 *  KnowledgeUnit links) with server affordances. */
export async function getAdminEvent(actor: Actor, id: string): Promise<AdminCurrentEventDetail> {
  // P6-S2: same read parity as the list — content:manage holders (writers)
  // may READ the event surface to anchor their representations; every
  // mutation still requires current-affairs:manage.
  if (
    !can(actor, 'current-affairs:manage') &&
    !can(actor, 'content:manage')
  ) {
    throw new CurrentAffairsError(
      'EVENT_DENIED',
      'Viewing the event workspace requires current-affairs or content permissions'
    )
  }
  const event = await loadEvent(id)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  if (!canReadEvent(actor, event)) {
    throw new CurrentAffairsError(
      'COUNTRY_MISMATCH',
      'You can only view global events and your own country\u2019s events'
    )
  }
  return toAdminEventDetail(event)
}

// ---------- Writes (admin) ----------

/** §12 step 1: create the event for the real-world event/topic — the
 *  anti-fragmentation move ("five publishers covering the same event" become
 *  one row with aggregated sources, never five unrelated objects). */
export async function createCurrentEvent(
  actor: Actor,
  input: CreateCurrentEventInput,
  meta: AuditRequestMeta = {}
): Promise<AdminCurrentEventDetail> {
  assertCan(actor, 'current-affairs:manage')

  // §13 primary canonical topic — must exist and be attachable (ACTIVE).
  const topic = await getTopicIdentity(input.topic)
  if (!topic) throw new CurrentAffairsError('TOPIC_NOT_FOUND', `Unknown topic "${input.topic}"`)
  if (topic.status !== 'ACTIVE') {
    throw new CurrentAffairsError(
      'TOPIC_NOT_ATTACHABLE',
      `Topic "${topic.slug}" is ${topic.status.toLowerCase()} — events attach only to active topics`
    )
  }

  // Country scope resolution (§14: explicit, never inferred — a country
  // admin's own home country may be implied, the knowledge precedent).
  let countryId: string | null = null
  let countryIso: string | null = null
  if (input.scope === 'COUNTRY') {
    if (input.country) {
      const country = await findActiveCountryByIso(input.country)
      if (!country) {
        throw new CurrentAffairsError('COUNTRY_NOT_FOUND', `Unknown or inactive country "${input.country}"`)
      }
      if (actor.role === 'COUNTRY_ADMIN' && country.id !== actor.countryId) {
        await noteDenied(actor, 'create', 'COUNTRY_MISMATCH', null, input.slug ?? input.title, meta)
        throw new CurrentAffairsError(
          'COUNTRY_MISMATCH',
          'You can only create events for your own country'
        )
      }
      countryId = country.id
      countryIso = country.isoCode
    } else if (actor.role === 'COUNTRY_ADMIN' && actor.countryId) {
      countryId = actor.countryId
      const own = await db.country.findUnique({ where: { id: actor.countryId } })
      countryIso = own?.isoCode ?? null
    } else {
      throw new CurrentAffairsError('COUNTRY_REQUIRED', 'Country is required for country-scoped events')
    }
  } else if (actor.role === 'COUNTRY_ADMIN') {
    await noteDenied(actor, 'create', 'GLOBAL_EVENTS_ADMIN_ONLY', null, input.slug ?? input.title, meta)
    throw new CurrentAffairsError(
      'GLOBAL_EVENTS_ADMIN_ONLY',
      'Country admins can only create country-scoped events'
    )
  }

  // Scope-vs-topic invariant (§13/§14 containment, the knowledge precedent).
  if (topic.scope === 'COUNTRY') {
    if (input.scope !== 'COUNTRY' || countryId !== topic.countryId) {
      throw new CurrentAffairsError(
        'TOPIC_SCOPE_MISMATCH',
        `Topic "${topic.slug}" is scoped to ${topic.countryIso} — events under it must share that country scope`
      )
    }
  }

  // §16: an EXPLICIT slug is identity — a clash is a 409, never a silent
  // suffix (the KU/taxonomy precedent). Only auto-generated slugs (from the
  // title) get the deterministic -2/-3 suffix treatment.
  let slug: string
  if (input.slug) {
    if (!EVENT_SLUG_PATTERN.test(input.slug)) {
      throw new CurrentAffairsError('INVALID_SLUG', 'Slug must be kebab-case (a-z, 0-9, hyphens)')
    }
    const taken = await db.currentEvent.findUnique({ where: { slug: input.slug }, select: { id: true } })
    if (taken) {
      throw new CurrentAffairsError(
        'EVENT_SLUG_TAKEN',
        `Slug "${input.slug}" is already in use — slugs are immutable identity (§16)`
      )
    }
    slug = input.slug
  } else {
    slug = await resolveUniqueSlug(input.title)
  }
  const eventDate = new Date(input.eventDate)
  const eventEndDate = input.eventEndDate ? new Date(input.eventEndDate) : null

  // §12 step 2 in the same call: aggregate the initial evidence. URLs are
  // deduped against the shared Source registry (§11/§24) — a URL already
  // registered for other content reuses its record and verification state.
  const initialSourceRows: Array<{
    sourceId: string
    created: boolean
    isPrimary: boolean
    note: string | null
  }> = []
  if (input.initialSources?.length) {
    for (const source of input.initialSources) {
      const url = normalizeSourceUrl(source.url)
      if (!url) throw new CurrentAffairsError('SOURCE_NOT_FOUND', 'Enter a valid http(s) URL')
      const existing = await db.source.findUnique({ where: { url } })
      if (existing) {
        initialSourceRows.push({
          sourceId: existing.id,
          created: false,
          isPrimary: source.isPrimary ?? false,
          note: source.note ?? null,
        })
        continue
      }
      assertCan(actor, 'source:manage') // registering new evidence (§24)
      const created = await db.source.create({
        data: {
          title: source.title,
          publisher: source.publisher,
          url,
          type: source.type,
          verification: 'UNVERIFIED',
          publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
          retrievedAt: new Date(),
          createdById: actor.userId,
        },
      })
      initialSourceRows.push({
        sourceId: created.id,
        created: true,
        isPrimary: source.isPrimary ?? false,
        note: source.note ?? null,
      })
    }
  }

  const created = await db.currentEvent.create({
    data: {
      slug,
      title: input.title,
      eventDate,
      eventEndDate,
      location: input.location ?? null,
      summary: input.summary,
      significance: input.significance ?? null,
      lifecycleState: 'EMERGING', // §12: every event starts emerging
      scope: input.scope,
      countryId,
      topicId: topic.id,
      notes: input.notes ?? null,
      createdById: actor.userId,
      ...(initialSourceRows.length
        ? {
            sources: {
              create: initialSourceRows.map((row) => ({
                sourceId: row.sourceId,
                isPrimary: row.isPrimary,
                note: row.note,
              })),
            },
          }
        : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventCreate,
    objectType: AUDIT_OBJECT_TYPES.currentEvent,
    objectId: created.id,
    objectLabel: created.slug,
    after: {
      slug: created.slug,
      title: created.title,
      eventDate: created.eventDate.toISOString(),
      lifecycleState: created.lifecycleState,
      scope: created.scope,
      countryIso,
      topicSlug: topic.slug,
    },
    metadata: {
      initialSourceCount: initialSourceRows.length,
      registeredNewSources: initialSourceRows.filter((row) => row.created).length,
      reusedSources: initialSourceRows.filter((row) => !row.created).length,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const detail = await loadEvent(created.id)
  return toAdminEventDetail(detail!)
}

/** Metadata edits (§36 audited; slug + scope immutable; ARCHIVED read-only). */
export async function updateCurrentEvent(
  actor: Actor,
  id: string,
  input: UpdateCurrentEventInput,
  meta: AuditRequestMeta = {}
): Promise<AdminCurrentEventDetail> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(id)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'update', meta)
  assertEditable(event)

  // Topic re-anchoring keeps the §13/§14 containment invariant.
  let topicId: string | undefined
  if (input.topic && input.topic !== event.topic.slug) {
    const topic = await getTopicIdentity(input.topic)
    if (!topic) throw new CurrentAffairsError('TOPIC_NOT_FOUND', `Unknown topic "${input.topic}"`)
    if (topic.status !== 'ACTIVE') {
      throw new CurrentAffairsError(
        'TOPIC_NOT_ATTACHABLE',
        `Topic "${topic.slug}" is ${topic.status.toLowerCase()} — events attach only to active topics`
      )
    }
    if (topic.scope === 'COUNTRY') {
      if (event.scope !== 'COUNTRY' || event.countryId !== topic.countryId) {
        throw new CurrentAffairsError(
          'TOPIC_SCOPE_MISMATCH',
          `Topic "${topic.slug}" is scoped to ${topic.countryIso} — this event cannot anchor on it`
        )
      }
    }
    topicId = topic.id
  }

  if (input.eventDate && input.eventEndDate !== null) {
    const endDate = input.eventEndDate ?? event.eventEndDate
    if (endDate && new Date(endDate).getTime() < new Date(input.eventDate).getTime()) {
      throw new CurrentAffairsError(
        'INVALID_TRANSITION',
        'The span end cannot be before the event date'
      )
    }
  }

  const before = eventSnapshot(event)
  const updated = await db.currentEvent.update({
    where: { id: event.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.eventDate !== undefined ? { eventDate: new Date(input.eventDate) } : {}),
      ...(input.eventEndDate !== undefined
        ? { eventEndDate: input.eventEndDate ? new Date(input.eventEndDate) : null }
        : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.significance !== undefined ? { significance: input.significance } : {}),
      ...(topicId !== undefined ? { topicId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  })

  const afterRow = (await loadEvent(updated.id))!
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventUpdate,
    objectType: AUDIT_OBJECT_TYPES.currentEvent,
    objectId: updated.id,
    objectLabel: updated.slug,
    before,
    after: eventSnapshot(afterRow),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminEventDetail(afterRow)
}

/** §12 step 6: the lifecycle state machine — emerging → developing → stable
 *  → archived with honest reopens; never a silent move (§36). */
export async function transitionCurrentEvent(
  actor: Actor,
  id: string,
  input: CurrentEventTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminCurrentEventDetail> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(id)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'transition', meta)

  const from = event.lifecycleState as CurrentEventLifecyclePublic
  const allowed = CURRENT_EVENT_TRANSITIONS[from]
  if (from === input.to) {
    throw new CurrentAffairsError(
      'INVALID_TRANSITION',
      `The event is already ${from.toLowerCase()}`
    )
  }
  if (!allowed.includes(input.to)) {
    throw new CurrentAffairsError(
      'INVALID_TRANSITION',
      `Cannot move an event from ${from} to ${input.to} — allowed: ${allowed
        .map((state) => state.toLowerCase())
        .join(', ')}`
    )
  }

  const updated = await db.currentEvent.update({
    where: { id: event.id },
    data: { lifecycleState: input.to },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventTransition,
    objectType: AUDIT_OBJECT_TYPES.currentEvent,
    objectId: updated.id,
    objectLabel: updated.slug,
    before: { lifecycleState: from },
    after: { lifecycleState: input.to },
    metadata: { reason: input.reason ?? null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminEventDetail((await loadEvent(updated.id))!)
}

/** §12 step 2: aggregate one more Source onto the event — by existing id or
 *  by new URL (deduped). Detach never touches the shared Source record. */
export async function attachEventSource(
  actor: Actor,
  eventId: string,
  input: AttachEventSourceInput,
  meta: AuditRequestMeta = {}
): Promise<AttachEventSourceResult> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(eventId)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'attachSource', meta)
  assertEditable(event)

  const resolved = await resolveSourceForAttach(actor, input)
  const already = event.sources.find((link) => link.sourceId === resolved.sourceId)
  if (already) {
    throw new CurrentAffairsError(
      'SOURCE_ALREADY_LINKED',
      'This source is already aggregated on the event'
    )
  }

  const created = await db.currentEventSource.create({
    data: {
      currentEventId: event.id,
      sourceId: resolved.sourceId,
      isPrimary: input.isPrimary ?? event.sources.length === 0, // first source leads by default
      note: input.note ?? null,
    },
  })
  await applyPrimarySwap(event.id, created.id, input.isPrimary ?? false)

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventSourceLink,
    objectType: AUDIT_OBJECT_TYPES.currentEventSource,
    objectId: created.id,
    objectLabel: `${event.slug} ← ${resolved.sourceId}`,
    after: {
      eventSlug: event.slug,
      sourceId: resolved.sourceId,
      isPrimary: created.isPrimary,
      note: created.note,
    },
    metadata: {
      sourceCreated: resolved.created,
      sourceReusedFromRegistry: resolved.reused,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const detail = toAdminEventDetail((await loadEvent(event.id))!)
  const link = detail.sources.find((row) => row.id === created.id)!
  return {
    link,
    sourceCreated: resolved.created,
    sourceReused: resolved.reused,
  }
}

/** Update one aggregation link: the event-level note and/or the primary swap. */
export async function updateEventSourceLink(
  actor: Actor,
  eventId: string,
  linkId: string,
  input: UpdateEventSourceLinkInput,
  meta: AuditRequestMeta = {}
): Promise<AdminEventSourceLink> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(eventId)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'updateSourceLink', meta)
  assertEditable(event)

  const link = event.sources.find((row) => row.id === linkId)
  if (!link) throw new CurrentAffairsError('LINK_NOT_FOUND', 'Source link not found on this event')

  const updated = await db.currentEventSource.update({
    where: { id: link.id },
    data: {
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
    },
  })
  await applyPrimarySwap(event.id, updated.id, updated.isPrimary)

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventSourceUpdate,
    objectType: AUDIT_OBJECT_TYPES.currentEventSource,
    objectId: updated.id,
    objectLabel: `${event.slug} ← ${link.source.publisher}`,
    before: { isPrimary: link.isPrimary, note: link.note },
    after: { isPrimary: updated.isPrimary, note: updated.note },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const detail = toAdminEventDetail((await loadEvent(event.id))!)
  return detail.sources.find((row) => row.id === updated.id)!
}

/** Detach a source from the event — the link row goes, the shared Source
 *  record and every other link stay (§36 preserved provenance history). */
export async function detachEventSource(
  actor: Actor,
  eventId: string,
  linkId: string,
  meta: AuditRequestMeta = {}
): Promise<{ detached: true }> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(eventId)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'detachSource', meta)
  assertEditable(event)

  const link = event.sources.find((row) => row.id === linkId)
  if (!link) throw new CurrentAffairsError('LINK_NOT_FOUND', 'Source link not found on this event')

  await db.currentEventSource.delete({ where: { id: link.id } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventSourceUnlink,
    objectType: AUDIT_OBJECT_TYPES.currentEventSource,
    objectId: link.id,
    objectLabel: `${event.slug} ← ${link.source.publisher}`,
    before: { isPrimary: link.isPrimary, note: link.note, url: link.source.url },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { detached: true }
}

/** §12 step 3: link a canonical KnowledgeUnit (VERIFIED only — DRAFT/IN_REVIEW
 *  knowledge is not yet canonical truth; the §7 one-truth rule). */
export async function attachEventKnowledgeUnit(
  actor: Actor,
  eventId: string,
  input: AttachEventKnowledgeUnitInput,
  meta: AuditRequestMeta = {}
): Promise<AdminEventKnowledgeUnitLink> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(eventId)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'linkUnit', meta)
  assertEditable(event)

  const unit = await db.knowledgeUnit.findUnique({
    where: { slug: input.unit },
    include: { topic: true },
  })
  if (!unit) throw new CurrentAffairsError('UNIT_NOT_FOUND', `Unknown knowledge unit "${input.unit}"`)
  if (unit.status !== 'VERIFIED') {
    throw new CurrentAffairsError(
      'UNIT_NOT_VERIFIED',
      `Knowledge unit "${unit.slug}" is ${unit.status.toLowerCase()} — events link only VERIFIED canonical units (§7)`
    )
  }
  const already = event.knowledgeUnits.find((link) => link.knowledgeUnitId === unit.id)
  if (already) {
    throw new CurrentAffairsError('UNIT_ALREADY_LINKED', 'This knowledge unit is already linked to the event')
  }

  const created = await db.currentEventKnowledgeUnit.create({
    data: {
      currentEventId: event.id,
      knowledgeUnitId: unit.id,
      note: input.note ?? null,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventUnitLink,
    objectType: AUDIT_OBJECT_TYPES.currentEventKnowledgeUnit,
    objectId: created.id,
    objectLabel: `${event.slug} → ${unit.slug}`,
    after: {
      eventSlug: event.slug,
      unitSlug: unit.slug,
      note: created.note,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return {
    id: created.id,
    note: created.note,
    linkedAt: created.createdAt.toISOString(),
    unit: {
      id: unit.id,
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      status: unit.status,
      type: unit.type,
      topicSlug: unit.topic.slug,
    },
  }
}

/** Detach a canonical unit link (§36 — audited, never a cascade surprise). */
export async function detachEventKnowledgeUnit(
  actor: Actor,
  eventId: string,
  linkId: string,
  meta: AuditRequestMeta = {}
): Promise<{ detached: true }> {
  assertCan(actor, 'current-affairs:manage')
  const event = await loadEvent(eventId)
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')
  await assertCanManageEvent(actor, event, 'unlinkUnit', meta)
  assertEditable(event)

  const link = event.knowledgeUnits.find((row) => row.id === linkId)
  if (!link) throw new CurrentAffairsError('UNIT_LINK_NOT_FOUND', 'Knowledge unit link not found on this event')

  await db.currentEventKnowledgeUnit.delete({ where: { id: link.id } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventUnitUnlink,
    objectType: AUDIT_OBJECT_TYPES.currentEventKnowledgeUnit,
    objectId: link.id,
    objectLabel: `${event.slug} → ${link.knowledgeUnit.slug}`,
    before: { note: link.note },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { detached: true }
}

// ---------- Internal: denial audit helper (create-path — no object row yet) ----------

async function noteDenied(
  actor: Actor,
  operation: string,
  reason: string,
  eventId: string | null,
  label: string | null,
  meta: AuditRequestMeta
): Promise<void> {
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.currentEventDenied,
    objectType: AUDIT_OBJECT_TYPES.currentEvent,
    objectId: eventId,
    objectLabel: label,
    metadata: { attemptedOperation: operation, reason },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  }).catch(() => undefined)
}
