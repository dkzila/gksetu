'use client'

/**
 * GlobIQ — follows client types (P5-S1)
 *
 * Client mirrors of the /api/follows contracts (§37 — the same payloads a
 * future mobile client consumes, §39). Hand-written so the client bundle
 * never pulls server code.
 */

// ---------- API envelope (mirrors src/lib/api/response.ts) ----------

export interface FollowEnvelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
  meta?: { timestamp: string }
}

// ---------- Mirrors of the follow-save module DTOs ----------

export interface ApiFollowedExam {
  kind: 'EXAM'
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string
  canonicalPath: string
}

export interface ApiFollowedTopic {
  kind: 'TOPIC'
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  scope: 'GLOBAL' | 'COUNTRY'
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string | null
  canonicalPath: string
}

/** P6-S3 §6/§10/§14 — a followed entity (person/place/organisation/concept).
 * Entities have no §16 page in v1: canonicalPath is null (honest, §37). */
export interface ApiFollowedEntity {
  kind: 'ENTITY'
  slug: string
  canonicalName: string
  type: 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
  status: 'ACTIVE' | 'RETIRED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  aliases: string[]
  canonicalPath: null
}

export type ApiFollowedObject = ApiFollowedExam | ApiFollowedTopic | ApiFollowedEntity

export interface ApiFollow {
  id: string
  objectType: 'EXAM' | 'TOPIC' | 'ENTITY'
  followedAt: string
  object: ApiFollowedObject
}

export interface ApiFollowList {
  items: ApiFollow[]
  counts: { total: number; EXAM: number; TOPIC: number; ENTITY: number }
}

export interface ApiFollowMutation {
  follow: ApiFollow
  alreadyFollowing: boolean
}

export interface ApiFollowState {
  objectType: 'EXAM' | 'TOPIC' | 'ENTITY'
  objectRef: string
  objectSlug: string | null
  objectFound: boolean
  following: boolean
  follow: ApiFollow | null
}
