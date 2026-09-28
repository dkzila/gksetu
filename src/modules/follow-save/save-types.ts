/**
 * GlobIQ — Follow & Save module: the SAVE half public DTOs (P5-S2)
 * Master Plan §6 (SavedItem/Collection rows), §7 (one canonical record, many
 * representations — saving the record survives representation updates),
 * §10 (Save is a retrieval/bookmark action, NEVER a recommendation or
 * personalisation signal by itself; deliberately separate from Follow),
 * §16 (canonical paths in summaries), §36 (honest object statuses — retired
 * objects stay listed as tombstones, §10 rule), §37 (client-agnostic shapes),
 * §39 (the same APIs a mobile app consumes).
 */

/** The object types savable today (§10 vocabulary — QnA/Question/MockTest join in P7; CURRENT_EVENT joined in P6-S3). */
export type SaveObjectTypePublic = 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT'

/**
 * Resolved summary of a saved KNOWLEDGE_UNIT — the canonical record (§7).
 * Saving the unit (not one representation) is what makes the §10 rule real:
 * a new published revision or an added language never duplicates the row; the
 * summary re-resolves on every read.
 */
export interface SavedUnitSummary {
  kind: 'KNOWLEDGE_UNIT'
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  /** Honest current status — ARCHIVED/OUTDATED units stay listed with their state (§36). */
  status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  /** The unit's canonical topic — needed to rebuild the §16 knowledge-page path. */
  topicSlug: string
  topicCanonicalName: string
  /** §16 knowledge-page path (/gk/{topic}/{unit}/) in the summary's market. */
  canonicalPath: string
  /** The market language the summary resolved in (the path's language). */
  languageCode: string
}

/**
 * Resolved summary of a saved CONTENT_ITEM — one published language × format
 * representation (§7). The title shown is the LIVE published revision's; a
 * newer revision updates the title under the same row (§10 no-duplicates).
 */
export interface SavedContentItemSummary {
  kind: 'CONTENT_ITEM'
  id: string
  /** Live published revision title (falls back to the working-copy title only for non-live states — honest §36). */
  title: string
  format: string
  languageCode: string
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  /** The representation's canonical unit — the §16 path target. */
  unit: {
    slug: string
    canonicalName: string
    type: string
    status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  }
  topicSlug: string
  topicCanonicalName: string
  /** §16 knowledge-page path in the item's own language market. */
  canonicalPath: string
  countryIso: string | null
}

/**
 * Resolved summary of a saved CURRENT_EVENT (P6-S3, §10/§12/§16) — the
 * event record is the saved object; its §16 page (/current-affairs/{slug}/)
 * is the retrieval surface. The §7 no-duplicates rule applies verbatim: new
 * published revisions update the page under the SAME save row. ARCHIVED
 * events stay savable — they keep their pages as permanent historical
 * reference (§36 stable identity).
 */
export interface SavedEventSummary {
  kind: 'CURRENT_EVENT'
  slug: string
  title: string
  /** Honest current lifecycle (§12 step 6) — ARCHIVED rows stay listed. */
  lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
  eventDate: string
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topicSlug: string
  topicCanonicalName: string
  /** §16 event-page path (/current-affairs/{slug}/) in the summary's market. */
  canonicalPath: string
  /** The market language the summary resolved in (the path's language). */
  languageCode: string
}

export type SavedObjectSummary = SavedUnitSummary | SavedContentItemSummary | SavedEventSummary

/** One saved-item row, resolved for display (§37 — stable, client-agnostic). */
export interface PublicSave {
  id: string
  objectType: SaveObjectTypePublic
  savedAt: string
  /** The collection the item currently lives in (move target semantics). */
  collectionId: string
  object: SavedObjectSummary
}

/** A user collection (§10) — the default "Saved" is bootstrapped on first save. */
export interface PublicCollection {
  id: string
  name: string
  isDefault: boolean
  visibility: 'PRIVATE'
  itemCount: number
  createdAt: string
}

/** GET /api/saves response — filtered items + coherent counts + all collections. */
export interface SaveListResult {
  items: PublicSave[]
  /** Counts coherent with the applied type filter (across ALL collections). */
  counts: { total: number; KNOWLEDGE_UNIT: number; CONTENT_ITEM: number; CURRENT_EVENT: number }
  /** The caller's collections with live item counts (name-ordered, default first). */
  collections: PublicCollection[]
}

/** POST /api/saves response. `alreadySaved` marks the idempotent path. */
export interface SaveMutationResult {
  save: PublicSave
  alreadySaved: boolean
}

/** GET /api/saves/state response — the single-object button state. */
export interface SaveStateResult {
  objectType: SaveObjectTypePublic
  objectRef: string
  /** Resolved canonical slug (unit) or id (content item) of the requested ref. */
  objectSlug: string | null
  objectFound: boolean
  saved: boolean
  save: PublicSave | null
}

/** POST /api/collections + PATCH /api/collections/{id} response. */
export interface CollectionMutationResult {
  collection: PublicCollection
}

/** DELETE /api/collections/{id} response — items fall back to the default. */
export interface CollectionRemovalResult {
  removed: boolean
  /** How many saved items were moved back to the default collection. */
  movedItems: number
  /** The deleted collection's name (for the honest toast). */
  name: string
}
