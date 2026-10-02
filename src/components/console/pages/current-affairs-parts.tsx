'use client'

/**
 * GKSetu Console — Current Affairs parts (CONSOLE-S1-C).
 *
 * The shared vocabulary + heavy dialogs for the Current Affairs page: the
 * event DTOs (mirroring §37 payloads), the lifecycle/verification badges, the
 * create/edit editor (§12 steps 1+2 — the initial-source breaking-news flow)
 * and the per-event links manager (§12 steps 2+3 — sources, entities, topics,
 * knowledge units, each with its registry-backed picker).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Loader2,
  Network,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { fieldErrorMap, useConsoleApi } from '@/components/console/ui/console-api'
import { Field, SelectInput, SwitchField, TextArea, TextInput } from '@/components/console/ui/form-fields'

// ---------- DTOs (§37 — mirror /api/current-affairs payloads) ----------

export type CaLifecycle = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'

export const CA_LIFECYCLES: CaLifecycle[] = ['EMERGING', 'DEVELOPING', 'STABLE', 'ARCHIVED']

export interface CaFreshness {
  tier: string
  ageDays: number
  label: string
}

export interface CaEventRow {
  id: string
  slug: string
  title: string
  eventDate: string
  eventEndDate: string | null
  location: string | null
  summary: string
  significance: string | null
  lifecycleState: CaLifecycle
  freshness: CaFreshness
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { slug: string; name: string }
  notes: string | null
  sourceCount: number
  unitCount: number
  entityCount: number
  additionalTopicCount: number
  hasPrimarySource: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

export interface CaSourceLink {
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
}

export interface CaUnitLink {
  id: string
  note: string | null
  linkedAt: string
  unit: { id: string; slug: string; canonicalName: string; status: string; type: string; topicSlug: string | null }
}

export interface CaEntityLink {
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
}

export interface CaTopicLink {
  id: string
  note: string | null
  linkedAt: string
  topic: { id: string; slug: string; canonicalName: string; type: string; status: string; scope: string; countryIso: string | null }
}

export interface CaEventDetail extends CaEventRow {
  sources: CaSourceLink[]
  knowledgeUnits: CaUnitLink[]
  entities: CaEntityLink[]
  additionalTopics: CaTopicLink[]
  allowedTransitions: CaLifecycle[]
  editable: boolean
}

export interface CaListResult {
  events: CaEventRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: Record<CaLifecycle, number>
}

// ---------- picker-feed option types (existing admin registries) ----------

export interface TopicOption {
  slug: string
  name: string
}

export interface EntityOption {
  slug: string
  name: string
  type: string
}

export interface SourceOption {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: string
}

export interface UnitOption {
  slug: string
  name: string
  type: string
}

export interface CountryOption {
  isoCode: string
  name: string
}

export const SOURCE_TYPE_OPTIONS = ['OFFICIAL', 'NEWS_MEDIA', 'INSTITUTIONAL', 'ACADEMIC', 'DATA', 'OTHER'] as const

// ---------- badges ----------

const LIFECYCLE_STYLES: Record<CaLifecycle, string> = {
  EMERGING: 'border-amber-200 bg-amber-50 text-amber-700',
  DEVELOPING: 'border-orange-200 bg-orange-50 text-orange-700',
  STABLE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ARCHIVED: 'border-zinc-200 bg-zinc-100 text-zinc-500',
}

export function LifecycleBadge({ state }: { state: CaLifecycle }) {
  return (
    <Badge variant="outline" className={cn('px-2 py-0 text-[11px] font-medium tracking-wide', LIFECYCLE_STYLES[state])}>
      {state.toLowerCase()}
    </Badge>
  )
}

const VERIFICATION_STYLES: Record<string, string> = {
  VERIFIED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  UNVERIFIED: 'border-zinc-200 bg-zinc-50 text-zinc-500',
  UNRELIABLE: 'border-red-200 bg-red-50 text-red-700',
}

/** The toolkit inputs have no `disabled` prop — freeze them visually instead. */
export function Guard({ disabled, children }: { disabled: boolean; children: React.ReactNode }) {
  if (!disabled) return <>{children}</>
  return <div className="pointer-events-none opacity-60">{children}</div>
}

export function VerificationBadge({ verification }: { verification: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('px-1.5 py-0 text-[10px] font-medium', VERIFICATION_STYLES[verification] ?? 'border-zinc-200 bg-zinc-50 text-zinc-500')}
    >
      {verification.toLowerCase()}
    </Badge>
  )
}

// ---------- the create/edit editor (§12 steps 1 + 2) ----------

interface EventEditorState {
  title: string
  slug: string
  eventDate: string
  eventEndDate: string
  location: string
  summary: string
  significance: string
  topic: string
  scope: 'GLOBAL' | 'COUNTRY'
  country: string
  notes: string
  withSource: boolean
  sourceTitle: string
  sourcePublisher: string
  sourceUrl: string
  sourceType: string
}

const EMPTY_EDITOR: EventEditorState = {
  title: '',
  slug: '',
  eventDate: '',
  eventEndDate: '',
  location: '',
  summary: '',
  significance: '',
  topic: '',
  scope: 'GLOBAL',
  country: '',
  notes: '',
  withSource: false,
  sourceTitle: '',
  sourcePublisher: '',
  sourceUrl: '',
  sourceType: 'NEWS_MEDIA',
}

/** `YYYY-MM-DD` from an ISO timestamp (date inputs want the plain form). */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function EventEditorDialog({
  open,
  onOpenChange,
  event,
  topics,
  countries,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create mode; a row = edit mode (detail is fetched on open). */
  event: CaEventRow | null
  topics: TopicOption[]
  countries: CountryOption[]
  onSaved: () => void
}) {
  const api = useConsoleApi()
  const { toast } = useToast()
  const editing = event !== null

  const [form, setForm] = useState<EventEditorState>(EMPTY_EDITOR)
  const [detail, setDetail] = useState<CaEventDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const set = <K extends keyof EventEditorState>(key: K, value: EventEditorState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // Load the detail (edit mode) or reset (create mode) whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setErrors({})
    if (!event) {
      setDetail(null)
      setForm({ ...EMPTY_EDITOR, topic: topics[0]?.slug ?? '' })
      return
    }
    let cancelled = false
    setLoadingDetail(true)
    void api.get<{ event: CaEventDetail }>(`/api/current-affairs/admin/events/${event.id}`).then((result) => {
      if (cancelled) return
      setLoadingDetail(false)
      if (!result.data) {
        toast({ title: 'Could not load the event', description: result.error?.message, variant: 'destructive' })
        onOpenChange(false)
        return
      }
      const loaded = result.data.event
      setDetail(loaded)
      setForm({
        title: loaded.title,
        slug: loaded.slug,
        eventDate: toDateInput(loaded.eventDate),
        eventEndDate: toDateInput(loaded.eventEndDate),
        location: loaded.location ?? '',
        summary: loaded.summary,
        significance: loaded.significance ?? '',
        topic: loaded.topic.slug,
        scope: loaded.scope,
        country: loaded.countryIso ?? '',
        notes: loaded.notes ?? '',
        withSource: false,
        sourceTitle: '',
        sourcePublisher: '',
        sourceUrl: '',
        sourceType: 'NEWS_MEDIA',
      })
    })
    return () => {
      cancelled = true
    }
  }, [open, event?.id])

  const editable = !editing || (detail?.editable ?? true)

  async function handleSave() {
    setSaving(true)
    setErrors({})
    try {
      let result
      if (editing && event) {
        const patch: Record<string, unknown> = {
          title: form.title.trim(),
          eventDate: form.eventDate,
          ...(form.eventEndDate ? { eventEndDate: form.eventEndDate } : { eventEndDate: null }),
          ...(form.location.trim() ? { location: form.location.trim() } : { location: null }),
          summary: form.summary.trim(),
          ...(form.significance.trim() ? { significance: form.significance.trim() } : { significance: null }),
          topic: form.topic,
          ...(form.notes.trim() ? { notes: form.notes.trim() } : { notes: null }),
        }
        result = await api.patch<{ event: CaEventDetail }>(`/api/current-affairs/admin/events/${event.id}`, patch)
      } else {
        const body: Record<string, unknown> = {
          title: form.title.trim(),
          eventDate: form.eventDate,
          summary: form.summary.trim(),
          topic: form.topic,
          scope: form.scope,
          ...(form.scope === 'COUNTRY' && form.country ? { country: form.country } : {}),
          ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
          ...(form.eventEndDate ? { eventEndDate: form.eventEndDate } : {}),
          ...(form.location.trim() ? { location: form.location.trim() } : {}),
          ...(form.significance.trim() ? { significance: form.significance.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          ...(form.withSource && form.sourceUrl.trim()
            ? {
                initialSources: [
                  {
                    title: form.sourceTitle.trim() || form.sourceUrl.trim(),
                    publisher: form.sourcePublisher.trim() || 'Unattributed',
                    url: form.sourceUrl.trim(),
                    type: form.sourceType,
                    isPrimary: true,
                  },
                ],
              }
            : {}),
        }
        result = await api.post<{ event: CaEventDetail }>('/api/current-affairs/admin/events', body)
      }
      if (result.data) {
        toast({
          title: editing ? 'Event updated' : 'Event created (§12 step 1)',
          description: editing
            ? 'The audited metadata edit landed (§36).'
            : 'The event starts EMERGING — aggregate more sources as they arrive.',
        })
        onOpenChange(false)
        onSaved()
      } else if (result.error) {
        setErrors(fieldErrorMap(result.error.details))
        toast({ title: 'Could not save the event', description: result.error.message, variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const topicOptions = useMemo(() => topics.map((topic) => ({ value: topic.slug, label: topic.name })), [topics])
  const countryOptions = useMemo(
    () => countries.map((country) => ({ value: country.isoCode, label: `${country.isoCode} — ${country.name}` })),
    [countries]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit event' : 'New current event'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Audited metadata edits — slug and scope are immutable (§36); an archived event is read-only.'
              : 'One CurrentEvent per real-world event (§12) — aggregate its first source in the same call.'}
          </DialogDescription>
        </DialogHeader>

        {loadingDetail ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the event…
          </div>
        ) : (
          <div className="gksetu-scroll max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Title" required error={errors.title} className="sm:col-span-2">
                <TextInput
                  id="ca-title"
                  value={form.title}
                  onChange={(value) => set('title', value)}
                  placeholder="e.g. Gaganyaan G1 uncrewed test flight"
                  invalid={!!errors.title}
                  disabled={!editable}
                />
              </Field>
              {editing ? (
                <Field label="Slug (immutable)" hint="URL-stable identity — never editable (§16).">
                  <TextInput id="ca-slug" value={form.slug} onChange={() => undefined} disabled className="font-mono text-xs" />
                </Field>
              ) : (
                <Field label="Slug" hint="Optional — generated from the title when omitted." error={errors.slug}>
                  <TextInput
                    id="ca-slug"
                    value={form.slug}
                    onChange={(value) => set('slug', value)}
                    placeholder="auto-generated"
                    invalid={!!errors.slug}
                    disabled={!editable}
                  />
                </Field>
              )}
              <Field label="Event date" required error={errors.eventDate}>
                <TextInput
                  id="ca-date"
                  type="date"
                  value={form.eventDate}
                  onChange={(value) => set('eventDate', value)}
                  invalid={!!errors.eventDate}
                  disabled={!editable}
                />
              </Field>
              <Field label="Span end (optional)" error={errors.eventEndDate}>
                <TextInput
                  id="ca-end"
                  type="date"
                  value={form.eventEndDate}
                  onChange={(value) => set('eventEndDate', value)}
                  invalid={!!errors.eventEndDate}
                  disabled={!editable}
                />
              </Field>
              <Field label="Location (optional)" error={errors.location}>
                <TextInput
                  id="ca-location"
                  value={form.location}
                  onChange={(value) => set('location', value)}
                  placeholder="e.g. Sriharikota"
                  invalid={!!errors.location}
                  disabled={!editable}
                />
              </Field>
              <Field label="Summary" required error={errors.summary} className="sm:col-span-2" hint="One paragraph a learner retains.">
                <Guard disabled={!editable}>
                  <TextArea
                    id="ca-summary"
                    value={form.summary}
                    onChange={(value) => set('summary', value)}
                    rows={3}
                    invalid={!!errors.summary}
                  />
                </Guard>
              </Field>
              <Field label="Significance (optional)" className="sm:col-span-2" hint="Why this matters for exams.">
                <Guard disabled={!editable}>
                  <TextArea id="ca-significance" value={form.significance} onChange={(value) => set('significance', value)} rows={2} />
                </Guard>
              </Field>
              <Field label="Primary topic" required error={errors.topic}>
                <Guard disabled={!editable}>
                  <SelectInput
                    id="ca-topic"
                    value={form.topic}
                    onChange={(value) => set('topic', value)}
                    options={topicOptions}
                    placeholder={topicOptions.length ? 'Choose…' : 'Loading…'}
                    invalid={!!errors.topic}
                  />
                </Guard>
              </Field>
              {editing ? (
                <Field label="Scope (immutable)" hint="§14 identity — corrected by archiving and recreating.">
                  <TextInput
                    id="ca-scope"
                    value={form.scope === 'GLOBAL' ? 'GLOBAL' : `COUNTRY · ${form.country || '—'}`}
                    onChange={() => undefined}
                    disabled
                  />
                </Field>
              ) : (
                <>
                  <Field label="Scope" required hint="GLOBAL (world-relevant) or one country market (§14).">
                    <SelectInput
                      id="ca-scope"
                      value={form.scope}
                      onChange={(value) => {
                        set('scope', value as 'GLOBAL' | 'COUNTRY')
                        if (value === 'GLOBAL') set('country', '')
                      }}
                      options={[
                        { value: 'GLOBAL', label: 'GLOBAL — all markets' },
                        { value: 'COUNTRY', label: 'COUNTRY — one market' },
                      ]}
                    />
                  </Field>
                  {form.scope === 'COUNTRY' && (
                    <Field label="Country" required error={errors.country} hint="ISO market the event belongs to.">
                      <SelectInput
                        id="ca-country"
                        value={form.country}
                        onChange={(value) => set('country', value)}
                        options={countryOptions}
                        placeholder="Choose…"
                        invalid={!!errors.country}
                      />
                    </Field>
                  )}
                </>
              )}
              <Field label="Internal notes (optional)" className="sm:col-span-2">
                <Guard disabled={!editable}>
                  <TextArea id="ca-notes" value={form.notes} onChange={(value) => set('notes', value)} rows={2} />
                </Guard>
              </Field>
            </div>

            {!editing && (
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <SwitchField
                  label="Aggregate the first source now"
                  hint="The breaking-news flow — register the lead evidence with the event (§12 step 2)."
                  checked={form.withSource}
                  onChange={(checked) => set('withSource', checked)}
                />
                {form.withSource && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Source title" required error={errors.sourceTitle ?? errors.initialSources}>
                      <TextInput
                        id="ca-src-title"
                        value={form.sourceTitle}
                        onChange={(value) => set('sourceTitle', value)}
                        placeholder="e.g. ISRO mission page"
                      />
                    </Field>
                    <Field label="Publisher" required>
                      <TextInput
                        id="ca-src-publisher"
                        value={form.sourcePublisher}
                        onChange={(value) => set('sourcePublisher', value)}
                        placeholder="e.g. ISRO"
                      />
                    </Field>
                    <Field label="URL" required className="sm:col-span-2">
                      <TextInput
                        id="ca-src-url"
                        value={form.sourceUrl}
                        onChange={(value) => set('sourceUrl', value)}
                        placeholder="https://…"
                      />
                    </Field>
                    <Field label="Type">
                      <SelectInput
                        id="ca-src-type"
                        value={form.sourceType}
                        onChange={(value) => set('sourceType', value)}
                        options={SOURCE_TYPE_OPTIONS.map((type) => ({ value: type, label: type.replace('_', ' ') }))}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || loadingDetail || !editable}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {editing ? 'Save changes' : 'Create event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- the links manager (§12 steps 2 + 3) ----------

function LinkRow({
  title,
  meta,
  badge,
  note,
  busy,
  onRemove,
  onMakePrimary,
  isPrimary,
}: {
  title: React.ReactNode
  meta: React.ReactNode
  badge?: React.ReactNode
  note?: string | null
  busy: boolean
  onRemove: () => void
  onMakePrimary?: () => void
  isPrimary?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {isPrimary && (
            <Star className="h-3.5 w-3.5 shrink-0 fill-emerald-500 text-emerald-500" aria-label="Primary source" />
          )}
          <p className="truncate text-[13px] font-medium text-zinc-800">{title}</p>
          {badge}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">{meta}</p>
        {note && <p className="mt-0.5 truncate text-[11px] italic text-zinc-400">“{note}”</p>}
      </div>
      {onMakePrimary && !isPrimary && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-zinc-500 hover:text-emerald-700"
          onClick={onMakePrimary}
          disabled={busy}
        >
          <Star className="mr-1 h-3 w-3" aria-hidden="true" /> Make primary
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-zinc-400 hover:text-red-600"
        onClick={onRemove}
        disabled={busy}
        aria-label="Remove link"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}

function EmptyLinks({ hint }: { hint: string }) {
  return <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-4 text-center text-xs text-zinc-400">{hint}</p>
}

export function EventLinksDialog({
  open,
  onOpenChange,
  event,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  event: { id: string; title: string } | null
  onChanged: () => void
}) {
  const api = useConsoleApi()
  const { toast } = useToast()

  const [detail, setDetail] = useState<CaEventDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Option feeds (loaded once per open — existing admin registries).
  const [topicOptions, setTopicOptions] = useState<TopicOption[]>([])
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([])
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([])
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([])

  // Add-form state.
  const [sourceMode, setSourceMode] = useState<'existing' | 'new'>('existing')
  const [sourcePick, setSourcePick] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourcePublisher, setSourcePublisher] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceType, setSourceType] = useState<string>('NEWS_MEDIA')
  const [entityPick, setEntityPick] = useState('')
  const [topicPick, setTopicPick] = useState('')
  const [unitPick, setUnitPick] = useState('')
  const [addNote, setAddNote] = useState('')

  const fetchDetail = useCallback(
    async (id: string) => {
      setLoading(true)
      const result = await api.get<{ event: CaEventDetail }>(`/api/current-affairs/admin/events/${id}`)
      setLoading(false)
      if (result.data) setDetail(result.data.event)
      else toast({ title: 'Could not load the event', description: result.error?.message, variant: 'destructive' })
    },
    [api, toast]
  )

  useEffect(() => {
    if (!open || !event) return
    setDetail(null)
    setSourcePick('')
    setSourceTitle('')
    setSourcePublisher('')
    setSourceUrl('')
    setEntityPick('')
    setTopicPick('')
    setUnitPick('')
    setAddNote('')
    void fetchDetail(event.id)

    let cancelled = false
    const fetchOptions = async () => {
      const [treeRes, entitiesRes, sourcesRes, unitsRes] = await Promise.all([
        api.get<{ tree: Array<{ slug: string; canonicalName: string; children: unknown[] }> }>('/api/taxonomy/admin/tree'),
        api.get<{ entities: Array<{ slug: string; canonicalName: string; type: string }> }>('/api/entities/admin?status=ACTIVE&pageSize=100'),
        api.get<{ sources: SourceOption[] }>('/api/content/admin/sources?pageSize=100'),
        api.get<{ units: Array<{ slug: string; canonicalName: string; type: string }> }>('/api/knowledge/admin/units?status=VERIFIED&pageSize=100'),
      ])
      if (cancelled) return
      // The topic tree is nested — flatten it (§13).
      const flatTopics: TopicOption[] = []
      const walk = (nodes: Array<{ slug: string; canonicalName: string; children: unknown[] }>): void => {
        for (const node of nodes) {
          flatTopics.push({ slug: node.slug, name: node.canonicalName })
          walk(node.children as typeof nodes)
        }
      }
      if (treeRes.data) walk(treeRes.data.tree)
      setTopicOptions(flatTopics)
      setEntityOptions((entitiesRes.data?.entities ?? []).map((entity) => ({ slug: entity.slug, name: entity.canonicalName, type: entity.type })))
      setSourceOptions(sourcesRes.data?.sources ?? [])
      setUnitOptions((unitsRes.data?.units ?? []).map((unit) => ({ slug: unit.slug, name: unit.canonicalName, type: unit.type })))
    }
    void fetchOptions()
    return () => {
      cancelled = true
    }
  }, [open, event?.id])

  /** Run a link mutation, refresh the detail + tell the parent (counts). */
  const runLinkAction = useCallback(
    async (key: string, run: () => Promise<{ ok: boolean; message?: string }>, successTitle: string, successDescription?: string) => {
      setBusy(key)
      try {
        const outcome = await run()
        if (outcome.ok) {
          toast({ title: successTitle, description: successDescription ?? outcome.message })
          if (event) await fetchDetail(event.id)
          onChanged()
          return true
        }
        return false
      } finally {
        setBusy(null)
      }
    },
    [event, fetchDetail, onChanged, toast]
  )

  async function handleAttachSource() {
    if (!event) return
    const body =
      sourceMode === 'existing'
        ? { source: sourcePick }
        : {
            title: sourceTitle.trim() || sourceUrl.trim(),
            publisher: sourcePublisher.trim() || 'Unattributed',
            url: sourceUrl.trim(),
            type: sourceType,
            ...(addNote.trim() ? { note: addNote.trim() } : {}),
          }
    await runLinkAction(
      'attach-source',
      async () => {
        const result = await api.post<{ sourceCreated: boolean; sourceReused: boolean }>(
          `/api/current-affairs/admin/events/${event.id}/sources`,
          body
        )
        if (!result.data) return { ok: false, message: result.error?.message }
        const description = result.data.sourceReused
          ? 'Existing registry record reused by URL (§11 dedup).'
          : result.data.sourceCreated
            ? 'New evidence registered (UNVERIFIED, §24).'
            : undefined
        return { ok: true, message: description }
      },
      'Source aggregated (§12 step 2)'
    )
    if (sourceMode === 'existing') setSourcePick('')
    else {
      setSourceTitle('')
      setSourcePublisher('')
      setSourceUrl('')
    }
    setAddNote('')
  }

  async function handleAttach(kind: 'entities' | 'topics' | 'knowledge-units') {
    if (!event) return
    const pick = kind === 'entities' ? entityPick : kind === 'topics' ? topicPick : unitPick
    if (!pick) return
    const label = kind === 'entities' ? 'Entity linked' : kind === 'topics' ? 'Cross-filing added' : 'Canonical unit linked'
    await runLinkAction(
      `attach-${kind}`,
      async () => {
        const body =
          kind === 'entities'
            ? { entity: pick, ...(addNote.trim() ? { note: addNote.trim() } : {}) }
            : kind === 'topics'
              ? { topic: pick, ...(addNote.trim() ? { note: addNote.trim() } : {}) }
              : { unit: pick, ...(addNote.trim() ? { note: addNote.trim() } : {}) }
        const result = await api.post(`/api/current-affairs/admin/events/${event.id}/${kind}`, body)
        if (!result.data) return { ok: false, message: result.error?.message }
        return { ok: true }
      },
      label
    )
    if (kind === 'entities') setEntityPick('')
    if (kind === 'topics') setTopicPick('')
    if (kind === 'knowledge-units') setUnitPick('')
    setAddNote('')
  }

  async function handleRemove(kind: 'sources' | 'entities' | 'topics' | 'knowledge-units', linkId: string) {
    if (!event) return
    await runLinkAction(
      `remove-${linkId}`,
      async () => {
        const result = await api.del(`/api/current-affairs/admin/events/${event.id}/${kind}/${linkId}`)
        if (!result.data) return { ok: false, message: result.error?.message }
        return { ok: true }
      },
      'Link removed',
      'The registry record and its other links are preserved (§36).'
    )
  }

  async function handleMakePrimary(linkId: string) {
    if (!event) return
    await runLinkAction(
      `primary-${linkId}`,
      async () => {
        const result = await api.patch(`/api/current-affairs/admin/events/${event.id}/sources/${linkId}`, { isPrimary: true })
        if (!result.data) return { ok: false, message: result.error?.message }
        return { ok: true }
      },
      'Primary source swapped',
      'At most one lead source per event (§12).'
    )
  }

  const sourceSelectOptions = useMemo(
    () =>
      sourceOptions.map((source) => ({
        value: source.id,
        label: `${source.title} — ${source.publisher}`,
      })),
    [sourceOptions]
  )
  const entitySelectOptions = useMemo(
    () => entityOptions.map((entity) => ({ value: entity.slug, label: `${entity.name} (${entity.type.toLowerCase()})` })),
    [entityOptions]
  )
  const topicSelectOptions = useMemo(() => topicOptions.map((topic) => ({ value: topic.slug, label: topic.name })), [topicOptions])
  const unitSelectOptions = useMemo(
    () => unitOptions.map((unit) => ({ value: unit.slug, label: `${unit.name} (${unit.type.replace('_', ' ').toLowerCase()})` })),
    [unitOptions]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Links — {event?.title}
          </DialogTitle>
          <DialogDescription>
            The §12 aggregation surface: evidence, who/what it is about, cross-filings and the canonical knowledge it touches.
          </DialogDescription>
        </DialogHeader>

        {loading && !detail ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the event…
          </div>
        ) : (
          <Tabs defaultValue="sources">
            <TabsList className="h-8 w-full justify-start overflow-x-auto">
              <TabsTrigger value="sources" className="text-[12px]">
                Sources {detail ? `(${detail.sources.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="entities" className="text-[12px]">
                Entities {detail ? `(${detail.entities.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="topics" className="text-[12px]">
                Topics {detail ? `(${detail.additionalTopics.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="units" className="text-[12px]">
                Knowledge units {detail ? `(${detail.knowledgeUnits.length})` : ''}
              </TabsTrigger>
            </TabsList>

            {/* ---- Sources (§12 step 2) ---- */}
            <TabsContent value="sources" className="space-y-3">
              {detail?.sources.length ? (
                <div className="space-y-2">
                  {detail.sources.map((link) => (
                    <LinkRow
                      key={link.id}
                      title={link.source.title}
                      meta={
                        <>
                          {link.source.publisher} · {link.source.type.replace('_', ' ').toLowerCase()} ·{' '}
                          <span className="font-mono">{link.source.url.replace(/^https?:\/\//, '').slice(0, 42)}</span>
                        </>
                      }
                      badge={<VerificationBadge verification={link.source.verification} />}
                      note={link.note}
                      isPrimary={link.isPrimary}
                      busy={busy === `remove-${link.id}` || busy === `primary-${link.id}`}
                      onRemove={() => void handleRemove('sources', link.id)}
                      onMakePrimary={() => void handleMakePrimary(link.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyLinks hint="No evidence aggregated yet — add the first source below." />
              )}
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-zinc-700">Aggregate evidence</p>
                  <div className="w-44">
                    <SelectInput
                      value={sourceMode}
                      onChange={(value) => setSourceMode(value as 'existing' | 'new')}
                      options={[
                        { value: 'existing', label: 'Cite registry source' },
                        { value: 'new', label: 'Register new by URL' },
                      ]}
                    />
                  </div>
                </div>
                {sourceMode === 'existing' ? (
                  <Field label="Shared-registry source" hint="§24 evidence records — URL-deduped.">
                    <SelectInput
                      value={sourcePick}
                      onChange={setSourcePick}
                      options={sourceSelectOptions}
                      placeholder={sourceSelectOptions.length ? 'Choose…' : 'Loading…'}
                    />
                  </Field>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Title" required>
                      <TextInput value={sourceTitle} onChange={setSourceTitle} placeholder="Evidence title" />
                    </Field>
                    <Field label="Publisher" required>
                      <TextInput value={sourcePublisher} onChange={setSourcePublisher} placeholder="Publisher" />
                    </Field>
                    <Field label="URL" required className="sm:col-span-2">
                      <TextInput value={sourceUrl} onChange={setSourceUrl} placeholder="https://…" />
                    </Field>
                    <Field label="Type">
                      <SelectInput
                        value={sourceType}
                        onChange={setSourceType}
                        options={SOURCE_TYPE_OPTIONS.map((type) => ({ value: type, label: type.replace('_', ' ') }))}
                      />
                    </Field>
                  </div>
                )}
                <Field label="Attribution note (optional)">
                  <TextInput value={addNote} onChange={setAddNote} placeholder="What this source adds" />
                </Field>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleAttachSource()}
                  disabled={busy === 'attach-source' || (sourceMode === 'existing' ? !sourcePick : !sourceUrl.trim())}
                >
                  {busy === 'attach-source' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Aggregate source
                </Button>
              </div>
            </TabsContent>

            {/* ---- Entities (§12 step 3) ---- */}
            <TabsContent value="entities" className="space-y-3">
              {detail?.entities.length ? (
                <div className="space-y-2">
                  {detail.entities.map((link) => (
                    <LinkRow
                      key={link.id}
                      title={link.entity.canonicalName}
                      meta={`${link.entity.type.replace('_', ' ').toLowerCase()} · ${link.entity.slug}`}
                      note={link.note}
                      busy={busy === `remove-${link.id}`}
                      onRemove={() => void handleRemove('entities', link.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyLinks hint="No entities linked — tag who/what this event is about." />
              )}
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <p className="text-[13px] font-medium text-zinc-700">Link an entity</p>
                <Field label="Entity (ACTIVE only — §36)">
                  <SelectInput
                    value={entityPick}
                    onChange={setEntityPick}
                    options={entitySelectOptions}
                    placeholder={entitySelectOptions.length ? 'Choose…' : 'Loading…'}
                  />
                </Field>
                <Field label="Note (optional)">
                  <TextInput value={addNote} onChange={setAddNote} placeholder="e.g. The agency behind the launch" />
                </Field>
                <Button size="sm" className="gap-1.5" onClick={() => void handleAttach('entities')} disabled={busy === 'attach-entities' || !entityPick}>
                  {busy === 'attach-entities' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Link entity
                </Button>
              </div>
            </TabsContent>

            {/* ---- Topics (§12 step 3, additional cross-filings) ---- */}
            <TabsContent value="topics" className="space-y-3">
              {detail ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11px] leading-relaxed text-emerald-800">
                  Primary topic: <span className="font-medium">{detail.topic.name}</span> — the breadcrumb anchor. Cross-filings below
                  are additional.
                </p>
              ) : null}
              {detail?.additionalTopics.length ? (
                <div className="space-y-2">
                  {detail.additionalTopics.map((link) => (
                    <LinkRow
                      key={link.id}
                      title={link.topic.canonicalName}
                      meta={`${link.topic.type.replace('_', ' ').toLowerCase()} · ${link.topic.slug}`}
                      note={link.note}
                      busy={busy === `remove-${link.id}`}
                      onRemove={() => void handleRemove('topics', link.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyLinks hint="No cross-filings — file the event under additional topics." />
              )}
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <p className="text-[13px] font-medium text-zinc-700">Cross-file under a topic</p>
                <Field label="Topic (§13 containment applies)">
                  <SelectInput
                    value={topicPick}
                    onChange={setTopicPick}
                    options={topicSelectOptions}
                    placeholder={topicSelectOptions.length ? 'Choose…' : 'Loading…'}
                  />
                </Field>
                <Field label="Note (optional)">
                  <TextInput value={addNote} onChange={setAddNote} placeholder="Why this filing" />
                </Field>
                <Button size="sm" className="gap-1.5" onClick={() => void handleAttach('topics')} disabled={busy === 'attach-topics' || !topicPick}>
                  {busy === 'attach-topics' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Add cross-filing
                </Button>
              </div>
            </TabsContent>

            {/* ---- Knowledge units (§12 step 3, §7 one-truth) ---- */}
            <TabsContent value="units" className="space-y-3">
              {detail?.knowledgeUnits.length ? (
                <div className="space-y-2">
                  {detail.knowledgeUnits.map((link) => (
                    <LinkRow
                      key={link.id}
                      title={
                        <span className="inline-flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                          {link.unit.canonicalName}
                        </span>
                      }
                      meta={`${link.unit.type.replace('_', ' ').toLowerCase()} · ${link.unit.slug}`}
                      note={link.note}
                      busy={busy === `remove-${link.id}`}
                      onRemove={() => void handleRemove('knowledge-units', link.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyLinks hint="No canonical units linked — VERIFIED units only (§7 one-truth)." />
              )}
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <p className="text-[13px] font-medium text-zinc-700">Link a knowledge unit</p>
                <Field label="Unit (VERIFIED only)">
                  <SelectInput
                    value={unitPick}
                    onChange={setUnitPick}
                    options={unitSelectOptions}
                    placeholder={unitSelectOptions.length ? 'Choose…' : 'Loading…'}
                  />
                </Field>
                <Field label="Note (optional)">
                  <TextInput value={addNote} onChange={setAddNote} placeholder="Which fact of the event this anchors" />
                </Field>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleAttach('knowledge-units')}
                  disabled={busy === 'attach-knowledge-units' || !unitPick}
                >
                  {busy === 'attach-knowledge-units' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Link unit
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
