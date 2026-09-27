'use client'

/**
 * GlobIQ — the Following view (P5-S1, #/following)
 * Master Plan §9 (explicit signals, reversible), §10 (follow vs save),
 * §11 note (followed exams feed the combined queue from P5-S4), §31 (the
 * account-control surface over followed data — review and unfollow), §16
 * (private authenticated surface: noindex, never in the sitemap).
 *
 * Lists the signed-in user's followed exams and topics with their honest
 * current state (§36 — a RETIRED object stays listed with its status), each
 * linking into the app in its own market (§14), plus one-click unfollow.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BellOff,
  BellRing,
  BookOpen,
  CalendarClock,
  GraduationCap,
  Loader2,
  LogIn,
  RefreshCw,
  Rss,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type {
  ApiFollow,
  ApiFollowList,
  ApiFollowedExam,
  ApiFollowedTopic,
  FollowEnvelope,
} from './types'

// ---------- Props ----------

export interface FollowingViewProps {
  /** Opens the exam page in the exam's own market (§14). */
  onOpenExam: (slug: string, countryIso: string) => void
  /** Opens the topic hub — countryIso null = GLOBAL topic in the current market. */
  onOpenTopic: (slug: string, countryIso: string | null) => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- Type guards (narrow the object union per section) ----------

type ExamFollow = ApiFollow & { objectType: 'EXAM'; object: ApiFollowedExam }
type TopicFollow = ApiFollow & { objectType: 'TOPIC'; object: ApiFollowedTopic }

const isExamFollow = (item: ApiFollow): item is ExamFollow => item.objectType === 'EXAM'
const isTopicFollow = (item: ApiFollow): item is TopicFollow => item.objectType === 'TOPIC'

// ---------- Helpers ----------

function formatFollowedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** §36 honesty: retired/withdrawn followed objects stay listed with a note. */
const STATUS_NOTES: Record<string, { label: string; className: string }> = {
  RETIRED: { label: 'Retired — no longer maintained', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  INACTIVE: { label: 'Temporarily unavailable', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  DRAFT: { label: 'Not public yet', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}

// ---------- Component ----------

export function FollowingView({ onOpenExam, onOpenTopic, onGoHome, onSignIn }: FollowingViewProps) {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiFollowList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Following | GlobIQ',
    description: 'Your followed exams and topics — the personalisation signals behind your GlobIQ feed.',
    noindex: true,
  })

  const fetchList = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/follows', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as FollowEnvelope<ApiFollowList>
      if (payload.status === 'ok' && payload.data) {
        setData(payload.data)
      } else {
        setError(payload.error?.message ?? 'Could not load your follows')
      }
    } catch {
      setError('Could not reach the follow service')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const unfollow = useCallback(
    async (follow: ApiFollow) => {
      if (!token || removingId) return
      setRemovingId(follow.id)
      try {
        const response = await fetch(`/api/follows/${encodeURIComponent(follow.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as FollowEnvelope<{ removed: boolean }>
        if (payload.status === 'ok') {
          setData((current) =>
            current
              ? {
                  items: current.items.filter((item) => item.id !== follow.id),
                  counts: {
                    total: Math.max(0, current.counts.total - 1),
                    EXAM: current.counts.EXAM - (follow.objectType === 'EXAM' ? 1 : 0),
                    TOPIC: current.counts.TOPIC - (follow.objectType === 'TOPIC' ? 1 : 0),
                  },
                }
              : current
          )
          toast({ title: `Unfollowed ${follow.object.kind === 'EXAM' ? follow.object.name : follow.object.label}` })
        } else {
          toast({
            title: 'Could not unfollow',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({
          title: 'Network error',
          description: 'Could not reach the follow service. Please retry.',
          variant: 'destructive',
        })
      } finally {
        setRemovingId(null)
      }
    },
    [token, removingId, toast]
  )

  // ---------- Signed-out state (§38: one auth surface) ----------

  if (status !== 'authenticated' || !user) {
    return (
      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rss className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Your follows live behind sign-in
          </CardTitle>
          <CardDescription>
            Following exams and topics is how GlobIQ learns what to surface for you — the combined
            queue, feeds and dashboard all build on your follows (§9/§10/§11).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Sign in to see your follows
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 text-zinc-500" onClick={onGoHome}>
            Browse GlobIQ instead
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  const exams = data?.items.filter(isExamFollow) ?? []
  const topics = data?.items.filter(isTopicFollow) ?? []

  return (
    <div className="space-y-8">
      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="following-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Personalisation</Badge>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            §9 — explicit signals, reversible
          </Badge>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="following-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Following
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              The exams and topics you follow — the signals that will drive your combined-exam
              queue and dashboard (§11; the personalised feed lands in P5-S4).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
            onClick={() => void fetchList()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold">{data.counts.EXAM}</strong>
              <span className="text-zinc-500">exams</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold">{data.counts.TOPIC}</strong>
              <span className="text-zinc-500">topics</span>
            </span>
          </div>
        )}
      </motion.section>

      {/* ---------- Loading ---------- */}
      {loading && !data && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your follows">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      {/* ---------- Error ---------- */}
      {error && (
        <Card className="border-red-200 bg-red-50/60">
          <CardHeader>
            <CardTitle className="text-base text-red-800">Could not load your follows</CardTitle>
            <CardDescription className="text-red-700">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
              onClick={() => void fetchList()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---------- Empty state ---------- */}
      {data && data.counts.total === 0 && (
        <Card className="border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellOff className="h-5 w-5 text-zinc-400" aria-hidden="true" />
              Nothing followed yet
            </CardTitle>
            <CardDescription>
              Open an exam page (e.g. UPSC Civil Services) or any GK topic hub and press
              “Follow”. Follows are personalisation signals — they shape what GlobIQ surfaces
              for you, and you can unfollow anytime (§9).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onGoHome}>
              Browse exams and topics
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---------- Exams ---------- */}
      {exams.length > 0 && (
        <section aria-labelledby="following-exams-heading" className="space-y-3">
          <h2 id="following-exams-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <GraduationCap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Followed exams
            <span className="text-sm font-normal text-zinc-400">({exams.length})</span>
          </h2>
          <ul className="space-y-3">
            {exams.map((follow) => {
              const exam = follow.object
              const statusNote = STATUS_NOTES[exam.status]
              return (
                <li key={follow.id}>
                  <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenExam(exam.slug, exam.countryIso)}
                          className="min-h-[32px] text-left"
                        >
                          <span className="block truncate font-semibold text-zinc-900 hover:text-emerald-700">
                            {exam.name}
                          </span>
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                          <Badge variant="outline" className="border-zinc-200 bg-white font-mono text-[10px] font-normal text-zinc-500">
                            {exam.code}
                          </Badge>
                          <span className="uppercase tracking-wide">{exam.level.toLowerCase()}</span>
                          <span aria-hidden="true">·</span>
                          <span>{exam.organiser}</span>
                          <span aria-hidden="true">·</span>
                          <span>{exam.countryIso}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                          <CalendarClock className="h-3 w-3" aria-hidden="true" />
                          <span>followed {formatFollowedAt(follow.followedAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{exam.canonicalPath}</span>
                        </div>
                        {statusNote && (
                          <Badge variant="outline" className={`mt-2 text-[10px] font-normal ${statusNote.className}`}>
                            {statusNote.label}
                          </Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                          disabled={removingId === follow.id}
                          onClick={() => void unfollow(follow)}
                          aria-label={`Unfollow ${exam.name}`}
                        >
                          {removingId === follow.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                          Unfollow
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ---------- Topics ---------- */}
      {topics.length > 0 && (
        <section aria-labelledby="following-topics-heading" className="space-y-3">
          <h2 id="following-topics-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BookOpen className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Followed topics
            <span className="text-sm font-normal text-zinc-400">({topics.length})</span>
          </h2>
          <ul className="space-y-3">
            {topics.map((follow) => {
              const topic = follow.object
              const statusNote = STATUS_NOTES[topic.status]
              return (
                <li key={follow.id}>
                  <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenTopic(topic.slug, topic.countryIso)}
                          className="min-h-[32px] text-left"
                        >
                          <span className="block truncate font-semibold text-zinc-900 hover:text-emerald-700">
                            {topic.label}
                          </span>
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                          <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal uppercase tracking-wide text-zinc-500">
                            {topic.type.toLowerCase()}
                          </Badge>
                          <span>
                            {topic.scope === 'COUNTRY' ? `${topic.countryIso ?? ''}-scoped` : 'global'}
                          </span>
                          {topic.labelLanguage === 'canonical' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>canonical name</span>
                            </>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                          <CalendarClock className="h-3 w-3" aria-hidden="true" />
                          <span>followed {formatFollowedAt(follow.followedAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{topic.canonicalPath}</span>
                        </div>
                        {statusNote && (
                          <Badge variant="outline" className={`mt-2 text-[10px] font-normal ${statusNote.className}`}>
                            {statusNote.label}
                          </Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                          disabled={removingId === follow.id}
                          onClick={() => void unfollow(follow)}
                          aria-label={`Unfollow ${topic.label}`}
                        >
                          {removingId === follow.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                          Unfollow
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ---------- Footer note (§10 boundary) ---------- */}
      {data && data.counts.total > 0 && (
        <p className="flex items-start gap-2 text-xs text-zinc-400">
          <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Follows are personalisation signals (feed, notifications, recommendations — §10), not
          bookmarks: saving into collections arrives in P5-S2 as a deliberately separate concept.
        </p>
      )}
    </div>
  )
}
