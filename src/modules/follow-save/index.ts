/**
 * GlobIQ — Follow & Save module (Master Plan §28, §43 P5-S1…S2)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P5-S1: the FOLLOW half — UserFollow rows (§6), the follow/unfollow/list/
 * state APIs (§37), §14 country scoping and §16 canonical summaries.
 * P5-S2: the SAVE half (SavedItem + Collection) will join this module;
 * follows and saves stay structurally separate (§10).
 */
export {
  FollowError,
  toFollowErrorResponse,
  followObject,
  unfollowById,
  listMyFollows,
  getFollowState,
  MAX_FOLLOWS_PER_USER,
} from './service'
export {
  followCreateSchema,
  followListQuerySchema,
  followStateQuerySchema,
  followIdSchema,
  FOLLOW_OBJECT_TYPES,
} from './validation'
export type {
  FollowCreateInput,
  FollowListQuery,
  FollowStateQuery,
  FollowObjectTypeInput,
} from './validation'
export type {
  FollowObjectTypePublic,
  FollowedExamSummary,
  FollowedTopicSummary,
  FollowedObjectSummary,
  PublicFollow,
  FollowListResult,
  FollowMutationResult,
  FollowStateResult,
} from './types'
