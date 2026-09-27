/**
 * GlobIQ — Follow & Save module (Master Plan §28, §43 P5-S1…S2)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P5-S1: the FOLLOW half — UserFollow rows (§6), the follow/unfollow/list/
 * state APIs (§37), §14 country scoping and §16 canonical summaries.
 * P5-S2: the SAVE half — SavedItem + Collection rows (§6/§10), the
 * save/unsave/move/list/state and collection APIs, §36 tombstones and the
 * default-collection bootstrap. Follows and saves stay structurally separate
 * (§10): a follow is a personalisation signal, a save is retrieval — neither
 * ever feeds the other's semantics.
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

// ---------- P5-S2: the SAVE half (§10 retrieval — never a recommendation signal) ----------

export {
  SaveError,
  toSaveErrorResponse,
  saveObject,
  unsaveById,
  moveSavedItem,
  listMySaves,
  listRecentSaves,
  getSaveState,
  createCollection,
  renameCollection,
  deleteCollection,
  MAX_SAVES_PER_USER,
  MAX_COLLECTIONS_PER_USER,
  DEFAULT_COLLECTION_NAME,
} from './save-service'
export {
  saveCreateSchema,
  saveListQuerySchema,
  saveStateQuerySchema,
  saveIdSchema,
  saveMoveSchema,
  collectionCreateSchema,
  collectionUpdateSchema,
  collectionIdSchema,
  SAVE_OBJECT_TYPES,
} from './save-validation'
export type {
  SaveCreateInput,
  SaveListQuery,
  SaveStateQuery,
  SaveMoveInput,
  CollectionCreateInput,
  CollectionUpdateInput,
  SaveObjectTypeInput,
} from './save-validation'
export type {
  SaveObjectTypePublic,
  SavedUnitSummary,
  SavedContentItemSummary,
  SavedObjectSummary,
  PublicSave,
  PublicCollection,
  SaveListResult,
  SaveMutationResult,
  SaveStateResult,
  CollectionMutationResult,
  CollectionRemovalResult,
} from './save-types'
