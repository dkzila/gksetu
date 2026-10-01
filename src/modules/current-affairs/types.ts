/**
 * GKSetu — Current Affairs module: DTOs (P6-S1)
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

// ---------- P6-S5: freshness & archive rules (§12 step 6, §17, §19, §36) ----------

/**
 * The single rule table for BOTH directions of the freshness system
 * (Master Plan §12 step 6 — "emerging → developing → stable → archived";
 * §17 — freshness boosting for current affairs; §19 step 10 — archive):
 *
 *  - WRITE side (the sweep): an event older than a window's maximum age is
 *    prescribed the window's forward transition. Forward-only, never a
 *    reopen: EMERGING → DEVELOPING (past 3 days), → STABLE (past 30 days —
 *    a clear picture may skip DEVELOPING, the state machine's own edge),
 *    → ARCHIVED (past a year — §36 end-of-life, the page stays public as
 *    historical reference). ARCHIVED events are never touched.
 *  - READ side (the tiers): the same windows label every event for feeds
 *    and pages — the §17 freshness signal, deterministic and server-computed
 *    (§37) so every client renders the same verdict.
 *
 * Age is measured from `eventDate` (the §6 event_date — when it happened),
 * the only honest clock for a time-bound event.
 */
export const FRESHNESS_RULES = {
  /** An EMERGING event older than this is prescribed DEVELOPING. */
  emergingMaxDays: 3,
  /** Past this window an EMERGING/DEVELOPING event is prescribed STABLE. */
  developingMaxDays: 30,
  /** Past this window any live event is prescribed ARCHIVED (§36). */
  stableMaxDays: 365,
} as const

/** §17 read-side verdict, mirroring the rule windows above. */
export type FreshnessTier = 'FRESH' | 'RECENT' | 'SETTLED' | 'HISTORICAL'

export const FRESHNESS_TIERS: FreshnessTier[] = ['FRESH', 'RECENT', 'SETTLED', 'HISTORICAL']

/** Which window a sweep prescription came from (§37 — explainable rules). */
export type FreshnessRuleKey = 'PAST_EMERGING_WINDOW' | 'PAST_DEVELOPING_WINDOW' | 'PAST_STABLE_WINDOW'

/** Days since the §6 event_date, floored, never negative (future events are 0). */
export function freshnessAgeDays(eventDate: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - eventDate.getTime()) / 86_400_000))
}

/** The §17 tier of an age in days — one table, every surface. */
export function freshnessTierOf(ageDays: number): FreshnessTier {
  if (ageDays <= FRESHNESS_RULES.emergingMaxDays) return 'FRESH'
  if (ageDays <= FRESHNESS_RULES.developingMaxDays) return 'RECENT'
  if (ageDays <= FRESHNESS_RULES.stableMaxDays) return 'SETTLED'
  return 'HISTORICAL'
}

/** The §37 ready-to-render age phrase ("today", "3 days old", "2 years old"). */
export function freshnessAgeLabel(ageDays: number): string {
  if (ageDays <= 0) return 'today'
  if (ageDays < 7) return `${ageDays} day${ageDays === 1 ? '' : 's'} old`
  if (ageDays < 30) {
    const weeks = Math.round(ageDays / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} old`
  }
  if (ageDays < 365) {
    const months = Math.round(ageDays / 30)
    return `${months} month${months === 1 ? '' : 's'} old`
  }
  const years = Math.round(ageDays / 365)
  return `${years} year${years === 1 ? '' : 's'} old`
}

/** Human-readable one-liners for the tiers (UI + docs — the LIFECYCLE
 *  DESCRIPTIONS pattern). */
export const FRESHNESS_TIER_DESCRIPTIONS: Record<FreshnessTier, string> = {
  FRESH: 'Within the emerging window (≤ 3 days) — the breaking-news surface (§12).',
  RECENT: 'Within the developing window (≤ 30 days) — context still accumulating.',
  SETTLED: 'Within the stable window (≤ 1 year) — established understanding.',
  HISTORICAL: 'Over a year old — archival territory (§36), reference value only.',
}

/** The §17/§37 server-computed freshness verdict shipped on every DTO. */
export interface FreshnessInfo {
  tier: FreshnessTier
  ageDays: number
  /** e.g. "Fresh — 2 days old": tier + age, renderable verbatim (§37). */
  label: string
}

/** The §37-computed freshness of an event — the one constructor. */
export function computeFreshness(eventDate: Date, now: Date = new Date()): FreshnessInfo {
  const ageDays = freshnessAgeDays(eventDate, now)
  const tier = freshnessTierOf(ageDays)
  const tierLabel = tier.charAt(0) + tier.slice(1).toLowerCase()
  return { tier, ageDays, label: `${tierLabel} — ${freshnessAgeLabel(ageDays)}` }
}

/** Which window an age has passed (the innermost one wins — explainable). */
function ruleKeyForAge(ageDays: number): FreshnessRuleKey | null {
  if (ageDays > FRESHNESS_RULES.stableMaxDays) return 'PAST_STABLE_WINDOW'
  if (ageDays > FRESHNESS_RULES.developingMaxDays) return 'PAST_DEVELOPING_WINDOW'
  if (ageDays > FRESHNESS_RULES.emergingMaxDays) return 'PAST_EMERGING_WINDOW'
  return null
}

/**
 * The write-side verdict: which (if any) automated transition the rules
 * prescribe for an event in `state` at `ageDays`. Forward-only and always a
 * valid CURRENT_EVENT_TRANSITIONS edge by construction; ARCHIVED never
 * moves (the editorial reopen is manual — §36).
 */
export function prescribeAutoTransition(
  state: CurrentEventLifecyclePublic,
  ageDays: number
): { to: CurrentEventLifecyclePublic; rule: FreshnessRuleKey } | null {
  if (state === 'ARCHIVED') return null
  const rule = ruleKeyForAge(ageDays)
  if (!rule) return null
  if (rule === 'PAST_STABLE_WINDOW') return { to: 'ARCHIVED', rule }
  if (rule === 'PAST_DEVELOPING_WINDOW') return state === 'STABLE' ? null : { to: 'STABLE', rule }
  return state === 'DEVELOPING' ? null : { to: 'DEVELOPING', rule }
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
  /** P6-S5 §17 — the server-computed freshness verdict (age from §6 event_date). */
  freshness: FreshnessInfo
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

// ---------- P6-S5: the freshness sweep DTOs (§12 step 6, §19, §36, §37) ----------

/** One rule-prescribed transition the sweep WOULD make (or just made). */
export interface FreshnessPendingTransition {
  id: string
  slug: string
  title: string
  from: CurrentEventLifecyclePublic
  to: CurrentEventLifecyclePublic
  ageDays: number
  /** Which window prescribed it (§37 explainable rules). */
  rule: FreshnessRuleKey
}

/** GET /api/current-affairs/admin/freshness payload — the console's sweep
 *  surface: the rule table, the registry distribution, the pending preview
 *  and the last applied sweep (audit-derived). */
export interface FreshnessOverview {
  rules: typeof FRESHNESS_RULES
  /** Events per lifecycle state across the actor's §14-visible scope. */
  lifecycleCounts: Record<CurrentEventLifecyclePublic, number>
  /** Events per §17 freshness tier (the same scope). */
  tierCounts: Record<FreshnessTier, number>
  /** Total events the overview covered. */
  total: number
  /** Rule-prescribed transitions, deterministically ordered (slug). */
  pending: FreshnessPendingTransition[]
  /** The most recent APPLIED sweep (audit-derived) — null when never run. */
  lastSweep: {
    at: string
    byEmail: string | null
    appliedCount: number
    skippedCount: number
  } | null
}

/** POST /api/current-affairs/admin/freshness result — the dry-run preview or
 *  the applied sweep's audited outcome. */
export interface FreshnessSweepResult {
  dryRun: boolean
  /** Transitions made (apply) or that would be made (dry run). */
  applied: FreshnessPendingTransition[]
  /** Live events examined and left alone (no prescription / same state). */
  unchangedCount: number
  /** §14 out-of-scope events skipped without an attempt (country admins). */
  outOfScopeCount: number
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
