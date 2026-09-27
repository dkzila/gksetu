'use client'

/**
 * GlobIQ — the Profile view (P5-S3, #/profile)
 * Master Plan §6 (User personalisation dimensions + UserGoal/Profile), §9
 * (explicit signals, changeable at any time), §31 (the account-control
 * surface over personal data — review, edit, remove; no silent destruction),
 * §36 (honest statuses on every goal object), §16 (private authenticated
 * surface: noindex, never in the sitemap).
 *
 * The ongoing management surface: profile basics (name, home country,
 * preferred language — the same §35 rules registration enforces), the
 * declared goal (exams/subjects with §16 paths, level, study language,
 * preferences), the onboarding state, and the personalisation data map
 * (controls, following and saved all one click away — P5-S5).
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  GraduationCap,
  Languages,
  Loader2,
  LogIn,
  MapPin,
  Pencil,
  RefreshCw,
  Rss,
  Bookmark,
  Settings2,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type { ApiCountry, Envelope } from '@/components/home/types'
import { LEVEL_LABELS, ONBOARDING_COPY, type ApiGoal, type ApiProfile } from './types'

// ---------- Props ----------

export interface ProfileViewProps {
  onGoHome: () => void
  onGoOnboarding: () => void
  onSignIn: () => void
  /** Opens the exam page in the exam's own market (§14) — the follow-view precedent. */
  onOpenExam: (slug: string, countryIso: string) => void
  /** Opens the topic hub — countryIso null = GLOBAL topic in the current market. */
  onOpenTopic: (slug: string, countryIso: string | null) => void
}

// ---------- Helpers ----------

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** §36 honesty: non-active goal objects stay listed with a note. */
const STATUS_NOTES: Record<string, { label: string; className: string }> = {
  RETIRED: { label: 'Retired', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  INACTIVE: { label: 'Unavailable', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  DRAFT: { label: 'Not public yet', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}

// ---------- Component ----------

export function ProfileView({ onGoHome, onGoOnboarding, onSignIn, onOpenExam, onOpenTopic }: ProfileViewProps) {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [config, setConfig] = useState<ApiCountry[] | null>(null)
  const [profile, setProfile] = useState<ApiProfile | null>(null)
  const [loading, setLoading] = useState(false)

  // Profile basics form
  const [name, setName] = useState('')
  const [countryIso, setCountryIso] = useState('')
  const [languageCode, setLanguageCode] = useState('')
  const [savingBasics, setSavingBasics] = useState(false)
  const [basicsError, setBasicsError] = useState<string | null>(null)

  // Goal removal (two-step confirm, §31)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [removingGoal, setRemovingGoal] = useState(false)

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Your profile | GlobIQ',
    description: 'Your profile, declared learning goal and personalisation data controls.',
    noindex: true,
  })

  // ---------- Data ----------

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        if (payload.status === 'ok' && payload.data) setConfig(payload.data.countries)
      })
      .catch(() => undefined)
  }, [])

  const fetchProfile = useCallback(async () => {
    if (!token) {
      setProfile(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<ApiProfile>
      if (payload.status === 'ok' && payload.data) {
        setProfile(payload.data)
        setName(payload.data.user.name ?? '')
        setCountryIso(payload.data.user.homeCountry?.isoCode ?? '')
        setLanguageCode(payload.data.user.preferredLanguage?.code ?? '')
      } else {
        toast({
          title: 'Could not load your profile',
          description: payload.error?.message,
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/profile.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile])

  // Prefill from the auth store whenever the server-side user changes
  // (e.g. onboarding completed elsewhere) — §30: the client never guesses.
  useEffect(() => {
    if (user && profile) {
      setProfile((current) =>
        current && current.user.onboardingStatus !== user.onboardingStatus
          ? { ...current, user: { ...current.user, onboardingStatus: user.onboardingStatus } }
          : current
      )
    }
  }, [user, profile])

  const saveBasics = useCallback(async () => {
    if (!token || !profile) return
    setBasicsError(null)
    const body: Record<string, string | null> = {}
    if (name.trim() !== (profile.user.name ?? '')) body.name = name.trim() || null
    if (countryIso !== (profile.user.homeCountry?.isoCode ?? '')) body.homeCountryIso = countryIso || null
    if (languageCode !== (profile.user.preferredLanguage?.code ?? '')) {
      body.preferredLanguageCode = languageCode || null
    }
    if (Object.keys(body).length === 0) {
      toast({ title: 'Nothing to update', description: 'Your basics are already up to date.' })
      return
    }
    setSavingBasics(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as Envelope<{ user: ApiProfile['user'] }>
      if (payload.status === 'ok' && payload.data) {
        setProfile((current) => (current ? { ...current, user: payload.data!.user } : current))
        await useAuth.getState().refreshUser()
        toast({ title: 'Profile saved', description: 'Your basics are up to date.' })
      } else {
        setBasicsError(payload.error?.message ?? 'Could not save your profile')
      }
    } catch {
      setBasicsError('Network error — could not save your profile')
    } finally {
      setSavingBasics(false)
    }
  }, [token, profile, name, countryIso, languageCode, toast])

  const removeGoal = useCallback(async () => {
    if (!token) return
    setRemovingGoal(true)
    try {
      const response = await fetch('/api/goal', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as Envelope<{ removed: boolean }>
      if (payload.status === 'ok') {
        setProfile((current) => (current ? { ...current, goal: null } : current))
        toast({
          title: 'Goal removed',
          description: 'Your declared goal is gone. Follows and saves are untouched (§31).',
        })
      } else {
        toast({
          title: 'Could not remove your goal',
          description: payload.error?.message,
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setRemovingGoal(false)
      setConfirmingRemoval(false)
    }
  }, [token, toast])

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
              <UserRound className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Your profile
            </CardTitle>
            <CardDescription>
              Profile basics, your declared learning goal and your personalisation data controls
              (§31). Sign in to manage them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={onSignIn} className="bg-emerald-600 text-white hover:bg-emerald-700">
              <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign in to continue
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  const onboarding = profile?.user.onboardingStatus ?? user.onboardingStatus
  const statusCopy = ONBOARDING_COPY[onboarding] ?? ONBOARDING_COPY.PENDING
  const currentCountry = config?.find((entry) => entry.isoCode === countryIso) ?? null
  const goal: ApiGoal | null = profile?.goal ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* ---------- Header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Your profile</Badge>
            <Badge variant="outline" className={statusCopy.className}>
              {statusCopy.label}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {user.name ?? user.email}
          </h1>
          <p className="text-sm text-zinc-600">
            {user.email} · personalisation data you control (§31) — review, change or remove
            anything below.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
          onClick={() => void fetchProfile()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {loading && !profile ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your profile">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* ---------- Profile basics ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Profile basics
              </CardTitle>
              <CardDescription>
                Your name, home market and preferred language — the same §35 rules registration
                enforces, editable anytime.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="profile-name">Name</Label>
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-country">Home country</Label>
                  <Select value={countryIso} onValueChange={setCountryIso}>
                    <SelectTrigger id="profile-country" className="w-full border-zinc-200 bg-white">
                      <SelectValue placeholder="None" />
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
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-language">Preferred language</Label>
                  <Select value={languageCode} onValueChange={setLanguageCode}>
                    <SelectTrigger id="profile-language" className="w-full border-zinc-200 bg-white">
                      <SelectValue placeholder="Market default" />
                    </SelectTrigger>
                    <SelectContent>
                      {(currentCountry?.languages ?? []).map((entry) => (
                        <SelectItem key={entry.code} value={entry.code}>
                          {entry.nativeName ?? entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {basicsError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {basicsError}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Changing your home country never deletes data — goal exams from another market
                  stay listed with an honest note (§31/§36), and future goal edits follow the new
                  market (§14).
                </p>
                <Button
                  size="sm"
                  className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void saveBasics()}
                  disabled={savingBasics}
                >
                  {savingBasics && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Save basics
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ---------- Declared goal ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Your learning goal
              </CardTitle>
              <CardDescription>
                The explicit signal behind your personalisation (§9) — declared exams, subjects,
                level and pace. A goal drives personalisation only; it is never proof you will sit
                an exam.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!goal ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
                  <Target className="mx-auto h-6 w-6 text-zinc-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-zinc-700">No goal declared yet</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Declare which exams and subjects you are preparing for — GlobIQ personalises
                    around it.
                  </p>
                  <Button
                    size="sm"
                    className="mt-4 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={onGoOnboarding}
                  >
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                    Declare your goal
                  </Button>
                </div>
              ) : (
                <>
                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {goal.level && (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                        {LEVEL_LABELS[goal.level]?.split(' — ')[0] ?? goal.level}
                      </Badge>
                    )}
                    {goal.studyLanguage && (
                      <Badge variant="outline" className="gap-1 border-zinc-200 bg-white text-zinc-600">
                        <Languages className="h-3 w-3" aria-hidden="true" />
                        {goal.studyLanguage.name}
                      </Badge>
                    )}
                    {goal.targetYear && (
                      <Badge variant="outline" className="gap-1 border-zinc-200 bg-white text-zinc-600">
                        <CalendarClock className="h-3 w-3" aria-hidden="true" />
                        Target {goal.targetYear}
                      </Badge>
                    )}
                    {goal.dailyMinutes && (
                      <Badge variant="outline" className="gap-1 border-zinc-200 bg-white text-zinc-600">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {goal.dailyMinutes} min/day
                      </Badge>
                    )}
                  </div>

                  {/* Exams */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Exams ({goal.counts.exams})
                    </p>
                    {goal.exams.length === 0 ? (
                      <p className="mt-2 text-sm text-zinc-500">No exams declared.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {goal.exams.map((exam) => {
                          const note = STATUS_NOTES[exam.status]
                          return (
                            <li key={exam.slug}>
                              <button
                                type="button"
                                onClick={() => onOpenExam(exam.slug, exam.countryIso)}
                                className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left transition-colors hover:border-emerald-300"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">{exam.name}</span>
                                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                                    {exam.organiser} · {exam.code}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  {note && (
                                    <Badge variant="outline" className={note.className}>
                                      {note.label}
                                    </Badge>
                                  )}
                                  <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  {/* Subjects */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Subjects ({goal.counts.topics})
                    </p>
                    {goal.topics.length === 0 ? (
                      <p className="mt-2 text-sm text-zinc-500">No subjects declared.</p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {goal.topics.map((topic) => {
                          const note = STATUS_NOTES[topic.status]
                          return (
                            <li key={topic.slug}>
                              <button
                                type="button"
                                onClick={() => onOpenTopic(topic.slug, topic.countryIso)}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                              >
                                <span className="truncate">{topic.label}</span>
                                {note && (
                                  <span className={`rounded-full border px-1.5 text-[10px] ${note.className}`}>
                                    {note.label}
                                  </span>
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  <Separator />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500">
                      Declared {formatWhen(goal.declaredAt)} · updated {formatWhen(goal.updatedAt)} ·
                      goal edits replace it wholesale (§9).
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
                        onClick={onGoOnboarding}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Edit goal
                      </Button>
                      {confirmingRemoval ? (
                        <span className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-zinc-500"
                            onClick={() => setConfirmingRemoval(false)}
                            disabled={removingGoal}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            onClick={() => void removeGoal()}
                            disabled={removingGoal}
                          >
                            {removingGoal && (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            )}
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Confirm removal
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2 text-zinc-500 hover:text-red-700"
                          onClick={() => setConfirmingRemoval(true)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Remove goal
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ---------- Onboarding state ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Setup status
              </CardTitle>
              <CardDescription>
                The guided flow stays reachable forever — re-run it whenever your goal changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-600">
                {onboarding === 'COMPLETED' && 'Setup completed' }
                {onboarding === 'COMPLETED' && profile?.user.onboardingCompletedAt && (
                  <span className="text-zinc-500"> · {formatWhen(profile.user.onboardingCompletedAt)}</span>
                )}
                {onboarding === 'SKIPPED' && 'Setup skipped — declare a goal whenever you are ready.'}
                {onboarding === 'PENDING' && 'Setup pending — a two-minute guided flow personalises GlobIQ for you.'}
                {onboarding === 'IN_PROGRESS' && 'Setup in progress — pick up where you left off.'}
              </p>
              <Button
                size="sm"
                variant={onboarding === 'COMPLETED' ? 'outline' : 'default'}
                className={
                  onboarding === 'COMPLETED'
                    ? 'gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700'
                    : 'gap-2 bg-emerald-600 text-white hover:bg-emerald-700'
                }
                onClick={onGoOnboarding}
              >
                <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
                {onboarding === 'COMPLETED' ? 'Re-run the flow' : 'Open the flow'}
              </Button>
            </CardContent>
          </Card>

          {/* ---------- Personalisation data map (§31) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Your personalisation data
              </CardTitle>
              <CardDescription>
                Everything GlobIQ stores about you is reviewable and reversible (§31) — every
                signal, its effect and its control lives on one page.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <a
                href="#/personalisation"
                className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 transition-colors hover:border-emerald-400"
              >
                <Settings2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Personalisation controls</span>
                  <span className="block text-xs text-zinc-500">
                    Why you see what you see — review every signal, reset anytime
                  </span>
                </span>
              </a>
              <a
                href="#/following"
                className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-300"
              >
                <Rss className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Following</span>
                  <span className="block text-xs text-zinc-500">
                    Followed exams and topics — your feed signals
                  </span>
                </span>
              </a>
              <a
                href="#/saved"
                className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-300"
              >
                <Bookmark className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Saved</span>
                  <span className="block text-xs text-zinc-500">
                    Bookmarked knowledge and collections — retrieval, never recommendations
                  </span>
                </span>
              </a>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
