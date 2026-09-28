'use client'

/**
 * GlobIQ — Current Affairs section (P6-S1)
 *
 * The console's verification surface for the event-centric current-affairs
 * foundation (§12): documents the admin API contract (§37 — the same
 * endpoints a mobile app calls, §39), then exercises it live — the §12
 * workflow end-to-end: create the event (step 1, with initial source
 * aggregation — step 2), advance the lifecycle (step 6: emerging →
 * developing → stable → archived, with honest reopens), aggregate more
 * shared-registry evidence by URL (the §11 dedup philosophy) and link the
 * canonical KnowledgeUnits the event touches (step 3, the §7 one-truth rule).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  CalendarDays,
  Globe2,
  Link2,
  Loader2,
  MapPin,
  Newspaper,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  Users,
  Zap,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API types (mirror the /api/current-affairs DTOs) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

type Lifecycle = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'

interface AdminEvent {
  id: string
  slug: string
  title: string
  eventDate: string
  eventEndDate: string | null
  location: string | null
  summary: string
  significance: string | null
  lifecycleState: Lifecycle
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { slug: string; name: string }
  notes: string | null
  sourceCount: number
  unitCount: number
  hasPrimarySource: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

interface AdminEventDetail extends AdminEvent {
  sources: Array<{
    id: string
    isPrimary: boolean
    note: string | null
    linkedAt: string
    source: {
      id: string
      title: string
      publisher: string
      url: string
      type: string
      verification: string
      publishedAt: string | null
      retrievedAt: string
      verifiedAt: string | null
    }
  }>
  knowledgeUnits: Array<{
    id: string
    note: string | null
    linkedAt: string
    unit: { id: string; slug: string; canonicalName: string; status: string; type: string; topicSlug: string | null }
  }>
  /** P6-S3 §12 step 3 — the entity links (who/what the event is about). */
  entities: Array<{
    id: string
    note: string | null
    linkedAt: string
    entity: {
      id: string
      slug: string
      canonicalName: string
      type: string
      status: string
      scope: string
      countryIso: string | null
      description: string | null
    }
  }>
  /** P6-S3 §12 step 3 — additional-topic cross-filings. */
  additionalTopics: Array<{
    id: string
    note: string | null
    linkedAt: string
    topic: {
      id: string
      slug: string
      canonicalName: string
      type: string
      status: string
      scope: string
      countryIso: string | null
    }
  }>
  allowedTransitions: Lifecycle[]
  editable: boolean
}

interface EventListResult {
  events: AdminEvent[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: Record<Lifecycle, number>
}

// ---------- Presentation helpers ----------

const lifecycleStyle: Record<Lifecycle, string> = {
  EMERGING: 'border-amber-200 bg-amber-50 text-amber-700',
  DEVELOPING: 'border-orange-200 bg-orange-50 text-orange-700',
  STABLE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ARCHIVED: 'border-zinc-200 bg-zinc-100 text-zinc-600',
}

const scopeStyle: Record<string, string> = {
  GLOBAL: 'border-violet-200 bg-violet-50 text-violet-700',
  COUNTRY: 'border-teal-200 bg-teal-50 text-teal-700',
}

const verificationStyle: Record<string, string> = {
  UNVERIFIED: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  VERIFIED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  UNRELIABLE: 'border-red-200 bg-red-50 text-red-700',
}

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/current-affairs/admin/events?q=&lifecycle=&scope=', note: 'Editorial workspace list (§38 scoped) + lifecycle summary' },
  { method: 'POST', path: '/api/current-affairs/admin/events', note: '§12 step 1 — create the event (+ initial sources, step 2)' },
  { method: 'GET', path: '/api/current-affairs/admin/events/{id}', note: 'Detail: aggregated sources + unit links + affordances' },
  { method: 'PATCH', path: '/api/current-affairs/admin/events/{id}', note: 'Audited metadata edits (§36 — slug/scope immutable)' },
  { method: 'POST', path: '/api/current-affairs/admin/events/{id}/transition', note: '§12 step 6 — the lifecycle state machine' },
  { method: 'POST', path: '/api/current-affairs/admin/events/{id}/sources', note: '§12 step 2 — aggregate evidence (URL dedup, §11)' },
  { method: 'PATCH/DELETE', path: '/api/current-affairs/admin/events/{id}/sources/{linkId}', note: 'Note/primary swap · detach (registry preserved)' },
  { method: 'POST/DELETE', path: '/api/current-affairs/admin/events/{id}/knowledge-units[/{linkId}]', note: '§12 step 3 — VERIFIED canonical unit links (§7)' },
  { method: 'POST/DELETE', path: '/api/current-affairs/admin/events/{id}/entities[/{linkId}]', note: 'P6-S3 §12 step 3 — ACTIVE entity links (registry preserved on detach, §36)' },
  { method: 'POST/DELETE', path: '/api/current-affairs/admin/events/{id}/topics[/{linkId}]', note: 'P6-S3 §12 step 3 — additional-topic cross-filings (§13 containment)' },
  { method: 'GET/POST/PATCH', path: '/api/entities/admin[/{id}]', note: 'P6-S3 — the Entity reference registry (persons/places/orgs/concepts, §14 scope, aliases)' },
  { method: 'GET', path: '/api/current-affairs/feed?exam={slug}', note: 'P6-S4 — exam-aware feed: single-exam mode (public)' },
  { method: 'GET', path: '/api/current-affairs/feed', note: 'P6-S4 — exam-aware feed: combined mode over followed + goal exams (Bearer)' },
]

const DEMO_TOPICS = [
  { slug: 'current-affairs', name: 'Current Affairs' },
  { slug: 'polity-governance', name: 'Polity & Governance' },
  { slug: 'science-technology', name: 'Science & Technology' },
  { slug: 'space-technology', name: 'Space Technology' },
  { slug: 'isro-programmes', name: 'ISRO Programmes' },
  { slug: 'international-organisations', name: 'International Organisations' },
  { slug: 'united-nations', name: 'United Nations' },
  { slug: 'awards-honours', name: 'Awards & Honours' },
]

const SOURCE_TYPES = ['OFFICIAL', 'NEWS_MEDIA', 'INSTITUTIONAL', 'ACADEMIC', 'DATA', 'OTHER'] as const

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------- Component ----------

export function CurrentAffairsSection() {
  const canManage = useAuth((state) => state.permissions.includes('current-affairs:manage'))
  const { token } = useAuth()
  const { toast } = useToast()

  const [list, setList] = useState<EventListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminEventDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // P6-S2: the event's representations (§12 step 4) — the publishing overview.
  const [representations, setRepresentations] = useState<
    Array<{
      id: string
      status: string
      format: string
      language: { code: string }
      revisionCount: number
      scheduledFor: string | null
      liveRevision: { revisionNumber: number } | null
    }>
  >([])
  const [busy, setBusy] = useState<string | null>(null)

  // Create form (§12 steps 1+2 in one call)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    title: '',
    eventDate: '',
    topic: 'current-affairs',
    scope: 'COUNTRY' as 'GLOBAL' | 'COUNTRY',
    location: '',
    summary: '',
    significance: '',
    sourceTitle: '',
    sourcePublisher: '',
    sourceUrl: '',
    sourceType: 'OFFICIAL' as (typeof SOURCE_TYPES)[number],
  })

  // Attach-source / link-unit mini-forms (on the expanded detail)
  const [attachUrl, setAttachUrl] = useState('')
  const [attachTitle, setAttachTitle] = useState('')
  const [attachPublisher, setAttachPublisher] = useState('')
  const [attachType, setAttachType] = useState<(typeof SOURCE_TYPES)[number]>('NEWS_MEDIA')
  const [unitSlug, setUnitSlug] = useState('chandrayaan-3-landing-2023')
  // P6-S3 §12 step 3 — entity + additional-topic linking mini-forms.
  const [entitySlug, setEntitySlug] = useState('isro')
  const [entityNote, setEntityNote] = useState('')
  const [xTopicSlug, setXTopicSlug] = useState('space-technology')
  const [xTopicNote, setXTopicNote] = useState('')

  const authHeaders = { Authorization: `Bearer ${token}` }

  const fetchList = useCallback(async () => {
    if (!token) {
      setList(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/current-affairs/admin/events?pageSize=50', {
        headers: authHeaders,
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<EventListResult>
      if (payload.status === 'ok' && payload.data) setList(payload.data)
      else toast({ title: 'Could not load events', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the current-affairs API.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  const fetchDetail = useCallback(
    async (id: string) => {
      if (!token) return
      setDetailLoading(true)
      try {
        const response = await fetch(`/api/current-affairs/admin/events/${id}`, {
          headers: authHeaders,
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ event: AdminEventDetail }>
        if (payload.status === 'ok' && payload.data) {
          setDetail(payload.data.event)
          // P6-S2: the event's representations (§12 step 4) — authored in the
          // content workspace; shown here as the publishing overview.
          const itemsResponse = await fetch(
            `/api/content/admin/items?event=${encodeURIComponent(payload.data.event.slug)}&pageSize=50`,
            { headers: authHeaders, cache: 'no-store' }
          )
          const itemsPayload = (await itemsResponse.json()) as Envelope<{
            items: Array<{
              id: string
              status: string
              format: string
              language: { code: string }
              revisionCount: number
              scheduledFor: string | null
              liveRevision: { revisionNumber: number } | null
            }>
          }>
          setRepresentations(
            itemsPayload.status === 'ok' && itemsPayload.data ? itemsPayload.data.items : []
          )
        } else {
          toast({ title: 'Could not load the event', description: payload.error?.message, variant: 'destructive' })
        }
      } finally {
        setDetailLoading(false)
      }
    },
    [token, toast]
  )

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
      setRepresentations([])
    } else {
      setExpandedId(id)
      setDetail(null)
      setRepresentations([])
      void fetchDetail(id)
    }
  }

  async function call<T>(key: string, run: () => Promise<Response>, successTitle: string, successDescription?: string) {
    if (!token) return
    setBusy(key)
    try {
      const response = await run()
      const payload = (await response.json()) as Envelope<T>
      if (payload.status === 'ok') {
        toast({ title: successTitle, description: successDescription })
        await fetchList()
        if (expandedId) await fetchDetail(expandedId)
        return payload
      }
      toast({ title: 'Operation failed', description: payload.error?.message, variant: 'destructive' })
      return undefined
    } catch {
      toast({ title: 'Network error', description: 'The current-affairs API is unreachable.', variant: 'destructive' })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.eventDate || !form.summary.trim()) {
      toast({ title: 'Missing fields', description: 'Title, event date and summary are required.', variant: 'destructive' })
      return
    }
    const hasSource = form.sourceUrl.trim().length > 0
    if (hasSource && (!form.sourceTitle.trim() || !form.sourcePublisher.trim())) {
      toast({ title: 'Incomplete initial source', description: 'An initial source needs a title, publisher and URL.', variant: 'destructive' })
      return
    }
    const payload = await call<{ event: AdminEventDetail }>(
      'create',
      () =>
        fetch('/api/current-affairs/admin/events', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title.trim(),
            eventDate: form.eventDate,
            topic: form.topic,
            scope: form.scope,
            ...(form.scope === 'COUNTRY' ? { country: 'IN' } : {}),
            ...(form.location.trim() ? { location: form.location.trim() } : {}),
            summary: form.summary.trim(),
            ...(form.significance.trim() ? { significance: form.significance.trim() } : {}),
            ...(hasSource
              ? {
                  initialSources: [
                    {
                      title: form.sourceTitle.trim(),
                      publisher: form.sourcePublisher.trim(),
                      url: form.sourceUrl.trim(),
                      type: form.sourceType,
                      isPrimary: true,
                    },
                  ],
                }
              : {}),
          }),
        }),
      'Event created (§12 step 1)',
      'The event starts EMERGING — aggregate more sources as they arrive.'
    )
    if (payload?.status === 'ok') {
      setForm({
        title: '',
        eventDate: '',
        topic: 'current-affairs',
        scope: 'COUNTRY',
        location: '',
        summary: '',
        significance: '',
        sourceTitle: '',
        sourcePublisher: '',
        sourceUrl: '',
        sourceType: 'OFFICIAL',
      })
      setShowCreate(false)
    }
  }

  async function handleTransition(id: string, to: Lifecycle) {
    await call(
      `transition-${to}`,
      () =>
        fetch(`/api/current-affairs/admin/events/${id}/transition`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, reason: 'Console demo exercise (P6-S1)' }),
        }),
      `Lifecycle → ${to.toLowerCase()}`,
      '§12 step 6 — every move is audited (§36).'
    )
  }

  async function handleAttachSource(id: string) {
    if (!attachUrl.trim()) {
      toast({ title: 'URL required', description: 'Enter the evidence URL to aggregate.', variant: 'destructive' })
      return
    }
    const payload = await call<{ sourceCreated: boolean; sourceReused: boolean }>(
      'attach',
      () =>
        fetch(`/api/current-affairs/admin/events/${id}/sources`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: attachTitle.trim() || attachUrl.trim(),
            publisher: attachPublisher.trim() || 'Unattributed',
            url: attachUrl.trim(),
            type: attachType,
          }),
        }),
      'Source aggregated (§12 step 2)'
    )
    if (payload?.status === 'ok' && payload.data) {
      const description = payload.data.sourceReused
        ? 'Existing registry record reused by URL (§11 dedup).'
        : payload.data.sourceCreated
          ? 'New evidence registered (UNVERIFIED, §24).'
          : undefined
      if (description) toast({ title: 'Registry note', description })
      setAttachUrl('')
      setAttachTitle('')
      setAttachPublisher('')
    }
  }

  async function handleMakePrimary(eventId: string, linkId: string) {
    await call(
      `primary-${linkId}`,
      () =>
        fetch(`/api/current-affairs/admin/events/${eventId}/sources/${linkId}`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPrimary: true }),
        }),
      'Primary source swapped',
      'At most one lead source per event (§12).'
    )
  }

  async function handleDetachSource(eventId: string, linkId: string) {
    await call(
      `detach-${linkId}`,
      () =>
        fetch(`/api/current-affairs/admin/events/${eventId}/sources/${linkId}`, {
          method: 'DELETE',
          headers: authHeaders,
        }),
      'Source detached',
      'The shared registry record is preserved (§36).'
    )
  }

  async function handleLinkUnit(id: string) {
    if (!unitSlug.trim()) return
    await call(
      'link-unit',
      () =>
        fetch(`/api/current-affairs/admin/events/${id}/knowledge-units`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit: unitSlug.trim() }),
        }),
      'Canonical unit linked (§12 step 3)',
      'VERIFIED units only — the §7 one-truth rule.'
    )
  }

  async function handleUnlinkUnit(eventId: string, linkId: string) {
    await call(
      `unlink-${linkId}`,
      () =>
        fetch(`/api/current-affairs/admin/events/${eventId}/knowledge-units/${linkId}`, {
          method: 'DELETE',
          headers: authHeaders,
        }),
      'Unit link removed'
    )
  }

  // ---------- P6-S3 §12 step 3: entity + additional-topic linking ----------

  async function handleLinkEntity(id: string) {
    if (!entitySlug.trim()) {
      toast({ title: 'Entity required', description: 'Enter the entity slug to link (e.g. isro).', variant: 'destructive' })
      return
    }
    const payload = await call(
      'link-entity',
      () =>
        fetch(`/api/current-affairs/admin/events/${id}/entities`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity: entitySlug.trim(),
            ...(entityNote.trim() ? { note: entityNote.trim() } : {}),
          }),
        }),
      'Entity linked (§12 step 3)',
      'Who/what this event is about — ACTIVE entities only (§36).'
    )
    if (payload?.status === 'ok') {
      setEntityNote('')
    }
  }

  async function handleUnlinkEntity(eventId: string, linkId: string) {
    await call(
      `unlink-entity-${linkId}`,
      () =>
        fetch(`/api/current-affairs/admin/events/${eventId}/entities/${linkId}`, {
          method: 'DELETE',
          headers: authHeaders,
        }),
      'Entity link removed',
      'The registry record and its other links stay (§36).'
    )
  }

  async function handleLinkTopic(id: string) {
    if (!xTopicSlug.trim()) {
      toast({ title: 'Topic required', description: 'Enter the topic slug to cross-file under.', variant: 'destructive' })
      return
    }
    const payload = await call(
      'link-topic',
      () =>
        fetch(`/api/current-affairs/admin/events/${id}/topics`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: xTopicSlug.trim(),
            ...(xTopicNote.trim() ? { note: xTopicNote.trim() } : {}),
          }),
        }),
      'Cross-filing added (§12 step 3)',
      'The primary topic stays the breadcrumb anchor — this is an additional filing.'
    )
    if (payload?.status === 'ok') {
      setXTopicNote('')
    }
  }

  async function handleUnlinkTopic(eventId: string, linkId: string) {
    await call(
      `unlink-topic-${linkId}`,
      () =>
        fetch(`/api/current-affairs/admin/events/${eventId}/topics/${linkId}`, {
          method: 'DELETE',
          headers: authHeaders,
        }),
      'Cross-filing removed'
    )
  }

  const summary = list?.summary

  return (
    <section aria-labelledby="current-affairs-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="current-affairs-heading" className="text-xl font-semibold tracking-tight">
            Current affairs — events &amp; source aggregation
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §12 · event-centric · emerging → stable → archived
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Current affairs are <span className="font-medium text-zinc-800">event-centric, not article-centric</span> (§12):
        one <span className="font-medium text-zinc-800">CurrentEvent</span> per real-world event — whatever the number
        of publishers covering it. Evidence aggregates onto the event from the shared §24 registry (URL-deduped), the
        relevant <span className="font-medium text-zinc-800">VERIFIED</span> KnowledgeUnits link through the §7
        one-truth rule, and the lifecycle matures{' '}
        <span className="font-medium text-zinc-800">emerging → developing → stable → archived</span> with full audit
        history (§36). Publishing/revisions landed in P6-S2; entity and taxonomy linking (this session, P6-S3) tags who/what the
        event is about via the shared Entity registry and cross-files it under additional topics; the exam-aware feed
        in P6-S4; automated freshness rules in P6-S5.
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            API contract (§37)
          </CardTitle>
          <CardDescription>
            The same domain-oriented endpoints a future mobile app consumes (§39) — scoped to{' '}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">current-affairs:manage</code> (ADMIN +
            COUNTRY_ADMIN, the canonical-record precedent).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Contract</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {API_ROWS.map((row) => (
                  <tr key={`${row.method} ${row.path}`} className="bg-white">
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-emerald-700">{row.method}</td>
                    <td className="px-3 py-2 font-mono text-zinc-700">{row.path}</td>
                    <td className="hidden px-3 py-2 text-zinc-500 sm:table-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Editorial workspace — live exercise
          </CardTitle>
          <CardDescription>
            The §12 workflow end-to-end: create an event with its first source, mature the lifecycle, aggregate
            evidence, link canonical knowledge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <div className="space-y-2">
              <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                <ShieldAlert className="mx-auto mb-2 h-5 w-5 text-zinc-400" aria-hidden="true" />
                Managing current events requires an editorial role (ADMIN / COUNTRY_ADMIN — the canonical-record
                permission model). Sign in as <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">admin@globiq.dev</code> to
                exercise the workflow.
              </p>
            </div>
          ) : (
            <>
              {/* Lifecycle overview + actions */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(['EMERGING', 'DEVELOPING', 'STABLE', 'ARCHIVED'] as Lifecycle[]).map((state) => (
                    <Badge key={state} variant="outline" className={`font-normal ${lifecycleStyle[state]}`}>
                      {state.toLowerCase()} · {summary?.[state] ?? 0}
                    </Badge>
                  ))}
                  {list && (
                    <span className="text-xs text-zinc-400">
                      {list.pagination.total} event{list.pagination.total === 1 ? '' : 's'} visible
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchList()}
                    disabled={loading}
                    className="gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowCreate((open) => !open)}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <PlusCircle className="h-4 w-4" aria-hidden="true" />
                    {showCreate ? 'Close' : 'New event (§12 step 1)'}
                  </Button>
                </div>
              </div>

              {/* Create form */}
              {showCreate && (
                <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                  <p className="text-xs font-medium text-emerald-800">
                    Create the event for the real-world happening — before five publishers become five unrelated
                    objects. An initial source can be aggregated in the same call (§12 steps 1+2).
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="event-title" className="text-xs">Title *</Label>
                      <Input
                        id="event-title"
                        value={form.title}
                        onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
                        placeholder="e.g. ISRO announces Gaganyaan crewed flight schedule"
                        className="bg-white text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="event-date" className="text-xs">Event date *</Label>
                      <Input
                        id="event-date"
                        type="date"
                        value={form.eventDate}
                        onChange={(event) => setForm((state) => ({ ...state, eventDate: event.target.value }))}
                        className="bg-white text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="event-topic" className="text-xs">Primary topic (§13) *</Label>
                      <select
                        id="event-topic"
                        value={form.topic}
                        onChange={(event) => setForm((state) => ({ ...state, topic: event.target.value }))}
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
                      >
                        {DEMO_TOPICS.map((topic) => (
                          <option key={topic.slug} value={topic.slug}>{topic.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="event-scope" className="text-xs">Scope (§14) *</Label>
                      <select
                        id="event-scope"
                        value={form.scope}
                        onChange={(event) => setForm((state) => ({ ...state, scope: event.target.value as 'GLOBAL' | 'COUNTRY' }))}
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
                      >
                        <option value="COUNTRY">COUNTRY — IN (India)</option>
                        <option value="GLOBAL">GLOBAL — admin-managed</option>
                      </select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="event-summary" className="text-xs">Summary — what happened *</Label>
                      <textarea
                        id="event-summary"
                        value={form.summary}
                        onChange={(event) => setForm((state) => ({ ...state, summary: event.target.value }))}
                        rows={2}
                        placeholder="One paragraph: the canonical record of what happened."
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="event-location" className="text-xs">Location</Label>
                      <Input
                        id="event-location"
                        value={form.location}
                        onChange={(event) => setForm((state) => ({ ...state, location: event.target.value }))}
                        placeholder="e.g. New Delhi"
                        className="bg-white text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="event-significance" className="text-xs">Significance — why it matters</Label>
                      <Input
                        id="event-significance"
                        value={form.significance}
                        onChange={(event) => setForm((state) => ({ ...state, significance: event.target.value }))}
                        placeholder="e.g. Recurring exam favourite"
                        className="bg-white text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-md border border-dashed border-emerald-300 bg-white p-3">
                    <p className="text-xs font-medium text-zinc-700">Initial source (optional — §12 step 2)</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="source-title" className="text-xs">Source title</Label>
                        <Input
                          id="source-title"
                          value={form.sourceTitle}
                          onChange={(event) => setForm((state) => ({ ...state, sourceTitle: event.target.value }))}
                          placeholder="e.g. PIB release — Gaganyaan schedule"
                          className="bg-white text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="source-publisher" className="text-xs">Publisher</Label>
                        <Input
                          id="source-publisher"
                          value={form.sourcePublisher}
                          onChange={(event) => setForm((state) => ({ ...state, sourcePublisher: event.target.value }))}
                          placeholder="e.g. Press Information Bureau"
                          className="bg-white text-sm"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="source-url" className="text-xs">URL</Label>
                        <Input
                          id="source-url"
                          value={form.sourceUrl}
                          onChange={(event) => setForm((state) => ({ ...state, sourceUrl: event.target.value }))}
                          placeholder="https://pib.gov.in/…"
                          className="bg-white text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="source-type" className="text-xs">Type (§24)</Label>
                        <select
                          id="source-type"
                          value={form.sourceType}
                          onChange={(event) =>
                            setForm((state) => ({ ...state, sourceType: event.target.value as (typeof SOURCE_TYPES)[number] }))
                          }
                          className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
                        >
                          {SOURCE_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => void handleCreate()}
                      disabled={busy === 'create'}
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                      {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlusCircle className="h-4 w-4" aria-hidden="true" />}
                      Create event
                    </Button>
                  </div>
                </div>
              )}

              {/* Events list */}
              {loading && !list ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : list && list.events.length > 0 ? (
                <ul className="space-y-2" aria-label="Current events">
                  {list.events.map((event) => (
                    <li key={event.id} className="rounded-lg border border-zinc-200 bg-white">
                      <button
                        type="button"
                        onClick={() => toggleExpand(event.id)}
                        aria-expanded={expandedId === event.id}
                        className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 max-w-full truncate text-sm font-semibold text-zinc-900">{event.title}</span>
                            <Badge variant="outline" className={`shrink-0 font-normal ${lifecycleStyle[event.lifecycleState]}`}>
                              {event.lifecycleState.toLowerCase()}
                            </Badge>
                            <Badge variant="outline" className={`shrink-0 font-normal ${scopeStyle[event.scope]}`}>
                              {event.scope === 'GLOBAL' ? 'GLOBAL' : event.countryIso ?? 'COUNTRY'}
                            </Badge>
                          </div>
                          <p className="text-xs text-zinc-500">
                            /current-affairs/{event.slug}/ · {formatDate(event.eventDate)}
                            {event.location ? ` · ${event.location}` : ''} · topic {event.topic.name} ·{' '}
                            {event.sourceCount} source{event.sourceCount === 1 ? '' : 's'} ·{' '}
                            {event.unitCount} unit{event.unitCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-emerald-700">
                          {expandedId === event.id ? 'Hide' : 'Open'}
                        </span>
                      </button>

                      {/* Expanded detail */}
                      {expandedId === event.id && (
                        <div className="space-y-4 border-t border-zinc-100 px-4 py-4">
                          {detailLoading || !detail || detail.id !== event.id ? (
                            <Skeleton className="h-32 w-full" />
                          ) : (
                            <>
                              <p className="text-sm text-zinc-700">{detail.summary}</p>
                              {detail.significance && (
                                <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                                  <span className="font-semibold text-zinc-700">Why it matters:</span> {detail.significance}
                                </p>
                              )}

                              {/* Lifecycle transitions */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Lifecycle (§12 step 6) — currently {detail.lifecycleState.toLowerCase()}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {detail.allowedTransitions.map((target) => (
                                    <Button
                                      key={target}
                                      variant="outline"
                                      size="sm"
                                      disabled={busy === `transition-${target}` || !detail.editable && detail.lifecycleState === 'ARCHIVED' && false}
                                      onClick={() => void handleTransition(detail.id, target)}
                                      className="gap-1.5 border-zinc-200 text-xs"
                                    >
                                      {busy === `transition-${target}` && (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                      )}
                                      → {target.toLowerCase()}
                                    </Button>
                                  ))}
                                  {detail.allowedTransitions.length === 0 && (
                                    <span className="text-xs text-zinc-400">No transitions from this state.</span>
                                  )}
                                </div>
                              </div>

                              {/* Aggregated sources */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Aggregated sources (§12 step 2) — {detail.sources.length}
                                </p>
                                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1" aria-label="Aggregated sources">
                                  {detail.sources.map((link) => (
                                    <li
                                      key={link.id}
                                      className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/50 px-3 py-2"
                                    >
                                      <span className="text-sm text-zinc-800">
                                        {link.isPrimary && (
                                          <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Primary source" />
                                        )}
                                        {link.source.publisher}
                                      </span>
                                      <Badge variant="outline" className={`font-normal ${verificationStyle[link.source.verification] ?? ''}`}>
                                        {link.source.verification.toLowerCase()}
                                      </Badge>
                                      <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
                                        {link.source.type}
                                      </Badge>
                                      <a
                                        href={link.source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="truncate text-xs text-emerald-700 underline decoration-emerald-300 underline-offset-2"
                                      >
                                        {link.source.url}
                                      </a>
                                      <span className="ml-auto flex items-center gap-1">
                                        {!link.isPrimary && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy === `primary-${link.id}` || !detail.editable}
                                            onClick={() => void handleMakePrimary(detail.id, link.id)}
                                            className="h-7 px-2 text-xs"
                                          >
                                            Make primary
                                          </Button>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          disabled={busy === `detach-${link.id}` || !detail.editable}
                                          onClick={() => void handleDetachSource(detail.id, link.id)}
                                          className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                          aria-label={`Detach ${link.source.publisher}`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        </Button>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                                {detail.editable && (
                                  <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-200 p-3 sm:flex-row sm:items-end">
                                    <div className="grid flex-1 gap-2 sm:grid-cols-4">
                                      <Input
                                        value={attachTitle}
                                        onChange={(changeEvent) => setAttachTitle(changeEvent.target.value)}
                                        placeholder="Source title"
                                        className="bg-white text-xs"
                                        aria-label="New source title"
                                      />
                                      <Input
                                        value={attachPublisher}
                                        onChange={(changeEvent) => setAttachPublisher(changeEvent.target.value)}
                                        placeholder="Publisher"
                                        className="bg-white text-xs"
                                        aria-label="New source publisher"
                                      />
                                      <Input
                                        value={attachUrl}
                                        onChange={(changeEvent) => setAttachUrl(changeEvent.target.value)}
                                        placeholder="https://… (URL-deduped)"
                                        className="bg-white text-xs"
                                        aria-label="New source URL"
                                      />
                                      <select
                                        value={attachType}
                                        onChange={(changeEvent) => setAttachType(changeEvent.target.value as (typeof SOURCE_TYPES)[number])}
                                        className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                                        aria-label="New source type"
                                      >
                                        {SOURCE_TYPES.map((type) => (
                                          <option key={type} value={type}>{type}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy === 'attach'}
                                      onClick={() => void handleAttachSource(detail.id)}
                                      className="gap-1.5 border-emerald-200 text-emerald-700"
                                    >
                                      {busy === 'attach' ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                      ) : (
                                        <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                      )}
                                      Aggregate
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* Canonical unit links */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Canonical knowledge links (§12 step 3) — {detail.knowledgeUnits.length}
                                </p>
                                {detail.knowledgeUnits.length > 0 ? (
                                  <ul className="space-y-1.5" aria-label="Linked knowledge units">
                                    {detail.knowledgeUnits.map((link) => (
                                      <li
                                        key={link.id}
                                        className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/50 px-3 py-2"
                                      >
                                        <Link2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                        <span className="text-sm text-zinc-800">{link.unit.canonicalName}</span>
                                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
                                          {link.unit.status.toLowerCase()}
                                        </Badge>
                                        <span className="text-xs text-zinc-400">/gk/{link.unit.topicSlug ?? '…'}/{link.unit.slug}/</span>
                                        {detail.editable && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy === `unlink-${link.id}`}
                                            onClick={() => void handleUnlinkUnit(detail.id, link.id)}
                                            className="ml-auto h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                            aria-label={`Unlink ${link.unit.canonicalName}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                          </Button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-zinc-400">
                                    No canonical units linked yet — link the VERIFIED knowledge this event touches.
                                  </p>
                                )}
                                {detail.editable && (
                                  <div className="flex gap-2 rounded-md border border-dashed border-zinc-200 p-3">
                                    <Input
                                      value={unitSlug}
                                      onChange={(changeEvent) => setUnitSlug(changeEvent.target.value)}
                                      placeholder="Knowledge unit slug (e.g. chandrayaan-3-landing-2023)"
                                      className="bg-white text-xs"
                                      aria-label="Knowledge unit slug"
                                    />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy === 'link-unit'}
                                      onClick={() => void handleLinkUnit(detail.id)}
                                      className="shrink-0 gap-1.5 border-emerald-200 text-emerald-700"
                                    >
                                      {busy === 'link-unit' ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                      ) : (
                                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                                      )}
                                      Link unit
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* P6-S3 §12 step 3: entity links — who/what the event is about */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Entities — who/what this is about (§12 step 3) — {detail.entities.length}
                                </p>
                                {detail.entities.length > 0 ? (
                                  <ul className="space-y-1.5" aria-label="Linked entities">
                                    {detail.entities.map((link) => (
                                      <li
                                        key={link.id}
                                        className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/50 px-3 py-2"
                                      >
                                        <Users className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                        <span className="text-sm text-zinc-800">{link.entity.canonicalName}</span>
                                        <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal text-violet-700">
                                          {link.entity.type.toLowerCase()}
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={`font-normal ${
                                            link.entity.status === 'ACTIVE'
                                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                              : 'border-zinc-200 bg-zinc-100 text-zinc-500'
                                          }`}
                                        >
                                          {link.entity.status.toLowerCase()}
                                        </Badge>
                                        <span className="font-mono text-[10px] text-zinc-400">
                                          {link.entity.scope === 'COUNTRY' ? link.entity.countryIso : 'GLOBAL'}
                                        </span>
                                        {link.note && <span className="text-xs italic text-zinc-400">{link.note}</span>}
                                        {detail.editable && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy === `unlink-entity-${link.id}`}
                                            onClick={() => void handleUnlinkEntity(detail.id, link.id)}
                                            className="ml-auto h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                            aria-label={`Unlink ${link.entity.canonicalName}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                          </Button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-zinc-400">
                                    No entities linked yet — tag the people, places and organisations this event involves.
                                  </p>
                                )}
                                {detail.editable && (
                                  <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-200 p-3 sm:flex-row sm:items-end">
                                    <div className="grid flex-1 gap-2 sm:grid-cols-3">
                                      <Input
                                        value={entitySlug}
                                        onChange={(changeEvent) => setEntitySlug(changeEvent.target.value)}
                                        placeholder="Entity slug (e.g. isro)"
                                        className="bg-white text-xs"
                                        aria-label="Entity slug"
                                      />
                                      <Input
                                        value={entityNote}
                                        onChange={(changeEvent) => setEntityNote(changeEvent.target.value)}
                                        placeholder="Why relevant (optional)"
                                        className="bg-white text-xs sm:col-span-2"
                                        aria-label="Entity link note"
                                      />
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy === 'link-entity'}
                                      onClick={() => void handleLinkEntity(detail.id)}
                                      className="shrink-0 gap-1.5 border-violet-200 text-violet-700"
                                    >
                                      {busy === 'link-entity' ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                      ) : (
                                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                                      )}
                                      Link entity
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* P6-S3 §12 step 3: additional-topic cross-filings */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Cross-filings — additional topics (§13) — {detail.additionalTopics.length}
                                </p>
                                {detail.additionalTopics.length > 0 ? (
                                  <ul className="space-y-1.5" aria-label="Additional topic cross-filings">
                                    {detail.additionalTopics.map((link) => (
                                      <li
                                        key={link.id}
                                        className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/50 px-3 py-2"
                                      >
                                        <Tag className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                        <span className="text-sm text-zinc-800">{link.topic.canonicalName}</span>
                                        <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
                                          {link.topic.type.toLowerCase().replace(/_/g, ' ')}
                                        </Badge>
                                        <span className="font-mono text-[10px] text-zinc-400">
                                          {link.topic.scope === 'COUNTRY' ? link.topic.countryIso : 'GLOBAL'}
                                        </span>
                                        {link.note && <span className="text-xs italic text-zinc-400">{link.note}</span>}
                                        {detail.editable && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy === `unlink-topic-${link.id}`}
                                            onClick={() => void handleUnlinkTopic(detail.id, link.id)}
                                            className="ml-auto h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                            aria-label={`Remove ${link.topic.canonicalName} filing`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                          </Button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-zinc-400">
                                    No cross-filings yet — a story often belongs under several branches (§13).
                                  </p>
                                )}
                                {detail.editable && (
                                  <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-200 p-3 sm:flex-row sm:items-end">
                                    <div className="grid flex-1 gap-2 sm:grid-cols-3">
                                      <Input
                                        value={xTopicSlug}
                                        onChange={(changeEvent) => setXTopicSlug(changeEvent.target.value)}
                                        placeholder="Topic slug (e.g. space-technology)"
                                        className="bg-white text-xs"
                                        aria-label="Additional topic slug"
                                      />
                                      <Input
                                        value={xTopicNote}
                                        onChange={(changeEvent) => setXTopicNote(changeEvent.target.value)}
                                        placeholder="Why this filing fits (optional)"
                                        className="bg-white text-xs sm:col-span-2"
                                        aria-label="Cross-filing note"
                                      />
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy === 'link-topic'}
                                      onClick={() => void handleLinkTopic(detail.id)}
                                      className="shrink-0 gap-1.5 border-emerald-200 text-emerald-700"
                                    >
                                      {busy === 'link-topic' ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                      ) : (
                                        <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                                      )}
                                      Cross-file
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* P6-S2: representations (§12 step 4) — the publishing overview */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Representations (§12 step 4) — {representations.length}
                                </p>
                                {representations.length > 0 ? (
                                  <ul className="space-y-1.5" aria-label="Event representations">
                                    {representations.map((item) => (
                                      <li
                                        key={item.id}
                                        className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/50 px-3 py-2"
                                      >
                                        <Badge variant="outline" className="border-orange-200 bg-orange-50 font-normal text-orange-800">
                                          {item.format.replace(/_/g, ' ').toLowerCase()}
                                        </Badge>
                                        <Badge variant="secondary" className="font-mono text-[10px]">{item.language.code}</Badge>
                                        <Badge
                                          variant="outline"
                                          className={`font-normal ${
                                            item.status === 'PUBLISHED'
                                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                              : item.status === 'SCHEDULED'
                                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                                : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                                          }`}
                                        >
                                          {item.status.toLowerCase()}
                                        </Badge>
                                        <span className="text-xs text-zinc-400">
                                          {item.liveRevision
                                            ? `live rev ${item.liveRevision.revisionNumber} · ${item.revisionCount} revision${item.revisionCount === 1 ? '' : 's'}`
                                            : item.scheduledFor
                                              ? `scheduled ${new Date(item.scheduledFor).toLocaleString()}`
                                              : `${item.revisionCount} revision${item.revisionCount === 1 ? '' : 's'}`}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-zinc-400">
                                    No representations yet — author the event's language-specific updates in the{' '}
                                    <span className="font-medium text-zinc-600">Content items</span> workspace (anchor:
                                    current event). Publication is what puts this event on its public page.
                                  </p>
                                )}
                                {representations.some((item) => item.status === 'PUBLISHED') && (
                                  <p className="text-xs text-zinc-400">
                                    Public page: <span className="font-mono">#/current-affairs/{detail.slug}/</span>
                                  </p>
                                )}
                              </div>

                              {!detail.editable && (
                                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                                  This event is <span className="font-semibold">archived</span> and read-only (§36) —
                                  reopen it via a lifecycle transition to edit, aggregate or link.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                  No current events visible in your scope yet — create the first one above.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
