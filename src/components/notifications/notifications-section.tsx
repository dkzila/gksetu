'use client'

/**
 * GlobIQ — Notifications section (P8-S2)
 *
 * The console's surface for the §27 notifications engine: documents the API
 * contract (§37/§39), the trigger → category routing (the engine's shared
 * vocabulary, stated), the per-channel lifecycle with the modeled dev
 * transport's honesty (mobile-push held for the app, §39), and runs the
 * admin dispatch sweep behind an explicit two-step confirm (the
 * freshness-sweep precedent — ensure revision digests + deliver queued
 * rows platform-wide, audited once with counts).
 */
import { useCallback, useState } from 'react'
import {
  Bell,
  CalendarClock,
  ClipboardCheck,
  FilePen,
  Loader2,
  Newspaper,
  Play,
  Send,
  ShieldCheck,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// ---------- API types (mirror the /api/notifications DTOs) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface DispatchResult {
  ensuredRevisionDue: number
  dispatched: { sent: number; failed: number; held: number }
  usersWithHolds: number
  computedAt: string
}

// ---------- The §27 trigger → category routing (the engine's vocabulary) ----------

const TRIGGER_ROWS: Array<{
  trigger: string
  label: string
  category: string
  fired: string
  icon: typeof Newspaper
}> = [
  {
    trigger: 'CA_ITEM_FOLLOWED',
    label: 'Current-affairs coverage live',
    category: 'current_affairs',
    fired: 'An event\u2019s first published representation — followers of its mapped exams/topics (§12)',
    icon: Newspaper,
  },
  {
    trigger: 'UNIT_ADDED_FOLLOWED_EXAM',
    label: 'New syllabus unit',
    category: 'learning',
    fired: 'A unit verified into a followed exam\u2019s in-effect syllabus (§8/§11)',
    icon: CalendarClock,
  },
  {
    trigger: 'REVISION_DUE',
    label: 'Revision due',
    category: 'learning',
    fired: 'The §22 spaced-review schedule — ensured idempotently, at most one unread digest',
    icon: CalendarClock,
  },
  {
    trigger: 'CORRECTION_PUBLISHED',
    label: 'Correction live',
    category: 'corrections',
    fired: 'A §25 republish with change summary — the unit\u2019s savers hear first',
    icon: FilePen,
  },
  {
    trigger: 'EDITORIAL_TASK_ASSIGNED',
    label: 'Task assigned',
    category: 'editorial',
    fired: 'A work item gained an assignee (§19) — the assignee is notified',
    icon: ClipboardCheck,
  },
  {
    trigger: 'EDITORIAL_REVIEW_REQUESTED',
    label: 'Review requested',
    category: 'editorial',
    fired: 'A review-type work item was assigned (§19)',
    icon: ClipboardCheck,
  },
  {
    trigger: 'FEEDBACK_REPORT_RECEIVED',
    label: 'Feedback report',
    category: 'editorial',
    fired: 'Modeled (§27) — wired when the public feedback loop lands (P8-S3)',
    icon: ShieldCheck,
  },
]

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/notifications', note: 'P8-S2 — the notification center feed: lazy revision digest + opportunistic dispatch + the grouped, explainable items' },
  { method: 'POST', path: '/api/notifications/read', note: 'P8-S2 — mark one batch or all read (READ is batch-level; read-before-dispatch never delivers)' },
  { method: 'GET', path: '/api/notifications/preferences', note: 'P8-S2 — the per-category × per-channel effective matrix (§27 — never all-or-nothing)' },
  { method: 'PUT', path: '/api/notifications/preferences', note: 'P8-S2 — one channel × category opt per request, audited user.notification.preference' },
  { method: 'GET', path: '/api/notifications/stats', note: 'P8-S2 — the bell\u2019s pure unread-count read (never dispatches)' },
  { method: 'POST', path: '/api/notifications/dispatch', note: 'P8-S2 — ADMIN: the batch sweep (revision digests + queued delivery), audited with counts' },
]

export function NotificationsSection() {
  const { token, user } = useAuth()
  const { toast } = useToast()

  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<DispatchResult | null>(null)

  // The sweep permission is ADMIN-only ('notifications:dispatch' — it
  // processes every user's rows, the search:manage precedent).
  const canDispatch = user?.role === 'ADMIN'

  const runSweep = useCallback(async () => {
    if (!token || running) return
    setRunning(true)
    try {
      const response = await fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as Envelope<{ dispatch: DispatchResult }>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data.dispatch)
        setConfirming(false)
        toast({
          title: 'Dispatch sweep complete',
          description: `${payload.data.dispatch.dispatched.sent} delivered · ${payload.data.dispatch.dispatched.held} held for the app (§39) · ${payload.data.dispatch.ensuredRevisionDue} revision digests ensured`,
        })
      } else {
        toast({
          title: 'Sweep failed',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
    } finally {
      setRunning(false)
    }
  }, [token, running, toast])

  return (
    <section aria-labelledby="notifications-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="notifications-heading" className="text-xl font-semibold tracking-tight">
          Notifications engine — §27
        </h2>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          P8-S2
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Channel-agnostic fan-out with per-category × per-channel preferences (never
        all-or-nothing). Every notification carries its explainable reason — &ldquo;you&rsquo;re
        getting this because you follow …&rdquo; — with a one-tap mute for the follow that caused
        it. Delivery in this build is the modeled dev transport (honestly labeled); mobile push is
        held for the app (§39).
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------- Trigger → category routing ---------- */}
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Triggers → categories</CardTitle>
            <CardDescription>The engine&rsquo;s routing vocabulary (§27)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {TRIGGER_ROWS.map((row) => {
              const Icon = row.icon
              return (
                <div key={row.trigger} className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                      <Icon className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                      {row.label}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
                      {row.category}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{row.fired}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* ---------- Lifecycle + transport ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Send className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Lifecycle &amp; transport
              </CardTitle>
              <CardDescription>queued → sent / failed → read (§27)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-zinc-600">
              <p>
                One notification = one batch of channel rows (email / web push / mobile push —
                one per enabled channel, resolved per category × channel from sparse preference
                rows; defaults: email + web push on, mobile push off).
              </p>
              <p>
                <span className="font-medium text-zinc-800">Dispatch</span> moves QUEUED → SENT
                through the transport. Opening the notification center dispatches your own queue
                (pull-model delivery); the admin sweep below does it platform-wide. Mobile-push
                rows stay QUEUED — honestly held for the app (§39). A row read before dispatch
                never delivers: seen is seen.
              </p>
            </CardContent>
          </Card>

          {/* ---------- The dispatch sweep ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Dispatch sweep
              </CardTitle>
              <CardDescription>
                ADMIN · ensure revision digests + deliver every queued row (audited, §30)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!canDispatch ? (
                <p className="text-sm text-zinc-500">
                  Sign in as the dev admin to run the sweep — it processes every user&rsquo;s rows
                  (the <code className="rounded bg-zinc-100 px-1 text-xs">notifications:dispatch</code>{' '}
                  permission, the search:manage precedent).
                </p>
              ) : confirming ? (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">
                    Run the sweep for every user? Revision digests are ensured idempotently; queued
                    email/web-push rows deliver through the dev transport; mobile-push rows hold.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => void runSweep()}
                      disabled={running}
                    >
                      {running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Run the sweep
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-zinc-200"
                      onClick={() => setConfirming(false)}
                      disabled={running}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-2 border-zinc-200"
                  onClick={() => setConfirming(true)}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Run the dispatch sweep
                </Button>
              )}
              {result && (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-medium">Last sweep</p>
                  <p className="mt-1">
                    {result.dispatched.sent} delivered · {result.dispatched.failed} failed ·{' '}
                    {result.dispatched.held} held for the app · {result.ensuredRevisionDue} revision
                    digests ensured · {result.usersWithHolds} user
                    {result.usersWithHolds === 1 ? '' : 's'} with holds
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---------- API contract ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">API contract (§37)</CardTitle>
          <CardDescription>Same endpoints for web &amp; future apps (§39)</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {API_ROWS.map((row) => (
              <li key={`${row.method}:${row.path}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Badge variant="outline" className="font-mono text-[10px] font-semibold text-zinc-600">
                  {row.method}
                </Badge>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700">
                  {row.path}
                </code>
                <span className="text-xs text-zinc-500">{row.note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
