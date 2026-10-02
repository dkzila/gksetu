'use client'

/**
 * GKSetu Console — Posts page parts (CONSOLE-S1-B).
 *
 * The create/edit dialog (with the §7/§12 anchor picker — a knowledge unit OR
 * a current event) and the per-item evidence manager (§24 claim/content-level
 * citations). The list page itself lives in posts-page.tsx; API contracts were
 * verified against /api/content/admin/items* and /api/content/admin/sources*.
 */
import { ReactNode, useEffect, useState } from 'react'
import {
  Bot,
  Building2,
  Check,
  ExternalLink,
  Globe2,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, SelectInput, SwitchField, TextArea, TextInput } from '@/components/console/ui/form-fields'
import { formatWhen, StatusBadge } from '@/components/console/ui/primitives'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { pretty, TrustBadge, useDebounced, useLatestApi } from './s1b-shared'

// ---------- Row / API types (verified against the live API) ----------

export interface AdminItem {
  id: string
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  format: string
  language: { code: string; name: string; nativeName: string | null }
  title: string
  body: string
  unit: { id: string; slug: string; canonicalName: string; status: string; scope: 'GLOBAL' | 'COUNTRY'; countryIso: string | null } | null
  event: { id: string; slug: string; title: string; lifecycleState: string; scope: 'GLOBAL' | 'COUNTRY'; countryIso: string | null } | null
  liveRevision: { revisionNumber: number; publishedAt: string; publishedBy: string | null } | null
  revisionCount: number
  aiAssisted: boolean
  sourceCount: number
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: string[]
  anchorPublishable: boolean
  anchorBlockReason: string | null
}

export type TransitionAction = 'submit_review' | 'send_back' | 'schedule' | 'publish' | 'retire'

export interface LanguageOption {
  code: string
  name: string
  nativeName: string | null
}

/** §23 per-format body rules (mirrors server validation — the server is authoritative). */
const FORMAT_BODY_RULES: Record<string, { min: number; max: number; hint: string }> = {
  FACT_CARD: { min: 20, max: 1500, hint: 'One crisp paragraph — the quick-fact layer.' },
  EXPLAINER: { min: 300, max: 50000, hint: 'A full article with genuine depth (300+ characters).' },
  REVISION_NOTE: { min: 60, max: 10000, hint: 'Compact, structured takeaways.' },
  CURRENT_EVENT_UPDATE: { min: 120, max: 20000, hint: 'A source-backed update on what changed.' },
  TIMELINE: { min: 100, max: 30000, hint: 'One event per line — “date — event”.' },
  PROFILE: { min: 120, max: 30000, hint: 'A structured person/place/organisation profile.' },
  COMPARISON: { min: 120, max: 30000, hint: 'A side-by-side comparison of the distinguishing axes.' },
}

export const POST_FORMATS = Object.keys(FORMAT_BODY_RULES)

// ==================================================================
// Create / edit dialog
// ==================================================================

interface AnchorSelection {
  kind: 'unit' | 'event'
  slug: string
  name: string
  meta: string
}

export function PostEditorDialog({
  open,
  onOpenChange,
  item,
  languages,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null → create mode; otherwise the working copy is edited. */
  item: AdminItem | null
  languages: LanguageOption[]
  onSaved: (item: AdminItem) => void
}) {
  // DialogContent unmounts on close, so the form below re-mounts (fresh state)
  // every time the dialog opens — no reset effects needed.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {item ? <EditPostForm item={item} onSaved={onSaved} onDone={() => onOpenChange(false)} /> : <CreatePostForm languages={languages} onSaved={onSaved} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function EditPostForm({ item, onSaved, onDone }: { item: AdminItem; onSaved: (item: AdminItem) => void; onDone: () => void }) {
  const api = useLatestApi()
  const { toast } = useToast()
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body)
  const [aiAssisted, setAiAssisted] = useState(item.aiAssisted)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const rules = FORMAT_BODY_RULES[item.format] ?? FORMAT_BODY_RULES.FACT_CARD!
  const readOnly = !item.canEdit

  async function save() {
    setSaving(true)
    setFieldErrors({})
    const { data, error } = await api.current.patch<{ item: AdminItem }>(`/api/content/admin/items/${item.id}`, {
      title,
      body,
      aiAssisted,
    })
    setSaving(false)
    if (data) {
      toast({
        title: 'Working copy saved',
        description: item.status === 'PUBLISHED' ? 'Staged silently — the public still sees the live revision until you publish again.' : 'Saved.',
      })
      onSaved(data.item)
      onDone()
    } else {
      setFieldErrors(fieldErrorsFrom(error))
      if (!error?.details) toast({ title: 'Could not save', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit post</DialogTitle>
        <DialogDescription>
          Editing the working copy of a <span className="font-medium text-zinc-700">{pretty(item.format)}</span> in{' '}
          <span className="font-medium text-zinc-700">{item.language.name}</span>. Identity (anchor · language · format) is immutable.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2.5 text-[13px] sm:grid-cols-4">
          <IdentityCell label="Anchor" value={item.unit ? item.unit.canonicalName : item.event ? item.event.title : '—'} sub={item.unit ? 'knowledge unit' : 'current event'} />
          <IdentityCell label="Language" value={item.language.name} sub={item.language.code} />
          <IdentityCell label="Format" value={pretty(item.format)} sub={`${rules.min}–${rules.max} chars`} />
          <IdentityCell
            label="Status"
            value={<StatusBadge status={item.status} />}
            sub={item.liveRevision ? `live rev ${item.liveRevision.revisionNumber}` : item.scheduledFor ? `due ${formatWhen(item.scheduledFor)}` : `${item.revisionCount} revisions`}
          />
        </div>

        {readOnly && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            This item is read-only in its current lifecycle state.
          </p>
        )}

        <Field label="Title" htmlFor="post-edit-title" error={fieldErrors.title} required>
          <TextInput id="post-edit-title" value={title} onChange={setTitle} disabled={readOnly} invalid={Boolean(fieldErrors.title)} placeholder="The representation's title" />
        </Field>

        <Field
          label="Body"
          htmlFor="post-edit-body"
          error={fieldErrors.body}
          hint={`${rules.hint} · ${body.trim().length}/${rules.min}–${rules.max} characters.`}
        >
          {readOnly ? (
            <p className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-600">{body}</p>
          ) : (
            <TextArea id="post-edit-body" value={body} onChange={setBody} rows={10} invalid={Boolean(fieldErrors.body)} />
          )}
        </Field>

        <SwitchField
          label="AI-assisted drafting"
          hint="Working-copy flag — snapshotted onto the next published revision (§26)."
          checked={aiAssisted}
          onChange={readOnly ? () => undefined : setAiAssisted}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || readOnly} className="bg-emerald-600 hover:bg-emerald-700">
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Save changes
        </Button>
      </DialogFooter>
    </>
  )
}

function IdentityCell({ label, value, sub }: { label: string; value: ReactNode; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="truncate text-[13px] font-medium text-zinc-700">{value}</p>
      {sub && <p className="truncate text-[11px] text-zinc-400">{sub}</p>}
    </div>
  )
}

function CreatePostForm({
  languages,
  onSaved,
  onDone,
}: {
  languages: LanguageOption[]
  onSaved: (item: AdminItem) => void
  onDone: () => void
}) {
  const [anchor, setAnchor] = useState<AnchorSelection | null>(null)
  const [language, setLanguage] = useState(languages[0]?.code ?? 'en')
  const [format, setFormat] = useState('FACT_CARD')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [aiAssisted, setAiAssisted] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  const api = useLatestApi()
  const { toast } = useToast()
  const rules = FORMAT_BODY_RULES[format] ?? FORMAT_BODY_RULES.FACT_CARD!
  // The server reports anchor problems on `unit`/`event` — surface both here.
  const anchorError = fieldErrors.anchor ?? fieldErrors.unit ?? fieldErrors.event

  async function submit() {
    if (!anchor) return
    setCreating(true)
    setFieldErrors({})
    const payload = {
      ...(anchor.kind === 'event' ? { event: anchor.slug } : { unit: anchor.slug }),
      language,
      format,
      title,
      body,
      aiAssisted,
    }
    const { data, error } = await api.current.post<{ item: AdminItem }>('/api/content/admin/items', payload)
    setCreating(false)
    if (data) {
      toast({ title: 'Post created', description: 'Entered DRAFT — submit it for review, then publish or schedule.' })
      onSaved(data.item)
      onDone()
    } else {
      setFieldErrors(fieldErrorsFrom(error))
      if (!error?.details) toast({ title: 'Could not create the post', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New post</DialogTitle>
        <DialogDescription>
          One rendering per anchor × language × format (§7). The anchor is a knowledge unit or a current event — never both.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <AnchorPicker
          selected={anchor}
          onSelect={(next) => {
            setAnchor(next)
            if (next && anchorError) setFieldErrors((prev) => ({ ...prev, anchor: '', unit: '', event: '' }))
            if (next?.kind === 'event' && format === 'FACT_CARD') setFormat('CURRENT_EVENT_UPDATE')
          }}
          error={anchorError}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Language"
            htmlFor="post-new-language"
            error={fieldErrors.language}
            hint="Must be configured for the anchor's country when the anchor is country-scoped (§35)."
          >
            <SelectInput
              id="post-new-language"
              value={language}
              onChange={setLanguage}
              invalid={Boolean(fieldErrors.language)}
              options={languages.map((entry) => ({ value: entry.code, label: `${entry.name} (${entry.code})` }))}
            />
          </Field>
          <Field label="Format" htmlFor="post-new-format" error={fieldErrors.format}>
            <SelectInput
              id="post-new-format"
              value={format}
              onChange={setFormat}
              invalid={Boolean(fieldErrors.format)}
              options={POST_FORMATS.map((value) => ({ value, label: pretty(value) }))}
            />
          </Field>
        </div>

        <Field label="Title" htmlFor="post-new-title" error={fieldErrors.title} required>
          <TextInput id="post-new-title" value={title} onChange={setTitle} invalid={Boolean(fieldErrors.title)} placeholder="e.g. The Attorney General — Article 76" />
        </Field>

        <Field
          label="Body"
          htmlFor="post-new-body"
          error={fieldErrors.body}
          hint={`${rules.hint} · ${body.trim().length}/${rules.min}–${rules.max} characters.`}
        >
          <TextArea id="post-new-body" value={body} onChange={setBody} rows={9} invalid={Boolean(fieldErrors.body)} placeholder="Write the representation…" />
        </Field>

        <SwitchField
          label="AI-assisted drafting"
          hint="Marks AI involvement — frozen onto the published revision as provenance (§26)."
          checked={aiAssisted}
          onChange={setAiAssisted}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onDone} disabled={creating}>Cancel</Button>
        <Button size="sm" onClick={() => void submit()} disabled={creating || !anchor} className="bg-emerald-600 hover:bg-emerald-700">
          {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Create post
        </Button>
      </DialogFooter>
    </>
  )
}

function fieldErrorsFrom(error: { details?: unknown } | null): Record<string, string> {
  const details = error?.details
  if (!details || typeof details !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0]
    else if (typeof value === 'string') out[key] = value
  }
  return out
}

function AnchorPicker({
  selected,
  onSelect,
  error,
}: {
  selected: AnchorSelection | null
  onSelect: (anchor: AnchorSelection | null) => void
  error?: string
}) {
  const [kind, setKind] = useState<'unit' | 'event'>('unit')
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 300)
  const [options, setOptions] = useState<Array<{ slug: string; name: string; meta: string }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const api = useLatestApi()

  // Options load when the kind or the debounced search changes (and on mount).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    const params = new URLSearchParams({ pageSize: '15' })
    if (debounced.trim()) params.set('q', debounced.trim())
    const path =
      kind === 'unit'
        ? `/api/knowledge/admin/units?${params.toString()}`
        : `/api/current-affairs/admin/events?${params.toString()}`
    void (async () => {
      try {
        const { data, error: apiError } = await api.current.get<{
          units?: Array<{ slug: string; canonicalName: string; status: string; scope: string; countryIso: string | null }>
          events?: Array<{ slug: string; title: string; lifecycleState: string; scope: string; countryIso: string | null }>
        }>(path)
        if (cancelled) return
        if (data) {
          const list =
            kind === 'unit'
              ? (data.units ?? []).map((unit) => ({ slug: unit.slug, name: unit.canonicalName, meta: `${pretty(unit.status)} · ${unit.scope === 'GLOBAL' ? 'global' : unit.countryIso ?? 'country'}` }))
              : (data.events ?? []).map((event) => ({ slug: event.slug, name: event.title, meta: `${pretty(event.lifecycleState)} · ${event.scope === 'GLOBAL' ? 'global' : event.countryIso ?? 'country'}` }))
          setOptions(list)
        } else {
          setOptions([])
          setLoadError(apiError?.message ?? 'Could not load the anchor list')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, kind, debounced])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-zinc-700">Anchor <span className="text-red-500" aria-hidden="true">*</span></p>
        <div className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 p-0.5" role="tablist" aria-label="Anchor kind">
          {(['unit', 'event'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => { setKind(value); onSelect(null) }}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors',
                kind === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
              )}
            >
              {value === 'unit' ? 'Knowledge unit' : 'Current event'}
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
              {selected.kind === 'unit' ? <Building2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" /> : <Globe2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />}
              <span className="truncate">{selected.name}</span>
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
              {selected.slug} · {selected.meta}
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-7" onClick={() => onSelect(null)}>Change</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <div className="relative border-b border-zinc-100">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={kind === 'unit' ? 'Search knowledge units…' : 'Search current events…'}
              aria-label="Search anchors"
              className="h-9 w-full bg-transparent pl-8 pr-3 text-[13px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5">
            {loading && <p className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…</p>}
            {!loading && loadError && <p className="px-2 py-3 text-xs text-red-600">{loadError}</p>}
            {!loading && !loadError && (options?.length ?? 0) === 0 && (
              <p className="px-2 py-3 text-xs text-zinc-400">No {kind === 'unit' ? 'units' : 'events'} match — try another search.</p>
            )}
            {!loading &&
              (options ?? []).map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => onSelect({ kind, slug: option.slug, name: option.name, meta: option.meta })}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-emerald-50/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-800">{option.name}</span>
                    <span className="block truncate font-mono text-[11px] text-zinc-400">{option.slug}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{option.meta}</span>
                </button>
              ))}
          </div>
        </div>
      )}
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : <p className="text-xs leading-relaxed text-zinc-400">The canonical record this representation renders — never re-entered, only represented.</p>}
    </div>
  )
}

// ---------- Anchor picker (§7/§12 — unit XOR event) ----------

// ==================================================================
// Per-item evidence manager (§24)
// ==================================================================
interface ItemLink {
  id: string
  claim: string | null
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

interface RegistrySource {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: string
}

export function PostSourcesDialog({
  open,
  onOpenChange,
  item,
  onLinksChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: AdminItem | null
  /** Fired after attach/detach so the parent list can refresh sourceCount. */
  onLinksChanged: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {item && <SourcesManager item={item} onLinksChanged={onLinksChanged} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SourcesManager({ item, onLinksChanged, onDone }: { item: AdminItem; onLinksChanged: () => void; onDone: () => void }) {
  const api = useLatestApi()
  const { toast } = useToast()
  const [links, setLinks] = useState<ItemLink[] | null>(null)
  const [linksError, setLinksError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [registry, setRegistry] = useState<RegistrySource[] | null>(null)
  const [attachSource, setAttachSource] = useState('')
  const [attachClaim, setAttachClaim] = useState('')
  const [attachError, setAttachError] = useState<Record<string, string>>({})
  const [attaching, setAttaching] = useState(false)
  const [unlinkTarget, setUnlinkTarget] = useState<ItemLink | null>(null)
  const [claimDraft, setClaimDraft] = useState<{ id: string; value: string } | null>(null)
  const [busyLink, setBusyLink] = useState<string | null>(null)

  const anchorName = item.unit?.canonicalName ?? item.event?.title ?? '—'

  // Links for this item.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await api.current.get<{ links: ItemLink[] }>(`/api/content/admin/items/${item.id}/sources`)
      if (cancelled) return
      if (data) { setLinks(data.links); setLinksError(null) }
      else { setLinks([]); setLinksError(error?.message ?? 'Could not load citations') }
    })()
    return () => { cancelled = true }
  }, [api, item.id, tick])

  // Registry options for the attach form (first page is plenty; UNRELIABLE
  // evidence cannot back new content and is filtered out).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await api.current.get<{ sources: RegistrySource[] }>('/api/content/admin/sources?pageSize=100')
      if (!cancelled && data) setRegistry(data.sources.filter((source) => source.verification !== 'UNRELIABLE'))
    })()
    return () => { cancelled = true }
  }, [api])

  const attachable = (registry ?? []).filter((source) => !(links ?? []).some((link) => link.source.id === source.id))

  async function attach() {
    if (!attachSource) return
    setAttaching(true)
    setAttachError({})
    const { data, error } = await api.current.post<{ link: ItemLink }>(`/api/content/admin/items/${item.id}/sources`, {
      source: attachSource,
      ...(attachClaim.trim() ? { claim: attachClaim.trim() } : {}),
    })
    setAttaching(false)
    if (data) {
      toast({ title: 'Evidence attached', description: 'The citation is live provenance on this item.' })
      setAttachSource('')
      setAttachClaim('')
      setTick((value) => value + 1)
      onLinksChanged()
    } else {
      setAttachError(fieldErrorsFrom(error))
      if (!error?.details) toast({ title: 'Could not attach', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  async function unlink(link: ItemLink) {
    setBusyLink(link.id)
    const { data, error } = await api.current.del<{ ok: boolean }>(`/api/content/admin/items/${item.id}/sources/${link.id}`)
    setBusyLink(null)
    if (data) {
      toast({ title: 'Evidence detached', description: 'The Source record itself is preserved forever (§36).' })
      setUnlinkTarget(null)
      setTick((value) => value + 1)
      onLinksChanged()
    } else {
      toast({ title: 'Could not detach', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  async function saveClaim() {
    if (!claimDraft) return
    setBusyLink(claimDraft.id)
    const { data, error } = await api.current.patch<{ link: ItemLink }>(
      `/api/content/admin/items/${item.id}/sources/${claimDraft.id}`,
      { claim: claimDraft.value.trim() || null }
    )
    setBusyLink(null)
    if (data) {
      toast({ title: 'Attribution updated' })
      setClaimDraft(null)
      setTick((value) => value + 1)
    } else {
      toast({ title: 'Could not update the claim', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          Evidence — {item.title}
        </DialogTitle>
        <DialogDescription>
          {anchorName} · {pretty(item.format)} · {item.language.name}. Claim-level attribution names the specific
          statement; content-level (no claim) backs the whole item (§24).
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {links === null && !linksError && (
            <p className="flex items-center gap-2 px-3 py-6 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading citations…</p>
          )}
          {linksError && <p className="px-3 py-6 text-xs text-red-600">{linksError}</p>}
          {links !== null && links.length === 0 && !linksError && (
            <p className="px-3 py-6 text-center text-xs text-zinc-400">No evidence attached yet — add the first citation below.</p>
          )}
          {(links ?? []).map((link) => (
            <div key={link.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={link.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 truncate text-[13px] font-medium text-zinc-800 hover:text-emerald-700"
                  >
                    <span className="truncate">{link.source.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </a>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {link.source.publisher} · {pretty(link.source.type)} · linked {formatWhen(link.linkedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <TrustBadge state={link.source.verification} />
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600 hover:bg-red-50" onClick={() => setUnlinkTarget(link)} aria-label="Detach source" disabled={busyLink === link.id}>
                    {busyLink === link.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                </div>
              </div>
              <div className="mt-1.5">
                {claimDraft?.id === link.id ? (
                  <div className="flex items-center gap-2">
                    <TextInput value={claimDraft.value} onChange={(value) => setClaimDraft({ id: link.id, value })} placeholder="What this evidence backs (claim-level)…" />
                    <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => void saveClaim()} disabled={busyLink === link.id}>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setClaimDraft(null)}>Cancel</Button>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="text-zinc-400">Claim:</span>
                    {link.claim ? <span className="text-zinc-600">{link.claim}</span> : <span className="italic text-zinc-400">content-level attribution</span>}
                    <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline" onClick={() => setClaimDraft({ id: link.id, value: link.claim ?? '' })}>
                      <Pencil className="h-3 w-3" aria-hidden="true" /> edit
                    </button>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Attach form */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
          <p className="text-[13px] font-medium text-zinc-700">Attach evidence</p>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <SelectInput
              value={attachSource}
              onChange={setAttachSource}
              placeholder="Pick a source from the registry…"
              options={attachable.map((source) => ({ value: source.id, label: `${source.title} — ${source.publisher}` }))}
              invalid={Boolean(attachError.source)}
            />
            <TextInput value={attachClaim} onChange={setAttachClaim} placeholder="Optional claim — the specific statement this evidence backs" invalid={Boolean(attachError.claim)} />
            <div className="flex items-center justify-between gap-2">
              {attachError.source || attachError.claim ? (
                <p className="text-xs text-red-600" role="alert">{attachError.source ?? attachError.claim}</p>
              ) : (
                <p className="text-xs text-zinc-400">UNRELIABLE evidence is excluded — it cannot back new content.</p>
              )}
              <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => void attach()} disabled={!attachSource || attaching}>
                {attaching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                Attach
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onDone}>Done</Button>
      </DialogFooter>

      <AlertDialog open={unlinkTarget !== null} onOpenChange={(next) => { if (!next) setUnlinkTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach this evidence?</AlertDialogTitle>
            <AlertDialogDescription>
              “{unlinkTarget?.source.title}” stops backing this item. The Source record itself is preserved forever —
              evidence is never hard-deleted (§36).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => unlinkTarget && void unlink(unlinkTarget)}>Detach</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Re-exported for the list page's AI-provenance affordance. */
export function AiFlag({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400" title="AI-assisted drafting (§26)">
      <Bot className="h-3 w-3" aria-hidden="true" /> AI
    </span>
  )
}
