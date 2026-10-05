/**
 * GKSetu — Jurisdiction client types + the `bucketByJurisdiction` helper
 * (SITE-S12).
 *
 * Client mirror of `src/modules/jurisdiction/types.ts` and the server-side
 * `bucketExamsByJurisdiction`. The same shape and behaviour, never imports
 * server code (§28 modular monolith — the client bundle stays server-free).
 *
 * THE single ordering primitive reused by every public surface that shows an
 * exam list: the /exams/ directory, the onboarding step-2 picker, the
 * tutorials index, /pyq/ and /mock-test/ listings. One truth: server-side
 * the bucketExamsByJurisdiction in src/modules/jurisdiction/service.ts;
 * client-side this file. They MUST agree.
 */
'use client'

export type JurisdictionLevel = 'INTERNATIONAL' | 'CENTRAL' | 'STATE' | 'DISTRICT'

/** The jurisdiction projection attached to every exam DTO. */
export interface ApiJurisdiction {
  level: JurisdictionLevel
  /** Display name ("Government of India — Central", "Maharashtra", "Pune District"). */
  name: string
  /** State code ("MH", "RJ"); null for CENTRAL/INTERNATIONAL. */
  stateCode: string | null
  /** The state's display name when level=DISTRICT (so cards can show
   * "Pune District · Maharashtra"). Null otherwise. */
  stateName: string | null
  /** The district name when level=DISTRICT, else null. */
  districtName: string | null
}

/** One state option from GET /api/jurisdictions (the onboarding step-1 picker). */
export interface ApiJurisdictionState {
  code: string
  name: string
  isUnionTerritory: boolean
}

export interface ApiJurisdictions {
  states: ApiJurisdictionState[]
  hasStates: boolean
  country: { isoCode: string; name: string }
}

export interface BucketedExams<T> {
  /** Primary bucket: own state + central + international. */
  primary: T[]
  /** Secondary bucket: other states (collapsed). */
  secondary: T[]
}

/** A tier number for relevance-sorting — lower = more relevant. */
function tierOf(exam: { jurisdiction?: ApiJurisdiction | null }, ownStateCode: string | null): number {
  const level = exam.jurisdiction?.level
  if (!level) return 4 // NULL jurisdiction — gap, rendered last as "Other"
  if (level === 'INTERNATIONAL') return 2
  if (level === 'CENTRAL') return 1
  if (level === 'STATE') {
    return exam.jurisdiction?.stateCode && ownStateCode && exam.jurisdiction.stateCode === ownStateCode
      ? 0
      : 3
  }
  if (level === 'DISTRICT') {
    return 1.5
  }
  return 4
}

/**
 * THE single ordering primitive reused by every surface (the directory, the
 * onboarding step-2 picker, the tutorials/PYQ/mock listings). The server-side
 * API and the client-side listing both rely on it (one truth).
 *
 * Within each tier, exams are sorted alphabetically by name (§37 deterministic).
 *
 * This is a pure client-side helper for use when the API returned ALL exams
 * and the UI wants to bucket them for display. The server's `?state=` query
 * already applies this on the directory endpoint — this is the same logic for
 * any other surface that wants client-side bucketing (tutorials index, PYQ
 * listings, etc.).
 */
export function bucketByJurisdiction<T extends { jurisdiction?: ApiJurisdiction | null; name: string }>(
  exams: T[],
  ownStateCode: string | null
): BucketedExams<T> {
  const withTiers = exams.map((exam) => ({ exam, tier: tierOf(exam, ownStateCode) }))
  withTiers.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.exam.name.localeCompare(b.exam.name)
  })
  const primary: T[] = []
  const secondary: T[] = []
  for (const entry of withTiers) {
    if (entry.tier <= 2) primary.push(entry.exam)
    else secondary.push(entry.exam)
  }
  return { primary, secondary }
}

/** A short display chip label for an exam's jurisdiction ("Central" /
 * "Maharashtra" / "Pune District" / "International"). */
export function jurisdictionChipLabel(jurisdiction: ApiJurisdiction | null | undefined): string | null {
  if (!jurisdiction) return null
  if (jurisdiction.level === 'CENTRAL') return 'Central'
  if (jurisdiction.level === 'INTERNATIONAL') return 'International'
  if (jurisdiction.level === 'STATE') return jurisdiction.name
  if (jurisdiction.level === 'DISTRICT') return jurisdiction.name
  return null
}

/** The "your state ({Maharashtra})" header copy — null when the user has no
 * declared state or the API doesn't expose one. */
export function ownStateLabel(stateCode: string | null, states: ApiJurisdictionState[]): string | null {
  if (!stateCode) return null
  const match = states.find((s) => s.code === stateCode)
  return match?.name ?? null
}
