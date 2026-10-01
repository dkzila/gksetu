/**
 * GKSetu — Workspaces: §20 staff provisioning (P9-S3)
 *
 * The HEAVY half of the module — deliberately OFF the module barrel and
 * imported ONLY by the provisioning routes (the P9-S1 ai-service precedent):
 * it pulls `hashPassword` (node:crypto scrypt at module scope) and
 * `randomInt`, which must never enter a client bundle. The client-safe face
 * (reads + §32 metrics) stays in ./service.ts; the leak was caught live by
 * the browser verification round — value-imports reach this module through
 * the analytics barrel chain (feedback-section → content-quality →
 * feedback-service → analytics → insights → workspaces barrel), so anything
 * on the barrel travels to the browser.
 */
import { randomInt } from 'node:crypto'

import { db } from '@/lib/db'
import { hashPassword } from '@/modules/identity-access'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit } from '@/modules/audit'
import type { Actor } from '@/lib/permissions'

import {
  WorkspaceError,
  resolveMarket,
  toMember,
  WORKSPACE_CONTRACT,
  type WorkspaceErrorCode,
  type StaffRow,
} from './service'
import type { StaffInviteResult, StaffUpdateResult } from './types'
import type { CreateStaffInput, UpdateStaffInput } from './validation'

// ---------- One-time credentials (§20 invite semantics) ----------

const ONE_TIME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/**
 * Server-generated one-time credential — never chosen by the inviting
 * operator, never stored in plaintext (scrypt hash only), revealed ONCE.
 * Format satisfies the shared password policy (letters + digits, 8+).
 */
function generateOneTimePassword(): string {
  const body = Array.from({ length: 12 }, () => ONE_TIME_ALPHABET[randomInt(ONE_TIME_ALPHABET.length)]).join('')
  return `GKSetu-${body}9`
}

// ---------- §20 denial audit (the qnaDenied precedent) ----------

/**
 * Object-level denial — the §20 signal: a cross-market probe or class
 * violation is a security event, recorded best-effort, then the typed error
 * is thrown. (`return deny(...)` at call sites — Promise<never> narrows TS.)
 */
async function deny(
  actor: Actor,
  code: WorkspaceErrorCode,
  message: string,
  context: { operation: string; objectType: 'country' | 'user'; objectId: string | null; objectLabel: string },
  meta: { ip?: string | null; userAgent?: string | null }
): Promise<never> {
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.staffDenied,
    objectType: context.objectType === 'country' ? AUDIT_OBJECT_TYPES.country : AUDIT_OBJECT_TYPES.user,
    objectId: context.objectId,
    objectLabel: context.objectLabel,
    metadata: { attemptedOperation: context.operation, reason: code },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  throw new WorkspaceError(code, message)
}

// ---------- invite ----------

export async function createStaff(
  actor: Actor,
  isoOrSlug: string,
  input: CreateStaffInput,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<StaffInviteResult> {
  const country = await resolveMarket(isoOrSlug)
  if (actor.role !== 'ADMIN' && country.id !== actor.countryId) {
    return deny(
      actor,
      'WORKSPACE_OUT_OF_SCOPE',
      `You cannot invite staff into the ${country.name} workspace — provisioning is country-scoped (§20): an operator of one market can never mint accounts into another.`,
      { operation: 'invite', objectType: 'country', objectId: country.id, objectLabel: `${country.isoCode} workspace` },
      meta
    )
  }

  // §18/§20 role-class coherence: the language scope narrows WRITER at the
  // permission layer (WRITER_NARROWED); COUNTRY_ADMIN owns the whole
  // workspace, so a scope on that class would be a rule we never run.
  if (input.role === 'COUNTRY_ADMIN' && input.languageScopeCode != null && input.languageScopeCode !== '') {
    return deny(
      actor,
      'STAFF_SCOPE_ROLE_MISMATCH',
      'A COUNTRY_ADMIN operates the whole workspace — language scopes are the WRITER class (§18). Invite them without a scope.',
      { operation: 'invite', objectType: 'country', objectId: country.id, objectLabel: `${country.isoCode} workspace` },
      meta
    )
  }

  // §35: the scope must be a language the market actually configures —
  // validated against the same locale snapshot every surface reads.
  let languageScopeId: string | null = null
  if (input.languageScopeCode != null && input.languageScopeCode !== '') {
    const code = input.languageScopeCode.toLowerCase()
    const configured = country.languages.find((language) => language.status === 'ACTIVE' && language.code === code)
    if (!configured) {
      return deny(
        actor,
        'LANGUAGE_NOT_CONFIGURED_FOR_MARKET',
        `"${code}" is not a configured language of the ${country.name} market (§35) — its workspace staff may only be scoped to ${country.languages.filter((language) => language.status === 'ACTIVE').map((language) => language.code).join(', ') || 'no configured languages'}.`,
        { operation: 'invite', objectType: 'country', objectId: country.id, objectLabel: `${country.isoCode} workspace` },
        meta
      )
    }
    languageScopeId = configured.id
  }

  const existing = await db.user.findUnique({ where: { email: input.email } })
  if (existing) {
    throw new WorkspaceError('EMAIL_TAKEN', 'An account with this email already exists')
  }

  // Preferred language: the scope language, else the market default, else
  // the first active configured language (the seed convention) — resolved
  // from the same snapshot, no extra round-trips.
  const activeLanguages = country.languages.filter((language) => language.status === 'ACTIVE')
  const scopeLanguage = languageScopeId
    ? (country.languages.find((language) => language.id === languageScopeId) ?? null)
    : null
  const defaultLanguage =
    country.defaultLanguage && country.defaultLanguage.status === 'ACTIVE' ? country.defaultLanguage : null
  const preferredLanguageRow = scopeLanguage ?? defaultLanguage ?? activeLanguages[0] ?? null

  const oneTimePassword = generateOneTimePassword()
  const passwordHash = await hashPassword(oneTimePassword)

  const user = await db.user.create({
    data: {
      email: input.email,
      name: input.name ?? null,
      passwordHash,
      role: input.role,
      status: 'ACTIVE',
      // The verification flow itself is a later concern — the seed precedent:
      // provisioned staff are marked verified on arrival.
      emailVerifiedAt: new Date(),
      homeCountryId: country.id,
      preferredLanguageId: preferredLanguageRow?.id ?? null,
      languageScopeId,
    },
    include: { languageScope: true, preferredLanguage: true },
  })

  const member = toMember(
    {
      ...user,
      role: input.role,
      languageScope: user.languageScope ? { code: user.languageScope.code, name: user.languageScope.name } : null,
      preferredLanguage: user.preferredLanguage
        ? { code: user.preferredLanguage.code, name: user.preferredLanguage.name }
        : null,
    },
    actor
  )

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.staffCreate,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectId: user.id,
    objectLabel: user.email,
    before: null,
    after: {
      role: user.role,
      status: user.status,
      workspace: country.isoCode,
      languageScope: user.languageScope?.code ?? null,
      preferredLanguage: user.preferredLanguage?.code ?? null,
    },
    // The one-time credential is NEVER written here (§30) — the audit
    // layer's redaction additionally masks any *credential* key to
    // '[redacted]' before persisting, so the note below is stored redacted
    // by design; only the scrypt hash exists, in the account row.
    metadata: {
      invitedBy: actor.email,
      workspace: country.isoCode,
      credential: 'server-generated one-time; scrypt-hashed; revealed once at invite',
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return {
    member,
    oneTimePassword,
    contract: WORKSPACE_CONTRACT,
  }
}

// ---------- adjust / suspend / reset ----------

export async function updateStaff(
  actor: Actor,
  isoOrSlug: string,
  userId: string,
  input: UpdateStaffInput,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<StaffUpdateResult> {
  const country = await resolveMarket(isoOrSlug)
  if (actor.role !== 'ADMIN' && country.id !== actor.countryId) {
    return deny(
      actor,
      'WORKSPACE_OUT_OF_SCOPE',
      `You cannot manage staff of the ${country.name} workspace — provisioning is country-scoped (§20).`,
      { operation: 'update', objectType: 'country', objectId: country.id, objectLabel: `${country.isoCode} workspace` },
      meta
    )
  }

  // By-id probe: cross-market and unknown ids are indistinguishable (404) —
  // a Country A operator probing Country B staff must not learn it exists.
  const target = await db.user.findUnique({
    where: { id: userId },
    include: { languageScope: true, preferredLanguage: true },
  })
  if (!target || target.status === 'DELETED' || target.homeCountryId !== country.id) {
    return deny(
      actor,
      'STAFF_MEMBER_NOT_FOUND',
      `No staff member of the ${country.name} workspace matches that id (§20 — cross-market ids are indistinguishable from unknown ones).`,
      { operation: 'update', objectType: 'user', objectId: userId, objectLabel: `${country.isoCode}/staff/${userId.slice(0, 8)}…` },
      meta
    )
  }
  if (target.role === 'ADMIN') {
    return deny(
      actor,
      'STAFF_MANAGE_ADMIN_REFUSED',
      'ADMIN is the platform class (§38) — platform accounts are managed outside the workspace surfaces. This row is visible because the platform admin can work any workspace; it is never managed through one.',
      { operation: 'update', objectType: 'user', objectId: target.id, objectLabel: target.email },
      meta
    )
  }
  if (target.id === actor.userId) {
    return deny(
      actor,
      'STAFF_SELF_MUTATION_REFUSED',
      'Operators never mutate their own staff row through the provisioning surface (§20) — use the profile surface for your own name; role/status/credential changes to yourself are an operator-to-operator action.',
      { operation: 'update', objectType: 'user', objectId: target.id, objectLabel: target.email },
      meta
    )
  }

  // §18/§20 role-class coherence (same rule as invite): the EFFECTIVE state
  // after this request must not pair COUNTRY_ADMIN with a language scope —
  // the permission layer only narrows WRITER (WRITER_NARROWED), so such a
  // scope would be a rule we never run.
  const effectiveRole = input.role ?? target.role
  const effectiveScopeId =
    input.languageScopeCode !== undefined
      ? input.languageScopeCode == null || input.languageScopeCode === ''
        ? null
        : input.languageScopeCode.toLowerCase()
      : target.languageScopeId
  if (effectiveRole === 'COUNTRY_ADMIN' && effectiveScopeId != null && effectiveScopeId !== '') {
    return deny(
      actor,
      'STAFF_SCOPE_ROLE_MISMATCH',
      'A COUNTRY_ADMIN operates the whole workspace — language scopes are the WRITER class (§18). Clear the scope (languageScopeCode: null) in the same request that promotes, or invite them without one.',
      { operation: 'update', objectType: 'user', objectId: target.id, objectLabel: target.email },
      meta
    )
  }

  // §35 scope validation (same registry, one truth).
  let languageScopeId: string | null | undefined
  if (input.languageScopeCode !== undefined) {
    if (input.languageScopeCode == null || input.languageScopeCode === '') {
      languageScopeId = null // explicit clear → all the market's languages
    } else {
      const code = input.languageScopeCode.toLowerCase()
      const configured = country.languages.find((language) => language.status === 'ACTIVE' && language.code === code)
      if (!configured) {
        return deny(
          actor,
          'LANGUAGE_NOT_CONFIGURED_FOR_MARKET',
          `"${code}" is not a configured language of the ${country.name} market (§35).`,
          { operation: 'update', objectType: 'user', objectId: target.id, objectLabel: target.email },
          meta
        )
      }
      languageScopeId = configured.id
    }
  }

  const data: {
    name?: string | null
    role?: 'WRITER' | 'COUNTRY_ADMIN'
    status?: 'ACTIVE' | 'SUSPENDED'
    languageScopeId?: string | null
    passwordHash?: string
  } = {}
  if (input.name !== undefined) data.name = input.name
  if (input.role !== undefined) data.role = input.role
  if (input.status !== undefined) data.status = input.status
  if (languageScopeId !== undefined) data.languageScopeId = languageScopeId

  let oneTimePassword: string | null = null
  if (input.resetCredential) {
    oneTimePassword = generateOneTimePassword()
    data.passwordHash = await hashPassword(oneTimePassword)
  }

  const before = {
    role: target.role,
    status: target.status,
    name: target.name,
    languageScope: target.languageScope?.code ?? null,
  }

  const updated = await db.user.update({
    where: { id: target.id },
    data,
    include: { languageScope: true, preferredLanguage: true },
  })

  // §36 spirit + §30: suspension revokes every active session immediately —
  // counted in the audit row; nothing is deleted, reactivation is reversible.
  let revokedSessions = 0
  if (input.status === 'SUSPENDED' && target.status !== 'SUSPENDED') {
    const result = await db.authSession.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    revokedSessions = result.count
  }

  const member = toMember(
    {
      ...updated,
      role: updated.role as StaffRow['role'],
      languageScope: updated.languageScope ? { code: updated.languageScope.code, name: updated.languageScope.name } : null,
      preferredLanguage: updated.preferredLanguage
        ? { code: updated.preferredLanguage.code, name: updated.preferredLanguage.name }
        : null,
    },
    actor
  )

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.staffUpdate,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectId: updated.id,
    objectLabel: updated.email,
    before,
    after: {
      role: updated.role,
      status: updated.status,
      name: updated.name,
      languageScope: updated.languageScope?.code ?? null,
    },
    metadata: {
      workspace: country.isoCode,
      fields: Object.keys(data),
      otpReset: input.resetCredential === true, // named to survive the §30 redaction pattern (any *credential* key would be masked)
      ...(revokedSessions > 0 ? { revokedSessions } : {}), // §36 spirit + §30: the suspension's immediate session revocation, counted
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { member, oneTimePassword, contract: WORKSPACE_CONTRACT }
}
