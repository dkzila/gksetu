'use client'

/**
 * GKSetu — the Following view (P5-S1, /following; SITE-S4-A redesign)
 * Master Plan §9 (explicit signals, reversible), §10 (follow vs save),
 * §11 note (followed exams feed the combined queue), §31 (the
 * account-control surface over followed data — review and unfollow), §16
 * (private authenticated surface: noindex, never in the sitemap).
 *
 * SITE-S4-A: one compact redesign — a single header + one-liner, section
 * headings with live counts, and clean rows: name, the one plain-words
 * detail line that matters, unfollow. No exam codes, levels, ISO codes or
 * raw type badges — honest plain-language status notes only.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Building2,
  GraduationCap,
  Lightbulb,
  Loader2,
  LogIn,
  MapPin,
  RefreshCw,
  Rss,
  Trash2,
  User,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type {
  ApiFollow,
  ApiFollowList,
  ApiFollowedExam,
  ApiFollowedEntity,
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
type EntityFollow = ApiFollow & { objectType: 'ENTITY'; object: ApiFollowedEntity }

const isExamFollow = (item: ApiFollow): item is ExamFollow => item.objectType === 'EXAM'
const isTopicFollow = (item: ApiFollow): item is TopicFollow => item.objectType === 'TOPIC'
const isEntityFollow = (item: ApiFollow): item is EntityFollow => item.objectType === 'ENTITY'

/** §6 entity types — plain words + a plain icon. */
const ENTITY_TYPE_META: Record<ApiFollowedEntity['type'], { icon: typeof User; label: string }> = {
  PERSON: { icon: User, label: 'Person' },
  PLACE: { icon: MapPin, label: 'Place' },
  ORGANISATION: { icon: Building2, label: 'Organisation' },
  CONCEPT: { icon: Lightbulb, label: 'Concept' },
}

/** Followed topic types — one plain word. */
function topicTypeWord(type: ApiFollowedTopic['type']): string {
  return type === 'DOMAIN' ? 'Subject' : 'Topic'
}

/** §36 honesty: retired/withdrawn followed objects stay listed, in plain words. */
const STATUS_NOTES: Record<string, string> = {
  RETIRED: 'Retired — kept for your history',
  INACTIVE: 'Temporarily unavailable',
  DRAFT: 'Not public yet',
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
    title: 'Following | GKSetu',
    description: 'Your followed exams and topics — the personalisation signals behind your GKSetu feed.',
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
                    ENTITY: current.counts.ENTITY - (follow.objectType === 'ENTITY' ? 1 : 0),
                  },
                }
              : current
          )
          toast({
            title: `Unfollowed ${
              follow.object.kind === 'EXAM'
                ? follow.object.name
                : follow.object.kind === 'ENTITY'
                  ? follow.object.canonicalName
                  : follow.object.label
            }`,
          })
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
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="following-heading"
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 bg-white shadow-sm">
          <CardHeader className="text-center">
            <span
              className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <Rss className="h-5 w-5 text-emerald-600" />
            </span>
            <CardTitle id="following-heading" className="text-xl">
              Following
            </CardTitle>
            <CardDescription>
              Follow the exams and subjects you care about — your feed and study
              queue build on them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in to see your follows
            </Button>
            <Button variant="ghost" size="sm" className="text-zinc-500" onClick={onGoHome}>
              Browse GKSetu instead
            </Button>
          </CardContent>
        </Card>
      </motion.section>
    )
  }

  const exams = data?.items.filter(isExamFollow) ?? []
  const topics = data?.items.filter(isTopicFollow) ?? []
  const entities = data?.items.filter(isEntityFollow) ?? []

  return (
    <div className="space-y-8">
      {/* ---------- Header — title, one-liner, refresh ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="following-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="following-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Following
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              The exams and subjects shaping your feed — unfollow anytime.
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
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900">Nothing followed yet</p>
              <p className="mt-0.5 max-w-xl text-sm text-zinc-600">
                Open an exam page (e.g. UPSC Civil Services) or any subject hub and press “Follow” —
                what you follow shapes your study queue and feed.
              </p>
            </div>
            <Button size="sm" className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onGoHome}>
              Browse exams and subjects
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
          {/* >8 rows: a capped, slim-scrollbar list keeps the page compact */}
          <ul
            className={
              exams.length > 8
                ? 'gksetu-scroll max-h-[560px] space-y-3 overflow-y-auto pr-1'
                : 'space-y-3'
            }
          >
            {exams.map((follow) => {
              const exam = follow.object
              const statusNote = STATUS_NOTES[exam.status]
              return (
                <li key={follow.id}>
                  <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-500"
                        aria-hidden="true"
                      >
                        <GraduationCap className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 basis-52 sm:basis-64">
                        <button
                          type="button"
                          onClick={() => onOpenExam(exam.slug, exam.countryIso)}
                          className="flex w-full min-h-[44px] items-center text-left"
                        >
                          <span className="min-w-0 truncate font-semibold text-zinc-900 hover:text-emerald-700">
                            {exam.name}
                          </span>
                        </button>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{exam.organiser}</p>
                        {statusNote && <p className="mt-1 text-xs text-amber-700">{statusNote}</p>}
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

      {/* ---------- Subjects / topics ---------- */}
      {topics.length > 0 && (
        <section aria-labelledby="following-topics-heading" className="space-y-3">
          <h2 id="following-topics-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BookOpen className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Followed subjects
            <span className="text-sm font-normal text-zinc-400">({topics.length})</span>
          </h2>
          {/* >8 rows: a capped, slim-scrollbar list keeps the page compact */}
          <ul
            className={
              topics.length > 8
                ? 'gksetu-scroll max-h-[560px] space-y-3 overflow-y-auto pr-1'
                : 'space-y-3'
            }
          >
            {topics.map((follow) => {
              const topic = follow.object
              const statusNote = STATUS_NOTES[topic.status]
              return (
                <li key={follow.id}>
                  <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-500"
                        aria-hidden="true"
                      >
                        <BookOpen className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 basis-52 sm:basis-64">
                        <button
                          type="button"
                          onClick={() => onOpenTopic(topic.slug, topic.countryIso)}
                          className="flex w-full min-h-[44px] items-center text-left"
                        >
                          <span className="min-w-0 truncate font-semibold text-zinc-900 hover:text-emerald-700">
                            {topic.label}
                          </span>
                        </button>
                        <p className="mt-0.5 text-xs text-zinc-500">{topicTypeWord(topic.type)}</p>
                        {statusNote && <p className="mt-1 text-xs text-amber-700">{statusNote}</p>}
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

      {/* ---------- Entities (P6-S3 §6/§10) ---------- */}
      {entities.length > 0 && (
        <section aria-labelledby="following-entities-heading" className="space-y-3">
          <h2 id="following-entities-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Lightbulb className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Followed entities
            <span className="text-sm font-normal text-zinc-400">({entities.length})</span>
          </h2>
          {/* >8 rows: a capped, slim-scrollbar list keeps the page compact */}
          <ul
            className={
              entities.length > 8
                ? 'gksetu-scroll max-h-[560px] space-y-3 overflow-y-auto pr-1'
                : 'space-y-3'
            }
          >
            {entities.map((follow) => {
              const entity = follow.object
              const meta = ENTITY_TYPE_META[entity.type]
              const EntityIcon = meta.icon
              const statusNote = STATUS_NOTES[entity.status]
              const aliases = entity.aliases.filter((alias) => alias !== entity.canonicalName)
              return (
                <li key={follow.id}>
                  <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-500"
                        aria-hidden="true"
                      >
                        <EntityIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 basis-52 sm:basis-64">
                        <span className="block truncate font-semibold text-zinc-900">
                          {entity.canonicalName}
                        </span>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {meta.label}
                          {aliases.length > 0 && (
                            <>
                              {' '}· Also known as {aliases.slice(0, 3).join(', ')}
                              {aliases.length > 3 && ` +${aliases.length - 3}`}
                            </>
                          )}
                        </p>
                        {statusNote && <p className="mt-1 text-xs text-amber-700">{statusNote}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                          disabled={removingId === follow.id}
                          onClick={() => void unfollow(follow)}
                          aria-label={`Unfollow ${entity.canonicalName}`}
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
    </div>
  )
}
