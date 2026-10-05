/**
 * GKSetu — Jurisdiction module: public DTOs (SITE-S12)
 *
 * Mirrors the Prisma `Jurisdiction` row (§16 canonical URLs, §35 label chain,
 * §37 client-agnostic shapes). The shape is intentionally narrow: the
 * personalisation surfaces only need the level + state code + display name +
 * the parent (state) row when the exam's jurisdiction is a DISTRICT.
 */

import type { JurisdictionLevel } from '@prisma/client'

export type { JurisdictionLevel }

/** The public jurisdiction shape attached to every exam DTO. */
export interface PublicJurisdiction {
  level: JurisdictionLevel
  /** The display name ("Government of India — Central", "Maharashtra",
   * "Pune District"). */
  name: string
  /** The state code ("MH", "RJ") — null for CENTRAL/INTERNATIONAL. */
  stateCode: string | null
  /** The state display name when level=DISTRICT (so the card can show
   * "Pune District · Maharashtra"). Null otherwise. */
  stateName: string | null
  /** The district name when level=DISTRICT, else null. */
  districtName: string | null
}

/** The picker option for the Console cascade (level → state → district). */
export interface JurisdictionOption {
  id: string
  level: JurisdictionLevel
  name: string
  code: string | null
  parentId: string | null
}

/** The shape of the public GET /api/jurisdictions endpoint (the state-picker
 * for onboarding step 1). */
export interface PublicJurisdictionsResult {
  /** State/UT-level rows for the resolved country (or empty when none seeded). */
  states: Array<{ code: string; name: string; isUnionTerritory: boolean }>
  /** True when the resolved country has at least one STATE jurisdiction. */
  hasStates: boolean
  country: { isoCode: string; name: string }
}

/** Console admin listing of all jurisdictions (the Console's gap-list view). */
export interface AdminJurisdictionListResult {
  jurisdictions: Array<{
    id: string
    level: JurisdictionLevel
    name: string
    code: string | null
    countryIso: string | null
    parentName: string | null
    examCount: number
    sortOrder: number
  }>
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

/** Console admin exam-jurisdiction gap listing (the backfill gap view). */
export interface AdminJurisdictionGapResult {
  total: number
  tagged: number
  gaps: number
  gapExams: Array<{
    id: string
    slug: string
    name: string
    organiser: string
    level: 'NATIONAL' | 'STATE' | 'REGIONAL'
    countryIso: string
  }>
}

/**
 * SITE-S12: the shape of an exam row with its jurisdiction relation loaded
 * (used internally by the exams-syllabus service). The `jurisdiction` field
 * carries the level + name + code (and the parent state's name + code for
 * DISTRICT rows). Server-only — never leaks `parentId` to the client.
 */
export interface ExamWithJurisdiction {
  id: string
  jurisdictionId: string | null
  countryId: string
  jurisdiction: {
    id: string
    level: JurisdictionLevel
    name: string
    code: string | null
    parent: { name: string; code: string | null } | null
  } | null
}
