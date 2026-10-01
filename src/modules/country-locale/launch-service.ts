/**
 * GKSetu — Country & Locale: launch lifecycle (P9-S2)
 *
 * Master Plan §43 Phase 9 Session 2 — "country launch configuration": the
 * controlled, auditable state machine that takes a market from configuration
 * to live, plus the §15 geo routing signal.
 *
 *  - §14: country is a first-class scope; India is the default root market.
 *  - §15: geo is a ROUTING AND DEFAULT-CONTEXT SIGNAL — never a wall. The
 *    geo hint routes a first-time visitor; deliberate switching stays always
 *    available; data scoping is enforced elsewhere (server-side, per query).
 *  - §16: the launch transition changes the public URL space (/{slug}/ goes
 *    live) — transitions invalidate the locale snapshot immediately.
 *  - §34: each country homepage is that market's discovery hub — launch
 *    readiness is DERIVED from the live data the homepage would serve, never
 *    a stored checklist that can go stale.
 *  - §31: the geo hint stores nothing, logs nothing, and is anonymous by
 *    construction — a routing signal is not personal data.
 *  - §36 spirit: launchedAt is the market's FIRST go-live moment; pause and
 *    relaunch never rewrite it — the audit trail carries every transition.
 *  - §37: explicit errors, authorization at the service boundary.
 *  - §38: launch configuration is platform admin work (country-config:manage,
 *    ADMIN only — the same stance as every country-config write since P1-S5).
 *
 * Lifecycle (CountryStatus — no enum change; the semantics are the session's
 * deliverable):
 *
 *   INACTIVE ──announce──▶ COMING_SOON ──launch──▶ ACTIVE
 *      │  ▲                    │  ▲                  │
 *      │  └────── pause ───────┼──┘                  │
 *      └───────── pause ◀──────┴─────────────────────┘
 *      └──────────── launch (soft launch, no announcement) ──▶ ACTIVE
 *
 *  - INACTIVE: staged/paused — hidden from every public surface, fully
 *    configurable in the admin console (§38).
 *  - COMING_SOON: ANNOUNCED — publicly acknowledged (switcher "soon" tag,
 *    homepage coming-soon hero, sitemap quiet state) but NOT launched: no
 *    market exams, no geo routing target.
 *  - ACTIVE: LIVE — the full public surface (§34 homepage, exams, search
 *    documents, sitemap exam/syllabus enumeration, geo-hint eligibility).
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit } from '@/modules/audit'
import { buildCanonicalUrl } from './url'
import { getSnapshot, invalidateSnapshot, type CountrySnapshotRow } from './cache'
import { LocaleError, type LocaleRequestMeta } from './service'

// ---------- Public types (§37 client-agnostic DTOs) ----------

export type LaunchCheckState = 'ok' | 'warn' | 'block'

export interface LaunchCheck {
  key: string
  label: string
  state: LaunchCheckState
  /** What was measured and how — the derivation-string discipline (§32 spirit). */
  detail: string
}

export type LaunchAction = 'announce' | 'launch' | 'pause'

export interface LaunchReadiness {
  country: {
    isoCode: string
    slug: string
    name: string
    status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
    isDefault: boolean
    launchedAt: string | null
    timezone: string | null
    defaultLanguage: { code: string; name: string } | null
    languages: Array<{ code: string; name: string }>
  }
  /** Hard invariants first, then advisory readiness — stable order (§37). */
  checks: LaunchCheck[]
  blocks: number
  warnings: number
  /** The actions valid from the current state (empty for the default market). */
  availableActions: LaunchAction[]
  derivation: string
}

export interface GeoHint {
  suggestion: {
    isoCode: string
    slug: string
    name: string
    defaultLanguage: { code: string; name: string }
    /** The server-built canonical home URL (§16 — never built client-side). */
    homeUrl: string
    /** The SPA's hash mirror of homeUrl (the sandbox's `/`-only path). */
    homeHash: string
  } | null
  /** 'header:cf-ipcountry' | 'header:x-vercel-ip-country' | 'header:x-geo-country' | 'none' */
  source: string
  note: string
}

// ---------- Shared lookups ----------

function auditRefOf(actor: Actor) {
  return { userId: actor.userId, email: actor.email, role: actor.role }
}

async function findCountryRow(isoOrSlug: string): Promise<CountrySnapshotRow> {
  const snapshot = await getSnapshot()
  const key = isoOrSlug.trim()
  const country =
    snapshot.countries.find((c) => c.slug === key.toLowerCase()) ??
    snapshot.countries.find((c) => c.isoCode === key.toUpperCase())
  if (!country) {
    throw new LocaleError('COUNTRY_NOT_FOUND', `Unknown country "${isoOrSlug}"`)
  }
  return country
}

/** The market scope filter every §14/§15 content query uses (GLOBAL or owned). */
const MARKET_SCOPE = (countryId: string) => ({
  OR: [{ scope: 'GLOBAL' as const }, { scope: 'COUNTRY' as const, countryId }],
})

// ---------- Launch readiness (§34 — derived, never stored) ----------

export async function getLaunchReadiness(isoOrSlug: string): Promise<LaunchReadiness> {
  const country = await findCountryRow(isoOrSlug)

  const activeLanguages = country.languages.filter((language) => language.status === 'ACTIVE')
  const defaultLanguageActive =
    !!country.defaultLanguage &&
    country.defaultLanguage.status === 'ACTIVE' &&
    activeLanguages.some((language) => language.id === country.defaultLanguageId)

  const checks: LaunchCheck[] = []

  // ----- Hard invariants (block launch — the homepage/routing would break) -----

  checks.push({
    key: 'defaultLanguage',
    label: 'Default language configured',
    state: defaultLanguageActive ? 'ok' : 'block',
    detail: defaultLanguageActive
      ? `${country.defaultLanguage?.name} (${country.defaultLanguage?.code}) — omitted from URLs per §16; resolution and hreflang depend on it.`
      : 'No ACTIVE default language is configured for this market — the §16 canonical URL grammar and the §34 homepage cannot be built without it (fix in the language configuration above).',
  })

  checks.push({
    key: 'languages',
    label: 'At least one active language',
    state: activeLanguages.length > 0 ? 'ok' : 'block',
    detail:
      activeLanguages.length > 0
        ? `${activeLanguages.length} active configured language(s) (§35 — a market exposes only its own configured set, never a global list).`
        : 'The market exposes zero active configured languages (§35).',
  })

  // ----- Advisory readiness (§34 homepage blocks + editorial state — shown,
  // never silently omitted, deliberately non-blocking: launching a thin
  // market is an operator decision; hiding the thinness would not be one) -----

  const marketUnits = MARKET_SCOPE(country.id)
  // §35 honesty: a market's homepage serves ONLY its configured languages —
  // readiness counts representations in THOSE languages (an EN item on a
  // GLOBAL unit is real for GB/en, invisible for FR/fr — never overcount).
  const activeLanguageCodes = activeLanguages.map((language) => language.code)
  const marketLanguage = activeLanguageCodes.length > 0 ? { code: { in: activeLanguageCodes } } : { code: '__none__' }
  const [publishedPages, publishedEvents, activeExams, publishedQna, publishedQuestions, staff] =
    await Promise.all([
      db.contentItem.count({
        where: {
          status: 'PUBLISHED',
          language: marketLanguage,
          knowledgeUnit: marketUnits,
        },
      }),
      db.contentItem.count({
        where: {
          status: 'PUBLISHED',
          language: marketLanguage,
          currentEvent: marketUnits,
        },
      }),
      db.exam.count({ where: { countryId: country.id, status: 'ACTIVE' } }),
      db.qnA.count({
        where: { status: 'PUBLISHED', language: marketLanguage, knowledgeUnit: marketUnits },
      }),
      db.question.count({
        where: { status: 'PUBLISHED', language: marketLanguage, knowledgeUnit: marketUnits },
      }),
      db.user.count({
        where: {
          homeCountryId: country.id,
          role: { in: ['WRITER', 'COUNTRY_ADMIN', 'ADMIN'] },
        },
      }),
    ])

  const assessmentTotal = publishedQna + publishedQuestions

  checks.push({
    key: 'knowledgePages',
    label: 'Published knowledge pages',
    state: publishedPages > 0 ? 'ok' : 'warn',
    detail:
      publishedPages > 0
        ? `${publishedPages} published ContentItem(s) in the market's language(s) (${activeLanguageCodes.join(', ')}) anchored to GLOBAL or ${country.isoCode}-owned KnowledgeUnits — the homepage's "popular knowledge" and the topic hubs draw on these (§34).`
        : `0 published knowledge pages in the market's language(s) (${activeLanguageCodes.join(', ') || 'none configured'}) on GLOBAL or ${country.isoCode}-owned units — the homepage's "popular knowledge" and topic blocks will render their honest empty states (§34).`,
  })

  checks.push({
    key: 'currentAffairs',
    label: 'Published current affairs',
    state: publishedEvents > 0 ? 'ok' : 'warn',
    detail:
      publishedEvents > 0
        ? `${publishedEvents} published event representation(s) in the market's language(s) — the homepage's current-affairs column (§34).`
        : `0 published current-affairs representations in the market's language(s) — the homepage's current-affairs column will be empty (§34).`,
  })

  checks.push({
    key: 'exams',
    label: 'Active exams',
    state: activeExams > 0 ? 'ok' : 'warn',
    detail:
      activeExams > 0
        ? `${activeExams} ACTIVE exam(s) — exam pages enter the sitemap and the search index only once the market is live (§14/§16).`
        : '0 ACTIVE exams (§14 — every exam belongs to exactly one country); the homepage exams block will say "exams at launch" (§34).',
  })

  checks.push({
    key: 'assessment',
    label: 'Published practice material',
    state: assessmentTotal > 0 ? 'ok' : 'warn',
    detail:
      assessmentTotal > 0
        ? `${publishedQna} published QnA + ${publishedQuestions} published Question(s) in the market's language(s) on in-scope units — the §22 practice layer.`
        : `0 published QnA/Questions in the market's language(s) on in-scope units — the §22 practice layer will be absent at launch.`,
  })

  checks.push({
    key: 'workspace',
    label: 'Editorial workspace staff',
    state: staff > 0 ? 'ok' : 'warn',
    detail:
      staff > 0
        ? `${staff} staff account(s) homed in ${country.isoCode} (WRITER/COUNTRY_ADMIN/ADMIN).`
        : `0 staff accounts homed in ${country.isoCode} — the country-specific editorial workspace (P9-S3) will have no one to work it.`,
  })

  checks.push({
    key: 'timezone',
    label: 'Market timezone',
    state: country.timezone ? 'ok' : 'warn',
    detail: country.timezone
      ? `${country.timezone} (IANA) — display/reference metadata.`
      : 'No IANA timezone set — optional, but the homepage and §32 derivations read it.',
  })

  const blocks = checks.filter((check) => check.state === 'block').length
  const warnings = checks.filter((check) => check.state === 'warn').length

  const availableActions: LaunchAction[] = []
  if (!country.isDefault) {
    if (country.status === 'INACTIVE') availableActions.push('announce', 'launch')
    else if (country.status === 'COMING_SOON') availableActions.push('launch', 'pause')
    else availableActions.push('pause')
  }

  const derivation =
    `Readiness is DERIVED from the live data the §34 homepage would serve (never a stored checklist). ` +
    `Lifecycle: INACTIVE (staged/paused, hidden) → COMING_SOON (announced, not routable as a market) → ACTIVE (live). ` +
    `${blocks} blocking invariant(s), ${warnings} advisory warning(s). ` +
    `The default root market is live by definition (§14) — its lifecycle is frozen.`

  return {
    country: {
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
    },
    checks,
    blocks,
    warnings,
    availableActions,
    derivation,
  }
}

// ---------- Lifecycle transitions ----------

function assertNotDefault(country: CountrySnapshotRow, action: LaunchAction): void {
  if (country.isDefault) {
    throw new LocaleError(
      'DEFAULT_COUNTRY_IMMUTABLE',
      `The default root market is live by definition (§14) — ${action} does not apply to it`
    )
  }
}

async function readBack(isoCode: string): Promise<LaunchReadiness> {
  // Fresh snapshot: the transition invalidated the cache on its way out.
  const readiness = await getLaunchReadiness(isoCode)
  return readiness
}

/** INACTIVE → COMING_SOON — the public announcement (no content requirement). */
export async function announceCountry(
  actor: Actor,
  isoOrSlug: string,
  meta: LocaleRequestMeta & { note?: string } = {}
): Promise<LaunchReadiness> {
  assertCan(actor, 'country-config:manage')
  const country = await findCountryRow(isoOrSlug)
  assertNotDefault(country, 'announce')

  if (country.status === 'ACTIVE') {
    throw new LocaleError('COUNTRY_ALREADY_LIVE', `${country.name} is live — there is nothing to announce`)
  }
  if (country.status === 'COMING_SOON') {
    throw new LocaleError('COUNTRY_ALREADY_ANNOUNCED', `${country.name} is already announced (COMING_SOON)`)
  }

  await db.country.update({
    where: { id: country.id },
    data: { status: 'COMING_SOON' },
  })
  invalidateSnapshot()

  const readiness = await readBack(country.isoCode)
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.countryAnnounce,
    objectType: AUDIT_OBJECT_TYPES.country,
    objectId: country.isoCode,
    objectLabel: country.name,
    before: { status: 'INACTIVE' },
    after: { status: 'COMING_SOON' },
    metadata: {
      isoCode: country.isoCode,
      warnings: readiness.warnings,
      ...(meta.note ? { note: meta.note } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return readiness
}

/** (COMING_SOON | INACTIVE) → ACTIVE — the controlled go-live. */
export async function launchCountry(
  actor: Actor,
  isoOrSlug: string,
  meta: LocaleRequestMeta & { note?: string } = {}
): Promise<LaunchReadiness> {
  assertCan(actor, 'country-config:manage')
  const country = await findCountryRow(isoOrSlug)
  assertNotDefault(country, 'launch')

  if (country.status === 'ACTIVE') {
    throw new LocaleError('COUNTRY_ALREADY_LIVE', `${country.name} is already live`)
  }

  const readiness = await getLaunchReadiness(country.isoCode)
  if (readiness.blocks > 0) {
    const blockers = readiness.checks
      .filter((check) => check.state === 'block')
      .map((check) => check.label)
      .join('; ')
    throw new LocaleError(
      'LAUNCH_BLOCKS',
      `${country.name} cannot go live yet — ${readiness.blocks} blocking invariant(s): ${blockers}`
    )
  }

  // Atomic: the status flip and the first-launch stamp ride one transaction.
  await db.$transaction(async (tx) => {
    const existing = await tx.country.findUnique({ where: { id: country.id }, select: { launchedAt: true } })
    await tx.country.update({
      where: { id: country.id },
      data: {
        status: 'ACTIVE',
        // §36 spirit: the FIRST go-live moment is immutable history — a
        // pause/relaunch cycle never rewrites it.
        ...(existing?.launchedAt ? {} : { launchedAt: new Date() }),
      },
    })
  })
  invalidateSnapshot()

  const after = await readBack(country.isoCode)
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.countryLaunch,
    objectType: AUDIT_OBJECT_TYPES.country,
    objectId: country.isoCode,
    objectLabel: country.name,
    before: { status: country.status },
    after: { status: 'ACTIVE', launchedAt: after.country.launchedAt },
    metadata: {
      isoCode: country.isoCode,
      launchedWithWarnings: after.warnings,
      warnings: after.checks
        .filter((check) => check.state === 'warn')
        .map((check) => check.key),
      readiness: {
        knowledgePages: after.checks.find((c) => c.key === 'knowledgePages')?.detail ?? '',
        exams: after.checks.find((c) => c.key === 'exams')?.detail ?? '',
      },
      ...(meta.note ? { note: meta.note } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return after
}

/** (ACTIVE | COMING_SOON) → INACTIVE — pause: hidden, content preserved, reversible. */
export async function pauseCountry(
  actor: Actor,
  isoOrSlug: string,
  meta: LocaleRequestMeta & { note?: string } = {}
): Promise<LaunchReadiness> {
  assertCan(actor, 'country-config:manage')
  const country = await findCountryRow(isoOrSlug)
  assertNotDefault(country, 'pause')

  if (country.status === 'INACTIVE') {
    throw new LocaleError('COUNTRY_ALREADY_PAUSED', `${country.name} is already paused (INACTIVE)`)
  }

  await db.country.update({
    where: { id: country.id },
    data: { status: 'INACTIVE' },
  })
  invalidateSnapshot()

  const after = await readBack(country.isoCode)
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.countryPause,
    objectType: AUDIT_OBJECT_TYPES.country,
    objectId: country.isoCode,
    objectLabel: country.name,
    before: { status: country.status },
    after: { status: 'INACTIVE' },
    metadata: {
      isoCode: country.isoCode,
      reversible: true,
      contentPreserved: true,
      ...(meta.note ? { note: meta.note } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return after
}

// ---------- §15.1 geo routing signal (§31-safe) ----------

/** Standard edge/CDN geo headers, most-specific first. */
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-geo-country'] as const

/** Extracts the visitor's likely country ISO code from standard geo headers. */
export function extractGeoCountry(headers: Headers): { iso: string | null; source: string } {
  for (const header of GEO_HEADERS) {
    const value = headers.get(header)
    if (value && /^[A-Za-z]{2}$/.test(value.trim())) {
      return { iso: value.trim().toUpperCase(), source: `header:${header}` }
    }
  }
  return { iso: null, source: 'none' }
}

/**
 * The §15.1 first-visit routing signal. Suggests ONLY a launched (ACTIVE)
 * non-default market — an announced-but-not-launched market is never a
 * routing target, and the default root market needs no suggestion (it IS `/`).
 * Nothing is stored or logged (§31): a routing hint is not personal data.
 */
export async function getGeoHint(headers: Headers): Promise<GeoHint> {
  const { iso, source } = extractGeoCountry(headers)
  const note =
    'Geo-location is a routing and default-context signal only (§15) — it never blocks access, ' +
    'every country\'s public pages stay reachable, and the deliberate switcher is always available. ' +
    'Nothing about this hint is stored or logged (§31).'

  if (!iso) {
    return { suggestion: null, source: 'none', note }
  }

  const snapshot = await getSnapshot()
  const country = snapshot.countries.find((c) => c.isoCode === iso)
  if (!country || country.isDefault || country.status !== 'ACTIVE' || !country.defaultLanguage) {
    // Unknown market, the root market itself, or not launched — no suggestion
    // (never route to an unlaunched market; §15 honesty over cleverness).
    return { suggestion: null, source, note }
  }

  const homeUrl = buildCanonicalUrl(country, country.defaultLanguage, country.defaultLanguage.code)
  return {
    suggestion: {
      isoCode: country.isoCode,
      slug: country.slug,
      name: country.name,
      defaultLanguage: { code: country.defaultLanguage.code, name: country.defaultLanguage.name },
      homeUrl,
      homeHash: `#${homeUrl}`,
    },
    source,
    note,
  }
}

// ---------- §32 market readiness metrics (editorial family, P9-S1 precedent) ----------

export interface MarketInsightMetrics {
  live: number
  announced: number
  paused: number
  /** Per live market: languages + the §34 block counts (deterministic order). */
  markets: Array<{
    isoCode: string
    name: string
    languages: number
    launchedAt: string | null
    publishedPages: number
    activeExams: number
    publishedEvents: number
  }>
  derivation: string
}

/**
 * The §32 editorial family's market half (config state as a stock metric —
 * the translationCoverage precedent). Readiness numbers are the same
 * derivations the launch checklist uses, aggregate-first.
 */
export async function marketInsightMetrics(): Promise<MarketInsightMetrics> {
  const snapshot = await getSnapshot()
  const nonDefault = snapshot.countries.filter((country) => !country.isDefault)
  const live = nonDefault.filter((country) => country.status === 'ACTIVE')
  const announced = nonDefault.filter((country) => country.status === 'COMING_SOON')

  const markets = await Promise.all(
    live.map(async (country) => {
      const marketUnits = MARKET_SCOPE(country.id)
      const languageCodes = country.languages
        .filter((language) => language.status === 'ACTIVE')
        .map((language) => language.code)
      const marketLanguage = languageCodes.length > 0 ? { code: { in: languageCodes } } : { code: { in: [] } }
      const [pages, exams, events] = await Promise.all([
        db.contentItem.count({ where: { status: 'PUBLISHED', language: marketLanguage, knowledgeUnit: marketUnits } }),
        db.exam.count({ where: { countryId: country.id, status: 'ACTIVE' } }),
        db.contentItem.count({ where: { status: 'PUBLISHED', language: marketLanguage, currentEvent: marketUnits } }),
      ])
      return {
        isoCode: country.isoCode,
        name: country.name,
        languages: languageCodes.length,
        launchedAt: country.launchedAt ? country.launchedAt.toISOString() : null,
        publishedPages: pages,
        activeExams: exams,
        publishedEvents: events,
      }
    })
  )

  const derivation =
    `Country launch state is platform configuration (§14/§15), read as an all-time stock: ` +
    `1 live root market (India, live by definition) + ${live.length} launched market(s) + ` +
    `${announced.length} announced (COMING_SOON) + ${nonDefault.length - live.length - announced.length} paused/staged (INACTIVE). ` +
    `Per launched market: active languages (§35) and the §34 homepage block counts (published knowledge pages, ` +
    `active exams, published current affairs) — the same derivations as the launch checklist. ` +
    `P9-S5 launches the second country as a complete vertical slice over this machinery.`

  return { live: live.length, announced: announced.length, paused: nonDefault.length - live.length - announced.length, markets, derivation }
}
