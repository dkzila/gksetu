/**
 * GlobIQ — SEO module: the anonymous arrival census (P8-S5)
 *
 * Master Plan §32 (the growth/referral half the P8-S4 handoff names —
 * "arrival attribution: the ShareEvent landings are the in-platform half;
 * referrer halves land with real traffic"), §33 ("search traffic is
 * acquisition" — the SEO module owns public-surface measurement, so it owns
 * the arrival store, §28), §31 (ANONYMOUS-ONLY by the SearchQueryLog
 * precedent: no userId column exists at all — an arrival can never become a
 * profile, the reset never touches it; the referrer is classified IN THE
 * BROWSER so the raw referrer URL never crosses the wire), §16 (the surface
 * + market are derived SERVER-SIDE from the canonical path grammar — never
 * from client claims), §37 (schema-validated input, typed errors).
 *
 * The beacon is fire-and-forget from the app shell: ONE row per page load,
 * best-effort — a failed beacon never blocks the page (the P8-S1 landing
 * precedent). In-app hash navigation is NOT an arrival (only the page-load
 * URL is recorded — the client fires the beacon once, with the mount-time
 * hash).
 */
import { db } from '@/lib/db'
import { resolveFromPath } from '@/modules/country-locale'
import { LocaleError } from '@/modules/country-locale'

import { SeoError } from './errors'
import type { LandingEventInput } from './validation'

/** The server-derived landing identity: surface class + §35 market. */
interface ParsedLanding {
  surface:
    | 'HOME'
    | 'TOPIC'
    | 'KNOWLEDGE'
    | 'QUESTION'
    | 'CURRENT_AFFAIRS'
    | 'EXAM'
    | 'SYLLABUS'
    | 'MOCK_TEST'
    | 'COLLECTION'
    | 'APP'
  countryIso: string
}

/**
 * Classifies a §16 path into the landing surface + market — the same
 * grammar the hash router and parseSharePath speak (server-side, so the
 * beacon cannot claim a surface the URL does not carry). Everything that is
 * not a public §16 surface honestly lands as APP (the in-app/private half:
 * dashboard, console, profile… — an arrival is an arrival).
 */
async function parseLandingPath(rawPath: string): Promise<ParsedLanding | null> {
  const trimmed = rawPath.trim()
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  const [pathPart, queryPart] = withoutHash.split('?')
  const queryParams = new URLSearchParams(queryPart ?? '')
  const focusRaw = queryParams.get('q') ?? ''

  let resolution: Awaited<ReturnType<typeof resolveFromPath>>
  try {
    resolution = await resolveFromPath(pathPart ?? '/')
  } catch (error) {
    if (error instanceof LocaleError) return null // unknown market segments — honest 400
    throw error
  }
  const countryIso = resolution.country.isoCode
  const segments = (resolution.remainingPath ?? '/')
    .split('/')
    .filter((segment) => segment.length > 0)

  if (segments.length === 0) return { surface: 'HOME', countryIso }

  // …/gk/{topic}/ — the §33 topic hub.
  if (segments[0] === 'gk' && segments.length === 2) {
    return { surface: 'TOPIC', countryIso }
  }
  // …/gk/{topic}/{unit}/ (+ ?q= focus → the §22 practice layer).
  if (segments[0] === 'gk' && segments.length === 3) {
    return { surface: focusRaw ? 'QUESTION' : 'KNOWLEDGE', countryIso }
  }
  // …/current-affairs/{slug}/ (§12/§16).
  if (segments[0] === 'current-affairs' && segments.length === 2) {
    return { surface: 'CURRENT_AFFAIRS', countryIso }
  }
  // …/exams/{exam}/ and its §16 subpages.
  if (segments[0] === 'exams' && segments.length === 2) {
    return { surface: 'EXAM', countryIso }
  }
  if (segments[0] === 'exams' && segments[3] === 'syllabus' && segments.length === 4) {
    return { surface: 'SYLLABUS', countryIso }
  }
  if (segments[0] === 'exams' && segments[3] === 'mock-tests' && segments.length === 4) {
    return { surface: 'MOCK_TEST', countryIso }
  }
  // /collections/{id}/ — the §21 unlisted landing (market-independent path,
  // but the beacon's path still resolves through the reader's market).
  if (segments[0] === 'collections' && segments.length === 2) {
    return { surface: 'COLLECTION', countryIso }
  }
  // Everything else the router serves is an in-app view (§37: the private
  // half — dashboard, console, following, saved, onboarding, profile,
  // personalisation, notifications, feedback, quick-mock hub).
  return { surface: 'APP', countryIso }
}

/** POST /api/seo/landings — records one anonymous arrival. */
export async function recordLanding(input: LandingEventInput): Promise<{ recorded: true; surface: string }> {
  const parsed = await parseLandingPath(input.path)
  if (!parsed) {
    throw new SeoError(
      'LANDING_PATH_NOT_PARSEABLE',
      'That path does not resolve to a market — the arrival was not recorded (§16).'
    )
  }
  await db.landingEvent.create({
    data: {
      surface: parsed.surface,
      referrerClass: input.referrerClass,
      countryIso: parsed.countryIso,
    },
  })
  return { recorded: true, surface: parsed.surface }
}
