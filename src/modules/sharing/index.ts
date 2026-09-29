/**
 * GlobIQ — Sharing module (Master Plan §28, §43 P8-S1)
 *
 * Public interface. Route handlers and other modules import from here only.
 * Master Plan §21 (sharing system): share actions, stable share URLs, share
 * cards, the eligible-collection opt-in, and §32 share events.
 */
export { ShareError, toShareErrorResponse, parseSharePath, getShareCard, recordShareEvent, getSharedCollection, getMyShareStats } from './share-service'
export { shareMetadataQuerySchema, shareEventSchema, collectionVisibilitySchema } from './share-validation'
export type { ShareMetadataQuery, ShareEventInput, CollectionVisibilityInput } from './share-validation'
export type {
  ShareObjectType,
  ShareChannel,
  ShareEventAction,
  ShareBrand,
  ShareCard,
  ParsedSharePath,
  ShareEventReceipt,
  SharedCollectionItem,
  SharedCollection,
  InventorySharing,
} from './share-types'
