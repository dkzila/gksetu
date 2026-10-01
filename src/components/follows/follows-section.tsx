'use client'

/**
 * GKSetu — Follows section (P5-S1)
 *
 * The console's verification surface for the follow half of the Follow & Save
 * module: documents the /api/follows contract (§37 — the same endpoints a
 * mobile app calls, §39), then exercises it live for the signed-in user —
 * list, follow (with §14 country rules surfaced honestly), unfollow. Follow
 * and Save stay deliberately separate (§10): the save/collection half of the
 * module lands in P5-S2.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bell,
  BellRing,
  GraduationCap,
  Loader2,
  RefreshCw,
  Rss,
  ShieldAlert,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import type { ApiFollowList, ApiFollowState, FollowEnvelope } from './types'

/** Seeded ACTIVE objects the demo buttons exercise (exam IN + global topic). */
interface FollowDemo {
  objectType: 'EXAM' | 'TOPIC'
  objectRef: string
  name: string
}
const DEMO_EXAM: FollowDemo = { objectType: 'EXAM', objectRef: 'upsc-civil-services', name: 'UPSC Civil Services Examination' }
const DEMO_TOPIC: FollowDemo = { objectType: 'TOPIC', objectRef: 'polity-governance', name: 'Polity & Governance' }

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/follows?type=&country=&language=', note: 'My follows — resolved summaries + §16 paths' },
  { method: 'POST', path: '/api/follows', note: 'Follow { objectType, objectRef } — idempotent (§37)' },
  { method: 'DELETE', path: '/api/follows/{id}', note: 'Unfollow — scoped to the caller, audited' },
  { method: 'GET', path: '/api/follows/state?objectType=&objectRef=', note: 'Single-object button state (truthful)' },
]

export function FollowsSection() {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiFollowList | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchList = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/follows', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as FollowEnvelope<ApiFollowList>
      if (payload.status === 'ok' && payload.data) setData(payload.data)
      else toast({ title: 'Could not load follows', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/follows.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const checkState = useCallback(
    async (objectType: 'EXAM' | 'TOPIC', objectRef: string) => {
      const params = new URLSearchParams({ objectType, objectRef })
      const response = await fetch(`/api/follows/state?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as FollowEnvelope<ApiFollowState>
      return payload.status === 'ok' && payload.data ? payload.data : null
    },
    [token]
  )

  const [demoExamState, setDemoExamState] = useState<ApiFollowState | null>(null)
  const [demoTopicState, setDemoTopicState] = useState<ApiFollowState | null>(null)

  const refreshDemoStates = useCallback(async () => {
    if (!token) {
      setDemoExamState(null)
      setDemoTopicState(null)
      return
    }
    const [examState, topicState] = await Promise.all([
      checkState(DEMO_EXAM.objectType, DEMO_EXAM.objectRef),
      checkState(DEMO_TOPIC.objectType, DEMO_TOPIC.objectRef),
    ])
    setDemoExamState(examState)
    setDemoTopicState(topicState)
  }, [token, checkState])

  useEffect(() => {
    void refreshDemoStates()
  }, [refreshDemoStates])

  const followDemo = useCallback(
    async (demo: FollowDemo) => {
      if (!token || busy) return
      setBusy(`follow:${demo.objectRef}`)
      try {
        const response = await fetch('/api/follows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ objectType: demo.objectType, objectRef: demo.objectRef }),
        })
        const payload = (await response.json()) as FollowEnvelope<{ alreadyFollowing: boolean }>
        if (payload.status === 'ok') {
          toast({
            title: payload.data?.alreadyFollowing ? `Already following ${demo.name}` : `Following ${demo.name}`,
            description: payload.data?.alreadyFollowing
              ? 'Idempotent follow (§37) — the second click is a success, not an error.'
              : 'Follow row written + audited (user.follow.create).',
          })
        } else {
          toast({
            title: 'Follow rejected',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/follows.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
        void refreshDemoStates()
      }
    },
    [token, busy, toast, fetchList, refreshDemoStates]
  )

  const unfollowDemo = useCallback(
    async (state: ApiFollowState | null) => {
      if (!token || !state?.follow?.id || busy) return
      setBusy(`unfollow:${state.objectRef}`)
      try {
        const response = await fetch(`/api/follows/${encodeURIComponent(state.follow.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as FollowEnvelope<{ removed: boolean }>
        if (payload.status === 'ok') {
          toast({ title: 'Unfollowed', description: 'Row removed + audited (user.follow.remove).' })
        } else {
          toast({ title: 'Could not unfollow', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/follows.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
        void refreshDemoStates()
      }
    },
    [token, busy, toast, fetchList, refreshDemoStates]
  )

  const authenticated = status === 'authenticated' && !!token

  return (
    <section aria-labelledby="follows-heading" className="mt-10 space-y-4">
      <div className="flex items-center gap-2">
        <Rss className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="follows-heading" className="text-xl font-semibold tracking-tight">
          Follows — the §9/§10 personalisation signal
        </h2>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Follow = declared ongoing interest (exams, topics — ENTITY/THEME join in P6) that shapes
        feed, notifications, recommendations and the dashboard. Deliberately separate from saves
        (P5-S2). §14 is enforced server-side: exams and country-scoped topics only follow from
        the user&rsquo;s home market; every follow/unfollow is audited and reversible (§31).
      </p>

      {/* ---------- API contract ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">The follow API (§37 — Bearer-authenticated)</CardTitle>
          <CardDescription>
            The same versioned endpoints a native app will call (§39). Idempotent follow, scoped
            unfollow, truthful state, honest §14/§36 errors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {API_ROWS.map((row) => (
              <li key={`${row.method}:${row.path}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={`w-16 justify-center font-mono text-[10px] ${
                    row.method === 'GET'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : row.method === 'POST'
                        ? 'border-zinc-300 bg-zinc-100 text-zinc-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  {row.method}
                </Badge>
                <code className="break-all font-mono text-xs text-zinc-800">{row.path}</code>
                <span className="text-xs text-zinc-500">— {row.note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ---------- Live exercise (auth-gated) ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Exercise the endpoints live</CardTitle>
          <CardDescription>
            {authenticated
              ? `Signed in as ${user?.email ?? 'you'} — every action below hits the real APIs.`
              : 'Sign in above (any account, any role — follows are per-user personalisation, not role-gated).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authenticated ? (
            <p className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
              <ShieldAlert className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              Unauthenticated calls to /api/follows return 401 — follows are private per-user data (§30/§31).
            </p>
          ) : (
            <>
              {/* Demo toggles */}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { demo: DEMO_EXAM, state: demoExamState, icon: <GraduationCap className="h-4 w-4" aria-hidden="true" /> },
                  { demo: DEMO_TOPIC, state: demoTopicState, icon: <Bell className="h-4 w-4" aria-hidden="true" /> },
                ].map(({ demo, state, icon }) => (
                  <div key={demo.objectRef} className="rounded-lg border border-zinc-200 bg-white p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      {icon}
                      {demo.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-400">
                      {demo.objectType}:{demo.objectRef} · state {state ? (state.following ? 'following' : 'not following') : '…'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        disabled={busy !== null}
                        onClick={() => void followDemo(demo)}
                      >
                        {busy === `follow:${demo.objectRef}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <BellRing className="h-4 w-4" aria-hidden="true" />
                        )}
                        Follow
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                        disabled={busy !== null || !state?.following}
                        onClick={() => void unfollowDemo(state)}
                      >
                        {busy === `unfollow:${demo.objectRef}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                        Unfollow
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Live list */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-800">
                    GET /api/follows —{' '}
                    {data ? (
                      <span className="font-normal text-zinc-500">
                        {data.counts.total} total · {data.counts.EXAM} exams · {data.counts.TOPIC} topics ·{' '}
                        {data.counts.ENTITY} entities
                      </span>
                    ) : (
                      <span className="font-normal text-zinc-400">loading…</span>
                    )}
                  </p>
                  <Button variant="ghost" size="sm" className="h-8 gap-2" onClick={() => void fetchList()} disabled={loading}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Refresh
                  </Button>
                </div>
                {loading && !data ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : data && data.items.length > 0 ? (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {data.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs"
                      >
                        <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
                          {item.objectType}
                        </Badge>
                        <span className="font-medium text-zinc-800">
                          {item.object.kind === 'EXAM'
                            ? item.object.name
                            : item.object.kind === 'ENTITY'
                              ? item.object.canonicalName
                              : item.object.label}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {item.object.kind === 'ENTITY' ? `(no page yet — ${item.object.type.toLowerCase()})` : item.object.canonicalPath}
                        </span>
                        <span className="ml-auto text-zinc-400">
                          followed {new Date(item.followedAt).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed border-zinc-200 bg-white p-3 text-xs text-zinc-500">
                    No follows yet — use the toggles above or the Follow buttons on any exam page or
                    topic hub, then manage them at <code className="font-mono">#/following</code>.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
