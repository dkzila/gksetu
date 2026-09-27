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

export type ApiFollowedObject = ApiFollowedExam | ApiFollowedTopic

export interface ApiFollow {
  id: string
  objectType: 'EXAM' | 'TOPIC'
  followedAt: string
  object: ApiFollowedObject
}

export interface ApiFollowList {
  items: ApiFollow[]
  counts: { total: number; EXAM: number; TOPIC: number }
}

export interface ApiFollowMutation {
  follow: ApiFollow
  alreadyFollowing: boolean
}

export interface ApiFollowState {
  objectType: 'EXAM' | 'TOPIC'
  objectRef: string
  objectSlug: string | null
  objectFound: boolean
  following: boolean
  follow: ApiFollow | null
}
