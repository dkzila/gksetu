/**
 * GlobIQ — Current Affairs module: DTOs (P6-S1)
 * Master Plan §6 (CurrentEvent row: id, event_date, location, entities→P6-S3,
 * summary, significance, lifecycle_state), §12 (Current Affairs Architecture —
 * event-centric, not article-centric), §14 (GLOBAL/COUNTRY scope), §16 (the
 * immutable slug for /current-affairs/{slug}/), §24 (aggregated Source
 * evidence with verification states), §36 (lifecycle + no silent edits),
 * §37 (client-agnostic DTOs, server-computed affordances).
 */

/** §12 step 6 lifecycle states (manual machine; P6-S5 adds automated rules). */
export type CurrentEventLifecyclePublic = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'

export const CURRENT_EVENT_LIFECYCLES: CurrentEventLifecyclePublic[] = [
  'EMERGING',
  'DEVELOPING',
  'STABLE',
  'ARCHIVED',
]

/**
 * Lifecycle state machine — single source for service + UI, mirroring the
 * shared-state-machine pattern of KNOWLEDGE_TRANSITIONS / CONTENT_TRANSITIONS
 * (§12 step 6 "emerging → developing → stable → archived").
 *
 * - Forward progression: EMERGING → DEVELOPING/STABLE (a clear picture may
 *   skip DEVELOPING), then → ARCHIVED.
 * - DEVELOPING → EMERGING and STABLE → DEVELOPING reopen the record when new
 *   reporting changes the picture (corrections, follow-up developments).
 * - ARCHIVED → DEVELOPING/STABLE is the explicit editorial reopen (§36
 *   end-of-life is honest, not destructive); P6-S5's automated freshness
 *   rules will drive the → ARCHIVED direction.
 */
export const CURRENT_EVENT_TRANSITIONS: Record<
  CurrentEventLifecyclePublic,
  CurrentEventLifecyclePublic[]
> = {
  EMERGING: ['DEVELOPING', 'STABLE', 'ARCHIVED'],
  DEVELOPING: ['STABLE', 'EMERGING', 'ARCHIVED'],
  STABLE: ['ARCHIVED', 'DEVELOPING'],
  ARCHIVED: ['DEVELOPING', 'STABLE'],
}

/** Human-readable one-liners for the lifecycle states (UI + docs). */
export const LIFECYCLE_DESCRIPTIONS: Record<CurrentEventLifecyclePublic, string> = {
  EMERGING: 'Breaking/tracked — sources being aggregated (§12 step 1).',
  DEVELOPING: 'More sources/context accumulating — corrections expected.',
  STABLE: 'The established canonical understanding of the event.',
  ARCHIVED: 'End-of-life — read-only; reopen explicitly if the story returns.',
}

/** §14 scope of the event record (same vocabulary as KnowledgeUnit). */
export type EventScopePublic = 'GLOBAL' | 'COUNTRY'

export const EVENT_SCOPES: EventScopePublic[] = ['GLOBAL', 'COUNTRY']

/** §13 primary canonical topic reference. */
export interface EventTopicRef {
  slug: string
  name: string
}

/** §12 step 2: one aggregated Source on an event (admin view). */
export interface AdminEventSourceLink {
  id: string
  isPrimary: boolean
  note: string | null
  linkedAt: string
  source: {
    id: string
    title: string
    publisher: string
    url: string
    type: string
    verification: string
    publishedAt: string | null
    retrievedAt: string
    verifiedAt: string | null
  }
}

/** §12 step 3: one linked canonical KnowledgeUnit (admin view). */
export interface AdminEventKnowledgeUnitLink {
  id: string
  note: string | null
  linkedAt: string
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string
    type: string
    topicSlug: string | null
  }
}

/** P6-S3 §12 step 3: one linked Entity — who/what the event is about. */
export interface AdminEventEntityLink {
  id: string
  note: string | null
  linkedAt: string
  entity: {
    id: string
    slug: string
    canonicalName: string
    type: string
    status: string
    scope: string
    countryIso: string | null
    description: string | null
  }
}

/** P6-S3 §12 step 3: one additional canonical topic cross-filing. */
export interface AdminEventTopicLink {
  id: string
  note: string | null
  linkedAt: string
  topic: {
    id: string
    slug: string
    canonicalName: string
    type: string
    status: string
    scope: string
    countryIso: string | null
  }
}

/** List row (admin). */
export interface AdminCurrentEvent {
  id: string
  slug: string
  title: string
  eventDate: string
  eventEndDate: string | null
  location: string | null
  summary: string
  significance: string | null
  lifecycleState: CurrentEventLifecyclePublic
  scope: EventScopePublic
  countryIso: string | null
  topic: EventTopicRef
  notes: string | null
  sourceCount: number
  unitCount: number
  entityCount: number
  additionalTopicCount: number
  hasPrimarySource: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

/** Detail (admin): the full aggregation surface + server affordances (§37). */
export interface AdminCurrentEventDetail extends AdminCurrentEvent {
  sources: AdminEventSourceLink[]
  knowledgeUnits: AdminEventKnowledgeUnitLink[]
  /** P6-S3 §12 step 3 — the entity + additional-topic linking layer. */
  entities: AdminEventEntityLink[]
  additionalTopics: AdminEventTopicLink[]
  /** Lifecycle affordances from server truth (§20/§37). */
  allowedTransitions: CurrentEventLifecyclePublic[]
  /** §36: ARCHIVED events are read-only (affordance for clients). */
  editable: boolean
}

export interface CurrentEventPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminCurrentEventListResult {
  events: AdminCurrentEvent[]
  pagination: CurrentEventPagination
  /** Counts across the whole visible scope — the editorial §12 overview. */
  summary: Record<CurrentEventLifecyclePublic, number>
}

/** Result of attaching a source — tells the editor whether the evidence was
 * reused from the shared registry (§11 URL dedup) or newly registered. */
export interface AttachEventSourceResult {
  link: AdminEventSourceLink
  sourceCreated: boolean
  /** Existing Source record was reused by normalized URL (the §12 aggregation
   *  philosophy: one evidence record, many objects). */
  sourceReused: boolean
}
