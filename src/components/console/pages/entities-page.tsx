'use client'

/**
 * GKSetu Console — Entities (CONSOLE-S1-B).
 *
 * The reference registry (§6): canonical Person/Place/Organisation/Concept
 * records with aliases, scopes and §36 soft lifecycle. List with the
 * server-side filters the API supports (q/type/status/scope/country + page),
 * create/edit dialog with the alias manager, retire/reactivate as the §36
 * delete-equivalent (entities are never hard-deleted — links stay as honest
 * history).
 *
 * Verified live against /api/entities/admin* and /api/countries.
 */
import { useCallback, useEffect, useState, ReactNode } from 'react'
import {
  Archive,
  Globe2,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Tags,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, SelectInput, TextArea, TextInput } from '@/components/console/ui/form-fields'
import { useHasPermission } from '@/components/console/ui/console-api'
import { ConsolePageHeader, formatWhen, StatusBadge } from '@/components/console/ui/primitives'
import { ResourceColumn, ResourceTable } from '@/components/console/ui/resource-table'
import { useToast } from '@/hooks/use-toast'
import { pretty, SummaryChips, useDebounced, useLatestApi } from './s1b-shared'

// ---------- Row / API types (verified against the live API) ----------

interface AdminEntity {
  id: string
  slug: string
  canonicalName: string
  description: string | null
  type: 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
  status: 'ACTIVE' | 'RETIRED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  notes: string | null
  aliasCount: number
  eventCount: number
  createdAt: string
  updatedAt: string
}

interface EntityAlias {
  id: string
  value: string
  languageCode: string | null
}

interface AdminEntityDetail extends AdminEntity {
  aliases: EntityAlias[]
  events: Array<{ eventId: string; eventSlug: string; eventTitle: string; lifecycleState: string; note: string | null; linkedAt: string }>
  editable: boolean
}

interface ListResult {
  entities: AdminEntity[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; ACTIVE: number; RETIRED: number }
}

const TYPE_OPTIONS = ['PERSON', 'PLACE', 'ORGANISATION', 'CONCEPT']
const STATUS_OPTIONS = ['ACTIVE', 'RETIRED']
const SCOPE_OPTIONS = ['GLOBAL', 'COUNTRY']

const TYPE_ICONS: Record<string, typeof Globe2> = {
  PERSON: Tags,
  PLACE: MapPin,
  ORGANISATION: Globe2,
  CONCEPT: Tags,
}

export function EntitiesPage() {
  const api = useLatestApi()
  const { toast } = useToast()
  const canManage = useHasPermission('entities:manage')

  const [result, setResult] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [scope, setScope] = useState('')
  const [country, setCountry] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 350)

  const [countries, setCountries] = useState<Array<{ isoCode: string; name: string }>>([])

  // Dialogs.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminEntity | null>(null)
  const [retireTarget, setRetireTarget] = useState<AdminEntity | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // ---------- Data ----------

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (type) params.set('type', type)
    if (status) params.set('status', status)
    if (scope) params.set('scope', scope)
    if (country) params.set('country', country)
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
    void (async () => {
      try {
        const { data, error: apiError } = await api.current.get<ListResult>(`/api/entities/admin?${params.toString()}`)
        if (cancelled) return
        if (data) setResult(data)
        else {
          setResult(null)
          setError(apiError?.message ?? 'Could not load the registry')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManage, api, page, type, status, scope, country, debouncedSearch, tick])

  // Public country list — the COUNTRY scope's markets (§14).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await api.current.get<{ countries: Array<{ isoCode: string; name: string }> }>('/api/countries')
      if (!cancelled && data) setCountries(data.countries)
    })()
    return () => {
      cancelled = true
    }
  }, [api])

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  // ---------- Actions ----------

  async function flipStatus(entity: AdminEntity, next: 'ACTIVE' | 'RETIRED') {
    setBusy(`${entity.id}:status`)
    const { data, error: apiError } = await api.current.patch<{ entity: AdminEntity }>(`/api/entities/admin/${entity.id}`, {
      status: next,
    })
    setBusy(null)
    if (data) {
      refresh()
      toast({
        title: next === 'RETIRED' ? 'Entity retired (§36)' : 'Entity reactivated',
        description:
          next === 'RETIRED'
            ? 'It stops accepting new links — existing links stay as honest history.'
            : 'The record accepts links and follows again.',
      })
    } else {
      toast({ title: 'Could not update the entity', description: apiError?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  // ---------- Table ----------

  const columns: Array<ResourceColumn<AdminEntity>> = [
    {
      key: 'canonicalName',
      header: 'Entity',
      render: (row) => (
        <div className="min-w-0 max-w-[280px]">
          <p className="truncate font-medium text-zinc-900">{row.canonicalName}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{row.slug}</p>
        </div>
      ),
      className: 'min-w-[200px]',
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => {
        const Icon = TYPE_ICONS[row.type] ?? Tags
        return (
          <span className="inline-flex items-center gap-1.5 text-zinc-600">
            <Icon className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            {pretty(row.type)}
          </span>
        )
      },
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'scope',
      header: 'Scope',
      render: (row) =>
        row.scope === 'GLOBAL' ? (
          <span className="inline-flex items-center gap-1 text-zinc-600">
            <Globe2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> global
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-zinc-600">
            <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> {row.countryIso ?? 'country'}
          </span>
        ),
    },
    { key: 'aliasCount', header: 'Aliases', render: (row) => <span className="text-zinc-600">{row.aliasCount}</span> },
    { key: 'eventCount', header: 'Events', render: (row) => <span className="text-zinc-600">{row.eventCount}</span> },
    { key: 'updatedAt', header: 'Updated', render: (row) => <span className="text-zinc-500">{formatWhen(row.updatedAt)}</span> },
  ]

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Entities"
        description="The reference registry — persons, places, organisations and concepts the current events reference. One canonical record per real-world entity, aliases included."
        icon={<Tags className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                className="h-8 gap-2 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  setEditing(null)
                  setEditorOpen(true)
                }}
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                New entity
              </Button>
            )}
          </>
        }
      />

      {result && (
        <SummaryChips
          chips={[
            { label: 'total', value: result.summary.total },
            { label: 'active', value: result.summary.ACTIVE, tone: 'emerald' },
            { label: 'retired', value: result.summary.RETIRED },
          ]}
        />
      )}

      <ResourceTable
        columns={columns}
        rows={result?.entities ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        emptyTitle="No entities match"
        emptyHint="Register the first canonical record — whatever the number of stories that mention it, the entity is entered once."
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value)
            setPage(1)
          },
          placeholder: 'Search names, slugs, descriptions…',
        }}
        toolbar={
          <>
            <SelectInput
              value={type}
              onChange={(value) => {
                setType(value)
                setPage(1)
              }}
              placeholder="All types"
              options={TYPE_OPTIONS.map((value) => ({ value, label: pretty(value) }))}
            />
            <SelectInput
              value={status}
              onChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
              placeholder="All statuses"
              options={STATUS_OPTIONS.map((value) => ({ value, label: pretty(value) }))}
            />
            <SelectInput
              value={scope}
              onChange={(value) => {
                setScope(value)
                if (value !== 'COUNTRY') setCountry('')
                setPage(1)
              }}
              placeholder="All scopes"
              options={SCOPE_OPTIONS.map((value) => ({ value, label: pretty(value) }))}
            />
            {scope === 'COUNTRY' && (
              <SelectInput
                value={country}
                onChange={(value) => {
                  setCountry(value)
                  setPage(1)
                }}
                placeholder="All countries"
                options={countries.map((entry) => ({ value: entry.isoCode, label: `${entry.name} (${entry.isoCode})` }))}
              />
            )}
          </>
        }
        pagination={
          result
            ? {
                page: result.pagination.page,
                totalPages: result.pagination.totalPages,
                total: result.pagination.total,
                onPage: setPage,
              }
            : undefined
        }
        onRowClick={(row) => {
          setEditing(row)
          setEditorOpen(true)
        }}
        actions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500" aria-label="Row actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                disabled={row.status === 'RETIRED'}
                onClick={() => {
                  setEditing(row)
                  setEditorOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {row.status === 'ACTIVE' ? (
                <DropdownMenuItem variant="destructive" disabled={busy === `${row.id}:status`} onClick={() => setRetireTarget(row)}>
                  {busy === `${row.id}:status` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Retire (§36)
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={busy === `${row.id}:status`} onClick={() => void flipStatus(row, 'ACTIVE')}>
                  {busy === `${row.id}:status` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Reactivate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Create / edit (DialogContent unmounts on close → fresh form state). */}
      <EntityEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
        entity={editing}
        countries={countries}
        onSaved={() => refresh()}
      />

      {/* Retire confirm — soft delete (§36). */}
      <AlertDialog open={retireTarget !== null} onOpenChange={(open) => { if (!open) setRetireTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this entity?</AlertDialogTitle>
            <AlertDialogDescription>
              “{retireTarget?.canonicalName}” stops accepting new event links and follows. Existing links stay as
              honest history — entities are never hard-deleted (§36). You can reactivate later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (retireTarget) void flipStatus(retireTarget, 'RETIRED')
                setRetireTarget(null)
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ==================================================================
// Create / edit dialog (+ alias manager)
// ==================================================================

function EntityEditorDialog({
  open,
  onOpenChange,
  entity,
  countries,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null → create mode; otherwise the detail is loaded and edited. */
  entity: AdminEntity | null
  countries: Array<{ isoCode: string; name: string }>
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {/* DialogContent unmounts on close, so the branch below mounts fresh
            each time the dialog opens — no reset effects needed. */}
        {entity ? (
          <EntityEditLoader id={entity.id} onSaved={onSaved} onDone={() => onOpenChange(false)} />
        ) : (
          <CreateEntityForm countries={countries} onSaved={onSaved} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Loads the detail (aliases + events) on mount; edit affordances ride `editable` (§37). */
function EntityEditLoader({ id, onSaved, onDone }: { id: string; onSaved: () => void; onDone: () => void }) {
  const api = useLatestApi()
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; detail: AdminEntityDetail }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await api.current.get<{ entity: AdminEntityDetail }>(`/api/entities/admin/${id}`)
      if (cancelled) return
      if (data) setState({ kind: 'ready', detail: data.entity })
      else setState({ kind: 'error', message: error?.message ?? 'Could not load the entity' })
    })()
    return () => {
      cancelled = true
    }
  }, [api, id])

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading entity…
      </div>
    )
  }
  if (state.kind === 'error') {
    return <p className="py-8 text-center text-sm text-red-600">{state.message}</p>
  }
  return <EditEntityForm detail={state.detail} onSaved={onSaved} onDone={onDone} />
}

function AliasEditor({
  aliases,
  onChange,
  error,
}: {
  aliases: Array<{ value: string; language: string }>
  onChange: (next: Array<{ value: string; language: string }>) => void
  error?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-zinc-700">
          Aliases <span className="text-xs font-normal text-zinc-400">({aliases.length}/20 · case-insensitively unique)</span>
        </p>
        {aliases.length < 20 && (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={() => onChange([...aliases, { value: '', language: '' }])}>
            <Plus className="h-3 w-3" aria-hidden="true" /> Add
          </Button>
        )}
      </div>
      {aliases.length === 0 && <p className="text-xs text-zinc-400">No aliases — alternate names/spellings improve search matching (§17).</p>}
      <div className="space-y-1.5">
        {aliases.map((alias, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <TextInput
              value={alias.value}
              onChange={(value) => onChange(aliases.map((entry, i) => (i === index ? { ...entry, value } : entry)))}
              placeholder="e.g. ISRO, Indian Space Research Organisation"
            />
            <TextInput
              value={alias.language}
              onChange={(value) => onChange(aliases.map((entry, i) => (i === index ? { ...entry, language: value } : entry)))}
              placeholder="lang"
              className="w-20 shrink-0 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0 text-zinc-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => onChange(aliases.filter((_, i) => i !== index))}
              aria-label="Remove alias"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
    </div>
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

function EditEntityForm({ detail, onSaved, onDone }: { detail: AdminEntityDetail; onSaved: () => void; onDone: () => void }) {
  const api = useLatestApi()
  const { toast } = useToast()
  const [canonicalName, setCanonicalName] = useState(detail.canonicalName)
  const [description, setDescription] = useState(detail.description ?? '')
  const [notes, setNotes] = useState(detail.notes ?? '')
  const [aliases, setAliases] = useState(detail.aliases.map((alias) => ({ value: alias.value, language: alias.languageCode ?? '' })))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setFieldErrors({})
    const payload = {
      canonicalName,
      description: description.trim() || null,
      notes: notes.trim() || null,
      aliases: aliases
        .filter((alias) => alias.value.trim())
        .map((alias) => ({ value: alias.value.trim(), ...(alias.language.trim() ? { language: alias.language.trim().toLowerCase() } : {}) })),
    }
    const { data, error } = await api.current.patch<{ entity: AdminEntity }>(`/api/entities/admin/${detail.id}`, payload)
    setSaving(false)
    if (data) {
      toast({ title: 'Entity updated', description: 'Aliases were replaced wholesale — every edit is audited.' })
      onSaved()
      onDone()
    } else {
      setFieldErrors(fieldErrorsFrom(error))
      if (!error?.details) toast({ title: 'Could not save', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  const readOnly = !detail.editable

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit entity</DialogTitle>
        <DialogDescription>
          Slug, type and scope are immutable (create-time identity). Aliases replace the whole set on save.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2.5 sm:grid-cols-4">
          <MetaCell label="Slug" value={<span className="font-mono text-xs">{detail.slug}</span>} />
          <MetaCell label="Type" value={pretty(detail.type)} />
          <MetaCell label="Scope" value={detail.scope === 'GLOBAL' ? 'Global' : detail.countryIso ?? 'Country'} />
          <MetaCell label="Events" value={`${detail.eventCount} linked`} />
        </div>

        {readOnly && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Retired entities are read-only (§36) — reactivate from the row menu to edit again.
          </p>
        )}

        <Field label="Canonical name" htmlFor="entity-edit-name" error={fieldErrors.canonicalName} required>
          <TextInput id="entity-edit-name" value={canonicalName} onChange={setCanonicalName} disabled={readOnly} invalid={Boolean(fieldErrors.canonicalName)} />
        </Field>
        <Field label="Description" htmlFor="entity-edit-description" error={fieldErrors.description}>
          {readOnly ? (
            <p className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-600">{description || <span className="italic text-zinc-400">No description</span>}</p>
          ) : (
            <TextArea id="entity-edit-description" value={description} onChange={setDescription} rows={2} placeholder="One-line canonical description…" />
          )}
        </Field>
        <Field label="Internal notes" htmlFor="entity-edit-notes" error={fieldErrors.notes}>
          {readOnly ? (
            <p className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-600">{notes || <span className="italic text-zinc-400">No notes</span>}</p>
          ) : (
            <TextArea id="entity-edit-notes" value={notes} onChange={setNotes} rows={2} placeholder="Editorial notes, merge candidates…" />
          )}
        </Field>
        <AliasEditor aliases={aliases} onChange={readOnly ? () => undefined : setAliases} error={fieldErrors.aliases} />

        {detail.events.length > 0 && (
          <div className="rounded-lg border border-zinc-200 bg-white">
            <p className="border-b border-zinc-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Referenced by events</p>
            <div className="max-h-36 overflow-y-auto px-3 py-1.5">
              {detail.events.map((event) => (
                <p key={event.eventId} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
                  <span className="truncate text-zinc-700">{event.eventTitle}</span>
                  <span className="shrink-0 text-[11px] text-zinc-400">{pretty(event.lifecycleState)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void save()} disabled={saving || readOnly}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Save changes
        </Button>
      </DialogFooter>
    </>
  )
}

function MetaCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="truncate text-[13px] font-medium text-zinc-700">{value}</p>
    </div>
  )
}

function CreateEntityForm({
  countries,
  onSaved,
  onDone,
}: {
  countries: Array<{ isoCode: string; name: string }>
  onSaved: () => void
  onDone: () => void
}) {
  const api = useLatestApi()
  const { toast } = useToast()
  const [canonicalName, setCanonicalName] = useState('')
  const [slug, setSlug] = useState('')
  const [type, setType] = useState('PERSON')
  const [scope, setScope] = useState('GLOBAL')
  const [country, setCountry] = useState(countries[0]?.isoCode ?? 'IN')
  const [description, setDescription] = useState('')
  const [aliases, setAliases] = useState<Array<{ value: string; language: string }>>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  async function submit() {
    setCreating(true)
    setFieldErrors({})
    const payload = {
      canonicalName,
      type,
      scope,
      ...(scope === 'COUNTRY' ? { country } : {}),
      ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(aliases.filter((alias) => alias.value.trim()).length
        ? {
            aliases: aliases
              .filter((alias) => alias.value.trim())
              .map((alias) => ({ value: alias.value.trim(), ...(alias.language.trim() ? { language: alias.language.trim().toLowerCase() } : {}) })),
          }
        : {}),
    }
    const { data, error } = await api.current.post<{ entity: AdminEntityDetail }>('/api/entities/admin', payload)
    setCreating(false)
    if (data) {
      toast({ title: 'Entity registered', description: 'One canonical record — whatever the number of stories that mention it.' })
      onSaved()
      onDone()
    } else {
      setFieldErrors(fieldErrorsFrom(error))
      if (!error?.details) toast({ title: 'Could not create the entity', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New entity</DialogTitle>
        <DialogDescription>
          One row per real-world entity (§6). Slug, type and scope are create-time decisions — corrections mean a new
          record.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <Field label="Canonical name" htmlFor="entity-new-name" error={fieldErrors.canonicalName} required>
          <TextInput id="entity-new-name" value={canonicalName} onChange={setCanonicalName} placeholder="e.g. Indian Space Research Organisation" invalid={Boolean(fieldErrors.canonicalName)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="entity-new-type" error={fieldErrors.type}>
            <SelectInput id="entity-new-type" value={type} onChange={setType} options={TYPE_OPTIONS.map((value) => ({ value, label: pretty(value) }))} invalid={Boolean(fieldErrors.type)} />
          </Field>
          <Field label="Scope" htmlFor="entity-new-scope" error={fieldErrors.scope} hint="Global entities are admin-only; country entities belong to one market (§14).">
            <SelectInput id="entity-new-scope" value={scope} onChange={setScope} options={SCOPE_OPTIONS.map((value) => ({ value, label: pretty(value) }))} invalid={Boolean(fieldErrors.scope)} />
          </Field>
        </div>
        {scope === 'COUNTRY' && (
          <Field label="Country" htmlFor="entity-new-country" error={fieldErrors.country} required>
            <SelectInput id="entity-new-country" value={country} onChange={setCountry} options={countries.map((entry) => ({ value: entry.isoCode, label: `${entry.name} (${entry.isoCode})` }))} invalid={Boolean(fieldErrors.country)} />
          </Field>
        )}
        <Field label="Slug" htmlFor="entity-new-slug" error={fieldErrors.slug} hint="Optional — derived from the name when left blank. Lowercase kebab-case, immutable.">
          <TextInput id="entity-new-slug" value={slug} onChange={setSlug} placeholder="isro" className="font-mono text-xs" invalid={Boolean(fieldErrors.slug)} />
        </Field>
        <Field label="Description" htmlFor="entity-new-description" error={fieldErrors.description}>
          <TextArea id="entity-new-description" value={description} onChange={setDescription} rows={2} placeholder="One-line canonical description…" />
        </Field>
        <AliasEditor aliases={aliases} onChange={setAliases} error={fieldErrors.aliases} />
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onDone} disabled={creating}>Cancel</Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={creating}>
          {creating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Create entity
        </Button>
      </DialogFooter>
    </>
  )
}
