'use client'

/**
 * GKSetu — the Profile view (P5-S3, redesigned SITE-S4-B).
 *
 * The user's account surface: profile basics (name, home country, preferred
 * language), the declared learning goal (level, study language, target year,
 * daily pace, exams, subjects) with edit/remove, and the personalisation
 * links (Following / Saved / Settings). Review, change or remove anything —
 * a private authenticated surface: noindex, signed-out gate.
 *
 * SITE-S4 redesign: user-relevant information only — no onboarding badges,
 * no declared/updated metadata lines; honest statuses on goal objects
 * collapse to a subtle plain-word note.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  GraduationCap,
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type { ApiCountry, Envelope } from '@/components/home/types'
import { LEVEL_LABELS, type ApiGoal, type ApiProfile } from './types'

// ---------- Props ----------

export interface ProfileViewProps {
  onGoHome: () => void
  onGoOnboarding: () => void
  onSignIn: () => void
  /** Opens the exam page in the exam's own market — the follow-view precedent. */
  onOpenExam: (slug: string, countryIso: string) => void
  /** Opens the topic hub — countryIso null = GLOBAL topic in the current market. */
  onOpenTopic: (slug: string, countryIso: string | null) => void
}

// ---------- Helpers ----------

/** §36 honesty in plain words: non-active goal objects stay listed, quietly noted. */
const STATUS_NOTES: Record<string, string> = {
  RETIRED: 'retired',
  INACTIVE: 'currently unavailable',
  DRAFT: 'not public yet',
}

/** A short label for a goal level value (plain words, no dash tail). */
function levelLabel(level: string): string {
  return LEVEL_LABELS[level]?.split(' — ')[0] ?? level
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

  // Goal removal (two-step confirm)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [removingGoal, setRemovingGoal] = useState(false)

  // A private authenticated surface — never indexed.
  useSeoHead({
    title: 'Your profile | GKSetu',
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
  // (e.g. onboarding completed elsewhere) — the client never guesses.
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
          description: 'Your declared goal is gone. Follows and saves are untouched.',
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

  // ---------- Signed-out gate ----------

  if (status !== 'authenticated' || !user) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <UserRound className="h-5 w-5 text-emerald-600" />
            </span>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold tracking-tight">Your profile</h1>
              <p className="mx-auto max-w-sm text-sm text-zinc-500">
                Your basics, your learning goal and your data controls — sign in to manage them.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button onClick={onSignIn} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Button>
              <Button variant="outline" className="border-zinc-200 bg-white" onClick={onGoHome}>
                Back to the homepage
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  const currentCountry = config?.find((entry) => entry.isoCode === countryIso) ?? null
  const goal: ApiGoal | null = profile?.goal ?? null

  return (
    <div className="space-y-8">
      {/* ---------- Header ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {user.name ?? user.email}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            {user.email} — review, change or remove anything below.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-9 gap-2 border-zinc-200 bg-white"
          onClick={() => void fetchProfile()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </motion.div>

      {loading && !profile ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your profile">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
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
              <CardDescription>Your name, home country and preferred language.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                <p className="max-w-xl text-xs text-zinc-500">
                  Changing your home country never deletes data — goal exams from another market
                  stay listed, and future goal edits follow the new market.
                </p>
                <Button
                  className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void saveBasics()}
                  disabled={savingBasics}
                >
                  {savingBasics && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ---------- Learning goal ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Your learning goal
              </CardTitle>
              <CardDescription>
                What you&apos;re preparing for — it shapes your dashboard and revision plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!goal ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
                  <Target className="mx-auto h-6 w-6 text-zinc-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-zinc-700">No goal declared yet</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Declare which exams and subjects you are preparing for — it takes two minutes.
                  </p>
                  <Button
                    className="mt-4 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={onGoOnboarding}
                  >
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                    Declare your goal
                  </Button>
                </div>
              ) : (
                <>
                  {/* One compact line per preference */}
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {goal.level && (
                      <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-2">
                        <dt className="text-xs text-zinc-500">Level</dt>
                        <dd className="text-sm font-medium text-zinc-900">{levelLabel(goal.level)}</dd>
                      </div>
                    )}
                    {goal.studyLanguage && (
                      <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-2">
                        <dt className="text-xs text-zinc-500">Study language</dt>
                        <dd className="text-sm font-medium text-zinc-900">{goal.studyLanguage.name}</dd>
                      </div>
                    )}
                    {goal.targetYear && (
                      <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-2">
                        <dt className="text-xs text-zinc-500">Target year</dt>
                        <dd className="text-sm font-medium text-zinc-900">{goal.targetYear}</dd>
                      </div>
                    )}
                    {goal.dailyMinutes && (
                      <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-2">
                        <dt className="text-xs text-zinc-500">Daily pace</dt>
                        <dd className="text-sm font-medium text-zinc-900">{goal.dailyMinutes} min/day</dd>
                      </div>
                    )}
                  </dl>

                  {/* Exams */}
                  <div>
                    <p className="text-xs font-medium text-zinc-500">
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
                                className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left transition-colors hover:border-emerald-300"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">{exam.name}</span>
                                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                                    {exam.organiser}
                                    {note && <span className="text-zinc-400"> · {note}</span>}
                                  </span>
                                </span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  {/* Subjects */}
                  <div>
                    <p className="text-xs font-medium text-zinc-500">
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
                                className="inline-flex min-h-[36px] max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                              >
                                <span className="truncate">{topic.label}</span>
                                {note && <span className="font-normal text-zinc-400">· {note}</span>}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
                    <p className="text-xs text-zinc-500">
                      Editing replaces the whole goal — exams, subjects and preferences together.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        className="h-9 gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
                        onClick={onGoOnboarding}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Edit goal
                      </Button>
                      {confirmingRemoval ? (
                        <span className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            className="h-9 text-zinc-500"
                            onClick={() => setConfirmingRemoval(false)}
                            disabled={removingGoal}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="outline"
                            className="h-9 gap-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            onClick={() => void removeGoal()}
                            disabled={removingGoal}
                          >
                            {removingGoal && (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            )}
                            Confirm removal
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          className="h-9 gap-2 text-zinc-500 hover:text-red-700"
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

          {/* ---------- Personalisation links ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">More of your data</CardTitle>
              <CardDescription>
                Everything else you&apos;ve told GKSetu — each page is reviewable and reversible.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <a
                href="/following"
                className="flex min-h-[44px] items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-300"
              >
                <Rss className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Following</span>
                  <span className="block text-xs text-zinc-500">Followed exams and subjects</span>
                </span>
              </a>
              <a
                href="/saved"
                className="flex min-h-[44px] items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-300"
              >
                <Bookmark className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Saved</span>
                  <span className="block text-xs text-zinc-500">Your bookmarked items</span>
                </span>
              </a>
              <a
                href="/personalisation"
                className="flex min-h-[44px] items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-300"
              >
                <Settings2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Settings</span>
                  <span className="block text-xs text-zinc-500">What shapes your GKSetu</span>
                </span>
              </a>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
