'use client'

/**
 * GlobIQ — the §16-mirroring hash router (P4-S2, extended P4-S3)
 *
 * The public URL space (Master Plan §16 / Appendix B) is:
 *   India default English   /                       → #/
 *   India non-default lang  /{language}/            → #/hi/
 *   Other country default   /{country}/             → #/uk/
 *   Other country + lang    /{country}/{language}/  → #/fr/… (per config)
 *   Topic hub               …/gk/{topic}/           → #/hi/gk/polity-governance/
 *   Knowledge page          …/gk/{topic}/{unit}/    → #/gk/fundamental-rights/article-32/
 *   Exam page               …/exams/{exam}/         → #/exams/upsc-civil-services/
 *   Syllabus topic          …/exams/{exam}/syllabus/{topic}/
 *                                                   → #/exams/upsc-civil-services/syllabus/constitutional-framework/
 *
 * Inside this sandbox the browser path must stay `/`, so the canonical URL
 * space is mirrored AFTER the hash — the same segment grammar, the same
 * build rules as the server's buildCanonicalUrl (§16: country + language +
 * object identity, defaults omitted), driven by the live country/language
 * configuration from GET /api/countries (§35 — only what each country
 * actually configures). Parsing is lenient: unknown segments fall back to
 * the default market, never an error page.
 *
 * `#account` (the header Sign-in anchor) maps to the foundation console
 * scrolled to the account section — the console keeps every verification
 * surface from P1→P4 reachable. `#/following` (P5-S1) is the private
 * personalisation management surface (§31) — market-independent, noindex —
 * and `#/saved` (P5-S2) its collections counterpart (§10) — likewise
 * market-independent and never indexed. `#/onboarding` and `#/profile`
 * (P5-S3) are the private goal/onboarding surfaces — same rules.
 *
 * Addressable state derives from the hash (never duplicated in component
 * state): `?page=N` for topic-unit pagination, `?version={id}` for the exam
 * page's §36 historical window — the browser back button walks both, and
 * every topic/exam switch starts clean.
 */
import { useEffect, useState } from 'react'

import type { ApiCountry } from './types'

/** §36 version references are canonical ids (cuid). */
const VERSION_PATTERN = /^c[a-z0-9]{20,}$/

export interface AppRoute {
  view: 'home' | 'topic' | 'unit' | 'exam' | 'syllabus' | 'following' | 'saved' | 'onboarding' | 'profile' | 'console'
  countryIso: string
  language: string
  topicSlug: string | null
  unitSlug: string | null
  /** The exam whose page (or syllabus topic) is open. */
  examSlug: string | null
  /** The syllabus topic under the exam view (§16 …/exams/{exam}/syllabus/{topic}/). */
  syllabusTopicSlug: string | null
  /** Addressable topic-units page (≥1; only meaningful on the topic view). */
  page: number
  /** Addressable §36 historical window (exam view only). */
  versionId: string | null
  /** Console scroll target (e.g. 'account' for the header Sign-in anchor). */
  scrollTo: string | null
}

/** Parses a §16-shaped hash into an app route (lenient — defaults on unknown). */
export function parseHash(hash: string, config: ApiCountry[]): AppRoute {
  const defaultCountry = config.find((country) => country.isDefault) ?? config[0]
  const fallback: AppRoute = {
    view: 'home',
    countryIso: defaultCountry?.isoCode ?? 'IN',
    language: defaultCountry?.defaultLanguage.code ?? 'en',
    topicSlug: null,
    unitSlug: null,
    examSlug: null,
    syllabusTopicSlug: null,
    page: 1,
    versionId: null,
    scrollTo: null,
  }
  if (!defaultCountry) return fallback

  // Addressable query after the path (?page=N topic units, ?version= exam windows).
  const [pathPart, queryPart] = hash.split('?')
  const queryParams = new URLSearchParams(queryPart ?? '')
  const pageRaw = Number.parseInt(queryParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  const versionParam = queryParams.get('version') ?? ''
  const versionId = VERSION_PATTERN.test(versionParam) ? versionParam : null

  const segments = pathPart.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (segments.length === 0) return fallback

  // Console + anchors (the foundation console keeps #account working).
  if (segments[0] === 'console') {
    return { ...fallback, view: 'console', scrollTo: null }
  }
  if (segments[0] === 'account') {
    return { ...fallback, view: 'console', scrollTo: 'account' }
  }

  // P5-S1: the private following surface (§31) — market-independent.
  if (segments[0] === 'following') {
    return { ...fallback, view: 'following', scrollTo: null }
  }

  // P5-S2: the private saved/collections surface (§10) — market-independent.
  if (segments[0] === 'saved') {
    return { ...fallback, view: 'saved', scrollTo: null }
  }

  // P5-S3: the private onboarding flow + profile/goal management surface
  // (§6/§9/§31) — market-independent.
  if (segments[0] === 'onboarding') {
    return { ...fallback, view: 'onboarding', scrollTo: null }
  }
  if (segments[0] === 'profile') {
    return { ...fallback, view: 'profile', scrollTo: null }
  }

  let country = defaultCountry
  let language = defaultCountry.defaultLanguage.code
  let index = 0

  // First segment: a non-default country slug, or the default country's
  // non-default language (§16 — the default market's slug never appears).
  const first = segments[0]
  if (first !== 'gk' && first !== 'exams') {
    const bySlug = config.find((entry) => !entry.isDefault && entry.slug === first)
    const defaultMarketLanguage = defaultCountry.languages.find(
      (entry) => entry.code === first && entry.code !== defaultCountry.defaultLanguage.code
    )
    if (bySlug) {
      country = bySlug
      index = 1
    } else if (defaultMarketLanguage) {
      language = defaultMarketLanguage.code
      index = 1
    }
  }

  // Language segment for the resolved country (non-default only, §35).
  const next = segments[index]
  if (next && next !== 'gk' && next !== 'exams') {
    const languageMatch = country.languages.find(
      (entry) => entry.code === next && entry.code !== country.defaultLanguage.code
    )
    if (languageMatch) {
      language = languageMatch.code
      index += 1
    }
  }

  // Content path: /gk/{topic}/{unit}/ (§16).
  if (segments[index] === 'gk') {
    const topicSlug = segments[index + 1] ?? null
    const unitSlug = segments[index + 2] ?? null
    if (topicSlug && unitSlug) {
      return {
        view: 'unit',
        countryIso: country.isoCode,
        language,
        topicSlug,
        unitSlug,
        examSlug: null,
        syllabusTopicSlug: null,
        page: 1,
        versionId: null,
        scrollTo: null,
      }
    }
    if (topicSlug) {
      return {
        view: 'topic',
        countryIso: country.isoCode,
        language,
        topicSlug,
        unitSlug: null,
        examSlug: null,
        syllabusTopicSlug: null,
        page,
        versionId: null,
        scrollTo: null,
      }
    }
  }

  // Content path: /exams/{exam}/ and /exams/{exam}/syllabus/{topic}/ (§16).
  if (segments[index] === 'exams') {
    const examSlug = segments[index + 1] ?? null
    if (examSlug && segments[index + 2] === 'syllabus' && segments[index + 3]) {
      return {
        view: 'syllabus',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        examSlug,
        syllabusTopicSlug: segments[index + 3],
        page: 1,
        versionId: null,
        scrollTo: null,
      }
    }
    if (examSlug) {
      return {
        view: 'exam',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        examSlug,
        syllabusTopicSlug: null,
        page: 1,
        versionId,
        scrollTo: null,
      }
    }
  }

  return { ...fallback, countryIso: country.isoCode, language }
}

/** The route shape buildHash/navigateHash accept (view + addressable state). */
export interface RouteInput {
  view: AppRoute['view']
  countryIso: string
  language: string
  topicSlug: string | null
  unitSlug: string | null
  examSlug?: string | null
  syllabusTopicSlug?: string | null
  page?: number
  versionId?: string | null
}

/** Builds the §16-shaped hash for a route (defaults omitted, §16). */
export function buildHash(route: RouteInput, config: ApiCountry[]): string {
  if (route.view === 'console') return '#/console'
  if (route.view === 'following') return '#/following'
  if (route.view === 'saved') return '#/saved'
  if (route.view === 'onboarding') return '#/onboarding'
  if (route.view === 'profile') return '#/profile'
  const country = config.find((entry) => entry.isoCode === route.countryIso)
  if (!country) return '#/'

  const segments: string[] = []
  if (!country.isDefault) segments.push(country.slug)
  if (route.language !== country.defaultLanguage.code) segments.push(route.language)

  if (route.view === 'topic' && route.topicSlug) {
    segments.push('gk', route.topicSlug)
  } else if (route.view === 'unit' && route.topicSlug && route.unitSlug) {
    segments.push('gk', route.topicSlug, route.unitSlug)
  } else if (route.view === 'exam' && route.examSlug) {
    segments.push('exams', route.examSlug)
  } else if (route.view === 'syllabus' && route.examSlug && route.syllabusTopicSlug) {
    segments.push('exams', route.examSlug, 'syllabus', route.syllabusTopicSlug)
  }

  const path = segments.length === 0 ? '#/' : `#/${segments.join('/')}/`

  // Addressable state — only when explicitly beyond the defaults.
  const params = new URLSearchParams()
  if (route.view === 'topic' && route.page && route.page > 1) {
    params.set('page', String(route.page))
  }
  if (route.view === 'exam' && route.versionId && VERSION_PATTERN.test(route.versionId)) {
    params.set('version', route.versionId)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** Programmatic navigation — sets the hash; the hashchange listener re-parses. */
export function navigateHash(route: RouteInput, config: ApiCountry[]): void {
  const next = buildHash(route, config)
  if (window.location.hash === next) {
    // Same hash never fires hashchange — force a re-parse (idempotent nav).
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
}

/** Subscribes to hash changes; returns null until the config has loaded. */
export function useHashRoute(config: ApiCountry[] | null): AppRoute | null {
  const [route, setRoute] = useState<AppRoute | null>(null)

  useEffect(() => {
    if (!config) return
    const apply = () => setRoute(parseHash(window.location.hash, config))
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [config])

  return route
}
