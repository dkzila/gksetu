/**
 * GKSetu — Follow & Save module: public DTOs
 * Master Plan §6 (UserFollow row), §9 (explicit personalisation signals),
 * §10 (Follow and Save — deliberately separate concepts), §11 (the union
 * engine's input signal), §14 (country scoping), §37 (client-agnostic
 * shapes), §39 (the same APIs a mobile app consumes).
 *
 * P5-S1 implements the FOLLOW half. The SAVE half (SavedItem + Collection)
 * lands in P5-S2 and must never treat a follow as a retrieval object or a
 * save as a recommendation signal.
 */

/** The object types followable today (§10 — ENTITY joined in P6-S3; current-affairs themes ride TOPIC, the §13 Current Affairs domain node). */
export type FollowObjectTypePublic = 'EXAM' | 'TOPIC' | 'ENTITY'

/** Resolved summary of the followed EXAM (canonical names; no language dimension). */
export interface FollowedExamSummary {
  kind: 'EXAM'
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  /** Honest current status — a RETIRED/DRAFT exam stays listed with its state (§36). */
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string
  /** §16 canonical path of the exam page in the object's own market. */
  canonicalPath: string
}

/**
 * Resolved summary of the followed TOPIC. `label` follows the §35 fallback
 * chain for the requested language (requested → market default → canonical
 * name) with `labelLanguage` marking which link answered.
 */
export interface FollowedTopicSummary {
  kind: 'TOPIC'
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  scope: 'GLOBAL' | 'COUNTRY'
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string | null
  /** §16 canonical topic-hub path in the object's (or current) market. */
  canonicalPath: string
}

export type FollowedObjectSummary = FollowedExamSummary | FollowedTopicSummary | FollowedEntitySummary

/**
 * Resolved summary of a followed ENTITY (P6-S3, §6/§10/§14) — a canonical
 * reference record (person/place/organisation/concept). Entities have no
 * §16 page of their own yet: `canonicalPath` is null and the feed surfaces
 * the name + type; the follow is the personalisation signal (§10 feed/
 * notifications/recommendations context), never a retrieval surface.
 */
export interface FollowedEntitySummary {
  kind: 'ENTITY'
  slug: string
  canonicalName: string
  type: 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
  /** Honest current status — RETIRED entities stay listed with their state (§36). */
  status: 'ACTIVE' | 'RETIRED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  /** §17 search terms — the reference record's aliases (display + match hints). */
  aliases: string[]
  /** Entities have no §16 page in v1 — null is the honest answer (§37). */
  canonicalPath: null
}

/** One follow row, resolved for display (§37 — stable, client-agnostic). */
export interface PublicFollow {
  id: string
  objectType: FollowObjectTypePublic
  followedAt: string
  object: FollowedObjectSummary
}

/** GET /api/follows response — the user's full follow list + honest counts. */
export interface FollowListResult {
  items: PublicFollow[]
  /** Counts coherent with the applied type filter. */
  counts: { total: number; EXAM: number; TOPIC: number; ENTITY: number }
}

/** POST /api/follows response. `alreadyFollowing` marks the idempotent path. */
export interface FollowMutationResult {
  follow: PublicFollow
  alreadyFollowing: boolean
}

/** GET /api/follows/state response — the single-object button state. */
export interface FollowStateResult {
  objectType: FollowObjectTypePublic
  objectRef: string
  /** Resolved canonical slug of the requested ref (null when not found). */
  objectSlug: string | null
  objectFound: boolean
  following: boolean
  follow: PublicFollow | null
}
