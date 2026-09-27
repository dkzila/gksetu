/**
 * GlobIQ — Follow & Save module: public DTOs
 * Master Plan §6 (UserFollow row), §9 (explicit personalisation signals),
 * §10 (Follow and Save — deliberately separate concepts), §11 (the union
 * engine's input signal), §14 (country scoping), §37 (client-agnostic
 * shapes), §39 (the same APIs a mobile app consumes).
 *
 * P5-S1 implements the FOLLOW half. The SAVE half (SavedItem + Collection)
 * lands in P5-S2 and must never treat a follow as a retrieval object or a
 * save as a recommendation signal.
 */

/** The object types followable today (§10 — ENTITY/THEME join in P6). */
export type FollowObjectTypePublic = 'EXAM' | 'TOPIC'

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

export type FollowedObjectSummary = FollowedExamSummary | FollowedTopicSummary

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
  counts: { total: number; EXAM: number; TOPIC: number }
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
