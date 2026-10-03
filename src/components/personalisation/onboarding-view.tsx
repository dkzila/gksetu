'use client'

/**
 * GKSetu — the Onboarding view (P5-S3, #/onboarding)
 * Master Plan §6 (User personalisation dimensions + UserGoal/Profile), §9
 * (explicit signals — declared goals/subjects, changeable at any time), §13/
 * §14 (home-market exams; GLOBAL topics any market), §31 (skipping is a
 * deliberate choice, never an error; data only ever saved via the user's
 * own Bearer-authenticated APIs), §35 (country×language rules), §16 (private
 * authenticated surface: noindex, never in the sitemap).
 *
 * A four-step guided flow — basics → goal exams → subjects → level & pace —
 * that prefills from the caller's current profile/goal (re-runs edit rather
 * than duplicate), saves step 1 via PATCH /api/profile and the goal via a
 * single full-replacement PUT /api/goal (§9), then completes onboarding.
 * Every step is skippable; "Skip for now" is an honest §31 choice.
 *
 * SITE-S11 (docs/learning-flow-plan.md): step 2 scales beyond the scroll-wall
 * — the exam picker is SERVER-driven (debounced search + 10-per-page
 * pagination on the existing /api/exams contract, selections surviving page
 * changes as removable chips); step 3 derives its subjects from the chosen
 * exams' syllabi (/api/exams/subjects — the tutorials §14 gate) — pre-ticked,
 * untickable, with the full taxonomy tree still browsable behind a toggle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  ListChecks,
  ListTree,
  Loader2,
  LogIn,
  Search,
  Sparkles,
  X,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type { ApiCountry, Envelope } from '@/components/home/types'
import {
  LEVEL_LABELS,
  ONBOARDING_COPY,
  type ApiDerivedSubject,
  type ApiExamOption,
  type ApiExamSubjects,
  type ApiProfile,
  type ApiTopicNode,
} from './types'

// ---------- Props ----------

export interface OnboardingViewProps {
  /** Where "done" lands (wizard completion or skip) — the homepage. */
  onDone: () => void
  onGoProfile: () => void
  onSignIn: () => void
}

const STEPS = [
  { id: 1, title: 'Basics', icon: GraduationCap },
  { id: 2, title: 'Goal exams', icon: BookOpenCheck },
  { id: 3, title: 'Subjects', icon: ListChecks },
  { id: 4, title: 'Level & pace', icon: Sparkles },
] as const

const MAX_TOPICS = 25
const DAILY_OPTIONS = [15, 30, 45, 60, 90, 120, 180]
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, index) => 2025 + index)

/** SITE-S11: the exam picker's page size — 10 rows per server page (the
 * onboarding-at-scale decision: search + paginate, never a scroll-wall). */
const EXAM_PAGE_SIZE = 10
/** SITE-S11: the search input's debounce (ms) — typing settles before the
 * server round-trip, so keystrokes never spam /api/exams. */
const EXAM_SEARCH_DEBOUNCE_MS = 300

/** The /api/exams list response (the envelope's data). */
interface ExamListResponse {
  exams: ApiExamOption[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  country: { isoCode: string; name: string }
}

/** The picker's held page — the response's exams plus the pagination numbers
 * the footer renders. */
interface ExamPage {
  exams: ApiExamOption[]
  total: number
  totalPages: number
}

// ---------- Component ----------

export function OnboardingView({ onDone, onGoProfile, onSignIn }: OnboardingViewProps) {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [config, setConfig] = useState<ApiCountry[] | null>(null)
  const [profile, setProfile] = useState<ApiProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [busy, setBusy] = useState<'patch' | 'goal' | 'skip' | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)

  // Step 1 — basics (prefilled from the profile)
  const [name, setName] = useState('')
  const [countryIso, setCountryIso] = useState('')
  const [languageCode, setLanguageCode] = useState('')

  // Step 2 — goal exams: the SERVER-driven picker (S11-A). Search is
  // debounced into `examSearch`; the page fetch rides the existing
  // /api/exams contract (q/page/pageSize/total/totalPages); selections live
  // in `selectedExams` and survive page changes; `examMetaBySlug` keeps the
  // names/codes of every row ever seen (chips + the review line) — prefilled
  // from the profile's goal exams so a re-run never shows bare slugs.
  const [selectedExams, setSelectedExams] = useState<Set<string>>(new Set())
  const [examSearchInput, setExamSearchInput] = useState('')
  const [examSearch, setExamSearch] = useState('')
  const [examPage, setExamPage] = useState(1)
  const [examResult, setExamResult] = useState<ExamPage | null>(null)
  const [examLoading, setExamLoading] = useState(false)
  const [examError, setExamError] = useState<string | null>(null)
  const [examMetaBySlug, setExamMetaBySlug] = useState<Map<string, { name: string; code: string }>>(
    new Map()
  )
  const [examReload, setExamReload] = useState(0)
  const examRequestRef = useRef(0)

  // Step 3 — goal subjects: the syllabus-derived group (S11-B) + the full
  // taxonomy tree behind a toggle. `offeredSubjectsRef` remembers which
  // derived subjects were offered last, so re-entering step 3 never re-ticks
  // a subject the user deliberately unticked (their choice is respected).
  const [topicTree, setTopicTree] = useState<ApiTopicNode[] | null>(null)
  const [topicLoading, setTopicLoading] = useState(false)
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [derivedSubjects, setDerivedSubjects] = useState<ApiExamSubjects | null>(null)
  const [derivedLoading, setDerivedLoading] = useState(false)
  const [derivedError, setDerivedError] = useState<string | null>(null)
  const [showAllSubjects, setShowAllSubjects] = useState(false)
  const offeredSubjectsRef = useRef<Set<string>>(new Set())

  // Step 4 — level & pace
  const [level, setLevel] = useState('')
  const [studyLanguage, setStudyLanguage] = useState('')
  const [targetYear, setTargetYear] = useState('')
  const [dailyMinutes, setDailyMinutes] = useState('')

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Set up your learning profile | GKSetu',
    description:
      'Tell GKSetu which exams and subjects you are preparing for — the explicit goal behind your personalised feed.',
    noindex: true,
  })

  // ---------- Data loads ----------

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        if (payload.status === 'ok' && payload.data) setConfig(payload.data.countries)
      })
      .catch(() => undefined)
  }, [])

  const loadProfile = useCallback(async () => {
    if (!token) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    try {
      const response = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<ApiProfile>
      if (payload.status === 'ok' && payload.data) {
        setProfile(payload.data)
        // Prefill (a re-run edits, never duplicates).
        setName(payload.data.user.name ?? '')
        setCountryIso(payload.data.user.homeCountry?.isoCode ?? '')
        setLanguageCode(payload.data.user.preferredLanguage?.code ?? '')
        if (payload.data.goal) {
          setSelectedExams(new Set(payload.data.goal.exams.map((exam) => exam.slug)))
          setSelectedTopics(new Set(payload.data.goal.topics.map((topic) => topic.slug)))
          // S11: names/codes for the prefilled selections — the chips row and
          // the step-4 review never render a bare slug for them.
          setExamMetaBySlug(
            new Map(payload.data.goal.exams.map((exam) => [exam.slug, { name: exam.name, code: exam.code }]))
          )
          setLevel(payload.data.goal.level ?? '')
          setStudyLanguage(payload.data.goal.studyLanguage?.code ?? '')
          setTargetYear(payload.data.goal.targetYear ? String(payload.data.goal.targetYear) : '')
          setDailyMinutes(payload.data.goal.dailyMinutes ? String(payload.data.goal.dailyMinutes) : '')
        }
      }
    } catch {
      // The wizard still works; the user just starts from scratch.
    } finally {
      setProfileLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const loadTopics = useCallback(async (iso: string, language: string) => {
    setTopicLoading(true)
    try {
      const params = new URLSearchParams({ country: iso })
      if (language) params.set('language', language)
      const response = await fetch(`/api/taxonomy/tree?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ tree: ApiTopicNode[] }>
      setTopicTree(payload.status === 'ok' && payload.data ? payload.data.tree : [])
    } catch {
      setTopicTree([])
    } finally {
      setTopicLoading(false)
    }
  }, [])

  // ---------- S11-A: the server-driven exam picker ----------

  /** The debounce — typing settles for EXAM_SEARCH_DEBOUNCE_MS before the
   * committed search changes (and the page resets to 1 with it). */
  useEffect(() => {
    const timer = setTimeout(() => {
      setExamSearch(examSearchInput.trim())
      setExamPage(1)
    }, EXAM_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [examSearchInput])

  /** The current page fetch — the EXISTING /api/exams contract (q/page/
   * pageSize), superseded cleanly by newer requests (the request-id guard:
   * stale responses are dropped, never rendered). */
  useEffect(() => {
    if (step !== 2) return
    const iso = countryIso.trim()
    if (!iso) return
    const requestId = ++examRequestRef.current
    setExamLoading(true)
    setExamError(null)
    const params = new URLSearchParams({
      country: iso,
      pageSize: String(EXAM_PAGE_SIZE),
      page: String(examPage),
    })
    if (examSearch) params.set('q', examSearch)
    fetch(`/api/exams?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<ExamListResponse>) => {
        if (requestId !== examRequestRef.current) return
        if (payload.status === 'ok' && payload.data) {
          setExamResult({
            exams: payload.data.exams,
            total: payload.data.pagination.total,
            totalPages: Math.max(1, payload.data.pagination.totalPages),
          })
          setExamMetaBySlug((current) => {
            if (payload.data!.exams.every((exam) => current.has(exam.slug))) return current
            const next = new Map(current)
            for (const exam of payload.data!.exams) {
              next.set(exam.slug, { name: exam.name, code: exam.code })
            }
            return next
          })
        } else {
          setExamError(payload.error?.message ?? 'Could not load exams')
        }
      })
      .catch(() => {
        if (requestId !== examRequestRef.current) return
        setExamError('Network error — could not load exams')
      })
      .finally(() => {
        if (requestId !== examRequestRef.current) return
        setExamLoading(false)
      })
  }, [step, countryIso, examSearch, examPage, examReload])

  /** Toggle one exam — shared by the page rows and the selected chips. */
  const toggleExam = useCallback((slug: string) => {
    setSelectedExams((current) => {
      const next = new Set(current)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  // ---------- S11-B: the syllabus-derived subjects ----------

  /** Toggle one subject — shared by the derived rows and the taxonomy tree
   * rows (one guard, one behaviour: the MAX_TOPICS cap). */
  const toggleTopic = useCallback(
    (slug: string) => {
      setSelectedTopics((current) => {
        if (!current.has(slug) && current.size >= MAX_TOPICS) {
          toast({
            title: 'Subject limit reached',
            description: `A goal can declare at most ${MAX_TOPICS} subjects.`,
            variant: 'destructive',
          })
          return current
        }
        const next = new Set(current)
        if (next.has(slug)) next.delete(slug)
        else next.add(slug)
        return next
      })
    },
    [toast]
  )

  /** Derives the chosen exams' subjects (/api/exams/subjects — the tutorials
   * §14 gate) and PRE-TICKS them: the union of the current selection and the
   * derived set, capped at MAX_TOPICS. A subject the user deliberately
   * unticked from a previous offering stays unticked (their choice is
   * respected across back-and-forth steps); only NEW derivations get added. */
  const loadDerivedSubjects = useCallback(async () => {
    if (selectedExams.size === 0) {
      // No goal exams — the plain tree IS the step (the quiet honest path).
      setDerivedSubjects(null)
      setDerivedLoading(false)
      setDerivedError(null)
      setShowAllSubjects(true)
      return
    }
    setDerivedLoading(true)
    setDerivedError(null)
    try {
      const params = new URLSearchParams({ exams: [...selectedExams].join(',') })
      if (countryIso.trim()) params.set('country', countryIso.trim())
      if (languageCode) params.set('language', languageCode)
      const response = await fetch(`/api/exams/subjects?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<ApiExamSubjects>
      if (payload.status === 'ok' && payload.data) {
        setDerivedSubjects(payload.data)
        if (payload.data.subjects.length === 0) {
          // Nothing derived — the tree is the step (never a dead end).
          setShowAllSubjects(true)
        }
        const rejected = new Set(
          [...offeredSubjectsRef.current].filter((slug) => !selectedTopics.has(slug))
        )
        const next = new Set(selectedTopics)
        for (const subject of payload.data.subjects) {
          if (next.size >= MAX_TOPICS) break
          if (rejected.has(subject.slug) || next.has(subject.slug)) continue
          next.add(subject.slug)
        }
        offeredSubjectsRef.current = new Set(payload.data.subjects.map((subject) => subject.slug))
        setSelectedTopics(next)
      } else {
        setDerivedError(payload.error?.message ?? 'Could not derive subjects from your exams')
        setShowAllSubjects(true)
      }
    } catch {
      setDerivedError('Network error — could not derive subjects from your exams')
      setShowAllSubjects(true)
    } finally {
      setDerivedLoading(false)
    }
  }, [selectedExams, selectedTopics, countryIso, languageCode])

  // ---------- Step transitions ----------

  const goToTopics = useCallback(() => {
    setStep(3)
    void loadTopics(countryIso.trim(), languageCode)
    void loadDerivedSubjects()
  }, [countryIso, languageCode, loadTopics, loadDerivedSubjects])

  const saveBasicsAndContinue = useCallback(async () => {
    if (!token || !profile) return
    setStepError(null)
    if (!countryIso.trim()) {
      setStepError('Pick your home country — GKSetu personalises by your market.')
      return
    }
    // PATCH only what changed (§37 — no needless writes).
    const body: Record<string, string | null> = {}
    if (name.trim() !== (profile.user.name ?? '')) body.name = name.trim() || null
    if (countryIso.trim() !== (profile.user.homeCountry?.isoCode ?? '')) body.homeCountryIso = countryIso.trim()
    if (languageCode !== (profile.user.preferredLanguage?.code ?? '')) {
      body.preferredLanguageCode = languageCode || null
    }
    if (Object.keys(body).length > 0) {
      setBusy('patch')
      try {
        const response = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = (await response.json()) as Envelope<{ user: ApiProfile['user'] }>
        if (payload.status !== 'ok') {
          setStepError(payload.error?.message ?? 'Could not save your basics')
          return
        }
        if (payload.data) {
          setProfile((current) => (current ? { ...current, user: payload.data!.user } : current))
        }
        toast({ title: 'Profile saved', description: 'Your basics are up to date.' })
      } catch {
        setStepError('Network error — could not save your basics')
        return
      } finally {
        setBusy(null)
      }
    }
    // Entering step 2 fresh: the picker resets (the market may have changed —
    // the fetch effect re-runs on the step change with a clean page 1).
    setExamSearchInput('')
    setExamSearch('')
    setExamPage(1)
    setStep(2)
  }, [token, profile, name, countryIso, languageCode, toast])

  const submitGoal = useCallback(async () => {
    if (!token) return
    setBusy('goal')
    setStepError(null)
    try {
      const response = await fetch('/api/goal', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exams: [...selectedExams],
          topics: [...selectedTopics],
          level: level || null,
          studyLanguageCode: studyLanguage || null,
          targetYear: targetYear ? Number(targetYear) : null,
          dailyMinutes: dailyMinutes ? Number(dailyMinutes) : null,
        }),
      })
      const payload = (await response.json()) as Envelope<{ goal: ApiProfile['goal']; created: boolean }>
      if (payload.status !== 'ok') {
        setStepError(payload.error?.message ?? 'Could not save your goal')
        return
      }
      // §6 onboarding state: the flow is done.
      const onboardingResponse = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      })
      const onboardingPayload = (await onboardingResponse.json()) as Envelope<{ user: ApiProfile['user'] }>
      if (onboardingPayload.status === 'ok' && onboardingPayload.data) {
        setProfile((current) => (current ? { ...current, user: onboardingPayload.data!.user } : current))
      }
      await useAuth.getState().refreshUser()
      toast({
        title: 'Learning profile ready',
        description: `${selectedExams.size} exam(s) · ${selectedTopics.size} subject(s) — your goal drives what GKSetu surfaces.`,
      })
      onDone()
    } catch {
      setStepError('Network error — could not save your goal')
    } finally {
      setBusy(null)
    }
  }, [token, selectedExams, selectedTopics, level, studyLanguage, targetYear, dailyMinutes, onDone, toast])

  const skipFlow = useCallback(async () => {
    if (!token) return
    setBusy('skip')
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      })
      await useAuth.getState().refreshUser()
      toast({ title: 'Setup skipped', description: 'You can declare a goal anytime from your profile.' })
      onDone()
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }, [token, onDone, toast])

  // ---------- Derived ----------

  const currentCountry = useMemo(
    () => config?.find((entry) => entry.isoCode === (countryIso || profile?.user.homeCountry?.isoCode)) ?? null,
    [config, countryIso, profile]
  )
  const languageOptions = currentCountry?.languages ?? []
  const selectionCountryIso = countryIso.trim() || profile?.user.homeCountry?.isoCode || ''

  // ---------- Signed-out prompt ----------

  if (status !== 'authenticated' || !user) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Set up your learning profile
            </CardTitle>
            <CardDescription>
              Tell GKSetu which exams and subjects you are preparing for — the explicit goal behind
              your personalised feed. Sign in to start.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={onSignIn} className="bg-emerald-600 text-white hover:bg-emerald-700">
              <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign in to continue
            </Button>
            <p className="text-xs text-zinc-500">
              Your goal is an explicit personalisation signal — never proof you will sit an exam,
              and changeable or removable anytime.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // ---------- Wizard ----------

  const onboarding = profile?.user.onboardingStatus ?? 'PENDING'
  const statusCopy = ONBOARDING_COPY[onboarding]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Learning profile</Badge>
          <Badge variant="outline" className={statusCopy.className}>
            {statusCopy.label}
          </Badge>
          <button
            type="button"
            onClick={onGoProfile}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            Manage in profile →
          </button>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {profile?.goal ? 'Update your learning profile' : 'Tell GKSetu your goal'}
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600">
          Four quick steps — your market, the exams you are preparing for, the subjects you care
          about, and how you like to study. Everything here is an explicit signal you control
          and can change or remove anytime.
        </p>
      </div>

      {/* Step indicator */}
      <ol className="flex flex-wrap items-center gap-2" aria-label="Onboarding progress">
        {STEPS.map((entry) => {
          const state = step === entry.id ? 'current' : step > entry.id ? 'done' : 'upcoming'
          return (
            <li key={entry.id} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  state === 'current'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : state === 'done'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-zinc-200 bg-white text-zinc-400'
                }`}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {state === 'done' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <entry.icon className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {entry.id}. {entry.title}
              </span>
            </li>
          )
        })}
      </ol>

      {profileLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your profile">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      ) : (
        <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">
                {step === 1 && 'Step 1 — Your basics'}
                {step === 2 && 'Step 2 — Which exams are you preparing for?'}
                {step === 3 && 'Step 3 — Which subjects matter to you?'}
                {step === 4 && 'Step 4 — Your level & pace'}
              </CardTitle>
              <CardDescription>
                {step === 1 && 'Your market decides which exams and languages GKSetu offers you.'}
                {step === 2 &&
                  `Active exams in ${currentCountry?.name ?? 'your market'} — search by name, code or organiser, then pick any number (or none yet).`}
                {step === 3 &&
                  `Subjects from your exams' syllabi come pre-selected — untick anything, or browse all subjects. Up to ${MAX_TOPICS}.`}
                {step === 4 && 'Optional — a self-declared level and pace helps GKSetu shape difficulty later.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {stepError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {stepError}
                </p>
              )}

              {/* ---------- Step 1 ---------- */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-name">Name (optional)</Label>
                    <Input
                      id="onboarding-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                      autoComplete="name"
                      maxLength={80}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="onboarding-country">Home country *</Label>
                      <Select value={countryIso} onValueChange={setCountryIso}>
                        <SelectTrigger id="onboarding-country" className="w-full border-zinc-200 bg-white">
                          <SelectValue placeholder="Pick your market" />
                        </SelectTrigger>
                        <SelectContent>
                          {(config ?? [])
                            .filter((entry) => entry.status === 'ACTIVE')
                            .map((entry) => (
                              <SelectItem key={entry.isoCode} value={entry.isoCode}>
                                {entry.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-zinc-500">
                        Goal exams must belong to your home market.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="onboarding-language">Preferred language</Label>
                      <Select value={languageCode} onValueChange={setLanguageCode}>
                        <SelectTrigger id="onboarding-language" className="w-full border-zinc-200 bg-white">
                          <SelectValue placeholder="Market default" />
                        </SelectTrigger>
                        <SelectContent>
                          {languageOptions.map((entry) => (
                            <SelectItem key={entry.code} value={entry.code}>
                              {entry.nativeName ?? entry.name}
                              {currentCountry?.defaultLanguage.code === entry.code ? ' (default)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------- Step 2 ---------- */}
              {step === 2 && (
                <div className="space-y-3">
                  {/* Search — server-filtered (name/code/organiser), debounced */}
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                      aria-hidden="true"
                    />
                    <Input
                      type="search"
                      value={examSearchInput}
                      onChange={(event) => setExamSearchInput(event.target.value)}
                      placeholder="Search by exam, code or organiser…"
                      aria-label="Search exams"
                      className="border-zinc-200 bg-white pl-9"
                    />
                  </div>

                  {/* Selected exams — removable chips pinned above the list;
                      the selection survives page changes and searches */}
                  {selectedExams.size > 0 && (
                    <div className="flex flex-wrap gap-1.5" aria-label="Your selected exams">
                      {[...selectedExams].map((slug) => {
                        const meta = examMetaBySlug.get(slug)
                        const label = meta?.name ?? slug
                        return (
                          <span
                            key={slug}
                            className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 py-0.5 pl-3 pr-1 text-xs text-emerald-900"
                          >
                            <span className="truncate font-medium">{label}</span>
                            <button
                              type="button"
                              onClick={() => toggleExam(slug)}
                              aria-label={`Remove ${label}`}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* The current page */}
                  {examLoading ? (
                    <div className="space-y-2" aria-busy="true" aria-label="Loading exams">
                      {Array.from({ length: EXAM_PAGE_SIZE }, (_, index) => (
                        <Skeleton key={index} className="h-14 w-full" />
                      ))}
                    </div>
                  ) : examError ? (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700"
                    >
                      <span>{examError}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 border-red-200 bg-white text-red-700 hover:bg-red-50"
                        onClick={() => setExamReload((current) => current + 1)}
                      >
                        Try again
                      </Button>
                    </div>
                  ) : !examResult || examResult.exams.length === 0 ? (
                    examSearch ? (
                      <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
                        No exams match “{examSearch}” — try a different search or clear it.
                      </p>
                    ) : (
                      <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
                        No active exams in this market yet — continue and pick your subjects instead.
                      </p>
                    )
                  ) : (
                    <fieldset className="space-y-2">
                      <legend className="sr-only">Goal exams</legend>
                      {examResult.exams.map((exam) => {
                        const selected = selectedExams.has(exam.slug)
                        return (
                          <button
                            key={exam.slug}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleExam(exam.slug)}
                            className={`w-full rounded-lg border p-4 text-left transition-colors ${
                              selected
                                ? 'border-emerald-400 bg-emerald-50'
                                : 'border-zinc-200 bg-white hover:border-emerald-200'
                            }`}
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span>
                                <span className="block text-sm font-semibold">{exam.name}</span>
                                <span className="mt-0.5 block text-xs text-zinc-500">
                                  {exam.organiser} · {exam.level.toLowerCase()}
                                  {exam.currentVersion ? ` · ${exam.currentVersion.label}` : ''}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
                                  {exam.code}
                                </Badge>
                                {selected && (
                                  <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                                )}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </fieldset>
                  )}

                  {/* Pagination footer — 44px touch targets */}
                  {!examError && examResult && examResult.total > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 gap-1 border-zinc-200 bg-white px-4 hover:bg-zinc-50"
                        onClick={() => setExamPage((current) => Math.max(1, current - 1))}
                        disabled={examPage <= 1 || examLoading}
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Prev
                      </Button>
                      <p className="text-center text-xs text-zinc-500" aria-live="polite">
                        Page {examPage} of {examResult.totalPages} · {examResult.total} exam
                        {examResult.total === 1 ? '' : 's'}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 gap-1 border-zinc-200 bg-white px-4 hover:bg-zinc-50"
                        onClick={() => setExamPage((current) => Math.min(examResult.totalPages, current + 1))}
                        disabled={examPage >= examResult.totalPages || examLoading}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}

                  <p className="text-xs text-zinc-500">
                    {selectedExams.size} selected — a goal exam is an intent signal for
                    personalisation, never proof you will sit the exam.
                  </p>
                </div>
              )}

              {/* ---------- Step 3 ---------- */}
              {step === 3 && (
                <div className="space-y-4">
                  {/* Group 1 — the syllabus-derived subjects (S11-B): what the
                      chosen exams' current syllabi actually carry, pre-ticked
                      with per-exam provenance chips. */}
                  {selectedExams.size > 0 && (
                    <section className="space-y-2" aria-label="Subjects from your exams' syllabus">
                      <div className="flex items-center gap-2">
                        <BookOpenCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        <h3 className="text-sm font-semibold">From your exams&rsquo; syllabus</h3>
                        {derivedLoading && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" aria-hidden="true" />
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">
                        Derived from the {selectedExams.size} exam
                        {selectedExams.size === 1 ? '' : 's'} you picked — pre-selected; untick
                        anything you do not want.
                      </p>
                      {derivedLoading ? (
                        <div className="space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50/40 p-2" aria-busy="true">
                          {Array.from({ length: 4 }, (_, index) => (
                            <Skeleton key={index} className="h-11 w-full" />
                          ))}
                        </div>
                      ) : derivedError ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                          <span>{derivedError}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                            onClick={() => void loadDerivedSubjects()}
                          >
                            Try again
                          </Button>
                        </div>
                      ) : derivedSubjects && derivedSubjects.subjects.length > 0 ? (
                        <div className="space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50/40 p-2">
                          {derivedSubjects.subjects.map((subject) => (
                            <DerivedSubjectRow
                              key={subject.slug}
                              subject={subject}
                              exams={derivedSubjects.exams}
                              selected={selectedTopics.has(subject.slug)}
                              onToggle={toggleTopic}
                            />
                          ))}
                          {derivedSubjects.skipped.length > 0 && (
                            <p className="px-1 pt-1 text-[11px] text-amber-700">
                              {derivedSubjects.skipped.length} of your exam
                              {derivedSubjects.skipped.length === 1 ? '' : 's'} contributed no
                              subjects yet (no syllabus version in effect).
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/30 px-3 py-4 text-center text-sm text-zinc-500">
                          {derivedSubjects?.note ??
                            "Your exams' syllabi carry no mapped subjects yet — browse all subjects below."}
                        </p>
                      )}
                    </section>
                  )}

                  {/* Group 2 — the full taxonomy tree behind a toggle (the
                      S11 decision: derived first, everything else on demand). */}
                  <section className="space-y-2" aria-label="All subjects">
                    <button
                      type="button"
                      onClick={() => setShowAllSubjects((current) => !current)}
                      aria-expanded={showAllSubjects}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-zinc-700 transition-colors hover:border-emerald-200 hover:text-zinc-900"
                    >
                      <span className="flex items-center gap-2">
                        <ListTree className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                        Browse all subjects
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                          showAllSubjects ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {selectedExams.size === 0 && (
                      <p className="px-1 text-xs text-zinc-500">
                        Pick goal exams in step 2 and their syllabus subjects will be pre-selected
                        here.
                      </p>
                    )}
                    {showAllSubjects &&
                      (topicLoading ? (
                        <div className="space-y-2" aria-busy="true">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-2/3" />
                        </div>
                      ) : !topicTree || topicTree.length === 0 ? (
                        <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
                          No subjects visible in this market yet.
                        </p>
                      ) : (
                        <div className="max-h-[26rem] space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2">
                          {topicTree.map((node) => (
                            <TopicNodeRow
                              key={node.slug}
                              node={node}
                              depth={0}
                              selected={selectedTopics}
                              expanded={expandedNodes}
                              onToggleSelect={toggleTopic}
                              onToggleExpand={(slug) =>
                                setExpandedNodes((current) => {
                                  const next = new Set(current)
                                  if (next.has(slug)) next.delete(slug)
                                  else next.add(slug)
                                  return next
                                })
                              }
                            />
                          ))}
                        </div>
                      ))}
                  </section>

                  <p className="text-xs text-zinc-500">
                    {selectedTopics.size}/{MAX_TOPICS} selected — selecting a domain covers the
                    domain itself; children stay selectable for narrower focus.
                  </p>
                </div>
              )}

              {/* ---------- Step 4 ---------- */}
              {step === 4 && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label>Preparation level</Label>
                    <RadioGroup value={level} onValueChange={setLevel} className="gap-2">
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm has-[button[data-state=checked]]:border-emerald-400 has-[button[data-state=checked]]:bg-emerald-50">
                        <RadioGroupItem value="BEGINNER" />
                        {LEVEL_LABELS.BEGINNER}
                      </label>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm has-[button[data-state=checked]]:border-emerald-400 has-[button[data-state=checked]]:bg-emerald-50">
                        <RadioGroupItem value="INTERMEDIATE" />
                        {LEVEL_LABELS.INTERMEDIATE}
                      </label>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm has-[button[data-state=checked]]:border-emerald-400 has-[button[data-state=checked]]:bg-emerald-50">
                        <RadioGroupItem value="ADVANCED" />
                        {LEVEL_LABELS.ADVANCED}
                      </label>
                    </RadioGroup>
                    <p className="text-xs text-zinc-500">Optional — leave unset and GKSetu stays neutral.</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="onboarding-study-language">Study language</Label>
                      <Select value={studyLanguage} onValueChange={setStudyLanguage}>
                        <SelectTrigger id="onboarding-study-language" className="w-full border-zinc-200 bg-white">
                          <SelectValue placeholder="Account default" />
                        </SelectTrigger>
                        <SelectContent>
                          {languageOptions.map((entry) => (
                            <SelectItem key={entry.code} value={entry.code}>
                              {entry.nativeName ?? entry.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="onboarding-year">Target year</Label>
                      <Select value={targetYear} onValueChange={setTargetYear}>
                        <SelectTrigger id="onboarding-year" className="w-full border-zinc-200 bg-white">
                          <SelectValue placeholder="Not sure yet" />
                        </SelectTrigger>
                        <SelectContent>
                          {YEAR_OPTIONS.map((year) => (
                            <SelectItem key={year} value={String(year)}>
                              {year}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="onboarding-minutes">Daily pace</Label>
                      <Select value={dailyMinutes} onValueChange={setDailyMinutes}>
                        <SelectTrigger id="onboarding-minutes" className="w-full border-zinc-200 bg-white">
                          <SelectValue placeholder="No target" />
                        </SelectTrigger>
                        <SelectContent>
                          {DAILY_OPTIONS.map((minutes) => (
                            <SelectItem key={minutes} value={String(minutes)}>
                              {minutes} min/day
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Review */}
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
                    <p className="font-medium">Ready to save</p>
                    <ul className="mt-2 space-y-1 text-zinc-600">
                      <li>
                        Market:{' '}
                        <span className="font-medium text-zinc-900">
                          {currentCountry?.name ?? (selectionCountryIso || '—')}
                        </span>
                      </li>
                      <li>
                        Exams:{' '}
                        <span className="font-medium text-zinc-900">{selectedExams.size}</span>
                        {selectedExams.size > 0 && (
                          <span className="text-zinc-500">
                            {' '}
                            ({[...selectedExams]
                              .slice(0, 3)
                              .map((slug) => examMetaBySlug.get(slug)?.name ?? slug)
                              .join(', ')}
                            {selectedExams.size > 3 ? '…' : ''})
                          </span>
                        )}
                      </li>
                      <li>
                        Subjects: <span className="font-medium text-zinc-900">{selectedTopics.size}</span>
                      </li>
                      <li>
                        Level:{' '}
                        <span className="font-medium text-zinc-900">
                          {level ? LEVEL_LABELS[level].split(' — ')[0] : 'unset'}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {/* ---------- Controls ---------- */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-zinc-500 hover:text-zinc-900"
                  onClick={() => void skipFlow()}
                  disabled={busy !== null}
                >
                  {busy === 'skip' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Skip for now
                </Button>
                <div className="flex items-center gap-2">
                  {step > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-zinc-200 bg-white"
                      onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)}
                      disabled={busy !== null}
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      Back
                    </Button>
                  )}
                  {step < 4 ? (
                    <Button
                      size="sm"
                      className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => {
                        if (step === 1) void saveBasicsAndContinue()
                        else if (step === 2) goToTopics()
                        else setStep(4)
                      }}
                      disabled={busy !== null}
                    >
                      {busy === 'patch' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Continue
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => void submitGoal()}
                      disabled={busy !== null}
                    >
                      {busy === 'goal' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Save my goal
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}

// ---------- The derived-subject row (S11-B — provenance-chipped) ----------

function DerivedSubjectRow({
  subject,
  exams,
  selected,
  onToggle,
}: {
  subject: ApiDerivedSubject
  /** The resolved contributing exams (slug → chip name/code). */
  exams: Array<{ slug: string; name: string; code: string }>
  selected: boolean
  onToggle: (slug: string) => void
}) {
  const examBySlug = new Map(exams.map((exam) => [exam.slug, exam]))
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={() => onToggle(subject.slug)}
      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? 'border-emerald-400 bg-white'
          : 'border-zinc-200 bg-white hover:border-emerald-300'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            selected ? 'border-emerald-600 bg-emerald-600' : 'border-zinc-300 bg-white'
          }`}
          aria-hidden="true"
        >
          {selected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
        </span>
        <span className="truncate font-medium text-zinc-800">{subject.label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {subject.examSlugs.slice(0, 3).map((slug) => {
          const exam = examBySlug.get(slug)
          return (
            <Badge
              key={slug}
              variant="outline"
              title={exam?.name ?? slug}
              className="font-mono text-[10px] font-normal text-zinc-500"
            >
              {exam?.code ?? slug}
            </Badge>
          )
        })}
        {subject.examSlugs.length > 3 && (
          <span className="text-[10px] text-zinc-400">+{subject.examSlugs.length - 3}</span>
        )}
      </span>
    </button>
  )
}

// ---------- Topic tree row (§13 — one canonical framework) ----------

function TopicNodeRow({
  node,
  depth,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: {
  node: ApiTopicNode
  depth: number
  selected: Set<string>
  expanded: Set<string>
  onToggleSelect: (slug: string) => void
  onToggleExpand: (slug: string) => void
}) {
  const isSelected = selected.has(node.slug)
  const isExpanded = expanded.has(node.slug)
  const hasChildren = node.childCount > 0

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-zinc-50"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.slug)}
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            aria-expanded={isExpanded}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-700"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          onClick={() => onToggleSelect(node.slug)}
          className={`flex min-h-[40px] flex-1 items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
            isSelected
              ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
              : 'border-transparent hover:border-zinc-200'
          }`}
        >
          <span className="truncate font-medium">{node.label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {node.scope === 'COUNTRY' && (
              <Badge variant="outline" className="text-[10px] font-normal text-zinc-400">
                {node.countryIso ?? ''}
              </Badge>
            )}
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                isSelected ? 'border-emerald-600 bg-emerald-600' : 'border-zinc-300 bg-white'
              }`}
              aria-hidden="true"
            >
              {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
            </span>
          </span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TopicNodeRow
              key={child.slug}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}
