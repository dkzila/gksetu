/**
 * GKSetu — Workspaces module: public types (P9-S3)
 *
 * Master Plan §43 Phase 9 Session 3 — "country-specific editorial
 * workspaces". §37 client-agnostic DTOs only — wire types stay internal.
 */

/** Workspace = one configured market + its staff + its board (§14/§38).
 *  It is a DERIVED view (the §34 precedent: never a stored checklist) —
 *  there is no Workspace row; the market's User rows (homeCountryId) ARE
 *  the roster, their languageScopeId rows ARE the language dimension. */
import type { CountryStatusPublic } from '@/modules/country-locale'

export type StaffRole = 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'

export interface WorkspaceCountryRef {
  isoCode: string
  slug: string
  name: string
  status: CountryStatusPublic
  isDefault: boolean
  launchedAt: string | null
  timezone: string | null
  defaultLanguage: { code: string; name: string } | null
  languages: Array<{ code: string; name: string }>
}

export interface WorkspaceStaffMember {
  id: string
  email: string
  name: string | null
  role: StaffRole
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  /** §20 explicit language scope — null = all languages in the market. */
  languageScope: { code: string; name: string } | null
  preferredLanguage: { code: string; name: string } | null
  lastLoginAt: string | null
  createdAt: string
  /** The caller's own row (UI affordances — never a grant). */
  isSelf: boolean
}

export interface WorkspaceLanguageCoverage {
  code: string
  name: string
  isDefault: boolean
  /** Staff able to work in this language: explicitly scoped to it + the
   *  all-language staff of the market (§20 — null scope means every
   *  configured language). */
  staffCount: number
  /** Published knowledge/event pages in this language over in-scope units —
   *  the same derivation as the launch checklist (§34/§35). */
  publishedPages: number
}

export interface WorkspaceBoardSummary {
  open: number
  inProgress: number
  resolved: number
  cancelled: number
}

export interface WorkspaceStats {
  staffByRole: { writer: number; countryAdmin: number; platformAdmin: number }
  suspended: number
  /** Configured languages with zero staff able to work them — the honest
   *  coverage gap (never silently omitted). */
  unstaffedLanguages: string[]
}

export interface WorkspaceSummary {
  country: WorkspaceCountryRef
  stats: WorkspaceStats
  board: WorkspaceBoardSummary
}

export interface WorkspaceDetail extends WorkspaceSummary {
  staff: WorkspaceStaffMember[]
  coverage: WorkspaceLanguageCoverage[]
  /** §38 honesty: what the caller may do here (server-driven). */
  canManage: boolean
  /** The §20 line every workspace response carries. */
  contract: string
}

/** POST /api/workspaces/[iso]/staff result — the one-time credential is
 *  revealed ONCE (never stored in plaintext; only its scrypt hash is). */
export interface StaffInviteResult {
  member: WorkspaceStaffMember
  oneTimePassword: string
  contract: string
}

/** PATCH /api/workspaces/[iso]/staff/[userId] — resetCredential=true adds a
 *  fresh one-time credential to the same reveal-once rule. */
export interface StaffUpdateResult {
  member: WorkspaceStaffMember
  oneTimePassword: string | null
  contract: string
}

/** §32 editorial-family workspace metrics (windowless stock — the
 *  translationCoverage/marketReadiness precedent). */
export interface WorkspaceInsightMetrics {
  marketsConfigured: number
  staffedMarkets: number
  byRole: { writer: number; countryAdmin: number; platformAdmin: number }
  suspended: number
  languagesConfigured: number
  languagesStaffed: number
  unstaffedLanguages: string[]
  derivation: string
}
