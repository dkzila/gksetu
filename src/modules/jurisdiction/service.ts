/**
 * GKSetu — Jurisdiction: domain service (SITE-S12)
 *
 * The unified spine for jurisdiction-aware behaviour across the platform
 * (docs/learning-flow-plan.md Problem 5). Three responsibilities:
 *
 * 1. Resolution: a country's STATE rows + a CENTRAL/INTERNATIONAL option,
 *    for the public picker (onboarding step 1, profile state-edit).
 * 2. Projection: `toPublicJurisdiction(exam)` — the DTO attached to every
 *    exam payload. SERVER-ONLY — never leaks `parentId` to the client.
 * 3. Bucketing: `bucketExamsByJurisdiction(exams, stateCode)` — THE single
 *    ordering primitive reused by every surface (the directory, onboarding
 *    step 2, tutorials index, PYQ/mock listings). Own-state first, then
 *    central + international, then other states collapsed together.
 *
 * §14 still holds: every exam belongs to exactly one country; the
 * jurisdiction adds a tier/scope on top of that, never overrides it.
 */
import type { Jurisdiction, JurisdictionLevel } from '@prisma/client'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import {
  findActiveCountryByIso,
  getPublicCountry,
  resolveLocaleContext,
  LocaleError,
} from '@/modules/country-locale'

import type {
  AdminJurisdictionGapResult,
  AdminJurisdictionListResult,
  PublicJurisdiction,
  PublicJurisdictionsResult,
} from './types'
import type { AdminJurisdictionListQuery } from './validation'

// ---------- Public reads (the picker, the directory's bucket order) ----------

/**
 * The public picker: a country's STATE-level jurisdictions, with UTs marked
 * (the onboarding step-1 picker shows states + UTs as equal options but the
 * UI badges UTs separately for honesty — §35). 60s cached (the seed never
 * changes in a session).
 */
export async function getPublicJurisdictions(input: {
  countryIso?: string
}): Promise<PublicJurisdictionsResult> {
  const cacheKey = `jurisdictions:public:${input.countryIso ?? 'default'}`
  return cachedPayload(cacheKey, () => loadPublicJurisdictions(input))
}

async function loadPublicJurisdictions(input: {
  countryIso?: string
}): Promise<PublicJurisdictionsResult> {
  let iso = input.countryIso?.trim().toUpperCase()
  if (!iso) {
    try {
      const resolution = await resolveLocaleContext({})
      iso = resolution.country.isoCode
    } catch (error) {
      if (error instanceof LocaleError) {
        // Fall back to India if the locale resolution failed.
        iso = 'IN'
      } else {
        throw error
      }
    }
  }

  const countryRow = await findActiveCountryByIso(iso)
  const country = await getPublicCountry(iso)
  if (!countryRow || !country) {
    return { states: [], hasStates: false, country: { isoCode: iso, name: iso } }
  }

  const states = await db.jurisdiction.findMany({
    where: { countryId: countryRow.id, level: 'STATE' },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { code: true, name: true },
  })

  // UT detection: India's UTs share the ISO 3166-2 suffix list with states.
  // For other markets we keep `isUnionTerritory=false` (the seeded rows define
  // what counts as a UT; today only India has them, in the seed script).
  const INDIA_UT_CODES = new Set(['AN', 'CH', 'DH', 'DL', 'JK', 'LA', 'LD', 'PY'])

  return {
    states: states.map((s) => ({
      code: s.code ?? '',
      name: s.name,
      isUnionTerritory: iso === 'IN' && INDIA_UT_CODES.has(s.code ?? ''),
    })),
    hasStates: states.length > 0,
    country: { isoCode: iso, name: country.name },
  }
}

// ---------- The DTO projection (server-only) ----------

/**
 * Builds the public jurisdiction shape from an exam + its (already-loaded or
 * freshly-fetched) jurisdiction row. The shape is intentionally narrow: no
 * `parentId` leaks to the client — the parent's name is the only parent
 * detail the client ever needs (and only for DISTRICT rows).
 */
export function toPublicJurisdiction(
  jurisdiction: (Pick<Jurisdiction, 'level' | 'name' | 'code'> & {
    parent?: Pick<Jurisdiction, 'name' | 'code'> | null
  }) | null
): PublicJurisdiction | null {
  if (!jurisdiction) return null
  return {
    level: jurisdiction.level,
    name: jurisdiction.name,
    stateCode: jurisdiction.code,
    stateName: jurisdiction.level === 'DISTRICT' ? jurisdiction.parent?.name ?? null : null,
    districtName: jurisdiction.level === 'DISTRICT' ? jurisdiction.name : null,
  }
}

// ---------- The bucketing primitive (shared by every surface) ----------

/** A tier number used for relevance-sorting — lower = more relevant. */
function tierOf(
  exam: { jurisdiction?: PublicJurisdiction | null },
  ownStateCode: string | null
): number {
  const level = exam.jurisdiction?.level
  if (!level) return 4 // NULL jurisdiction — gap, rendered last as "Other"
  if (level === 'INTERNATIONAL') return 2 // international (broad relevance, always shown)
  if (level === 'CENTRAL') return 1 // central government (always relevant)
  if (level === 'STATE') {
    // Own state's exams lead; other states collapse to tier 3 (secondary).
    return exam.jurisdiction?.stateCode && ownStateCode && exam.jurisdiction.stateCode === ownStateCode
      ? 0
      : 3
  }
  if (level === 'DISTRICT') {
    // Districts of own state sit between state and central.
    return 1.5
  }
  return 4
}

export interface BucketedExams<T> {
  /** Primary bucket: central + international + own state + own districts. */
  primary: T[]
  /** Secondary bucket: other states (collapsed, the UI shows as a section). */
  secondary: T[]
}

/**
 * THE single ordering primitive reused by every surface (the directory, the
 * onboarding step-2 picker, the tutorials/PYQ/mock listings). The server-side
 * API and the client-side listing both rely on it (one truth).
 *
 * Within each tier, exams are sorted alphabetically by name (§37 deterministic).
 */
export function bucketExamsByJurisdiction<T extends { jurisdiction?: PublicJurisdiction | null; name: string }>(
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

// ---------- Console admin reads ----------

export async function getAdminJurisdictions(
  query: AdminJurisdictionListQuery
): Promise<AdminJurisdictionListResult> {
  // Filter by country + level + q (case-insensitive contains on name/code).
  // The Console needs ids/parentId for the cascade; the public picker does not.
  const where = await buildAdminWhere(query)
  const [rows, total] = await Promise.all([
    db.jurisdiction.findMany({
      where,
      orderBy: [{ countryId: 'asc' }, { level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        level: true,
        name: true,
        code: true,
        countryId: true,
        parentId: true,
        sortOrder: true,
        country: { select: { isoCode: true } },
        parent: { select: { name: true } },
        _count: { select: { exams: true } },
      },
    }),
    db.jurisdiction.count({ where }),
  ])

  return {
    jurisdictions: rows.map((r) => ({
      id: r.id,
      level: r.level,
      name: r.name,
      code: r.code,
      countryIso: r.country?.isoCode ?? null,
      parentName: r.parent?.name ?? null,
      examCount: r._count.exams,
      sortOrder: r.sortOrder,
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

async function buildAdminWhere(query: AdminJurisdictionListQuery) {
  const where: {
    level?: JurisdictionLevel
    country?: { isoCode: string }
    OR?: Array<Record<string, unknown>>
  } = {}
  if (query.level) where.level = query.level
  if (query.country) {
    where.country = { isoCode: query.country.toUpperCase() }
  }
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { code: { contains: query.q, mode: 'insensitive' } },
    ]
  }
  return where
}

/**
 * The Console's "missing jurisdiction" gap view — the backfill gaps, honestly
 * surfaced in one click. Lists exams whose `jurisdictionId` is null.
 */
export async function getAdminJurisdictionGaps(): Promise<AdminJurisdictionGapResult> {
  const [total, tagged, gapExams] = await Promise.all([
    db.exam.count(),
    db.exam.count({ where: { jurisdictionId: { not: null } } }),
    db.exam.findMany({
      where: { jurisdictionId: null },
      select: {
        id: true,
        slug: true,
        name: true,
        organiser: true,
        level: true,
        country: { select: { isoCode: true } },
      },
      orderBy: { name: 'asc' },
      take: 200,
    }),
  ])
  return {
    total,
    tagged,
    gaps: total - tagged,
    gapExams: gapExams.map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.name,
      organiser: e.organiser,
      level: e.level,
      countryIso: e.country.isoCode,
    })),
  }
}

// ---------- Validation helper (used by the personalisation goal-set) ----------

/**
 * Validates a stateCode against the seeded STATE rows of the home country.
 * Used by the goal-set route — never a guessed assignment (§9 honest signal).
 */
export async function isValidStateCodeForCountry(
  countryId: string,
  stateCode: string
): Promise<boolean> {
  const count = await db.jurisdiction.count({
    where: { countryId, level: 'STATE', code: stateCode.toUpperCase() },
  })
  return count > 0
}

/** Loads a jurisdiction by id (used by the Console cascade — level → state → district). */
export async function findJurisdictionById(id: string): Promise<Jurisdiction | null> {
  return db.jurisdiction.findUnique({ where: { id } })
}

/** Loads a state's districts (the Console district-picker options). */
export async function listDistrictsForState(stateId: string): Promise<
  Array<{ id: string; name: string; code: string | null }>
> {
  return db.jurisdiction.findMany({
    where: { parentId: stateId, level: 'DISTRICT' },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true },
  })
}

/** Loads a country's states (the Console state-picker + onboarding step 1). */
export async function listStatesForCountry(countryId: string): Promise<
  Array<{ id: string; name: string; code: string | null; sortOrder: number }>
> {
  return db.jurisdiction.findMany({
    where: { countryId, level: 'STATE' },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, sortOrder: true },
  })
}

/** Loads a country's CENTRAL row (or null when none seeded). */
export async function getCentralForCountry(countryId: string): Promise<Jurisdiction | null> {
  return db.jurisdiction.findFirst({
    where: { countryId, level: 'CENTRAL' },
  })
}

// ---------- Audit snapshot (used by the exam admin route) ----------

export function jurisdictionSnapshot(jurisdiction: Pick<Jurisdiction, 'level' | 'name' | 'code'> | null) {
  if (!jurisdiction) return null
  return { level: jurisdiction.level, name: jurisdiction.name, code: jurisdiction.code }
}

// ---------- Exam-side helper (loaded by the exam service for DTOs) ----------

/**
 * The select clause the exam service should add to load jurisdiction + parent
 * in one query (no N+1 — one batch per exam listing).
 */
export const EXAM_JURISDICTION_INCLUDE = {
  jurisdiction: {
    select: {
      id: true,
      level: true,
      name: true,
      code: true,
      parent: { select: { name: true, code: true } },
    },
  },
} as const
