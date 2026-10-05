/**
 * GKSetu — Site Settings: domain service (CONSOLE-S1)
 * docs/console-master-plan.md §4.1 — the no-redeploy settings registry:
 * integration codes (GA/GTM, Search-Console/Bing verification, Facebook
 * pixel), ads.txt, robots extras, custom head/body HTML and any private
 * key the team adds. Rows are (countryId?, key) — null country is the
 * platform-global value; a country row overrides it for that market.
 *
 * Two read surfaces with deliberately different shapes:
 *  - `getPublicSettings` — the UNAUTHENTICATED injection payload: ONLY the
 *    whitelisted public-facing keys (anything a visitor's browser runs).
 *    A key that leaves this list can never be served publicly.
 *  - `listSettings` — the console's admin view (settings:manage): every
 *    row, private keys included, merged global→country.
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit, type AuditRequestMeta } from '@/modules/audit'

import type { SettingsUpsertInput, SettingsRemoveInput } from './validation'

// ---------- The public-facing whitelist ----------
//
// The ONLY keys /api/settings/public will ever serve. Everything else in the
// registry is admin-only (API keys, third-party secrets — §31).
export const PUBLIC_SETTING_KEYS = [
  'integration.ga.measurementId',
  'integration.gtm.containerId',
  'integration.gsc.verificationToken',
  'integration.bing.verificationToken',
  'integration.facebook.pixelId',
  'integration.headCode',
  'integration.bodyStartCode',
  'ads.txt',
  'robots.extraDirectives',
] as const

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number]

/** The known, structured keys the Settings page renders as typed fields. */
export const KNOWN_SETTING_KEYS = [
  ...PUBLIC_SETTING_KEYS,
  'secrets.searchEngine.apiKey',
  'secrets.analytics.apiSecret',
] as const

export const SETTING_KEY_LABELS: Record<string, string> = {
  'integration.ga.measurementId': 'Google Analytics — Measurement ID (G-…)',
  'integration.gtm.containerId': 'Google Tag Manager — Container ID (GTM-…)',
  'integration.gsc.verificationToken': 'Google Search Console — Verification token (meta tag)',
  'integration.bing.verificationToken': 'Bing Webmaster — Verification token',
  'integration.facebook.pixelId': 'Facebook / Meta — Pixel ID',
  'integration.headCode': 'Custom code — injected into <head> (raw HTML)',
  'integration.bodyStartCode': 'Custom code — injected after <body> opens (raw HTML)',
  'ads.txt': 'ads.txt — served at /ads.txt (raw file content)',
  'robots.extraDirectives': 'robots.txt — extra directives (appended, one per line)',
  'secrets.searchEngine.apiKey': 'Search Engine — API key (private)',
  'secrets.analytics.apiSecret': 'Analytics — API secret (private)',
}

// ---------- Types ----------

export interface PublicSettings {
  /** Merged global (+ optional country override) values for the whitelist. */
  settings: Record<string, string>
  /** The market whose overrides were applied (null = platform-global view). */
  countryIso: string | null
}

export interface AdminSettingRow {
  id: string
  key: string
  value: string
  isActive: boolean
  countryIso: string | null
  updatedAt: string
  updatedBy: { email: string | null } | null
}

export interface AdminSettingsView {
  /** Global rows (countryIso null), key-sorted. */
  global: AdminSettingRow[]
  /** Per-market overrides, grouped by ISO. */
  byCountry: Array<{ countryIso: string; countryName: string; rows: AdminSettingRow[] }>
  /** Every country (so the console can offer override targets). */
  countries: Array<{ isoCode: string; name: string }>
}

export type SettingsErrorCode = 'COUNTRY_NOT_FOUND' | 'KEY_REJECTED' | 'NOT_FOUND'

const ERROR_STATUS: Record<SettingsErrorCode, number> = {
  COUNTRY_NOT_FOUND: 404,
  KEY_REJECTED: 400,
  NOT_FOUND: 404,
}

export class SettingsError extends Error {
  readonly code: SettingsErrorCode
  readonly status: number

  constructor(code: SettingsErrorCode, message: string) {
    super(message)
    this.name = 'SettingsError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

// ---------- Helpers ----------

// Segments start lowercase; camelCase inside a segment is allowed
// (integration.ga.measurementId) — the registry's own vocabulary.
const KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/

/** Setting keys are dotted, lowercase, ≥2 segments (a stable registry vocabulary). */
export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.length > 120) {
    throw new SettingsError('KEY_REJECTED', `Setting key "${key}" is not a valid dotted lowercase key (e.g. integration.ga.measurementId)`)
  }
}

async function resolveCountryId(iso: string | null | undefined): Promise<string | null> {
  if (!iso) return null
  const country = await db.country.findUnique({ where: { isoCode: iso.toUpperCase() } })
  if (!country) throw new SettingsError('COUNTRY_NOT_FOUND', `Country ${iso} not found`)
  return country.id
}

// ---------- Reads ----------

/**
 * The unauthenticated injection payload: ONLY whitelisted public keys,
 * merged global → country override, active rows only, empty values skipped.
 */
export async function getPublicSettings(countryIso?: string | null): Promise<PublicSettings> {
  const rows = await db.siteSetting.findMany({
    where: { isActive: true, key: { in: [...PUBLIC_SETTING_KEYS] } },
    select: { key: true, value: true, countryId: true, country: { select: { isoCode: true } } },
  })

  const settings: Record<string, string> = {}
  // Global first, then overrides — later writes win.
  for (const row of rows) {
    if (row.countryId === null) {
      if (row.value.trim() !== '') settings[row.key] = row.value
    }
  }
  let resolvedIso: string | null = null
  if (countryIso) {
    const iso = countryIso.toUpperCase()
    for (const row of rows) {
      if (row.country?.isoCode === iso && row.value.trim() !== '') {
        settings[row.key] = row.value
        resolvedIso = iso
      }
    }
  }

  return { settings, countryIso: resolvedIso }
}

/** One key's merged public value (ads.txt / robots / verification readers). */
export async function getPublicSettingValue(key: string): Promise<string | null> {
  if (!(PUBLIC_SETTING_KEYS as readonly string[]).includes(key)) return null
  const row = await db.siteSetting.findFirst({
    where: { key, isActive: true, countryId: null },
    select: { value: true },
  })
  const value = row?.value?.trim() ?? ''
  return value === '' ? null : value
}

/** The console's admin view — every row (private keys included). */
export async function listSettings(): Promise<AdminSettingsView> {
  const [rows, countries] = await Promise.all([
    db.siteSetting.findMany({
      orderBy: [{ key: 'asc' }],
      select: {
        id: true,
        key: true,
        value: true,
        isActive: true,
        updatedAt: true,
        countryId: true,
        country: { select: { isoCode: true, name: true } },
        createdBy: { select: { email: true } },
      },
    }),
    db.country.findMany({ orderBy: { name: 'asc' }, select: { isoCode: true, name: true } }),
  ])

  const toRow = (row: (typeof rows)[number]): AdminSettingRow => ({
    id: row.id,
    key: row.key,
    value: row.value,
    isActive: row.isActive,
    countryIso: row.country?.isoCode ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.createdBy ? { email: row.createdBy.email } : null,
  })

  const byCountryMap = new Map<string, { countryIso: string; countryName: string; rows: AdminSettingRow[] }>()
  for (const row of rows) {
    if (!row.country) continue
    const entry = byCountryMap.get(row.country.isoCode) ?? {
      countryIso: row.country.isoCode,
      countryName: row.country.name,
      rows: [],
    }
    entry.rows.push(toRow(row))
    byCountryMap.set(row.country.isoCode, entry)
  }

  return {
    global: rows.filter((row) => row.countryId === null).map(toRow),
    byCountry: [...byCountryMap.values()].sort((a, b) => a.countryName.localeCompare(b.countryName)),
    countries,
  }
}

// ---------- Writes (settings:manage — ADMIN only in v1) ----------

export async function upsertSettings(
  actor: Actor,
  input: SettingsUpsertInput,
  meta: AuditRequestMeta
): Promise<{ applied: number }> {
  assertCan(actor, 'settings:manage')

  let applied = 0
  for (const entry of input.entries) {
    assertValidKey(entry.key)
    const countryId = await resolveCountryId(entry.countryIso)
    // Manual upsert — Prisma types a compound-unique where-input on a
    // nullable field as non-null, which cannot express the global row
    // (countryId null). findFirst handles both shapes.
    const existing = await db.siteSetting.findFirst({ where: { countryId, key: entry.key } })
    if (existing) {
      await db.siteSetting.update({
        where: { id: existing.id },
        data: {
          value: entry.value,
          isActive: entry.isActive ?? true,
          createdById: actor.userId,
        },
      })
    } else {
      await db.siteSetting.create({
        data: {
          key: entry.key,
          value: entry.value,
          isActive: entry.isActive ?? true,
          countryId,
          createdById: actor.userId,
        },
      })
    }
    applied += 1
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.siteSettingUpdate,
      objectType: AUDIT_OBJECT_TYPES.siteSetting,
      objectId: entry.key,
      objectLabel: entry.key,
      before: null,
      after: { value: entry.value, isActive: entry.isActive ?? true, countryIso: entry.countryIso ?? null },
      metadata: { countryIso: entry.countryIso ?? null },
      ...meta,
    })
  }

  return { applied }
}

export async function removeSetting(
  actor: Actor,
  input: SettingsRemoveInput,
  meta: AuditRequestMeta
): Promise<void> {
  assertCan(actor, 'settings:manage')

  const countryId = await resolveCountryId(input.countryIso)
  const existing = await db.siteSetting.findFirst({ where: { countryId, key: input.key } })
  if (!existing) throw new SettingsError('NOT_FOUND', `Setting "${input.key}" not found`)

  await db.siteSetting.delete({ where: { id: existing.id } })
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.siteSettingRemove,
    objectType: AUDIT_OBJECT_TYPES.siteSetting,
    objectId: input.key,
    objectLabel: input.key,
    before: { value: existing.value },
    after: null,
    metadata: { countryIso: input.countryIso ?? null },
    ...meta,
  })
}

// ---------- SITE-S13: internal premium-gating flag ----------

/**
 * SITE-S13: the "free for now" lever. When this returns false (default), the
 * ExamNotes module's gating helper short-circuits — every PUBLISHED note is
 * visible to everyone (anonymous + signed-in). When true, only users with an
 * active `UserPremiumAccess` entitlement see the full note body; others see
 * a 100-char preview + the paywall CTA.
 *
 * The flag lives in site-settings under `premium.gatingEnabled` (default
 * absent = false). The Console's `/console/premium` page toggles it; flipping
 * is a Console edit, not a deploy.
 */
const PREMIUM_GATING_FLAG = 'premium.gatingEnabled'

export async function isPremiumGatingEnabled(): Promise<boolean> {
  const row = await db.siteSetting.findFirst({
    where: { key: PREMIUM_GATING_FLAG, isActive: true, countryId: null },
    select: { value: true },
  })
  return (row?.value ?? '').trim().toLowerCase() === 'true'
}

/** Used by the Console's `/console/premium` page to flip the switch.
 *  Bypasses `assertValidKey` (which guards the public whitelist) since this
 *  key is internal — only the premium module reads it. */
export async function setPremiumGatingEnabled(enabled: boolean, actor: Actor, meta: AuditRequestMeta = {}): Promise<void> {
  assertCan(actor, 'settings:manage')
  const value = enabled ? 'true' : 'false'
  const existing = await db.siteSetting.findFirst({ where: { countryId: null, key: PREMIUM_GATING_FLAG } })
  if (existing) {
    await db.siteSetting.update({
      where: { id: existing.id },
      data: { value, isActive: true, createdById: actor.userId },
    })
  } else {
    await db.siteSetting.create({
      data: { key: PREMIUM_GATING_FLAG, value, countryId: null, isActive: true, createdById: actor.userId },
    })
  }
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.siteSettingUpdate,
    objectType: AUDIT_OBJECT_TYPES.siteSetting,
    objectId: PREMIUM_GATING_FLAG,
    objectLabel: PREMIUM_GATING_FLAG,
    before: existing ? { value: existing.value } : null,
    after: { value },
    metadata: { countryIso: null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })
}

