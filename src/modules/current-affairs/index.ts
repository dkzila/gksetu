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
 *        Publishing/revisions (P6-S2), entity/taxonomy linking (P6-S3),
 *        the exam-aware feed (P6-S4) and automated freshness rules (P6-S5)
 *        extend this module additively.
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
} from './service'
export {
  createCurrentEventSchema,
  updateCurrentEventSchema,
  currentEventTransitionSchema,
  attachEventSourceSchema,
  updateEventSourceLinkSchema,
  attachEventKnowledgeUnitSchema,
  adminCurrentEventListQuerySchema,
  EVENT_SLUG_PATTERN,
} from './validation'
export type {
  AdminCurrentEventListQuery,
  AttachEventKnowledgeUnitInput,
  AttachEventSourceInput,
  CreateCurrentEventInput,
  CurrentEventTransitionInput,
  UpdateCurrentEventInput,
  UpdateEventSourceLinkInput,
} from './validation'
export type {
  AdminCurrentEvent,
  AdminCurrentEventDetail,
  AdminCurrentEventListResult,
  AdminEventKnowledgeUnitLink,
  AdminEventSourceLink,
  AttachEventSourceResult,
  CurrentEventLifecyclePublic,
  CurrentEventPagination,
  EventScopePublic,
  EventTopicRef,
} from './types'
export {
  CURRENT_EVENT_LIFECYCLES,
  CURRENT_EVENT_TRANSITIONS,
  EVENT_SCOPES,
  LIFECYCLE_DESCRIPTIONS,
} from './types'
