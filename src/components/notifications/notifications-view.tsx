'use client'

import { navigateToPath } from '@/components/home/app-router'

/**
 * GKSetu — the Notifications view (P8-S2, #/notifications)
 * Master Plan §27 (the notification center + the preferences surface): every
 * notification carries its EXPLAINABLE reason ("You're getting this because
 * you follow …") with a one-tap mute for the specific follow that caused it
 * — the §9 inventory's own removal contract, applied to pushes; per-channel
 * lifecycle badges (queued → sent → read, mobile-push honestly held for the
 * app, §39); per-category × per-channel preferences — never all-or-nothing
 * (§27); §31 (a private authenticated surface: noindex, signed-out gate;
 * notification history is the user's own data); §36 (the context is an
 * honest snapshot at trigger time); §16 (public objects reopen through
 * their canonical paths; private surfaces through their in-app paths).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  BellOff,
  BookPlus,
  CalendarClock,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  FilePen,
  Info,
  Loader2,
  LogIn,
  MessageSquareWarning,
  Newspaper,
  RefreshCw,
  SlidersHorizontal,
  VolumeX,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { useNotificationCount } from '@/stores/notifications'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

import { useSeoHead } from '@/components/home/seo-head'

// ---------- Props ----------

export interface NotificationsViewProps {
  /** Opens a §16 canonical path inside the app (unit/event pages). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- API types (mirror GET /api/notifications — §37/§39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

type Channel = 'EMAIL' | 'WEB_PUSH' | 'MOBILE_PUSH'
type TriggerType =
  | 'CA_ITEM_FOLLOWED'
  | 'UNIT_ADDED_FOLLOWED_EXAM'
  | 'REVISION_DUE'
  | 'CORRECTION_PUBLISHED'
  | 'EDITORIAL_TASK_ASSIGNED'
  | 'EDITORIAL_REVIEW_REQUESTED'
  | 'FEEDBACK_REPORT_RECEIVED'

interface MatchedFollow {
  id: string
  objectType: 'EXAM' | 'TOPIC'
  label: string
  removalPath: string
}

interface ApiNotification {
  batchId: string
  triggerType: TriggerType
  category: 'current_affairs' | 'learning' | 'corrections' | 'editorial'
  objectType: string
  objectRef: string
  title: string
  reason: string
  body: string | null
  objectLabel: string
  canonicalPath: string | null
  appPath: string | null
  actionLabel: string
  matchedFollows: MatchedFollow[]
  matchedSave: { id: string; label: string; removalPath: string } | null
  channels: Array<{ channel: Channel; status: 'QUEUED' | 'SENT' | 'FAILED' | 'READ'; sentAt: string | null }>
  isRead: boolean
  createdAt: string
  readAt: string | null
}

interface ApiFeed {
  items: ApiNotification[]
  unreadCount: number
  ensured: { revisionDue: boolean }
  dispatched: { sent: number; failed: number; held: number }
  note: string
  computedAt: string
}

interface ApiPreferenceCell {
  channel: Channel
  label: string
  deliveryNote: string
  reserved: boolean
  enabled: boolean
}

interface ApiPreferences {
  categories: Array<{
    key: string
    label: string
    description: string
    triggers: TriggerType[]
    channels: ApiPreferenceCell[]
  }>
  defaultsNote: string
  note: string
  computedAt: string
}

// ---------- Presentation helpers ----------

const TRIGGER_META: Record<TriggerType, { label: string; icon: typeof Bell; className: string }> = {
  CA_ITEM_FOLLOWED: { label: 'Current affairs', icon: Newspaper, className: 'border-sky-200 bg-sky-50 text-sky-700' },
  UNIT_ADDED_FOLLOWED_EXAM: { label: 'New syllabus unit', icon: BookPlus, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  REVISION_DUE: { label: 'Revision due', icon: CalendarClock, className: 'border-amber-200 bg-amber-50 text-amber-800' },
  CORRECTION_PUBLISHED: { label: 'Correction', icon: FilePen, className: 'border-orange-200 bg-orange-50 text-orange-700' },
  EDITORIAL_TASK_ASSIGNED: { label: 'Task assigned', icon: ClipboardList, className: 'border-violet-200 bg-violet-50 text-violet-700' },
  EDITORIAL_REVIEW_REQUESTED: { label: 'Review requested', icon: ClipboardCheck, className: 'border-violet-200 bg-violet-50 text-violet-700' },
  FEEDBACK_REPORT_RECEIVED: { label: 'Feedback report', icon: MessageSquareWarning, className: 'border-rose-200 bg-rose-50 text-rose-700' },
}

const CHANNEL_LABEL: Record<Channel, string> = {
  EMAIL: 'Email',
  WEB_PUSH: 'Web push',
  MOBILE_PUSH: 'Mobile push',
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  SENT: { label: 'sent', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  QUEUED: { label: 'queued', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  FAILED: { label: 'failed', className: 'border-red-200 bg-red-50 text-red-700' },
  READ: { label: 'read', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---------- The view ----------

export function NotificationsView({ onOpenPath, onGoHome, onSignIn }: NotificationsViewProps) {
  const { status, user, token } = useAuth()
  const { toast } = useToast()
  const setBellCount = useNotificationCount((state) => state.setCount)

  const [feed, setFeed] = useState<ApiFeed | null>(null)
  const [preferences, setPreferences] = useState<ApiPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [mutingId, setMutingId] = useState<string | null>(null)
  const [togglingCell, setTogglingCell] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // §16 (P8-S2): the notification center is a private surface — noindex.
  useSeoHead({
    title: 'Your notifications | GKSetu',
    description:
      'Your GKSetu notifications — each says why you get it, with a one-tap mute for the follow that caused it.',
    noindex: true,
  })

  const fetchFeed = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ notifications: ApiFeed }>
      if (mounted.current) {
        if (payload.status === 'ok' && payload.data) {
          setFeed(payload.data.notifications)
          setBellCount(payload.data.notifications.unreadCount)
        } else {
          setError(payload.error?.message ?? 'Could not load your notifications.')
        }
      }
    } catch {
      if (mounted.current) setError('Could not load your notifications — please retry.')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [token, setBellCount])

  const fetchPreferences = useCallback(async () => {
    if (!token) return
    try {
      const response = await fetch('/api/notifications/preferences', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ preferences: ApiPreferences }>
      if (mounted.current && payload.status === 'ok' && payload.data) {
        setPreferences(payload.data.preferences)
      }
    } catch {
      // Best-effort panel — the feed stays primary.
    }
  }, [token])

  useEffect(() => {
    if (status === 'authenticated' && token) {
      void fetchFeed()
      void fetchPreferences()
    } else {
      setFeed(null)
      setPreferences(null)
      setLoading(false)
    }
  }, [status, token, fetchFeed, fetchPreferences])

  // ---------- Mark read (one batch or all) ----------

  const markRead = useCallback(
    async (batchId: string | null) => {
      if (!token || markingAll || markingId) return
      if (batchId) setMarkingId(batchId)
      else setMarkingAll(true)
      try {
        const response = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(batchId ? { batchId } : { all: true }),
        })
        const payload = (await response.json()) as Envelope<{ read: { updated: number; unreadCount: number } }>
        if (payload.status === 'ok' && payload.data) {
          setBellCount(payload.data.read.unreadCount)
          setFeed((current) =>
            current
              ? {
                  ...current,
                  unreadCount: payload.data!.read.unreadCount,
                  items: current.items.map((item) =>
                    !batchId || item.batchId === batchId ? { ...item, isRead: true } : item
                  ),
                }
              : current
          )
        } else {
          toast({
            title: 'Could not mark as read',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        if (mounted.current) {
          setMarkingId(null)
          setMarkingAll(false)
        }
      }
    },
    [token, markingAll, markingId, toast, setBellCount]
  )

  // ---------- §27 one-tap mute (the matched follow's removal request) ----------

  const muteFollow = useCallback(
    async (follow: MatchedFollow) => {
      if (!token || mutingId) return
      if (
        !window.confirm(
          `Stop following ${follow.label}? This is the one-tap mute — it removes the follow, so nothing it matches reaches you again. You can re-follow anytime.`
        )
      ) {
        return
      }
      setMutingId(follow.id)
      try {
        const response = await fetch(follow.removalPath, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as Envelope<{ removed: boolean }>
        if (payload.status === 'ok') {
          toast({ title: `Muted — unfollowed ${follow.label}` })
          // The mute is a personalisation change: refresh the feed so
          // reasons stay coherent (other notifications may restate matches).
          void fetchFeed()
        } else {
          toast({
            title: 'Could not mute',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        if (mounted.current) setMutingId(null)
      }
    },
    [token, mutingId, toast, fetchFeed]
  )

  /** The correction category's control: unsave the corrected item (§10). */
  const unsaveItem = useCallback(
    async (save: { id: string; label: string; removalPath: string }) => {
      if (!token || mutingId) return
      if (
        !window.confirm(
          `Remove ${save.label} from your saved items? You will no longer be notified when it is corrected.`
        )
      ) {
        return
      }
      setMutingId(save.id)
      try {
        const response = await fetch(save.removalPath, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as Envelope<{ removed: boolean }>
        if (payload.status === 'ok') {
          toast({ title: `Removed ${save.label} from your saves` })
          void fetchFeed()
        } else {
          toast({
            title: 'Could not remove the save',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        if (mounted.current) setMutingId(null)
      }
    },
    [token, mutingId, toast, fetchFeed]
  )

  // ---------- Preferences (one PUT per cell — one audited operation) ----------

  const toggleCell = useCallback(
    async (categoryKey: string, cell: ApiPreferenceCell) => {
      if (!token || togglingCell) return
      setTogglingCell(`${categoryKey}:${cell.channel}`)
      try {
        const response = await fetch('/api/notifications/preferences', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: cell.channel,
            category: categoryKey,
            enabled: !cell.enabled,
          }),
        })
        const payload = (await response.json()) as Envelope<{ preference: { enabled: boolean } }>
        if (payload.status === 'ok') {
          setPreferences((current) =>
            current
              ? {
                  ...current,
                  categories: current.categories.map((category) =>
                    category.key === categoryKey
                      ? {
                          ...category,
                          channels: category.channels.map((entry) =>
                            entry.channel === cell.channel
                              ? { ...entry, enabled: payload.data!.preference.enabled }
                              : entry
                          ),
                        }
                      : category
                  ),
                }
              : current
          )
          toast({
            title: `${CHANNEL_LABEL[cell.channel]} ${payload.data!.preference.enabled ? 'on' : 'off'} for this category`,
          })
        } else {
          toast({
            title: 'Could not save that preference',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        if (mounted.current) setTogglingCell(null)
      }
    },
    [token, togglingCell, toast]
  )

  // ---------- Open action (§16 canonical path, or the private in-app path) ----------

  const open = useCallback(
    (item: ApiNotification) => {
      if (item.canonicalPath) onOpenPath(item.canonicalPath)
      else if (item.appPath) navigateToPath(item.appPath)
      if (!item.isRead) void markRead(item.batchId)
    },
    [onOpenPath, markRead]
  )

  // ---------- Signed-out state (§38: one auth surface) ----------

  if (status !== 'authenticated' || !user) {
    return (
      <div className="mx-auto max-w-xl space-y-6 py-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <Bell className="h-6 w-6 text-emerald-600" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Your notifications</h1>
          <p className="text-sm text-zinc-600">
            Sign in to see what changed on your followed exams and subjects — each notification
            says why you get it, and you control every category and channel.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Button onClick={onSignIn} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Sign in
          </Button>
          <Button variant="outline" onClick={onGoHome} className="border-zinc-200">
            Back to the homepage
          </Button>
        </div>
      </div>
    )
  }

  const unreadCount = feed?.unreadCount ?? 0
  // What this visit's opportunistic dispatch did (§27 honesty — plain
  // computation, no hook: it sits after the signed-out early return).
  const dispatchedNote = (() => {
    if (!feed) return null
    const { sent, failed, held } = feed.dispatched
    if (sent === 0 && failed === 0 && held === 0) return null
    const parts: string[] = []
    if (sent > 0) parts.push(`${sent} delivered`)
    if (held > 0) parts.push(`${held} coming to the mobile app`)
    if (failed > 0) parts.push(`${failed} failed — retrying on the next sweep`)
    return `This visit dispatched your queue: ${parts.join(' · ')}.`
  })()

  return (
    <div className="space-y-8">
      {/* ---------- Header ---------- */}
      <section aria-labelledby="notifications-heading" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 id="notifications-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Your notifications
              </h1>
              {unreadCount > 0 && (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              Each notification says why you get it, with a one-tap mute for the follow that
              caused it. Categories and channels are controlled separately below — never
              all-or-nothing.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-zinc-200"
              onClick={() => void fetchFeed()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-zinc-200"
              onClick={() => void markRead(null)}
              disabled={markingAll || unreadCount === 0}
            >
              {markingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
              )}
              Mark all read
            </Button>
          </div>
        </div>
        {dispatchedNote && (
          <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {dispatchedNote}
          </p>
        )}
      </section>

      {/* ---------- Feed ---------- */}
      <section aria-labelledby="notifications-feed" className="space-y-4">
        <h2 id="notifications-feed" className="sr-only">
          Notification feed
        </h2>
        {loading && !feed ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your notifications">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : !feed || feed.items.length === 0 ? (
          <Card className="border-dashed border-zinc-200 bg-white">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <BellOff className="h-5 w-5 text-zinc-400" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">Nothing yet</p>
                <p className="mt-1 max-w-md text-sm text-zinc-500">
                  Follow an exam or subject and its coverage reaches you here — current affairs
                  first, new syllabus units and your spaced-review reminders next.
                </p>
              </div>
              <Button variant="outline" size="sm" className="border-zinc-200" asChild>
                <a href="/following">Manage your follows</a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {feed.items.map((item, index) => {
              const meta = TRIGGER_META[item.triggerType]
              const Icon = meta.icon
              return (
                <motion.li
                  key={item.batchId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.2) }}
                >
                  <Card
                    className={`border-zinc-200 bg-white shadow-sm transition-colors ${
                      item.isRead ? '' : 'border-emerald-200'
                    }`}
                  >
                    <CardContent className="space-y-3 p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${meta.className}`}
                          aria-hidden="true"
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <p className="font-semibold leading-snug text-zinc-900">{item.title}</p>
                            <span className="shrink-0 text-xs text-zinc-400">{timeAgo(item.createdAt)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className={`text-[10px] font-medium ${meta.className}`}>
                              {meta.label}
                            </Badge>
                            {item.channels.map((channel) => {
                              const badge = STATUS_BADGE[channel.status] ?? STATUS_BADGE.READ!
                              return (
                                <Badge
                                  key={channel.channel}
                                  variant="outline"
                                  className={`text-[10px] font-normal ${badge.className}`}
                                  title={
                                    channel.channel === 'MOBILE_PUSH' && channel.status === 'QUEUED'
                                      ? 'Coming to the mobile app'
                                      : undefined
                                  }
                                >
                                  {CHANNEL_LABEL[channel.channel]} · {badge.label}
                                </Badge>
                              )
                            })}
                            {!item.isRead && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                Unread
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* §27 explainable reason + body */}
                      <div className="space-y-1.5 pl-12 sm:pl-[52px]">
                        <p className="text-sm text-zinc-700">{item.reason}</p>
                        {item.body && (
                          <p className="text-sm leading-relaxed text-zinc-500">{item.body}</p>
                        )}
                      </div>

                      {/* Actions: open + §27 mute controls (labels wrap on
                          narrow screens — the aria-labels carry the full
                          semantics, the visible text may break lines) */}
                      <div className="flex min-w-0 flex-wrap items-center gap-2 pl-12 sm:pl-[52px]">
                        <Button
                          size="sm"
                          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => open(item)}
                        >
                          {item.actionLabel}
                        </Button>
                        {item.matchedFollows.map((follow) => (
                          <Button
                            key={follow.id}
                            variant="outline"
                            size="sm"
                            className="h-auto min-h-8 max-w-full whitespace-normal border-zinc-200 px-3 py-1 text-left text-xs font-normal leading-snug text-zinc-500 hover:border-amber-300 hover:text-amber-700 sm:text-sm"
                            onClick={() => void muteFollow(follow)}
                            disabled={mutingId === follow.id}
                            aria-label={`Mute — stop following ${follow.label}`}
                          >
                            {mutingId === follow.id ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                            ) : (
                              <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="min-w-0 break-words">Mute {follow.label}</span>
                          </Button>
                        ))}
                        {item.matchedSave && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-auto min-h-8 max-w-full whitespace-normal border-zinc-200 px-3 py-1 text-left text-xs font-normal leading-snug text-zinc-500 hover:border-amber-300 hover:text-amber-700 sm:text-sm"
                            onClick={() => void unsaveItem(item.matchedSave!)}
                            disabled={mutingId === item.matchedSave.id}
                            aria-label={`Stop saving ${item.matchedSave.label} — no more correction notifications`}
                          >
                            {mutingId === item.matchedSave.id ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                            ) : (
                              <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="min-w-0 break-words">Unsave {item.matchedSave.label}</span>
                          </Button>
                        )}
                        {!item.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-zinc-400 hover:text-zinc-700"
                            onClick={() => void markRead(item.batchId)}
                            disabled={markingId === item.batchId}
                          >
                            {markingId === item.batchId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Mark read
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.li>
              )
            })}
          </ul>
        )}
        {feed && feed.items.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-zinc-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {feed.note}
          </p>
        )}
      </section>

      {/* ---------- Preferences (§27 per-category × per-channel) ---------- */}
      <section aria-labelledby="preferences-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="preferences-heading" className="text-xl font-semibold tracking-tight">
            Notification preferences
          </h2>
        </div>
        {!preferences ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <div className="space-y-4">
            {preferences.categories.map((category) => (
              <Card key={category.key} className="border-zinc-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{category.label}</CardTitle>
                  <CardDescription>{category.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {category.channels.map((cell) => {
                    const cellKey = `${category.key}:${cell.channel}`
                    return (
                      <div
                        key={cell.channel}
                        className="flex items-start justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-zinc-800">
                              {cell.label}
                              {cell.reserved && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 border-amber-200 bg-amber-50 text-[10px] font-normal text-amber-800"
                                >
                                  reserved
                                </Badge>
                              )}
                            </p>
                          </div>
                          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                            {cell.deliveryNote}
                          </p>
                        </div>
                        <Switch
                          checked={cell.enabled}
                          onCheckedChange={() => void toggleCell(category.key, cell)}
                          disabled={togglingCell === cellKey}
                          aria-label={`${cell.label} notifications for ${category.label}`}
                        />
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            ))}
            <Separator />
            <div className="space-y-1 text-xs text-zinc-500">
              <p>{preferences.note}</p>
              <p>{preferences.defaultsNote}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
