'use client'

/**
 * GKSetu — the §16-mirroring PATH router (P4-S2/P4-S3 lineage; DEPLOY-S2
 * moved the canonical URL space from after-the-hash to real URL paths).
 *
 * SITE-S1 — URL GRAMMAR v2: the platform IS general knowledge, so the old
 * `/gk/…` prefix said nothing. Subjects now live at the root:
 *   India default English   /
 *   India non-default lang  /{language}/            → /hi/
 *   Other country default   /{country}/             → /fr/
 *   Other country + lang    /{country}/{language}/  → /fr/en/… (per config)
 *   Subject (topic hub)     …/{subject}/            → /polity-governance/
 *   Knowledge page          …/{subject}/{unit}/    → /polity-governance/fundamental-rights/
 *   Current affairs listing …/current-affairs/     (dedicated view — SITE-S1)
 *   Current-affairs page    …/current-affairs/{slug}/
 *   Subjects directory      …/subjects/            (SITE-S1)
 *   MCQ practice            …/mcq/                 (SITE-S1 shell, SITE-S3 content)
 *   Q&A practice            …/qna/                 (SITE-S1 shell, SITE-S3 content)
 *   Tutorials directory     …/tutorials/           (SITE-S8 — exam → chapter
 *                          syllabus courses)
 *   Tutorial TOC            …/tutorials/{exam}/    (SITE-S8)
 *   Tutorial chapter        …/tutorials/{exam}/{chapter}/ (SITE-S8)
 *   Combined tutorial       …/tutorials/combined/?exams=a,b (SITE-S9 — 'combined'
 *                          is the reserved examSlug segment; the ?exams= set is
 *                          the view's addressable state)
 *   PYQ directory           …/pyq/                 (SITE-S7 — exam → year
 *                          previous-year questions)
 *   PYQ exam years          …/pyq/{exam}/          (SITE-S7)
 *   PYQ year practice       …/pyq/{exam}/{year}/   (SITE-S7)
 *   Exam directory          …/exams/
 *   Exam page               …/exams/{exam}/        → /exams/upsc-civil-services/
 *   Syllabus topic          …/exams/{exam}/syllabus/{topic}/
 *   Mock test (exam-scoped) …/exams/{exam}/mock-tests/{slug}/
 *   Mock test (topic-scoped)…/{subject}/mock-tests/{slug}/
 *   Mock test landing       /mock-test/            (was /quick-mock — renamed
 *                          from the base per the user's instruction; no
 *                          redirects, pre-launch)
 *
 * LEGACY `/gk/…` PATHS KEEP PARSING (tolerant, never built again) — old
 * shared links still open the right view; the address bar keeps whatever
 * the reader typed. `/{subject}/` is now the built form.
 *
 * The app renders through the optional catch-all route
 * (src/app/[[...slug]]/page.tsx) — every path serves the same shell and
 * this router parses the PATHNAME (History API navigation via pushState;
 * back/forward arrive as popstate). The segment grammar, the build rules
 * and the lenient parsing are the same as the server's buildCanonicalUrl
 * (§16: country + language + object identity, defaults omitted), driven by
 * the live country/language configuration from GET /api/countries (§35).
 * Unknown segments fall back to the default market, never an error page.
 *
 * LEGACY HASH URLS KEEP WORKING: every share link minted before DEPLOY-S2
 * (…/#/gk/…) parses to the same route — currentAppPath() prefers the hash
 * when one is present, and useAppRoute upgrades the address bar to the
 * clean path via replaceState (no reload). '#account' (the header Sign-in
 * anchor) maps to the console scrolled to the account section.
 *
 * `/account` keeps that mapping as a path. `/following` (P5-S1) is the
 * private personalisation management surface (§31) — market-independent,
 * noindex — and `/saved` (P5-S2) its collections counterpart (§10) —
 * likewise market-independent and never indexed. `/onboarding` and
 * `/profile` (P5-S3) are the private goal/onboarding surfaces — same
 * rules. `/dashboard` (P5-S4) is the personalised dashboard/feed
 * (§22/§34) — same rules. `/personalisation` (P5-S5) is the explanations
 * & controls surface (§9/§31) — same rules. `/notifications` (P8-S2 §27)
 * is the private notification center + preferences surface — same rules.
 * `/collections/{id}/` (P8-S1 §21) is the PUBLIC unlisted landing view
 * for a LINK-visibility shared collection.
 *
 * Addressable state derives from the URL (never duplicated in component
 * state): `?page=N` for topic-unit pagination, `?version={id}` for the
 * exam page's §36 historical window, `?q={id}` (P8-S1 §21) to focus the
 * unit page's practice layer on one question — the browser back button
 * walks all of them, and every topic/exam switch starts clean. The §22
 * mock-test runner (P7-S3) lives at the two shapes above — the test's
 * scope (exam or topic) is part of its §16 identity, so the URL carries
 * it.
 */
import { useEffect, useState } from 'react'

import type { ApiCountry } from './types'

/** §36 version references are canonical ids (cuid). */
const VERSION_PATTERN = /^c[a-z0-9]{20,}$/

/**
 * SITE-S1 — the content-tree roots that can follow the market prefix. The
 * first of these segments is NEVER a country slug or language code, so the
 * market-prefix resolution skips them.
 */
const CONTENT_ROOTS = ['gk', 'exams', 'current-affairs', 'subjects', 'mcq', 'qna', 'pyq', 'tutorials'] as const

/** True when a segment is a known content root (never a market marker). */
export function isContentRoot(segment: string | undefined): boolean {
  return !!segment && (CONTENT_ROOTS as readonly string[]).includes(segment)
}

export interface AppRoute {
  view: 'home' | 'topic' | 'unit' | 'event' | 'current-affairs' | 'exam' | 'exam-directory' | 'syllabus' | 'test' | 'following' | 'saved' | 'onboarding' | 'profile' | 'dashboard' | 'personalisation' | 'notifications' | 'feedback' | 'mock-test' | 'mcq' | 'qna' | 'pyq' | 'tutorials' | 'subjects' | 'collection' | 'signin' | 'console' | 'dev-track' | 'site-page'
  countryIso: string
  language: string
  topicSlug: string | null
  unitSlug: string | null
  /** The current-affairs event whose §16 page is open (P6-S2). */
  eventSlug: string | null
  /** The exam whose page (or syllabus topic) is open. */
  examSlug: string | null
  /** SITE-S7: the PYQ year whose practice page is open (…/pyq/{exam}/{year}/). */
  pyqYear: number | null
  /** SITE-S8: the tutorial chapter whose reader page is open
   * (…/tutorials/{exam}/{chapter}/) — the syllabus-node slug (or legacy id). */
  chapterSlug: string | null
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
  /** Console scroll target (legacy '#account' anchor — now /console/account). */
  scrollTo: string | null
  /** CONSOLE-S1: the console sub-path ('' = dashboard, 'exams', 'exams/{id}', …). */
  consolePath: string | null
  /** CONSOLE-S1: the managed site page slug (/about, /p/{slug}). */
  pageSlug: string | null
}

/** The current app path — the URL pathname + query (legacy-hash aware). */
export function currentAppPath(): string {
  if (typeof window === 'undefined') return '/'
  const hash = window.location.hash
  // A pre-DEPLOY-S2 hash route ('#/gk/…', '#account') still resolves.
  if (/^#(\/|account)/.test(hash)) return hash === '#' ? '/' : hash
  return window.location.pathname + window.location.search
}

/** True when the path is the market-default home ('/', plus legacy forms). */
export function isRootAppPath(path: string): boolean {
  return path === '/' || path === '' || path === '#/' || path === '#'
}

/**
 * Normalises any in-app path value — a clean path ('/signin'), a legacy
 * hash string ('#/console') or a server-built canonical path ('/gk/…/') —
 * to the clean URL form pushState accepts.
 */
export function normalizeAppPath(rawPath: string): string {
  const withoutHash = rawPath.trim().replace(/^#+/, '')
  const [pathPart, queryPart] = withoutHash.split('?')
  // Preserve the §16 trailing slash when present ('/gk/…/'); '' → '/'.
  let cleanPath = pathPart ?? ''
  if (!cleanPath.startsWith('/')) cleanPath = `/${cleanPath}`
  return queryPart ? `${cleanPath}?${queryPart}` : cleanPath
}

/** Parses a §16-shaped path (or legacy '#…' hash string) into an app route. */
export function parseRoute(path: string, config: ApiCountry[]): AppRoute {
  const defaultCountry = config.find((country) => country.isDefault) ?? config[0]
  const fallback: AppRoute = {
    view: 'home',
    countryIso: defaultCountry?.isoCode ?? 'IN',
    language: defaultCountry?.defaultLanguage.code ?? 'en',
    topicSlug: null,
    unitSlug: null,
    eventSlug: null,
    examSlug: null,
    pyqYear: null,
    chapterSlug: null,
    syllabusTopicSlug: null,
    testSlug: null,
    collectionId: null,
    page: 1,
    versionId: null,
    focusQuestionId: null,
    scrollTo: null,
    consolePath: null,
    pageSlug: null,
  }
  if (!defaultCountry) return fallback

  // Addressable query after the path (?page=N topic units, ?version= exam
  // windows, ?q= the P8-S1 §21 practice-question focus on unit pages).
  const [pathPart, queryPart] = path.split('?')
  const queryParams = new URLSearchParams(queryPart ?? '')
  const pageRaw = Number.parseInt(queryParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  const versionParam = queryParams.get('version') ?? ''
  const versionId = VERSION_PATTERN.test(versionParam) ? versionParam : null
  const focusParam = queryParams.get('q') ?? ''
  const focusQuestionId = VERSION_PATTERN.test(focusParam) ? focusParam : null

  // Accept both real paths ('/fr/gk/…') and legacy hash strings ('#/fr/gk/…').
  const segments = pathPart.replace(/^[#/]+/, '').split('/').filter(Boolean)
  if (segments.length === 0) return fallback

  // CONSOLE-S1: the operating console — '/console' (dashboard) plus its
  // sub-pages ('/console/exams', '/console/exams/{id}', …). '/account'
  // (and the legacy '#account' anchor) maps to the console's account page.
  if (segments[0] === 'console') {
    const consolePath = segments.slice(1).join('/') || null
    return { ...fallback, view: 'console', consolePath, scrollTo: null }
  }
  if (segments[0] === 'account') {
    return { ...fallback, view: 'console', consolePath: 'account', scrollTo: 'account' }
  }

  // CONSOLE-S1: the old single-page Foundation Console, preserved verbatim
  // as the build-verification surface (never deleted — the user's request).
  if (segments[0] === 'dev-track') {
    return { ...fallback, view: 'dev-track', scrollTo: null }
  }

  // CONSOLE-S1: managed site pages — the reserved top-level set renders at
  // /{slug}; custom pages at /p/{slug} (both market-independent, indexed).
  if (segments[0] === 'p' && segments[1]) {
    return { ...fallback, view: 'site-page', pageSlug: segments[1], scrollTo: null }
  }
  const RESERVED_PAGE_SLUGS = ['about', 'contact', 'privacy-policy', 'terms', 'disclaimer']
  if (segments.length === 1 && RESERVED_PAGE_SLUGS.includes(segments[0])) {
    return { ...fallback, view: 'site-page', pageSlug: segments[0], scrollTo: null }
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

  // SITE-S1: the mock-test landing (renamed from /quick-mock — edited from
  // the base, no redirect) — optionally deep-linked to one exam's scope
  // (…/mock-test/{exam}/ → the EXAM card preselected).
  if (segments[0] === 'mock-test') {
    return {
      ...fallback,
      view: 'mock-test',
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
  // A content root is never a market marker (SITE-S1).
  const first = segments[0]
  if (!isContentRoot(first)) {
    const bySlug = config.find((entry) => !entry.isDefault && entry.slug === first)
    const defaultMarketLanguage = defaultCountry.languages.find(
      (entry) => entry.code === first && entry.code !== defaultCountry.defaultLanguage.code
    )
    if (bySlug) {
      country = bySlug
      // P9-S2 fix (found by browser verification of the live France market):
      // entering a non-default market RESETS the language to THAT market's
      // default — the language variable was seeded from the default market
      // ('en') and never reset, so /fr/ resolved to {FR, en} and the API
      // honestly 404'd ("English is not available in France"). buildPath
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
  if (next && !isContentRoot(next)) {
    const languageMatch = country.languages.find(
      (entry) => entry.code === next && entry.code !== country.defaultLanguage.code
    )
    if (languageMatch) {
      language = languageMatch.code
      index += 1
    }
  }

  // SITE-S1 — URL grammar v2 content trees. LEGACY `/gk/{topic}/…` paths
  // keep parsing (tolerant); the built form drops the prefix entirely.
  // afterRoot skips a KNOWN root (gk/current-affairs/subjects/mcq/qna);
  // for a subject path the root IS the first content segment (kept).
  const root = segments[index]
  const afterRoot = segments.slice(index + (isContentRoot(root) ? 1 : 0))

  // SITE-S1: legacy /gk/current-affairs/ (the old topic hub) opens the new
  // dedicated listing view — tolerant parsing, same document.
  if (root === 'gk' && afterRoot[0] === 'current-affairs' && !afterRoot[1]) {
    return {
      view: 'current-affairs',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug: null,
      pyqYear: null,
      chapterSlug: null,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }

  // Content path: /current-affairs/ (SITE-S1 listing) and
  // /current-affairs/{slug}/ (§16, P6-S2).
  if (root === 'current-affairs') {
    const eventSlug = afterRoot[0] ?? null
    if (eventSlug) {
      return {
        view: 'event',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        eventSlug,
        examSlug: null,
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
      }
    }
    return {
      view: 'current-affairs',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug: null,
      pyqYear: null,
      chapterSlug: null,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }

  // SITE-S1: the subject directory (…/subjects/).
  if (root === 'subjects') {
    return {
      view: 'subjects',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug: null,
      pyqYear: null,
      chapterSlug: null,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page: 1,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }

  // SITE-S1: the practice surfaces (…/mcq/ and …/qna/).
  if (root === 'mcq') {
    return {
      view: 'mcq',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug: null,
      pyqYear: null,
      chapterSlug: null,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page: 1,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }
  if (root === 'qna') {
    return {
      view: 'qna',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug: null,
      pyqYear: null,
      chapterSlug: null,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page: 1,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }

  // SITE-S7: the previous-year-questions directory — …/pyq/ (exam cards),
  // …/pyq/{exam}/ (year groups), …/pyq/{exam}/{year}/ (the year practice
  // page). The year segment must be a plausible sitting year (1900–2100);
  // anything else tolerantly falls back to the exam page, where an unknown
  // exam shows the honest empty state. This branch runs BEFORE the exams
  // tree and the generic subject fallback (the SITE-S4 ordering lesson — a
  // subject named 'pyq' can never shadow the directory).
  if (root === 'pyq') {
    const examSlug = afterRoot[0] ?? null
    const yearSegment = afterRoot[1] ?? ''
    const yearParsed = /^\d{4}$/.test(yearSegment) ? Number(yearSegment) : null
    const pyqYear =
      yearParsed !== null && yearParsed >= 1900 && yearParsed <= 2100 ? yearParsed : null
    return {
      view: 'pyq',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug,
      pyqYear,
      chapterSlug: null,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page: 1,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }

  // SITE-S8: the tutorials directory — …/tutorials/ (exam cards, the
  // personalised index), …/tutorials/{exam}/ (the syllabus table of
  // contents) and …/tutorials/{exam}/{chapter}/ (the chapter reader). The
  // chapter segment is the syllabus node's slug (legacy node ids still
  // resolve server-side); trailing junk beyond the chapter is tolerated.
  // This branch runs BEFORE the exams tree and the generic subject fallback
  // (the SITE-S4 ordering lesson — a subject named 'tutorials' can never
  // shadow the directory).
  // SITE-S9: 'combined' is the RESERVED combined-tutorial segment —
  // /tutorials/combined/?exams=a,b parses naturally as examSlug:'combined'
  // (afterRoot[0], no interface change) and the CombinedTutorialView owns
  // the ?exams= addressable state; any chapterSlug beyond 'combined' is
  // tolerated junk, exactly like a real exam's chapter tail. buildPath's
  // tutorials branch pushes the segments verbatim — it already renders
  // /tutorials/combined/ correctly, no special casing needed.
  if (root === 'tutorials') {
    const examSlug = afterRoot[0] ?? null
    const chapterSlug = afterRoot[1] ?? null
    return {
      view: 'tutorials',
      countryIso: country.isoCode,
      language,
      topicSlug: null,
      unitSlug: null,
      eventSlug: null,
      examSlug,
      pyqYear: null,
      chapterSlug,
      syllabusTopicSlug: null,
      testSlug: null,
      collectionId: null,
      page: 1,
      versionId: null,
      focusQuestionId: null,
      scrollTo: null,
      consolePath: null,
      pageSlug: null,
    }
  }

  // SITE-S1: the exam tree is unchanged (…/exams/…) — the only content root
  // with a nested grammar.
  if (segments[index] === 'exams') {
    const examSlug = segments[index + 1] ?? null
    if (!examSlug) {
      // The public exam directory — every ACTIVE exam of the resolved market.
      return {
        view: 'exam-directory',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        eventSlug: null,
        examSlug: null,
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
      }
    }
    if (examSlug && segments[index + 2] === 'mock-tests' && segments[index + 3]) {
      return {
        view: 'test',
        countryIso: country.isoCode,
        language,
        topicSlug: null,
        unitSlug: null,
        eventSlug: null,
        examSlug,
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: segments[index + 3],
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
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
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: segments[index + 3],
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
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
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
      }
    }
  }

  // SITE-S4-C regression fix: the exam tree MUST run BEFORE the generic
  // subject fallback — the fallback consumes any root (incl. 'exams') as a
  // subject slug, which mis-parsed /exams/{exam}/ as a topic page (found by
  // the SITE-S4-C agent's parse-route harness).
  // Content path: /{subject}/, /{subject}/{unit}/ (§16 v2) and the
  // P7-S3 mock-test branch /{subject}/mock-tests/{slug}/ — with the legacy
  // /gk/ prefix still accepted in front (tolerant parsing).
  {
    const topicSlug = afterRoot[0] ?? null
    const unitSlug = afterRoot[1] ?? null
    if (topicSlug && afterRoot[1] === 'mock-tests' && afterRoot[2]) {
      return {
        view: 'test',
        countryIso: country.isoCode,
        language,
        topicSlug,
        unitSlug: null,
        eventSlug: null,
        examSlug: null,
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: afterRoot[2],
        collectionId: null,
        page: 1,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
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
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page: 1,
        versionId: null,
        // P8-S1 §21: the question share link's addressable focus (?q=).
        focusQuestionId,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
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
        pyqYear: null,
        chapterSlug: null,
        syllabusTopicSlug: null,
        testSlug: null,
        collectionId: null,
        page,
        versionId: null,
        focusQuestionId: null,
        scrollTo: null,
        consolePath: null,
        pageSlug: null,
      }
    }
  }

  return { ...fallback, countryIso: country.isoCode, language }
}

/** The route shape buildPath/navigateRoute accept (view + addressable state). */
export interface RouteInput {
  view: AppRoute['view']
  countryIso: string
  language: string
  topicSlug: string | null
  unitSlug: string | null
  eventSlug?: string | null
  examSlug?: string | null
  /** SITE-S7: the PYQ year (view 'pyq' — …/pyq/{exam}/{year}/). */
  pyqYear?: number | null
  /** SITE-S8: the tutorial chapter (view 'tutorials' —
   * …/tutorials/{exam}/{chapter}/). */
  chapterSlug?: string | null
  syllabusTopicSlug?: string | null
  /** The §22 mock test to open (P7-S3) — exam- or topic-scoped. */
  testSlug?: string | null
  /** The shared collection to open (P8-S1 §21) — the unlisted landing view. */
  collectionId?: string | null
  page?: number
  versionId?: string | null
  /** The §22 practice-layer focus (P8-S1 §21 question shares — unit view). */
  focusQuestionId?: string | null
  /** CONSOLE-S1: the console sub-path (view 'console'). */
  consolePath?: string | null
  /** CONSOLE-S1: the managed site page slug (view 'site-page'). */
  pageSlug?: string | null
}

/** Builds the §16-shaped URL path for a route (defaults omitted, §16). */
export function buildPath(route: RouteInput, config: ApiCountry[]): string {
  // CONSOLE-S1: the operating console + the preserved Foundation Console.
  if (route.view === 'console') {
    const sub = (route.consolePath ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
    return sub ? `/console/${sub}` : '/console'
  }
  if (route.view === 'dev-track') return '/dev-track'
  if (route.view === 'site-page' && route.pageSlug) {
    const RESERVED_PAGE_SLUGS = ['about', 'contact', 'privacy-policy', 'terms', 'disclaimer']
    return RESERVED_PAGE_SLUGS.includes(route.pageSlug) ? `/${route.pageSlug}` : `/p/${route.pageSlug}`
  }
  if (route.view === 'signin') return '/signin'
  if (route.view === 'following') return '/following'
  if (route.view === 'saved') return '/saved'
  if (route.view === 'onboarding') return '/onboarding'
  if (route.view === 'profile') return '/profile'
  if (route.view === 'dashboard') return '/dashboard'
  if (route.view === 'personalisation') return '/personalisation'
  if (route.view === 'notifications') return '/notifications'
  // P8-S3 §25/§31 — the reporter's own reports surface, market-independent.
  if (route.view === 'feedback') return '/feedback'
  // P8-S1 §21: the public unlisted shared-collection view — market-independent.
  if (route.view === 'collection' && route.collectionId) {
    return `/collections/${route.collectionId}/`
  }
  // SITE-S1 — the mock-test landing (renamed from quick-mock; an exam slug
  // deep-links its scope card). Market-independent, like its predecessor.
  if (route.view === 'mock-test') {
    return route.examSlug ? `/mock-test/${route.examSlug}/` : '/mock-test/'
  }
  const country = config.find((entry) => entry.isoCode === route.countryIso)
  if (!country) return '/'

  const segments: string[] = []
  if (!country.isDefault) segments.push(country.slug)
  if (route.language !== country.defaultLanguage.code) segments.push(route.language)

  if (route.view === 'topic' && route.topicSlug) {
    // SITE-S1 — subjects live at the root: /{subject}/ (no /gk/ prefix).
    segments.push(route.topicSlug)
  } else if (route.view === 'unit' && route.topicSlug && route.unitSlug) {
    segments.push(route.topicSlug, route.unitSlug)
  } else if (route.view === 'test' && route.testSlug) {
    // §16/P7-S3 — the runner's scope is part of the test's identity.
    if (route.examSlug) segments.push('exams', route.examSlug, 'mock-tests', route.testSlug)
    else if (route.topicSlug) segments.push(route.topicSlug, 'mock-tests', route.testSlug)
  } else if (route.view === 'event' && route.eventSlug) {
    segments.push('current-affairs', route.eventSlug)
  } else if (route.view === 'current-affairs') {
    // SITE-S1 — the dedicated current-affairs listing.
    segments.push('current-affairs')
  } else if (route.view === 'subjects') {
    // SITE-S1 — the subject directory.
    segments.push('subjects')
  } else if (route.view === 'mcq') {
    // SITE-S1 — the MCQ practice surface (SITE-S3 fills the content).
    segments.push('mcq')
  } else if (route.view === 'qna') {
    // SITE-S1 — the Q&A practice surface (SITE-S3 fills the content).
    segments.push('qna')
  } else if (route.view === 'pyq') {
    // SITE-S7 — the PYQ directory: market-scoped segments (…/pyq/,
    // …/pyq/{exam}/, …/pyq/{exam}/{year}/) for free hreflang parity.
    segments.push('pyq')
    if (route.examSlug) segments.push(route.examSlug)
    if (route.examSlug && route.pyqYear) segments.push(String(route.pyqYear))
  } else if (route.view === 'tutorials') {
    // SITE-S8 — the tutorials directory: market-scoped segments (…/tutorials/,
    // …/tutorials/{exam}/, …/tutorials/{exam}/{chapter}/) for free hreflang
    // parity — the same segments.push pattern as pyq (never the mock-test
    // fixed-path pattern).
    // SITE-S9 — examSlug:'combined' needs no special case here: the pushes
    // render /tutorials/combined/ verbatim (the view owns the ?exams= query
    // through history.replaceState, never through buildPath).
    segments.push('tutorials')
    if (route.examSlug) segments.push(route.examSlug)
    if (route.examSlug && route.chapterSlug) segments.push(route.chapterSlug)
  } else if (route.view === 'exam' && route.examSlug) {
    segments.push('exams', route.examSlug)
  } else if (route.view === 'exam-directory') {
    segments.push('exams')
  } else if (route.view === 'syllabus' && route.examSlug && route.syllabusTopicSlug) {
    segments.push('exams', route.examSlug, 'syllabus', route.syllabusTopicSlug)
  }

  const path = segments.length === 0 ? '/' : `/${segments.join('/')}/`

  // Addressable state — only when explicitly beyond the defaults.
  const params = new URLSearchParams()
  if (route.view === 'topic' && route.page && route.page > 1) {
    params.set('page', String(route.page))
  }
  // SITE-S1: the current-affairs listing paginates the same way (?page=N).
  if (route.view === 'current-affairs' && route.page && route.page > 1) {
    params.set('page', String(route.page))
  }
  if (route.view === 'exam' && route.versionId && VERSION_PATTERN.test(route.versionId)) {
    params.set('version', route.versionId)
  }
  // P8-S1 §21: the question focus rides the unit view's path (?q={id}).
  if (route.view === 'unit' && route.focusQuestionId && VERSION_PATTERN.test(route.focusQuestionId)) {
    params.set('q', route.focusQuestionId)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** pushState + the re-parse event (pushState fires no event of its own). */
function pushAppPath(next: string): void {
  if (currentAppPath() === next) {
    // Same URL — never a popstate — force a re-parse (idempotent nav).
    window.dispatchEvent(new PopStateEvent('popstate'))
    return
  }
  window.history.pushState({}, '', next)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Programmatic navigation by route object — pushState; the listener re-parses. */
export function navigateRoute(route: RouteInput, config: ApiCountry[]): void {
  pushAppPath(buildPath(route, config))
}

/**
 * Programmatic navigation by path string — accepts clean paths ('/signin'),
 * legacy hash strings ('#/console') and server-built canonical paths
 * ('/gk/…/') alike.
 */
export function navigateToPath(rawPath: string): void {
  pushAppPath(normalizeAppPath(rawPath))
}

/** Subscribes to URL changes; returns null until the config has loaded. */
export function useAppRoute(config: ApiCountry[] | null): AppRoute | null {
  const [route, setRoute] = useState<AppRoute | null>(null)

  useEffect(() => {
    if (!config) return
    const apply = () => {
      const raw = currentAppPath()
      // One-time upgrade: a legacy hash URL ('…/#/gk/…') becomes the clean
      // path in the address bar — same document, no reload, same route.
      if (raw.startsWith('#')) {
        try {
          window.history.replaceState({}, '', normalizeAppPath(raw))
        } catch {
          // A replaceState failure must never break routing — parse anyway.
        }
      }
      setRoute(parseRoute(raw, config))
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [config])

  return route
}
