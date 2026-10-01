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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  ListChecks,
  Loader2,
  LogIn,
  Sparkles,
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
  type ApiExamOption,
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

  // Step 2 — goal exams (slugs)
  const [examOptions, setExamOptions] = useState<ApiExamOption[] | null>(null)
  const [examLoading, setExamLoading] = useState(false)
  const [selectedExams, setSelectedExams] = useState<Set<string>>(new Set())

  // Step 3 — goal subjects (slugs)
  const [topicTree, setTopicTree] = useState<ApiTopicNode[] | null>(null)
  const [topicLoading, setTopicLoading] = useState(false)
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

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

  const loadExams = useCallback(async (iso: string) => {
    setExamLoading(true)
    try {
      const params = new URLSearchParams({ country: iso, pageSize: '300' })
      const response = await fetch(`/api/exams?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ exams: ApiExamOption[] }>
      setExamOptions(payload.status === 'ok' && payload.data ? payload.data.exams : [])
    } catch {
      setExamOptions([])
    } finally {
      setExamLoading(false)
    }
  }, [])

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

  // ---------- Step transitions ----------

  const goToExams = useCallback(() => {
    setStepError(null)
    if (!countryIso.trim()) {
      setStepError('Pick your home country — GKSetu personalises by your market.')
      return
    }
    setStep(2)
    void loadExams(countryIso.trim())
  }, [countryIso, loadExams])

  const goToTopics = useCallback(() => {
    setStep(3)
    void loadTopics(countryIso.trim(), languageCode)
  }, [countryIso, languageCode, loadTopics])

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
    setStep(2)
    void loadExams(countryIso.trim())
  }, [token, profile, name, countryIso, languageCode, loadExams, toast])

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
                {step === 2 && `Active exams in ${currentCountry?.name ?? 'your market'} — pick any number (or none yet).`}
                {step === 3 && `Global subjects and your country's own. Up to ${MAX_TOPICS}.`}
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
                  {examLoading ? (
                    <div className="space-y-2" aria-busy="true">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  ) : !examOptions || examOptions.length === 0 ? (
                    <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
                      No active exams in this market yet — continue and pick your subjects instead.
                    </p>
                  ) : (
                    <fieldset className="space-y-2">
                      <legend className="sr-only">Goal exams</legend>
                      {examOptions.map((exam) => {
                        const selected = selectedExams.has(exam.slug)
                        return (
                          <button
                            key={exam.slug}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setSelectedExams((current) => {
                                const next = new Set(current)
                                if (next.has(exam.slug)) next.delete(exam.slug)
                                else next.add(exam.slug)
                                return next
                              })
                            }
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
                  <p className="text-xs text-zinc-500">
                    {selectedExams.size} selected — a goal exam is an intent signal for
                    personalisation, never proof you will sit the exam.
                  </p>
                </div>
              )}

              {/* ---------- Step 3 ---------- */}
              {step === 3 && (
                <div className="space-y-3">
                  {topicLoading ? (
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
                          onToggleSelect={(slug) =>
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
                          }
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
                  )}
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
                            ({[...selectedExams].slice(0, 3).join(', ')}
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
