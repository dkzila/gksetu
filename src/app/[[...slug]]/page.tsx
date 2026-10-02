'use client'

/**
 * GKSetu — App Shell (P4-S2, extended P4-S3)
 *
 * The public product surface (§38): the §34 country homepage at the §16 root
 * default, the §33 topic landing pages, the §22 knowledge pages, and — from
 * P4-S3 — the §16 exam pages (…/exams/{exam}/) and syllabus-topic pages
 * (…/exams/{exam}/syllabus/{topic}/) — with the §15 country switcher and §35
 * language switcher always available in the header, and the foundation
 * console (every prior session's verification surface) one click away.
 * P7-S3 adds the §22 mock-test runner pages (…/exams/{exam}/mock-tests/{slug}/
 * and …/gk/{topic}/mock-tests/{slug}/). P7-S4 surfaces the §22 mastery layer
 * on the existing surfaces — the dashboard's revision queue, the knowledge
 * page's "your mastery" strip — no new routes (private state, noindex).
 * In-app navigation mirrors the §16 URL grammar after the hash
 * (#/hi/gk/polity-governance/…, #/exams/upsc-civil-services/…) — one grammar,
 * one source of URL truth, driven by the live country/language configuration
 * (§35). P8-S1 adds the §21 sharing system: the share actions on every
 * shareable canonical surface and the public unlisted shared-collection view
 * (#/collections/{id}/) — plus the landing beacon that records a §32 share
 * event when a page LOAD starts on a shareable surface (§21 analytics).
 * P8-S2 adds the §27 notifications system: the header bell + the private
 * notification center (#/notifications) — every notification explainable
 * with a one-tap mute, per-category × per-channel preferences, the queued →
 * sent → read lifecycle over a modeled dev transport (mobile-push held for
 * the app, §39).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HeaderAuth } from '@/components/auth/header-auth'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/hooks/use-toast'
import { AppSidebar } from '@/components/home/app-sidebar'
import { ConsoleView } from '@/components/home/console-view'
import { SitePageView } from '@/components/home/site-page-view'
import { ConsoleShell } from '@/components/console/console-shell'
import { SiteIntegrations } from '@/components/integrations/site-integrations'
import { EventView } from '@/components/home/event-view'
import { ExamDirectoryView } from '@/components/home/exam-directory-view'
import { ExamView } from '@/components/home/exam-view'
import { HomepageView } from '@/components/home/homepage-view'
import { SiteFooter } from '@/components/home/site-footer'
import { SiteHeader } from '@/components/home/site-header'
import { SyllabusView } from '@/components/home/syllabus-view'
import { TopicLandingView } from '@/components/home/topic-landing-view'
import { UnitView } from '@/components/home/unit-view'
import { SignInView } from '@/components/auth/sign-in-view'
import { TestRunnerView } from '@/components/assessment/test-runner-view'
import { MockTestView } from '@/components/assessment/mock-test-view'
import { CurrentAffairsView } from '@/components/home/current-affairs-view'
import { SubjectsView } from '@/components/home/subjects-view'
import { McqView } from '@/components/home/mcq-view'
import { QnaView } from '@/components/home/qna-view'
import { PyqView } from '@/components/home/pyq-view'
import { SharedCollectionView } from '@/components/shares/shared-collection-view'
import { FollowingView } from '@/components/follows/following-view'
import { SavedView } from '@/components/saves/saved-view'
import { NotificationsView } from '@/components/notifications/notifications-view'
import { MyFeedbackView } from '@/components/feedback/my-feedback-view'
import { OnboardingView } from '@/components/personalisation/onboarding-view'
import { ProfileView } from '@/components/personalisation/profile-view'
import { DashboardView } from '@/components/personalisation/dashboard-view'
import { ControlsView } from '@/components/personalisation/controls-view'
import { currentAppPath, isContentRoot, isRootAppPath, navigateRoute, navigateToPath, useAppRoute } from '@/components/home/app-router'
import { useAppRouteLinks } from '@/components/home/app-router-links'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { ApiCountry, Envelope } from '@/components/home/types'

export default function GKSetuApp() {
  // ---------- SPA link handling (DEPLOY-S2) ----------
  // Plain <a href="/…"> links (sidebar, footer, dashboard cards…) navigate
  // through the router — pushState + re-parse — instead of a full document
  // reload. Modifier clicks, new tabs and downloads keep the browser default.
  useAppRouteLinks()

  // ---------- Locale configuration (the switchers' source of truth) ----------
  const [config, setConfig] = useState<ApiCountry[] | null>(null)
  const [configError, setConfigError] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { toast } = useToast()

  // ---------- P9-S2 §15.1: the first-visit geo routing signal ----------
  // Once per browser: a FIRST visit to the root asks the server for a geo
  // hint (§15 — a routing/default-context signal, never a wall) and, when it
  // suggests a LIVE non-default market, routes there and explains itself.
  // The stored choice is a CLIENT-side browsing preference only (§31 — it
  // never reaches the server, exactly like the theme); the deliberate
  // switcher overwrites it and stays always available (§15.2).
  // Ref-driven by design: the flow never renders anything — it navigates,
  // toasts and writes localStorage — so no state, no cascading renders.
  type MarketChoice = { iso: string; origin: 'geo' | 'user' | 'default' | 'link' }
  const MARKET_CHOICE_KEY = 'gksetu-market'
  const storeMarketChoice = useCallback((choice: MarketChoice) => {
    try {
      window.localStorage.setItem(MARKET_CHOICE_KEY, JSON.stringify(choice))
    } catch {
      // Storage unavailable (private mode) — the flow simply re-checks next load.
    }
  }, [MARKET_CHOICE_KEY])
  // Ref-driven except the phase: the hint resolves asynchronously AFTER the
  // config/route effects may have already settled — a ref flip would never
  // re-trigger the apply effect (the B1 race found by browser verification:
  // the default-choice write was lost whenever the hint resolved last).
  // Phase STATE closes the race in both orders (config-first and hint-first).
  const [geoPhase, setGeoPhase] = useState<'idle' | 'hint-ready' | 'deep-link'>('idle')
  const geoHint = useRef<{ isoCode: string; name: string; languageCode: string } | null>(null)

  // P5-S1: identity bootstrap in the app shell — a persisted token (zustand
  // persists ONLY the token, §20/§30) must revalidate against /api/auth/me on
  // every load, not just when the console's account section happens to mount.
  // Personalised surfaces (follow buttons, #/following) read this state.
  useEffect(() => {
    void useAuth.getState().initialize()
  }, [])

  const loadConfig = useCallback(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          setConfig(payload.data.countries)
        } else {
          setConfigError(true)
        }
      })
      .catch(() => setConfigError(true))
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // P9-S2 B3 (found by browser verification): a lifecycle transition changes
  // market statuses — the shell's config (the switchers' source of truth)
  // refetches when the launch console announces a change, so the header
  // switcher reflects live/paused markets without a full page reload.
  useEffect(() => {
    const handler = () => loadConfig()
    window.addEventListener('gksetu:locale-config-changed', handler)
    return () => window.removeEventListener('gksetu:locale-config-changed', handler)
  }, [loadConfig])

  // P8-S5 §32/§31: the ARRIVAL beacon — ONE fetch per page load, for the
  // anonymous growth census. Unlike the share beacon below (which waits for
  // a shareable surface to resolve), this records EVERY page load: the
  // surface + market are classified SERVER-SIDE from the mount-time hash,
  // and the referrer is classified HERE, in the browser — the raw referrer
  // URL never crosses the wire (§31: a referrer can carry personal data;
  // only the class does). Best-effort, like every §32 beacon.
  const arrivalBeaconFired = useRef(false)
  useEffect(() => {
    if (arrivalBeaconFired.current) return
    arrivalBeaconFired.current = true
    const classifyReferrer = (): 'DIRECT' | 'SEARCH' | 'SOCIAL' | 'OTHER' => {
      const referrer = typeof document !== 'undefined' ? document.referrer : ''
      if (!referrer) return 'DIRECT'
      try {
        const url = new URL(referrer)
        if (url.origin === window.location.origin) return 'DIRECT'
        const host = url.hostname.replace(/^www\./, '').toLowerCase()
        const searchHosts = [
          'google.com', 'bing.com', 'duckduckgo.com', 'search.yahoo.com',
          'ecosia.org', 'search.brave.com', 'yandex.com', 'baidu.com',
        ]
        const socialHosts = [
          'facebook.com', 'x.com', 'twitter.com', 'linkedin.com', 'instagram.com',
          'reddit.com', 't.me', 'web.whatsapp.com', 'youtube.com', 'pinterest.com',
          'threads.net',
        ]
        const known = (hosts: string[]) => hosts.some((known) => host === known || host.endsWith(`.${known}`))
        if (known(searchHosts)) return 'SEARCH'
        if (known(socialHosts)) return 'SOCIAL'
        return 'OTHER'
      } catch {
        return 'DIRECT'
      }
    }
    void fetch('/api/seo/landings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: currentAppPath(),
        referrerClass: classifyReferrer(),
      }),
      keepalive: true,
    }).catch(() => {
      // Best-effort census (§32) — never a user-facing error.
    })
  }, [])

  const route = useAppRoute(config)

  // P8-S1 §21/§32: the landing beacon — ONE fetch per page load when the
  // load STARTS on a shareable canonical surface (a §16 knowledge page,
  // current-affairs item, topic hub, exam page, question focus or shared
  // collection). In-app hash navigation is NOT a landing — the hash captured
  // on mount must still be the live hash when the config resolves (the §36-
  // honest definition of "share link landing": someone opened a link and the
  // app started there). The record is anonymous-friendly (POST
  // /api/share/events attaches identity only when signed in) and best-effort
  // — a failed beacon never blocks the page.
  const pageLoadPath = useRef<string | null>(null)
  const landingBeaconFired = useRef(false)
  useEffect(() => {
    // Capture once on mount (the page-load URL — the whole definition of a
    // landing). Declared BEFORE the beacon effect: effects run in order, and
    // the beacon can only fire once a route exists (config arrives async).
    if (pageLoadPath.current === null) {
      pageLoadPath.current = currentAppPath()
    }
  }, [])

  // P9-S2 §15.1 — step 1 (mount): has this browser already chosen a market?
  // A stored choice means the first visit already happened — the geo flow
  // never re-routes a returning visitor. A deep-link arrival is explicit
  // intent (a share URL, a search result): the link chose, no geo fetch.
  // All phase transitions happen inside the async closure (never as
  // synchronous setState in the effect body — the react-hooks rule).
  const geoFlowStarted = useRef(false)
  useEffect(() => {
    if (geoFlowStarted.current) return
    geoFlowStarted.current = true
    void (async () => {
      if (window.localStorage.getItem(MARKET_CHOICE_KEY)) return // returning visitor
      const initialPath = pageLoadPath.current ?? '/'
      const isRoot = isRootAppPath(initialPath)
      if (!isRoot) {
        setGeoPhase('deep-link')
        return
      }
      try {
        const response = await fetch('/api/locale/geo-hint', { cache: 'no-store' })
        const payload = (await response.json()) as
          | {
              status: 'ok'
              data: {
                geoHint: {
                  suggestion: {
                    isoCode: string
                    name: string
                    defaultLanguage: { code: string }
                  } | null
                }
              }
            }
          | { status: 'error' }
        if (payload.status === 'ok' && payload.data.geoHint.suggestion) {
          geoHint.current = {
            isoCode: payload.data.geoHint.suggestion.isoCode,
            name: payload.data.geoHint.suggestion.name,
            languageCode: payload.data.geoHint.suggestion.defaultLanguage.code,
          }
        }
        // No geo signal (local dev, no edge headers) or the detected market
        // is not live → no suggestion → the root default IS the right home.
        setGeoPhase('hint-ready')
      } catch {
        setGeoPhase('hint-ready')
      }
    })()
  }, [MARKET_CHOICE_KEY])

  // P9-S2 §15.1 — step 2 (config/route/phase settled): apply the outcome
  // exactly once. A suggestion navigates to that market's home + explains
  // itself (the §15.2 guarantee made visible); every outcome records the
  // client-side choice so the flow never runs twice for the same browser.
  const geoApplied = useRef(false)
  useEffect(() => {
    if (!config || geoApplied.current || geoPhase === 'idle') return
    if (geoPhase === 'deep-link') {
      if (!route) return // wait one more pass for the route to exist
      geoApplied.current = true
      storeMarketChoice({ iso: route.countryIso, origin: 'link' })
      return
    }
    geoApplied.current = true
    const hint = geoHint.current
    const market = hint ? config.find((entry) => entry.isoCode === hint.isoCode) : undefined
    if (hint && market && !market.isDefault) {
      navigateRoute(
        {
          view: 'home',
          countryIso: market.isoCode,
          language: hint.languageCode,
          topicSlug: null,
          unitSlug: null,
        },
        config
      )
      storeMarketChoice({ iso: market.isoCode, origin: 'geo' })
      toast({
        title: `Welcome to the ${hint.name} edition`,
        description:
          'Switched based on your location — pick any country from the switcher in the header at any time; nothing about this is stored server-side.',
      })
      return
    }
    // No hint, or a stale one (the market left the live set since the hint
    // was built — never route to a non-live market): the default root home.
    const defaultMarket = config.find((entry) => entry.isDefault) ?? config[0]
    storeMarketChoice({ iso: defaultMarket?.isoCode ?? 'IN', origin: 'default' })
  }, [config, route, geoPhase, toast, storeMarketChoice])
  useEffect(() => {
    if (!route || landingBeaconFired.current) return
    const shareable =
      (route.view === 'unit' && !!route.unitSlug) ||
      route.view === 'event' ||
      route.view === 'topic' ||
      route.view === 'exam' ||
      route.view === 'collection'
    if (!shareable) return
    // The route only counts as a landing while the URL is STILL the one the
    // page loaded with — any in-app navigation before this point disqualifies.
    if (currentAppPath() !== pageLoadPath.current) return
    landingBeaconFired.current = true
    const path =
      route.view === 'collection' && route.collectionId
        ? `/collections/${route.collectionId}/`
        : currentAppPath()
    void fetch('/api/share/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SHARE_LANDING', path }),
      keepalive: true,
    }).catch(() => {
      // Best-effort analytics (§32) — never a user-facing error.
    })
  }, [route])

  // Scroll behaviour: view changes start at the top; site pages land at
  // the top of their article. (The CONSOLE-S1 operating console manages its
  // own scroll — the legacy '#account' anchor now maps to /console/account.)
  useEffect(() => {
    if (!route) return
    window.scrollTo({ top: 0 })
  }, [route])

  // ---------- Navigation (§16 grammar after the hash) ----------

  const goHome = useCallback(() => {
    if (!config || !route) return
    navigateRoute(
      { view: 'home', countryIso: route.countryIso, language: route.language, topicSlug: null, unitSlug: null },
      config
    )
  }, [config, route])

  // SITE-S1: the mock-test surface (renamed from quick-mock) — optionally
  // deep-linked to one exam's scope card (…/mock-test/{exam}/).
  const goMockTest = useCallback(
    (examSlug?: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'mock-test',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          examSlug: examSlug ?? null,
        },
        config
      )
    },
    [config, route]
  )

  const openTopic = useCallback(
    (slug: string) => {
      if (!config || !route) return
      navigateRoute(
        { view: 'topic', countryIso: route.countryIso, language: route.language, topicSlug: slug, unitSlug: null },
        config
      )
    },
    [config, route]
  )

  const openUnit = useCallback(
    (topicSlug: string, unitSlug: string) => {
      if (!config || !route) return
      navigateRoute(
        { view: 'unit', countryIso: route.countryIso, language: route.language, topicSlug, unitSlug },
        config
      )
    },
    [config, route]
  )

  // §16 exam page (…/exams/{slug}/) — P4-S3.
  const openExam = useCallback(
    (slug: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'exam',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          examSlug: slug,
          syllabusTopicSlug: null,
        },
        config
      )
    },
    [config, route]
  )

  // The public exam directory (…/exams/) — the India exam corpus surface.
  const openExamDirectory = useCallback(() => {
    if (!config || !route) return
    navigateRoute(
      {
        view: 'exam-directory',
        countryIso: route.countryIso,
        language: route.language,
        topicSlug: null,
        unitSlug: null,
        examSlug: null,
        syllabusTopicSlug: null,
      },
      config
    )
  }, [config, route])

  // §16 current-affairs event page (…/current-affairs/{slug}/) — P6-S2.
  const openEvent = useCallback(
    (slug: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'event',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          eventSlug: slug,
        },
        config
      )
    },
    [config, route]
  )

  // §16 syllabus-topic page (…/exams/{exam}/syllabus/{topic}/) — P4-S3.
  const openExamSyllabus = useCallback(
    (examSlug: string, syllabusTopicSlug: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'syllabus',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          examSlug,
          syllabusTopicSlug,
        },
        config
      )
    },
    [config, route]
  )

  // §16/P7-S3 mock-test runner — the exam-scoped shape
  // (…/exams/{exam}/mock-tests/{slug}/).
  const openExamTest = useCallback(
    (examSlug: string, testSlug: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'test',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          examSlug,
          testSlug,
        },
        config
      )
    },
    [config, route]
  )

  // §16/P7-S3 mock-test runner — the topic-scoped shape
  // (…/gk/{topic}/mock-tests/{slug}/).
  const openTopicTest = useCallback(
    (topicSlug: string, testSlug: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'test',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug,
          unitSlug: null,
          testSlug,
        },
        config
      )
    },
    [config, route]
  )

  // P5-S1: open a followed exam in ITS OWN market (§14 — a GB exam opens on
  // the UK market even while browsing India).
  const openFollowedExam = useCallback(
    (slug: string, countryIso: string) => {
      if (!config || !route) return
      const market = config.find((entry) => entry.isoCode === countryIso)
      if (!market) return
      navigateRoute(
        {
          view: 'exam',
          countryIso: market.isoCode,
          language: market.defaultLanguage.code,
          topicSlug: null,
          unitSlug: null,
          examSlug: slug,
          syllabusTopicSlug: null,
        },
        config
      )
    },
    [config, route]
  )

  // P5-S1: open a followed topic — COUNTRY-scoped topics in their own market,
  // GLOBAL topics in the current market.
  const openFollowedTopic = useCallback(
    (slug: string, countryIso: string | null) => {
      if (!config || !route) return
      const market = countryIso ? config.find((entry) => entry.isoCode === countryIso) : null
      navigateRoute(
        {
          view: 'topic',
          countryIso: market?.isoCode ?? route.countryIso,
          language: market ? market.defaultLanguage.code : route.language,
          topicSlug: slug,
          unitSlug: null,
        },
        config
      )
    },
    [config, route]
  )

  // P5-S2: open a saved item's knowledge page — a saved CONTENT_ITEM opens
  // in its own language's market (the summary resolved it, §35); a saved
  // KNOWLEDGE_UNIT (language null) opens in the current market. When the
  // current market already configures the language, stay in-market.
  const openSavedUnit = useCallback(
    (topicSlug: string, unitSlug: string, language: string | null) => {
      if (!config || !route) return
      let countryIso = route.countryIso
      let languageCode = route.language
      if (language) {
        const current = config.find((entry) => entry.isoCode === route.countryIso)
        if (current?.languages.some((lang) => lang.code === language)) {
          languageCode = language // stay in-market, switch language only
        } else {
          // First market that configures the item's language (§35).
          const market =
            config.find((entry) => entry.isDefault && entry.languages.some((lang) => lang.code === language)) ??
            config.find((entry) => entry.languages.some((lang) => lang.code === language))
          if (market) {
            countryIso = market.isoCode
            languageCode = language
          }
        }
      }
      navigateRoute(
        {
          view: 'unit',
          countryIso,
          language: languageCode,
          topicSlug,
          unitSlug,
        },
        config
      )
    },
    [config, route]
  )

  // P5-S4: opens any §16 canonical path inside the app — the dashboard's
  // queue units, signal chips and saves all carry server-built paths; this
  // lenient parser (the parseHash grammar) turns a path back into a route,
  // so the dashboard navigates by §16 identity, never by ad-hoc slugs.
  // SITE-S1 — grammar v2: subjects and knowledge pages at the root; the
  // legacy /gk/ prefix still parses (tolerant).
  const openPath = useCallback(
    (path: string) => {
      if (!config || !route) return
      const segments = path.split('/').filter(Boolean)
      const defaultCountry = config.find((entry) => entry.isDefault) ?? config[0]
      if (!defaultCountry) return
      let country = defaultCountry
      let language = country.defaultLanguage.code
      let index = 0

      const first = segments[0]
      if (first && !isContentRoot(first)) {
        const bySlug = config.find((entry) => !entry.isDefault && entry.slug === first)
        const defaultMarketLanguage = country.languages.find(
          (entry) => entry.code === first && entry.code !== country.defaultLanguage.code
        )
        if (bySlug) {
          country = bySlug
          index = 1
        } else if (defaultMarketLanguage) {
          language = defaultMarketLanguage.code
          index = 1
        }
      }
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

      // The content root (or the legacy gk prefix) + the v2 grammar.
      // afterRoot skips a KNOWN root; a subject path's root IS the content.
      const root = segments[index]
      const afterRoot = segments.slice(index + (isContentRoot(root) ? 1 : 0))
      if (root === 'current-affairs') {
        if (afterRoot[0]) {
          navigateRoute(
            { view: 'event', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null, eventSlug: afterRoot[0] },
            config
          )
        } else {
          navigateRoute(
            { view: 'current-affairs', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null },
            config
          )
        }
      } else if (root === 'exams' && afterRoot[0]) {
        navigateRoute(
          {
            view: 'exam',
            countryIso: country.isoCode,
            language,
            topicSlug: null,
            unitSlug: null,
            examSlug: afterRoot[0],
          },
          config
        )
      } else if (root === 'subjects') {
        navigateRoute(
          { view: 'subjects', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null },
          config
        )
      } else if (root === 'mcq') {
        navigateRoute(
          { view: 'mcq', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null },
          config
        )
      } else if (root === 'qna') {
        navigateRoute(
          { view: 'qna', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null },
          config
        )
      } else if (root === 'pyq') {
        // SITE-S7 — the PYQ directory: /pyq/, /pyq/{exam}/, /pyq/{exam}/{year}/
        // (dashboard-style path links route through the same grammar). A
        // non-year second segment tolerantly opens the exam page.
        const pyqExamSlug = afterRoot[0] ?? null
        const pyqYearSegment = afterRoot[1] ?? ''
        const pyqYearParsed = /^\d{4}$/.test(pyqYearSegment) ? Number(pyqYearSegment) : null
        navigateRoute(
          {
            view: 'pyq',
            countryIso: country.isoCode,
            language,
            topicSlug: null,
            unitSlug: null,
            examSlug: pyqExamSlug,
            pyqYear:
              pyqYearParsed !== null && pyqYearParsed >= 1900 && pyqYearParsed <= 2100
                ? pyqYearParsed
                : null,
          },
          config
        )
      } else if (root === 'mock-test') {
        navigateRoute(
          { view: 'mock-test', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null },
          config
        )
      } else if (afterRoot[0] && afterRoot[1] === 'mock-tests' && afterRoot[2]) {
        navigateRoute(
          { view: 'test', countryIso: country.isoCode, language, topicSlug: afterRoot[0], unitSlug: null, testSlug: afterRoot[2] },
          config
        )
      } else if (afterRoot[0] && afterRoot[1]) {
        navigateRoute(
          { view: 'unit', countryIso: country.isoCode, language, topicSlug: afterRoot[0], unitSlug: afterRoot[1] },
          config
        )
      } else if (afterRoot[0]) {
        navigateRoute(
          { view: 'topic', countryIso: country.isoCode, language, topicSlug: afterRoot[0], unitSlug: null },
          config
        )
      }
    },
    [config, route]
  )

  // §36 historical window — addressable ?version= on the exam view.
  const switchExamVersion = useCallback(
    (versionId: string | null) => {
      if (!config || !route || !route.examSlug) return
      navigateRoute(
        {
          view: 'exam',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          examSlug: route.examSlug,
          syllabusTopicSlug: null,
          versionId,
        },
        config
      )
    },
    [config, route]
  )

  // Addressable pagination: the page lives in the hash (?page=N), so the
  // back button walks pages and every topic switch starts clean at page 1.
  const goTopicPage = useCallback(
    (page: number) => {
      if (!config || !route || !route.topicSlug) return
      navigateRoute(
        {
          view: 'topic',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: route.topicSlug,
          unitSlug: null,
          page,
        },
        config
      )
    },
    [config, route]
  )

  // SITE-S1: addressable pagination for the current-affairs listing — the
  // same ?page=N contract as the topic view.
  const goListingPage = useCallback(
    (page: number) => {
      if (!config || !route) return
      navigateRoute(
        {
          view: 'current-affairs',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: null,
          unitSlug: null,
          page,
        },
        config
      )
    },
    [config, route]
  )

  const switchLanguage = useCallback(
    (code: string) => {
      if (!config || !route) return
      navigateRoute(
        {
          // Language switching on market-independent surfaces (sign-in,
          // console, following, saved, onboarding, profile, dashboard,
          // personalisation, notifications, feedback, mock-test) lands on
          // the home view — the console precedent.
          view:
            route.view === 'console' ||
            route.view === 'dev-track' ||
            route.view === 'site-page' ||
            route.view === 'signin' ||
            route.view === 'following' ||
            route.view === 'saved' ||
            route.view === 'onboarding' ||
            route.view === 'profile' ||
            route.view === 'dashboard' ||
            route.view === 'personalisation' ||
            route.view === 'notifications' ||
            route.view === 'feedback' ||
            route.view === 'mock-test'
              ? 'home'
              : route.view,
          countryIso: route.countryIso,
          language: code,
          topicSlug: route.topicSlug,
          unitSlug: route.unitSlug,
          eventSlug: route.eventSlug,
          examSlug: route.examSlug,
          syllabusTopicSlug: route.syllabusTopicSlug,
          page: route.page,
          versionId: route.versionId,
          focusQuestionId: route.focusQuestionId,
        },
        config
      )
    },
    [config, route]
  )

  const switchCountry = useCallback(
    (iso: string) => {
      if (!config || !route) return
      const target = config.find((entry) => entry.isoCode === iso)
      if (!target) return
      // §15.2: deliberate country switching lands on that country's homepage
      // and overwrites the client-side market choice (§31 — client-only).
      storeMarketChoice({ iso: target.isoCode, origin: 'user' })
      navigateRoute(
        {
          view: 'home',
          countryIso: target.isoCode,
          language: target.defaultLanguage.code,
          topicSlug: null,
          unitSlug: null,
        },
        config
      )
    },
    [config, route, storeMarketChoice]
  )

  const goConsole = useCallback(() => {
    if (!config || !route) return
    navigateRoute(
      { view: 'console', countryIso: route.countryIso, language: route.language, topicSlug: null, unitSlug: null },
      config
    )
  }, [config, route])

  // The homepage's Sign-in CTA routes to the public sign-in page — the
  // one user-facing authentication surface.
  const goSignIn = useCallback(() => {
    navigateToPath('/signin')
  }, [])

  // ---------- Primary navigation (sidebar + footer are path-based) ----------

  // SITE-S1: "Current Affairs" opens the dedicated /current-affairs/
  // listing view (was: the /gk/current-affairs/ topic hub).
  const openCurrentAffairs = useCallback(() => {
    if (!config || !route) return
    navigateRoute(
      {
        view: 'current-affairs',
        countryIso: route.countryIso,
        language: route.language,
        topicSlug: null,
        unitSlug: null,
      },
      config
    )
  }, [config, route])

  // ---------- Header switcher data ----------

  const currentCountry = useMemo(
    () => (config && route ? config.find((entry) => entry.isoCode === route.countryIso) ?? null : null),
    [config, route]
  )

  // The focused surfaces own the ENTIRE viewport: the staff console (an
  // internal tool with its own header/footer — CONSOLE-S1), the preserved
  // Foundation Console (dev-track), and the timed mock-test runner
  // (distraction-free). No public chrome renders for them.
  const focusedView =
    route?.view === 'console' || route?.view === 'dev-track' || route?.view === 'test'

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      {/* CONSOLE-S1: the settings-managed integrations (GA/GTM/FB/custom
          code) — mounted once, present on every surface. */}
      <SiteIntegrations />

      {/* ---------- The internal surfaces render standalone ---------- */}
      {route?.view === 'console' ? (
        <ConsoleShell consolePath={route.consolePath} />
      ) : route?.view === 'dev-track' ? (
        <div className="flex min-h-screen flex-col bg-zinc-50">
          <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-sm font-bold text-zinc-950">G</span>
                <div>
                  <p className="text-[13px] font-semibold leading-tight text-white">GKSetu Dev Track</p>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400/80">Build-verification surface</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-zinc-700 bg-zinc-900 text-[12px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
                  onClick={() => navigateToPath('/console')}
                >
                  Operating console
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-zinc-700 bg-zinc-900 text-[12px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
                  onClick={goHome}
                >
                  Public site
                </Button>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
            <ConsoleView onBackHome={goHome} />
          </main>
          <footer className="mt-auto border-t border-zinc-800 bg-zinc-950 py-3 text-center text-[11px] text-zinc-600">
            The preserved Foundation Console — every module demo from P1–P10. The operating console lives at /console.
          </footer>
        </div>
      ) : (
        <>
      {/* ---------- Header ---------- */}
      <SiteHeader
        config={config}
        route={route}
        onGoHome={goHome}
        onSwitchCountry={switchCountry}
        onSwitchLanguage={switchLanguage}
        onOpenNav={() => setMobileNavOpen(true)}
      />

      {/* ---------- Sidebar + main ---------- */}
      <div className="mx-auto flex w-full max-w-7xl flex-1">
        {!focusedView && (
          <AppSidebar
            route={route}
            config={config}
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            onSwitchCountry={switchCountry}
            onSwitchLanguage={switchLanguage}
          />
        )}

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {configError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Could not load the country configuration. Refresh the page to retry.
          </div>
        ) : !config || !route ? (
          <div className="space-y-6" aria-busy="true" aria-label="Loading GKSetu">
            <div className="space-y-3">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-10 w-full max-w-xl" />
              <Skeleton className="h-11 w-full max-w-2xl" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-44 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : route.view === 'site-page' && route.pageSlug ? (
          <SitePageView key={route.pageSlug} slug={route.pageSlug} />
        ) : route.view === 'signin' ? (
          <SignInView onGoHome={goHome} />
        ) : route.view === 'topic' && route.topicSlug ? (
          <TopicLandingView
            key={`${route.countryIso}:${route.language}:${route.topicSlug}`}
            slug={route.topicSlug}
            countryIso={route.countryIso}
            language={route.language}
            page={route.page}
            onPageChange={goTopicPage}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onOpenExam={openExam}
            onOpenTest={openTopicTest}
            onGoHome={goHome}
          />
        ) : route.view === 'unit' && route.topicSlug && route.unitSlug ? (
          <UnitView
            key={`${route.countryIso}:${route.language}:${route.unitSlug}`}
            topicSlug={route.topicSlug}
            unitSlug={route.unitSlug}
            country={route.countryIso}
            language={route.language}
            focusQuestionId={route.focusQuestionId}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onOpenExam={openExam}
            onSwitchLanguage={switchLanguage}
          />
        ) : route.view === 'event' && route.eventSlug ? (
          <EventView
            key={`${route.countryIso}:${route.language}:${route.eventSlug}`}
            eventSlug={route.eventSlug}
            country={route.countryIso}
            language={route.language}
            onGoHome={goHome}
            onOpenUnit={openUnit}
            onOpenTopic={openTopic}
            onSwitchLanguage={switchLanguage}
          />
        ) : route.view === 'following' ? (
          <FollowingView
            onOpenExam={openFollowedExam}
            onOpenTopic={openFollowedTopic}
            onGoHome={goHome}
            onSignIn={goSignIn}
          />
        ) : route.view === 'saved' ? (
          <SavedView
            onOpenSavedUnit={openSavedUnit}
            onOpenEvent={openEvent}
            onGoHome={goHome}
            onSignIn={goSignIn}
          />
        ) : route.view === 'onboarding' ? (
          <OnboardingView onDone={goHome} onGoProfile={() => navigateToPath('/profile')} onSignIn={goSignIn} />
        ) : route.view === 'profile' ? (
          <ProfileView
            onGoHome={goHome}
            onGoOnboarding={() => navigateToPath('/onboarding')}
            onSignIn={goSignIn}
            onOpenExam={openFollowedExam}
            onOpenTopic={openFollowedTopic}
          />
        ) : route.view === 'dashboard' ? (
          <DashboardView
            countryIso={route.countryIso}
            language={route.language}
            onOpenPath={openPath}
            onOpenQuickMock={() => goMockTest()}
            onGoHome={goHome}
            onSignIn={goSignIn}
          />
        ) : route.view === 'mock-test' ? (
          <MockTestView
            key={route.examSlug ?? 'combined'}
            countryIso={route.countryIso}
            language={route.language}
            initialExamSlug={route.examSlug}
            onOpenDashboard={() => navigateToPath('/dashboard')}
            onGoHome={goHome}
            onOpenExam={openExam}
            onOpenUnit={openUnit}
            onSignIn={goSignIn}
          />
        ) : route.view === 'current-affairs' ? (
          <CurrentAffairsView
            key={`${route.countryIso}:${route.language}`}
            countryIso={route.countryIso}
            language={route.language}
            page={route.page}
            onPageChange={goListingPage}
            onOpenPath={openPath}
            onGoHome={goHome}
          />
        ) : route.view === 'subjects' ? (
          <SubjectsView
            key={`${route.countryIso}:${route.language}`}
            countryIso={route.countryIso}
            language={route.language}
            onOpenTopic={openTopic}
            onGoHome={goHome}
          />
        ) : route.view === 'mcq' ? (
          <McqView
            key={`${route.countryIso}:${route.language}`}
            route={route}
            onGoHome={goHome}
          />
        ) : route.view === 'qna' ? (
          <QnaView
            key={`${route.countryIso}:${route.language}`}
            onGoHome={goHome}
          />
        ) : route.view === 'pyq' ? (
          <PyqView
            key={`${route.countryIso}:${route.language}:${route.examSlug ?? ''}:${route.pyqYear ?? ''}`}
            route={route}
            onGoHome={goHome}
          />
        ) : route.view === 'collection' && route.collectionId ? (
          <SharedCollectionView
            key={route.collectionId}
            collectionId={route.collectionId}
            onOpenPath={openPath}
            onGoHome={goHome}
          />
        ) : route.view === 'personalisation' ? (
          <ControlsView
            countryIso={route.countryIso}
            language={route.language}
            onOpenPath={openPath}
            onGoHome={goHome}
            onSignIn={goSignIn}
          />
        ) : route.view === 'notifications' ? (
          <NotificationsView onOpenPath={openPath} onGoHome={goHome} onSignIn={goSignIn} />
        ) : route.view === 'feedback' ? (
          <MyFeedbackView onOpenPath={openPath} onGoHome={goHome} onSignIn={goSignIn} />
        ) : route.view === 'exam-directory' ? (
          <ExamDirectoryView
            key={`${route.countryIso}:${route.language}`}
            countryIso={route.countryIso}
            language={route.language}
            onOpenExam={openExam}
            onGoHome={goHome}
          />
        ) : route.view === 'exam' && route.examSlug ? (
          <ExamView
            key={`${route.countryIso}:${route.language}:${route.examSlug}`}
            examSlug={route.examSlug}
            countryIso={route.countryIso}
            language={route.language}
            versionId={route.versionId}
            onVersionChange={switchExamVersion}
            onOpenUnit={openUnit}
            onOpenExam={openExam}
            onOpenExamSyllabus={openExamSyllabus}
            onOpenEvent={openEvent}
            onOpenTest={openExamTest}
            onGoHome={goHome}
          />
        ) : route.view === 'test' && route.testSlug ? (
          <TestRunnerView
            key={`${route.countryIso}:${route.language}:${route.testSlug}`}
            testSlug={route.testSlug}
            quickAttemptId={null}
            examSlug={route.examSlug}
            topicSlug={route.topicSlug}
            countryIso={route.countryIso}
            language={route.language}
            onGoHome={goHome}
            onOpenExam={openExam}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onExitQuick={() => goMockTest()}
            onSignIn={goSignIn}
          />
        ) : route.view === 'syllabus' && route.examSlug && route.syllabusTopicSlug ? (
          <SyllabusView
            key={`${route.countryIso}:${route.language}:${route.examSlug}:${route.syllabusTopicSlug}`}
            examSlug={route.examSlug}
            topicSlug={route.syllabusTopicSlug}
            countryIso={route.countryIso}
            language={route.language}
            onOpenExam={openExam}
            onOpenUnit={openUnit}
            onOpenExamSyllabus={openExamSyllabus}
            onOpenTopic={openTopic}
            onGoHome={goHome}
          />
        ) : (
          <HomepageView
            key={`${route.countryIso}:${route.language}`}
            countryIso={route.countryIso}
            language={route.language}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onOpenExam={openExam}
            onBrowseExams={openExamDirectory}
            onOpenPath={openPath}
            onSwitchLanguage={switchLanguage}
            onSignIn={goSignIn}
          />
        )}
        </main>
      </div>

      {/* ---------- Footer (sticky bottom) ---------- */}
      <SiteFooter
        onGoHome={goHome}
        onGoConsole={goConsole}
      />
        </>
      )}
    </div>
  )
}
