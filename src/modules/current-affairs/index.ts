/**
 * GlobIQ — Current Affairs module (Master Plan §28, §43 P6-S1…S5)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P6-S1: CurrentEvent — the event-centric canonical record (§12) with the
 *        §12 step 6 lifecycle (emerging → developing → stable → archived),
 *        the §12 step 2 source aggregation workflow (shared-registry evidence,
 *        URL dedup, primary swap) and the §12 step 3 canonical
 *        KnowledgeUnit links (VERIFIED units only, the §7 one-truth rule).
 * P6-S2: publishing & revisions — the event's language-specific
 *        representations ride the knowledge module's ContentItem §19 workflow
 *        (writers enter via content:manage; the read surface here opens to
 *        content:manage holders so they can pick anchors), and the public
 *        §16 event page (/current-affairs/{slug}/) assembles the record, the
 *        live revisions, the §24 evidence, and the §7 unit links.
 *        Entity/taxonomy linking (P6-S3), the exam-aware feed (P6-S4) and
 *        freshness rules (P6-S5) extend this module additively.
 * P6-S4: the exam-aware feed (§12 step 5) — current affairs matched to a
 *        followed exam's syllabus via the SAME §13 node-topic links and §8
 *        mappings the §11 combination engine consumes. EXAM mode is the
 *        public single-exam view; COMBINED mode is the signed-in caller's
 *        goal ∪ followed exams in their home market (§9/§14), every item
 *        carrying its §9 reason. The reverse resolution (which exams an
 *        event feeds) ships on the public event page as examRelevance.
 * P6-S5: freshness/archive rules — the single rule table drives BOTH the
 *        §17 read-side tiers (FRESH/RECENT/SETTLED/HISTORICAL on every feed
 *        item, event page and workspace row, server-computed per §37) and
 *        the §12 step 6 write-side sweep: age windows prescribe forward-only
 *        lifecycle moves (emerging→developing→stable→archived), applied via
 *        a preview-first, dry-run-default, fully audited console operation
 *        (§19 step 10, §36 — automated moves carry the rule's fingerprints).
 */
export {
  CurrentAffairsError,
  toCurrentAffairsErrorResponse,
  getAdminEvents,
  getAdminEvent,
  createCurrentEvent,
  updateCurrentEvent,
  transitionCurrentEvent,
  attachEventSource,
  updateEventSourceLink,
  detachEventSource,
  attachEventKnowledgeUnit,
  detachEventKnowledgeUnit,
  attachEventEntity,
  detachEventEntity,
  attachEventTopic,
  detachEventTopic,
} from './service'
export { getCurrentEventPage } from './page-service'
export { getExamAwareFeed, getEventExamRelevance } from './feed-service'
export { getFreshnessOverview, runFreshnessSweep } from './freshness-service'
export {
  createCurrentEventSchema,
  updateCurrentEventSchema,
  currentEventTransitionSchema,
  attachEventSourceSchema,
  updateEventSourceLinkSchema,
  attachEventKnowledgeUnitSchema,
  attachEventEntitySchema,
  attachEventTopicSchema,
  adminCurrentEventListQuerySchema,
  feedQuerySchema,
  freshnessSweepSchema,
  EVENT_SLUG_PATTERN,
} from './validation'
export type {
  AdminCurrentEventListQuery,
  AttachEventEntityInput,
  AttachEventKnowledgeUnitInput,
  AttachEventSourceInput,
  AttachEventTopicInput,
  CreateCurrentEventInput,
  CurrentEventTransitionInput,
  FeedQuery,
  FreshnessSweepInput,
  UpdateCurrentEventInput,
  UpdateEventSourceLinkInput,
} from './validation'
export type {
  AdminCurrentEvent,
  AdminCurrentEventDetail,
  AdminCurrentEventListResult,
  AdminEventEntityLink,
  AdminEventKnowledgeUnitLink,
  AdminEventSourceLink,
  AdminEventTopicLink,
  AttachEventSourceResult,
  CurrentEventLifecyclePublic,
  CurrentEventPagination,
  EventScopePublic,
  EventTopicRef,
  FreshnessInfo,
  FreshnessOverview,
  FreshnessPendingTransition,
  FreshnessRuleKey,
  FreshnessSweepResult,
  FreshnessTier,
} from './types'
export type {
  CurrentEventPage,
  EventPageEntity,
  EventPageRepresentation,
  EventPageSource,
  EventPageTopicRef,
  EventPageUnit,
} from './page-types'
export type {
  EventExamRelevance,
  ExamAwareFeed,
  ExamFeedItem,
} from './feed-types'
export {
  CURRENT_EVENT_LIFECYCLES,
  CURRENT_EVENT_TRANSITIONS,
  EVENT_SCOPES,
  LIFECYCLE_DESCRIPTIONS,
  FRESHNESS_RULES,
  FRESHNESS_TIERS,
  FRESHNESS_TIER_DESCRIPTIONS,
  computeFreshness,
  freshnessAgeDays,
  freshnessAgeLabel,
  freshnessTierOf,
  prescribeAutoTransition,
} from './types'
