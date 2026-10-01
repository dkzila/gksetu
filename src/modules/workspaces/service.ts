/**
 * GKSetu — Workspaces: country-specific editorial workspaces (P9-S3)
 *
 * Master Plan §43 Phase 9 Session 3 — "Implement country-specific editorial
 * workspaces", over:
 *
 *  - §14: "Every editorial workspace belongs to a country and, optionally, a
 *    language." One workspace per configured market; the language dimension
 *    is per-member (the P2-S4 `languageScopeId` row) — a workspace is a
 *    DERIVED view (the §34 precedent: never a stored checklist that can go
 *    stale). There is no Workspace table: the market's staff rows ARE the
 *    roster; every count is derived from the live data the surfaces serve.
 *  - §18: the editorial role classes, scope-limited by country and, where
 *    relevant, language. In v1's consolidated four-role model the language
 *    scope narrows WRITER (the `can()` layer's WRITER_NARROWED contract);
 *    COUNTRY_ADMIN owns the whole workspace, so the provisioning surface
 *    refuses a language scope on that class (the scope would be dead weight
 *    the permission layer never enforces — never store a rule we don't run).
 *  - §20: "Country Admin creates or invites staff accounts. Each account
 *    receives explicit country/language scopes and role assignments. The
 *    authorization service checks those scopes on every protected
 *    operation." This is the session's core deliverable: the provisioning
 *    lifecycle (invite with a server-generated one-time credential, scope
 *    and role adjustments, suspend/reactivate, credential resets) — audited,
 *    never self-served, never touching the platform class.
 *  - §20 isolation: "A writer in Country A must never be able to query
 *    Country B's content merely by modifying an API parameter." Every
 *    workspace operation re-derives the target market server-side and
 *    compares it against the actor's own scope — cross-market probes fail
 *    closed (403 for reads, 404 for by-id member probes so existence never
 *    leaks across the boundary).
 *  - §35: language scopes must reference a language CONFIGURED for the
 *    target market — validated against the same locale snapshot every other
 *    surface reads (one truth), never a global free-for-all.
 *  - §36 spirit: suspending staff never deletes history — sessions are
 *    revoked (counted in the audit row), the account row stands, and
 *    reactivation is reversible.
 *  - §37: explicit errors at the service boundary; the route guard checks
 *    the category grant, this service re-asserts the exact target
 *    (defense in depth).
 *  - §38: ADMIN is the platform class — it appears in rosters (it CAN work
 *    any workspace) but is never managed through them; READER is not staff
 *    and never enters these surfaces.
 *
 * §45 note: every staff mutation is audited (staff.create / staff.update /
 * staff.denied); the one-time credential is revealed ONCE in the response,
 * never stored in plaintext (only its scrypt hash is), and never written to
 * the audit trail (the §30 redaction layer additionally masks any
 * *credential* key).
 *
 * FILE SPLIT (the live browser round caught the leak — the P9-S1 ai-service
 * precedent): this file is the CLIENT-SAFE face (reads + §32 metrics); the
 * §20 provisioning lives in ./provisioning.ts, OFF the module barrel and
 * imported only by the provisioning routes — it pulls node:crypto scrypt at
 * module scope, which must never reach a browser bundle (the analytics
 * barrel chain carries module barrels into the client).
 */
import type { CountrySnapshotRow } from '@/modules/country-locale/cache'
import { getSnapshot } from '@/modules/country-locale/cache'
import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'
import { can } from '@/lib/permissions'
import type {
  WorkspaceBoardSummary,
  WorkspaceCountryRef,
  WorkspaceDetail,
  WorkspaceInsightMetrics,
  WorkspaceLanguageCoverage,
  WorkspaceStaffMember,
  WorkspaceStats,
  WorkspaceSummary,
} from './types'

// ---------- Errors (§37 — explicit, stable codes) ----------

export type WorkspaceErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_OUT_OF_SCOPE'
  | 'EMAIL_TAKEN'
  | 'LANGUAGE_NOT_CONFIGURED_FOR_MARKET'
  | 'STAFF_SCOPE_ROLE_MISMATCH'
  | 'STAFF_MEMBER_NOT_FOUND'
  | 'STAFF_MANAGE_ADMIN_REFUSED'
  | 'STAFF_SELF_MUTATION_REFUSED'

const ERROR_STATUS: Record<WorkspaceErrorCode, number> = {
  WORKSPACE_NOT_FOUND: 404,
  WORKSPACE_OUT_OF_SCOPE: 403,
  EMAIL_TAKEN: 409,
  LANGUAGE_NOT_CONFIGURED_FOR_MARKET: 422,
  STAFF_SCOPE_ROLE_MISMATCH: 422,
  STAFF_MEMBER_NOT_FOUND: 404,
  STAFF_MANAGE_ADMIN_REFUSED: 403,
  STAFF_SELF_MUTATION_REFUSED: 409,
}

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode
  readonly status: number

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown WorkspaceError to envelope data (§37); null for others. */
export function toWorkspaceErrorResponse(
  error: unknown
): { message: string; code: WorkspaceErrorCode; status: number } | null {
  if (error instanceof WorkspaceError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Shared helpers ----------

/** The §20 line every workspace surface carries. */
export const WORKSPACE_CONTRACT =
  'The workspace IS the market (§14): every operation re-derives the target market server-side and compares it with the actor\u2019s own scope — a Country A operator can never reach Country B\u2019s workspace by changing a parameter (§20). Language scopes must be languages the market actually configures (§35).'

/** The market scope filter every §14/§15 content query uses (the
 *  launch-service twin — GLOBAL or owned; duplicated per the established
 *  per-module precedent, never imported across module internals). */
const MARKET_UNITS = (countryId: string) => ({
  OR: [{ scope: 'GLOBAL' as const }, { scope: 'COUNTRY' as const, countryId }],
})

const STAFF_ROLES = ['WRITER', 'COUNTRY_ADMIN', 'ADMIN'] as const

export async function resolveMarket(isoOrSlug: string): Promise<CountrySnapshotRow> {
  const snapshot = await getSnapshot()
  const key = isoOrSlug.trim()
  const country =
    snapshot.countries.find((c) => c.slug === key.toLowerCase()) ??
    snapshot.countries.find((c) => c.isoCode === key.toUpperCase())
  if (!country) {
    throw new WorkspaceError('WORKSPACE_NOT_FOUND', `Unknown market "${isoOrSlug}" — no workspace exists for it`)
  }
  return country
}

function toCountryRef(country: CountrySnapshotRow): WorkspaceCountryRef {
  const activeLanguages = country.languages
    .filter((language) => language.status === 'ACTIVE')
    .sort((a, b) =>
      a.code === country.defaultLanguage?.code ? -1 : b.code === country.defaultLanguage?.code ? 1 : a.code.localeCompare(b.code)
    )
  return {
    isoCode: country.isoCode,
    slug: country.slug,
    name: country.name,
    status: country.status,
    isDefault: country.isDefault,
    launchedAt: country.launchedAt ? country.launchedAt.toISOString() : null,
    timezone: country.timezone,
    defaultLanguage: country.defaultLanguage
      ? { code: country.defaultLanguage.code, name: country.defaultLanguage.name }
      : null,
    languages: activeLanguages.map((language) => ({ code: language.code, name: language.name })),
  }
}

// ---------- Roster / stats / board (derived — §34 precedent) ----------

export type StaffRow = {
  id: string
  email: string
  name: string | null
  role: 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  languageScopeId: string | null
  languageScope: { code: string; name: string } | null
  preferredLanguage: { code: string; name: string } | null
  lastLoginAt: Date | null
  createdAt: Date
}

const ROLE_ORDER: Record<StaffRow['role'], number> = {
  COUNTRY_ADMIN: 0, // the workspace owner (§18) — first
  WRITER: 1,
  ADMIN: 2, // the platform class (§38) — present, never managed here
}

export function toMember(row: StaffRow, actor: Actor): WorkspaceStaffMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    languageScope: row.languageScope,
    preferredLanguage: row.preferredLanguage,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isSelf: row.id === actor.userId,
  }
}

async function loadRoster(countryId: string): Promise<StaffRow[]> {
  const users = await db.user.findMany({
    where: { homeCountryId: countryId, role: { in: [...STAFF_ROLES] } },
    include: { languageScope: true, preferredLanguage: true },
  })
  return users
    .map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as StaffRow['role'],
      status: user.status,
      languageScopeId: user.languageScopeId,
      languageScope: user.languageScope ? { code: user.languageScope.code, name: user.languageScope.name } : null,
      preferredLanguage: user.preferredLanguage
        ? { code: user.preferredLanguage.code, name: user.preferredLanguage.name }
        : null,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.email.localeCompare(b.email))
}

function deriveStats(roster: StaffRow[], activeLanguages: Array<{ code: string; name: string }>): WorkspaceStats {
  // Coverage = workspace staff (WRITER/COUNTRY_ADMIN — the §18 classes);
  // the platform ADMIN can work anywhere by design (§38) and is excluded
  // from the coverage read — the derivation states it.
  const workspaceStaff = roster.filter((row) => row.role !== 'ADMIN' && row.status === 'ACTIVE')
  const unstaffedLanguages = activeLanguages.filter(
    (language) =>
      !workspaceStaff.some(
        (row) => row.languageScope == null || row.languageScope.code === language.code
      )
  )
  return {
    staffByRole: {
      writer: roster.filter((row) => row.role === 'WRITER').length,
      countryAdmin: roster.filter((row) => row.role === 'COUNTRY_ADMIN').length,
      platformAdmin: roster.filter((row) => row.role === 'ADMIN').length,
    },
    suspended: roster.filter((row) => row.status === 'SUSPENDED').length,
    unstaffedLanguages: unstaffedLanguages.map((language) => language.code),
  }
}

async function loadBoard(countryId: string): Promise<WorkspaceBoardSummary> {
  const groups = await db.editorialTask.groupBy({
    by: ['status'],
    where: { countryId },
    _count: { _all: true },
  })
  const summary: WorkspaceBoardSummary = { open: 0, inProgress: 0, resolved: 0, cancelled: 0 }
  for (const group of groups) {
    if (group.status === 'OPEN') summary.open = group._count._all
    else if (group.status === 'IN_PROGRESS') summary.inProgress = group._count._all
    else if (group.status === 'RESOLVED') summary.resolved = group._count._all
    else if (group.status === 'CANCELLED') summary.cancelled = group._count._all
  }
  return summary
}

async function loadCoverage(
  country: CountrySnapshotRow,
  roster: StaffRow[]
): Promise<WorkspaceLanguageCoverage[]> {
  const activeLanguages = country.languages
    .filter((language) => language.status === 'ACTIVE')
    .sort((a, b) =>
      a.code === country.defaultLanguage?.code ? -1 : b.code === country.defaultLanguage?.code ? 1 : a.code.localeCompare(b.code)
    )
  const workspaceStaff = roster.filter((row) => row.role !== 'ADMIN' && row.status === 'ACTIVE')
  return Promise.all(
    activeLanguages.map(async (language) => ({
      code: language.code,
      name: language.name,
      isDefault: country.defaultLanguageId === language.id,
      staffCount: workspaceStaff.filter((row) => row.languageScope == null || row.languageScope.code === language.code)
        .length,
      // The same §34/§35 derivation the launch checklist uses — published
      // pages in THIS language over GLOBAL-or-owned units, never the
      // all-languages set (an EN page never counts for FR/fr).
      publishedPages: await db.contentItem.count({
        where: {
          status: 'PUBLISHED',
          language: { code: language.code },
          knowledgeUnit: MARKET_UNITS(country.id),
        },
      }),
    }))
  )
}

// ---------- Reads ----------

/** The markets whose workspaces the actor may SEE (§38/§20):
 *  ADMIN — every configured market (incl. paused: the relaunch view
 *  precedent); COUNTRY_ADMIN/WRITER — exactly their own (fail-closed when
 *  the account carries no home market). */
function visibleMarkets(actor: Actor, all: CountrySnapshotRow[]): CountrySnapshotRow[] {
  if (actor.role === 'ADMIN') return all
  if (actor.countryId == null) return []
  return all.filter((country) => country.id === actor.countryId)
}

export async function listWorkspaces(actor: Actor): Promise<WorkspaceSummary[]> {
  const snapshot = await getSnapshot()
  const markets = visibleMarkets(actor, snapshot.countries)
  return Promise.all(
    markets.map(async (country) => {
      const roster = await loadRoster(country.id)
      const activeLanguages = country.languages
        .filter((language) => language.status === 'ACTIVE')
        .sort((a, b) =>
          a.code === country.defaultLanguage?.code ? -1 : b.code === country.defaultLanguage?.code ? 1 : a.code.localeCompare(b.code)
        )
      return {
        country: toCountryRef(country),
        stats: deriveStats(roster, activeLanguages),
        board: await loadBoard(country.id),
      }
    })
  )
}

export async function getWorkspace(actor: Actor, isoOrSlug: string): Promise<WorkspaceDetail> {
  const country = await resolveMarket(isoOrSlug)
  if (actor.role !== 'ADMIN' && country.id !== actor.countryId) {
    throw new WorkspaceError(
      'WORKSPACE_OUT_OF_SCOPE',
      `The ${country.name} workspace is out of your scope — workspaces are country-scoped (§20): you operate ${actor.countryId ? 'your own market' : 'no market'} and can never reach another by parameter.`
    )
  }
  const roster = await loadRoster(country.id)
  const coverage = await loadCoverage(country, roster)
  const activeLanguages = coverage.map((entry) => ({ code: entry.code, name: entry.name }))
  return {
    country: toCountryRef(country),
    stats: deriveStats(roster, activeLanguages),
    board: await loadBoard(country.id),
    staff: roster.map((row) => toMember(row, actor)),
    coverage,
    canManage: can(actor, 'staff:manage', { countryId: country.id }),
    contract: WORKSPACE_CONTRACT,
  }
}

// ---------- §32 editorial-family metrics (windowless stock) ----------

export async function workspaceInsightMetrics(): Promise<WorkspaceInsightMetrics> {
  const snapshot = await getSnapshot()

  const rosters = await Promise.all(
    snapshot.countries.map(async (country) => ({ country, roster: await loadRoster(country.id) }))
  )

  const byRole = { writer: 0, countryAdmin: 0, platformAdmin: 0 }
  let suspended = 0
  const unstaffedLanguages: string[] = []
  let languagesConfigured = 0
  let languagesStaffed = 0
  let staffedMarkets = 0

  for (const { country, roster } of rosters) {
    const workspaceStaff = roster.filter((row) => row.role !== 'ADMIN')
    for (const row of roster) {
      if (row.role === 'ADMIN') byRole.platformAdmin += 1
      else if (row.role === 'WRITER') byRole.writer += 1
      else byRole.countryAdmin += 1
      if (row.status === 'SUSPENDED') suspended += 1
    }
    const activeWorkspaceStaff = workspaceStaff.filter((row) => row.status === 'ACTIVE')
    if (activeWorkspaceStaff.length > 0) staffedMarkets += 1

    const activeLanguages = country.languages.filter((language) => language.status === 'ACTIVE')
    for (const language of activeLanguages) {
      languagesConfigured += 1
      const staffed = activeWorkspaceStaff.some(
        (row) => row.languageScope == null || row.languageScope.code === language.code
      )
      if (staffed) languagesStaffed += 1
      else unstaffedLanguages.push(`${country.isoCode}/${language.code}`)
    }
  }

  const derivation =
    `Country-specific editorial workspaces are derived state (§14/§34): one workspace per configured market — ` +
    `the market's User rows (homeCountryId) are the roster, their languageScopeId rows are the language dimension; ` +
    `there is no stored workspace table to go stale. Coverage counts WRITER/COUNTRY_ADMIN only (the §18 workspace ` +
    `classes): a platform ADMIN can work any workspace by design (§38) and is excluded — ${byRole.platformAdmin} ` +
    `platform admin row(s) exist outside the coverage read. A configured market-language is "staffed" when ≥1 ` +
    `ACTIVE staff member can work it (explicitly scoped to it, or all-language within the market — §20 null scope). ` +
    `Suspended staff never count (suspension is reversible, §36 spirit — nothing is deleted). Every count is the ` +
    `same derivation the workspace console and the launch checklist read.`

  return {
    marketsConfigured: snapshot.countries.length,
    staffedMarkets,
    byRole,
    suspended,
    languagesConfigured,
    languagesStaffed,
    unstaffedLanguages,
    derivation,
  }
}
