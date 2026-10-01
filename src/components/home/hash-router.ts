'use client'

/**
 * GKSetu — the §16-mirroring hash router (P4-S2, extended P4-S3)
 *
 * The public URL space (Master Plan §16 / Appendix B) is:
 *   India default English   /                       → #/
 *   India non-default lang  /{language}/            → #/hi/
 *   Other country default   /{country}/             → #/uk/
 *   Other country + lang    /{country}/{language}/  → #/fr/… (per config)
 *   Topic hub               …/gk/{topic}/           → #/hi/gk/polity-governance/
 *   Knowledge page          …/gk/{topic}/{unit}/    → #/gk/fundamental-rights/article-32/
 *   Current-affairs page    …/current-affairs/{slug}/ → #/current-affairs/chandrayaan-3-vikram-landing/
 *   Exam page               …/exams/{exam}/         → #/exams/upsc-civil-services/
 *   Syllabus topic          …/exams/{exam}/syllabus/{topic}/
 *                                                   → #/exams/upsc-civil-services/syllabus/constitutional-framework/
 *   Mock test (exam-scoped)  …/exams/{exam}/mock-tests/{slug}/
 *                                                   → #/exams/upsc-civil-services/mock-tests/upsc-cse-polity-world-gk-mini-mock-test/
 *   Mock test (topic-scoped) …/gk/{topic}/mock-tests/{slug}/
 *                                                   → #/gk/fundamental-rights/mock-tests/fundamental-rights-warm-up-drill/
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
 * (P5-S3) are the private goal/onboarding surfaces — same rules. `#/dashboard`
 * (P5-S4) is the personalised dashboard/feed (§22/§34) — same rules.
 * `#/personalisation` (P5-S5) is the explanations & controls surface
 * (§9/§31) — same rules. `#/notifications` (P8-S2 §27) is the private
 * notification center + preferences surface — same rules.
 * `#/collections/{id}/` (P8-S1 §21) is the PUBLIC unlisted landing view for a
 * LINK-visibility shared collection — the one collections route that is not
 * #/saved (noindex, reachable only via the share link).
 *
 * Addressable state derives from the hash (never duplicated in component
 * state): `?page=N` for topic-unit pagination, `?version={id}` for the exam
 * page's §36 historical window — the browser back button walks both, and
 * every topic/exam switch starts clean. The §22 mock-test runner (P7-S3)
 * lives at the two shapes above — the test's scope (exam or topic) is part
 * of its §16 identity, so the URL carries it. `?q={id}` (P8-S1 §21) focuses
 * the unit page's practice layer on one question — the question share link's
 * addressable state.
 */
import { useEffect, useState } from 'react'

import type { ApiCountry } from './types'

/** §36 version references are canonical ids (cuid). */
const VERSION_PATTERN = /^c[a-z0-9]{20,}$/

export interface AppRoute {
  view: 'home' | 'topic' | 'unit' | 'event' | 'exam' | 'syllabus' | 'test' | 'following' | 'saved' | 'onboarding' | 'profile' | 'dashboard' | 'personalisation' | 'notifications' | 'feedback' | 'quick-mock' | 'collection' | 'signin' | 'console'
  countryIso: string
  language: string
  topicSlug: string | null
  unitSlug: string | null
  /** The current-affairs event whose §16 page is open (P6-S2). */
  eventSlug: string | null
  /** The exam whose page (or syllabus topic) is open. */
  examSlug: string | null
  /** The syllabus topic under the exam view (§16 …/exams/{exam}/syllabus/{topic}/). */
  syllabusTopicSlug: string | null
  /** The §22 mock test whose runner is open (P7-S3 — exam- or topic-scoped). */
  testSlug: string | null
  /** The shared collection whose §21 unlisted view is open (P8-S1). */
  collectionId: string | null
  /** Addressable topic-units page (≥1; only meaningful on the topic view). */
  page: number
  /** Addressable §36 historical window (exam view only). */
  versionId: string | null
  /** Addressable §22 practice-layer focus (unit view only — P8-S1 §21 question shares). */
  focusQuestionId: string | null
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
    eventSlug: null,
    examSlug: null,
    syllabusTopicSlug: null,
    testSlug: null,
    collectionId: null,
    page: 1,
    versionId: null,
    focusQuestionId: null,
    scrollTo: null,
  }
  if (!defaultCountry) return fallback

  // Addressable query after the path (?page=N topic units, ?version= exam
  // windows, ?q= the P8-S1 §21 practice-question focus on unit pages).
  const [pathPart, queryPart] = hash.split('?')
  const queryParams = new URLSearchParams(queryPart ?? '')
  const pageRaw = Number.parseInt(queryParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  const versionParam = queryParams.get('version') ?? ''
  const versionId = VERSION_PATTERN.test(versionParam) ? versionParam : null
  const focusParam = queryParams.get('q') ?? ''
  const focusQuestionId = VERSION_PATTERN.test(focusParam) ? focusParam : null

  const segments = pathPart.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (segments.length === 0) return fallback

  // Console + anchors (the foundation console keeps #account working).
  if (segments[0] === 'console') {
    return { ...fallback, view: 'console', scrollTo: null }
  }
  if (segments[0] === 'account') {
    return { ...fallback, view: 'console', scrollTo: 'account' }
  }

  // The public sign-in page — the ONE user-facing authentication surface
  // (the console's account section stays for staff, but every product
  // sign-in CTA routes here).
  if (segments[0] === 'signin') {
    return { ...fallback, view: 'signin', scrollTo: null }
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

  // P5-S4: the personalised dashboard/feed (§22/§34) — market-independent.
  if (segments[0] === 'dashboard') {
    return { ...fallback, view: 'dashboard', scrollTo: null }
  }

  // P7-S5 §22: the combined-exam quick-mock surface — optionally deep-linked
  // to one exam's scope (…/quick-mock/{exam}/ → the EXAM card preselected).
  if (segments[0] === 'quick-mock') {
    return {
      ...fallback,
      view: 'quick-mock',
      examSlug: segments[1] ?? null,
      scrollTo: null,
    }
  }

  // P5-S5: the explanations & controls surface (§9/§31) — market-independent.
  if (segments[0] === 'personalisation') {
    return { ...fallback, view: 'personalisation', scrollTo: null }
  }

  // P8-S2 §27: the private notification center + preferences surface —
  // market-independent (a notification is user data, not market content).
  if (segments[0] === 'notifications') {
    return { ...fallback, view: 'notifications', scrollTo: null }
  }

  // P8-S3 §25/§31: the reporter's own reports surface — market-independent
  // (a report is user data, not market content).
  if (segments[0] === 'feedback') {
    return { ...fallback, view: 'feedback', scrollTo: null }
  }

  // P8-S1 §21: the public unlisted shared-collection view — market-
  // independent (a shared collection is owner content, not market content).
  if (segments[0] === 'collections' && segments[1] && VERSION_PATTERN.test(segments[1])) {
    return { ...fallback, view: 'collection', collectionId: segments[1], scrollTo: null }
  }

  let country = defaultCountry
  let language = defaultCountry.defaultLanguage.code
  let index = 0

  // First segment: a non-default country slug, or the default country's
  // non-default language (§16 — the default market's slug never appears).
  const first = segments[0]
  if (first !== 'gk' && first !== 'exams' && first !== 'current-affairs') {
    const bySlug = config.find((entry) => !entry.isDefault && entry.slug === first)
    const defaultMarketLanguage = defaultCountry.languages.find(
      (entry) => entry.code === first && entry.code !== defaultCountry.defaultLanguage.code
    )
    if (bySlug) {
      country = bySlug
      // P9-S2 fix (found by browser verification of the live France market):
      // entering a non-default market RESETS the language to THAT market's
      // default — the language variable was seeded from the default market
      // ('en') and never reset, so #/fr/ resolved to {FR, en} and the API
      // honestly 404'd ("English is not available in France"). buildHash
      // never emits a language segment for a market's default language, so
      // this is the only place the reset can live.
      language = bySlug.defaultLanguage.code
      index = 1
    } else if (defaultMarketLanguage) {
      language = defaultMarketLanguage.code
      index = 1
    }
  }

  // Language segment for the resolved country (non-default only, §35).
  const next = segments[index]
  if (next && next !== 'gk' && next !== 'exams' && next !== 'current-affairs') {
    const languageMatch = country.languages.find(
      (entry) => entry.code === next && entry.code !== country.defaultLanguage.code
    )
    if (languageMatch) {
      language = languageMatch.code
      index += 1
    }
  }

  // Content path: /gk/{topic}/{unit}/ (§16) — with the P7-S3 mock-test
  // branch …/gk/{topic}/mock-tests/{slug}/ (the topic-scoped §22 runner).
  if (segments[index] === 'gk') {
    const topicSlug = segments[index + 1] ?? null
    const unitSlug = segments[index + 2] ?? null
    if (topicSlug && segments[index + 2] === 'mock-tests' && segments[index + 3]) {
      return {
        view: 'test',
        countryIso: country.isoCode,
        language,
        topicSlug,
        unitSlug: null,
        eventSlug: null,
        examSlug: null,
        syllabusTopicSlug: null,
        testSlug: segments[index + 3],
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
      }
    }
    if (topicSlug && unitSlug) {
      return {
        view: 'unit',
        countryIso: country.isoCode,
        language,
        topicSlug,
        unitSlug,
        eventSlug: null,
        examSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        // P8-S1 §21: the question share link's addressable focus (?q=).
        focusQuestionId,
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
        eventSlug: null,
        examSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
      }
    }
  }

  // Content path: /current-affairs/{slug}/ (§16, P6-S2).
  if (segments[index] === 'current-affairs') {
    const eventSlug = segments[index + 1] ?? null
    if (eventSlug) {
      return {
        view: 'event',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        eventSlug,
        examSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
      }
    }
  }

  // Content path: /exams/{exam}/, /exams/{exam}/syllabus/{topic}/ and the
  // P7-S3 mock-test branch …/exams/{exam}/mock-tests/{slug}/ (§16).
  if (segments[index] === 'exams') {
    const examSlug = segments[index + 1] ?? null
    if (examSlug && segments[index + 2] === 'mock-tests' && segments[index + 3]) {
      return {
        view: 'test',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        eventSlug: null,
        examSlug,
        syllabusTopicSlug: null,
        testSlug: segments[index + 3],
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
      }
    }
    if (examSlug && segments[index + 2] === 'syllabus' && segments[index + 3]) {
      return {
        view: 'syllabus',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        eventSlug: null,
        examSlug,
        syllabusTopicSlug: segments[index + 3],
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
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
        eventSlug: null,
        examSlug,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId,
        focusQuestionId: null,
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
  eventSlug?: string | null
  examSlug?: string | null
  syllabusTopicSlug?: string | null
  /** The §22 mock test to open (P7-S3) — exam- or topic-scoped. */
  testSlug?: string | null
  /** The shared collection to open (P8-S1 §21) — the unlisted landing view. */
  collectionId?: string | null
  page?: number
  versionId?: string | null
  /** The §22 practice-layer focus (P8-S1 §21 question shares — unit view). */
  focusQuestionId?: string | null
}

/** Builds the §16-shaped hash for a route (defaults omitted, §16). */
export function buildHash(route: RouteInput, config: ApiCountry[]): string {
  if (route.view === 'console') return '#/console'
  if (route.view === 'signin') return '#/signin'
  if (route.view === 'following') return '#/following'
  if (route.view === 'saved') return '#/saved'
  if (route.view === 'onboarding') return '#/onboarding'
  if (route.view === 'profile') return '#/profile'
  if (route.view === 'dashboard') return '#/dashboard'
  if (route.view === 'personalisation') return '#/personalisation'
  if (route.view === 'notifications') return '#/notifications'
  // P8-S3 §25/§31 — the reporter's own reports surface, market-independent.
  if (route.view === 'feedback') return '#/feedback'
  // P8-S1 §21: the public unlisted shared-collection view — market-independent.
  if (route.view === 'collection' && route.collectionId) {
    return `#/collections/${route.collectionId}/`
  }
  // P7-S5 §22 — the quick-mock setup (an exam slug deep-links its scope card).
  if (route.view === 'quick-mock') {
    return route.examSlug ? `#/quick-mock/${route.examSlug}/` : '#/quick-mock'
  }
  const country = config.find((entry) => entry.isoCode === route.countryIso)
  if (!country) return '#/'

  const segments: string[] = []
  if (!country.isDefault) segments.push(country.slug)
  if (route.language !== country.defaultLanguage.code) segments.push(route.language)

  if (route.view === 'topic' && route.topicSlug) {
    segments.push('gk', route.topicSlug)
  } else if (route.view === 'unit' && route.topicSlug && route.unitSlug) {
    segments.push('gk', route.topicSlug, route.unitSlug)
  } else if (route.view === 'test' && route.testSlug) {
    // §16/P7-S3 — the runner's scope is part of the test's identity.
    if (route.examSlug) segments.push('exams', route.examSlug, 'mock-tests', route.testSlug)
    else if (route.topicSlug) segments.push('gk', route.topicSlug, 'mock-tests', route.testSlug)
  } else if (route.view === 'event' && route.eventSlug) {
    segments.push('current-affairs', route.eventSlug)
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
  // P8-S1 §21: the question focus rides the unit view's hash (?q={id}).
  if (route.view === 'unit' && route.focusQuestionId && VERSION_PATTERN.test(route.focusQuestionId)) {
    params.set('q', route.focusQuestionId)
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
