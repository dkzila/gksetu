'use client'

/**
 * GlobIQ — App Shell (P4-S2, extended P4-S3)
 *
 * The public product surface (§38): the §34 country homepage at the §16 root
 * default, the §33 topic landing pages, the §22 knowledge pages, and — from
 * P4-S3 — the §16 exam pages (…/exams/{exam}/) and syllabus-topic pages
 * (…/exams/{exam}/syllabus/{topic}/) — with the §15 country switcher and §35
 * language switcher always available in the header, and the foundation
 * console (every prior session's verification surface) one click away.
 * In-app navigation mirrors the §16 URL grammar after the hash
 * (#/hi/gk/polity-governance/…, #/exams/upsc-civil-services/…) — one grammar,
 * one source of URL truth, driven by the live country/language configuration
 * (§35).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Globe,
  Languages,
  MapPin,
  SquareTerminal,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PLATFORM } from '@/config/platform'
import { HeaderAuth } from '@/components/auth/header-auth'
import { useAuth } from '@/stores/auth'
import { ConsoleView } from '@/components/home/console-view'
import { EventView } from '@/components/home/event-view'
import { ExamView } from '@/components/home/exam-view'
import { HomepageView } from '@/components/home/homepage-view'
import { SyllabusView } from '@/components/home/syllabus-view'
import { TopicLandingView } from '@/components/home/topic-landing-view'
import { UnitView } from '@/components/home/unit-view'
import { FollowingView } from '@/components/follows/following-view'
import { SavedView } from '@/components/saves/saved-view'
import { OnboardingView } from '@/components/personalisation/onboarding-view'
import { ProfileView } from '@/components/personalisation/profile-view'
import { DashboardView } from '@/components/personalisation/dashboard-view'
import { ControlsView } from '@/components/personalisation/controls-view'
import { navigateHash, useHashRoute } from '@/components/home/hash-router'
import type { ApiCountry, Envelope } from '@/components/home/types'

export default function GlobIQApp() {
  // ---------- Locale configuration (§35 — the switchers' source of truth) ----------
  const [config, setConfig] = useState<ApiCountry[] | null>(null)
  const [configError, setConfigError] = useState(false)

  // P5-S1: identity bootstrap in the app shell — a persisted token (zustand
  // persists ONLY the token, §20/§30) must revalidate against /api/auth/me on
  // every load, not just when the console's account section happens to mount.
  // Personalised surfaces (follow buttons, #/following) read this state.
  useEffect(() => {
    void useAuth.getState().initialize()
  }, [])

  useEffect(() => {
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

  const route = useHashRoute(config)

  // Scroll behaviour: view changes start at the top; #account lands on the
  // account section (the header Sign-in anchor keeps working).
  useEffect(() => {
    if (!route) return
    if (route.view === 'console' && route.scrollTo) {
      const timer = window.setTimeout(() => {
        document.getElementById(route.scrollTo ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
      return () => window.clearTimeout(timer)
    }
    window.scrollTo({ top: 0 })
  }, [route])

  // ---------- Navigation (§16 grammar after the hash) ----------

  const goHome = useCallback(() => {
    if (!config || !route) return
    navigateHash(
      { view: 'home', countryIso: route.countryIso, language: route.language, topicSlug: null, unitSlug: null },
      config
    )
  }, [config, route])

  const openTopic = useCallback(
    (slug: string) => {
      if (!config || !route) return
      navigateHash(
        { view: 'topic', countryIso: route.countryIso, language: route.language, topicSlug: slug, unitSlug: null },
        config
      )
    },
    [config, route]
  )

  const openUnit = useCallback(
    (topicSlug: string, unitSlug: string) => {
      if (!config || !route) return
      navigateHash(
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
      navigateHash(
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

  // §16 current-affairs event page (…/current-affairs/{slug}/) — P6-S2.
  const openEvent = useCallback(
    (slug: string) => {
      if (!config || !route) return
      navigateHash(
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
      navigateHash(
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

  // P5-S1: open a followed exam in ITS OWN market (§14 — a GB exam opens on
  // the UK market even while browsing India).
  const openFollowedExam = useCallback(
    (slug: string, countryIso: string) => {
      if (!config || !route) return
      const market = config.find((entry) => entry.isoCode === countryIso)
      if (!market) return
      navigateHash(
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
      navigateHash(
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
      navigateHash(
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
      if (first && first !== 'gk' && first !== 'exams' && first !== 'current-affairs') {
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
      if (next && next !== 'gk' && next !== 'exams' && next !== 'current-affairs') {
        const languageMatch = country.languages.find(
          (entry) => entry.code === next && entry.code !== country.defaultLanguage.code
        )
        if (languageMatch) {
          language = languageMatch.code
          index += 1
        }
      }

      if (segments[index] === 'gk' && segments[index + 1] && segments[index + 2]) {
        navigateHash(
          { view: 'unit', countryIso: country.isoCode, language, topicSlug: segments[index + 1]!, unitSlug: segments[index + 2]! },
          config
        )
      } else if (segments[index] === 'gk' && segments[index + 1]) {
        navigateHash(
          { view: 'topic', countryIso: country.isoCode, language, topicSlug: segments[index + 1]!, unitSlug: null },
          config
        )
      } else if (segments[index] === 'current-affairs' && segments[index + 1]) {
        navigateHash(
          { view: 'event', countryIso: country.isoCode, language, topicSlug: null, unitSlug: null, eventSlug: segments[index + 1]! },
          config
        )
      } else if (segments[index] === 'exams' && segments[index + 1]) {
        navigateHash(
          {
            view: 'exam',
            countryIso: country.isoCode,
            language,
            topicSlug: null,
            unitSlug: null,
            examSlug: segments[index + 1]!,
          },
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
      navigateHash(
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
      navigateHash(
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

  const switchLanguage = useCallback(
    (code: string) => {
      if (!config || !route) return
      navigateHash(
        {
          // Language switching on market-independent surfaces (console,
          // following, saved, onboarding, profile, dashboard, personalisation)
          // lands on the home view — the console precedent.
          view:
            route.view === 'console' ||
            route.view === 'following' ||
            route.view === 'saved' ||
            route.view === 'onboarding' ||
            route.view === 'profile' ||
            route.view === 'dashboard' ||
            route.view === 'personalisation'
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
      // §15: deliberate country switching lands on that country's homepage.
      navigateHash(
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
    [config, route]
  )

  const goConsole = useCallback(() => {
    if (!config || !route) return
    navigateHash(
      { view: 'console', countryIso: route.countryIso, language: route.language, topicSlug: null, unitSlug: null },
      config
    )
  }, [config, route])

  // The homepage's Sign-in CTA routes to the console's account section —
  // the same '#account' anchor the header uses (§38: one auth surface).
  const goSignIn = useCallback(() => {
    window.location.hash = '#account'
  }, [])

  // ---------- Header switcher data ----------

  const currentCountry = useMemo(
    () => (config && route ? config.find((entry) => entry.isoCode === route.countryIso) ?? null : null),
    [config, route]
  )

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <button
              type="button"
              onClick={goHome}
              className="flex min-h-[44px] items-center gap-3 text-left"
              aria-label="GlobIQ home"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600" aria-hidden="true">
                <Globe className="h-5 w-5 text-white" />
              </span>
              <span className="leading-tight">
                <span className="block text-lg font-semibold tracking-tight">GlobIQ</span>
                <span className="hidden text-xs text-zinc-500 sm:block">{PLATFORM.tagline}</span>
              </span>
            </button>

            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="hidden shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 lg:inline-flex"
              >
                Phase 7 · Session 1 — QnA Learning Layer
              </Badge>
              <HeaderAuth />
            </div>
          </div>

          {/* §15/§35 switchers + console link — always available */}
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              <span className="sr-only">Country</span>
              <Select
                value={route?.countryIso ?? ''}
                onValueChange={switchCountry}
                disabled={!config}
              >
                <SelectTrigger
                  className="h-9 w-[150px] border-zinc-200 bg-white text-sm font-medium"
                  aria-label="Switch country"
                >
                  <SelectValue placeholder={config ? 'Country' : 'Loading…'} />
                </SelectTrigger>
                <SelectContent>
                  {(config ?? []).map((entry) => (
                    <SelectItem key={entry.isoCode} value={entry.isoCode} className="text-sm">
                      {entry.name}
                      {entry.status === 'COMING_SOON' && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600">
                          soon
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              <span className="sr-only">Language</span>
              <Select
                value={route?.language ?? ''}
                onValueChange={switchLanguage}
                disabled={!currentCountry}
              >
                <SelectTrigger
                  className="h-9 w-[150px] border-zinc-200 bg-white text-sm font-medium"
                  aria-label="Switch language"
                >
                  <SelectValue placeholder={currentCountry ? 'Language' : '—'} />
                </SelectTrigger>
                <SelectContent>
                  {(currentCountry?.languages ?? []).map((entry) => (
                    <SelectItem key={entry.code} value={entry.code} className="text-sm">
                      {entry.nativeName ?? entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-9 gap-2 px-2.5 text-zinc-500 hover:text-zinc-900"
              onClick={goConsole}
            >
              <SquareTerminal className="h-4 w-4" aria-hidden="true" />
              Console
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- Main (§34/§33/§22 views + console) ---------- */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {configError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Could not load the country configuration. Refresh the page to retry.
          </div>
        ) : !config || !route ? (
          <div className="space-y-6" aria-busy="true" aria-label="Loading GlobIQ">
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
        ) : route.view === 'console' ? (
          <ConsoleView onBackHome={goHome} />
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
            onGoHome={goHome}
          />
        ) : route.view === 'unit' && route.topicSlug && route.unitSlug ? (
          <UnitView
            key={`${route.countryIso}:${route.language}:${route.unitSlug}`}
            topicSlug={route.topicSlug}
            unitSlug={route.unitSlug}
            country={route.countryIso}
            language={route.language}
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
          <OnboardingView onDone={goHome} onGoProfile={() => window.location.assign('#/profile')} onSignIn={goSignIn} />
        ) : route.view === 'profile' ? (
          <ProfileView
            onGoHome={goHome}
            onGoOnboarding={() => window.location.assign('#/onboarding')}
            onSignIn={goSignIn}
            onOpenExam={openFollowedExam}
            onOpenTopic={openFollowedTopic}
          />
        ) : route.view === 'dashboard' ? (
          <DashboardView
            countryIso={route.countryIso}
            language={route.language}
            onOpenPath={openPath}
            onGoHome={goHome}
            onSignIn={goSignIn}
          />
        ) : route.view === 'personalisation' ? (
          <ControlsView
            countryIso={route.countryIso}
            language={route.language}
            onOpenPath={openPath}
            onGoHome={goHome}
            onSignIn={goSignIn}
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
            onGoHome={goHome}
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
            onOpenPath={openPath}
            onSwitchLanguage={switchLanguage}
            onSignIn={goSignIn}
          />
        )}
      </main>

      {/* ---------- Footer (sticky bottom, §16 build reference) ---------- */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:px-6">
          <div className="text-sm text-zinc-500">
            <span className="font-semibold text-zinc-900">GlobIQ</span> · © 2025 dkzila · Built per{' '}
            <span className="font-medium text-zinc-700">GlobIQ_Master_Plan.md v2.0</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 px-2 text-zinc-500 hover:text-zinc-900"
              onClick={goConsole}
            >
              <SquareTerminal className="h-4 w-4" aria-hidden="true" />
              Foundation console
            </Button>
            <a
              href="https://github.com/dkzila/globiq"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              GitHub Repository
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
